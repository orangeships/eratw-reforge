/**
 * H 场景的确定性事实投影（`runtime.scene_context`）。
 *
 * 为什么需要它：H 状态下各类信息的重要程度与日常不同（本轮生理事件、持续插入、
 * 长期身体经验、余韵/寸止的权重远高于地点天气），而 `l1InteractionKind()` 把 H
 * 命令一律判成 `settled-action`，没有任何场景分支。
 *
 * 三条硬约束：
 *   1. **本轮事件只能来自结算回执**。`KojoExecutionFrame.nowExByChara` 是唯一的
 *      当回合结构化记录，而它在出 resolver 时就被清掉（见 `h-settlement-receipt.ts`）。
 *      这里绝不解析作者口上/AI 地文，也不用 `afterState` 的 EXP 差值反推事件。
 *   2. **unknown 与 none 必须分开**。回执缺失 ⇒ `"unknown"`，**不是 `[]`**；空数组
 *      会被模型读成「本轮什么都没发生」。
 *   3. **长期与即时分开**。`body_profile` 是长期概况，`physical_state` 是此刻状态。
 *
 * 纯函数，且不依赖 web 层——命令名由调用方注入（runtime 自己没有命令名来源）。
 */

import type { CharaSlot, GameState, HSettlementReceipt } from "../state/game-state.js";
import { readHCurrentBodyState, readHInsertionRelation, type HCurrentBodyState } from "../state/h-interaction-state.js";
import { BASE_ID, CFLAG_ID, PALAM_ID, TALENT_ID, TCVAR_ID } from "../state/settlement.js";
import { afterglowLevel, afterglowStageLabel } from "../state/h-afterglow.js";
import { getHBodyStats } from "../state/h-body-stats.js";
import { hPoseLabel } from "../state/h-pose-label.js";
import { getPalamLv } from "../state/palam-level.js";
import { listTouches, readCurrentTouchPose, TOUCH_COMPONENT } from "../state/touch-state.js";
import { isHMode } from "../command/h-mode.js";
import { activeHInsertionSites, isTrainingCommand } from "../command/training-session.js";
import { hBodyProfileForPrompt, projectHBodyProfile, type HBodyProfile } from "./h-scene-profile.js";

export type L1SceneMode = "ordinary" | "h";

const CHANNELS = ["Ｃ", "Ｖ", "Ａ", "Ｂ", "Ｍ"] as const;
type Channel = (typeof CHANNELS)[number];

/** 回执缺失时用 `"unknown"`；**不要**用空数组或 0 代替。 */
type Unknown = "unknown";

const PART_BY_ID = new Map<number, string>(
  Object.entries(TOUCH_COMPONENT).map(([name, id]) => [id, name]),
);

const PLEASURE_IDS: Record<Channel, number> = {
  "Ｃ": PALAM_ID.快Ｃ,
  "Ｖ": PALAM_ID.快Ｖ,
  "Ａ": PALAM_ID.快Ａ,
  "Ｂ": PALAM_ID.快Ｂ,
  "Ｍ": PALAM_ID.快Ｍ,
};

// ---------------------------------------------------------------------------
// shapes
// ---------------------------------------------------------------------------

export interface HPrimaryAction {
  kind: "COM";
  id: number;
  label: string;
  actor_id: number | null;
  target_id: number | null;
  /** L1 请求的前提就是结算成功（`inspectAiKojoEligibility` 要求 `outcome==="ok"`）。 */
  settlement: "success";
  /** 仅在 Runtime 有明确映射时给出（读持久接触环），不做名称模糊匹配。 */
  body_part?: { actor: string; target: string };
}

export interface HActionState {
  primary_action: HPrimaryAction;
  /** 结算后**仍然存在**的联系，不是最近命令列表。 */
  concurrent_actions: Array<{ kind: "insertion"; site: "v" | "a" }> | Unknown;
  changes_this_turn: {
    session_started: boolean;
    session_ended: boolean;
    insertion_opened: Array<"v" | "a">;
    insertion_closed: Array<"v" | "a">;
  } | Unknown;
}

export interface HEventPhase {
  progress: "started" | "continuing" | "ended" | Unknown;
  /** 主体身份直接来自回执的 `subject`，绝不把主角事件写成目标角色事件。 */
  events_this_turn: Array<{
    subject: number;
    kind: "orgasm" | "unaware-orgasm" | "ejaculation";
    channel?: string;
    amount: number;
    /** 同一主体本回合命中的通道数 − 1，与 `orgasm-settlement` 同一算式。 */
    multiple_ec?: number;
    site?: string;
    marker_labels?: string[];
  }> | Unknown;
  /** 已经发生、且此刻仍然相关的状态——**不是**本轮事件。 */
  aftermath: {
    afterglow?: { level: number; label: string };
    semen_remaining?: { vaginal: number; anal: number; uterine: number };
    edging_pending?: Record<string, number>;
    marks_this_turn?: string[];
  };
  first_occurrence: HFirstOccurrence[];
  evidence_status: "receipt" | "unavailable";
}

export interface HFirstOccurrence {
  /** 范围必须显式：生涯首次 / 与该主角首次 / 本场景首次 是不同的断言。 */
  scope:
    | "lifetime_vaginal"
    | "lifetime_anal"
    | "with_player_vaginal"
    | "with_player_anal"
    | "scene_first_this_act";
  value: "yes" | "no" | "unknown";
  evidence: string;
}

export interface HPhysicalSubject {
  subject_id: number;
  fatigue: "low" | "moderate" | "high" | Unknown;
  /** 本轮 BASE 净变化（负 = 消耗）。 */
  this_turn: { stamina: number; will: number } | Unknown;
  afterglow?: { level: number; label: string };
  /** 明确可读的不适分档。无正面读数 ⇒ unknown，**不是 none**。 */
  discomfort: "none" | "low" | "some" | "high" | Unknown;
  /** 唤起：五通道当前梯级（0 的通道省略）。 */
  arousal?: Record<string, number>;
  lubrication?: number;
}

export interface HMentalState {
  current_facts: {
    initiator: "player" | "character" | Unknown;
    desire?: number;
    unconscious: boolean;
  };
  /** 语气倾向**引用** character_card，不在这里复制一套。 */
  expression_tendencies: "see character_card";
  /** 关系与情绪**引用**现有权威投影，避免两套互相冲突的关系事实。 */
  relationship_reference: "runtime.relationship";
  emotion_reference: "runtime.scene.emotion";
}

export interface HInteractionMemory {
  previous_successful_action?: { command_no: number; tick: number };
  previous_attempted_action?: { command_no: number; tick: number; outcome: string };
  /** 场景长度用 Runtime 时间，**不用请求耗时**。 */
  session_elapsed_minutes: number | Unknown;
  elapsed_this_turn: number;
  position?: { command_no: number; label: string; pose_id?: number; pose_label?: string };
  insertion: Array<"v" | "a"> | Unknown;
}

export interface HSceneContext {
  current_body_state?: HCurrentBodyState;
  scene_mode: "h";
  action_state: HActionState;
  event_phase: HEventPhase;
  physical_state: HPhysicalSubject[];
  body_profile?: unknown;
  mental_state: HMentalState;
  interaction_memory: HInteractionMemory;
  /** 已被本投影消费、应从 `semantic_state` 剔除的字段 id。
   *  **只列真正给出了档位的字段**——某轴 unknown 时保留原始值，否则模型既拿不到
   *  原始值也拿不到档位，是净信息损失。 */
  consumedFieldIds: string[];
  /** 来源与版本。**不发模型**。 */
  diagnostics: { profileVersion: number; receiptTick: number | null; conflicts: string[] };
}

export interface HSceneContextInput {
  commandNo: number;
  /** 命令结算前的状态，用于「本轮变化」与场景识别的对比。 */
  beforeState?: Readonly<GameState>;
  receipt?: HSettlementReceipt | null;
  /** runtime 没有命令名来源（名字来自 web 侧 commands bundle），由调用方注入。 */
  labelFor: (commandNo: number) => string;
}

// ---------------------------------------------------------------------------
// scene mode
// ---------------------------------------------------------------------------

/**
 * 本请求是否属于 H 场景。自上而下，首个命中胜出。
 *
 * 退出轮（850/999/127）结算后 `state.training` 已是 null，所以场景身份只能靠回执
 * 找回——`commandNo` 也参与匹配：时停不推进 tick，多条命令可能共享同一 tick，而
 * AI 请求总是紧跟写下回执的那条命令。
 */
export function l1SceneMode(
  state: Readonly<GameState>,
  target: number,
  commandNo: number,
  receipt?: HSettlementReceipt | null,
): L1SceneMode {
  if (target <= 0) return "ordinary";
  const session = state.training;
  if (session && session.target !== target) return "ordinary";
  if (session?.target === target) return "h";
  if (isHMode(state, target)) return "h";
  if (receiptFor(receipt, state, commandNo, target)) {
    if (isTrainingCommand(commandNo)) return "h";
    if (receipt?.session?.exited) return "h";
  }
  return "ordinary";
}

// ---------------------------------------------------------------------------
// builders
// ---------------------------------------------------------------------------

/** A receipt describes *this* command; anything else (or a stale tick) is not
 *  evidence about this turn and must degrade to unknown rather than be reused. */
function receiptFor(
  receipt: HSettlementReceipt | null | undefined,
  state: Readonly<GameState>,
  commandNo: number,
  target: number,
): HSettlementReceipt | undefined {
  if (!receipt || receipt.commandNo !== commandNo) return undefined;
  return receipt.tick === state.time.tickValue && receipt.day === state.time.dayIndex &&
    receipt.session?.target === target ? receipt : undefined;
}

function knownInsertionSites(state: Readonly<GameState>, target: number): Array<"v" | "a"> | Unknown {
  const slot = state.charas[target];
  if (!slot || slot.location !== state.master.location ||
    (["v", "a"] as const).some((site) => readHInsertionRelation(state, target, site).status === "unknown")) return "unknown";
  return activeHInsertionSites(state, target);
}

function sessionFor(
  state: Readonly<GameState>,
  target: number,
  beforeState?: Readonly<GameState>,
): Readonly<GameState>["training"] | undefined {
  if (state.training?.target === target) return state.training;
  if (beforeState?.training?.target === target) return beforeState.training;
  return undefined;
}

function buildActionState(
  state: Readonly<GameState>,
  target: number,
  input: HSceneContextInput,
  receipt: HSettlementReceipt | undefined,
): HActionState {
  const session = sessionFor(state, target, input.beforeState);

  const primary: HPrimaryAction = {
    kind: "COM",
    id: input.commandNo,
    label: input.labelFor(input.commandNo),
    actor_id: receipt?.actor ?? null,
    target_id: receipt?.session?.target ?? session?.target ?? null,
    settlement: "success",
  };

  const bodyPart = currentContact(state, target, primary.actor_id);
  if (bodyPart) primary.body_part = bodyPart;

  const sites = knownInsertionSites(state, target);
  const concurrent: HActionState["concurrent_actions"] = session && sites !== "unknown"
    ? sites.map((site) => ({ kind: "insertion" as const, site }))
    : "unknown";

  const changes: HActionState["changes_this_turn"] = receipt
    ? {
        session_started: receipt.session?.started ?? false,
        session_ended: receipt.session?.exited ?? false,
        insertion_opened: (["v", "a"] as const).filter((s) => !receipt.insertionBefore[s] && receipt.insertion[s]),
        insertion_closed: (["v", "a"] as const).filter((s) => receipt.insertionBefore[s] && !receipt.insertion[s]),
      }
    : "unknown";

  return { primary_action: primary, concurrent_actions: concurrent, changes_this_turn: changes };
}

function slotOf(state: Readonly<GameState>, charaNum: number): CharaSlot | undefined {
  return charaNum === 0 ? state.master : state.charas[charaNum];
}

/**
 * The current contact pair, read from the persisted ring.
 *
 * `setCurrentTouchRelation` records a forward position on the **target's** ring
 * (`component = targetPart`, `part = actorPart`) and a reverse one on the
 * actor's, so both stores have to be consulted — reading only one silently
 * loses half the positions. Anything ambiguous is reported as absent rather
 * than guessed from a name.
 */
function currentContact(
  state: Readonly<GameState>,
  target: number,
  actorId: number | null,
): { actor: string; target: string } | undefined {
  const pairs: Array<[CharaSlot | undefined, "target-ring" | "actor-ring"]> = [
    [state.charas[target], "target-ring"],
    [actorId === null ? undefined : slotOf(state, actorId), "actor-ring"],
  ];
  for (const [slot, ring] of pairs) {
    if (!slot) continue;
    const touch = listTouches(slot).find(
      (entry) => entry.depth === 0 && entry.component !== TOUCH_COMPONENT.体位,
    );
    if (!touch) continue;
    // target-ring stores {component: targetPart, part: actorPart}; the actor's
    // own ring stores the reverse order.
    const [actorName, targetName] = ring === "target-ring"
      ? [PART_BY_ID.get(touch.part), PART_BY_ID.get(touch.component)]
      : [PART_BY_ID.get(touch.component), PART_BY_ID.get(touch.part)];
    if (actorName && targetName) return { actor: actorName, target: targetName };
  }
  return undefined;
}

function buildEventPhase(
  state: Readonly<GameState>,
  target: number,
  input: HSceneContextInput,
  receipt: HSettlementReceipt | undefined,
): HEventPhase {
  const slot = state.charas[target];
  // `getHBodyStats` reads a namespace-free CharaSlotState, not a CharaSlot.
  const stats = getHBodyStats((slot ?? state.master).state);
  const scalar = slot?.state.BASE[BASE_ID.絶頂余韻] ?? 0;

  const aftermath: HEventPhase["aftermath"] = {};
  const label = afterglowStageLabel(scalar);
  if (label) aftermath.afterglow = { level: afterglowLevel(scalar), label };
  aftermath.semen_remaining = {
    vaginal: stats.vaginalSemen,
    anal: stats.analSemen,
    uterine: stats.uterineSemen,
  };
  const pending = Object.fromEntries(Object.entries(stats.chiburi).filter(([, count]) => count > 0));
  if (Object.keys(pending).length > 0) aftermath.edging_pending = pending;
  if (receipt && receipt.marks.length > 0) aftermath.marks_this_turn = [...receipt.marks];

  const firstOccurrence = firstOccurrences(state, target, input);

  if (!receipt) {
    // No receipt ⇒ we cannot say what happened this turn. Never fall back to [].
    return {
      progress: "unknown",
      events_this_turn: "unknown",
      aftermath,
      first_occurrence: firstOccurrence,
      evidence_status: "unavailable",
    };
  }

  const hitChannels = new Map<number, Set<string>>();
  for (const event of receipt.events) {
    if (event.kind !== "orgasm" || !event.channel) continue;
    const set = hitChannels.get(event.subject) ?? new Set<string>();
    set.add(event.channel);
    hitChannels.set(event.subject, set);
  }

  return {
    progress: receipt.session?.exited ? "ended" : receipt.session?.started ? "started" : "continuing",
    events_this_turn: receipt.events.map((event) => ({
      subject: event.subject,
      kind: event.kind,
      ...(event.channel ? { channel: event.channel } : {}),
      amount: event.amount,
      ...(event.kind === "orgasm"
        ? { multiple_ec: Math.max(0, (hitChannels.get(event.subject)?.size ?? 1) - 1) }
        : {}),
      ...(event.site ? { site: event.site.label } : {}),
      ...(event.markerLabels?.length ? { marker_labels: [...event.markerLabels] } : {}),
    })),
    aftermath,
    first_occurrence: firstOccurrence,
    evidence_status: "receipt",
  };
}

/**
 * 每项都要说明范围。缺字段 ⇒ unknown，不把一个缺失读成「从未发生」。
 * `KojoMemory.firstTime` 是作者口上路由记忆、**不是行为史**，故不参与。
 */
function firstOccurrences(
  state: Readonly<GameState>,
  target: number,
  input: HSceneContextInput,
): HFirstOccurrence[] {
  const slot = state.charas[target];
  if (!slot) return [];
  const master = state.master.charaNum;
  const cflag = (id: number) => slot.state.CFLAG[id] ?? 0;

  const virgin = slot.state.TALENT[TALENT_ID.処女] ?? 0;
  const vAnniversary = cflag(CFLAG_ID.処女喪失記念日);
  const analBroken = (slot.state.TCVAR[TCVAR_ID.Ａ破瓜] ?? 0) !== 0;
  const aAnniversary = cflag(CFLAG_ID.尻穴処女喪失記念日);
  const vPartner = cflag(CFLAG_ID.処女喪失相手);
  const aPartner = cflag(CFLAG_ID.アナル処女喪失相手);

  const out: HFirstOccurrence[] = [
    {
      scope: "lifetime_vaginal",
      // -1 = 已失去但无记录：不是首次，但也没有可引用的日期。
      value: virgin === 1 || virgin === 2 ? "yes" : virgin === 0 && vAnniversary > 0 ? "no" : "unknown",
      evidence: `TALENT.処女=${virgin}（1/2=仍是处女，-1=已失去但无记录）`,
    },
    {
      scope: "lifetime_anal",
      value: !analBroken && aAnniversary === 0 ? "yes" : "no",
      evidence: `TCVAR.Ａ破瓜=${analBroken ? 1 : 0} / CFLAG.尻穴処女喪失記念日=${aAnniversary}`,
    },
    {
      scope: "with_player_vaginal",
      value: vPartner === master ? "yes" : vPartner !== 0 ? "no" : "unknown",
      evidence: `CFLAG.処女喪失相手=${vPartner}（主角=${master}）`,
    },
    {
      scope: "with_player_anal",
      value: aPartner === master ? "yes" : aPartner !== 0 ? "no" : "unknown",
      evidence: `CFLAG.アナル処女喪失相手=${aPartner}（主角=${master}）`,
    },
  ];

  // 场景内的「本类动作首次」：窗口就是环形 16 条，这一点写进 evidence——
  // 它回答的不是「生涯首次」。
  const ring = sessionFor(state, target, input.beforeState)?.recentCommands;
  if (ring) {
    const prior = ring.filter((record) => record.commandNo !== input.commandNo);
    out.push({
      scope: "scene_first_this_act",
      value: prior.some((record) => record.commandNo === input.commandNo) ? "no" : "yes",
      evidence: `training.recentCommands（最近 ${ring.length} 条）中无 COM${input.commandNo}`,
    });
  } else {
    out.push({ scope: "scene_first_this_act", value: "unknown", evidence: "无训练会话记录" });
  }
  return out;
}

function fatigueLevel(stamina: number | undefined, will: number | undefined): HPhysicalSubject["fatigue"] {
  const values = [stamina, will].filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (values.length === 0) return "unknown";
  const worst = Math.min(...values);
  if (worst <= 0) return "high";
  if (worst <= 300) return "moderate";
  return "low";
}

function palamTier(value: number | undefined): "none" | "low" | "some" | "high" | Unknown {
  if (typeof value !== "number" || !Number.isFinite(value)) return "unknown";
  const level = getPalamLv(value, 10);
  return level >= 6 ? "high" : level >= 3 ? "some" : level >= 1 ? "low" : "none";
}

function buildPhysicalState(
  state: Readonly<GameState>,
  target: number,
  receipt: HSettlementReceipt | undefined,
): HPhysicalSubject[] {
  const ids = target === state.master.charaNum ? [state.master.charaNum] : [state.master.charaNum, target];
  return ids.flatMap((id): HPhysicalSubject[] => {
    const slot = slotOf(state, id);
    if (!slot) return [];
    const scalar = slot.state.BASE[BASE_ID.絶頂余韻] ?? 0;
    const label = afterglowStageLabel(scalar);

    const arousal: Record<string, number> = {};
    for (const channel of CHANNELS) {
      const level = getPalamLv(slot.state.PALAM[PLEASURE_IDS[channel]] ?? 0, 10);
      if (level > 0) arousal[channel] = level;
    }

    const pain = palamTier(slot.state.PALAM[PALAM_ID.苦痛]);
    const displeasure = palamTier(slot.state.PALAM[PALAM_ID.不快]);
    const discomfort =
      pain === "unknown" && displeasure === "unknown"
        ? "unknown"
        : (["high", "some", "low"] as const).find((tier) => pain === tier || displeasure === tier) ?? "none";

    const lubrication = slot.state.PALAM[PALAM_ID.潤滑];
    const vitality = receipt?.vitality.find((entry) => entry.subject === id);

    return [{
      subject_id: id,
      fatigue: fatigueLevel(slot.state.BASE[BASE_ID.体力], slot.state.BASE[BASE_ID.気力]),
      this_turn: vitality ? { stamina: vitality.stamina, will: vitality.will } : "unknown",
      ...(label ? { afterglow: { level: afterglowLevel(scalar), label } } : {}),
      discomfort,
      ...(Object.keys(arousal).length > 0 ? { arousal } : {}),
      ...(typeof lubrication === "number" ? { lubrication: getPalamLv(lubrication, 10) } : {}),
    }];
  });
}

function buildMentalState(
  state: Readonly<GameState>,
  target: number,
  receipt: HSettlementReceipt | undefined,
): HMentalState {
  const slot = state.charas[target];
  const asleep = (slot?.state.CFLAG[CFLAG_ID.睡眠] ?? 0) !== 0;
  const desire = slot?.state.PALAM[PALAM_ID.欲情];
  // 关系与情绪一律引用现有权威投影，这里只补「本轮由谁发起」这类事实。
  return {
    current_facts: {
      initiator: receipt
        ? receipt.actor === state.master.charaNum || receipt.actor === 0
          ? "player"
          : "character"
        : "unknown",
      ...(typeof desire === "number" ? { desire: getPalamLv(desire, 10) } : {}),
      unconscious: asleep,
    },
    expression_tendencies: "see character_card",
    relationship_reference: "runtime.relationship",
    emotion_reference: "runtime.scene.emotion",
  };
}

function buildInteractionMemory(
  state: Readonly<GameState>,
  target: number,
  input: HSceneContextInput,
): HInteractionMemory {
  const session = sessionFor(state, target, input.beforeState);
  const ring = session?.recentCommands ?? [];
  // 「上一条尝试」与「上一条成功行为」分开：失败和 noop 也是发生过的事。
  const prior = ring.filter((record) => record.commandNo !== input.commandNo);
  const lastSuccess = [...prior].reverse().find((record) => record.outcome === "ok");
  const lastAttempt = prior.at(-1);

  let elapsed: number | Unknown = "unknown";
  if (session) {
    const delta = state.time.tickValue - session.startedAtTick;
    const dayDelta = state.time.dayIndex - session.startedDay;
    // tick/day 必须自洽：跨天差值不能直接当成分钟数，不自洽就报 unknown。
    const sameDay = dayDelta === 0 || delta >= dayDelta * 1440;
    if (delta >= 0 && dayDelta >= 0 && sameDay) elapsed = delta;
  }

  const position = positionOf(state, target, session?.currentPositionCommandNo, input);
  return {
    ...(lastSuccess
      ? { previous_successful_action: { command_no: lastSuccess.commandNo, tick: lastSuccess.tick } }
      : {}),
    ...(lastAttempt
      ? {
          previous_attempted_action: {
            command_no: lastAttempt.commandNo,
            tick: lastAttempt.tick,
            outcome: lastAttempt.outcome,
          },
        }
      : {}),
    session_elapsed_minutes: elapsed,
    elapsed_this_turn: input.beforeState
      ? Math.max(0, state.time.tickValue - input.beforeState.time.tickValue)
      : 0,
    ...(position ? { position } : {}),
    insertion: session ? knownInsertionSites(state, target) : "unknown",
  };
}

/** `currentPositionCommandNo` 是权威（能区分 60 正常位 / 62 正常位肛门）；
 *  `TEQUIP:体位` 只是数字，用派生表兜底。317/318「腰を動かす」不改变体位。 */
function positionOf(
  state: Readonly<GameState>,
  target: number,
  positionCommandNo: number | undefined,
  input: HSceneContextInput,
): HInteractionMemory["position"] {
  const pose = readCurrentTouchPose(state.charas[target] ?? state.master);
  const poseLabel = pose > 0 ? hPoseLabel(pose) : undefined;
  if (positionCommandNo !== undefined) {
    return {
      command_no: positionCommandNo,
      label: input.labelFor(positionCommandNo),
      ...(pose > 0 ? { pose_id: pose } : {}),
      ...(poseLabel ? { pose_label: poseLabel } : {}),
    };
  }
  if (poseLabel) return { command_no: 0, label: poseLabel, pose_id: pose, pose_label: poseLabel };
  return undefined;
}

/** 只把**真正给出了档位**的字段从 `semantic_state` 摘掉：unknown 的轴保留原始值。 */
function consumedFields(profile: HBodyProfile | undefined): string[] {
  if (!profile) return [];
  const out: string[] = [];
  for (const [channel, tier] of Object.entries(profile.experience)) {
    if (!tier || tier.level === "unknown") continue;
    out.push(channel === "unconscious" ? "EXP.無自覚絶頂経験" : `EXP.${channel}経験`);
  }
  for (const [channel, tier] of Object.entries(profile.sensitivity)) {
    if (tier && tier.level !== "unknown") out.push(`ABL.${channel}感覚`);
  }
  return out;
}

/**
 * 构造 H 场景投影。调用方应先确认 `l1SceneMode(...) === "h"`。
 */
export function buildHSceneContext(
  state: Readonly<GameState>,
  target: number,
  input: HSceneContextInput,
): HSceneContext {
  const receipt = receiptFor(input.receipt, state, input.commandNo, target);
  const profile = projectHBodyProfile(state, target);
  const body = readHCurrentBodyState(state, target);

  return {
    scene_mode: "h",
    current_body_state: body,
    action_state: buildActionState(state, target, input, receipt),
    event_phase: buildEventPhase(state, target, input, receipt),
    physical_state: buildPhysicalState(state, target, receipt),
    ...(profile ? { body_profile: hBodyProfileForPrompt(profile) } : {}),
    mental_state: buildMentalState(state, target, receipt),
    interaction_memory: buildInteractionMemory(state, target, input),
    consumedFieldIds: consumedFields(profile),
    diagnostics: {
      profileVersion: profile?.version ?? 0,
      receiptTick: receipt?.tick ?? null,
      conflicts: (["v", "a"] as const).filter((site) =>
        body?.insertions[site].status === "unknown"
      ).map((site) => `insertion.${site}: unresolved current relation`),
    },
  };
}
