/**
 * Phase 7A — `COMF313 胸愛撫` (chest caress) settlement, as a `ComfDef`.
 *
 * Ports `@COM313` (`ERB/コマンド関連/COMF/日常系/COMF313 胸愛撫.ERB`),
 * 通常 (ELSE, non-time-stop) arm. This command has NO outcome roll
 * (no RAND/dice, no great/fail branching) — greatThreshold=0 and
 * failThreshold=100 so the factory always produces 通常 (0).
 *
 * SOURCE build (ERB 37-66):
 *   - fixed: 快Ｂ 80 / 歓楽 100 / 欲情 50 / 露出 150 / 反感 700
 *   - 受動 = 120 + 240 * ABL:従順
 *   - ABL:親密 SELECTCASE:
 *       < 5:      反感 -= 親密*10
 *       < 10:     情愛 += 親密*5; 欲情 += 親密*10; 反感 -= 親密*20
 *       >= 10:    情愛 += 親密*15
 *         if !恋慕 && !炮友: 情愛 += 親密*5; 欲情 += 親密*20; 反感 -= 親密*50
 *         else:            欲情 += 親密*15; 反感 -= 親密*30
 *   - clamps: 反感 >= 0; 欲情 <= 500; 情愛 <= 300
 *   - ABL:PLAYER:指 bonus on 快Ｂ: >=4 → +50, else → +指*10
 *
 * No outcome scaling: the ERB has no great/fail TIMES branches, so all
 * SOURCE ids use MUL_NONE (outcome=0 always means the factory skips
 * scaling anyway, but the map documents the intent).
 *
 * Time: TIME += 5 (ERB 111).
 *
 * Persisted: none — EXP writes depend on HETEROSEX (deferred).
 *
 * **DEFERRED to Phase 7 (documented, off in a clean state):**
 *   - Time-stop arm (FLAG:70==1 && CFLAG:TARGET:344==0)
 *   - TFLAG:192==-1 KOJO forced fail (催眠/強行 arm)
 *   - DOWNBASE:体力+=5 / DOWNBASE:気力+=50
 *   - TEQUIP:1 > 1 着衣補正 (TIMES 快Ｂ/欲情/露出 *0.80) — P1-c implemented
 *     via tequipMul hook below (TEQUIP:1 bit 1 = はだけ不可).
 *   - HITOKE(1) (TIMES 露出/反感 *2.00)
 *   - TFLAG:信頼度管理 = -5
 *   - TALENT:自己愛<0 || TALENT:抵抗 → SOURCE:鬱屈 += 20
 *   - EXP writes (HETEROSEX-dependent)
 *   - STAIN:PLAYER:手 ⇔ STAIN:Ｂ は now wired (below) — ERB 97-98.
 *   - IS_DATING_WITH_PLAYER / 约会
 *   - MAGIC_DLC_* / Five_Orgasm_Magic arms
 *   - CASE 1/-1/-2 arms (催眠/強行/…)
 */

import type { HandlerEntry } from "../../types.js";
import { ABL_ID, BASE_ID, SOURCE_ID, TEQUIP_ID, times } from "../../../state/settlement.js";
import { makeComfHandler } from "../make-comf-handler.js";
import { MUL_NONE, type ComfDef } from "../comf-def.js";
import { STAIN_PART } from "../../../state/stain.js";
import { readTequip } from "../../../state/tequip.js";

/** ABL:PLAYER:指 — finger ability. ID 50 from Abl.csv (not yet in ABL_ID). */
const ABL_PLAYER_FINGER = 50;
/** TALENT:炮友 — friends-with-benefits. ID 185 from Talent.csv. */
const TALENT_FWB = 185;

export const comf313Def: ComfDef = {
  commandNo: 313,
  label: "胸愛撫",
  // @COM_ABLE313 (Slice 7): unconditional modelable gates — not co-sleeping,
  // target not working, master 気力>0. The 亲热<2/睡眠 gates are conditional
  // on !FLAG:70 (skipped during time-stop) and the 睡眠 arm allows 恶作剧, so
  // they're deferred rather than mis-modeled.
  gate: {
    notWhileCoSleeping: true,
    notWhileTargetWorking: true,
    requiresMasterStamina: true,
    deferredGates:
      "亲热<2 / 睡眠 (!FLAG:70-conditional, 睡眠 allows 恶作剧); FLAG:甲斐性無; 約會; TFLAG:61 MASTER_POSE; GETBIT(TCVAR:26,3)",
  },
  timeCost: 5,

  // No outcome roll in ERB — force always 通常 (0).
  greatThreshold: 0,   // roll < 0 → never
  failThreshold: 100,  // roll >= 100 → never (RAND:100 yields 0-99)

  // ERB 35-36 (通常 arm): 体力 5 + 気力 50
  downbase: { [BASE_ID.体力]: 5, [BASE_ID.気力]: 50 },

  buildSources: (c) => {
    const shinmitsu = c.tAbl(ABL_ID.親密);
    const juujun = c.tAbl(ABL_ID.従順);
    const playerFinger = c.mAbl(ABL_PLAYER_FINGER);
    const hasRenbo = c.tTalent(3 /* TALENT_ID.恋慕 */) !== 0;
    const hasFwb = c.tTalent(TALENT_FWB) !== 0;

    // Fixed bases (ERB 37-41)
    let kaiB = 80;
    const kanraku = 100;
    let yokujou = 50;
    const roshutsu = 150;
    let hankan = 700;
    let juudou = 120 + 240 * juujun;
    let jouai = 0;

    // ABL:親密 SELECTCASE (ERB 45-62)
    if (shinmitsu < 5) {
      hankan -= shinmitsu * 10;
    } else if (shinmitsu < 10) {
      jouai += shinmitsu * 5;
      yokujou += shinmitsu * 10;
      hankan -= shinmitsu * 20;
    } else {
      jouai += shinmitsu * 15;
      if (!hasRenbo && !hasFwb) {
        jouai += shinmitsu * 5;
        yokujou += shinmitsu * 20;
        hankan -= shinmitsu * 50;
      } else {
        yokujou += shinmitsu * 15;
        hankan -= shinmitsu * 30;
      }
    }

    // Clamps (ERB 63-66)
    if (hankan < 0) hankan = 0;
    if (yokujou > 500) yokujou = 500;
    if (jouai > 300) jouai = 300;

    // PLAYER:指 bonus (ERB 68-72)
    if (playerFinger >= 4) {
      kaiB += 50;
    } else {
      kaiB += playerFinger * 10;
    }

    // 着衣補正 TEQUIP:1 > 1 → TIMES 0.80 on 快Ｂ/欲情/露出 (DEFERRED)
    // HITOKE(1) → TIMES 2.00 on 露出/反感 (DEFERRED)

    return {
      [SOURCE_ID.快Ｂ]: kaiB,
      [SOURCE_ID.歓楽]: kanraku,
      [SOURCE_ID.欲情]: yokujou,
      [SOURCE_ID.露出]: roshutsu,
      [SOURCE_ID.反感]: hankan,
      [SOURCE_ID.受動]: juudou,
      [SOURCE_ID.情愛]: jouai,
    };
  },

  // No outcome scaling in ERB — all MUL_NONE.
  // (Outcome is always 0 → factory skips scaling anyway.)
  outcomeMul: {
    [SOURCE_ID.快Ｂ]: MUL_NONE,
    [SOURCE_ID.歓楽]: MUL_NONE,
    [SOURCE_ID.欲情]: MUL_NONE,
    [SOURCE_ID.露出]: MUL_NONE,
    [SOURCE_ID.反感]: MUL_NONE,
    [SOURCE_ID.受動]: MUL_NONE,
    [SOURCE_ID.情愛]: MUL_NONE,
  },

  // P1-c: TEQUIP:1 bit 1 (はだけ不可 — set when 上身衣服１ or 上半身内衣１
  // is worn) means "thick upper clothing; touch is muted". Apply the
  // ERB-mandated ×0.80 to 快Ｂ / 欲情 / 露出 (CLOTHES.ERB:511-514 →
  // COMF313.ERB dressing-penalty branch).
  tequipMul: (c, sources) => {
    const t1 = readTequip(c.t, TEQUIP_ID.上半身着衣状況);
    if (t1 & 0b0010) {
      if (sources[SOURCE_ID.快Ｂ] !== undefined) sources[SOURCE_ID.快Ｂ] = times(sources[SOURCE_ID.快Ｂ]!, 0.80);
      if (sources[SOURCE_ID.欲情] !== undefined) sources[SOURCE_ID.欲情] = times(sources[SOURCE_ID.欲情]!, 0.80);
      if (sources[SOURCE_ID.露出] !== undefined) sources[SOURCE_ID.露出] = times(sources[SOURCE_ID.露出]!, 0.80);
    }
  },

  // No TFLAG:97 manipulation in ERB — return 0.
  favorBias: () => 0,

  // ERB 97-98: 汚れ移動 — target Ｂ ⇔ master 手 (mutual OR). Unconditional
  // (both time-stop and normal arms run this — it lives outside the IF).
  body: (c) => {
    const tb = c.t.state.STAIN[STAIN_PART.Ｂ] ?? 0;
    const m1 = c.master.state.STAIN[STAIN_PART.手] ?? 0;
    c.t.state.STAIN[STAIN_PART.Ｂ] = tb | m1;
    c.master.state.STAIN[STAIN_PART.手] = m1 | tb;
  },

  // EXP writes depend on HETEROSEX (deferred); no TCVAR markers.

  narration: (_c, favorDelta) => {
    const word = "爱抚了";
    return `%CALLNAME:MASTER% ${word} %CALLNAME:TARGET%'s chest；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`;
  },
};

export const comf313HandlerEntry: HandlerEntry = makeComfHandler(comf313Def);
