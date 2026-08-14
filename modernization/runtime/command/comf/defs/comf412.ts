/**
 * Phase 7 — `COMF412 勉強` (study) settlement, as a `ComfDef`.
 *
 * Ports the deterministic core of `@COM412`
 * (`ERB/コマンド関連/COMF/日常系/COMF412 勉強.ERB`).
 *
 * **Family exemplar — "chore-help".** 勉強 is the first faithful port of
 * eraTW's master-centric daily-activity shape: the player always pays
 * BASE/time/EXP, and *if* a chara is present-and-helping a SOURCE block
 * fires on that chara. This is a different skeleton from the
 * target-directed touch commands (302/307/…): it needs the factory's
 * `requiresTarget: false` + optional-target tolerance (added this phase),
 * and it shares the bracketed 歓楽 sub-formulas in `source-brackets.ts`
 * with 304/410. Porting a sibling (411/470/…) is now a thin config.
 *
 * **Faithful core captured:**
 *   - DOWNBASE master 体力 -100 / 気力 -300 (ERB 22-23, the no-furniture branch)
 *   - TIME += 60 (ERB 135, the no-weather-bonus CASEELSE branch)
 *   - SOURCE:歓楽 = 200 + 従順-bracket + 好感度-bracket, clamped ≥0 — only
 *     when a chara is present, awake, and not currently working
 *     (`TARGET>0 && !CFLAG:睡眠 && CFLAG:行動 != 5`, ERB 26)
 *   - EXP:学習経験 grants (ERB 36/38/66/67/140):
 *       · master always +1 (line 140, runs even with no helper)
 *       · with a helper: master +1, target +1 (non-DLC, lines 66-67),
 *         target +2 if master 教養 > target 教養 (line 36),
 *         master +1 if master 教養 < target 教養 - 2 (line 38)
 *
 * **DEFERRED (documented, matching the 5C/5D port precedent):**
 *   - Furniture DOWNBASE variant (`ITEM:榉木桌椅` 1/2/3 → 90/270, 80/240,
 *     70/210) — ITEM is not modeled in GameState yet.
 *   - Weather/wind TIME bonuses (`TIME:5`/`WIND_VELOCITY` → 30/45 min) and
 *     `IS_WISEMAN()` — weather is not modeled yet; we take the 60-min base.
 *   - Item EXP bonuses (`ITEM:103/214/榉木桌椅` + `RAND` — lines 141-146).
 *   - `TFLAG:信頼度管理` / `情緒上昇抑制` (trust block — deferred uniformly
 *     in `source-check.ts`, same as every other port).
 *   - `CFLAG:同行 += 60` companion-time accrual (line 138).
 *   - All `MAGIC_DLC*` arms (DLC reward EXP, 禁断的知識 transfer, 約會経験).
 *   - `M_TFLAG:时间因子类型` time-factor tag.
 *
 * **No outcome roll.** 412 has no `RAND`/`TFLAG:193` great/normal/fail
 * split, so the factory's outcome is pinned to 通常 (great/fail thresholds
 * set unreachable). The factory still draws one RNG int per call; with no
 * Emuera oracle (project strategy) that unused draw is harmless and tests
 * don't depend on it.
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
  JUUJUN_PLEASURE_CHORE_TIERS,
} from "../source-brackets.js";

/**
 * The SOURCE/EXP block fires only when the target chara is present,
 * awake, and not currently working (ERB 26:
 * `TARGET>0 && !CFLAG:睡眠 && CFLAG:行動 != 5`).
 */
function studyEngaged(c: ComfCtx): boolean {
  return (
    c.hasTarget &&
    c.tCflag(CFLAG_ID.睡眠) === 0 &&
    c.tCflag(CFLAG_ID.行动) !== 5
  );
}

export const comf412Def: ComfDef = {
  commandNo: 412,
  label: "勉強",

  // Master-centric: studying alone is valid; a chara may join.
  requiresTarget: false,

  // ERB COM_ABLE412: `勉強可(現在位置)` unless the deferred self-room desk /
  // gap-guest exceptions apply. The base room flag covers the visible menu.
  gate: { requiresStudyRoom: true },

  // No outcome roll — pin to 通常 (thresholds unreachable for roll 0..99).
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  // ERB 135: the no-weather-bonus branch (weather deferred).
  timeCost: 60,

  // ERB 22-23: the no-furniture branch (ITEM deferred).
  downbase: { [BASE_ID.体力]: 100, [BASE_ID.気力]: 300 },

  buildSources: (c): Record<number, number> => {
    if (!studyEngaged(c)) return {};
    // ERB 27: fixed base, then the two shared brackets.
    let kanraku = 200;
    kanraku += bracketBonus(c.tAbl(ABL_ID.従順), JUUJUN_PLEASURE_CHORE_TIERS);
    kanraku += favorPleasureBonus(c.favor);
    if (kanraku < 0) kanraku = 0; // ERB 63
    return { [SOURCE_ID.歓楽]: kanraku };
  },

  body: (c) => {
    const grant = (slot: { state: { EXP: Record<number, number> } }, n: number) => {
      slot.state.EXP[EXP_ID.学習経験] = (slot.state.EXP[EXP_ID.学習経験] ?? 0) + n;
    };

    // ERB 140: master always gains 1 (even studying alone).
    grant(c.master, 1);

    if (studyEngaged(c)) {
      const km = c.mAbl(ABL_ID.教養);
      const kt = c.tAbl(ABL_ID.教養);
      if (km > kt) grant(c.t, 2); // ERB 36
      if (km < kt - 2) grant(c.master, 1); // ERB 38
      // ERB 66-67: non-DLC path (DLC deferred → treated inactive).
      grant(c.master, 1);
      grant(c.t, 1);
    }
  },

  narration: (c, favorDelta) => {
    if (!studyEngaged(c)) {
      return `%CALLNAME:MASTER%独自一人学习了。`;
    }
    return `%CALLNAME:MASTER%与%CALLNAME:TARGET%一同学习；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}。`;
  },
};

export const comf412HandlerEntry: HandlerEntry = makeComfHandler(comf412Def);
