/**
 * Phase 7 — `COMF416 演奏する` (perform music) settlement, as a `ComfDef`.
 *
 * Ports `@COM416` + `@COM416_1`
 * (`ERB/コマンド関連/COMF/日常系/COMF416 演奏する.ERB`),
 * per-target settlement arm (COM416_1).
 *
 * Outcome roll (ERB 106-128, CASE 0 / 通常):
 *   - `LOCAL = RAND:100`              → maxRoll = 100
 *   - `LOCAL:2 = 9 + ABL:MASTER:音楽技能` → greatThreshold = 10 + mAbl(音楽技能)
 *     **DYNAMIC**: the factory uses a static `greatThreshold`; skill bonus is
 *     DEFERRED. Default greatThreshold 10 (skill = 0 base).
 *   - `LOCAL:1 = 90 + GET_SUCCESS_RATE()/5` → failThreshold = 90 (deferred).
 *
 * SOURCE build (COM416_1, ERB 233-247):
 *   - SOURCE:歓楽 = 700 + ABL:MASTER:音楽技能 * 300 + ABL:親密 * 50
 *   - SOURCE:征服 = 100 * (ABL:MASTER:音楽技能 + 1) + ABL:親密 * 30
 *
 * Outcome scaling (ERB 238-247):
 *   - 失敗: 歓楽 ×0.10, 征服 ×0.50
 *   - 通常: both ×1.00
 *   - 大成功: both ×2.00
 *   → 歓楽 = MUL_PLEASURE, 征服 = MUL_POSITIVE.
 *
 * Master 音楽技能 scaling on 歓楽 (ERB 249-259):
 *   - skill>=5: ×2.0, ==4: ×1.5, ==3: ×1.0, ==2: ×0.5, else: ×0.10
 *   → masterAbility { ablId=音楽技能, table, sourceIds=[歓楽] }
 *
 * Master TALENT scaling on 歓楽 (ERB 261-270):
 *   - TALENT:MASTER:音楽知識(161) → ×1.50
 *   - TALENT:MASTER:音感(162)==2 → ×2.00
 *   - TALENT:MASTER:音感(162)==1 → ×1.50
 *   - TALENT:MASTER:音感(162)==-1 → ×0.50
 *   → applied in tequipMul (runs after masterAbility, matching ERB order).
 *
 * Target talent subroutine (COM416_1, ERB 274-326):
 *   SELECTCASE TALENT:TARGET:音楽知識(161):
 *   - CASE 1 (楽器知識): if ACCOMPANY_ABLE → 歓楽×2.0, BASE drain +200気力 +100体力,
 *     TCVAR:演奏参加=1, EXP:演奏経験++
 *   - CASE 2 (歌唱知識): if ACCOMPANY_ABLE → 歓楽×2.0, BASE drain +200気力 +100体力,
 *     TCVAR:演奏参加=2, EXP:歌唱経験++
 *   - CASE 3 (舞踏知識): if ACCOMPANY_ABLE → 歓楽×2.0, BASE drain +200気力 +100体力,
 *     TCVAR:演奏参加=3, EXP:舞踏経験++
 *   - CASEELSE: if master音楽技能<=target音楽技能 || target has 音楽知識 → EXP:演奏経験++
 *   → ×2.0 on 歓楽 applied inline in buildSources; BASE/EXP/TCVAR in body.
 *
 * Per-target BASE drain (COM416_1, ERB 231):
 *   - DOWNBASE:気力 += 100 (always per target) → applied in body.
 *
 * Master BASE drain (COM416, ERB 155-156):
 *   - DOWNBASE:MASTER:体力 = 300, DOWNBASE:MASTER:気力 = 300
 *
 * 宴会 gate (ERB 17-28): when target location is a banquet venue, music-skill
 *   floor checks apply. DEFERRED — requires location-resolution infrastructure.
 *
 * **DEFERRED to later phases (documented, off in a clean state):**
 *   - Dynamic greatThreshold (LOCAL:2 = 9 + ABL:MASTER:音楽技能) — factory uses
 *     static greatThreshold.
 *   - `MAGIC_DLC_大成功相关` (LOCAL:2 += MAGIC_SuccessRate, M_TFLAG:成功 mirror).
 *   - Multi-target loop (FOR LOCAL, 1, NUM_TARGET + 1) — the factory handles a
 *     single target; the outer loop and cross-target scaling (BAND_BONUS,
 *     DANCE_BONUS, MUSIC_BONUS, per-target SOURCE 歓楽/征服/反感/鬱屈 adjust)
 *     are a Phase 7 orchestrator concern.
 *   - `TFLAG:192` arms: 強制成功(CASE 1), 強制失敗(CASE -1), 指令終了(CASE -2).
 *   - 宴会場所在判定(MASTER) — banquet-venue detection.
 *   - MUSIC_ABLE instrumental checks (乐器 30-34) — deferred to COM_ABLE phase.
 *   - ITEM:演奏指南書 bonus (EXP:演奏経験 += 2, line 59-60).
 *   - 投石 (THROW_STONE) and INTERRUPTED paths (ERB 63-104).
 *   - 约会 (IS_DATING_WITH_PLAYER) experience grants.
 *   - KOJO messages (KOJO_MESSAGE_SEND).
 *   - TFLAG:好感度BONUS = BAND_BONUS * 50.
 *   - 演奏集合 (eru-shuugo) — NPC congregation.
 *   - FAVOR_CALC, TRUST_CALC, TALENT/MARK/DLC personality modifiers.
 *   - GET_SUCCESS_RATE.
 */

import type { HandlerEntry } from "../../types.js";
import { ABL_ID, BASE_ID, CFLAG_ID, SOURCE_ID } from "../../../state/settlement.js";
import { makeComfHandler } from "../make-comf-handler.js";
import {
  MUL_PLEASURE,
  MUL_POSITIVE,
  type ComfDef,
} from "../comf-def.js";

// ---------------------------------------------------------------------------
// IDs not yet in settlement.ts enums
// ---------------------------------------------------------------------------

/** TALENT id for 音楽知識 (music knowledge). 1=楽器知識 2=歌唱知識 3=舞踏知識. */
const TALENT_ONGAKU_CHISHIKI = 161;
/** TALENT id for 音感 (sense of pitch). -1=音痴 1=音感 2=絶対音感. */
const TALENT_ONKAN = 162;

/** TCVAR id for 演奏日時 (performance timestamp). Custom ERB variable. */
const TCVAR_ENSOU_TIME = 280;
/** TCVAR id for 演奏参加 (performance participation type). 1=楽器 2=歌唱 3=舞踏. */
const TCVAR_ENSOU_SANKA = 281;

/** EXP id for 演奏経験 (performance experience). From exp.als id=79. */
const EXP_ENSOU = 79;
/** EXP id for 歌唱経験 (singing experience). From exp.als id=80. */
const EXP_KASHOU = 80;
/** EXP id for 舞踏経験 (dance experience). From exp.als id=83. */
const EXP_BUTOU = 83;

// ---------------------------------------------------------------------------
// ComfDef
// ---------------------------------------------------------------------------

export const comf416Def: ComfDef = {
  commandNo: 416,
  label: "演奏する",
  timeCost: 30,
  maxRoll: 100,

  // ERB: LOCAL:2 = 9 + ABL:MASTER:音楽技能
  // greatThreshold is static in the factory; skill bonus DEFERRED.
  // Base = 10 (when skill is 0). 大成功 when roll < 10.
  greatThreshold: 10,

  // ERB: LOCAL:1 = 90 + GET_SUCCESS_RATE()/5 (deferred → 90)
  failThreshold: 90,

  // ERB 155-156: DOWNBASE:MASTER:体力 = 300, DOWNBASE:MASTER:気力 = 300
  downbase: { [BASE_ID.体力]: 300, [BASE_ID.気力]: 300 },

  buildSources: (c) => {
    const musicSkill = c.mAbl(ABL_ID.音楽技能); // 45
    const shinmitsu = c.tAbl(ABL_ID.親密);      // 9

    // ERB 234: SOURCE:歓楽 = 700 + ABL:MASTER:音楽技能 * 300 + ABL:親密 * 50
    let kanraku = 700 + musicSkill * 300 + shinmitsu * 50;

    // ERB 236: SOURCE:征服 = 100 * (ABL:MASTER:音楽技能 + 1) + ABL:親密 * 30
    let seifuku = 100 * (musicSkill + 1) + shinmitsu * 30;

    // Target talent subroutine (ERB 274-326):
    // SELECTCASE TALENT:TARGET:音楽知識
    //   CASE 1 (楽器知識), CASE 2 (歌唱知識), CASE 3 (舞踏知識):
    //     IF ACCOMPANY_ABLE → 歓楽 ×2.0, BASE drain, TCVAR, EXP
    //   CASEELSE: if master音楽技能<=target音楽技能 || target has 音楽知識 → EXP++
    const targetMusicTalent = c.tTalent(TALENT_ONGAKU_CHISHIKI);

    // ACCOMPANY_ABLE check: BASE:気力 >= 200, master音楽技能 >= 3, not working
    const targetBaseVitality = c.t.state.BASE[BASE_ID.気力] ?? 0;
    const accompanies =
      targetMusicTalent >= 1 && targetMusicTalent <= 3 &&
      targetBaseVitality >= 200 &&
      musicSkill >= 3 &&
      c.tCflag(CFLAG_ID.行动) !== 5; // ERB ACCOMPANY_ABLE: CFLAG:ARG:行動 == 5 (working)

    if (accompanies) {
      kanraku = Math.trunc(kanraku * 2); // ERB 282/298/314: TIMES SOURCE:歓楽, 2.00
      // Additional ×1.50 on 征服 when master音楽技能 >= target音楽技能 (ERB 289/304/320)
      if (musicSkill >= (c.tAbl(ABL_ID.音楽技能))) {
        seifuku = Math.trunc(seifuku * 1.5);
      }
    }

    return {
      [SOURCE_ID.歓楽]: kanraku,
      [SOURCE_ID.征服]: seifuku,
    };
  },

  // ERB 238-247: outcome-based source scaling
  outcomeMul: {
    [SOURCE_ID.歓楽]: MUL_PLEASURE,  // great 2.00 / fail 0.10
    [SOURCE_ID.征服]: MUL_POSITIVE,  // great 2.00 / fail 0.50
  },

  // ERB 249-259: Master 音楽技能 scaling on SOURCE:歓楽
  // skill>=5: ×2.0, ==4: ×1.5, ==3: ×1.0, ==2: ×0.5, else: ×0.10
  masterAbility: {
    ablId: ABL_ID.音楽技能, // 45
    table: [0.10, 0.50, 1.00, 1.50, 2.00, 2.00], // indices 0-5+
    sourceIds: [SOURCE_ID.歓楽],
  },

  // ERB 261-270: Master TALENT scaling on SOURCE:歓楽
  // TALENT:MASTER:音楽知識(161) → ×1.50
  // TALENT:MASTER:音感(162)==2 → ×2.00, ==1 → ×1.50, ==-1 → ×0.50
  tequipMul: (c, sources) => {
    if (!sources[SOURCE_ID.歓楽]) return;

    // TALENT:MASTER:音楽知識 (ERB 261-262)
    const musicKnowledge = c.master.state.TALENT[TALENT_ONGAKU_CHISHIKI] ?? 0;
    if (musicKnowledge !== 0) {
      sources[SOURCE_ID.歓楽] = Math.trunc(sources[SOURCE_ID.歓楽]! * 1.5);
    }

    // TALENT:MASTER:音感 (ERB 264-270)
    const onkan = c.master.state.TALENT[TALENT_ONKAN] ?? 0;
    if (onkan === 2) {
      sources[SOURCE_ID.歓楽] = Math.trunc(sources[SOURCE_ID.歓楽]! * 2.0);
    } else if (onkan === 1) {
      sources[SOURCE_ID.歓楽] = Math.trunc(sources[SOURCE_ID.歓楽]! * 1.5);
    } else if (onkan === -1) {
      sources[SOURCE_ID.歓楽] = Math.trunc(sources[SOURCE_ID.歓楽]! * 0.5);
    }
  },

  /**
   * Per-target persisted side writes (COM416_1).
   *
   * Always (ERB 231):
   *   - DOWNBASE:気力 += 100
   *
   * When target accompanies (音楽知識 CASE 1/2/3):
   *   - DOWNBASE:気力 += 200, DOWNBASE:体力 += 100 (ERB 280-281/296-297/312-313)
   *   - TCVAR:演奏日時 = 1440 * DAY + TIME (ERB 279/295/311)
   *   - TCVAR:演奏参加 = 1/2/3 (ERB 283/299/315)
   *   - EXP:演奏経験++/歌唱経験++/舞踏経験++ (ERB 284/300/316)
   *   - If master音楽技能 >= target音楽技能: additional EXP++ (ERB 287/303/319)
   *
   * CASEELSE (ERB 323-325):
   *   - If master音楽技能 <= target音楽技能 or target has 音楽知識:
   *     EXP:MASTER:演奏経験++
   */
  body: (c) => {
    // ERB 231: DOWNBASE:気力 += 100 (always per target)
    c.t.state.BASE[BASE_ID.気力] = (c.t.state.BASE[BASE_ID.気力] ?? 0) - 100;

    const targetMusicTalent = c.tTalent(TALENT_ONGAKU_CHISHIKI);
    const musicSkill = c.mAbl(ABL_ID.音楽技能);
    const targetMusicSkill = c.tAbl(ABL_ID.音楽技能);
    const targetBaseVitality = c.t.state.BASE[BASE_ID.気力] ?? 0;

    // Restore the pre-drain vitality for ACCOMPANY_ABLE check
    // (ERB checks BASE before the DOWNBASE write)
    const vitalityBeforeDrain = targetBaseVitality + 100;

    const accompanies =
      targetMusicTalent >= 1 && targetMusicTalent <= 3 &&
      vitalityBeforeDrain >= 200 &&
      musicSkill >= 3 &&
      c.tCflag(CFLAG_ID.行动) !== 5; // ERB ACCOMPANY_ABLE: CFLAG:ARG:行動 == 5 (working)

    if (accompanies) {
      // ERB 280/296/312: DOWNBASE:気力 += 200, DOWNBASE:体力 += 100
      c.t.state.BASE[BASE_ID.気力] = (c.t.state.BASE[BASE_ID.気力] ?? 0) - 200;
      c.t.state.BASE[BASE_ID.体力] = (c.t.state.BASE[BASE_ID.体力] ?? 0) - 100;

      // ERB 279/295/311: TCVAR:演奏日時 = 1440 * DAY + TIME
      // = tickValue (absolute minute); old `1440*dayIndex + tickValue` doubled
      // the day — see comf302 / oracle 9912.
      c.t.state.TCVAR[TCVAR_ENSOU_TIME] = c.next.time.tickValue;

      // ERB 283/299/315: TCVAR:演奏参加 = 1/2/3
      c.t.state.TCVAR[TCVAR_ENSOU_SANKA] = targetMusicTalent;

      // ERB 284/300/316: EXP grant (演奏経験/歌唱経験/舞踏経験)
      let expId: number;
      if (targetMusicTalent === 1) expId = EXP_ENSOU;
      else if (targetMusicTalent === 2) expId = EXP_KASHOU;
      else expId = EXP_BUTOU;
      c.master.state.EXP[expId] = (c.master.state.EXP[expId] ?? 0) + 1;

      // ERB 287/303/319: If master音楽技能 >= target音楽技能 → additional EXP
      if (musicSkill >= targetMusicSkill) {
        c.master.state.EXP[expId] = (c.master.state.EXP[expId] ?? 0) + 1;
      }
    } else {
      // CASEELSE (ERB 323-325): if master音楽技能 <= target音楽技能 or target has 音楽知識
      if (musicSkill <= targetMusicSkill || targetMusicTalent !== 0) {
        c.master.state.EXP[EXP_ENSOU] = (c.master.state.EXP[EXP_ENSOU] ?? 0) + 1;
      }
    }
  },

  narration: (c, favorDelta) => {
    const adj =
      c.outcome === 1 ? "出色地"
      : c.outcome === -1 ? "磕磕绊绊地"
      : "";
    return `%CALLNAME:MASTER% ${adj}为%CALLNAME:TARGET%演奏了；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}。`;
  },
};

export const comf416HandlerEntry: HandlerEntry = makeComfHandler(comf416Def);
