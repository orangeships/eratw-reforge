/**
 * #13 原版开场流程 Slice 4 — ANATA 经验 data + normalize.
 *
 * Fresh-MASTER selectable 经验, faithful to `@CUSTOM_EXP_MENU` +
 * `@CUSTOM_選べない経験` (NEWGAME_CUSTOM.ERB:992-1071) in **non-debug**:
 *   - 永远排除 : 16/17 膣射/肛射, 58-65 時姦/睡眠/無自覚, 70-89 生活系,
 *                100-110 行為系
 *   - requires:"female"  : 51 百合, 1 Ｖ経験, 6 Ｖ絶頂, 12 噴乳,
 *                          20 Ｖ性交, 26 乳交, 54 Ｖ拡張, 57 子宮口開発
 *   - requires:"hasPenis": 29 挿入, 11 射精
 *
 * Names are transcribed from `CSV/Exp.csv`.
 *
 * The 5 preset values come from `@CUSTOM_EXP` (line 1022): 0/1/5/10/20/30 (with
 * the "中止" pseudo-chip clearing the pick). Non-debug `MAX_EXP = 30`.
 *
 * **Deferred:** TSP / debug 全开 / CSTR 履历 / 记念日 / 生活系 70-89 / 行為系
 * 100-110 / 肛射 17 膣射 16. 经验↔性格 交叉归一化：3b 性格+能力 normalize 已
 * 处理 处女==1→ABL Ｖ感覚=0；本切片顺手补 **经验 联动 normalize**
 * (`@CUSTOM_INIT:99-127` arms, 同 3b normalize 风格), 避免男体下 V经验 漏过。
 *
 * No upstream file mutation. No LLM. See `CLAUDE.md`.
 */

import {
  getMasterTalent,
  setMasterExp,
} from "../../../../modernization/runtime/state/settlement.js";
import type { GameState } from "../../../../modernization/runtime/state/index.js";

export interface AnataExp {
  id: number;
  name: string;
  requires?: "female" | "hasPenis";
}

/** Fresh-MASTER selectable 经验 (ids 0-69 减门控, 永远排除按上表). */
export const ANATA_EXP: AnataExp[] = [
  { id: 0, name: "Ｃ経験" },
  { id: 1, name: "Ｖ経験", requires: "female" },
  { id: 2, name: "Ａ経験" },
  { id: 3, name: "Ｂ経験" },
  { id: 4, name: "Ｍ経験" },
  { id: 5, name: "Ｃ絶頂経験" },
  { id: 6, name: "Ｖ絶頂経験", requires: "female" },
  { id: 7, name: "Ａ絶頂経験" },
  { id: 8, name: "Ｂ絶頂経験" },
  { id: 9, name: "Ｍ絶頂経験" },
  { id: 10, name: "絶頂経験" },
  { id: 11, name: "射精経験", requires: "hasPenis" },
  { id: 12, name: "噴乳経験", requires: "female" },
  { id: 13, name: "放尿経験" },
  { id: 14, name: "精液経験" },
  { id: 15, name: "精飲経験" },
  { id: 18, name: "被榨経験" },
  { id: 20, name: "Ｖ性交経験", requires: "female" },
  { id: 21, name: "Ａ性交経験" },
  { id: 22, name: "自慰経験" },
  { id: 23, name: "調教自慰経験" },
  { id: 24, name: "手淫経験" },
  { id: 25, name: "口淫経験" },
  { id: 26, name: "乳交経験", requires: "female" },
  { id: 27, name: "接吻経験" },
  { id: 28, name: "道具使用経験" },
  { id: 29, name: "挿入経験", requires: "hasPenis" },
  { id: 30, name: "足交経験" },
  { id: 40, name: "奉仕快楽経験" },
  { id: 41, name: "愛情経験" },
  { id: 42, name: "苦痛快楽経験" },
  { id: 43, name: "嗜虐快楽経験" },
  { id: 44, name: "露出快楽経験" },
  { id: 45, name: "放尿快楽経験" },
  { id: 50, name: "調教経験" },
  { id: 51, name: "百合経験", requires: "female" },
  { id: 52, name: "断袖経験" },
  { id: 53, name: "異常経験" },
  { id: 54, name: "Ｖ拡張経験", requires: "female" },
  { id: 55, name: "Ａ拡張経験" },
  { id: 56, name: "緊縛経験" },
  { id: 57, name: "子宮口開発経験", requires: "female" },
];

/** 选べない経験 gate: female(性別&1), hasPenis(性別&2). */
export function anataExpSelectable(exp: AnataExp, gender: 1 | 2 | 3): boolean {
  if (exp.requires === "female" && (gender & 1) === 0) return false;
  if (exp.requires === "hasPenis" && (gender & 2) === 0) return false;
  return true;
}

/** 经验 preset 值 (`@CUSTOM_EXP` line 1022: 0/1/5/10/20/30, 非 debug MAX=30). */
export const ANATA_EXP_PRESETS: number[] = [0, 1, 5, 10, 20, 30];

/** Remove the gated ids from `draftExp` that no longer match `gender`. */
export function filterDraftExpForGender(
  draftExp: Record<number, number>,
  gender: 1 | 2 | 3,
): Record<number, number> {
  const out: Record<number, number> = {};
  for (const exp of ANATA_EXP) {
    const v = draftExp[exp.id];
    if (v === undefined) continue;
    if (anataExpSelectable(exp, gender)) out[exp.id] = v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 经验 normalize — `@CUSTOM_INIT` (NEWGAME_CUSTOM.ERB:99-127) 经验 arms.
// 性别/性器门控下清除与体性器不兼容的经验. 顺序: 3b 性格+能力 normalize 之后
// 调, 避免重置 3b 已清的项.
// ---------------------------------------------------------------------------

/**
 * Apply `@CUSTOM_INIT` 经验 clearing rules to the master, after the
 * `normalizeMasterTalentByGender` has run. Faithful to NEWGAME_CUSTOM.ERB:99-127.
 */
export function normalizeMasterExpByGender(
  state: GameState,
  gender: 1 | 2 | 3,
): void {
  // 男体 (!(性別 & 1)) — 清 百合/噴乳/Ｖ系/乳交/Ｖ拡張/子宮口開発 (CUSTOM_INIT:110-120)
  if ((gender & 1) === 0) {
    setMasterExp(state, 51, 0); // 百合経験
    setMasterExp(state, 12, 0); // 噴乳経験
    setMasterExp(state, 1, 0); // Ｖ経験
    setMasterExp(state, 26, 0); // 乳交経験
    setMasterExp(state, 20, 0); // Ｖ性交経験
    setMasterExp(state, 54, 0); // Ｖ拡張経験
    setMasterExp(state, 57, 0); // 子宮口開発経験
  }
  // 女体 (性別 & 1) — 清 断袖経験 (CUSTOM_INIT:113-114)
  if ((gender & 1) !== 0) {
    setMasterExp(state, 52, 0); // 断袖経験
  }
  // 无男器 (!(性別 & 2)) — 清 射精/挿入 (CUSTOM_INIT:140-144, 镜像 3b 性格 arm)
  if ((gender & 2) === 0) {
    setMasterExp(state, 11, 0); // 射精経験
    setMasterExp(state, 29, 0); // 挿入経験
  }
  // 处女 == 1 → 清 Ｖ性交/Ｖ拡張/子宮口開発 (CUSTOM_INIT:147-156). The 性格
  // arm (3b) already cleared 処女 to 0 when 男体, so by the time we get here
  // 処女==1 only when 女体 selected 処女=1. Ｖ経験 also needs 0 — 男体 normalize
  // arm already set it; 女体 doesn't, so set it here too.
  if (getMasterTalent(state, 0) === 1) {
    setMasterExp(state, 1, 0); // Ｖ経験
    setMasterExp(state, 20, 0); // Ｖ性交経験
    setMasterExp(state, 54, 0); // Ｖ拡張経験
    setMasterExp(state, 57, 0); // 子宮口開発経験
  }
}
