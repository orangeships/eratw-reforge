/**
 * COMF697 部屋を訪ねる (visit a chara's private room) — full ceremony.
 *
 * Modern equivalent of `@COM697` (`ERB/コマンド関連/COMF/外出系/COMF697 部屋を訪ねる.ERB`)
 * plus `@COM697_1` (SOURCE settlement). Ports the complete 388-line flow that
 * the old MVP deferred:
 *
 *   picker (B9) → date/嫉妬/浮気/1-day gates → RAND:10 TFLAG:193 tier
 *     (1 無回應 / 2 多忙 / 3 稍待 / 4 可進) → 三角麦田節分 → ONABARE trigger
 *     → branch narration + 翌日来訪 + COM697_1 SOURCE (case 2/3) → CASE 4
 *     ASK_YN (邀请约会 / 打扰了) → date or `omanekiEnter`.
 *
 * **Prompt flow (stagedPrompt)**: stage 0 = B9 target picker; stage 1 depends
 * on the RAND tier — ONABARE triggers a 3-way (失礼了/继续看/两个人一起),
 * CASE 4 shows ASK_YN, everything else settles directly. Both the prompt and
 * the handler call `planOmaneki697` with the same seeded `rng`, so the RAND
 * rolls are byte-identical across the prompt stages and the settlement (the
 * store rebuilds `createRng(commandNo*100003+tickValue)` for every stage).
 *
 * **Deferred (documented, faithful to plan)**:
 *   - IRAI_VISIT_HOME / QOL_WHITE_DAY_HOME_DELIVERY qol dispatch arms.
 *   - SUKIMA()/VISIT() force-tier-1 terms (gap not modeled); only 拠点来訪 and
 *     体力<1000 are honored.
 *   - 兎符「開運大紋」 forced-ONABARE item branch.
 *   - `PRINT_FACE` expression arms; ONABARE_HOLE/ONABARE personal kojo function
 *     types (EVENT 26 arms are dispatched via the router when present).
 *   - The `被掌握把柄` picker color + IRAI/白情 highlight hints.
 */
import type { GameState } from "../../state/game-state.js";
import type { HandlerEntry, CommandContext } from "../types.js";
import type { PromptAnswer, PromptSpec } from "../prompt.js";
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
  getMasterCflag,
} from "../../state/settlement.js";
import { getTflag, setTflagBit, TFLAG_ID } from "../../state/tflag.js";
import type { ObservationEvent } from "../../../schemas/types.js";
import { atPlayerBase } from "../../world/location-predicates.js";
import { mapIdOfLocation } from "../../world/location-predicates.js";
import { startDate } from "../../world/date-session.js";
import {
  omanekiEnter,
  omanekiPlaceOf,
  OMANEKI_PLACE,
} from "../../world/omaneki.js";
import { onabare, type OnabareChoice } from "../../world/onabare.js";
import { applySourceCheck } from "../source-check.js";
import { pickOne, askYn } from "../prompt.js";
import { addItem } from "../../state/items.js";
import { dateOf, seasonOf, SEASON_AUTUMN } from "../../world/calendar.js";

/** Upstream jealousy charaNum (輝夜). */
const JEALOUSY_CHARA = 60;

function block(
  message: string,
): { ok: false; reason: { kind: "precondition"; message: string } } {
  return { ok: false, reason: { kind: "precondition", message } };
}

/** Accumulated staged-prompt selections. */
function sequenceValues(
  answer: PromptAnswer | undefined,
): readonly (number | string)[] {
  return answer?.kind === "pick_sequence" ? answer.values : [];
}

function narration(state: GameState, text: string): ObservationEvent {
  return { kind: "NARRATION", timestamp: state.time.tickValue, text };
}

/** List the visit-eligible charaNum in master's current room.
 *  - 自宅位置 matches the master's current location — the resident may be
 *    away from home when the command is issued
 *  - !CFLAG:出禁
 *  - !CFLAG:神社在住 (modifier exclusion)
 *  - the upstream picker deliberately includes non-love candidates; those
 *    candidates are downgraded after the RAND roll
 *  - the date partner is excluded; the staged target is validated again by
 *    the handler before any state is committed */
function listVisitCandidates(state: GameState): number[] {
  const masterLoc = state.master.location;
  const partner = state.flagStore[FLAG_ID.デート相手] ?? 0;
  const out: number[] = [];
  for (const [k, slot] of Object.entries(state.charas)) {
    const n = Number(k);
    if ((slot.homeLocation ?? slot.location) !== masterLoc) continue;
    if ((slot.state.CFLAG[CFLAG_ID.出禁] ?? 0) !== 0) continue;
    if ((slot.state.CFLAG[CFLAG_ID.神社在住] ?? 0) !== 0) continue;
    if (n === partner) continue;
    if (n === 0) continue;
    out.push(n);
  }
  return out;
}

/** Same-room 嫉妬/浮気 detector (mirrors 698). */
function detectBystanders697(state: GameState, target: number): {
  jealousy: number;
  infidelity: number;
} {
  // COMF697.ERB:86: 左拥右抱 belongs to MASTER, not to each bystander.
  // When the master has this talent the jealousy/infidelity interruption is
  // intentionally disabled for the whole room.
  if ((state.master.state.TALENT[TALENT_ID.左拥右抱] ?? 0) !== 0) {
    return { jealousy: 0, infidelity: 0 };
  }
  let jealousy = 0;
  let infidelity = 0;
  for (const [k, slot] of Object.entries(state.charas)) {
    const n = Number(k);
    if (n === target) continue;
    if (slot.location !== state.master.location) continue;
    if ((slot.state.TALENT[TALENT_ID.左拥右抱] ?? 0) !== 0) continue;
    if (n === JEALOUSY_CHARA) {
      jealousy = n;
      continue;
    }
    const has恋慕 = (slot.state.TALENT[TALENT_ID.恋慕] ?? 0) !== 0;
    const lowTrust = (slot.state.CFLAG[CFLAG_ID.信頼度] ?? 0) < 1000;
    if (has恋慕 && lowTrust) {
      infidelity = n;
    }
  }
  return { jealousy, infidelity };
}

function check697Eligible(
  state: Readonly<GameState>,
  actor: number,
): { ok: true } | { ok: false; reason: { kind: "precondition"; message: string } } {
  if (actor !== 0) return block("訪問は主人公だけが実行できます。");
  if (atPlayerBase(state as GameState, 0)) {
    return block("拠点内では訪問できません。");
  }
  if (getMasterCflag(state as GameState, CFLAG_ID.诶嘿嘿) === 2) {
    return block("诶嘿嘿中です。");
  }
  if ((state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0) {
    return block("時間停止中です。");
  }
  if (((state.flagStore[FLAG_ID.潜伏] ?? 0) & 1) !== 0) {
    return block("潜伏中です。");
  }
  if (listVisitCandidates(state as GameState).length === 0) {
    return block("訪問できる相手がいません。");
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// The shared RAND plan — identical (seed-locked) rolls for prompt + handler.
// ---------------------------------------------------------------------------

type Omaneki697Plan =
  | { kind: "blocked"; message: string }
  | { kind: "setsubun"; giveSnack: boolean }
  | { kind: "onabare" }
  | { kind: "tier1"; sameRoom: boolean }
  | { kind: "tier2" }
  | { kind: "tier3" }
  | { kind: "case4" };

/** Roll the 697 ceremony state without mutating anything. Pure with respect to
 *  `state`; consumes `rng` in a fixed order (tier → ONABARE), identical when
 *  called from the prompt and from the handler (same seed). */
function planOmaneki697(
  state: Readonly<GameState>,
  rng: CommandContext["rng"],
  target: number,
): Omaneki697Plan {
  const t = state.charas[target];
  if (!t) return { kind: "blocked", message: "訪問相手がいません。" };
  // Body-level gates (pure, no RNG) — mirror upstream ERB 77-108.
  if (state.dateSession || (state.flagStore[FLAG_ID.デート相手] ?? 0) !== 0) {
    const partnerName =
      state.flagStore[FLAG_ID.デート相手] != null && state.flagStore[FLAG_ID.デート相手] !== 0
        ? state.charas[state.flagStore[FLAG_ID.デート相手]!]?.callName ?? "相手"
        : "相手";
    return { kind: "blocked", message: `虽然想进入${t.callName ?? `#${target}`}の私室、却被${partnerName}死死地用眼神睨视着。` };
  }
  const { jealousy, infidelity } = detectBystanders697(state as GameState, target);
  if (jealousy || infidelity) {
    const actorName = jealousy
      ? state.charas[jealousy]?.callName ?? `#${jealousy}`
      : state.charas[infidelity]?.callName ?? `#${infidelity}`;
    // ERB 96-102: 嫉妬 is 干涉 (恶鬼般), 浮気 is 叫住 (惊讶之色).
    const verb = jealousy ? "干涉" : "叫住";
    return { kind: "blocked", message: `虽然想进入${t.callName ?? `#${target}`}の私室、却被${actorName}给${verb}了。` };
  }
  if ((t.state.TCVAR[TCVAR_ID.お宅訪問] ?? 0) !== 0) {
    return { kind: "blocked", message: "今天还是算了吧。" };
  }
  // RAND:10 tier (ERB 110-122) — roll 1.
  const roll = rng.int(10);
  let tier: number;
  if (roll <= 1) tier = 1;
  else if (roll <= 4) tier = 2;
  else if (roll <= 7) tier = 3;
  else tier = 4;
  // 非恋慕/思慕 降档 (ERB 123-124).
  if ((t.state.TALENT[TALENT_ID.恋慕] ?? 0) === 0 && (t.state.TALENT[TALENT_ID.思慕] ?? 0) === 0 && tier > 2) {
    tier -= 1;
  }
  // 强制档1 — 拠点来訪 / 体力<1000 (ERB 126-127; SUKIMA/VISIT deferred).
  if ((t.state.CFLAG[CFLAG_ID.拠点来訪] ?? 0) !== 0 || (t.state.BASE[BASE_ID.体力] ?? 0) < 1000) {
    tier = 1;
  }
  // 三角麦田節分 (ERB 144) — date check, no RNG.
  if (seasonOf(state.time) === SEASON_AUTUMN && (dateOf(state.time) === 13 || dateOf(state.time) === 15) && tier > 1) {
    const giveSnack =
      (t.state.ABL[ABL_ID.教養] ?? 0) >= 5 || target === 77 || target === 78;
    return { kind: "setsubun", giveSnack };
  }
  // ONABARE trigger (ERB 174-177) — rolls 2,3.
  const frustration = t.state.CFLAG[CFLAG_ID.溜まってる度] ?? 0;
  if (tier > 1 && frustration > 300) {
    const luck = getTflag(state as GameState, TFLAG_ID.幸運補正);
    const r1 = rng.int(frustration + luck * 50);
    const r2 = rng.int(700);
    if (r1 >= r2) return { kind: "onabare" };
    // 兎符「開運大紋」 forced arm deferred (item unmodeled).
  }
  switch (tier) {
    case 1:
      return { kind: "tier1", sameRoom: state.master.location === t.location };
    case 2:
      return { kind: "tier2" };
    case 3:
      return { kind: "tier3" };
    default:
      return { kind: "case4" };
  }
}

// ---------------------------------------------------------------------------
// Prompt (staged: B9 picker → ONABARE 3-way / CASE-4 ASK_YN)
// ---------------------------------------------------------------------------

export function omaneki697Prompt(ctx: CommandContext): PromptSpec | null {
  const sel = sequenceValues(ctx.promptAnswer);
  if (sel.length === 0) {
    const cands = listVisitCandidates(ctx.state as GameState);
    return pickOne(
      "誰の部屋を訪ねる？",
      cands.map((n) => {
        const slot = ctx.state.charas[n]!;
        const hasLeverage = (slot.state.CFLAG[CFLAG_ID.被掌握把柄] ?? 0) !== 0;
        return {
          id: n,
          label: omanekiPlaceOf(slot.callName ?? `#${n}`),
          ...(hasLeverage ? { detail: "（把柄）" } : {}),
        };
      }),
    );
  }
  const target = Number(sel[0]);
  if (!Number.isInteger(target) || target <= 0) return null;
  const plan = planOmaneki697(ctx.state, ctx.rng, target);
  if (plan.kind === "blocked") return null; // the handler blocks below.
  if (sel.length === 1) {
    if (plan.kind === "onabare") {
      return pickOne("听到了苦闷的声音…… 怎么办？", [
        { id: "away" as const, label: "失礼了" },
        { id: "watch" as const, label: "继续看" },
        {
          id: "join" as const,
          label: "两个人一起",
          disabled:
            (ctx.state.master.state.MAXBASE[BASE_ID.精力] ?? 0) > 0 &&
            (ctx.state.master.state.BASE[BASE_ID.精力] ?? 0) <=
              (ctx.state.master.state.MAXBASE[BASE_ID.精力] ?? 0) / 5,
        },
      ]);
    }
    if (plan.kind === "case4") {
      const tSlot = ctx.state.charas[target];
      const name = tSlot?.callName ?? `#${target}`;
      return askYn(`${name}好像很开心的样子…\n「有事吗？」`, "邀请约会", "打扰了");
    }
    return null;
  }
  return null; // ONABARE choice / CASE-4 answer chosen → settle.
}

// ---------------------------------------------------------------------------
// COM697_1 SOURCE settlement (ERB 276-356)
// ---------------------------------------------------------------------------

/** 話術技能 multiplier (CASE 0..4 → 0.20/0.40/0.70/1.00/1.20; else 1.50). */
const TALK_MULT = [0.2, 0.4, 0.7, 1.0, 1.2];

function settleCom697One(
  next: GameState,
  target: number,
  tier: number,
): void {
  const t = next.charas[target];
  if (!t) return;
  const abl = (id: number): number => t.state.ABL[id] ?? 0;
  const intimacy = abl(ABL_ID.親密);
  const obedience = abl(ABL_ID.従順);
  const sadism = abl(ABL_ID.施虐属性);
  // 歓楽 base 200 + 親密 ladder (ERB 287-300).
  let kanraku = 200;
  if (intimacy <= 1) kanraku += obedience * 40;
  else if (intimacy <= 3) kanraku += 200 + obedience * 40;
  else if (intimacy <= 5) kanraku += 500 + obedience * 40;
  else if (intimacy <= 8) kanraku += 750 + obedience * 60;
  else if (intimacy <= 10) kanraku += 1000 + obedience * 60;
  else kanraku += 1600 + obedience * 30;
  // 好感度 BONUS (ERB 302-311).
  const favor = t.state.CFLAG[CFLAG_ID.好感度] ?? 0;
  if (favor <= 1000) kanraku += favor;
  else if (favor <= 5000) kanraku += 500 + Math.trunc((favor - 500) / 3);
  else kanraku += 2000 + Math.trunc((favor - 5000) / 5);
  if (kanraku < 0) kanraku = 0;
  // 受動/征服 base (ERB 314-315).
  let judo = 100 + 100 * obedience;
  let seifuku = 100 + 100 * sadism;
  // MASTER 話術技能 multiplier (ERB 317-342).
  const talk = next.master.state.ABL[ABL_ID.話術技能] ?? 0;
  const mult = TALK_MULT[talk] ?? 1.5;
  kanraku = Math.trunc(kanraku * mult);
  seifuku = Math.trunc(seifuku * mult);
  judo = Math.trunc(judo * mult);
  // TFLAG:193 == 3 → ×3.50 + 好感度BONUS 200 (ERB 344-349).
  const favorBias = tier === 3 ? 200 : 0;
  if (tier === 3) {
    kanraku = Math.trunc(kanraku * 3.5);
    seifuku = Math.trunc(seifuku * 3.5);
    judo = Math.trunc(judo * 3.5);
  }
  applySourceCheck(
    next,
    target,
    { [SOURCE_ID.歓楽]: kanraku, [SOURCE_ID.征服]: seifuku, [SOURCE_ID.受動]: judo },
    favorBias,
    5, // TFLAG:信頼度管理 = 5 → TRUST_CALC runs.
  );
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const omaneki697HandlerEntry: HandlerEntry = {
  commandNo: 697,
  gateStatus: "complete",
  stagedPrompt: true,
  prompt: omaneki697Prompt,
  execCheck: (ctx) => check697Eligible(ctx.state, ctx.actor),
  handler: (ctx) => {
    const next: GameState = cloneGameState(ctx.state);
    const sel = sequenceValues(ctx.promptAnswer);
    const picked = Number(sel[0]);
    if (!Number.isInteger(picked) || picked <= 0) {
      return { state: next, events: [], outcome: "blocked" as const, failReason: { kind: "precondition" as const, message: "需要选择访问对象。" } };
    }
    const tSlot = next.charas[picked];
    if (!tSlot) {
      return { state: next, events: [narration(next, "訪問相手がいません。")], outcome: "noop" as const };
    }
    if (!listVisitCandidates(next).includes(picked)) {
      return {
        state: next,
        events: [narration(next, "その相手の私室には今は訪問できません。")],
        outcome: "blocked" as const,
        failReason: { kind: "precondition" as const, message: "訪問相手を選び直してください。" },
      };
    }
    const plan = planOmaneki697(next, ctx.rng, picked);
    if (plan.kind === "blocked") {
      return { state: next, events: [narration(next, plan.message)], outcome: "blocked" as const, failReason: { kind: "precondition" as const, message: plan.message } };
    }
    // お宅訪問 1/day latch (ERB 130) — stamped before the branch, so even a
    // no-response visit consumes today's visit.
    tSlot.state.TCVAR[TCVAR_ID.お宅訪問] = 1;
    const masterName = next.master.callName ?? "主人公";
    const events: ObservationEvent[] = [narration(next, `${masterName}拜访了${OMANEKI_PLACE}。`)];

    if (plan.kind === "setsubun") {
      tSlot.state.CFLAG[CFLAG_ID.最後に会った日] = dateOf(next.time);
      const name = tSlot.callName ?? `#${picked}`;
      if (plan.giveSnack) {
        events.push(narration(next, `「保佑保佑，三角麦田里荞麦丰收！」${masterName}祈祷着丰收。\n${name}给了我点心！`));
        addItem(next, [120, 212, 213, 216, 376][ctx.rng.int(5)]!, 1);
      } else {
        events.push(narration(next, `${name}露出了疑惑的表情……看来她不知道这种仪式呢。\n${name}默默地关上了门。\n${masterName}感到悲伤。`));
      }
      events.push(...advanceTimeTicks(next, 10));
      return { state: next, events, outcome: "ok" as const };
    }

    if (plan.kind === "onabare") {
      const choice = sel[1] as OnabareChoice | undefined;
      if (!choice) {
        return { state: next, events: [narration(next, "需要选择如何应对。")], outcome: "blocked" as const };
      }
      events.push(...onabare(next, picked, choice, { rng: ctx.rng, dialogueRouter: ctx.dialogueRouter }));
      events.push(...advanceTimeTicks(next, 3)); // $OWARI TIME += 3.
      return { state: next, events, outcome: "ok" as const };
    }

    const name = tSlot.callName ?? `#${picked}`;
    if (plan.kind === "tier1") {
      events.push(
        plan.sameRoom
          ? narration(next, `打开门缝的${name}说请不要擅自进来。`)
          : narration(next, `没有回应…　出门了或者在睡觉吧。`),
      );
      events.push(...advanceTimeTicks(next, 3)); // $OWARI.
      return { state: next, events, outcome: "ok" as const };
    }

    // tier2 / tier3 / case4 — the chara comes out.
    tSlot.state.CFLAG[CFLAG_ID.最後に会った日] = dateOf(next.time);
    events.push(narration(next, `${name}出来了。`));

    if (plan.kind === "tier2" || plan.kind === "tier3") {
      const busy = plan.kind === "tier2";
      const hasAffection =
        (tSlot.state.TALENT[TALENT_ID.恋慕] ?? 0) !== 0 || (tSlot.state.TALENT[TALENT_ID.思慕] ?? 0) !== 0;
      if (busy) {
        events.push(narration(next, `${name}${hasAffection ? "感到有些抱歉" : "有些为难"}、说道今天没有时间请下次再说。`));
      } else {
        events.push(narration(next, `对${name}说因为想见她所以来了、哪怕只是一会儿也好……\n和${name}谈笑了一段时间。`));
      }
      // 翌日来訪 ASK (ERB 209-215 / 231-237) — handler-only roll.
      events.push(narration(next, `试着问了问明天能否见面、`));
      if (ctx.rng.int(2) === 0 && ((getTflag(next, TFLAG_ID.一日一回) >> 5) & 1) === 0) {
        tSlot.state.CFLAG[CFLAG_ID.翌日来訪] = 1;
        setTflagBit(next, TFLAG_ID.一日一回, 5);
        events.push(narration(next, `被告知明天打算来拜访。`));
      } else {
        events.push(narration(next, `被告知还不能确定行程。`));
      }
      settleCom697One(next, picked, plan.kind === "tier2" ? 2 : 3);
      events.push(...advanceTimeTicks(next, busy ? 5 : 30));
      return { state: next, events, outcome: "ok" as const };
    }

    // CASE 4 — 機嫌 cheerful + ASK_YN (invite / leave).
    tSlot.state.TALENT[TALENT_ID.心情] = 1;
    events.push(narration(next, `${name}好像很开心的样子…`));
    const ask = sel[1];
    const hasLove = (tSlot.state.TALENT[TALENT_ID.恋慕] ?? 0) !== 0;
    if (ask === 1 || !hasLove) {
      events.push(
        ask === 1
          ? narration(next, `邀请${name}去约会了。`)
          : narration(next, `虽然${masterName}提出希望能来打扰、但是被拒绝了。\n取而代之的是${name}提议约会，${masterName}毫不犹豫地点了点头。`),
      );
      startDate(next, {
        partner: picked,
        source: "player-405",
        mapId: mapIdOfLocation(next.master.location) ?? 0,
        destination: next.master.location,
      });
      next.master.state.CFLAG[CFLAG_ID.同行] = 60;
      tSlot.state.CFLAG[CFLAG_ID.同行] = 60;
      tSlot.state.CFLAG[CFLAG_ID.拠点来訪] = 1;
      events.push(...advanceTimeTicks(next, 3)); // $OWARI.
      return { state: next, events, outcome: "ok" as const };
    }
    const r = omanekiEnter(next, picked);
    if (!r.ok) {
      events.push(narration(next, r.reason ?? "訪問に失敗しました。"));
      return { state: next, events, outcome: "noop" as const };
    }
    events.push(narration(next, `${name}の${OMANEKI_PLACE}へ案内された。`));
    events.push(...advanceTimeTicks(next, 3)); // $OWARI.
    return { state: next, events, outcome: "ok" as const };
  },
};
