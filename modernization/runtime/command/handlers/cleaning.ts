/**
 * Phase 7 — `COMF410 掃除` (cleaning), the cleaning/dirt C-tier command.
 *
 * Faithful to `ERB/コマンド関連/COMF/日常系/COMF410 掃除.ERB`. Three arms:
 *
 *   1. **Solo clean core** (ERB 12-26, 64-68, 95-97): the master's
 *      sweepPower removes a fraction of YOGORE; cost = DOWNBASE 体力50
 *      / 気力100 / TIME 20.
 *
 *   2. **A — Helper join** (`TFLAG:193`, ERB 62, 64, 174-188, 299-300):
 *      TARGET + SHIRAHU + ABL_sum > 地位差 + (idle or currently sweeping)
 *      → TARGET's ABL:清掃技能 adds to power + differential EXP:清掃経験
 *      grant (master and helper each get XP based on who's better).
 *
 *   3. **B — TARGET co-presence SOURCE** (ERB 104-135): TARGET + SHIRAHU +
 *      !CFLAG:诶嘿嘿 → SOURCE:歓楽 (ABL:従順 + 好感度 brackets) +
 *      SOURCE:征服 (施虐属性). Settles via `applySourceCheck` →
 *      PALAM → 好感度.
 *
 *   4. **C — 诶嘿嘿 扫地臂** (ERB 137-153): TARGET + SHIRAHU +
 *      CFLAG:诶嘿嘿 → SOURCE:反感/鬱屈 + extra 気力 -100. Settles via
 *      `applySourceCheck`.
 *
 * **DEFERRED (same posture as oshitaoshi/apologize, documented):**
 *   - Time-stop branch (ERB 80-93): TSP drain + 異常清掃経験.
 *     `FLAG:時間停止` modeled as flagStore, but the time-stop arm
 *     requires the 诶嘿嘿-state timer + 同室 loops.
 *   - 虫籠 (P54) sweep-along + ×5 power (ERB 67-76) — room-specific.
 *   - 胖次発見 event (ERB 59-61, 239-274).
 *   - 大地図 GMF_MAP_SWEEP (ERB 78-79), MAGIC_DLC 魔法奖励 (ERB 154-172).
 *   - 同行 +20 (ERB 100-101). (EX:今日的掃除回数 ERB 77 is now wired — see below.)
 *   - ITEM:特制竹箒 / ITEM:977 broom & catalyst bonuses (ERB 285-292, 317).
 *   - 大掃除 gate (ERB 340-341) — the 大掃除 event subsystem isn't modeled.
 *     (約会中 ERB 330 / 宴会 ERB 339 / 外出=拠点外 ERB 343 are now wired in
 *      execCheck.)
 *   - 诶嘿嘿 arm LOCAL:3 == 1 異常清掃経験 grant (ERB 142-152).
 *   - MAGIC_DLC_等级重置 branch of EXP grant (ERB 174).
 */

import type { CharaSlot, GameState } from "../../state/game-state.js";
import type { ObservationEvent } from "../../../schemas/types.js";
import type { CommandContext, HandlerEntry } from "../types.js";
import { cloneGameState } from "../../state/game-state.js";
import {
  ABL_ID,
  BASE_ID,
  CFLAG_ID,
  EX_ID,
  EXP_ID,
  FLAG_ID,
  SOURCE_ID,
  TCVAR_ID,
  advanceTimeTicks,
  getMasterBase,
  setMasterBase,
} from "../../state/settlement.js";
import { applySourceCheck } from "../source-check.js";
import {
  dirtSeverity,
  getYogore,
  osoujiLimit,
  setYogore,
  sweepAmount,
  sweepPower,
} from "../../state/yogore.js";
import { atPlayerBase, chkDateNow } from "../../world/location-predicates.js";
import { OMANEKI_PLACE } from "../../world/omaneki.js";

// ---------------------------------------------------------------------------
// Local constants — JOB_* from `DIM.ERH:47,57`
// ---------------------------------------------------------------------------

/** `DIM.ERH:47` — CFLAG:職種 enum: target is currently a dedicated cleaner. */
const JOB_清掃 = 40;
/** `DIM.ERH:57` — CFLAG:職種 enum: target is cleaning up after a banquet. */
const JOB_宴会の片づけ = 50;
/** `DIM.ERH:55,56,58` — banquet 職種 the master can't clean during (ERB 339). */
const JOB_宴会準備 = 48;
const JOB_宴会参加 = 49;
const JOB_酔いつぶれる = 51;

// ---------------------------------------------------------------------------
// SHIRAHU proxy — `COMMON.ERB:827-841`
//
// Full SHIRAHU returns 1 (responsive), 2 (responsive under time-stop), or 0
// (unresponsive). We only need the boolean "responsive" arm; the time-stop
// nuance (TFLAG:102) is out of scope until the time-stop subsystem lands.
// ---------------------------------------------------------------------------

function isShirahu(state: GameState, targetNum: number): boolean {
  if (targetNum <= 0) return false;
  const slot = state.charas[targetNum];
  if (!slot) return false;
  // Time-stop responsiveness is deferred; treat a time-stopped target as
  // non-responsive (the SHIRAHU=0 branch).
  if ((state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0) return false;
  if ((slot.state.CFLAG[CFLAG_ID.睡眠] ?? 0) !== 0) return false;
  if ((slot.state.CFLAG[CFLAG_ID.陪睡中] ?? 0) !== 0) return false;
  if ((slot.state.TCVAR[TCVAR_ID.泥酔] ?? 0) !== 0) return false;
  if ((slot.state.CFLAG[CFLAG_ID.衰弱] ?? 0) !== 0) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Helper-join — ERB 62 (`TFLAG:193`)
// ---------------------------------------------------------------------------

/**
 * ERB 62: `TFLAG:193 = TARGET && SHIRAHU(TARGET) && (ABL:親密*500 +
 * ABL:従順*500 + ABL:清掃技能*1000 > CFLAG:地位 - CFLAG:MASTER:地位) &&
 * (!CFLAG:行動 || (CFLAG:行動 == 5 && GROUPMATCH(CFLAG:職種, JOB_清掃,
 * JOB_宴会の片づけ)))`. TFLAG is a per-command transient flag in ERA; we
 * compute the predicate inline (no state storage needed — single use).
 */
function helperJoinsCleaning(state: GameState, targetNum: number): boolean {
  if (!isShirahu(state, targetNum)) return false;
  const target = state.charas[targetNum]!;
  const ablSum =
    (target.state.ABL[ABL_ID.親密] ?? 0) * 500 +
    (target.state.ABL[ABL_ID.従順] ?? 0) * 500 +
    (target.state.ABL[ABL_ID.清扫技能] ?? 0) * 1000;
  const statusGap =
    (target.state.CFLAG[CFLAG_ID.地位] ?? 0) -
    (state.master.state.CFLAG[CFLAG_ID.地位] ?? 0);
  if (ablSum <= statusGap) return false;
  // ERB 62: !CFLAG:行動 OR (CFLAG:行動 == 5 AND 職種 ∈ {JOB_清掃, JOB_宴会の片づけ})
  const 行动 = target.state.CFLAG[CFLAG_ID.行动] ?? 0;
  if (行动 !== 0) {
    if (行动 !== 5) return false;
    const 職種 = target.state.CFLAG[CFLAG_ID.职种] ?? 0;
    if (職種 !== JOB_清掃 && 職種 !== JOB_宴会の片づけ) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// execCheck — `@COM_ABLE410` core
// ---------------------------------------------------------------------------

function checkCleaningEligible(
  ctx: CommandContext,
): { ok: true } | { ok: false; reason: { kind: "precondition"; message: string } } {
  const master = ctx.state.master;
  const loc = master.location;

  // ERB 330: on a date (CFLAG:MASTER:约会中 → a date-destination MAPID) blocks.
  // Upstream also guards the 幻想乡大地图 ODEKAKE case; that GMF isn't modeled
  // (`!GMF_GETBIT(大地図)` = true), so the condition reduces to CHK_DATENOW.
  if (chkDateNow(master.state.CFLAG[CFLAG_ID.约会中] ?? 0)) {
    return { ok: false, reason: { kind: "precondition", message: "约会途中没法打扫。" } };
  }
  // ERB 339: the master busy in a banquet (行動==5 && 職種∈{準備/参加/酔いつぶれる})
  // can't clean — unless time is stopped (!FLAG:70). Master banquet 職種 isn't
  // driven yet, so this is a faithful gate that activates when it lands.
  const 行动 = master.state.CFLAG[CFLAG_ID.行动] ?? 0;
  const 職種 = master.state.CFLAG[CFLAG_ID.职种] ?? 0;
  const banquetJob =
    職種 === JOB_宴会準備 || 職種 === JOB_宴会参加 || 職種 === JOB_酔いつぶれる;
  if (行动 === 5 && banquetJob && (ctx.state.flagStore[FLAG_ID.時間停止] ?? 0) === 0) {
    return { ok: false, reason: { kind: "precondition", message: "宴会中，顾不上打扫。" } };
  }
  // ERB 343: 外出中はダメ、待客室は掃除できる — cleaning is only possible at a
  // 拠点 (any base map, via AT_HOME(MASTER)=IN_HOME(現在位置)) or in the OMANEKI
  // 待客室; out on a field / odekake map it's blocked.
  if (!atPlayerBase(ctx.state, 0) && loc !== OMANEKI_PLACE) {
    return { ok: false, reason: { kind: "precondition", message: "只能在据点或待客室打扫。" } };
  }

  // ERB 333: dirt at the current room must be ≥ 100 to clean at all.
  if (getYogore(ctx.state, loc) < 100) {
    return { ok: false, reason: { kind: "precondition", message: "这里没有脏到需要打扫。" } };
  }
  // ERB 346: master 気力 > 0.
  if ((getMasterBase(ctx.state, BASE_ID.気力) ?? 0) <= 0) {
    return { ok: false, reason: { kind: "precondition", message: "気力不足，无法打扫。" } };
  }
  // ERB 336: not 陪睡中.
  if ((master.state.CFLAG[CFLAG_ID.陪睡中] ?? 0) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "陪睡中无法打扫。" } };
  }
  // ERB 338: 诶嘿嘿 == 2 (deep H-scene) blocks cleaning. 诶嘿嘿 == 1 is
  // allowed — the C arm (ERB 137-153) gives a SOURCE:反感/鬱屈 settlement.
  if ((master.state.CFLAG[CFLAG_ID.诶嘿嘿] ?? 0) === 2) {
    return { ok: false, reason: { kind: "precondition", message: "现在不是打扫的时候。" } };
  }
  // ERB 349: 酒気 must be ≤ 15% of MAXBASE.
  const sake = master.state.BASE[BASE_ID.酒気] ?? 0;
  const sakeMax = master.state.MAXBASE[BASE_ID.酒気] ?? 0;
  if (sakeMax > 0 && (sake * 100) / sakeMax > 15) {
    return { ok: false, reason: { kind: "precondition", message: "喝多了，打扫不了。" } };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// SOURCE bracket helpers — ERB 111-135, 137-141
// ---------------------------------------------------------------------------

/** ERB 111-122: ABL:従順 → SOURCE:歓楽 bracket ladder. */
function kairakuFromJuujun(juujun: number): number {
  if (juujun <= 1) return juujun * 60;
  if (juujun <= 3) return 200 + juujun * 60;
  if (juujun <= 5) return 500 + juujun * 60;
  if (juujun <= 8) return 750 + juujun * 75;
  if (juujun <= 11) return 1000 + juujun * 75;
  return 2000 + juujun * 30;
}

/** ERB 126-132: CFLAG:好感度 → SOURCE:歓楽 bracket (integer division, trunc). */
function kairakuFromKoukaido(koukaido: number): number {
  if (koukaido <= 500) return koukaido;
  if (koukaido <= 5000) return 500 + Math.trunc((koukaido - 500) / 3);
  return 2000 + Math.trunc((koukaido - 5000) / 5);
}

// ---------------------------------------------------------------------------
// handler — `@COM410` core (A + B + C)
// ---------------------------------------------------------------------------

export const cleaningHandlerEntry: HandlerEntry = {
  commandNo: 410,
  execCheck: (ctx) => {
    const r = checkCleaningEligible(ctx);
    return r.ok ? { ok: true } : { ok: false, reason: r.reason };
  },
  handler: (ctx) => {
    const next = cloneGameState(ctx.state);
    const loc = next.master.location;
    const dirt = getYogore(next, loc);

    // ERB 18-26: if the room isn't messy enough (below the master's
    // OSOUJI_LIMIT), the master won't bother — noop.
    if (dirt < osoujiLimit(next.master)) {
      return {
        state: next,
        events: [
          {
            kind: "NARRATION" as const,
            timestamp: ctx.now(),
            text: `这里也没那么乱七八糟，就算不打扫也行吧。`,
          },
        ],
        outcome: "noop" as const,
      };
    }

    // ===== A — helper join (TFLAG:193) =====
    const helperJoined = helperJoinsCleaning(next, ctx.target);
    const helper: CharaSlot | undefined =
      helperJoined && ctx.target > 0 ? next.charas[ctx.target] : undefined;

    // ERB 64: power = SWEEP_POWER_CALC(helper slot if joined, else 0).
    const power = sweepPower(next.master, helper);

    // ===== Sweep (ERB 67-68) =====
    const removed = sweepAmount(dirt, power);
    const severityBefore = dirtSeverity(dirt);
    setYogore(next, loc, dirt - removed);

    // ERB 77: `EX:MASTER:今日的掃除回数 += SWEEP_YOGORE` — accumulate today's
    // swept dirt; cashed out as yen at day-end (`EVENTTURNEND.ERB:309`,
    // `advanceDay`). SWEEP_YOGORE is the dirt removed this sweep.
    next.master.state.EX[EX_ID.今日的掃除回数] =
      (next.master.state.EX[EX_ID.今日的掃除回数] ?? 0) + removed;

    // ===== EXP:清掃経験 grant (ERB 174-188) =====
    // MAGIC_DLC_等级重置 branch deferred (DLC). We always fall into the
    // ELSEIF/END branches on TFLAG:193.
    const masterClean = next.master.state.ABL[ABL_ID.清扫技能] ?? 0;
    if (helperJoined && helper) {
      const targetClean = helper.state.ABL[ABL_ID.清扫技能] ?? 0;
      if (masterClean > targetClean) {
        // Master is the better cleaner.
        helper.state.EXP[EXP_ID.清掃経験] =
          (helper.state.EXP[EXP_ID.清掃経験] ?? 0) + (masterClean - targetClean);
        next.master.state.EXP[EXP_ID.清掃経験] =
          (next.master.state.EXP[EXP_ID.清掃経験] ?? 0) + 1;
      } else if (masterClean < targetClean) {
        // Helper is the better cleaner.
        next.master.state.EXP[EXP_ID.清掃経験] =
          (next.master.state.EXP[EXP_ID.清掃経験] ?? 0) + (targetClean - masterClean);
        helper.state.EXP[EXP_ID.清掃経験] =
          (helper.state.EXP[EXP_ID.清掃経験] ?? 0) + 1;
      } else {
        // Equal skill — both get +2.
        helper.state.EXP[EXP_ID.清掃経験] =
          (helper.state.EXP[EXP_ID.清掃経験] ?? 0) + 2;
        next.master.state.EXP[EXP_ID.清掃経験] =
          (next.master.state.EXP[EXP_ID.清掃経験] ?? 0) + 2;
      }
    }
    // ERB 188: master always gets +1.
    next.master.state.EXP[EXP_ID.清掃経験] =
      (next.master.state.EXP[EXP_ID.清掃経験] ?? 0) + 1;

    // ===== Cost (ERB 95-97, non-time-stop) =====
    setMasterBase(next, BASE_ID.体力, (getMasterBase(next, BASE_ID.体力) ?? 0) - 50);
    setMasterBase(next, BASE_ID.気力, (getMasterBase(next, BASE_ID.気力) ?? 0) - 100);
    advanceTimeTicks(next, 20);

    // ===== B / C — TARGET presence arms =====
    // These are mutually exclusive by 诶嘿嘿 (ERB 104 vs 137). B fires when
    // TARGET is awake + not in H-mode; C fires when in H-mode.
    // Collects ObservationEvents from applySourceCheck (may be STATE_DELTA /
    // STATUS_MESSAGE / etc.), spread into the result `events` array below.
    const sourceEvents: ObservationEvent[] = [];
    const targetChara = ctx.target > 0 ? next.charas[ctx.target] : undefined;
    if (targetChara && isShirahu(next, ctx.target)) {
      const 诶嘿嘿 = targetChara.state.CFLAG[CFLAG_ID.诶嘿嘿] ?? 0;
      if (诶嘿嘿 === 0) {
        // ----- B: TARGET co-presence SOURCE (ERB 104-135) -----
        const sources: Record<number, number> = {};
        sources[SOURCE_ID.歓楽] =
          400 +
          kairakuFromJuujun(targetChara.state.ABL[ABL_ID.従順] ?? 0) +
          kairakuFromKoukaido(targetChara.state.CFLAG[CFLAG_ID.好感度] ?? 0);
        // ERB 133-134: clamp ≥ 0.
        if (sources[SOURCE_ID.歓楽]! < 0) sources[SOURCE_ID.歓楽] = 0;
        // ERB 135: 征服 = 300 + 100*施虐属性.
        sources[SOURCE_ID.征服] =
          300 + 100 * (targetChara.state.ABL[ABL_ID.施虐属性] ?? 0);
        const settled = applySourceCheck(next, ctx.target, sources, 0);
        sourceEvents.push(...settled.events);
      } else {
        // ----- C: 诶嘿嘿 扫地臂 (ERB 137-153) -----
        // Extra 気力 cost on top of the base 100.
        setMasterBase(
          next,
          BASE_ID.気力,
          (getMasterBase(next, BASE_ID.気力) ?? 0) - 100,
        );
        const sources: Record<number, number> = {
          [SOURCE_ID.反感]: 500,
          [SOURCE_ID.鬱屈]: 100,
        };
        const settled = applySourceCheck(next, ctx.target, sources, 0);
        sourceEvents.push(...settled.events);
        // LOCAL:3 == 1 異常清掃経験 grant (ERB 142-152) deferred.
      }
    }

    const tone =
      severityBefore >= 3
        ? "把脏乱不堪的房间"
        : severityBefore >= 1
          ? "把房间"
          : "把略显凌乱的房间";
    const joinText = helperJoined ? "和帮手一起" : "";
    return {
      state: next,
      events: [
        {
          kind: "NARRATION" as const,
          timestamp: ctx.now(),
          text: `%CALLNAME:MASTER% ${joinText}${tone}打扫了一番，清理掉了 ${removed} 点污渍。`,
        },
        ...sourceEvents,
      ],
      outcome: "ok" as const,
    };
  },
};
