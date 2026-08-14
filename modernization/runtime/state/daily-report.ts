/**
 * Night-settlement daily report — faithful to eraTW's per-command result
 * display, aggregated to one end-of-day summary.
 *
 * eraTW prints each training command's outcome inline as it resolves:
 * `好感度＋{N}` / `好感度－{N}` (`TRACHECK_好感度上昇処理.ERB:426`), ability
 * level-ups (`ABLUP.ERB`), 経験 gains, etc. The modern runtime strips those
 * numbers from the in-day narration (per the player's "don't show settlement
 * numbers mid-play" request) and instead surfaces them here: diff each NPC's
 * day-start snapshot (`daySnapshot`, captured at `openEyes`) against the live
 * state at sleep, and format the meaningful changes per NPC.
 *
 * Scope: the headline relational counters (好感度 CFLAG:2 / 信頼度 CFLAG:4 —
 * `named-stats.ts` RELATION_MAP), 能力 (ABL) level changes, and 経験 (EXP)
 * gains. Gauges that drift with time/recovery (体力/気力/情緒…) are excluded —
 * they are not "settlement results". No upstream file mutation. No LLM.
 */

import type { CharaSlot, CharaSlotState, DailySettlementEntry } from "./game-state.js";
import { ABL_ID, EXP_ID } from "./settlement.js";

/** Invert a named id map (name→id) into id→display-name (first name wins). */
function invert(map: Readonly<Record<string, number>>): Record<number, string> {
  const out: Record<number, string> = {};
  for (const [name, id] of Object.entries(map)) {
    if (out[id] === undefined) out[id] = name;
  }
  return out;
}

const ABL_LABEL = invert(ABL_ID);
const EXP_LABEL = invert(EXP_ID);

/**
 * Headline relational counters shown first. Faithful ids: 好感度 = CFLAG:2,
 * 信頼度 = CFLAG:4 (`named-stats.ts` RELATION_MAP) — the numbers eraTW prints
 * per command.
 */
const CFLAG_RELATION: ReadonlyArray<{ id: number; label: string }> = [
  { id: 2, label: "好感度" },
  { id: 4, label: "信頼度" },
];

function signed(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

/** Diff one NPC's snapshot → live state into change phrases. */
function diffChanges(prev: CharaSlotState, cur: CharaSlotState): string[] {
  const changes: string[] = [];

  // 好感度 / 信頼度 — open-ended CFLAG counters, the eraTW headline.
  for (const { id, label } of CFLAG_RELATION) {
    const d = (cur.CFLAG[id] ?? 0) - (prev.CFLAG[id] ?? 0);
    if (d !== 0) changes.push(`${label} ${signed(d)}`);
  }

  // 能力 (ABL) — level changes (eraTW ABLUP).
  const ablIds = new Set<number>([
    ...Object.keys(prev.ABL).map(Number),
    ...Object.keys(cur.ABL).map(Number),
  ]);
  for (const id of [...ablIds].sort((a, b) => a - b)) {
    const before = prev.ABL[id] ?? 0;
    const after = cur.ABL[id] ?? 0;
    if (before !== after) {
      changes.push(`${ABL_LABEL[id] ?? `能力${id}`} Lv ${before}→${after}`);
    }
  }

  // 経験 (EXP) — gains.
  const expIds = new Set<number>([
    ...Object.keys(prev.EXP).map(Number),
    ...Object.keys(cur.EXP).map(Number),
  ]);
  for (const id of [...expIds].sort((a, b) => a - b)) {
    const d = (cur.EXP[id] ?? 0) - (prev.EXP[id] ?? 0);
    if (d !== 0) changes.push(`${EXP_LABEL[id] ?? `経験${id}`} ${signed(d)}`);
  }

  return changes;
}

/**
 * Build the night-settlement report: for each NPC present both at day-start
 * (`snapshot`) and now (`charas`), the day's 好感度/信頼度/能力/経験 changes.
 * NPCs absent from the snapshot (appeared mid-day) are skipped — there is no
 * meaningful day-delta for them. NPCs with no change are omitted.
 */
export function buildDailySettlementReport(
  snapshot: Record<number, CharaSlotState>,
  charas: Record<number, CharaSlot>,
): DailySettlementEntry[] {
  const report: DailySettlementEntry[] = [];
  for (const [num, slot] of Object.entries(charas)) {
    const charaNum = Number(num);
    const prev = snapshot[charaNum];
    if (prev === undefined) continue;
    const changes = diffChanges(prev, slot.state);
    if (changes.length > 0) {
      report.push({ charaNum, name: slot.callName ?? `#${charaNum}`, changes });
    }
  }
  return report;
}
