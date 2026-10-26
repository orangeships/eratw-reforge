/**
 * 道具说明文 (item explanation) accessor — the modern `@ITEM_EXPLANATION`.
 *
 * Faithful to `ERB/アイテム解説.ERB:10-18`:
 *
 *     @ITEM_EXPLANATION(ARG)
 *     SIF EXISTMETH(@"ITEM_EXPLANATION_{ARG}") && STRLENS(GETMETHS(…))
 *         RETURNF GETMETHS(@"ITEM_EXPLANATION_{ARG}")
 *     SIF STRLENS(追加说明文:ARG)
 *         RETURNF 追加说明文:ARG
 *     RETURNF "??????"
 *
 * The per-id `@ITEM_EXPLANATION_<id>` functions are the only tier populated
 * upstream (186 of them in `ERB/魔改内容/qol/qol_info.ERB`); the
 * `追加说明文:<id>` string array is declared (`魔改内容/追加说明文.ERH`) but
 * left empty, so tier 2 is a documented no-op here. `"??????"` is the real
 * upstream fallback for an item with no authored 说明文 — {@link
 * itemExplanation} returns `null` for that case instead, letting each caller
 * decide whether to print the upstream placeholder or omit the line (the
 * 採集 result card omits it; a debug/道具 listing may want the marker).
 *
 * 15 of the 186 are **conditional**: the flavor text changes based on state,
 * which is how upstream models "you don't know what this is until someone
 * tells you". Both arms are carried in the bundle and evaluated here rather
 * than flattened at build time:
 *   - `intimacy-below` — `ABL:[[X]]:親密 < N`. Below the threshold you get the
 *     mystery text ("向知识丰富的魔法使打听一下吧"); at or above it, the text
 *     you learned from that character.
 *   - `education-at-least` — `ABL:MASTER:教養 >= N`. Only 666 发霉葡萄: an
 *     educated player recognizes 贵腐 grapes, everyone else sees mold.
 *
 * Data: `web/app/game/item-explanations.bundle.json` (build-item-explanations.ts)
 * injected via {@link setItemExplanations} — same seam as dish-menu / gifts /
 * talent-catalog. Uninjected ⇒ every lookup returns `null` (the runtime stays
 * functional, just without flavor text).
 */

import type { GameState } from "./game-state.js";
import { ABL_ID } from "./settlement.js";

/** The two predicate forms found upstream (see module doc). */
export type ItemExplanationCondition =
  | { kind: "intimacy-below"; charaNum: number; threshold: number }
  | { kind: "education-at-least"; threshold: number };

export interface ItemExplanationEntry {
  id: number;
  /** Shown when there is no condition, or when the condition is FALSE. */
  text: string;
  /** Shown when `condition` holds (the upstream `IF` arm). */
  conditionalText?: string;
  condition?: ItemExplanationCondition;
}

export interface ItemExplanationTable {
  /** id → entry, keyed as string (JSON-safe). */
  byId: Record<string, ItemExplanationEntry>;
}

let table: ItemExplanationTable = { byId: {} };

/** Inject the built explanation table (from `item-explanations.bundle.json`). */
export function setItemExplanations(t: ItemExplanationTable | null | undefined): void {
  table = t ?? { byId: {} };
}

export function itemExplanationsLoaded(): boolean {
  return Object.keys(table.byId).length > 0;
}

/**
 * Whether `condition` currently holds. A referenced chara who is absent from
 * the roster reads as 親密 0 — i.e. the mystery arm — matching eraBASIC's
 * `ABL:` default of 0 for an unloaded slot (you cannot have been told about
 * the item by someone who isn't in your game).
 */
function conditionHolds(state: Readonly<GameState>, condition: ItemExplanationCondition): boolean {
  if (condition.kind === "education-at-least") {
    return (state.master.state.ABL[ABL_ID.教養] ?? 0) >= condition.threshold;
  }
  const intimacy = state.charas[condition.charaNum]?.state.ABL[ABL_ID.親密] ?? 0;
  return intimacy < condition.threshold;
}

/**
 * The 说明文 for item `id` in the current state, or `null` when the item has
 * no authored explanation (upstream's `"??????"` case) or the table is not
 * injected. Pure — reads state, never writes.
 */
export function itemExplanation(state: Readonly<GameState>, id: number): string | null {
  const entry = table.byId[String(id)];
  if (entry === undefined) return null;
  if (entry.condition !== undefined && entry.conditionalText !== undefined) {
    return conditionHolds(state, entry.condition) ? entry.conditionalText : entry.text;
  }
  return entry.text;
}
