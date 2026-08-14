/**
 * Phase 5D / 7.0 — `COMF300 会話` settlement, as a `ComfDef`.
 *
 * Ports `@COM300` (`ERB/コマンド関連/COMF/日常系/COMF300 会話.ERB`) for the
 * 通常 (TFLAG:192 == 0) arm, normal-success outcome. Originally a
 * hand-written handler (Phase 5D); Phase 7.0 re-expresses it as a
 * `ComfDef` driven by the shared `makeComfHandler` factory — the
 * arithmetic is unchanged, so the 5D pinned test is the regression net.
 *
 * Persisted writes (canonical clean target, ABL/TALENT/CFLAG all 0,
 * master 話術技能 0, normal success):
 *   - `time.tickValue += 10`
 *   - `EXP:MASTER:会話経験(71) += 1`               (ERB line 205)
 *   - `TCVAR:TARGET:会話累計(301) += 300/LOCAL`     (ERB 188-191; LOCAL=4 → +75)
 *   - PALAM/CFLAG:好感度 via `applySourceCheck`
 *
 * SOURCE build (ERB 113-177): `歓楽 = 200` (+ ABL:親密 bracket, then
 * `LIMIT 0..5000`), `受動 = 100 + 100*ABL:従順`, `征服 = 100 +
 * 100*ABL:施虐属性`; scaled by the outcome (TFLAG:193) and by
 * `ABL:MASTER:話術技能`. Unscoped `ABL:*` in COMF = TARGET's ability.
 *
 * **Outcome roll** (ERB 39-67): `roll = RAND:100`; `< 5` → 大成功,
 * `>= 90` → 失敗 (GET_SUCCESS_RATE deferred → 0), else 通常.
 *
 * **DEFERRED to Phase 7 (documented):** `TCVAR:302` (会話累積 fail gate),
 * `MARK:反発刻印` early-out, `REVEAL_YOUKAI`, the 陪睡/约会/烂醉/催眠/
 * 時止め branches, `DOWNBASE:気力` (master+target), 約會経験, every
 * `MAGIC_DLC_*` arm.
 */

import type { HandlerEntry } from "../types.js";
import { cloneGameState } from "../../state/game-state.js";
import { ABL_ID, EXP_ID, MARK_ID, SOURCE_ID, TCVAR_ID } from "../../state/settlement.js";
import {
  makeComfHandler,
} from "../comf/make-comf-handler.js";
import { MUL_PLEASURE, MUL_POSITIVE, type ComfDef } from "../comf/comf-def.js";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));

const talkDef: ComfDef = {
  commandNo: 300,
  label: "会話",
  // @COM_ABLE300: sleeping targets cannot be talked to in the ordinary
  // Act_COM flow (the sleep/prank commands occupy that state instead).
  gate: { notWhileTargetSleeping: true },
  timeCost: 10,
  maxRoll: 100,
  greatThreshold: 5, // roll < 5 → 大成功
  failThreshold: 90,

  // SOURCE build (ERB 113-177).
  buildSources: (c) => {
    let kanraku = 200;
    const shinmitsu = c.tAbl(ABL_ID.親密);
    if (shinmitsu <= 1) kanraku += shinmitsu * 30;
    else if (shinmitsu <= 3) kanraku += 200 + shinmitsu * 30;
    else if (shinmitsu <= 5) kanraku += 500 + shinmitsu * 30;
    else if (shinmitsu <= 8) kanraku += 750 + shinmitsu * 50;
    else if (shinmitsu <= 10) kanraku += 1000 + shinmitsu * 50;
    else kanraku += 1600 + shinmitsu * 30;
    kanraku = clamp(kanraku, 0, 5000);

    const judou = 100 + 100 * c.tAbl(ABL_ID.従順);
    const seifuku = 100 + 100 * c.tAbl(ABL_ID.施虐属性);
    return {
      [SOURCE_ID.歓楽]: kanraku,
      [SOURCE_ID.受動]: judou,
      [SOURCE_ID.征服]: seifuku,
    };
  },

  // Outcome multiplier (ERB 137-151): 歓楽 ×2/×0.1, 受動/征服 ×2/×0.5.
  outcomeMul: {
    [SOURCE_ID.歓楽]: MUL_PLEASURE,
    [SOURCE_ID.受動]: MUL_POSITIVE,
    [SOURCE_ID.征服]: MUL_POSITIVE,
  },

  // 話術技能 multiplier (ERB 152-177) — master's ability scales all three.
  masterAbility: {
    ablId: ABL_ID.話術技能,
    table: [0.2, 0.4, 0.7, 1.0, 1.2, 1.5], // level 0..5 (clamp at 5)
    sourceIds: [SOURCE_ID.歓楽, SOURCE_ID.受動, SOURCE_ID.征服],
  },

  // 会話累計 (ERB 180-191) + EXP (ERB 205). IS_DATING_WITH_PLAYER deferred
  // → the 300/LOCAL branch; great success adds the +50 bonus (ERB 137-151).
  body: (c) => {
    const wajutsu = c.mAbl(ABL_ID.話術技能);
    const localDiv = 4 + Math.min(wajutsu, 6);
    const tcvar = c.t.state.TCVAR;
    tcvar[TCVAR_ID.会話累計] =
      (tcvar[TCVAR_ID.会話累計] ?? 0) + Math.trunc(300 / localDiv) + (c.outcome === 1 ? 50 : 0);
    c.master.state.EXP[EXP_ID.会話経験] = (c.master.state.EXP[EXP_ID.会話経験] ?? 0) + 1;
  },

  narration: (c, favorDelta) => {
    // Original short action prose lives in EVENT_MESSAGE_COM300.ERB
    // @MESSAGE_COM300, not in COMF300 itself. Use the same visible phrasing
    // here until TRAIN_MESSAGE is fully threaded as a first-class stream:
    // normal → “…说着话”, great → “度过了快乐的时光…”, fail → “气氛尴尬…”.
    const line =
      c.outcome === 1
        ? "%CALLNAME:MASTER%和%CALLNAME:TARGET%说着话，度过了快乐的时光…"
        : c.outcome === -1
          ? "%CALLNAME:MASTER%和%CALLNAME:TARGET%的会话停下后，气氛变得尴尬起来…"
          : "%CALLNAME:MASTER%和%CALLNAME:TARGET%简短地说着话。";
    return `${line}; 好感度 ${favorDelta >= 0 ? "+" : ""}${favorDelta}.`;
  },
};

const normalTalkHandler = makeComfHandler(talkDef);

export const talkHandlerEntry: HandlerEntry = {
  commandNo: talkDef.commandNo,
  ...(normalTalkHandler.execCheck ? { execCheck: normalTalkHandler.execCheck } : {}),
  handler: (ctx) => {
    // @COM300 lines 31-36: a third-level rebellion brand ends the command
    // before its ordinary outcome roll, settlement, dialogue, or time cost.
    const brand = ctx.state.charas[ctx.target]?.state.MARK[MARK_ID.反発刻印] ?? 0;
    if (brand >= 3) {
      return {
        state: cloneGameState(ctx.state),
        events: [{
          kind: "NARRATION",
          timestamp: ctx.now(),
          text: "%CALLNAME:TARGET%似乎不想理睬%CALLNAME:MASTER%的样子",
        }],
        outcome: "noop",
      };
    }
    return normalTalkHandler.handler(ctx);
  },
};
