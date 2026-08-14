/**
 * eraTW 异常气象副作用 — `DLC/WEATHERCHANGE.ERB::@WeatherBCg` 移植。
 *
 * 上游真实逻辑（`WEATHERCHANGE.ERB:151-179`）：
 *
 *   @WeatherBCg(ARG)
 *   ; ARG = 0..4 → 异常气象值 9..13
 *   ; bID = [11, 6, 0, 1, 0]
 *   ;   11=BASE:理性  6=BASE:精  0=BASE:体力  1=BASE:気力
 *   ; ARG=-1 → TIME:5==19 无风 → 恢复路径（×1.01）
 *   ; 每回合户外所有角色 BASE[i] -= MAX(1, BASE[i] - MAXBASE[i]/100)
 *
 * 完整副作用表（`WEATHERCONTROL.ERB:8-58`）：
 *
 *   異常気象=7   → 强风吹裙（不调 WeatherBCg，调用 PANTS_GETTING 拾取胖次）
 *   異常気象=8   → 桃色之风（不调 WeatherBCg，调用 PINK_WIND 增 CFLAG:积攒度 + TCVAR:発情）
 *   異常気象=9   → 台风（WeatherBCg(0) → 理性 -1）
 *   異常気象=10  → 暴风雪（WeatherBCg(1) → 精 -1，男性跳过）
 *   異常気象=11  → 钻石尘（不调 WeatherBCg，sleep recovery ×0.5）
 *   異常気象=12  → 黄沙（WeatherBCg(3) → 気力 -1）
 *   異常気象=13  → 烈日（WeatherBCg(4) → 体力 -1）
 *   異常気象=14  → 极光（WeatherBCg(5) → TSP -1）
 *   TIME:5==19  → 无风（WeatherBCg(-1) → TSP/体力恢复 ×1.01）
 *
 * 注意：
 * - 1-5（DLC 敏感增强）按 DLC off 路径不触发副作用（modern runtime 用 WEATHERDLC=0）
 * - MASTER 神性 / MAGIC_DLC_时间因子 在上游被豁免；modern runtime 不建模这两个 flag → 全员受影响（faithful 占位）
 * - "户外"判定 = `INROOM() == 0`，现代侧用 `placeFlagsOf(location) & 場所_屋内 == 0`
 *
 * 阶段 S1 实现：本体 BASE 写入 + 7/8/11 三个「不调 WeatherBCg」分支 stub。
 * Pantsu 拾取（7）和 PINK_WIND（8）走「外部事件」通道（ObservationEvent），
 * 由 UI 层调度 — 现代侧不执行胖次物品 / PALAM 系统，stub 返回空事件并
 * 标注 deferred。
 */

import type { GameState, CharaSlot } from "../state/game-state.js";
import { FLAG_ID, BASE_ID } from "../state/settlement.js";
import { inRoom } from "../world/location-predicates.js";

/**
 * 异常气象值（对齐 `天候システム.ERH:860-869`）。
 *
 * 对应原版 `FLAG:異常気象` 取值：
 * 0=无 / 1-5=DLC 敏感 / 6=裙子 / 7=胖次 / 8=桃色之风 /
 * 9=台风 / 10=暴风雪 / 11=钻石尘 / 12=黄沙 / 13=烈日 / 14=极光
 */
export const ABNORMAL_WEATHER = {
  NONE: 0,
  C_SENSITIVE: 1,
  V_SENSITIVE: 2,
  A_SENSITIVE: 3,
  B_SENSITIVE: 4,
  M_SENSITIVE: 5,
  SKIRT: 6,
  PANTSU: 7,
  PINK_WIND: 8,
  TYPHOON: 9,
  BLIZZARD: 10,
  DIAMOND_DUST: 11,
  SANDSTORM: 12,
  SCORCHING: 13,
  AURORA: 14,
} as const;

/** Map 異常気象 → WeatherBCg 的 bID 索引。`null` 表示「不调 WeatherBCg」。 */
const WEATHER_BCG_INDEX: Record<number, number | null> = {
  0: null,
  1: null, 2: null, 3: null, 4: null, 5: null, // DLC sensitive (DLC off)
  6: null, // 裙子
  7: null, // 胖次（外置拾取）
  8: null, // 桃色之风（外置 PALAM 写入）
  9: 0,    // 台风 → 理性
  10: 1,   // 暴风雪 → 精（男性跳过）
  11: null, // 钻石尘（sleep recovery ×0.5）
  12: 3,   // 黄沙 → 気力
  13: 4,   // 烈日 → 体力
  14: null, // 极光 → TSP（独立写入，不走 bID 表）
};

/** bID → BASE_ID 映射（`WEATHERCHANGE.ERB:153-161`）。
 *
 * Kept lazy because `settlement.ts` imports `clock.ts`, which imports this
 * weather module through `weather-system.ts`. Reading `BASE_ID` at module-load
 * time would hit the circular import before settlement has initialized. */
function baseOfBcgIndex(bcgIdx: number): number {
  switch (bcgIdx) {
    case 0: return BASE_ID.理性;
    case 1: return BASE_ID.精力;
    case 2: return BASE_ID.体力;
    case 3: return BASE_ID.気力;
    case 4: return BASE_ID.体力;
    default: return BASE_ID.体力;
  }
}

/* -------------------------------------------------------------- *
 * 公共 helper                                                     *
 * -------------------------------------------------------------- */

/**
 * 当前 `FLAG:異常気象` 值；未设置按 0。
 *
 * 调用者：消费者只需 `flagStore[FLAG_ID.異常気象] ?? 0`。
 */
export function currentAbnormal(state: GameState): number {
  return state.flagStore[FLAG_ID.異常気象] ?? 0;
}

/* -------------------------------------------------------------- *
 * 主入口：异常气象副作用 (≈ `@WEATHERCHANGESTAUS`)                *
 * -------------------------------------------------------------- */

/**
 * 异常气象副作用主入口 — 对一个角色施加当期异常气象效果。
 *
 * 上游 `@WEATHERCHANGESTAUS` (`WEATHERCHANGE.ERB:145-150`)：
 *   - 检查 `FLAG:異常気象 ∈ [9..13]` → 调 `@WeatherBCg(ARG)`
 *   - `FLAG:異常気象 == 14` (极光) 走独立 TSP 路径
 *   - `TIME:5 == 19` (无风) 走 ×1.01 恢复路径（独立分支）
 *
 * 现代 S1 实现：忠实 BASE 写入 + 户外判定 + 性别豁免（暴风雪）+ deferred 标注。
 *
 * @param chara   角色状态（含 BASE + MAXBASE + TALENT）
 * @param location 角色当前 location 字符串（用于户外判定）
 * @returns 实际扣减的 BASE dict（baseId → delta），用于测试断言
 */
export function applyAbnormalWeather(
  state: GameState,
  chara: CharaSlot,
  location: string,
): Record<number, number> {
  const abnormal = currentAbnormal(state);
  if (abnormal === 0) return {};

  const bcgIdx = WEATHER_BCG_INDEX[abnormal];
  const deltas: Record<number, number> = {};

  // 户外判定 — 忠实上游 `INROOM() == 0`（户外）。用权威 `inRoom`（读
  // place-flags 場所_屋内/洋室），取代早期占位的关键字启发（那版漏掉 私室/
  // 自室 等，把室内卧室误判成室外 → 恶劣天气会错误地扣室内角色 BASE）。
  const isOutdoor = inRoom(state, location) === 0;

  /* — 7 胖次：外置拾取事件 — */
  if (abnormal === ABNORMAL_WEATHER.PANTSU) {
    // 上游调 PANTS_GETTING → 现代侧不建模物品，deferred
    // 此分支不影响 BASE
    return deltas;
  }

  /* — 8 桃色之风：外置 PALAM 写入 — */
  if (abnormal === ABNORMAL_WEATHER.PINK_WIND) {
    // 上游调 PINK_WIND → CFLAG:积攒度 += LIMIT((10+RAND:60)*ABL:欲望, 200, 1000)
    // + TCVAR:発情 = 1（人形除外）
    // PALAM/ABL 系统未建模，deferred
    return deltas;
  }

  /* — 9..13：WeatherBCg BASE 写入 — */
  if (bcgIdx !== null && bcgIdx !== undefined && isOutdoor) {
    // 上游豁免：MASTER 神性 / MAGIC_DLC_时间因子 / 暴风雪男性跳过
    // 神性 = TALENT 神性 (id 未在 modern 枚举）→ 简化为无豁免（master 一律生效）
    // 暴风雪（abnormal==10, bcgIdx==1）男性跳过 = TALENT 男人 (id=140)
    if (abnormal === ABNORMAL_WEATHER.BLIZZARD && chara.state.TALENT?.[140]) {
      // 男性跳过暴风雪
      return deltas;
    }

    const baseId = baseOfBcgIndex(bcgIdx);
    const current = chara.state.BASE?.[baseId] ?? 0;
    const maxBase = chara.state.MAXBASE?.[baseId] ?? 0;
    // 上游 `WeatherBCg:159`: `SIF BASE >= 300*(1-!ARG)` — 即 BASE 必须 ≥ 300
    // （当 ARG≠0 时阈值=300；ARG=0 时阈值=0 即没有下限）才扣减。
    // ARG=0 是 bID[0]=理性 → 阈值 0；其他 bcgIdx=1,3,4 → 阈值 300。
    const threshold = bcgIdx === 0 ? 0 : 300;
    if (current < threshold) return deltas;
    // 上游：`BASE = MAX(1, BASE - MAXBASE/100)` — 扣 `maxBase/100` 点数
    const newBase = Math.max(1, current - Math.floor(maxBase / 100));
    const delta = newBase - current;

    if (!chara.state.BASE) chara.state.BASE = {} as Record<number, number>;
    chara.state.BASE[baseId] = newBase;
    deltas[baseId] = delta;
    return deltas;
  }

  /* — 14 极光：TSP 独立扣减（不上 bID 表） — */
  if (abnormal === ABNORMAL_WEATHER.AURORA && isOutdoor) {
    const tspId = BASE_ID.TSP;
    const current = chara.state.BASE?.[tspId] ?? 0;
    const maxBase = chara.state.MAXBASE?.[tspId] ?? 0;
    // 上游阈值 BASE:TSP >= 100
    if (current < 100) return deltas;
    const newBase = Math.max(0, current - Math.floor(maxBase / 100));
    const delta = newBase - current;
    if (delta !== 0 && chara.state.BASE) {
      chara.state.BASE[tspId] = newBase;
      deltas[tspId] = delta;
    }
    return deltas;
  }

  /* — TIME:5==19 无风：恢复路径（WeatherBCg(-1)） — */
  // 上游：BASE:TSP *= 1.01 + BASE:体力 *= 1.01（仅当体力 < MAX*4/5）
  // 注：此分支独立于 異常気象，由 S2 阶段 TIME:5 写入后调度
  // S1 暂不实现 → 留给 S7
  return deltas;
}

/* -------------------------------------------------------------- *
 * 钻石尘：sleep recovery 系数                                  *
 * -------------------------------------------------------------- */

/**
 * 钻石尘 (異常気象=11) 时睡眠体力恢复减半。
 *
 * 上游 `@CHECKWEATHERLISTINFO:183` 注释：入眠无法恢复体力。
 * 现代侧在 `finishPlayerSleep` 内调此 helper 决定是否 ×0.5。
 */
export function diamondDustRecoveryMultiplier(state: GameState): number {
  if (currentAbnormal(state) === ABNORMAL_WEATHER.DIAMOND_DUST) return 0.5;
  return 1.0;
}
