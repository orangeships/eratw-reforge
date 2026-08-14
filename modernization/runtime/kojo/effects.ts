import { cloneGameState, type GameState } from "../state/index.js";
import type { KojoStagedEffect } from "./types.js";
import type { DialogueRouter, KojoLine } from "./types.js";
import type { Rng } from "../command/types.js";
import { getTflag, setTflag } from "../state/tflag.js";
import { ensureFishingGear } from "../state/fishing.js";
import { advanceTimeTicks, CFLAG_ID } from "../state/settlement.js";
import { roomIdToLocation, setSlotLocation } from "../world/room-id-location.js";

function memoryBucket(
  state: GameState,
  charaNum: number,
  memory: "FIRSTTIME" | "ONCE",
): Record<string, true> {
  state.kojoMemory ??= {};
  state.kojoMemory[charaNum] ??= { firstTime: {}, once: {} };
  return memory === "FIRSTTIME"
    ? state.kojoMemory[charaNum]!.firstTime
    : state.kojoMemory[charaNum]!.once;
}

function writeDirectEffect(state: GameState, effect: Exclude<KojoStagedEffect, { kind: "memory" | "display-name" | "fish-ledger" | "frame-double-message-bit" | "string-set" }>): void {
  const { target, value } = effect;
  if (target.ns === "FLAG") {
    const current = state.flagStore[target.id] ?? 0;
    state.flagStore[target.id] = applyOperation(current, effect.kind, value);
    return;
  }
  if (target.ns === "TFLAG") {
    setTflag(
      state,
      target.id,
      applyOperation(getTflag(state, target.id), effect.kind, value),
    );
    return;
  }
  if (target.ns === "MONEY") {
    if (target.id === 0) {
      state.money = applyOperation(state.money, effect.kind, value);
    } else if (target.id === 2) {
      state.casinoChips = applyOperation(state.casinoChips ?? 0, effect.kind, value);
    }
    return;
  }
  if (target.ns === "ITEM") {
    state.items ??= {};
    const current = state.items[target.id] ?? 0;
    state.items[target.id] = applyOperation(current, effect.kind, value);
    return;
  }

  if (target.ns === "TIME") {
    // TIME:0 is the global minute clock. Other TIME dimensions are weather
    // projections/derived reads and are intentionally not writable here.
    if (target.id !== 0 || effect.kind === "set-bit" || effect.kind === "clear-bit") return;
    if (effect.kind === "add") {
      advanceTimeTicks(state, value);
      return;
    }
    if (effect.kind === "set") {
      const desiredMinute = Math.max(0, Math.min(1439, Math.trunc(value)));
      const currentMinute = ((state.time.tickValue % 1440) + 1440) % 1440;
      const delta = desiredMinute - currentMinute;
      if (delta > 0) advanceTimeTicks(state, delta);
    }
    return;
  }

  if (target.ns === "DOWNBASE") {
    // DOWNBASE is an authored drain channel, not a persisted bag. Positive
    // values consume the selected BASE gauge and are floored at zero; this
    // is the same convention used by command settlement/free-action code.
    if (effect.kind !== "set" && effect.kind !== "add") return;
    const subject =
      typeof target.scope === "number"
        ? target.scope
        : target.scope === "MASTER"
          ? 0
          : undefined;
    if (subject === undefined) return;
    const slot = subject === 0 ? state.master : state.charas[subject];
    if (!slot) return;
    const current = slot.state.BASE[target.id] ?? 0;
    slot.state.BASE[target.id] = Math.max(0, current - value);
    return;
  }

  if (target.ns === "DIARY" || target.ns === "MAX_DIARY_PAGE" || target.ns === "PAGESET") {
    const subject =
      typeof target.scope === "number"
        ? target.scope
        : target.scope === "MASTER"
          ? 0
          : undefined;
    // Diary targets are resolved by the router before staging. Unknown or
    // dynamic subjects must not redirect a write to an arbitrary character.
    if (subject === undefined || subject < 0) return;
    if (target.ns === "DIARY") {
      if (target.id <= 0) return; // page 0 is an upstream sentinel
      state.diaryFlags ??= {};
      const flags = (state.diaryFlags[subject] ??= {});
      // The source occasionally contains an authored value outside the
      // documented 0..3 status set; preserve it for save fidelity instead of
      // silently clamping the imported value.
      (flags as Record<number, number>)[target.id] = applyOperation(
        (flags as Record<number, number>)[target.id] ?? 0,
        effect.kind,
        value,
      );
    } else if (target.ns === "MAX_DIARY_PAGE") {
      if (target.id !== 0) return;
      state.diaryMaxPage ??= {};
      state.diaryMaxPage[subject] = applyOperation(state.diaryMaxPage[subject] ?? 0, effect.kind, value);
    } else {
      if (target.id <= 0) return; // PAGESET slots are one-based
      state.diaryPageSet ??= {};
      const pageSet = (state.diaryPageSet[subject] ??= {});
      pageSet[target.id] = applyOperation(pageSet[target.id] ?? 0, effect.kind, value);
    }
    return;
  }

  if (target.ns === "SOURCE" || target.ns === "NOWEX") {
    const frame = state.turnContext?.frame;
    if (!frame) return;
    const subject =
      typeof target.scope === "number"
        ? target.scope
        : target.scope === "MASTER"
          ? 0
          : undefined;
    // TARGET should have been resolved by the router before staging. Never
    // redirect an unresolved frame write to an arbitrary character.
    if (subject === undefined) return;
    const byChara = target.ns === "SOURCE" ? frame.sourceByChara : frame.nowExByChara;
    const bag = (byChara[subject] ??= {});
    bag[target.id] = applyOperation(bag[target.id] ?? 0, effect.kind, value);
    return;
  }

  const subject =
    typeof target.scope === "number"
      ? target.scope
      : target.scope === "MASTER"
        ? 0
        : target.scope === "TARGET"
          ? undefined
          : undefined;
  // TARGET is resolved by the router before staging. A surviving TARGET scope
  // is malformed input and must not mutate an arbitrary slot.
  if (subject === undefined) return;
  const slot = subject === 0 ? state.master : state.charas[subject];
  if (!slot) return;
  const bag = slot.state[target.ns];
  const current = bag[target.id] ?? 0;
  const nextValue = applyOperation(current, effect.kind, value);
  bag[target.id] = nextValue;
  // CFLAG:現在位置 has a canonical string-location owner in the modern
  // state. Keep both representations synchronized when a direct kojo effect
  // writes a room id that the bridge knows, while leaving SUKIMA/unmapped
  // ids numeric instead of inventing a UI location.
  if (target.ns === "CFLAG" && target.id === CFLAG_ID.現在位置) {
    const location = roomIdToLocation(nextValue);
    if (location) setSlotLocation(slot, location);
  }
}

function writeStringEffect(state: GameState, effect: Extract<KojoStagedEffect, { kind: "string-set" }>): void {
  const subject = typeof effect.target.scope === "number"
    ? effect.target.scope
    : effect.target.scope === "MASTER"
      ? 0
      : null;
  if (effect.target.ns === "CSTR" && subject !== null && subject >= 0) {
    state.kojoStrings ??= {};
    state.kojoStrings.cstr ??= {};
    state.kojoStrings.cstr[subject] ??= {};
    state.kojoStrings.cstr[subject]![effect.target.id] = effect.value;
  } else if (effect.target.ns === "NICKNAME" && effect.target.scope === "GLOBAL") {
    state.kojoStrings ??= {};
    state.kojoStrings.nickname ??= {};
    state.kojoStrings.nickname[effect.target.id] = effect.value;
  }
}

function applyOperation(
  current: number,
  kind: Exclude<KojoStagedEffect["kind"], "memory" | "display-name" | "fish-ledger" | "frame-double-message-bit" | "string-set">,
  value: number,
): number {
  switch (kind) {
    case "set":
      return value;
    case "add":
      return current + value;
    case "or":
      return current | value;
    case "and":
      return current & value;
    case "multiply":
      return current * value;
    case "divide":
      return value === 0 ? current : Math.trunc(current / value);
    case "mod":
      return value === 0 ? current : current % value;
    case "set-bit":
      return current | (1 << value);
    case "clear-bit":
      return current & ~(1 << value);
    default:
      return current;
  }
}

/** Apply effects to a cloned state. This is the only public commit API for
 * staged authored-kojo effects; probes must use the resolver only. */
export function applyKojoEffects(
  state: Readonly<GameState>,
  effects: readonly KojoStagedEffect[],
): GameState {
  const next = cloneGameState(state as GameState);
  for (const effect of effects) {
    if (effect.kind === "memory") {
      memoryBucket(next, effect.charaNum, effect.memory)[effect.key] = true;
    } else if (effect.kind === "display-name") {
      next.displayNames ??= {};
      next.displayNames[effect.observer] ??= {};
      next.displayNames[effect.observer]![effect.subject] = effect.value;
    } else if (effect.kind === "fish-ledger") {
      const gear = ensureFishingGear(next);
      const bag = effect.field === "count" ? gear.catchCounts : gear.bestSizes;
      bag[effect.fishId] = effect.op === "add"
        ? (bag[effect.fishId] ?? 0) + effect.value
        : effect.value;
    } else if (effect.kind === "frame-double-message-bit") {
      // Frame-local dedup bit. The frame is recreated on every command by
      // `beginKojoExecutionFrame`, so the bit never survives a save/load
      // cycle and is reset between commands. Missing frame ⇒ producer
      // skipped `beginKojoExecutionFrame`; fail closed by ignoring the bit
      // rather than writing into the long-lived schema.
      const frame = next.turnContext?.frame;
      if (!frame) continue;
      const bag = (frame.doubleMessageBlockedByChara ??= {});
      bag[effect.target] = (bag[effect.target] ?? 0) | (1 << effect.bit);
    } else if (effect.kind === "string-set") {
      writeStringEffect(next, effect);
    } else {
      writeDirectEffect(next, effect);
    }
  }
  return next;
}

/** Authoritative EVENT-arm helper. It keeps legacy routers working while
 * committing staged effects exactly once for effect-aware routers. */
export function resolveEventKojoAndApply(
  router: DialogueRouter,
  state: GameState,
  charaNum: number,
  arm: number,
  rng: Rng,
  args: number[] = [],
): KojoLine[] {
  const detailed = router.resolveEventKojoDetailed?.(charaNum, arm, state, rng, args);
  if (!detailed) return router.resolveEventKojo(charaNum, arm, state, rng, args);
  if (detailed.status === "resolved" && detailed.effects.length > 0) {
    Object.assign(state, applyKojoEffects(state, detailed.effects));
  }
  return detailed.lines;
}

export function resolveDiaryKojoAndApply(
  router: Pick<DialogueRouter, "resolveDiaryKojo" | "resolveDiaryKojoDetailed">,
  state: GameState,
  charaNum: number,
  page: number,
  rng: Rng,
  args: number[] = [],
  mode?: string,
): KojoLine[] {
  const detailed = router.resolveDiaryKojoDetailed?.(charaNum, page, state, rng, args, mode);
  if (!detailed) return router.resolveDiaryKojo?.(charaNum, page, state, rng, args, mode) ?? [];
  if (detailed.status === "resolved" && detailed.effects.length > 0) {
    Object.assign(state, applyKojoEffects(state, detailed.effects));
  }
  return detailed.lines;
}
