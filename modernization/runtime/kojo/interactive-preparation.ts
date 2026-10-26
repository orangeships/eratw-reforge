import type { GameState } from "../state/game-state.js";
import type { FuncLocation, KojoCommandIndex } from "./types.js";
import { resolveActiveKojoVariantCode } from "./variant-selection.js";

export interface InteractiveKojoTarget {
  charaNum: number;
  commandNos: readonly number[];
}

export interface InteractiveKojoPreparation {
  key: string;
  charaNum: number;
  variantCode: string;
  location: FuncLocation;
  expandSameFileStaticCalls?: boolean;
}

/** Preparation is speculative: bound the work and never evaluate a node. */
export const MAX_INTERACTIVE_COMMANDS_PER_CHARACTER = 24;
export const MAX_INTERACTIVE_PREPARATIONS = 96;

export function collectInteractiveKojoPreparations(
  index: Readonly<KojoCommandIndex>,
  state: Readonly<GameState>,
  targets: readonly InteractiveKojoTarget[],
  options: { commandOnly?: boolean } = {},
): InteractiveKojoPreparation[] {
  const byCharacter: InteractiveKojoPreparation[][] = [];
  const seen = new Set<string>();
  for (const { charaNum, commandNos } of targets) {
    if (!Number.isInteger(charaNum) || charaNum <= 0 || state.disabledKojo?.[charaNum]) continue;
    const variants = index.variants[charaNum] ?? [];
    const variantCode = resolveActiveKojoVariantCode(
      state, charaNum, variants.map((variant) => variant.variantCode), "",
    );
    const variant = variants.find((candidate) => candidate.variantCode === variantCode);
    if (!variant) continue;
    const tasks: InteractiveKojoPreparation[] = [];
    const add = (key: string, location?: FuncLocation, expandSameFileStaticCalls = false): void => {
      if (!location || seen.has(key)) return;
      seen.add(key);
      tasks.push({ key, charaNum, variantCode, location, expandSameFileStaticCalls });
    };
    if (!options.commandOnly) {
      add(`ENCOUNTER:${charaNum}:${variantCode}`, variant.encounter, true);
      add(`ROOM_DESCRIPTION:${charaNum}:${variantCode}`, variant.roomDescription);
      add(`EVENT_ARM:${charaNum}:${variantCode}:1`, variant.events?.["EVENT:1"]);
      add(`${charaNum}:${variantCode}:CATCHALL:0`, variant.catchAll);
    }
    // Conversation first, then the runtime's currently usable commands.
    const commands = [...new Set(commandNos)]
      .filter((command) => Number.isInteger(command) && command >= 0)
      .filter((command) => ["COM", "SCOM", "CUSTOM_COM", "CUSTOM_SCOM"]
        .some((kind) => variant.commands[`${kind}:${command}`]))
      .sort((left, right) => (left === 300 ? -1 : right === 300 ? 1 : left - right))
      .slice(0, MAX_INTERACTIVE_COMMANDS_PER_CHARACTER);
    for (const command of commands) {
      for (const kind of ["COM", "SCOM"] as const) {
        add(`${charaNum}:${variantCode}:${kind}:${command}`,
          variant.commands[`${kind}:${command}`] ?? variant.commands[`CUSTOM_${kind}:${command}`]);
      }
    }
    if (options.commandOnly) add(`${charaNum}:${variantCode}:CATCHALL:0`, variant.catchAll);
    byCharacter.push(tasks);
  }
  // Foreground targets are ordered explicitly: finish both COM and SCOM for
  // the clicked target before spending the budget on other participants.
  if (options.commandOnly) return byCharacter.flat().slice(0, MAX_INTERACTIVE_PREPARATIONS);
  // Round-robin prevents a prolific author from consuming the whole room budget.
  const result: InteractiveKojoPreparation[] = [];
  for (let offset = 0; result.length < MAX_INTERACTIVE_PREPARATIONS; offset += 1) {
    let added = false;
    for (const tasks of byCharacter) {
      const task = tasks[offset];
      if (!task) continue;
      result.push(task);
      added = true;
      if (result.length === MAX_INTERACTIVE_PREPARATIONS) break;
    }
    if (!added) break;
  }
  return result;
}

export interface InteractiveKojoPreparationOptions {
  signal?: AbortSignal;
  /** A foreground click must not evict the room's speculative preparation. */
  retainPrepared?: boolean;
  /** Only the selected command, its derived route and catch-all. */
  commandOnly?: boolean;
  /** One task boundary before each parse; callers can supply an idle scheduler. */
  yieldControl?: () => Promise<void>;
}

export function yieldForKojoPreparation(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
