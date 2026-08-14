/**
 * Phase 7 — `COMF363 読み聞かせ` (read aloud) settlement, as a `ComfDef`.
 *
 * Ports `@COM363` + `@COM363_1`
 * (`ERB/コマンド関連/COMF/日常系/COMF363 読み聞かせ.ERB`),
 * per-target settlement arm.
 *
 * Outcome roll (ERB 9-29, CASE 0 / 通常 arm):
 *   - `LOCAL = RAND:100` → maxRoll 100.
 *   - `LOCAL:2 = 9`; `IF LOCAL <= LOCAL:2` → 大成功 ⇒ roll < 10 ⇒ greatThreshold 10.
 *   - `SIF MAGIC_DLC_大成功相关: LOCAL:2 += MAGIC_SuccessRate(TARGET)/20 + ABL:MASTER:教養` — DEFERRED.
 *   - `LOCAL:1 = 90 + GET_SUCCESS_RATE()/5` (deferred → 90), clamped ≤ 99;
 *     `IF LOCAL >= LOCAL:1` → 失敗 ⇒ failThreshold 90.
 *
 * SOURCE build (COM363_1, ERB 79-109):
 *   - 歓楽 = 1000 + ABL:従順 bracket + CFLAG:好感度 bracket
 *     (then SIF < 0 → 0)
 *   - 受動 = 300 + 150 * ABL:従順
 *   - 征服 = 300 + 100 * ABL:施虐属性
 *
 * Outcome scaling (ERB 111-123):
 *   - TFLAG:193 == -1 (失敗): 歓楽 ×0.10, 征服 ×0.50, 受動 ×0.50
 *   - TFLAG:193 == 0  (通常): all ×1.00
 *   - TFLAG:193 == 1  (大成功): all ×2.00
 *   → 歓楽: MUL_PLEASURE, 征服/受動: MUL_POSITIVE.
 *
 * Master downbase (ERB 52-53): MASTER:気力 += 150, MASTER:体力 += 50.
 *
 * Per-target downbase (body, ERB 76): 気力 += 50.
 *
 * EXP (ERB 18): 大成功 branch grants EXP:MASTER:会話経験 ++.
 *
 * **DEFERRED to later phases (documented, off in a clean state):**
 *   - `SELECTCASE TFLAG:192` CASE 1 (強制成功), CASE -1 (強制失敗), CASE -2 (指令終了) arms.
 *   - `MAGIC_DLC_大成功相关` / `MAGIC_SuccessRate` 大成功 widening + `M_TFLAG:成功`.
 *   - `TFLAG:信頼度管理` trust-management flag arith.
 *   - Multi-target loop (`FOR LOCAL, 1, GET_TARGETNUM() + 1`) — the factory
 *     handles a single target; the outer loop is a Phase 7 orchestrator concern.
 *   - `TALENT:幼稚` filter + `CFLAG:睡眠` / `CFLAG:陪睡中` pre-conditions
 *     (COM_ABLE363, ERB 130-161).
 *   - `M_TFLAG:时间因子类型 = TimeFactor_教养`.
 *   - `ITEM:104` gating, BATHCHECK / IS_DATING_WITH_PLAYER location checks.
 *   - KOJO messages (`KOJO_MESSAGE_SEND`).
 *   - `CALL SET_DERAY(6,TARGET)` post-settlement delay.
 *   - FAVOR_CALC, TRUST_CALC, TALENT/MARK/DLC personality modifiers.
 */

import type { HandlerEntry } from "../../types.js";
import { ABL_ID, BASE_ID, SOURCE_ID, EXP_ID } from "../../../state/settlement.js";
import { makeComfHandler } from "../make-comf-handler.js";
import {
  MUL_PLEASURE,
  MUL_POSITIVE,
  type ComfDef,
} from "../comf-def.js";

// ---------------------------------------------------------------------------
// ComfDef
// ---------------------------------------------------------------------------

export const comf363Def: ComfDef = {
  commandNo: 363,
  label: "読み聞かせ",
  timeCost: 30,
  maxRoll: 100,
  greatThreshold: 10, // LOCAL:2 = 9; roll <= 9 → 大成功
  failThreshold: 90,  // LOCAL:1 = 90 + GET_SUCCESS_RATE()/5 (deferred → 90)

  // ERB 52-53: MASTER:気力 += 150, MASTER:体力 += 50
  downbase: { [BASE_ID.気力]: 150, [BASE_ID.体力]: 50 },

  buildSources: (c) => {
    const juujun = c.tAbl(ABL_ID.従順);
    const gyakutai = c.tAbl(ABL_ID.施虐属性);
    const favor = c.favor; // CFLAG:2 好感度 (pre-command)

    // 歓楽: base 1000 + ABL:従順 bracket + CFLAG:好感度 bracket (ERB 79-105)
    let kanraku = 1000;

    // ABL:従順 bracket (ERB 82-94)
    if (juujun <= 1) {
      kanraku += juujun * 60;
    } else if (juujun <= 3) {
      kanraku += 200 + juujun * 65;
    } else if (juujun <= 5) {
      kanraku += 500 + juujun * 65;
    } else if (juujun <= 8) {
      kanraku += 750 + juujun * 85;
    } else if (juujun <= 11) {
      kanraku += 1000 + juujun * 85;
    } else {
      kanraku += 2000 + juujun * 40;
    }

    // CFLAG:好感度 bracket on 歓楽 (ERB 97-103), then SIF < 0 → 0 (ERB 104-105)
    if (favor <= 500) kanraku += favor;
    else if (favor <= 5000) kanraku += 500 + Math.trunc((favor - 500) / 3);
    else kanraku += 2000 + Math.trunc((favor - 5000) / 5);
    if (kanraku < 0) kanraku = 0;

    return {
      [SOURCE_ID.歓楽]: kanraku,
      [SOURCE_ID.受動]: 300 + 150 * juujun,      // ERB 108
      [SOURCE_ID.征服]: 300 + 100 * gyakutai,    // ERB 109
    };
  },

  // ERB 111-123: outcome-based source scaling
  outcomeMul: {
    [SOURCE_ID.歓楽]: MUL_PLEASURE,  // great 2.00 / fail 0.10
    [SOURCE_ID.受動]: MUL_POSITIVE,  // great 2.00 / fail 0.50
    [SOURCE_ID.征服]: MUL_POSITIVE,  // great 2.00 / fail 0.50
  },

  // No TFLAG:97 pre-seed in this command.
  favorBias: () => 0,

  /**
   * Per-target persisted side writes.
   *
   * ALWAYS applied (ERB 76):
   *   - DOWNBASE:気力 += 50 (TARGET base drain)
   *
   * On 大成功 only (ERB 18):
   *   - EXP:MASTER:会話経験 ++
   */
  body: (c) => {
    // ERB 76: DOWNBASE:気力 += 50 (always per target)
    c.t.state.BASE[BASE_ID.気力] = (c.t.state.BASE[BASE_ID.気力] ?? 0) - 50;

    // ERB 18: 大成功 branch grants EXP:MASTER:会話経験 ++
    if (c.outcome === 1) {
      c.master.state.EXP[EXP_ID.会話経験] = (c.master.state.EXP[EXP_ID.会話経験] ?? 0) + 1;
    }
  },

  narration: (c, favorDelta) => {
    const adj =
      c.outcome === 1 ? "声情并茂地" : c.outcome === -1 ? "磕磕巴巴地" : "认真";
    return `%CALLNAME:MASTER% ${adj} a story aloud for %CALLNAME:TARGET%；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`;
  },
};

export const comf363HandlerEntry: HandlerEntry = makeComfHandler(comf363Def);
