/**
 * Phase 7 — `COMF81 フェラチオ` (fellatio), as a `ComfDef`.
 *
 * Ports the **normal-mode (ELSE) core** of `@COM81`
 * (`ERB/コマンド関連/COMF/COMF81 フェラチオ.ERB`).
 *
 * **Oral/hand family (奉仕系 81).** Target performs oral service on the
 * master. Master `快Ｃ` scales with target ABL:舌 (threshold at 4).
 *
 * **Faithful normal-mode core (ERB normal ELSE branch 53-89):**
 *   - master SOURCE: 快Ｃ = 110 + (ABL:舌>=4 ? 100 : ABL:舌*25)
 *   - DOWNBASE: target 体力 10 / 気力 80
 *   - SOURCE target: 快Ｍ 50, 情愛 100, 性行動 300, 達成 150, 屈従 700,
 *     反感 400, 逸脱 100
 *   - master 快Ｃ ×1.50 if target 舌使い, ×0.75 if target 猫舌 (ERB 82-88)
 *   - 鬱屈 +400 if 自己愛<0 || 抵抗
 *   - EXP: 口淫経験 target += 3 (ERB 112-113)
 *
 * **DEFERRED (documented):**
 *   - 不潔 — needs STAIN subsystem.
 *   - STAIN swap (指 ↔ Ｐ) — STAIN not modeled.
 *   - HETEROSEX EXP writes — gender-pair helper deferred.
 *   - Time-stop branch — TSP drain, target no drain.
 *   - TCVAR:116, TCVAR:108, TCVAR:PLAYER:2/4 — H-scene action markers.
 *   - 猫舌 → 嗜虐快楽経験 — deferred.
 */

import type { ExecCheck, HandlerEntry } from "../../types.js";
import {
  ABL_ID,
  BASE_ID,
  CFLAG_ID,
  EXP_ID,
  FLAG_ID,
  SOURCE_ID,
  TALENT_ID,
  TEQUIP_ID,
} from "../../../state/settlement.js";
import { makeComfHandler } from "../make-comf-handler.js";
import type { ComfDef } from "../comf-def.js";
import { STAIN_BIT, STAIN_PART, getStain } from "../../../state/stain.js";
import { isEquipped } from "../../../state/tequip.js";

const block = (message: string): { ok: false; reason: { kind: "precondition"; message: string } } => ({
  ok: false,
  reason: { kind: "precondition", message },
});

/**
 * @COM_ABLE81 可用性判定（忠实核心）。deferred: 挿入不可(TARGET)==3、时停包裹语义
 * （猫舌门仅于 !FLAG:70 || CFLAG:344==1 时生效，已按此建模）、TFLAG:100/GLOBAL_COMABLE。
 */
const com81Check: ExecCheck = (ctx) => {
  const target = ctx.state.charas[ctx.target];
  if (!target) return block("需要在场的对象。");
  // 调教者必须为男/半人半妖/扶她（性別&2）；上游无 PBAND 替代（女性主控不可口交）.
  if (((ctx.state.master.state.TALENT[TALENT_ID.性別] ?? 0) & 2) === 0) {
    return block("调教者的身体条件不符。");
  }
  // 时停包裹：!FLAG:70 || CFLAG:344==1 时，猫舌目标需技巧 Lv2 以上.
  const timeStopped = (ctx.state.flagStore[FLAG_ID.時間停止] ?? 0) === 1;
  const consciouslyActed = (target.state.CFLAG[CFLAG_ID.時間停止行動] ?? 0) === 1;
  if (!timeStopped || consciouslyActed) {
    if (
      (target.state.TALENT[TALENT_ID.猫舌] ?? 0) !== 0 &&
      (target.state.ABL[ABL_ID.技巧] ?? 0) < 2
    ) {
      return block("猫舌的对象需要技巧 Lv2 以上。");
    }
  }
  if (isEquipped(target, TEQUIP_ID.口球)) {
    return block("口球使用中无法进行。");
  }
  return { ok: true };
};

/**
 * `Y` (汚れデータ) for フェラチオ (ERB 290-303), pure for tests. Y
 * accumulates weights from the master's Ｐ-part soil bits, then is scaled
 * by the target's 汚臭耐性:
 *   - 愛液 (1) → +1, 精液 (4) → +3, 肛門 (8) → +7, 母乳 (16) → +15
 *   - Y = Y * (2 - 汚臭耐性) / 2  (note: NO /= 3 like COMF80)
 * Returns the `不潔` SOURCE value = Y*10 + 60 (ERB 66).
 */
export function computeFellatioFuketsu(masterPSoil: number, tolerance: number): number {
  let y = 0;
  if (masterPSoil & STAIN_BIT.愛液) y += 1;
  if (masterPSoil & STAIN_BIT.精液) y += 3;
  if (masterPSoil & STAIN_BIT.肛門) y += 7;
  if (masterPSoil & STAIN_BIT.母乳) y += 15;
  y = Math.trunc((y * (2 - tolerance)) / 2);
  return y * 10 + 60;
}

export const comf81Def: ComfDef = {
  commandNo: 81,
  label: "フェラチオ",

  // No outcome roll; pinned 通常.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  canExecute: com81Check,
  hModeMenuCheck: com81Check,

  // Target drain is in body; factory downbase is master-only → empty.
  downbase: {},

  // SOURCE target: ERB normal ELSE.
  buildSources: (c) => {
    const kaiM = 50;      // 快Ｍ
    const jouai = 100;     // 情愛
    const seiKodo = 300;   // 性行動
    const tasei = 150;     // 達成
    const kutsuju = 700;   // 屈従
    const hankan = 400;    // 反感
    const itsudev = 100;   // 逸脱

    // 不潔 = Y*10 + 60. Y from STAIN:PLAYER:2 (master Ｐ soil) + 汚臭耐性
    // scaling (ERB 290-303). STAIN subsystem now modeled.
    const fuketsu = computeFellatioFuketsu(getStain(c.master, STAIN_PART.Ｐ), c.tTalent(TALENT_ID.汚臭耐性));

    const sources: Record<number, number> = {
      [SOURCE_ID.快Ｍ]: kaiM,
      [SOURCE_ID.情愛]: jouai,
      [SOURCE_ID.性行動]: seiKodo,
      [SOURCE_ID.達成]: tasei,
      [SOURCE_ID.屈従]: kutsuju,
      [SOURCE_ID.反感]: hankan,
      [SOURCE_ID.逸脱]: itsudev,
      [SOURCE_ID.不潔]: fuketsu,
    };

    // 鬱屈 +400 if 自己愛<0 || 抵抗.
    if (c.tTalent(TALENT_ID.自己愛) < 0 || c.tTalent(TALENT_ID.抵抗)) {
      sources[SOURCE_ID.鬱屈] = 400;
    }
    return sources;
  },

  // B1b — dual-participant master SOURCE.
  // SOURCE:PLAYER:快Ｃ = 110 + (ABL:舌>=4 ? 100 : ABL:舌*25), then
  // 舌使い ×1.50 (ERB 82-84) and 猫舌 ×0.75 (ERB 86-88), both off the
  // TARGET's talents (the giver). An earlier port dropped both multipliers.
  buildMasterSources: (c) => {
    const shita = c.tAbl(ABL_ID.舌);
    let kaiC = shita >= 4 ? 110 + 100 : 110 + shita * 25;
    if (c.tTalent(TALENT_ID.舌使い)) kaiC = Math.trunc(kaiC * 1.5);
    if (c.tTalent(TALENT_ID.猫舌)) kaiC = Math.trunc(kaiC * 0.75);
    return {
      [SOURCE_ID.快Ｃ]: kaiC,
    };
  },

  body: (c) => {
    // target 体力 10 / 気力 80 drain.
    c.t.state.BASE[BASE_ID.体力] = (c.t.state.BASE[BASE_ID.体力] ?? 0) - 10;
    c.t.state.BASE[BASE_ID.気力] = (c.t.state.BASE[BASE_ID.気力] ?? 0) - 80;

    // ERB 112-113: EXP:口淫経験 += 3 (target) on the non-time-stop,
    // non-恶作剧 path. (An earlier port wrongly marked this "no ID" and
    // instead invented a 愛情経験/恋慕 grant that the ERB does not have.)
    c.t.state.EXP[EXP_ID.口淫経験] =
      (c.t.state.EXP[EXP_ID.口淫経験] ?? 0) + 3;

    // STAIN swap (ERB deferred): target 口 ⇔ master Ｐ (フェラチオ).
    const tm = getStain(c.t, STAIN_PART.口);
    const mp = getStain(c.master, STAIN_PART.Ｐ);
    c.t.state.STAIN[STAIN_PART.口] = tm | mp;
    c.master.state.STAIN[STAIN_PART.Ｐ] = mp | tm;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:TARGET% 为%CALLNAME:MASTER%口交 — フェラチオ；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf81HandlerEntry: HandlerEntry = makeComfHandler(comf81Def);
