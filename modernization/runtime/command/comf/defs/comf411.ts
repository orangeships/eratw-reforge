/**
 * Phase 7 — `COMF411 戦闘訓練` (combat training), as a `ComfDef`.
 *
 * Ports the deterministic CASE-0 core of `@COM411`
 * (`ERB/コマンド関連/COMF/日常系/COMF411 戦闘訓練.ERB`).
 *
 * **Chore-help family sibling of 412 勉強.** This is the "cheap second
 * member" that validates the family-exemplar approach: 411 reuses the
 * master-centric optional-target factory path AND the *universal*
 * `favorPleasureBonus` primitive verbatim. What stays bespoke is small
 * and honest — 411's own 親密 bracket (4-arm, starts at ≤5) and a
 * target-side BASE drain (the factory's `downbase` only drains master,
 * so target DOWNBASE is written in `body`). "Cheaper, not free."
 *
 * **Weather → CASE 0.** The ERB picks one of 4 difficulty cases from
 * `TIME:5`/`WIND_VELOCITY`/season into `TFLAG:194`, but forces `194 = 0`
 * when training indoors (`!OUTROOF`). Weather isn't modeled and the 神社
 * trial run trains indoors, so we port CASE 0 (the indoor/good-weather
 * branch) and defer cases 1/2/3.
 *
 * **Faithful CASE-0 core captured:**
 *   - DOWNBASE master 体力 -200 / 気力 -200 (ERB 37-38)
 *   - TIME += 60 (ERB 180)
 *   - When a chara is present and awake (`TARGET>0 && !CFLAG:睡眠`, ERB 39):
 *       · SOURCE:歓楽 = 400 + 親密-bracket + 好感度-bracket, clamped ≥0
 *       · target DOWNBASE 体力 -200 / 気力 -200 (ERB 43-44)
 *       · EXP:戦闘経験 grants (non-DLC):
 *           master always +1 (ERB 184),
 *           target +2 if master 戦闘能力 ≥ target's (ERB 50),
 *           master +1 if master 戦闘能力 < target's − 2 (ERB 56),
 *           master +1 / target +1 (ERB 79-80)
 *
 * **DEFERRED (documented):**
 *   - Weather cases 1/2/3 (`TFLAG:194` 1-3 → 300/300, 600/600 DOWNBASE +
 *     higher 歓楽 bases) — weather not modeled.
 *   - `MAXBASE:TARGET:体力/気力 += RAND:n` stat-cap growth (RAND).
 *   - `CALL ADD_TIRED(TARGET, …)` fatigue accrual.
 *   - `TCVAR:空腹時刻 -= 15` hunger-clock nudge (master + target).
 *   - `MAGIC_DLC*` arms (DLC EXP scaling, 約會経験).
 *   - `ITEM:101` / `ITEM:運動飲料` bonuses (item + RAND), `CFLAG:同行`.
 *   - `TFLAG:信頼度管理` trust block (deferred uniformly in source-check).
 *
 * **No outcome roll** in the CASE-0 core, so the factory is pinned to 通常.
 */
import type { HandlerEntry } from "../../types.js";
import {
  ABL_ID,
  BASE_ID,
  CFLAG_ID,
  EXP_ID,
  SOURCE_ID,
} from "../../../state/settlement.js";
import { makeComfHandler } from "../make-comf-handler.js";
import type { ComfCtx, ComfDef } from "../comf-def.js";
import {
  bracketBonus,
  favorPleasureBonus,
  SHINMITSU_PLEASURE_TRAIN_TIERS,
} from "../source-brackets.js";

/** SOURCE/EXP fire only when the helper is present and awake (ERB 39). */
function trainEngaged(c: ComfCtx): boolean {
  return c.hasTarget && c.tCflag(CFLAG_ID.睡眠) === 0;
}

export const comf411Def: ComfDef = {
  commandNo: 411,
  label: "戦闘訓練",

  // @COM_ABLE411 has no TARGET>0 precondition: the master may train alone,
  // while the source/target branch below only runs when a helper is present.
  requiresTarget: false,

  // Parity QA P-14 — the auto-extracted gate already has requiresTrainingRoom
  // (場所_訓練: 神社:境内/庭, 人間之里:寺子屋 — verified against
  // ROOMSETTING_0.ERB). Add the missing `SIF CFLAG:诶嘿嘿 == 2 → RETURN 0`
  // arm (block while target is in partner-led / 逆推 H-mode). The other
  // upstream arms (FLAG:70, 行動==5, master 気力>0) are already in the
  // generated gate.
  gate: { notWhilePartnerLedH: true },

  // No outcome roll in the CASE-0 core — pin to 通常.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  // ERB 180.
  timeCost: 60,

  // ERB 37-38: CASE 0 master drain (indoor).
  downbase: { [BASE_ID.体力]: 200, [BASE_ID.気力]: 200 },

  buildSources: (c): Record<number, number> => {
    if (!trainEngaged(c)) return {};
    // ERB 41: base, then 411's own 親密 bracket + the universal favor bonus.
    let kanraku = 400;
    kanraku += bracketBonus(c.tAbl(ABL_ID.親密), SHINMITSU_PLEASURE_TRAIN_TIERS);
    kanraku += favorPleasureBonus(c.favor);
    if (kanraku < 0) kanraku = 0; // ERB 77
    return { [SOURCE_ID.歓楽]: kanraku };
  },

  body: (c) => {
    const grant = (slot: { state: { EXP: Record<number, number> } }, n: number) => {
      slot.state.EXP[EXP_ID.戦闘経験] = (slot.state.EXP[EXP_ID.戦闘経験] ?? 0) + n;
    };

    // ERB 184: master always gains 1 (even drilling alone).
    grant(c.master, 1);

    if (trainEngaged(c)) {
      // ERB 43-44: target shares the master's CASE-0 BASE drain.
      c.t.state.BASE[BASE_ID.体力] = (c.t.state.BASE[BASE_ID.体力] ?? 0) - 200;
      c.t.state.BASE[BASE_ID.気力] = (c.t.state.BASE[BASE_ID.気力] ?? 0) - 200;

      const cm = c.mAbl(ABL_ID.战斗能力);
      const ct = c.tAbl(ABL_ID.战斗能力);
      if (cm >= ct) grant(c.t, 2); // ERB 50 (non-DLC: the *等级重置 term is 0)
      if (cm < ct - 2) grant(c.master, 1); // ERB 56 (non-DLC arm)
      // ERB 79-80.
      grant(c.master, 1);
      grant(c.t, 1);
    }
  },

  narration: (c, favorDelta) => {
    if (!trainEngaged(c)) {
      // Fallback only. The resolver prepends original `TRAIN_MESSAGE` prose
      // and the factory appends the focused character's authored kojo when
      // available; this remains readable when either bundle is unavailable.
      return `%CALLNAME:MASTER%进行了战斗训练。`;
    }
    return `%CALLNAME:MASTER%和%CALLNAME:TARGET%进行了战斗训练。好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`;
  },
};

export const comf411HandlerEntry: HandlerEntry = makeComfHandler(comf411Def);
