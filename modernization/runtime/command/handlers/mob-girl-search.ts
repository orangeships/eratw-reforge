import type { GameState } from "../../state/game-state.js";
import { cloneGameState } from "../../state/game-state.js";
import { advanceTimeTicks, BASE_ID, CFLAG_ID } from "../../state/settlement.js";
import { atPlayerBase } from "../../world/location-predicates.js";
import { locationToRoomId } from "../../world/room-id-location.js";
import { pickOne, type PromptAnswer, type PromptSpec } from "../prompt.js";
import type { CommandContext, HandlerEntry } from "../types.js";
import {
  activateRememberedMobGirl,
  canSearchMobGirls,
  materializeMobGirl,
  previewMobGirl,
  rememberedMobGirls,
} from "../../world/dynamic-characters.js";
import { isTimeStopped } from "../h-mode.js";

function selections(answer: PromptAnswer | undefined): readonly (number | string)[] {
  return answer?.kind === "pick_sequence" ? answer.values : [];
}

function candidateIndex(values: readonly (number | string)[]): number {
  return values.filter((value) => value === "next").length;
}

function candidatePrompt(ctx: CommandContext, index: number): PromptSpec {
  const candidate = previewMobGirl(ctx.state, index);
  const remembered = rememberedMobGirls(ctx.state, true);
  const stamina = candidate.slot.state.MAXBASE[0] ?? 0;
  const will = candidate.slot.state.MAXBASE[1] ?? 0;
  return pickOne(
    `${candidate.meta.species} ${candidate.slot.callName ?? `候选${index + 1}`}看起来怎么样？`,
    [
      { id: `accept:${index}`, label: "很中意", detail: `体力 ${stamina} / 气力 ${will}` },
      { id: "next", label: "寻找别的女孩" },
      { id: "recall", label: "寻找以前认识的女孩", disabled: remembered.length === 0 },
      { id: "cancel", label: "物色中止" },
    ],
  );
}

export function mobGirlSearchPrompt(ctx: CommandContext): PromptSpec | null {
  const values = selections(ctx.promptAnswer);
  const last = values.at(-1);
  if (typeof last === "string" && (last.startsWith("accept:") || last.startsWith("remembered:") || last === "cancel")) {
    return null;
  }
  if (last === "recall") {
    return pickOne(
      "要寻找哪位以前认识的女孩？",
      [
        ...rememberedMobGirls(ctx.state, true).map((slot) => ({
          id: `remembered:${slot.charaNum}`,
          label: slot.callName ?? `角色${slot.charaNum}`,
          detail: ctx.state.dynamicCharacters?.[slot.charaNum]?.encounterSummary,
        })),
        { id: "cancel", label: "放弃" },
      ],
    );
  }
  return candidatePrompt(ctx, candidateIndex(values));
}

function blocked(ctx: CommandContext, message: string) {
  return {
    state: cloneGameState(ctx.state),
    events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text: message }],
    outcome: "blocked" as const,
    failReason: { kind: "precondition" as const, message },
  };
}

export const mobGirlSearchHandlerEntry: HandlerEntry = {
  commandNo: 444,
  gateStatus: "complete",
  stagedPrompt: true,
  prompt: mobGirlSearchPrompt,
  displayCheck: (ctx) => ({ shown: canSearchMobGirls(ctx.state), tone: "normal" }),
  execCheck: (ctx) => canSearchMobGirls(ctx.state)
    ? { ok: true }
    : { ok: false, reason: { kind: "precondition", message: "现在无法物色路人女子。" } },
  handler: (ctx) => {
    const values = selections(ctx.promptAnswer);
    const last = values.at(-1);
    if (last === "cancel") {
      return { state: cloneGameState(ctx.state), events: [], outcome: "noop" };
    }
    const next: GameState = cloneGameState(ctx.state);
    let slot;
    if (typeof last === "string" && last.startsWith("accept:")) {
      const index = Number(last.slice("accept:".length));
      if (!Number.isInteger(index) || index < 0) return blocked(ctx, "路人候选已失效。");
      slot = materializeMobGirl(next, index);
    } else if (typeof last === "string" && last.startsWith("remembered:")) {
      const charaNum = Number(last.slice("remembered:".length));
      slot = activateRememberedMobGirl(next, charaNum);
      if (!slot) return blocked(ctx, "在这里找不到这位女孩。");
    } else {
      return blocked(ctx, "必须先选择一位女孩。");
    }

    const timeStopped = isTimeStopped(next);
    // COMF444 spends the three ordinary minutes (or 10 TSP while frozen)
    // before it writes the new encounter's companion lease.  Keeping this
    // order matters because the clock decrements existing 同行 timers.
    if (timeStopped) {
      next.master.state.BASE[BASE_ID.TSP] = Math.max(
        0,
        (next.master.state.BASE[BASE_ID.TSP] ?? 0) - 10,
      );
    } else {
      advanceTimeTicks(next, 30);
    }
    const canBringAlong = !timeStopped;
    const atBase = atPlayerBase(next, 0);
    // Modern travel treats an accepted COM444 candidate as a real companion
    // wherever the contact happened. Upstream only filled 同行 inside
    // AT_HOME(MASTER), which made the outside-map candidate disappear as soon
    // as the next room was selected. Time-stop remains a contact-only branch
    // because ordinary movement is not available there.
    slot.state.CFLAG[CFLAG_ID.同行] = canBringAlong ? 180 : 0;
    slot.state.CFLAG[CFLAG_ID.延迟] = 30;
    slot.state.CFLAG[CFLAG_ID.拠点来訪] = canBringAlong && atBase ? 1 : 0;
    // A following girl is synchronized by the companion scheduler, so a
    // successful outside-map acceptance must not retain a stale local-contact
    // room id. Time-stop still records the room as a temporary encounter.
    slot.state.CFLAG[CFLAG_ID.遭遇位置] = canBringAlong
      ? 0
      : (locationToRoomId(next.master.location) ?? 0);
    if (canBringAlong) next.master.state.CFLAG[CFLAG_ID.同行] = 180;
    return {
      state: next,
      events: [{
        kind: "NARRATION",
        timestamp: ctx.now(),
        text: canBringAlong
          ? `${slot.callName ?? "那个女孩"}接受了邀请，暂时和你一起行动。`
          : `${slot.callName ?? "那个女孩"}只是在这里和你短暂接触，不能跟你一起离开。`,
      }],
      outcome: "ok",
      kojoHandled: true,
    };
  },
};
