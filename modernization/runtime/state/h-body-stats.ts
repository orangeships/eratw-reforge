/**
 * H 阶段 per-target 身体状态 accessor — 给 UI（GameStatusBar 的 HBodyStats）用。
 *
 * 对齐 `chara-info-state` 的"runtime 建类型化 info 对象、UI 只读"模式：
 * UI 不直接碰 `state.EX/CFLAG/BASE` 命名空间（namespace-free guard），
 * 只消费本函数返回的字段。
 *
 * 上游锚点：
 *   - 体内精液量 膣内/肛内  → `INFO.ERB:2138-2141 @INFO_STATUS` 读 `EX:精液残量/アナル精液残量`
 *   - 充填率              → `@充填率`（body-fill-rate.ts 已实现）
 *   - 勃起标签            → `INFO.ERB:2117-2127`（通常/石更/梆硬/Erection!!）
 *   - 生理状态            → `CYCLE.ERB:65-111 @NEW_CYCLE_PRINT`（怀孕/已受精/发情中/estrusCategory）
 *   - 欲求/高潮余韵/寸止  → `@INFO_GAUGEGROUP` / `@INFO_EMOTION`
 */

import type { CharaSlotState } from "./game-state.js";
import { bodyFillRate } from "./body-fill-rate.js";
import {
  BASE_ID,
  CFLAG_ID,
  EX_ID,
  TALENT_ID,
  TCVAR_ID,
} from "./settlement.js";
import { estrusCategory } from "./estrus-cycle.js";

export interface HBodyStats {
  /** 膣内精液量（当前残留，`EX:精液残量`）。 */
  vaginalSemen: number;
  /** 肛内精液量（当前残留，`EX:アナル精液残量`）。 */
  analSemen: number;
  /** 子宫内精液量（`EX:子宮内精液`）。 */
  uterineSemen: number;
  /** 充填率 各部位（bodyFillRate 返回 null = 体型无容量档）。 */
  fillV: number | null;
  fillA: number | null;
  fillTotal: number | null;
  erection: number;
  erectionMax: number;
  erectionLabel: string;
  hasPenis: boolean;
  /** 射精槽（`BASE:射精` / `MAXBASE`），hasPenis 时才渲染。 */
  ejaculate: number;
  ejaculateMax: number;
  /** 欲求不满度（`CFLAG:溜まってる度`）。原版显示 `欲求：{/10}％`。 */
  frustration: number;
  /** 高潮余韵（`BASE:絶頂余韻`）。 */
  afterglow: number;
  /** 寸止め 各部位计数（`EX:Ｃ/Ｖ/Ａ/Ｂ/Ｍ寸止め`）。 */
  chiburi: Record<"Ｃ" | "Ｖ" | "Ａ" | "Ｂ" | "Ｍ", number>;
  /** 生理状态标签：怀孕 / 已受精 / 发情中 / estrusCategory。 */
  estrusLabel: string;
  inHeat: boolean;
}

export function getHBodyStats(state: CharaSlotState): HBodyStats {
  const erection = state.BASE[BASE_ID.勃起] ?? 0;
  const erectionMax = state.MAXBASE?.[BASE_ID.勃起] ?? 0;
  let erectionLabel = "通常";
  if (erectionMax > 0 && erection >= erectionMax) erectionLabel = "Erection!!";
  else if (erection >= 1000) erectionLabel = "梆硬";
  else if (erection >= 500) erectionLabel = "石更";

  const pregnant = (state.TALENT[TALENT_ID.妊娠] ?? 0) > 0;
  const conceived = (state.CFLAG[CFLAG_ID.妊娠経過日数] ?? 0) > 0;
  const inHeat = (state.TCVAR[TCVAR_ID.発情] ?? 0) !== 0;
  let estrusLabel: string;
  if (pregnant) estrusLabel = "怀孕";
  else if (conceived) estrusLabel = "已受精";
  else if (inHeat) estrusLabel = "发情中";
  else estrusLabel = estrusCategory(state.CFLAG[CFLAG_ID.生理周期] ?? 0);

  return {
    vaginalSemen: state.EX[EX_ID.精液残量] ?? 0,
    analSemen: state.EX[EX_ID.アナル精液残量] ?? 0,
    uterineSemen: state.EX[EX_ID.子宮内精液] ?? 0,
    fillV: bodyFillRate(state, 1),
    fillA: bodyFillRate(state, 2),
    fillTotal: bodyFillRate(state, 3),
    erection,
    erectionMax,
    erectionLabel,
    hasPenis: ((state.TALENT[TALENT_ID.性別] ?? 0) & 2) !== 0,
    ejaculate: state.BASE[BASE_ID.射精] ?? 0,
    ejaculateMax: state.MAXBASE?.[BASE_ID.射精] ?? 0,
    frustration: state.CFLAG[CFLAG_ID.溜まってる度] ?? 0,
    afterglow: state.BASE[BASE_ID.絶頂余韻] ?? 0,
    chiburi: {
      "Ｃ": state.EX[EX_ID.Ｃ寸止め] ?? 0,
      "Ｖ": state.EX[EX_ID.Ｖ寸止め] ?? 0,
      "Ａ": state.EX[EX_ID.Ａ寸止め] ?? 0,
      "Ｂ": state.EX[EX_ID.Ｂ寸止め] ?? 0,
      "Ｍ": state.EX[EX_ID.Ｍ寸止め] ?? 0,
    },
    estrusLabel,
    inHeat,
  };
}
