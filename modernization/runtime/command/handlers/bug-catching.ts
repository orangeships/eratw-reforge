/**
 * COMF449 虫捕り — bug-catching command handler (V1).
 *
 * V1 scope: core mechanics — partner selection, power/luck calculation,
 * bug drawing, item conversion, SOURCE/EXP rewards, TIME cost.
 *
 * TODO (V2 残件):
 * - Bug cage storage (MUSHI_CAGE → 留给 483/497)
 * - Bug collection book (MUSHI_COLLECT)
 * - Partner catch negotiation (相手が捕った→抢/求/杀 3选项)
 * - G-type / X-type mutations
 * - Rank system for bug stats
 * - Full 100+ bug data table (currently ~20 representative bugs)
 * - MUSHI_PALAM battle stats (HP/ATK/SPD/SKL)
 * - 昆虫诱捕装置 mode
 */
import type { ObservationEvent } from "../../../schemas/types.js";
import type { CommandContext, FailReason, HandlerEntry } from "../types.js";
import { cloneGameState } from "../../state/game-state.js";
import {
  drawBug,
  calcBugPower,
  mushitoriSpot,
  isBugSeason,
  storeCaughtBug,
  BUG_BAIT_CATALOG,
  collectBugTrap,
  discardBugTrap,
  placeBugTrap,
} from "../../state/bug-catching.js";
import { pickOne, requirePickOne, type PromptSpec } from "../prompt.js";
import {
  ABL_ID,
  BASE_ID,
  CFLAG_ID,
  EXP_ID,
  FLAG_ID,
  SOURCE_ID,
  TALENT_ID,
  advanceTimeTicks,
} from "../../state/settlement.js";
import { applySourceCheck } from "../source-check.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type CheckResult = { ok: true } | { ok: false; reason: FailReason };

function block(message: string): CheckResult {
  return { ok: false, reason: { kind: "precondition", message } };
}

function callName(ctx: CommandContext, charaNum: number): string {
  if (charaNum === 0) return ctx.state.master.callName ?? "主人公";
  return ctx.state.charas[charaNum]?.callName ?? `角色${charaNum}`;
}

function reasonMessage(reason: FailReason): string {
  if ("message" in reason) return reason.message;
  return `命令 ${reason.commandNo} 不存在。`;
}

// ---------------------------------------------------------------------------
// execCheck
// ---------------------------------------------------------------------------

function eligible(ctx: CommandContext): CheckResult {
  const master = ctx.state.master;

  // 时间停止中
  if ((ctx.state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0) {
    return block("时间停止中无法捕虫。");
  }
  // 昆虫採集套装がない
  if (!ctx.state.items || (ctx.state.items[25] ?? 0) === 0) {
    return block("需要昆虫採集套装才能捕虫。");
  }
  // 冬の間はおやすみ
  if (!isBugSeason(ctx.state.time.season ?? 1)) {
    return block("冬天没有虫子可抓。");
  }
  // 捕虫できる場所である
  if (!mushitoriSpot(master.location)) {
    return block("这里无法捕虫。");
  }
  // 约会中は约会的对象とだけ
  if ((ctx.state.flagStore[FLAG_ID.デート相手] ?? 0) !== 0) {
    const datePartner = ctx.state.flagStore[FLAG_ID.デート相手]!;
    if (!ctx.target || ctx.target !== datePartner) {
      return block("约会中只能和约会对象一起捕虫。");
    }
  }
  // 陪睡中
  if ((master.state.CFLAG[CFLAG_ID.陪睡中] ?? 0) !== 0) {
    return block("陪睡中无法捕虫。");
  }
  // 诶嘿嘿中
  if ((master.state.CFLAG[CFLAG_ID.诶嘿嘿] ?? 0) !== 0) {
    return block("当前状态下无法捕虫。");
  }
  // 睡眠中
  if ((master.state.CFLAG[CFLAG_ID.睡眠] ?? 0) !== 0) {
    return block("睡眠中无法捕虫。");
  }
  // 体力・気力不足
  if ((master.state.BASE[BASE_ID.気力] ?? 0) < 800 ||
      (master.state.BASE[BASE_ID.体力] ?? 0) < 800) {
    return block(`${callName(ctx, 0)}的体力或气力不足。`);
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Partner selection
// ---------------------------------------------------------------------------

function selectPartner(ctx: CommandContext): number {
  const datePartner = ctx.state.flagStore[FLAG_ID.デート相手] ?? 0;
  if (datePartner !== 0) {
    if ((ctx.state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0) {
      if (ctx.target && (ctx.state.charas[ctx.target]?.state.CFLAG[CFLAG_ID.時間停止行動] ?? 0) === 1) {
        return ctx.target;
      }
      return 0;
    }
    return datePartner;
  }

  if (ctx.target && ctx.target > 0) {
    const t = ctx.state.charas[ctx.target];
    if (t) {
      const intimacy = t.state.ABL[ABL_ID.親密] ?? 0;
      const gatheringLv = t.state.TALENT[TALENT_ID.採集Lv] ?? 0;
      const isAwake = (t.state.CFLAG[CFLAG_ID.睡眠] ?? 0) === 0;
      const notWorking = (t.state.CFLAG[CFLAG_ID.行动] ?? 0) !== 5;
      if (intimacy >= 5 - gatheringLv && isAwake && notWorking) {
        return ctx.target;
      }
    }
  }

  return 0;
}

// ---------------------------------------------------------------------------
// SOURCE calculation
// ---------------------------------------------------------------------------

/**
 * Build source record for bug-catching partner reward.
 * Returns a record suitable for `applySourceCheck()`.
 */
function buildBugSource(
  state: ReturnType<typeof cloneGameState>,
  charaNum: number,
  caught: boolean,
): Record<number, number> {
  const c = state.charas[charaNum]!;
  const obedience = c.state.ABL[ABL_ID.従順] ?? 0;
  const intimacy = c.state.ABL[ABL_ID.親密] ?? 0;
  const sadism = c.state.ABL[ABL_ID.施虐属性] ?? 0;

  let pleasure = 400;
  let affection = 50;

  if (obedience <= 1) {
    pleasure += obedience * 40;
    affection += intimacy * 20;
  } else if (obedience <= 3) {
    pleasure += 200 + obedience * 40;
    affection += 50 + intimacy * 30;
  } else if (obedience <= 5) {
    pleasure += 500 + obedience * 40;
    affection += 200 + intimacy * 30;
  } else if (obedience <= 8) {
    pleasure += 750 + obedience * 60;
    affection += 300 + intimacy * 40;
  } else if (obedience <= 11) {
    pleasure += 1000 + obedience * 60;
    affection += 600 + intimacy * 40;
  } else {
    pleasure += 1600 + obedience * 30;
    affection += 1000 + intimacy * 20;
  }

  let passive = 200 + 100 * obedience;
  let conquer = 200 + 100 * sadism;

  if (!caught) {
    pleasure = Math.floor(pleasure * 0.5);
    passive = Math.floor(passive * 0.5);
    conquer = Math.floor(conquer * 0.5);
  }

  // Emuera applies TIMES ×2 to these (time efficiency parity with fishing)
  const source: Record<number, number> = {};
  source[SOURCE_ID.歓楽] = pleasure * 2;
  source[SOURCE_ID.受動] = passive * 2;
  source[SOURCE_ID.征服] = conquer * 2;
  source[SOURCE_ID.情愛] = affection * 2;

  return source;
}

function scaledSource(source: Record<number, number>, factor: number, resentment = 0): Record<number, number> {
  const scaled = Object.fromEntries(Object.entries(source).map(([id, value]) => [Number(id), Math.floor(value * factor)]));
  if (resentment > 0) scaled[SOURCE_ID.反感] = resentment;
  return scaled;
}

type PartnerCatchChoice = "praise" | "seize" | "request";

function partnerCatchPrompt(ctx: CommandContext): PromptSpec | null {
  const partner = selectPartner(ctx);
  if (!partner) return null;
  return pickOne("若同伴先抓到虫子，你要怎么回应？", [
    { id: "praise", label: "这相当不错嘛", detail: "夸奖同伴；虫归同伴，不进入虫笼" },
    { id: "seize", label: "即使杀了你也要抢走", detail: "强抢；会显著增加反感" },
    { id: "request", label: "请让给我，拜托了！", detail: "会依同伴的亲密与顺从决定是否交出" },
  ]);
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const comf449HandlerEntry: HandlerEntry = {
  commandNo: 449,
  execCheck: eligible,
  prompt: partnerCatchPrompt,
  handler: (ctx) => {
    const check = eligible(ctx);
    if (!check.ok) {
      return {
        state: cloneGameState(ctx.state),
        events: [{ kind: "NARRATION", timestamp: ctx.now(), text: reasonMessage(check.reason) }],
        outcome: "blocked",
        failReason: check.reason,
      };
    }

    const next = cloneGameState(ctx.state);
    const master = next.master;
    const partnerNum = selectPartner(ctx);
    const partner = partnerNum > 0 ? next.charas[partnerNum] : undefined;
    const events: ObservationEvent[] = [];
    // The UI always resolves this picker before entering the handler. Keep
    // direct/runtime callers fail-closed instead of silently choosing a
    // social interaction on the player's behalf.
    const interactionChoice = partner
      ? requirePickOne(partnerCatchPrompt(ctx)!, ctx.promptAnswer) as PartnerCatchChoice | null
      : null;
    if (partner && interactionChoice === null) {
      const reason: FailReason = { kind: "precondition", message: "需要选择同伴捕获时的回应。" };
      return { state: cloneGameState(ctx.state), events: [{ kind: "NARRATION", timestamp: ctx.now(), text: reason.message }], outcome: "blocked", failReason: reason };
    }

    // Power calculation
    const luckM = Math.max(10, Math.min(1000,
      (master.state.CFLAG[CFLAG_ID.今日の運勢] ?? 500) + 1));
    const gatheringLv = master.state.TALENT[TALENT_ID.採集Lv] ?? 0;
    const powerM = calcBugPower(luckM, gatheringLv);

    let powerT = 0;
    if (partner) {
      const luckT = Math.max(10, (partner.state.CFLAG[CFLAG_ID.今日の運勢] ?? 500) + 1);
      powerT = calcBugPower(luckT, partner.state.TALENT[TALENT_ID.採集Lv] ?? 0);
    }

    // Catch attempt — faithful outer `RAND:power < 2` miss check, then the
    // actual species draw. The companion only gets a turn after the master
    // misses, which makes the post-catch social interaction reachable.
    let caughtByPartner = false;
    let bugResult = Math.floor(ctx.rng.next() * powerM) >= 2
      ? drawBug(master.location, powerM, next.time.season ?? 1, next.time.hourOfDay, ctx.rng.next, next.time.date ?? 1)
      : null;

    if (!bugResult && partner && powerT > 0 && Math.floor(ctx.rng.next() * powerT) >= 2) {
      const partnerResult = drawBug(master.location, powerT, next.time.season ?? 1, next.time.hourOfDay, ctx.rng.next, next.time.date ?? 1);
      if (partnerResult) {
        bugResult = partnerResult;
        caughtByPartner = true;
      }
    }

    // Apply EXP
    master.state.EXP[EXP_ID.採集経験] = (master.state.EXP[EXP_ID.採集経験] ?? 0) + 1;
    if (partner) {
      partner.state.EXP[EXP_ID.採集経験] = (partner.state.EXP[EXP_ID.採集経験] ?? 0) + 1;
    }

    // Apply costs (DOWNBASE)
    master.state.BASE[BASE_ID.体力] = (master.state.BASE[BASE_ID.体力] ?? 0) - 150;
    master.state.BASE[BASE_ID.気力] = (master.state.BASE[BASE_ID.気力] ?? 0) - 200;
    if (partner) {
      partner.state.BASE[BASE_ID.体力] = (partner.state.BASE[BASE_ID.体力] ?? 0) - 150;
      partner.state.BASE[BASE_ID.気力] = (partner.state.BASE[BASE_ID.気力] ?? 0) - 200;
    }

    if (bugResult) {
      const catcherPower = caughtByPartner ? powerT : powerM;
      const catcherLuck = caughtByPartner && partner
        ? Math.max(10, (partner.state.CFLAG[CFLAG_ID.今日の運勢] ?? 500) + 1)
        : luckM;
      const requested = caughtByPartner ? interactionChoice : null;
      let storesCapture = !caughtByPartner;
      let sourceFactor = 1;
      let resentment = 0;
      let reluctantTransfer = false;
      if (caughtByPartner && partner) {
        if (requested === "seize") {
          storesCapture = true;
          sourceFactor = 0.5;
          resentment = 500;
          // Upstream refunds the catching-time stamina cost for the violent grab.
          master.state.BASE[BASE_ID.体力] = (master.state.BASE[BASE_ID.体力] ?? 0) + 150;
          master.state.BASE[BASE_ID.気力] = (master.state.BASE[BASE_ID.気力] ?? 0) + 200;
          partner.state.BASE[BASE_ID.体力] = (partner.state.BASE[BASE_ID.体力] ?? 0) + 150;
          partner.state.BASE[BASE_ID.気力] = (partner.state.BASE[BASE_ID.気力] ?? 0) + 200;
        } else if (requested === "request") {
          const obedience = partner.state.ABL[ABL_ID.従順] ?? 0;
          const intimacy = partner.state.ABL[ABL_ID.親密] ?? 0;
          if (obedience < 6 || intimacy < 6 || (partner.state.MARK[1] ?? 0) > 0 || (partner.state.TALENT[TALENT_ID.心情] ?? 0) < 0) {
            resentment = 50;
          } else {
            storesCapture = true;
            if (obedience < 8 || intimacy < 8) {
              // Reluctant agreement: passive source ×1.5.
              reluctantTransfer = true;
            } else {
              // Wholehearted agreement: pleasant/passive/affection ×1.5.
              sourceFactor = 1.5;
            }
          }
        } else {
          sourceFactor = 1.5;
        }
      }
      const stored = storesCapture ? storeCaughtBug(next, bugResult, catcherPower, catcherLuck, ctx.rng.next) : null;

      if (caughtByPartner && partner) {
        partner.state.EXP[EXP_ID.採集経験] = (partner.state.EXP[EXP_ID.採集経験] ?? 0) + 1;
        const resultText = requested === "seize"
          ? `你强行从${callName(ctx, partnerNum)}手中抢走了${bugResult.bug.name}。`
          : requested === "request" && !storesCapture
            ? `${callName(ctx, partnerNum)}没有答应把${bugResult.bug.name}让给你。`
            : requested === "request"
              ? `${callName(ctx, partnerNum)}把${bugResult.bug.name}交给了你。`
              : `${callName(ctx, partnerNum)}捕获了${bugResult.bug.name}，自己收下了。`;
        events.push({ kind: "NARRATION", timestamp: ctx.now(), text: stored
          ? `${resultText} 已放进虫笼！`
          : `${resultText}${storesCapture ? " 但虫笼已经满了，只能放生。" : ""}` });
      } else {
        master.state.EXP[EXP_ID.採集経験] = (master.state.EXP[EXP_ID.採集経験] ?? 0) + 1;
        events.push({ kind: "NARRATION", timestamp: ctx.now(), text: stored
          ? `捕获了${bugResult.bug.name}，放进了虫笼！`
          : `捕获了${bugResult.bug.name}，但虫笼已经满了，只能放生。` });
      }

      // SOURCE for partner (via applySourceCheck)
      if (partner) {
        const sourceValues = scaledSource(buildBugSource(next, partnerNum, true), sourceFactor, resentment);
        if (reluctantTransfer) sourceValues[SOURCE_ID.受動] = Math.floor((sourceValues[SOURCE_ID.受動] ?? 0) * 1.5);
        const sourceResult = applySourceCheck(next, partnerNum, sourceValues);
        events.push(...sourceResult.events.map(e => ({ ...e, timestamp: ctx.now() })));

        // TODO(V2): 妖虫 tribe bonus ×2.0, butterfly/拉尔瓦 bonus, rarity bonus
      }
    } else {
      events.push({
        kind: "NARRATION", timestamp: ctx.now(),
        text: "没有抓到任何虫子……",
      });
      if (partner) {
        const sourceValues = buildBugSource(next, partnerNum, false);
        const sourceResult = applySourceCheck(next, partnerNum, sourceValues);
        events.push(...sourceResult.events.map(e => ({ ...e, timestamp: ctx.now() })));
      }
    }

    // Advance time
    events.push(...advanceTimeTicks(next, 40).map(e => ({ ...e, timestamp: ctx.now() })));

    return { state: next, events, outcome: "ok" };
  },
};

// ---------------------------------------------------------------------------
// COMF448 昆虫诱捕装置
// ---------------------------------------------------------------------------

function trapEligible(ctx: CommandContext): CheckResult {
  if ((ctx.state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0) return block("时间停止中无法设置诱捕装置。");
  if ((ctx.state.items?.[25] ?? 0) <= 0) return block("需要昆虫採集套装才能设置诱捕装置。");
  if (!mushitoriSpot(ctx.state.master.location)) return block("这里无法设置昆虫诱捕装置。");
  if ((ctx.state.master.state.CFLAG[CFLAG_ID.诶嘿嘿] ?? 0) !== 0) return block("当前状态下无法设置诱捕装置。");
  return { ok: true };
}

function trapPrompt(ctx: CommandContext): PromptSpec | null {
  const trap = ctx.state.bugTrap;
  if (trap) {
    if (trap.location !== ctx.state.master.location || trap.caughtBugNum !== undefined) return null;
    return pickOne(`诱捕装置仍在等待（诱饵：${trap.baitName}，品质：${"☆".repeat(trap.baitQuality)}）。`, [
      { id: "keep", label: "保持原样" },
      { id: "discard", label: "拆除诱捕装置" },
    ]);
  }
  const baits = BUG_BAIT_CATALOG
    .filter((bait) => (ctx.state.items?.[bait.itemId] ?? 0) > 0)
    .map((bait) => ({ id: bait.itemId, label: bait.name, detail: `持有 ${ctx.state.items?.[bait.itemId] ?? 0}　${"☆".repeat(bait.quality)}　${bait.types}` }));
  return pickOne("选择要放入昆虫诱捕装置的诱饵", [...baits, { id: "cancel", label: "放弃设置" }]);
}

export const comf448HandlerEntry: HandlerEntry = {
  commandNo: 448,
  gateStatus: "complete",
  execCheck: trapEligible,
  prompt: trapPrompt,
  handler: (ctx) => {
    const check = trapEligible(ctx);
    if (!check.ok) return { state: cloneGameState(ctx.state), events: [{ kind: "NARRATION", timestamp: ctx.now(), text: reasonMessage(check.reason) }], outcome: "blocked", failReason: check.reason };
    const next = cloneGameState(ctx.state);
    const existing = next.bugTrap;
    const answer = trapPrompt(ctx) ? requirePickOne(trapPrompt(ctx)!, ctx.promptAnswer) : null;
    if (existing) {
      if (existing.location !== next.master.location) {
        return { state: next, events: [{ kind: "NARRATION", timestamp: ctx.now(), text: `诱捕装置仍设置在${existing.location}，请先回去查看。` }], outcome: "blocked", failReason: { kind: "precondition", message: "诱捕装置不在当前地点" } };
      }
      const caught = collectBugTrap(next, ctx.rng.next);
      if (caught) {
        const text = caught.stored
          ? `诱捕装置捕获了${caught.bug.name}，已放进虫笼！`
          : `诱捕装置捕获了${caught.bug.name}，但虫笼已满，只能放生。`;
        return { state: next, events: [{ kind: "NARRATION", timestamp: ctx.now(), text }, ...advanceTimeTicks(next, 5).map((event) => ({ ...event, timestamp: ctx.now() }))], outcome: "ok" };
      }
      if (answer === "discard") {
        discardBugTrap(next);
        return { state: next, events: [{ kind: "NARRATION", timestamp: ctx.now(), text: "拆除了昆虫诱捕装置。" }, ...advanceTimeTicks(next, 5).map((event) => ({ ...event, timestamp: ctx.now() }))], outcome: "ok" };
      }
      return { state: next, events: [{ kind: "NARRATION", timestamp: ctx.now(), text: "诱捕装置还没有等到虫子来，保持原样。" }], outcome: "noop" };
    }
    if (answer === null || answer === "cancel") return { state: next, events: [{ kind: "NARRATION", timestamp: ctx.now(), text: "没有设置诱捕装置。" }], outcome: "noop" };
    const trap = typeof answer === "number" ? placeBugTrap(next, answer) : null;
    if (!trap) return { state: next, events: [{ kind: "NARRATION", timestamp: ctx.now(), text: "选择的道具不能作为昆虫诱饵。" }], outcome: "blocked", failReason: { kind: "precondition", message: "无效诱饵" } };
    next.master.state.BASE[BASE_ID.体力] = (next.master.state.BASE[BASE_ID.体力] ?? 0) - 50;
    next.master.state.BASE[BASE_ID.気力] = (next.master.state.BASE[BASE_ID.気力] ?? 0) - 50;
    return { state: next, events: [{ kind: "NARRATION", timestamp: ctx.now(), text: `在这里设置了昆虫诱捕装置（${trap.baitName}，${"☆".repeat(trap.baitQuality)}）。` }, ...advanceTimeTicks(next, 20).map((event) => ({ ...event, timestamp: ctx.now() }))], outcome: "ok" };
  },
};
