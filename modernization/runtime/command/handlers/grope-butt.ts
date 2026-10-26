/**
 * Phase 7.5 (§3E) — `COMF310 尻を撫でる` (grope butt), the セクハラ族
 * root exemplar. Bespoke C-tier handler (NOT a ComfDef): the command is a
 * two-axis state machine — `ABL:親密` 5-tier SOURCE bracket × `TFLAG:193`
 * 4-tier outcome multiplier — plus a time-stop bypass arm and the HITOKE
 * bystander doubling. The factory's outcome-roll + flat-SOURCE skeleton
 * can't express the 親密-branch overriding the roll outcome.
 *
 * Faithful core ported (`ERB/コマンド関連/COMF/日常系/COMF310 尻を撫でる.ERB`,
 * the normal-branch path: `TFLAG:192 == 0` / CASE 0, no DLC):
 *
 *   1. `@COM_ABLE310` single-target core (ERB 115-154):
 *        - target present (resolver contract; `ctx.target > 0`)
 *        - when NOT time-stopped: target not sleeping (ERB 131), not
 *          working 行動==5 unless 美宵 (ERB 134), not 陪睡中 (ERB 137),
 *          not 甲斐性無 without 诶嘿嘿 (ERB 143)
 *        - master 気力 > 0 (ERB 147)
 *      Includes the frozen/hidden bypass, sleep-prank exception, date-room
 *      restriction and hand/counter-use latches. Act_COM phase is represented
 *      by the read-only menu query rather than a persisted TFLAG:100 mirror.
 *
 *   2. Time-stop bypass arm (ERB 6-7): `FLAG:70 && CFLAG:TARGET:344==0`
 *      → `BASE:MASTER:TSP -= 10`, no SOURCE/settlement. (344 not modeled
 *      → 0, so a time-stop run always takes this arm — faithful.)
 *
 *   3. Main path (ERB 8-108):
 *        - outcome roll: `roll = RAND:110`; `L1 = MIN(109, 90 + rate/5)`;
 *          `kojoForcedFailure(roll, L1)` → TFLAG:193 (1/2/3).
 *        - fixed SOURCE set (歓楽100/情愛100/露出200/反感500/欲情100/受動100).
 *        - `ABL:親密` 5-tier bracket (ERB 29-58): each tier adds to the
 *          good sources / subtracts from 反感, and tiers 2-5 OVERRIDE
 *          TFLAG:193 with `RAND:2+2` (2-3) or `RAND:2+3` (3-4). Tier 1
 *          (親密≤5) leaves the roll outcome.
 *        - 反感 / 歓楽 floored ≥ 0 (ERB 59-63).
 *        - 好感度 penalty `LOCAL` (ERB 68-80): -10/-5/-3/-1 by tier →
 *          passed as `favorBias` to `applySourceCheck` (it is the
 *          command's `TFLAG:97 += LOCAL` pre-seed).
 *        - HITOKE(1): 露出×2, 反感×2 (ERB 81-84).
 *        - `applySekuharaTier` (ERB 85-107): TFLAG:193 ×table.
 *        - DOWNBASE target 気力 50 / master 気力 50 (ERB 14-15).
 *        - TIME += 10 (ERB 108).
 *        - `applySourceCheck` settles SOURCE → PALAM → 好感度.
 *
 * **DEFERRED (documented — same posture as apologize.ts):**
 *   - `TFLAG:192` force arms + `TFLAG:193 == -2 → RETURN -1` (CASE 0 only).
 *   - `TFLAG:102` 先制 `MAX(TFLAG:193,2)` (ERB 65) — not passed → 0.
 *   - `TFLAG:理性削り=1` / `TFLAG:信頼度管理=-3` (ERB 16-18) — trust/reason
 *     subsystems not modeled.
 *   - HITOKE 公共の場/CAN_SEE arms — see `sekuhara.ts` header.
 *   - GET_SUCCESS_RATE unimported TALENT terms — see `sekuhara.ts` header.
 *   - 美宵 (charaNum 134) work exception (ERB 134) — modeled (行動==5
 *     blocks unless target is 134), but the trial has only 霊夢.
 */

import type { CommandContext, HandlerEntry } from "../types.js";
import type { CharaSlot } from "../../state/game-state.js";
import { cloneGameState } from "../../state/game-state.js";
import {
  ABL_ID,
  BASE_ID,
  CFLAG_ID,
  FLAG_ID,
  SOURCE_ID,
  TALENT_ID,
  TCVAR_ID,
  advanceTimeTicks,
  getMasterBase,
  setMasterBase,
  times,
} from "../../state/settlement.js";
import {
  applySekuharaTier,
  getSuccessRate,
  hitoke,
  kojoForcedFailure,
} from "../../state/sekuhara.js";
import { applySourceCheck } from "../source-check.js";
import { collectCommandKojo } from "../command-kojo.js";
import { applyKojoEffects } from "../../kojo/effects.js";
import { getTflag, setTflag, TFLAG_ID } from "../../state/tflag.js";
import { ROOM_CATALOG_BY_LOCATION } from "../../world/room-catalog.js";

/** 美宵 charaNum (`CSV/Chara/Chara134 美宵.csv`) — the one chara exempt
 *  from the 行動==5 仕事中 block (ERB 134). */
const MIYO = 134;

// ---------------------------------------------------------------------------
// execCheck — `@COM_ABLE310` core
// ---------------------------------------------------------------------------

function checkGropeButtEligible(
  ctx: CommandContext,
): { ok: true } | { ok: false; reason: { kind: "precondition"; message: string } } {
  if (ctx.target <= 0) {
    return { ok: false, reason: { kind: "precondition", message: "需要目标角色在场。" } };
  }
  const target = ctx.state.charas[ctx.target];
  if (!target) {
    return { ok: false, reason: { kind: "precondition", message: "目标角色不存在。" } };
  }
  const timeStop = (ctx.state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0 &&
    (target.state.CFLAG[CFLAG_ID.時間停止行動] ?? 0) !== 1;
  if (target.location !== ctx.state.master.location) {
    return { ok: false, reason: { kind: "precondition", message: "需要目标角色在同一地点。" } };
  }
  // ERB 127: normal gates are bypassed for a frozen or hidden target.
  if (!timeStop && ((target.state.CFLAG[CFLAG_ID.潜伏状態] ?? 0) & 1) === 0) {
    // ERB 131: sleeping blocks unless the prank mode is already active.
    if ((target.state.CFLAG[CFLAG_ID.睡眠] ?? 0) !== 0 && (target.state.CFLAG[CFLAG_ID.恶作剧] ?? 0) === 0) {
      return { ok: false, reason: { kind: "precondition", message: "目标正在睡觉。" } };
    }
    // ERB 134: 仕事中 (行動==5) unless 美宵.
    if ((target.state.CFLAG[CFLAG_ID.行动] ?? 0) === 5 && ctx.target !== MIYO) {
      return { ok: false, reason: { kind: "precondition", message: "目标正在工作。" } };
    }
    // ERB 137: 陪睡中.
    if ((target.state.CFLAG[CFLAG_ID.陪睡中] ?? 0) !== 0) {
      return { ok: false, reason: { kind: "precondition", message: "目标正在陪睡。" } };
    }
    // ERB 143: 甲斐性無 without 诶嘿嘿.
    if (
      (ctx.state.flagStore[FLAG_ID.甲斐性無] ?? 0) !== 0 &&
      (target.state.CFLAG[CFLAG_ID.诶嘿嘿] ?? 0) === 0
    ) {
      return { ok: false, reason: { kind: "precondition", message: "没有那份胆量（甲斐性無）。" } };
    }
    if (ctx.state.dateSession?.partner === ctx.target &&
        ROOM_CATALOG_BY_LOCATION[target.location]?.localNumber !== 98) {
      return { ok: false, reason: { kind: "precondition", message: "约会中只能在待客室进行。" } };
    }
  }
  // ERB 147: master 気力 > 0.
  if ((getMasterBase(ctx.state, BASE_ID.気力) ?? 0) <= 0) {
    return { ok: false, reason: { kind: "precondition", message: "気力不足，无法行动。" } };
  }
  // ERB 150/152: hand usage and partner-led counter exclusion.
  if (getTflag(ctx.state, TFLAG_ID.手使用中) !== 0 ||
      ((target.state.TCVAR[TCVAR_ID.MASTER_COUNTER制御] ?? 0) & 1) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "当前无法使用手进行该动作。" } };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// SOURCE assembly — `@COM310` 親密 5-tier bracket (ERB 21-63, 68-78)
// ---------------------------------------------------------------------------

export interface GropeButtSources {
  /** Final SOURCE map (fixed set + 親密-bracket adds, 反感/歓楽 floored). */
  readonly sources: Record<number, number>;
  /** `TFLAG:193` after the bracket override (ERB 36/43/50/57). */
  readonly tflag193: number;
  /** 好感度 penalty `LOCAL` (ERB 68-78) → `applySourceCheck` favorBias. */
  readonly favorBias: number;
}

/**
 * Assemble the post-bracket SOURCE set for 310 (ERB 21-63): the fixed
 * base, the `ABL:親密` 5-tier adds/subtracts, the `TFLAG:193` override,
 * the 反感/歓楽 floor, and the 好感度 penalty. Does NOT apply HITOKE or
 * the tier ×table — the caller does those (HITOKE needs `state`, the
 * tier table is the shared `applySekuharaTier`). Pure + exported so the
 * exact bracket numbers can be pinned by hand-computed fixtures.
 *
 * `rng` must yield `RAND:110` first (the roll) then, for tiers 2-5, one
 * `RAND:2` for the override.
 */
export function assembleGropeButtSources(
  target: CharaSlot,
  rng: { int: (max: number) => number },
  rate: number,
): GropeButtSources {
  // ----- Outcome roll (ERB 9-13, CASE 0) -----
  const failThreshold = Math.min(109, 90 + Math.trunc(rate / 5));
  const roll = rng.int(110); // RAND:110 → [0, 110)
  let tflag193: number = kojoForcedFailure(roll, failThreshold);

  // ----- Fixed SOURCE set (ERB 21-26) -----
  const sources: Record<number, number> = {
    [SOURCE_ID.歓楽]: 100,
    [SOURCE_ID.情愛]: 100,
    [SOURCE_ID.露出]: 200,
    [SOURCE_ID.反感]: 500,
    [SOURCE_ID.欲情]: 100,
    [SOURCE_ID.受動]: 100,
  };

  const shinmitsu = target.state.ABL[ABL_ID.親密] ?? 0;
  const yokubo = target.state.ABL[ABL_ID.欲望] ?? 0;
  const juujun = target.state.ABL[ABL_ID.従順] ?? 0;
  const renbo = (target.state.TALENT[TALENT_ID.恋慕] ?? 0) !== 0;

  let favorBias = 0;
  if (shinmitsu <= 5) {
    sources[SOURCE_ID.反感]! -= shinmitsu * 5;
    favorBias -= 10;
  } else if (shinmitsu <= 7) {
    sources[SOURCE_ID.歓楽]! += 400 + shinmitsu * 5;
    sources[SOURCE_ID.情愛]! += 400 + shinmitsu * 10;
    sources[SOURCE_ID.反感]! -= shinmitsu * 10;
    tflag193 = rng.int(2) + 2; // RAND:2+2 → 2..3
    favorBias -= 5;
  } else if (shinmitsu <= 9) {
    sources[SOURCE_ID.歓楽]! += 700 + shinmitsu * 10;
    sources[SOURCE_ID.情愛]! += 600 + shinmitsu * 15;
    sources[SOURCE_ID.反感]! -= shinmitsu * 15;
    sources[SOURCE_ID.欲情]! += 200 * yokubo;
    sources[SOURCE_ID.受動]! += 200 * juujun;
    tflag193 = rng.int(2) + 2;
    favorBias -= 3;
  } else if (!renbo) {
    sources[SOURCE_ID.歓楽]! += 1200 + shinmitsu * 20;
    sources[SOURCE_ID.情愛]! += 800 + shinmitsu * 25;
    sources[SOURCE_ID.反感]! -= shinmitsu * 20;
    sources[SOURCE_ID.欲情]! += 250 * yokubo;
    sources[SOURCE_ID.受動]! += 250 * juujun;
    tflag193 = rng.int(2) + 2;
  } else {
    sources[SOURCE_ID.歓楽]! += 2000 + shinmitsu * 20;
    sources[SOURCE_ID.情愛]! += 1800 + shinmitsu * 30;
    sources[SOURCE_ID.欲情]! += 1000 + 250 * yokubo;
    sources[SOURCE_ID.受動]! += 1000 + 250 * juujun;
    sources[SOURCE_ID.反感]! -= shinmitsu * 50;
    tflag193 = rng.int(2) + 3; // RAND:2+3 → 3..4
    favorBias -= 1;
  }

  // ----- 反感 / 歓楽 floor ≥ 0 (ERB 59-63) -----
  sources[SOURCE_ID.反感] = Math.max(0, sources[SOURCE_ID.反感]!);
  sources[SOURCE_ID.歓楽] = Math.max(0, sources[SOURCE_ID.歓楽]!);

  return { sources, tflag193, favorBias };
}

// ---------------------------------------------------------------------------
// handler — `@COM310` core
// ---------------------------------------------------------------------------

export const gropeButtHandlerEntry: HandlerEntry = {
  commandNo: 310,
  execCheck: (ctx) => {
    const r = checkGropeButtEligible(ctx);
    return r.ok ? { ok: true } : { ok: false, reason: r.reason };
  },
  handler: (ctx) => {
    const next = cloneGameState(ctx.state);
    const target = next.charas[ctx.target]!;
    const master = next.master;

    // ----- Time-stop bypass arm (ERB 6-7) -----
    const timeStop = (next.flagStore[FLAG_ID.時間停止] ?? 0) !== 0 &&
      (target.state.CFLAG[CFLAG_ID.時間停止行動] ?? 0) === 0;
    if (timeStop) {
      setMasterBase(
        next,
        BASE_ID.TSP,
        (getMasterBase(next, BASE_ID.TSP) ?? 0) - 10,
      );
      return {
        state: next,
        events: [
          {
            kind: "NARRATION" as const,
            timestamp: ctx.now(),
            text: `%CALLNAME:MASTER% 在时间停止中抚摸了 %CALLNAME:TARGET% 的臀部。（TSP -10）`,
          },
        ],
        outcome: "ok" as const,
      };
    }

    // ----- Outcome roll + 親密 bracket + floor (ERB 9-63, 68-78) -----
    // ERB 65: 先制 MAX(TFLAG:193,2) — TFLAG:102 not passed → deferred.
    const rate = getSuccessRate(target, master);
    const { sources, tflag193, favorBias } = assembleGropeButtSources(
      target,
      ctx.rng,
      rate,
    );
    setTflag(next, 193, tflag193);

    // ----- HITOKE(1): 露出×2, 反感×2 (ERB 81-84) -----
    if (hitoke(next)) {
      sources[SOURCE_ID.露出] = times(sources[SOURCE_ID.露出]!, 2.0);
      sources[SOURCE_ID.反感] = times(sources[SOURCE_ID.反感]!, 2.0);
    }

    // ----- TFLAG:193 ×table (ERB 85-107) -----
    applySekuharaTier(sources, tflag193, {
      歓楽: SOURCE_ID.歓楽,
      情愛: SOURCE_ID.情愛,
      受動: SOURCE_ID.受動,
      欲情: SOURCE_ID.欲情,
      反感: SOURCE_ID.反感,
    });

    // ----- DOWNBASE 気力 50 / master 気力 50 (ERB 14-15) -----
    target.state.BASE[BASE_ID.気力] = (target.state.BASE[BASE_ID.気力] ?? 0) - 50;
    setMasterBase(next, BASE_ID.気力, (getMasterBase(next, BASE_ID.気力) ?? 0) - 50);

    // ----- TIME += 10 (ERB 108) -----
    advanceTimeTicks(next, 10);

    // ----- Settle SOURCE → PALAM → 好感度 (favorBias = TFLAG:97 LOCAL) -----
    const settled = applySourceCheck(next, ctx.target, sources, favorBias);

    const tierWord =
      tflag193 === 1 ? "失败了，" : tflag193 === 3 ? "大成功，" : "";

    // Kojo collect — same pattern as `make-comf-handler.ts:243`. The ComfDef
    // factory wires this in via the C-tier skeleton but `gropeButtHandlerEntry`
    // is bespoke C-tier and was missing it; without this call COMF 310 fires
    // **zero character dialogue** regardless of state, so the rebellion /
    // low-favor / refusal branch never reaches the player.
    const kojo = collectCommandKojo({ ...ctx, state: next });
    const settledState = kojo.effects.length > 0 ? applyKojoEffects(next, kojo.effects) : next;

    return {
      state: settledState,
      events: [
        {
          kind: "NARRATION" as const,
          timestamp: ctx.now(),
          text: `%CALLNAME:MASTER% 抚摸了 %CALLNAME:TARGET% 的臀部。${tierWord}好感度 ${
            settled.favorDelta >= 0 ? "+" : ""
          }${settled.favorDelta}。`,
        },
        ...settled.events,
        ...kojo.events,
      ],
      outcome: "ok" as const,
      pendingKojoChoice: kojo.pendingKojoChoice,
      kojoHandled: true,
    };
  },
};
