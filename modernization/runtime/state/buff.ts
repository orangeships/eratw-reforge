/**
 * P1-#5 Slice A — `BUFF_RESET` (COMMON.ERB:765-776) + `BUFF_BASE` (COMMON.ERB:719-758).
 *
 * eraTW BUFF namespace: 16 slots per chara, each holds a temporary
 * `MAXBASE/BASE` modifier applied by `@BUFF_BASE` (e.g. magic-DLC buffs
 * raising 法力 +200 for N turns). `@BUFF_RESET` walks every chara's
 * 16-slot BUFF and subtracts the held value from both MAXBASE (cap)
 * and BASE (current), then zeros the BUFF slot.
 *
 * In the modern runtime the BUFF namespace is currently empty —
 * `@BUFF_BASE` is only called by the magic-DLC subsystem (DLC) and
 * the QOL_TEMP buff table (deferred). BUFF_RESET therefore currently
 * becomes a clean no-op (the BUFF map is empty, the inner `SIF ==
 * 0` short-circuits). The function is real and faithful so a future
 * `@BUFF_BASE` writer (DLC port) drops in without changes here.
 *
 * **`@BUFF_BASE` (COMMON.ERB:719-758)** — adds `変動値` to
 * `BUFF:ARG:強化能力` and to the live `MAXBASE:ARG:強化能力` and
 * `BASE:ARG:強化能力`. Defer to the DLC port. Modeled here as a
 * documented stub so the API is wired.
 */

import type { CharaSlot, GameState } from "./game-state.js";

/** 16-slot BUFF namespace, per upstream `Buff.als` / COMMON.ERB:765. */
const BUFF_SLOT_COUNT = 16;

/**
 * Faithful port of `@BUFF_RESET` (COMMON.ERB:765-776). Iterates every
 * chara's BUFF map; for each non-zero BUFF slot, subtracts the held
 * value from MAXBASE and BASE (clamped at 0), then zeros the BUFF slot.
 *
 * In a clean modern trial every BUFF map is empty and this is a no-op.
 * When a future `@BUFF_BASE` writer lands (DLC magic-system), it
 * becomes a real cap-and-current decrement.
 */
export function resetBuff(state: GameState): void {
  for (const slot of allSlots(state)) {
    const buff = slot.state.BUFF;
    let mutated = false;
    for (let i = 0; i < BUFF_SLOT_COUNT; i += 1) {
      const delta = buff[i] ?? 0;
      if (delta === 0) continue;
      const cap = slot.state.MAXBASE[i] ?? 0;
      const cur = slot.state.BASE[i] ?? 0;
      slot.state.MAXBASE[i] = Math.max(0, cap - delta);
      slot.state.BASE[i] = Math.max(0, cur - delta);
      delete buff[i];
      mutated = true;
    }
    // Touch the namespace to make the diff observable in tests.
    if (mutated) slot.state.BUFF = { ...buff };
  }
}

/**
 * Faithful port of `@BUFF_BASE` (COMMON.ERB:719-758). Adds `delta` to
 * BUFF:ARG:強化能力 and to the live MAXBASE/BASE on the chara.
 *
 * **Defer**: this helper has no consumer in the modern runtime yet
 * (only the magic-DLC and QOL_TEMP subsystems call it, both deferred).
 * Implemented faithfully so the magic-DLC port drops in without
 * touching the BUFF infrastructure.
 */
export function buffBase(
  slot: CharaSlot,
  stat: number,
  delta: number,
): void {
  slot.state.BUFF[stat] = (slot.state.BUFF[stat] ?? 0) + delta;
  slot.state.MAXBASE[stat] = (slot.state.MAXBASE[stat] ?? 0) + delta;
  slot.state.BASE[stat] = (slot.state.BASE[stat] ?? 0) + delta;
}

function allSlots(state: GameState): CharaSlot[] {
  const out: CharaSlot[] = [state.master];
  for (const slot of Object.values(state.charas)) {
    out.push(slot);
  }
  return out;
}
