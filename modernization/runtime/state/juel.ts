/**
 * 宝珠 (JUEL) demand tables + `@JUEL_UP_SPECIAL` — night-flow jewel bank.
 *
 * Upstream anchors:
 *   - `@JUEL_UP_SPECIAL(ARG,増やす珠,参照能力,PERCENTAGE,表示,PATTERN)`
 *     (`ステータス計算関連/ABL/ABLUP.ERB:218-302`): grants
 *     `MAX(demand * PERCENTAGE / 100, PERCENTAGE)` of one jewel, where
 *     `demand` = that jewel's requirement for the referenced ABL's next
 *     level (`JUEL_DEMAND_x(PATTERN=0, jewelId, chara)`), with the 感度
 *     `(2+感度)/2` multiplier for the 感覚 ABLs.
 *   - `@JUEL_DEMAND_N` (pattern-0/1/2/3) + `@EXP_DEMAND_N`
 *     (`ABL_UP_DATA.ERB`) — every ABL's demand table. The full set is
 *     ported for the auto-level-up loop (`SHOW_ABLUP_SELECT`, slice C2).
 *
 * Conventions: era `/` truncates (`Math.trunc`), `TIMES x, f` =
 * `trunc(x * f)`. `ABLDLC` (DLC saved global that discounts the 感覚
 * bases) is 0 while the DLC layer is dormant — the `*(100-0)/100` term
 * is identity and is not modeled.
 */

import type { CharaSlotState } from "./game-state.js";
import {
  ABL_ID,
  CFLAG_ID,
  EXP_ID,
  FLAG_ID,
  PALAM_ID,
  TALENT_ID,
  expLevel,
} from "./settlement.js";

const trunc = Math.trunc;

/** `TIMES x, f` — Emuera decimal multiply, truncated toward zero. */
function times(x: number, f: number): number {
  return trunc(x * f);
}

function abl(st: CharaSlotState, id: number): number {
  return st.ABL[id] ?? 0;
}
function exp(st: CharaSlotState, id: number): number {
  return st.EXP[id] ?? 0;
}
function talent(st: CharaSlotState, id: number): number {
  return st.TALENT[id] ?? 0;
}

/** JUEL accessor — tolerates saves written before the JUEL namespace. */
export function juelOf(st: CharaSlotState, juelId: number): number {
  return st.JUEL?.[juelId] ?? 0;
}

export function juelAdd(st: CharaSlotState, juelId: number, amount: number): void {
  const bank = (st.JUEL ??= {});
  bank[juelId] = (bank[juelId] ?? 0) + amount;
}

/** `一線越えない` demand multiplier: ×2.00 before 恋慕, ×`fallen` after
 *  (0.50 for most tables; 自慰中毒 uses 0.40). */
function lineNotCrossed(st: CharaSlotState, v: number, fallenFactor: number): number {
  if (talent(st, TALENT_ID.一線越えない) === 0) return v;
  return talent(st, TALENT_ID.恋慕) === 0 ? times(v, 2.0) : times(v, fallenFactor);
}

/** The Ｖ/Ａ拡張経験 discount ladder (`ABL_UP_DATA.ERB:204-216` etc.). */
function expansionDiscount(v: number, expansion: number): number {
  if (expansion > 50) return times(v, 0.5);
  if (expansion > 40) return times(v, 0.6);
  if (expansion > 30) return times(v, 0.7);
  if (expansion > 20) return times(v, 0.8);
  if (expansion > 10) return times(v, 0.9);
  if (expansion > 0) return times(v, 0.95);
  return v;
}

/**
 * Generic ABL→level→local-juel-array base ladder helper for the level
 * tables that share the `[1, lv1, lv2, …, lv9, formula]` shape (most of
 * them). Returns `null` when the level is not 0..9 and a custom formula
 * should be used (`upperLimit` is the per-table `>=10` multiplier
 * pattern in `(level - offset)`).
 */
function lookupLadder(
  level: number,
  table: readonly number[],
  upperOffset = 6,
  upperMul = 20000,
): number | null {
  if (level >= 0 && level < table.length) return table[level]!;
  return upperMul * (level - upperOffset);
}

/**
 * Pattern-0 jewel demand for one (ABL, jewel) pair — the ported
 * `@JUEL_DEMAND_*` (pattern-0/1/2/3) tables from
 * `ABL_UP_DATA.ERB`. Returns the demand for `juelId` (0 when that table
 * does not price this jewel), or a negative sentinel (-1 unsupported
 * pattern / -2 gate failure) exactly like upstream; `juelUpSpecial`
 * folds negatives through its MAX floor. `flags` is the global flagStore
 * (FLAG:抱負 discount).
 */
export function juelDemandPattern0(
  st: CharaSlotState,
  isMaster: boolean,
  ablId: number,
  juelId: number,
  flags: Readonly<Record<number, number>> = {},
): number {
  // ─── 感覚 family ──────────────────────────────────────────────
  if (ablId === ABL_ID.Ｃ感覚) {
    if (juelId !== PALAM_ID.快Ｃ) return 0;
    let v = lookupLadder(abl(st, ABL_ID.Ｃ感覚), SENSE_BASE_LEVEL0_4_V20, 6, 20000) ?? 0;
    // 経験補正 (no MASTER guard for Ｃ; faithful to JUEL_DEMAND_0).
    v = trunc((v * 10) / (5 + expLevel(exp(st, EXP_ID.Ｃ経験), 8)));
    v = trunc((v * (1 + abl(st, ABL_ID.Ｃ感覚))) / (1 + expLevel(exp(st, EXP_ID.Ｃ絶頂経験), 8)));
    v = lineNotCrossed(st, v, 0.5);
    if (isMaster) v *= abl(st, ABL_ID.Ｃ感覚) + 1;
    return v;
  }
  if (ablId === ABL_ID.Ｖ感覚) {
    if (juelId !== PALAM_ID.快Ｖ) return 0;
    let v = lookupLadder(abl(st, ABL_ID.Ｖ感覚), SENSE_BASE_LEVEL0_4_V20, 6, 20000) ?? 0;
    v = expansionDiscount(v, exp(st, EXP_ID.Ｖ拡張経験));
    if (!isMaster) {
      v = trunc((v * 10) / (5 + expLevel(exp(st, EXP_ID.Ｖ経験), 8)));
      v = trunc((v * (1 + abl(st, ABL_ID.Ｖ感覚))) / (1 + expLevel(exp(st, EXP_ID.Ｖ絶頂経験), 8)));
    }
    v = lineNotCrossed(st, v, 0.5);
    if (isMaster) v *= abl(st, ABL_ID.Ｖ感覚) + 1;
    return v;
  }
  if (ablId === ABL_ID.Ａ感覚) {
    if (juelId !== PALAM_ID.快Ａ) return 0;
    let v = lookupLadder(abl(st, ABL_ID.Ａ感覚), SENSE_BASE_LEVEL0_4_V50, 6, 20000) ?? 0;
    v = expansionDiscount(v, exp(st, EXP_ID.Ａ拡張経験));
    if (!isMaster) {
      v = trunc((v * 10) / (5 + expLevel(exp(st, EXP_ID.Ａ経験), 8)));
      v = trunc((v * (1 + abl(st, ABL_ID.Ａ感覚))) / (1 + expLevel(exp(st, EXP_ID.Ａ絶頂経験), 8)));
    }
    v = lineNotCrossed(st, v, 0.5);
    if (isMaster) v *= abl(st, ABL_ID.Ａ感覚) + 1;
    return v;
  }
  if (ablId === ABL_ID.Ｂ感覚) {
    if (juelId !== PALAM_ID.快Ｂ) return 0;
    let v = lookupLadder(abl(st, ABL_ID.Ｂ感覚), SENSE_BASE_LEVEL0_4_V20, 6, 20000) ?? 0;
    if (!isMaster) {
      v = trunc((v * 10) / (5 + expLevel(exp(st, EXP_ID.Ｂ経験), 8)));
      v = trunc((v * (1 + abl(st, ABL_ID.Ｂ感覚))) / (1 + expLevel(exp(st, EXP_ID.Ｂ絶頂経験), 8)));
    }
    v = lineNotCrossed(st, v, 0.5);
    if (isMaster) v *= abl(st, ABL_ID.Ｂ感覚) + 1;
    return v;
  }
  if (ablId === ABL_ID.Ｍ感覚) {
    if (juelId !== PALAM_ID.快Ｍ) return 0;
    let v = lookupLadder(abl(st, ABL_ID.Ｍ感覚), SENSE_BASE_LEVEL0_4_V20, 6, 20000) ?? 0;
    if (!isMaster) {
      v = trunc((v * 10) / (5 + expLevel(exp(st, EXP_ID.Ｍ経験), 8)));
      v = trunc((v * (1 + abl(st, ABL_ID.Ｍ感覚))) / (1 + expLevel(exp(st, EXP_ID.Ｍ絶頂経験), 8)));
    }
    v = lineNotCrossed(st, v, 0.5);
    if (isMaster) v *= abl(st, ABL_ID.Ｍ感覚) + 1;
    return v;
  }

  // ─── 親密 (abl 9) ─────────────────────────────────────────────
  if (ablId === ABL_ID.親密) {
    // Magic-DLC ladder is dormant: take the non-DLC branch only.
    let v = lookupLadder(abl(st, ABL_ID.親密), INTIMACY_NON_DLC, 7, 100000) ?? 0;
    v = lineNotCrossed(st, v, 0.5);
    if ((st.CFLAG[CFLAG_ID.体目当て] ?? 0) !== 0) v = times(v, 1.5);
    if (juelId === PALAM_ID.好意) return v;
    return 0;
  }

  // ─── 従順 (abl 10) ─────────────────────────────────────────────
  if (ablId === ABL_ID.従順) {
    if (juelId === PALAM_ID.恐怖) {
      let v = lookupLadder(abl(st, ABL_ID.従順), OBEDIENCE_FEAR, 6, 10000) ?? 0;
      return v;
    }
    if (juelId === PALAM_ID.恭順) {
      let v = lookupLadder(abl(st, ABL_ID.従順), OBEDIENCE_KYUU, 5, 25000) ?? 0;
      v = lineNotCrossed(st, v, 0.5);
      return v;
    }
    return 0;
  }

  // ─── 欲望 (abl 11) ─────────────────────────────────────────────
  if (ablId === ABL_ID.欲望) {
    if (juelId === PALAM_ID.欲情) {
      let v = lookupLadder(abl(st, ABL_ID.欲望), DESIRE_YOKUJOU, 8, 150000) ?? 0;
      v = trunc((v * (10 - 2 * talent(st, TALENT_ID.恋慕))) / 10);
      if (v === 0) v = 1;
      v = lineNotCrossed(st, v, 0.5);
      return v;
    }
    if (juelId === PALAM_ID.優越) {
      let v = lookupLadder(abl(st, ABL_ID.欲望), DESIRE_YUUETSU_NON_DLC, 6, 10000) ?? 0;
      v = lineNotCrossed(st, v, 0.5);
      if ((st.CFLAG[CFLAG_ID.体目当て] ?? 0) !== 0) v = times(v, 0.7);
      return v;
    }
    return 0;
  }

  // ─── 技巧 (abl 12) ─────────────────────────────────────────────
  if (ablId === ABL_ID.技巧) {
    if (juelId !== PALAM_ID.習得) return 0;
    let v = lookupLadder(abl(st, ABL_ID.技巧), TECHNIQUE_SHUUTOKU, 6, 10000) ?? 0;
    v = lineNotCrossed(st, v, 0.5);
    return v;
  }

  // ─── 奉仕精神 (abl 13) ─────────────────────────────────────────
  if (ablId === ABL_ID.奉仕精神) {
    // Gate: ABL:従順 must exceed 奉仕精神+1 (ABL_UP_DATA.ERB:977-979).
    if (abl(st, ABL_ID.従順) < abl(st, ABL_ID.奉仕精神) + 1) return -2;
    if (juelId === PALAM_ID.屈服) {
      const v = lookupLadder(abl(st, ABL_ID.奉仕精神), SERVICE_KUPPPUKU, 7, 10000) ?? 0;
      return lineNotCrossed(st, v, 0.5);
    }
    if (juelId === PALAM_ID.恭順) {
      const v = lookupLadder(abl(st, ABL_ID.奉仕精神), SERVICE_KYUUJUN, 7, 10000) ?? 0;
      return lineNotCrossed(st, v, 0.5);
    }
    if (juelId === PALAM_ID.習得) {
      // Pattern 2: only available for level 0.
      if (abl(st, ABL_ID.奉仕精神) !== 0) return -1;
      return 100;
    }
    return 0;
  }

  // ─── 露出癖 (abl 14) ───────────────────────────────────────────
  if (ablId === ABL_ID.露出癖) {
    if (juelId !== PALAM_ID.恥情) return 0;
    let v = lookupLadder(abl(st, ABL_ID.露出癖), EXPOSURE_TIJOU, 7, 20000) ?? 0;
    v = lineNotCrossed(st, v, 0.5);
    return v;
  }

  // ─── 受虐属性 (abl 15) ─────────────────────────────────────────
  if (ablId === ABL_ID.受虐属性) {
    if (abl(st, ABL_ID.欲望) < abl(st, ABL_ID.受虐属性) + 1) return -2;
    if (juelId === PALAM_ID.欲情) return lookupLadder(abl(st, ABL_ID.受虐属性), MASOCHIST_YOKUJOU, 5, 10000) ?? 0;
    if (juelId === PALAM_ID.苦痛) return lookupLadder(abl(st, ABL_ID.受虐属性), MASOCHIST_KUTUU, 6, 10000) ?? 0;
    return 0;
  }

  // ─── 施虐属性 (abl 16) ─────────────────────────────────────────
  if (ablId === ABL_ID.施虐属性) {
    if (abl(st, ABL_ID.欲望) < abl(st, ABL_ID.施虐属性) + 1) return -2;
    if (juelId === PALAM_ID.欲情) return lookupLadder(abl(st, ABL_ID.施虐属性), SADIST_YOKUJOU, 6, 10000) ?? 0;
    if (juelId === PALAM_ID.優越) return lookupLadder(abl(st, ABL_ID.施虐属性), SADIST_YUUETSU, 6, 10000) ?? 0;
    return 0;
  }

  // ─── 百合属性 (abl 17) ─────────────────────────────────────────
  if (ablId === ABL_ID.百合属性) {
    if (juelId === PALAM_ID.欲情) return lookupLadder(abl(st, ABL_ID.百合属性), YURI_YOKUJOU, 6, 50000) ?? 0;
    if (juelId === PALAM_ID.屈服) return lookupLadder(abl(st, ABL_ID.百合属性), YURI_KUPPPUKU, 6, 20000) ?? 0;
    return 0;
  }
  // ─── 断袖属性 (abl 18) ─────────────────────────────────────────
  if (ablId === ABL_ID.断袖属性) {
    if (juelId === PALAM_ID.欲情) return lookupLadder(abl(st, ABL_ID.断袖属性), BL_YOKUJOU, 6, 50000) ?? 0;
    if (juelId === PALAM_ID.屈服) return lookupLadder(abl(st, ABL_ID.断袖属性), BL_KUPPPUKU, 6, 20000) ?? 0;
    return 0;
  }

  // ─── 自慰中毒 (abl 30) ─────────────────────────────────────────
  if (ablId === ABL_ID.自慰中毒) {
    const addiction = abl(st, ABL_ID.自慰中毒);
    if (abl(st, ABL_ID.Ｃ感覚) <= addiction + 1) return -2;
    if (abl(st, ABL_ID.露出癖) <= addiction + 1) return -2;
    const rows = ONANISM_ADDICTION_LEVELS[addiction];
    if (!rows) {
      const formula = [
        10000 * (addiction - 2),
        100000 * (addiction - 3),
        10000 * (addiction - 2),
      ];
      if (juelId === PALAM_ID.欲情) return withOnanismAdjust(st, formula[0], flags);
      if (juelId === PALAM_ID.快Ｃ) return withOnanismAdjust(st, formula[1], flags);
      if (juelId === PALAM_ID.恥情) return withOnanismAdjust(st, formula[2], flags);
      return 0;
    }
    if (juelId === PALAM_ID.欲情) return withOnanismAdjust(st, rows[0], flags);
    if (juelId === PALAM_ID.快Ｃ) return withOnanismAdjust(st, rows[1], flags);
    if (juelId === PALAM_ID.恥情) return withOnanismAdjust(st, rows[2], flags);
    return 0;
  }

  // ─── 精液中毒 (abl 31) ─────────────────────────────────────────
  if (ablId === ABL_ID.精液中毒) {
    if (abl(st, ABL_ID.奉仕精神) < abl(st, ABL_ID.精液中毒) + 1) return -2;
    if (juelId === PALAM_ID.欲情) return lookupLadder(abl(st, ABL_ID.精液中毒), SEISHU_YOKUJOU, 6, 15000) ?? 0;
    if (juelId === PALAM_ID.屈服) return lookupLadder(abl(st, ABL_ID.精液中毒), SEISHU_KUPPPUKU, 6, 100000) ?? 0;
    return 0;
  }
  // ─── 百合中毒 (abl 32) ─────────────────────────────────────────
  if (ablId === ABL_ID.百合中毒) {
    if (abl(st, ABL_ID.百合属性) < abl(st, ABL_ID.百合中毒) + 1) return -2;
    const v = yuriOrBlAddictionDemand(st, abl(st, ABL_ID.百合中毒), YURI_BL_ADDICTION);
    if (juelId === PALAM_ID.快Ｃ) return v;
    if (juelId === PALAM_ID.欲情) return v;
    if (juelId === PALAM_ID.屈服) return v;
    return 0;
  }
  // ─── 断袖中毒 (abl 33) ─────────────────────────────────────────
  if (ablId === ABL_ID.断袖中毒) {
    if (abl(st, ABL_ID.断袖属性) < abl(st, ABL_ID.断袖中毒) + 1) return -2;
    const v = yuriOrBlAddictionDemand(st, abl(st, ABL_ID.断袖中毒), YURI_BL_ADDICTION);
    if (juelId === PALAM_ID.快Ｃ) return v;
    if (juelId === PALAM_ID.欲情) return v;
    if (juelId === PALAM_ID.屈服) return v;
    return 0;
  }
  // ─── 膣射中毒 (abl 34) ─────────────────────────────────────────
  if (ablId === ABL_ID.膣射中毒) {
    if (abl(st, ABL_ID.精液中毒) < abl(st, ABL_ID.膣射中毒) + 1) return -2;
    let v = 0;
    if (juelId === PALAM_ID.欲情) {
      v = lookupLadder(abl(st, ABL_ID.膣射中毒), SEISHU_YOKUJOU, 3, 15000) ?? 0;
      v = lineNotCrossed(st, v, 0.5);
      if (talent(st, TALENT_ID.Ｖ感度) > 0) v = times(v, 0.5);
      return v;
    }
    if (juelId === PALAM_ID.屈服) {
      v = lookupLadder(abl(st, ABL_ID.膣射中毒), SEISHU_KUPPPUKU, 3, 100000) ?? 0;
      v = lineNotCrossed(st, v, 0.5);
      if (talent(st, TALENT_ID.Ｖ感度) > 0) v = times(v, 0.5);
      return v;
    }
    return 0;
  }
  // ─── 肛射中毒 (abl 35) ─────────────────────────────────────────
  if (ablId === ABL_ID.肛射中毒) {
    if (abl(st, ABL_ID.肛射中毒) > abl(st, ABL_ID.精液中毒) + 1) return -2;
    let v = 0;
    if (juelId === PALAM_ID.欲情) {
      v = lookupLadder(abl(st, ABL_ID.肛射中毒), SEISHU_YOKUJOU, 3, 15000) ?? 0;
      v = lineNotCrossed(st, v, 0.4);
      if (talent(st, TALENT_ID.Ａ感度) > 0) v = times(v, 0.5);
      return v;
    }
    if (juelId === PALAM_ID.屈服) {
      v = lookupLadder(abl(st, ABL_ID.肛射中毒), SEISHU_KUPPPUKU, 3, 100000) ?? 0;
      v = lineNotCrossed(st, v, 0.4);
      if (talent(st, TALENT_ID.Ａ感度) > 0) v = times(v, 0.5);
      return v;
    }
    return 0;
  }
  // abl 39 催眠奴隷 is DLC-dormant; tag-only.
  return 0;
}

/** YoQ for the 自慰中毒 add-on multipliers (一線越えない/容易中毒/FLAG:抱負). */
function withOnanismAdjust(
  st: CharaSlotState,
  v: number,
  flags: Readonly<Record<number, number>>,
): number {
  let x = lineNotCrossed(st, v, 0.4);
  if (talent(st, TALENT_ID.容易中毒) !== 0) x = times(x, 0.5);
  if ((flags[FLAG_ID.抱負] ?? 0) === 1) x = times(x, 0.75);
  return x;
}

/** 百合中毒/断袖中毒 共享表 — `LOCAL:n` cell 同价 (ABL_UP_DATA.ERB:2093+). */
function yuriOrBlAddictionDemand(
  st: CharaSlotState,
  level: number,
  table: readonly (readonly number[])[],
): number {
  if (level < 0 || level >= table.length) {
    return 0;
  }
  const row = table[level]!;
  let v = 0;
  // ABLC 32 / 33 don't use GLOBAL_ABL_UP_RAIT; here we keep parity
  // with the simple raw JUEL gift since the upstream site of
  // 百合中毒/断袖中毒 also doesn't call CALC_ABL_DEMAND for these.
  // The 0 cell holds 快Ｃ, 1 = 欲情, 2 = 屈服 — all priced identically.
  const candidates = [row[0]!, row[1]!, row[2]!].filter((x) => x > 0);
  if (candidates.length === 0) return 0;
  v = candidates[0]!;
  v = lineNotCrossed(st, v, talent(st, TALENT_ID.恋慕) === 0 ? 2.0 : 0.4);
  if (talent(st, TALENT_ID.容易中毒) !== 0) v = times(v, 0.5);
  return v;
}

/** The 感度 `(2+感度)/2` multiplier JUEL_UP_SPECIAL applies to the 感覚
 *  ABLs' demand before the percentage cut (ABLUP.ERB:247 etc.). */
function senseDemandMultiplier(st: CharaSlotState, ablId: number): (v: number) => number {
  const senseTalent: Record<number, number> = {
    [ABL_ID.Ｃ感覚]: TALENT_ID.Ｃ感度,
    [ABL_ID.Ｖ感覚]: TALENT_ID.Ｖ感度,
    [ABL_ID.Ａ感覚]: TALENT_ID.Ａ感度,
    [ABL_ID.Ｂ感覚]: TALENT_ID.Ｂ感度,
  };
  const talentId = senseTalent[ablId];
  if (talentId === undefined) return (v) => v;
  return (v) => trunc((v * (2 + talent(st, talentId))) / 2);
}

export interface JuelUpResult {
  /** Jewels actually granted (`上昇量`). */
  rise: number;
}

/**
 * `@JUEL_UP_SPECIAL` — grant `MAX(trunc(demand * percentage / 100),
 * percentage)` of `juelId`, where `demand` is the pattern-0 requirement of
 * that jewel for `ablId`'s next level. Mutates `st.JUEL`.
 */
export function juelUpSpecial(
  st: CharaSlotState,
  isMaster: boolean,
  juelId: number,
  ablId: number,
  percentage: number,
  flags: Readonly<Record<number, number>> = {},
): JuelUpResult {
  let demand = juelDemandPattern0(st, isMaster, ablId, juelId, flags);
  demand = senseDemandMultiplier(st, ablId)(demand);
  const rise = Math.max(trunc((demand * percentage) / 100), percentage);
  juelAdd(st, juelId, rise);
  return { rise };
}

/** Display names for the jewel lines (`%PALAMNAME:n%之珠 ＋N`). */
/** `JUEL:100 (否定之珠)` — the denial pile. */
export const JUEL_DENIAL = 100;

// ============================================================================
// DEMAND LADDER TABLES (ABL_UP_DATA.ERB pattern 0/1/2/3 + EXP_DEMAND_N).
// Each array is indexed by ABL level 0..9; level ≥10 falls through to a
// formula (see `lookupLadder`). The 10th slot is only present where the
// upstream ladder uses a `CASEELSE` shape with a different multiplier
// (we don't store those — they're handled in code).
//
// All numbers transcribed verbatim from
// `ステータス計算関連/ABL/ABL_UP_DATA.ERB` — DO NOT EDIT without cross-
// checking the upstream `JUEL_DEMAND_N`/`EXP_DEMAND_N` selectors.
// ============================================================================

// 感覚 family — base[0..9]; "case1" column varies (sense Ｃ/Ｍ/Ｖ/Ｂ = 20,
// Ａ = 50). Upstream sets the case1 cell separately (in code); here we
// store the common ladder rows[1..9] + 0 and the special-cased row 1.
const SENSE_BASE_LEVEL0_4_V20: readonly number[] = [
  1, 20, 400, 5000, 15000, 30000, 40000, 50000, 60000, 70000,
];
const SENSE_BASE_LEVEL0_4_V50: readonly number[] = [
  1, 50, 400, 5000, 15000, 30000, 40000, 50000, 60000, 70000,
];

// 親密 9 (non-DLC)
const INTIMACY_NON_DLC: readonly number[] = [
  30, 100, 300, 1500, 5000, 15000, 40000, 70000, 120000, 200000,
];

// 従順 10 — pattern 0 恐怖 / pattern 1 恭順
const OBEDIENCE_FEAR: readonly number[] = [
  30, 200, 1000, 5000, 7500, 10000, 15000, 20000, 25000, 30000,
];
const OBEDIENCE_KYUU: readonly number[] = [
  30, 200, 1000, 5000, 7500, 15000, 25000, 40000, 50000, 80000,
];

// 欲望 11 — pattern 0 欲情 / pattern 1 優越 (non-DLC)
const DESIRE_YOKUJOU: readonly number[] = [
  1, 20, 1000, 8000, 24000, 30000, 40000, 50000, 75000, 100000,
];
const DESIRE_YUUETSU_NON_DLC: readonly number[] = [
  50, 200, 1000, 8000, 24000, 30000, 36000, 45000, 55000, 70000,
];

// 技巧 12 — only pattern 0 (習得)
const TECHNIQUE_SHUUTOKU: readonly number[] = [
  1, 20, 200, 3000, 20000, 25000, 34000, 45000, 55000, 70000,
];

// 奉仕精神 13 — pattern 0 屈服 / pattern 1 恭順
const SERVICE_KUPPPUKU: readonly number[] = [
  100, 1200, 5000, 10000, 30000, 35000, 40000, 45000, 50000, 60000,
];
const SERVICE_KYUUJUN: readonly number[] = [
  20, 100, 600, 2000, 8000, 8500, 10000, 15000, 20000, 30000,
];

// 露出癖 14 — 恥情
const EXPOSURE_TIJOU: readonly number[] = [
  100, 500, 1500, 3000, 6000, 10000, 15000, 24000, 30000, 40000,
];

// 受虐 15 — 欲情 row / 苦痛 row (returned by juelId switch in code)
const MASOCHIST_YOKUJOU: readonly number[] = [
  100, 300, 1000, 6000, 12000, 15000, 20000, 25000, 30000, 40000,
];
const MASOCHIST_KUTUU: readonly number[] = [
  100, 500, 1500, 3000, 5000, 8000, 12000, 16000, 20000, 30000,
];

// 施虐 16 — 欲情 row / 優越 row
const SADIST_YOKUJOU: readonly number[] = [
  100, 500, 1500, 3000, 5000, 8000, 12000, 15000, 25000, 30000,
];
const SADIST_YUUETSU: readonly number[] = [
  100, 500, 1500, 3000, 5000, 7500, 10000, 15000, 20000, 25000,
];

// 百合 17 — 欲情 row / 屈服 row
const YURI_YOKUJOU: readonly number[] = [
  200, 1000, 3000, 8000, 20000, 25000, 30000, 35000, 40000, 50000,
];
const YURI_KUPPPUKU: readonly number[] = [
  0, 0, 1000, 2000, 5000, 6000, 8000, 10000, 15000, 20000,
];

// 断袖 18 — same shape as 百合
const BL_YOKUJOU = YURI_YOKUJOU;
const BL_KUPPPUKU = YURI_KUPPPUKU;

// 中毒系 31/34/35 同样 pattern (欲情 row / 屈服 row)
const SEISHU_YOKUJOU: readonly number[] = [
  3000, 8000, 15000, 30000, 45000, 60000, 65000, 70000, 75000, 90000,
];
const SEISHU_KUPPPUKU: readonly number[] = [
  10000, 25000, 50000, 100000, 300000, 350000, 400000, 450000, 500000,
  600000,
];

// 百合中毒 32 / 断袖中毒 33 — non-uniform 3-col rows: [快Ｃ, 欲情, 屈服].
const YURI_BL_ADDICTION: ReadonlyArray<readonly number[]> = [
  [3000, 10000, 10000],
  [8000, 25000, 25000],
  [15000, 50000, 50000],
  [30000, 100000, 100000],
  [55000, 300000, 300000],
  [60000, 350000, 350000],
  [65000, 400000, 400000],
  [70000, 450000, 450000],
  [75000, 500000, 500000],
  [80000, 550000, 550000],
];

// 自慰中毒 30 — non-uniform 3-col rows: [欲情, 快Ｃ, 恥情].
const ONANISM_ADDICTION_LEVELS: ReadonlyArray<readonly number[]> = [
  [1000, 5000, 1000],
  [2000, 10000, 3000],
  [3000, 30000, 5000],
  [10000, 50000, 12000],
  [15000, 100000, 20000],
  [25000, 150000, 25000],
  [30000, 200000, 40000],
  [50000, 250000, 50000],
  [60000, 300000, 60000],
  [70000, 500000, 70000],
];

// 「EXP_DEMAND_N」pattern-0 — most rows are 0 (no EXP required to level the
// ABL); these are the exceptions (ABL_UP_DATA.ERB:740/744/894/921+).
//
// Lazy expansion: a single `Pattern0` typed as a function returning the
// demanded EXP value is more compact than a per-EXP-id ladder. For the
// 感覚 family the EXP is "−"; for 中毒系 it costs a specific EXP row.

// EXP_DEMAND_N pattern 0 — function dispatched by ABL id (lazy).
// Faithful numbers extracted from ABL_UP_DATA.ERB:317-371 (Ａ感覚).
// Returns 0 when the upstream says the EXP is not required.
//
// Most ABLs set `RETURNF 0` (no EXP gating); we only enumerate the ABLs
// that gate on EXP ids from `EXP_ID.*`.
export function expDemandPattern0(
  st: CharaSlotState,
  ablId: number,
  level: number,
  expId: number,
): number {
  if (ablId === ABL_ID.Ｖ感覚) {
    if (expId === EXP_ID.Ｖ経験 && level >= 3) return 1;
    return 0;
  }
  if (ablId === ABL_ID.Ａ感覚) {
    if (expId !== EXP_ID.Ａ経験) return 0;
    const ladder = [2, 10, 30, 75, 150, 220, 270, 360, 420, 500];
    const v = level >= 0 && level <= 9 ? ladder[level]! : 100 * (level - 4);
    return Math.max(1, lineNotCrossed(st, v, 0.5));
  }
  void expId;
  void level;
  return 0;
}

export const JUEL_DISPLAY_NAME: Readonly<Record<number, string>> = {
  [PALAM_ID.快Ｃ]: "快Ｃ",
  [PALAM_ID.快Ｖ]: "快Ｖ",
  [PALAM_ID.快Ａ]: "快Ａ",
  [PALAM_ID.快Ｂ]: "快Ｂ",
  [PALAM_ID.快Ｍ]: "快Ｍ",
  [PALAM_ID.欲情]: "欲情",
  [PALAM_ID.恭順]: "恭順",
  [PALAM_ID.屈服]: "屈服",
  [PALAM_ID.習得]: "習得",
  [PALAM_ID.恐怖]: "恐怖",
  [PALAM_ID.苦痛]: "苦痛",
  [PALAM_ID.恥情]: "恥情",
  [PALAM_ID.好意]: "好意",
  [PALAM_ID.優越]: "優越",
  [PALAM_ID.反感]: "反感",
  [PALAM_ID.不快]: "不快",
  [PALAM_ID.抑鬱]: "抑鬱",
  [JUEL_DENIAL]: "否定",
};
