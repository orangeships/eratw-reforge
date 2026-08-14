/**
 * Parity QA P-1 — Act_COM 过滤器 (faithful command-grid filter toggles).
 *
 * eraTW's command panel (`@SHOW_USERCOM`) is a SINGLE Act_COM grid plus a
 * row of filter toggles (`@过滤器表示`, `OPTION_COM_FILTER.ERB:71`), NOT a
 * set of parallel family groups. Each toggle is "on by default"; turning
 * one OFF subtracts that command class from the grid (`@QUICKFILTER`,
 * `OPTION_COM_FILTER.ERB:17-40` — a command is hidden iff it belongs to a
 * class whose filter is off).
 *
 * The filter state is per-TARGET CFLAG (Ｖ過濾器=591 … allowKojoCom=599),
 * except 家事 which is a GLOBAL FLAG (1055). This module is the runtime-side
 * authority: it owns the faithful `@QUICKFILTER` predicate and the CFLAG/FLAG
 * read/write, exposed namespace-free so the UI layer (forbidden from spelling
 * `CFLAG`) can drive the toggles. The command→class mapping itself stays
 * UI-side (the `command-tags.bundle.json` the menu already imports — same
 * `COM_TAGS_CHECK` bit data — plus the KOJO/自慰 ranges); the UI passes the
 * resolved class in.
 */

import type { GameState } from "../state/game-state.js";
import { CFLAG_ID, FLAG_ID } from "../state/settlement.js";

/**
 * The faithful filter classes (`@QUICKFILTER` checks, in upstream order).
 * `vagina/anal/service/sm` are the SEX filters (only shown in うふふ);
 * `sekuhara/kaji/kojo` are everyday. `null` = a command in no filtered
 * class → always shown.
 */
export type ComFilterClass =
  | "vagina"
  | "anal"
  | "service"
  | "sm"
  | "sekuhara"
  | "kaji"
  | "kojo";

/** Filter definition: its class, the CFLAG/FLAG id holding its on/off state,
 *  whether that id is per-target (CFLAG) or global (FLAG), the toggle's
 *  command id (the upstream PRINTBUTTON id), its label, and whether it only
 *  shows during うふふ (the SEX filters). */
export interface ComFilterDef {
  cls: ComFilterClass;
  /** CFLAG id (per-target) or FLAG id (global) holding the on/off state. */
  stateId: number;
  /** true → state lives in the target's CFLAG; false → global flagStore. */
  perTarget: boolean;
  /** The upstream PRINTBUTTON command id for this toggle. */
  toggleId: number;
  /** Player-facing toggle label. */
  label: string;
  /** Only shown in the filter row during うふふ (ShowSex). */
  sexOnly: boolean;
}

/**
 * The filter row, in upstream display order (`@过滤器表示`:84-99):
 * [Ｖ][Ａ][ＳＭ][侍奉] (sex-only) then [性骚扰][家务][剧本]. The toggle ids
 * match the upstream PRINTBUTTON_EX calls (831/832/836/835/837/839/840).
 */
export const COM_FILTERS: ReadonlyArray<ComFilterDef> = [
  { cls: "vagina",   stateId: CFLAG_ID.Ｖ過濾器,     perTarget: true,  toggleId: 831, label: "Ｖ",     sexOnly: true },
  { cls: "anal",     stateId: CFLAG_ID.Ａ過濾器,     perTarget: true,  toggleId: 832, label: "Ａ",     sexOnly: true },
  { cls: "sm",       stateId: CFLAG_ID.ＳＭ過濾器,   perTarget: true,  toggleId: 836, label: "ＳＭ",   sexOnly: true },
  { cls: "service",  stateId: CFLAG_ID.奉仕過濾器,   perTarget: true,  toggleId: 835, label: "侍奉",   sexOnly: true },
  { cls: "sekuhara", stateId: CFLAG_ID.性騷擾過濾器, perTarget: true,  toggleId: 837, label: "性骚扰", sexOnly: false },
  { cls: "kaji",     stateId: FLAG_ID.家事過濾器,    perTarget: false, toggleId: 839, label: "家务",   sexOnly: false },
  { cls: "kojo",     stateId: CFLAG_ID.allowKojoCom, perTarget: true,  toggleId: 840, label: "剧本",   sexOnly: false },
];

/** Lookup a filter def by its class. */
const FILTER_BY_CLASS = new Map<ComFilterClass, ComFilterDef>(
  COM_FILTERS.map((f) => [f.cls, f]),
);

/**
 * Read a filter's on/off state. eraTW treats the filter as "on" (commands
 * SHOWN) by default — the CFLAG/FLAG defaults to 0, which the upstream
 * `PRINTBUTTON_EX(..., !CFLAG:X)` renders as "not pressed = filter on". So
 * state value 0 → filter ON (shown), non-zero → filter OFF (hidden). We
 * mirror that exactly: `filterOn` returns true when the stored value is 0.
 *
 * `target <= 0` (no focused NPC) → per-target filters read as ON (a freshly
 * focused NPC has all filters on); global 家事 still reads its FLAG.
 */
export function filterOn(
  def: ComFilterDef,
  target: number,
  state: Readonly<GameState>,
): boolean {
  const raw = def.perTarget
    ? (target > 0 ? (state.charas[target]?.state.CFLAG[def.stateId] ?? 0) : 0)
    : (state.flagStore[def.stateId] ?? 0);
  return raw === 0;
}

/**
 * The faithful `@QUICKFILTER` predicate: is `cls` (the command's filter
 * class, or null) HIDDEN for `target` right now? A command is hidden iff it
 * belongs to a filtered class whose filter is OFF. A `null` class (no
 * filtered class) is never hidden.
 *
 * Note: the upstream `@QUICKFILTER` also handles the sekuhara-during-time-stop
 * special case (`!FLAG:70 || CFLAG:TARGET:344 == 1`) and `QUICKFILTER_UNIQUE`
 * (314/316 dual-class) — those are deferred (documented) until the relevant
 * states are modeled; the common path (class belongs to one filter) is exact.
 */
export function quickFilterHidden(
  cls: ComFilterClass | null,
  target: number,
  state: Readonly<GameState>,
): boolean {
  if (cls === null) return false;
  const def = FILTER_BY_CLASS.get(cls);
  if (!def) return false;
  return !filterOn(def, target, state);
}

/**
 * Toggle a filter's state (flip on↔off) for `target`, mutating `state` in
 * place. Namespace-free entry the UI uses when the player clicks a filter
 * button — writes the real per-target CFLAG (or global FLAG for 家事), so
 * the choice persists with the save like upstream. `target <= 0` no-ops a
 * per-target filter (no NPC to scope it to).
 */
export function toggleComFilter(
  toggleId: number,
  target: number,
  state: GameState,
): void {
  const def = COM_FILTERS.find((f) => f.toggleId === toggleId);
  if (!def) return;
  if (def.perTarget) {
    if (target <= 0) return;
    const slot = state.charas[target];
    if (!slot) return;
    const cur = slot.state.CFLAG[def.stateId] ?? 0;
    slot.state.CFLAG[def.stateId] = cur === 0 ? 1 : 0;
  } else {
    const cur = state.flagStore[def.stateId] ?? 0;
    state.flagStore[def.stateId] = cur === 0 ? 1 : 0;
  }
}
