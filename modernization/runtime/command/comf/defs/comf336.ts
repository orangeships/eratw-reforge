/**
 * Phase 7 — `COMF336 膝枕する` (lap pillow) settlement, as a `ComfDef`.
 *
 * Ports `@COM336` (`ERB/コマンド関連/COMF/日常系/COMF336 膝枕する.ERB`),
 * 通常 (`SELECTCASE TFLAG:192` / `CASE 0`) arm.
 *
 * Outcome roll (ERB 21-36, 通常 arm):
 *   - `LOCAL = ABL:親密*10 + TALENT:恋慕*50 + TALENT:幼稚*30
 *      - TALENT:羞恥心*20 - TALENT:自尊心*20`
 *   - Adjusted by BASE:体力 thresholds:
 *     > 80% → LOCAL -= 30;  < 40% → LOCAL += 30
 *   - `LOCAL = MAX(LOCAL, 10)`
 *   - `RAND:LOCAL > 120` → 大成功; `RAND:LOCAL < 30` → 失敗; else 通常
 *   - **DEFERRED**: complex RAND:LOCAL roll replaced by factory's default
 *     RAND:100 / greatThreshold:5 / failThreshold:90 (hasRand=false).
 *
 * SOURCE build (ERB 62-106):
 *   - fixed: 情愛 250 / 反感 150 (+150 on fail) / 受動 70→overridden
 *   - ABL:親密 brackets add 情愛 + 露出 + 恭順
 *   - SOURCE:受動 overridden to 150 + 300*ABL:従順 (ERB 86)
 *   - Outcome scaling: 情愛 ×{1.50/0.50}, 受動 ×{2.00/0.50},
 *     露出 ×{1.80/0.40}. 反感/恭順 are NOT outcome-scaled.
 *   - **DEVIATION**: 露出 ×0.90 on 通常 cannot be expressed (factory's
 *     outcomeMul has no per-source 通常 slot). Port uses great=1.80,
 *     fail=0.40; 通常 gets ×1.00 instead of ×0.90.
 *
 * DOWNBASE (ERB 57-58, 101-104):
 *   - Target: 気力 += 50 (handled in body — factory only drains master)
 *   - Master: 気力 += 100 (in `downbase`)
 *   - 大成功 extra: target 体力-=150, target 気力-=300, master 気力-=50 (body)
 *
 * Clock (ERB 101, 107): every outcome costs +20 minutes; 大成功 adds another
 * +20. TRACHECK_TIME applies the optional −4 before @COM336, so the modern
 * outcome-dependent timeCost folds that correction into one clock advance.
 *
 * ERB 110 writes global `TFLAG:膝枕した` after the command clock cost. Its
 * COM_ABLE336 consumer blocks repeat use for 45 minutes. Keep this in the
 * global TFLAG namespace; TCVAR 310 belongs to separate per-character routes.
 *
 * **DEFERRED (documented, off in a clean state):**
 *   - Complex RAND:LOCAL outcome roll with TALENT/BASE inputs
 *   - 露出 通常 ×0.90 (no per-source 通常 slot in outcomeMul)
 *   - TFLAG:情緒BONUS = 30/50 (used by deferred FAVOR_CALC)
 *   - SET_DERAY(6, TARGET)
 *   - CASE 1 強制成功 / CASE -1 強制失敗 / CASE -2 指令終了 arms
 *   - MAGIC_DLC_大成功相关 / M_TFLAG:成功
 */
import type { HandlerEntry } from "../../types.js";
import { ABL_ID, BASE_ID, SOURCE_ID } from "../../../state/settlement.js";
import { setTflag, TFLAG_ID } from "../../../state/tflag.js";
import { makeComfHandler } from "../make-comf-handler.js";
import {
  MUL_NONE,
  type ComfDef,
  type OutcomeMul,
} from "../comf-def.js";

/** Outcome multipliers for 露出: great 1.80, fail 0.40.
 *  通常 ×0.90 (ERB line 95) cannot be modeled — see docstring. */
const MUL_ROSHUTSU: OutcomeMul = { great: 1.80, fail: 0.40 };

export const comf336Def: ComfDef = {
  commandNo: 336,
  label: "膝枕する",
  gate: { tflagCooldown: { tflagId: TFLAG_ID.膝枕した, minutes: 45 } },
  timeCost: (c) => 20 + (c.outcome === 1 ? 20 : 0),
  // Default roll: RAND:100, greatThreshold:5, failThreshold:90.
  // Complex RAND:LOCAL with TALENT/BASE inputs deferred (hasRand=false).

  // ERB 58: DOWNBASE:MASTER:気力 += 100
  // Target 気力 drain (ERB 57: +50) handled in body — factory only drains master.
  // Combined per draft: 気力:150 → split as master 100 here + target 50 in body.
  downbase: { [BASE_ID.気力]: 100 },

  buildSources: (c) => {
    const shinmitsu = c.tAbl(ABL_ID.親密);
    const jujun = c.tAbl(ABL_ID.従順);
    const yokubo = c.tAbl(ABL_ID.欲望);

    // Fixed bases (ERB 62-64)
    let jouai = 250;
    let hanpatsu = 150; // 反感
    // 受動 = 70 (ERB 63) — overridden by line 86 formula below

    // 反感 +150 on failure (ERB 65-66, reads TFLAG:193 outcome)
    if (c.outcome === -1) {
      hanpatsu += 150;
    }

    let roshutsu = 0; // 露出
    let kyojun = 0;   // 恭順

    // ABL:親密 brackets (ERB 69-82)
    if (shinmitsu <= 5) {
      jouai += shinmitsu * 25;
    } else if (shinmitsu <= 8) {
      jouai += 600 + shinmitsu * 30;
      roshutsu += 200 + yokubo * 15;
    } else if (shinmitsu <= 11) {
      jouai += 800 + shinmitsu * 30;
      kyojun += shinmitsu * 40;
      roshutsu += 300 + yokubo * 20;
    } else {
      jouai += 1000 + shinmitsu * 40;
      kyojun += shinmitsu * 50;
      roshutsu += 700 + yokubo * 25;
    }

    // 受動 override (ERB 86): 150 + 300 * ABL:従順
    const judo = 150 + 300 * jujun;

    const sources: Record<number, number> = {
      [SOURCE_ID.情愛]: jouai,
      [SOURCE_ID.受動]: judo,
      [SOURCE_ID.反感]: hanpatsu,
    };
    if (roshutsu !== 0) sources[SOURCE_ID.露出] = roshutsu;
    if (kyojun !== 0) sources[SOURCE_ID.恭順] = kyojun;

    return sources;
  },

  // Outcome multipliers (ERB 88-106).
  // 反感/恭順 are NOT scaled by outcome in the ERB → MUL_NONE.
  // 露出 通常 ×0.90 deviation: see file-level docstring.
  outcomeMul: {
    [SOURCE_ID.情愛]: { great: 1.50, fail: 0.50 },
    [SOURCE_ID.受動]: { great: 2.00, fail: 0.50 },
    [SOURCE_ID.露出]: MUL_ROSHUTSU,
    [SOURCE_ID.反感]: MUL_NONE,
    [SOURCE_ID.恭順]: MUL_NONE,
  },

  body: (c) => {
    // ERB 57: DOWNBASE:気力 += 50 (target — factory only drains master)
    c.t.state.BASE[BASE_ID.気力] = (c.t.state.BASE[BASE_ID.気力] ?? 0) - 50;

    // ERB 110: global TFLAG:膝枕した = 1440*DAY + TIME. The factory has
    // already advanced the clock, including TRACHECK_TIME's pre-command −4.
    setTflag(c.next, TFLAG_ID.膝枕した, c.next.time.tickValue);

    // 大成功 extra effects (ERB 101-105)
    if (c.outcome === 1) {
      // ERB 102-103: DOWNBASE:体力 -= 150, DOWNBASE:気力 -= 300 (target)
      c.t.state.BASE[BASE_ID.体力] =
        (c.t.state.BASE[BASE_ID.体力] ?? 0) - 150;
      c.t.state.BASE[BASE_ID.気力] =
        (c.t.state.BASE[BASE_ID.気力] ?? 0) - 300;
      // ERB 104: DOWNBASE:MASTER:気力 -= 50
      c.master.state.BASE[BASE_ID.気力] =
        (c.master.state.BASE[BASE_ID.気力] ?? 0) - 50;
    }
    // TFLAG:情緒BONUS = 30 (通常) / 50 (大成功) — deferred (FAVOR_CALC input)
    // SET_DERAY(6, TARGET) — deferred
  },

  narration: (c, favorDelta) => {
    const word =
      c.outcome === 1 ? "温柔地"
      : c.outcome === -1 ? "尴尬地"
      : "安静地";
    return `%CALLNAME:MASTER% ${word} 让%CALLNAME:TARGET%把头枕在了自己的膝上；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`;
  },
};

export const comf336HandlerEntry: HandlerEntry = makeComfHandler(comf336Def);
