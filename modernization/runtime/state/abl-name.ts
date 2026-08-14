/** Display names for `ABL:n` (the upstream `ABLNAME:n` builtin). Mirrors
 *  eraTW's abl.als + the magicked translation table that the modern UI
 *  feeds to `ABL_TR`. Some entries are Chinese-friendly transcriptions of
 *  the Japanese-eraTW identifiers. */
import { ABL_ID } from "./settlement.js";

export const ABL_NAME: Readonly<Record<number, string>> = {
  [ABL_ID.Ｃ感覚]: "Ｃ感覚",
  [ABL_ID.Ｖ感覚]: "Ｖ感覚",
  [ABL_ID.Ａ感覚]: "Ａ感覚",
  [ABL_ID.Ｂ感覚]: "Ｂ感覚",
  [ABL_ID.Ｍ感覚]: "Ｍ感覚",
  [ABL_ID.親密]: "親密",
  [ABL_ID.従順]: "従順",
  [ABL_ID.欲望]: "欲望",
  [ABL_ID.技巧]: "技巧",
  [ABL_ID.奉仕精神]: "奉仕精神",
  [ABL_ID.露出癖]: "露出癖",
  [ABL_ID.受虐属性]: "受虐属性",
  [ABL_ID.施虐属性]: "施虐属性",
  [ABL_ID.百合属性]: "百合属性",
  [ABL_ID.断袖属性]: "断袖属性",
  [ABL_ID.自慰中毒]: "自慰中毒",
  [ABL_ID.精液中毒]: "精液中毒",
  [ABL_ID.百合中毒]: "百合中毒",
  [ABL_ID.断袖中毒]: "断袖中毒",
  [ABL_ID.膣射中毒]: "膣射中毒",
  [ABL_ID.肛射中毒]: "肛射中毒",
};

export function ablName(ablId: number): string {
  return ABL_NAME[ablId] ?? `ABL${ablId}`;
}

/**
 * `@PRINT_RANK(.., "MAX_99")` (ERB `COMMON.ERB:2092-2114`) — 10-grade tier
 * ladder for non-skill ABLs. Returns a rank 0..9 (0 = best, 9 = worst);
 * 10 grade names mapped to PRINT_RANK are "Ex / SS / S / A / B / C / D /
 * E / F / G". Faithful to the upstream `CASE IS >=` ladder.
 */
export function ablRankMax99(value: number): number {
  if (value >= 99) return 0;
  if (value >= 75) return 1;
  if (value >= 50) return 2;
  if (value >= 20) return 3;
  if (value >= 10) return 4;
  if (value >= 5) return 5;
  if (value >= 3) return 6;
  if (value >= 2) return 7;
  if (value >= 1) return 8;
  return 9;
}

const RANK_LABELS: ReadonlyArray<string> = ["Ex", "SS", "S", "A", "B", "C", "D", "E", "F", "G"];

export function ablRankLabelMax99(value: number): string {
  return RANK_LABELS[Math.max(0, Math.min(9, ablRankMax99(value)))]!;
}
