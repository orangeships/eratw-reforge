/**
 * 体位 id → display name.
 *
 * `TEQUIP:体位` (touch component 10, `touch-state.ts`) stores a bare number and
 * the repo has no id→name table for it. The position-EXP ladder does carry
 * authoritative names, so the label is **derived** from
 * `H_POSITION_EXPERIENCE_TABLE` instead of hand-copying a second list that
 * could silently drift from it.
 *
 * Reserved slots (no upstream name) return `undefined` — callers must treat
 * that as unknown rather than inventing a name.
 */

import { H_POSITION_EXPERIENCE_TABLE } from "./h-position-experience.js";

/** `正常位Ｖ絶頂経験` / `小人飞机杯Ａ绝顶经验` → the pose name. Both the
 *  Japanese and simplified spellings appear in the table. */
const SLOT_SUFFIX = /[ＶＡ](絶頂経験|绝顶经验)$/;

const POSE_LABELS: Readonly<Record<number, string>> = Object.freeze((() => {
  const labels: Record<number, string> = {};
  for (const slot of Object.values(H_POSITION_EXPERIENCE_TABLE)) {
    if (slot.status !== "source-backed" || !slot.label) continue;
    const name = slot.label.replace(SLOT_SUFFIX, "");
    // A source-backed row whose label did not actually end in the expected
    // suffix would produce a meaningless name — refuse it rather than emit
    // half a name into a prompt.
    if (!name || name === slot.label) continue;
    labels[slot.pose] ??= name;
  }
  return labels;
})());

/** Display name for `TEQUIP:体位`, or `undefined` when upstream has no name. */
export function hPoseLabel(pose: number): string | undefined {
  if (!Number.isInteger(pose)) return undefined;
  return POSE_LABELS[pose];
}

/** Every pose id upstream actually names — used by tests to pin the table. */
export function knownHPoseIds(): readonly number[] {
  return Object.keys(POSE_LABELS).map(Number).sort((a, b) => a - b);
}
