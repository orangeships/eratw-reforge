/**
 * Phase 7 — `COMF126 乳の揉み合い` (mutual breast groping), as a `ComfDef`.
 *
 * Ports the **normal-mode core** of `@COM126`
 * (`ERB/コマンド関連/COMF/COMF126 乳の揉み合い.ERB`).
 *
 * **Oral/hand family.** Mutual breast groping: both participants receive
 * 快Ｂ (master 200, target 200). Target additionally takes 性行動 150,
 * 露出 50, 不潔 30, 逸脱 100, and 反感 200 with a modest 鬱屈 penalty
 * for self-loving or resistant targets.
 *
 * **Faithful normal-mode core (ERB 20-36):**
 *   - target DOWNBASE: 体力 7 / 気力 70 (ERB 20-21)
 *   - master SOURCE: 快Ｂ = 200 (ERB 22)
 *   - target SOURCE: 快Ｂ 200, 性行動 150, 露出 50, 不潔 30, 逸脱 100,
 *     反感 200 (ERB 23-30)
 *   - 鬱屈 +100 if 自己愛<0 || 抵抗 (ERB 31-33)
 *   - STAIN 汚れ移動 (ERB 57-61): master 手 ⇔ target Ｂ, master Ｂ ⇔ target 手
 *     (double mutual OR).
 *
 * **DEFERRED (documented):**
 *   - Time-stop branch (ERB 15-19) — TSP drain, different SOURCE values.
 *   - HETEROSEX EXP writes (ERB 65-69) — gender-pair helper deferred.
 *   - 胸围差 → 屈従 +100 (ERB 36) — requires master TALENT:胸围
 *     (no mTalent access); deferred.
 *   - 幼児退行/幼稚 master TALENT → TIMES 快Ｂ and 性行動 *1.20 (ERB
 *     beyond normal branch) — no mTalent access; deferred.
 *   - COM_ABLE126 success-rate calculation — COMABLE layer.
 *   - TCVAR markers — H-scene chaining deferred.
 *
 * **No outcome roll, no TIME** — pinned 通常; timeCost 0.
 */

import type { ExecCheck, HandlerEntry } from "../../types.js";
import {
  ABL_ID,
  BASE_ID,
  CFLAG_ID,
  FLAG_ID,
  SOURCE_ID,
  TALENT_ID,
  TCVAR_ID,
  TEQUIP_ID,
} from "../../../state/settlement.js";
import { makeComfHandler } from "../make-comf-handler.js";
import type { ComfDef } from "../comf-def.js";
import { STAIN_PART } from "../../../state/stain.js";
import { isEquipped, readTequip } from "../../../state/tequip.js";

const com126Check: ExecCheck = (ctx) => {
  const target = ctx.state.charas[ctx.target];
  if (!target) return { ok: false, reason: { kind: "precondition", message: "需要在场的对象。" } };
  if (
    (ctx.state.flagStore[FLAG_ID.時間停止] ?? 0) === 1 &&
    (target.state.CFLAG[CFLAG_ID.時間停止行動] ?? 0) === 0
  ) return { ok: false, reason: { kind: "precondition", message: "冻结的对象无法配合。" } };
  if (
    ((target.state.TALENT[TALENT_ID.性別] ?? 0) & 1) === 0 ||
    ((ctx.state.master.state.TALENT[TALENT_ID.性別] ?? 0) & 1) === 0
  ) return { ok: false, reason: { kind: "precondition", message: "双方的身体条件不符。" } };
  if ((target.state.ABL[ABL_ID.百合属性] ?? 0) < 3) {
    return { ok: false, reason: { kind: "precondition", message: "百合属性需要达到 3。" } };
  }
  if (readTequip(target, TEQUIP_ID.上半身着衣状況) > 0 && readTequip(target, 3) === 0) {
    return { ok: false, reason: { kind: "precondition", message: "对象的上半身衣着妨碍了动作。" } };
  }
  if ((target.state.CFLAG[CFLAG_ID.恶作剧] ?? 0) > 1) {
    return { ok: false, reason: { kind: "precondition", message: "睡眠侵犯中无法进行。" } };
  }
  if (isEquipped(target, TEQUIP_ID.縄)) {
    return { ok: false, reason: { kind: "precondition", message: "绳索使用中无法进行。" } };
  }
  return { ok: true };
};

export const comf126Def: ComfDef = {
  commandNo: 126,
  label: "乳の揉み合い",

  // No outcome roll; pinned 通常.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  canExecute: com126Check,
  hModeMenuCheck: com126Check,

  // Target drain handled in body().
  downbase: {},

  buildSources: (c) => {
    const sources: Record<number, number> = {
      [SOURCE_ID.快Ｂ]: 200,
      [SOURCE_ID.性行動]: 150,
      [SOURCE_ID.露出]: 50,
      [SOURCE_ID.不潔]: 30,
      [SOURCE_ID.逸脱]: 100,
      [SOURCE_ID.反感]: 200,
    };

    // ERB 31-33: 鬱屈 +100 if 自己愛<0 || 抵抗.
    if (c.tTalent(TALENT_ID.自己愛) < 0 || c.tTalent(TALENT_ID.抵抗)) {
      sources[SOURCE_ID.鬱屈] = 100;
    }
    if ((c.master.state.TALENT[TALENT_ID["幼児／幼児退行"]] ?? 0) !== 0) {
      sources[SOURCE_ID.快Ｂ] = Math.trunc(sources[SOURCE_ID.快Ｂ]! * 1.2);
      sources[SOURCE_ID.性行動] = Math.trunc(sources[SOURCE_ID.性行動]! * 1.2);
    }
    if ((c.master.state.TALENT[TALENT_ID.幼稚] ?? 0) !== 0) {
      sources[SOURCE_ID.快Ｂ] = Math.trunc(sources[SOURCE_ID.快Ｂ]! * 1.2);
      sources[SOURCE_ID.性行動] = Math.trunc(sources[SOURCE_ID.性行動]! * 1.2);
    }
    if (
      (c.master.state.TALENT[TALENT_ID.胸围] ?? 0) -
        (c.t.state.TALENT[TALENT_ID.胸围] ?? 0) >
      1
    ) sources[SOURCE_ID.屈従] = (sources[SOURCE_ID.屈従] ?? 0) + 100;
    return sources;
  },

  // ERB 22: master SOURCE:PLAYER:快Ｂ = 200.
  buildMasterSources: (_c) => ({
    [SOURCE_ID.快Ｂ]: 200,
  }),

  body: (c) => {
    c.t.state.TCVAR[TCVAR_ID.行為者] = c.t.charaNum;
    c.master.state.TCVAR[108] = 1;
    c.t.state.TCVAR[108] = 1;
    // ERB 20-21: target 体力 7 / 気力 70 drain.
    c.t.state.BASE[BASE_ID.体力] = (c.t.state.BASE[BASE_ID.体力] ?? 0) - 7;
    c.t.state.BASE[BASE_ID.気力] = (c.t.state.BASE[BASE_ID.気力] ?? 0) - 70;

    // ERB 57-61: 汚れ移動 — double mutual OR (master 手 ⇔ target Ｂ,
    // master Ｂ ⇔ target 手).
    const m1 = c.master.state.STAIN[STAIN_PART.手] ?? 0;
    const tb = c.t.state.STAIN[STAIN_PART.Ｂ] ?? 0;
    c.master.state.STAIN[STAIN_PART.手] = m1 | tb;
    c.t.state.STAIN[STAIN_PART.Ｂ] = tb | m1;

    const mb = c.master.state.STAIN[STAIN_PART.Ｂ] ?? 0;
    const t1 = c.t.state.STAIN[STAIN_PART.手] ?? 0;
    c.master.state.STAIN[STAIN_PART.Ｂ] = mb | t1;
    c.t.state.STAIN[STAIN_PART.手] = t1 | mb;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 与%CALLNAME:TARGET%互相揉胸 — 乳の揉み合い；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf126HandlerEntry: HandlerEntry = makeComfHandler(comf126Def);
