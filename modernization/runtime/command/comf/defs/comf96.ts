/**
 * Phase 7 — `COMF96 パイズリする` (give titjob to target), as a `ComfDef`.
 *
 * Ports the **normal-mode (ELSE) core** of `@COM96`
 * (`ERB/コマンド関連/COMF/COMF96 パイズリする.ERB`).
 *
 * **Oral/hand family.** Master is the actor serving target: master gives
 * a titjob to the target. Target receives 快Ｃ (scaled by master's
 * ABL:胸), master receives 快Ｂ. Target drained; no master drain.
 *
 * **Faithful normal-mode core (ERB 31-47, ELSE branch):**
 *   - target DOWNBASE: 体力 30 / 気力 80 (ERB 31-32)
 *   - master SOURCE: 快Ｂ = 50 (ERB 33)
 *   - target SOURCE: 快Ｃ = 110 + MIN(mAbl(胸)*25, 100), 露出 20,
 *     逸脱 20, 反感 20 (ERB 34-40)
 *   - 鬱屈 +30 if 自己愛<0 || 抵抗 (ERB 41-43)
 *   - EXP: 愛情経験 target++ if 恋慕>0 (ERB 46)
 *
 * **DEFERRED (documented):**
 *   - Time-stop branch (ERB 23-29) — TSP drain, different SOURCE values.
 *   - STAIN swap: master B ↔ target P (ERB 44) — STAIN subsystem deferred.
 *   - HETEROSEX EXP writes (ERB 45) — gender-pair helper deferred.
 *   - EXP乳交経験 (ERB 47) — no existing EXP_ID; deferred.
 *   - COM_ABLE96 success-rate calculation — COMABLE layer.
 *   - TCVAR markers — H-scene chaining deferred.
 *
 * **No outcome roll, no TIME** — pinned 通常; timeCost 0.
 */

import type { ExecCheck, HandlerEntry } from "../../types.js";
import {
  ABL_ID,
  BASE_ID,
  EXP_ID,
  CFLAG_ID,
  FLAG_ID,
  SOURCE_ID,
  TALENT_ID,
  TCVAR_ID,
  TEQUIP_ID,
} from "../../../state/settlement.js";
import { makeComfHandler } from "../make-comf-handler.js";
import type { ComfDef } from "../comf-def.js";
import { STAIN_PART, getStain } from "../../../state/stain.js";
import { isEquipped, readTequip } from "../../../state/tequip.js";

const com96Check: ExecCheck = (ctx) => {
  const target = ctx.state.charas[ctx.target];
  if (!target) return { ok: false, reason: { kind: "precondition", message: "需要在场的对象。" } };
  if (((target.state.TALENT[TALENT_ID.性別] ?? 0) & 2) === 0) {
    return { ok: false, reason: { kind: "precondition", message: "对象的身体条件不符。" } };
  }
  if (((ctx.state.master.state.TALENT[TALENT_ID.性別] ?? 0) & 1) === 0) {
    return { ok: false, reason: { kind: "precondition", message: "自己的身体条件不符。" } };
  }
  if (isEquipped(target, TEQUIP_ID.継続接吻)) {
    return { ok: false, reason: { kind: "precondition", message: "持续接吻中无法进行。" } };
  }
  if (
    readTequip(ctx.state.master, TEQUIP_ID.上半身着衣状況) > 1 &&
    readTequip(ctx.state.master, 3) === 0
  ) {
    return { ok: false, reason: { kind: "precondition", message: "上半身衣着妨碍了动作。" } };
  }
  return { ok: true };
};

export const comf96Def: ComfDef = {
  commandNo: 96,
  label: "パイズリする",

  // No outcome roll; pinned 通常.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  canExecute: com96Check,
  hModeMenuCheck: com96Check,

  // Target drain handled in body().
  downbase: {},

  buildSources: (c) => {
    const frozen =
      (c.next.flagStore[FLAG_ID.時間停止] ?? 0) === 1 &&
      (c.t.state.CFLAG[CFLAG_ID.時間停止行動] ?? 0) === 0;
    if (frozen) return { [SOURCE_ID.快Ｃ]: 110 };
    // ERB 34-38: 快Ｃ = 110 + MIN(mAbl(胸)*25, 100).
    const breast = c.mAbl(ABL_ID.胸);
    const kaiC = 110 + Math.min(breast * 25, 100);

    const sources: Record<number, number> = {
      [SOURCE_ID.快Ｃ]: kaiC,
      [SOURCE_ID.露出]: 20,
      [SOURCE_ID.逸脱]: 20,
      [SOURCE_ID.反感]: 20,
    };

    // ERB 41-43: 鬱屈 +30 if 自己愛<0 || 抵抗.
    if (c.tTalent(TALENT_ID.自己愛) < 0 || c.tTalent(TALENT_ID.抵抗)) {
      sources[SOURCE_ID.鬱屈] = 30;
    }
    return sources;
  },

  // ERB 33: master SOURCE:PLAYER:快Ｂ = 50.
  buildMasterSources: (c) => ({
    [SOURCE_ID.快Ｂ]:
      (c.next.flagStore[FLAG_ID.時間停止] ?? 0) === 1 &&
      (c.t.state.CFLAG[CFLAG_ID.時間停止行動] ?? 0) === 0
        ? 150
        : 50,
  }),

  body: (c) => {
    const frozen =
      (c.next.flagStore[FLAG_ID.時間停止] ?? 0) === 1 &&
      (c.t.state.CFLAG[CFLAG_ID.時間停止行動] ?? 0) === 0;
    c.t.state.TCVAR[TCVAR_ID.行為者] = 0;
    c.master.state.TCVAR[108] = 1;
    c.t.state.TCVAR[2] = 5;
    c.t.state.TCVAR[TCVAR_ID.射精快感強度] = 1200;
    if (frozen) {
      c.master.state.BASE[BASE_ID.TSP] = (c.master.state.BASE[BASE_ID.TSP] ?? 0) - 60;
    } else {
      c.t.state.BASE[BASE_ID.体力] = (c.t.state.BASE[BASE_ID.体力] ?? 0) - 30;
      c.t.state.BASE[BASE_ID.気力] = (c.t.state.BASE[BASE_ID.気力] ?? 0) - 80;
    }

    c.master.state.EXP[EXP_ID.乳交経験] =
      (c.master.state.EXP[EXP_ID.乳交経験] ?? 0) + (frozen || c.tCflag(CFLAG_ID.恶作剧) ? 1 : 2);

    // ERB 46: EXP:愛情経験 target++ if 恋慕>0.
    if (!frozen && !c.tCflag(CFLAG_ID.恶作剧) && c.tTalent(TALENT_ID.恋慕) > 0) {
      c.t.state.EXP[EXP_ID.愛情経験] =
        (c.t.state.EXP[EXP_ID.愛情経験] ?? 0) + 1;
    }

    // ERB 53-54: STAIN swap — master Ｂ ⇔ target Ｐ.
    const mb = getStain(c.master, STAIN_PART.Ｂ);
    const tp = getStain(c.t, STAIN_PART.Ｐ);
    c.master.state.STAIN[STAIN_PART.Ｂ] = mb | tp;
    c.t.state.STAIN[STAIN_PART.Ｐ] = tp | mb;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 为%CALLNAME:TARGET%乳交 — パイズリ；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf96HandlerEntry: HandlerEntry = makeComfHandler(comf96Def);
