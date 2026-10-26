import { liveAvailableCommands } from "../../../modernization/runtime/intent/apply-intent.js";
import {
  collectInteractiveKojoPreparations,
  type InteractiveKojoTarget,
} from "../../../modernization/runtime/kojo/interactive-preparation.js";
import { presentCharaNumsForWarming } from "../../../modernization/runtime/kojo/interactive-preload.js";
import type { KojoCache } from "../../../modernization/runtime/kojo/kojo-cache.js";
import type { GameState } from "../../../modernization/runtime/state/game-state.js";
import type { AgentIntent } from "../../../modernization/schemas/types.js";
import { privateRoomOwner } from "../../../modernization/runtime/world/private-room.js";

type PreparationCache = Pick<KojoCache, "getIndex" | "prepareInteractiveKojo" | "preparationRevision">;
type CommandQuery = (state: Readonly<GameState>, charaNum: number) => readonly number[];

/** App coordination only: runtime still owns parsing, variants and command gates. */
export class DevKojoPreloader {
  private cache: PreparationCache | null = null;
  private signature = "";
  private controller: AbortController | null = null;
  private pending: Promise<void> = Promise.resolve();

  constructor(private readonly commandQuery: CommandQuery = (state, charaNum) =>
    liveAvailableCommands(state, charaNum).filter((command) => command.usable).map((command) => command.commandNo)) {}

  prepare(cache: PreparationCache, state: Readonly<GameState>): Promise<void> {
    const charaNums = presentCharaNumsForWarming(state.master.location, state.charas, [
      state.training?.target,
      state.walkSession?.encounter?.charaNum,
      state.walkSession?.lockedDoor?.ownerCharaNum,
      privateRoomOwner(state, state.master.location),
    ].filter((value): value is number => typeof value === "number"));
    const targets: InteractiveKojoTarget[] = charaNums.map((charaNum) => ({
      charaNum,
      commandNos: this.commandQuery(state, charaNum),
    }));
    const tasks = collectInteractiveKojoPreparations(cache.getIndex(), state, targets);
    const signature = JSON.stringify([cache.preparationRevision, tasks.map((task) => [
      task.key, task.location.filePath, task.location.lineStart,
      task.location.lineEnd, task.location.contentFingerprint,
    ])]);
    // Clock/AI/UI updates with the same routes must not restart background parsing.
    if (this.cache === cache && this.signature === signature) return this.pending;
    this.cancel();
    this.cache = cache;
    this.signature = signature;
    const controller = new AbortController();
    this.controller = controller;
    this.pending = cache.prepareInteractiveKojo(state, targets, { signal: controller.signal })
      .catch((error) => {
        if (this.controller === controller) this.cancel();
        throw error;
      });
    return this.pending;
  }

  cancel(): void {
    this.controller?.abort();
    this.controller = null;
    this.cache = null;
    this.signature = "";
    this.pending = Promise.resolve();
  }

  async prepareCommand(cache: PreparationCache, state: Readonly<GameState>, intent: AgentIntent): Promise<void> {
    if (intent.kind !== "ISSUE_COMMAND") return;
    this.cancel();
    const revision = cache.preparationRevision;
    const explicit = [intent.target, intent.actor, state.training?.target,
      state.walkSession?.encounter?.charaNum].filter((value): value is number => typeof value === "number" && value > 0);
    const charaNums = [...new Set(explicit.length > 0 ? explicit
      : presentCharaNumsForWarming(state.master.location, state.charas))];
    await cache.prepareInteractiveKojo(state, charaNums.map((charaNum) => ({
      charaNum, commandNos: [intent.commandNo],
    })), { retainPrepared: true, commandOnly: true });
    if (revision !== cache.preparationRevision) throw new Error("口上资源已更新，请重新操作");
  }

  async prepareLocations(cache: PreparationCache, state: Readonly<GameState>, locations: readonly string[]): Promise<void> {
    this.cancel();
    const revision = cache.preparationRevision;
    const wanted = new Set(locations);
    const owners = locations.map((location) => privateRoomOwner(state, location))
      .filter((value): value is number => typeof value === "number" && value > 0);
    const charaNums = [...new Set([...owners, ...Object.entries(state.charas)
      .filter(([, chara]) => wanted.has(chara.location)).map(([id]) => Number(id))])];
    await cache.prepareInteractiveKojo(state, charaNums.map((charaNum) => ({ charaNum, commandNos: [] })),
      { retainPrepared: true });
    if (revision !== cache.preparationRevision) throw new Error("口上资源已更新，请重新操作");
  }
}
