/**
 * Phase 7 — `COMF306 お腹を撫でる` (stroke the belly) settlement, as a `ComfDef`.
 *
 * Ports `@COM306` (`ERB/コマンド関連/COMF/日常系/COMF306 お腹を撫でる.ERB`),
 * the 通常 arm (non-time-stop, non-妊娠). The 妊娠 override (ERB 29-38)
 * does a wholesale SOURCE rewrite (different bases, different DOWNBASE, EXP
 * grant) — **DEFERRED** as a state-conditional C-tier branch.
 *
 * **NO outcome roll in this command** — the `TFLAG:193` is assigned
 * directly from 親密/妊娠 gates (ERB 50-57):
 *   - `ABL:親密 <= 5` → TFLAG:193 = -1
 *   - `TALENT:妊娠` → TFLAG:193 = 1 (and +好感度 BONUS + 胎児愛情値)
 * In a clean state (親密≥6, 妊娠=0) outcome stays at the factory default 0
 * (greatThreshold=0, failThreshold=100 → always 通常).
 *
 * SOURCE build (ERB 20-48, 非妊娠 arm):
 *   - 歓楽 150 / 情愛 100 / 欲情 30 / 露出 10
 *   - 反感 = 150 - BASE:情緒/100  (情緒/clamp >= 0 in factory)
 *   - 受動 = 120
 *   - CUP:快Ｖ = 情緒/100 + 30 + ABL:PLAYER:指*5  (we don't model CUP)
 *   - !恋慕 && !思慕 → 歓楽 /= 2
 *   - TEQUIP:1 > 1 → TIMES 0.50 (快Ｖ) / 0.70 (欲情) / 0.30 (露出) — P1-c
 *     implemented via tequipMul below (TEQUIP:1 bit 1 = はだけ不可).
 *   - TALENT:自己愛<0 || TALENT:抵抗 → 鬱屈 += 20
 *
 * Time: TIME += 10.
 *
 * Persisted: none (EXP writes depend on HETEROSEX — DEFERRED).
 *
 * **DEFERRED (documented, off in a clean state):**
 *   - Time-stop arm (ERB 13-18) — different SOURCE quantities, BASE:MASTER:TSP-=10
 *   - 妊娠 override (ERB 29-38) — full SOURCE rewrite + EXP:愛情経験++
 *     + extra DOWNBASE — C-tier state-conditional branch
 *   - 好感度 delta on 親密<=5 and 妊娠 (ERB 50-57) — favorBias omitted in
 *     clean state (no TFLAG:97 directly written; the 失敗 path implicitly
 *     drives the 反感 source but the explicit 好感度 penalty is via TFLAG)
 *   - TEQUIP:1 > 1 clothing penalty (ERB 40-44) — TIMES 0.50/0.70/0.30
 *   - TFLAG:2 = 1 (破瓜抑制, ERB 10)
 *   - TFLAG:97 penalty brackets in ERB 51-54 (pre-set in 親密<=5 path)
 *   - 胎児愛情値 += 1 (ERB 56) on 妊娠 arm
 *   - HETEROSEX EXP writes (ERB 68-71)
 *   - IS_DATING_WITH_PLAYER / 约会, MAGIC_DLC_*, CASE 1/-1/-2 arms
 *   - HITOKE bystander, 強制成功/失敗/指令終了 arms
 */

import type { HandlerEntry } from "../../types.js";
import { ABL_ID, BASE_ID, SOURCE_ID, TALENT_ID, TEQUIP_ID, times } from "../../../state/settlement.js";
import { makeComfHandler } from "../make-comf-handler.js";
import { MUL_NONE, type ComfDef } from "../comf-def.js";
import { readTequip } from "../../../state/tequip.js";

/** TALENT id for 自己愛 (self-love / narcissism / repression). */
const TALENT_JIKOAI = 31;
/** TALENT id for 抵抗 (resistance). */
const TALENT_TEIKOU = 32;

export const comf306Def: ComfDef = {
  commandNo: 306,
  label: "お腹を撫でる",
  timeCost: 10,
  // No outcome roll in clean state. Force 通常 (0).
  greatThreshold: 0,   // roll < 0 → never
  failThreshold: 100,  // roll >= 100 → never (RAND:100 yields 0-99)

  // ERB 20-21 (通常 arm): 体力 5 + 気力 30
  downbase: { [BASE_ID.体力]: 5, [BASE_ID.気力]: 30 },

  buildSources: (c) => {
    // 情緒 — not in ComfCtx BASE read; 反感 formula uses it but in clean
    // state the formula's subtraction is zero. Use 0 → 反感 = 150.
    // (情緒-dependent formula is DEFERRED; factory can't read 情緒 safely.)
    const jousou = c.t.state.BASE[BASE_ID.情緒] ?? 0;
    let hankan = 150 - Math.trunc(jousou / 100);
    if (hankan < 0) hankan = 0;

    let kanraku = 150;
    const jouai = 100;
    const yokujo = 30;
    const roshutsu = 10;
    const judo = 120;

    // !恋慕 && !思慕 → 歓楽 /= 2 (ERB 45-48)
    const hasRenbo = c.tTalent(TALENT_ID.恋慕) !== 0;
    const hasShibo = c.tTalent(TALENT_ID.思慕) !== 0;
    if (!hasRenbo && !hasShibo) {
      kanraku = Math.trunc(kanraku / 2);
    }

    // TALENT:自己愛<0 || TALENT:抵抗 → 鬱屈 += 20 (ERB 62-63)
    let utsukutsu = 0;
    const jikoai = c.tTalent(TALENT_JIKOAI);
    const teikou = c.tTalent(TALENT_TEIKOU);
    if (jikoai < 0 || teikou !== 0) {
      utsukutsu = 20;
    }

    // Suppress unused-var warning for ABL:PLAYER:指 (used in DEFERRED CUP calc).
    void c.mAbl(ABL_ID.技巧);

    const sources: Record<number, number> = {
      [SOURCE_ID.歓楽]: kanraku,
      [SOURCE_ID.情愛]: jouai,
      [SOURCE_ID.欲情]: yokujo,
      [SOURCE_ID.露出]: roshutsu,
      [SOURCE_ID.反感]: hankan,
      [SOURCE_ID.受動]: judo,
    };
    if (utsukutsu !== 0) sources[SOURCE_ID.鬱屈] = utsukutsu;
    return sources;
  },

  // No outcome-based TIMES block in this command → MUL_NONE for everything emitted.
  outcomeMul: {
    [SOURCE_ID.歓楽]: MUL_NONE,
    [SOURCE_ID.情愛]: MUL_NONE,
    [SOURCE_ID.欲情]: MUL_NONE,
    [SOURCE_ID.露出]: MUL_NONE,
    [SOURCE_ID.反感]: MUL_NONE,
    [SOURCE_ID.受動]: MUL_NONE,
    [SOURCE_ID.鬱屈]: MUL_NONE,
  },

  // P1-c: TEQUIP:1 bit 1 (はだけ不可) applies ×0.50 欲情 / ×0.30 露出
  // (ERB 40-44 → tequipMul hook). NOTE: the ERB references 快Ｖ but
  // COMF306 doesn't build 快Ｖ in its source set (deferred CUP path),
  // so the 快Ｖ arm is omitted here — only the ratios ERB applies to
  // the actually-emitted sources are wired.
  tequipMul: (c, sources) => {
    const t1 = readTequip(c.t, TEQUIP_ID.上半身着衣状況);
    if (t1 & 0b0010) {
      if (sources[SOURCE_ID.欲情] !== undefined) sources[SOURCE_ID.欲情] = times(sources[SOURCE_ID.欲情]!, 0.70);
      if (sources[SOURCE_ID.露出] !== undefined) sources[SOURCE_ID.露出] = times(sources[SOURCE_ID.露出]!, 0.30);
    }
  },

  // No TFLAG:97 pre-seed in the non-妊娠/non-失敗 arm. favorBias omitted.

  narration: (_c, favorDelta) => {
    return `%CALLNAME:MASTER% 轻轻抚摸了%CALLNAME:TARGET%的肚子；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`;
  },
};

export const comf306HandlerEntry: HandlerEntry = makeComfHandler(comf306Def);
