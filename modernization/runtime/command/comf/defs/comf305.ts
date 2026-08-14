/**
 * Phase 7 — `COMF305 膝枕してもらう` (receive lap pillow) settlement, as a `ComfDef`.
 *
 * Ports `@COM305` (`ERB/コマンド関連/COMF/日常系/COMF305 膝枕してもらう.ERB`),
 * the 通常 (`SELECTCASE TFLAG:192` / `CASE 0`) arm — the 体型 mismatch
 * (TALENT:MASTER:体型 > TALENT:体型 + 2) early-return is **C-tier deferred**
 * (it does its own BASE drain + full settlement and is a hard fail).
 *
 * Outcome roll (ERB CASE 0):
 *   - `LOCAL = RAND:110` → maxRoll 110.
 *   - `LOCAL:2 = 9`; `IF LOCAL <= LOCAL:2` → 大成功 ⇒ roll <= 9 ⇒ greatThreshold 10.
 *   - `LOCAL:1 = 90 + GET_SUCCESS_RATE()/5` (deferred → 90), clamped ≤ 109;
 *     `IF LOCAL >= LOCAL:1` → 失敗 ⇒ failThreshold 90.
 *   - `TIME += 20` → timeCost.
 *
 * SOURCE build (ERB 76-128):
 *   - fixed: 情愛 170 / 露出 55 / 反感 50 (+150 on 失敗)
 *   - ABL:親密 bracket adds to 情愛 (≤8 also adds 露出 + 欲望*10)
 *   - CFLAG:好感度 bracket (ERB 102-113): 3 different forms on 情愛/恭順/歓楽
 *     — 恭順 ≥ 0 floor
 *   - 受動 = 120 + 240 * ABL:従順
 *
 * Outcome scaling (ERB 133-147):
 *   - 情愛: great 1.50 / fail 0.50
 *   - 受動: great 2.00 / fail 0.50
 *   - 露出: great 1.80 / fail 0.40
 *   - 反感 is NOT outcome-scaled (no `TIMES SOURCE:反感`) → MUL_NONE
 *
 * favorBias (ERB 117-125): low-favor penalty brackets (CFLAG:2 <=50/100/250).
 *
 * DOWNBASE (ERB 73-74): 気力 100 (target) + MASTER:気力 50.
 * Combined as master 50 here, target 100 written in body (factory drains master only).
 *
 * Persisted: `TCVAR:310 = 1440*DAY + TIME` (膝枕時刻 marker, ERB 151).
 *
 * **DEFERRED (documented, off in a clean state):**
 *   - 体型 mismatch early-return (ERB 5-15) — C-tier (RETURN -1 with full settlement)
 *   - MAGIC_DLC_大成功相关 / M_TFLAG:成功 (ERB 23-24, 47-48, 71-72)
 *   - TFLAG:102 == 3 先制 floor (ERB 69-70)
 *   - TFLAG:信頼度管理 (ERB 31, 36, 41, 52, 57, 62) — TRUST_CALC input
 *   - TFLAG:情緒BONUS (ERB 141, 146) — FAVOR_CALC input
 *   - CASE 1 強制成功 / CASE -1 強制失敗 / CASE -2 指令終了 arms (ERB 43-66)
 *   - COM_KOJO_CALL on early-return (ERB 14)
 *   - SET_DERAY(6, TARGET) (ERB 149) — post-settlement delay
 *   - 露出 ×0.90 deviation on 通常 (ERB 140) — factory outcomeMul has no per-source 通常 slot
 */

import type { HandlerEntry } from "../../types.js";
import { ABL_ID, BASE_ID, SOURCE_ID } from "../../../state/settlement.js";
import { makeComfHandler } from "../make-comf-handler.js";
import { MUL_NONE, type ComfDef, type OutcomeMul } from "../comf-def.js";

/** TCVAR:膝枕時刻 = 310 (same as comf336 — TCVAR.als id=310). */
const TCVAR_HIZAMAKURA = 310;

/** 情愛: great 1.50 / fail 0.50. */
const MUL_JOUAI: OutcomeMul = { great: 1.5, fail: 0.5 };
/** 受動: great 2.00 / fail 0.50. */
const MUL_JUDOU: OutcomeMul = { great: 2.0, fail: 0.5 };
/** 露出: great 1.80 / fail 0.40. */
const MUL_ROSHUTSU: OutcomeMul = { great: 1.8, fail: 0.4 };

export const comf305Def: ComfDef = {
  commandNo: 305,
  label: "膝枕してもらう",
  timeCost: 20,
  maxRoll: 110,
  greatThreshold: 10, // LOCAL <= 9 → 大成功
  failThreshold: 90, // LOCAL:1 = 90 + GET_SUCCESS_RATE()/5 (deferred → 90)

  // ERB 73-74: 気力 100 (target) + MASTER:気力 50.
  // Factory `downbase` is master-only → 50 here; target 100 in body.
  downbase: { [BASE_ID.気力]: 50 },

  buildSources: (c) => {
    const shinmitsu = c.tAbl(ABL_ID.親密);
    const yokubo = c.tAbl(ABL_ID.欲望);
    const favor = c.favor; // CFLAG:2 好感度 (pre-command)

    // Fixed bases (ERB 77-79)
    let jouai = 170;
    let roshutsu = 55;
    let hankan = 50;
    // 反感 +150 on 失敗 (ERB 80-81)
    if (c.outcome === -1) hankan += 150;

    // ABL:親密 bracket (ERB 84-99)
    if (shinmitsu <= 1) {
      jouai += shinmitsu * 20;
    } else if (shinmitsu <= 3) {
      jouai += 200 + shinmitsu * 20;
    } else if (shinmitsu <= 5) {
      jouai += 400 + shinmitsu * 20;
    } else if (shinmitsu <= 8) {
      jouai += 600 + shinmitsu * 30;
      roshutsu += 200 + yokubo * 10;
    } else if (shinmitsu <= 11) {
      jouai += 800 + shinmitsu * 30;
      roshutsu += 300 + yokubo * 10;
    } else {
      jouai += 1800 + shinmitsu * 20;
      roshutsu += 700 + yokubo * 10;
    }

    // CFLAG:好感度 bracket (ERB 102-113) — 3 forms on 情愛/恭順/歓楽.
    let kyoujun = 0;
    let kanraku = 0;
    if (favor <= 500) {
      jouai += Math.trunc(favor / 2);
      kyoujun = Math.trunc(favor / 5);
    } else if (favor <= 5000) {
      kyoujun = 150 + Math.trunc(favor / 20);
      jouai += 400 + Math.trunc((favor - 500) / 5);
      kanraku = 400 + Math.trunc((favor - 500) / 4);
    } else {
      kyoujun = 400 + Math.trunc(favor / 100);
      jouai += 1200 + Math.trunc((favor - 5000) / 7);
      kanraku = 1200 + Math.trunc((favor - 5000) / 4);
    }
    if (kyoujun < 0) kyoujun = 0;

    // 受動 (ERB 128)
    const judo = 120 + 240 * c.tAbl(ABL_ID.従順);

    const sources: Record<number, number> = {
      [SOURCE_ID.情愛]: jouai,
      [SOURCE_ID.受動]: judo,
      [SOURCE_ID.反感]: hankan,
    };
    if (roshutsu !== 0) sources[SOURCE_ID.露出] = roshutsu;
    if (kyoujun !== 0) sources[SOURCE_ID.恭順] = kyoujun;
    if (kanraku !== 0) sources[SOURCE_ID.歓楽] = kanraku;

    return sources;
  },

  // ERB 133-147. 反感 has no TIMES anywhere → MUL_NONE.
  outcomeMul: {
    [SOURCE_ID.情愛]: MUL_JOUAI,
    [SOURCE_ID.受動]: MUL_JUDOU,
    [SOURCE_ID.露出]: MUL_ROSHUTSU,
    [SOURCE_ID.恭順]: MUL_NONE,
    [SOURCE_ID.歓楽]: MUL_NONE,
    [SOURCE_ID.反感]: MUL_NONE,
  },

  // ERB 117-125: 好感度 penalty brackets. None of the other commands' 親密 bias applies here.
  favorBias: (c) => {
    const favor = c.favor;
    let bias = 0;
    if (favor <= 50) bias -= 3;
    else if (favor <= 100) bias -= 2;
    else if (favor <= 250) bias -= 1;
    return bias;
  },

  // ERB 73-74: target 気力 100 + ERB 151: 膝枕時刻 marker.
  body: (c) => {
    c.t.state.BASE[BASE_ID.気力] = (c.t.state.BASE[BASE_ID.気力] ?? 0) - 100;
    // 1440*DAY+TIME marker = tickValue (absolute minute). Was double-counting
    // the day via `1440*dayIndex + tickValue` — see comf302 / oracle 9912.
    c.t.state.TCVAR[TCVAR_HIZAMAKURA] = c.next.time.tickValue;
  },

  narration: (c, favorDelta) => {
    const word = c.outcome === 1 ? "幸福地" : c.outcome === -1 ? "尴尬地" : "静静";
    return `%CALLNAME:MASTER% ${word} 把头枕在了%CALLNAME:TARGET%的膝上；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`;
  },
};

export const comf305HandlerEntry: HandlerEntry = makeComfHandler(comf305Def);
