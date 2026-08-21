import type { GameState } from "../../../modernization/runtime/state/index.js";
import { deriveRelationshipAuthority } from "../../../modernization/runtime/state/attitude.js";
import { getRebellionBrand } from "../../../modernization/runtime/state/named-stats.js";
import {
  deriveDialogueRelationshipStage,
  type DialogueRelationshipStage,
} from "../../../modernization/runtime/state/dialogue-context.js";

type Warmth = "uninvested" | "positive" | "warm" | "important";
type Openness = "guarded" | "reserved" | "trusting" | "open";
type Ease = "formal" | "familiar" | "close" | "very-close";
type Tension = "none" | "displeased" | "angry" | "wary" | "rejecting" | "repulsed";
type AversionTier = 0 | 1 | 2 | 3;

export interface AiRelationshipLens {
  readonly stage: DialogueRelationshipStage;
  readonly warmth: Warmth;
  readonly openness: Openness;
  readonly ease: Ease;
  readonly tension: Tension;
  readonly aversionTier: AversionTier;
  readonly lines: readonly string[];
}

const FAVOR_MAX = 1500;
const TRUST_MAX = 250;

function normalized(value: number, max: number): number {
  return Math.max(0, Math.min(1, value / max));
}

function warmthOf(favor: number): Warmth {
  const ratio = normalized(favor, FAVOR_MAX);
  if (ratio < 0.15) return "uninvested";
  if (ratio < 0.45) return "positive";
  if (ratio < 0.75) return "warm";
  return "important";
}

function opennessOf(trust: number): Openness {
  const ratio = normalized(trust, TRUST_MAX);
  if (ratio < 0.2) return "guarded";
  if (ratio < 0.5) return "reserved";
  if (ratio < 0.8) return "trusting";
  return "open";
}

function easeOf(intimacy: number): Ease {
  if (intimacy <= 1) return "formal";
  if (intimacy <= 4) return "familiar";
  if (intimacy <= 7) return "close";
  return "very-close";
}

function tensionOf(angry: boolean, displeasure: number, aversionTier: AversionTier): Tension {
  if (aversionTier >= 3) return "repulsed";
  if (aversionTier >= 2) return "rejecting";
  if (aversionTier >= 1) return "wary";
  if (angry) return "angry";
  if (displeasure > 0) return "displeased";
  return "none";
}

const STAGE_LINES: Record<DialogueRelationshipStage, readonly [string, string]> = {
  ordinary: [
    "确定关系阶段：普通关系；即使相处温暖，也只按非恋爱关系理解。",
    "关系上限：可以正常交流、轻微玩笑或关照；不得自行添加暧昧、占有欲、恋爱式害羞、告白或情侣式亲密。",
  ],
  affection: [
    "确定关系阶段：思慕；她可能比对普通人更留意主角，但双方尚未确立恋爱关系。",
    "关系上限：允许轻微偏袒、在意评价或用自己的方式关心；不要求脸红、吃醋或显性示爱，也不得写成稳定情侣。",
  ],
  love: [
    "确定关系阶段：恋慕；浪漫感情可以成为潜台词，但表达程度仍受信任和人物性格约束。",
    "关系上限：允许克制的暧昧、主动靠近或偶尔暴露脆弱面；不得默认双方已经确认关系，也不要每段都强调恋爱。",
  ],
  lover: [
    "确定关系阶段：恋人；双方已经确立关系，可以使用熟悉的默契和情侣式关心。",
    "关系上限：允许自然亲近和省略客套；仍须保留人物自己的生活重心，不要把每次日常交流写成甜腻示爱。",
  ],
};

const WARMTH_LINES: Record<Warmth, string> = {
  uninvested: "情感温度：尚未形成明显偏爱；按她通常的社交方式回应，不必额外冷淡，也不必刻意热情。",
  positive: "情感温度：对主角有一定好感；比对普通熟人稍愿意回应或关照，但不需要主动讨好。",
  warm: "情感温度：对主角明显温暖；愿意认真回应，也可以自然延续她感兴趣的话题。",
  important: "情感温度：主角对她很重要；可以表现优先关注和真切关心，但浪漫程度仍由确定关系阶段限定。",
};

const OPENNESS_LINES: Record<Openness, string> = {
  guarded: "信任开放度：仍有戒心；不主动示弱、倾诉秘密或交出决定权，但这不等于刻薄、拒绝交流或爱答不理。",
  reserved: "信任开放度：正在建立信任；可以自然交流，涉及私人感受时仍会保留或用人物自己的方式掩饰。",
  trusting: "信任开放度：愿意相信主角的善意；可以减少试探，偶尔坦率表达真实想法。",
  open: "信任开放度：高度信任；可以自然暴露真实情绪和脆弱面，但不要求本次互动必须这样做。",
};

const EASE_LINES: Record<Ease, string> = {
  formal: "相处松弛度：尚未完全熟稔；保留基本个人边界，客套程度由人物平常习惯决定。",
  familiar: "相处松弛度：已有熟悉感；可以减少部分客套、使用轻微玩笑或容许短暂停顿。",
  close: "相处松弛度：相处较自然；可以使用熟人间的默契和省略，但不越过关系阶段。",
  "very-close": "相处松弛度：非常自然；允许高度默契和舒适沉默，但亲近不自动代表同意任何身体接触。",
};

const TENSION_LINES: Record<Tension, string> = {
  none: "当前摩擦：没有明确不满或愤怒；无需为了表现关系而制造情绪冲突。",
  displeased: "当前摩擦：她对主角有尚未消散的不快；允许语气更短、更有保留，但不抹除既有关系，也不强制争吵。",
  angry: "当前摩擦：她正处于明确愤怒中；允许带刺、拒绝延伸或保持距离，但愤怒不把既有关系重置成陌生人。",
  wary: "当前摩擦：她带有一级反感刻印，对主角存在持续戒备和抵触；不要用好感或熟悉感把这种抵触写成普通亲近。",
  rejecting: "当前摩擦：她带有二级反感刻印，对主角有明确的疏远和拒绝倾向；允许冷淡、缩短回应或拒绝继续互动。",
  repulsed: "当前摩擦：她带有三级反感刻印，对主角有强烈且持续的反感；应优先表现厌恶、警惕、回避或拒绝，不得按温暖、信任或亲密关系描写。",
};

export function buildAiRelationshipLens(
  state: Readonly<GameState>,
  target: number,
): AiRelationshipLens | null {
  const slot = state.charas[target];
  if (!slot) return null;
  const relation = deriveRelationshipAuthority(slot, state.master, state);
  const stage = deriveDialogueRelationshipStage(slot);
  const aversionTier = getRebellionBrand(slot.state).tier as AversionTier;
  // 反感刻印 is persistent and mechanically penalises favor/trust upstream.
  // It must therefore dominate the prose lens instead of letting high legacy
  // favor/trust values produce a contradictory warm prompt.
  const warmth = aversionTier > 0 ? "uninvested" : warmthOf(relation.favor);
  const openness = aversionTier > 0 ? "guarded" : opennessOf(relation.trust);
  const ease = aversionTier > 0 ? "formal" : easeOf(relation.intimacy);
  const tension = tensionOf(relation.angry, relation.displeasure, aversionTier);
  return {
    stage,
    warmth,
    openness,
    ease,
    tension,
    aversionTier,
    lines: [
      STAGE_LINES[stage][0],
      WARMTH_LINES[warmth],
      OPENNESS_LINES[openness],
      EASE_LINES[ease],
      TENSION_LINES[tension],
      STAGE_LINES[stage][1],
      "解释原则：这些描述只限定她相对自身日常基线对主角开放到什么程度，不要求本段刻意证明关系；人物设定决定具体说法和动作。",
    ],
  };
}

const STAGE_NAMES: Record<DialogueRelationshipStage, string> = {
  ordinary: "普通关系",
  affection: "思慕",
  love: "恋慕",
  lover: "恋人",
};

const WARMTH_NAMES: Record<Warmth, string> = {
  uninvested: "无明显偏爱",
  positive: "有一定好感",
  warm: "明显温暖",
  important: "非常重视",
};

const OPENNESS_NAMES: Record<Openness, string> = {
  guarded: "仍有戒心",
  reserved: "逐步信任",
  trusting: "愿意信任",
  open: "高度信任",
};

const EASE_NAMES: Record<Ease, string> = {
  formal: "尚未熟稔",
  familiar: "已有熟悉感",
  close: "相处自然",
  "very-close": "高度默契",
};

const TENSION_NAMES: Record<Tension, string> = {
  none: "无明显摩擦",
  displeased: "仍有不快",
  angry: "明确愤怒",
  wary: "一级持续反感",
  rejecting: "二级明确排斥",
  repulsed: "三级强烈反感",
};

export function describeAiRelationshipChange(
  before: Readonly<GameState>,
  after: Readonly<GameState>,
  target: number,
): string {
  const left = buildAiRelationshipLens(before, target);
  const right = buildAiRelationshipLens(after, target);
  if (!left || !right) return "没有可比较的关系镜头";
  const changes: string[] = [];
  if (left.stage !== right.stage) {
    changes.push(`关系阶段由${STAGE_NAMES[left.stage]}变为${STAGE_NAMES[right.stage]}`);
  }
  if (left.warmth !== right.warmth) {
    changes.push(`情感温度由${WARMTH_NAMES[left.warmth]}变为${WARMTH_NAMES[right.warmth]}`);
  }
  if (left.openness !== right.openness) {
    changes.push(`信任开放度由${OPENNESS_NAMES[left.openness]}变为${OPENNESS_NAMES[right.openness]}`);
  }
  if (left.ease !== right.ease) {
    changes.push(`相处松弛度由${EASE_NAMES[left.ease]}变为${EASE_NAMES[right.ease]}`);
  }
  if (left.tension !== right.tension) {
    changes.push(`当前摩擦由${TENSION_NAMES[left.tension]}变为${TENSION_NAMES[right.tension]}`);
  }
  return changes.join("；") || "没有跨越关系语义档位，不需要专门表现数值变化";
}
