import type { AiRelationshipLens } from "./relationship-lens.js";
import { KOJO_VOICE_CARDS } from "./character-voice-cards.generated.js";
import { currentAiSettings } from "./store.js";
import { disabledPresetCardFields, presetText, presetList, type PresetCardField } from "./preset-card-fields.js";

type RelationshipGradient = "stranger" | "friendly" | "crush" | "love" | "angry";

interface VoiceGradient {
  readonly attitude: string;
  readonly behaviors: readonly string[];
  readonly boundaries: string;
}

interface KojoVoiceCard {
  readonly variantId: string;
  readonly identity: {
    readonly name: string;
    readonly species: string;
    readonly group: string;
  };
  readonly stableVoice: {
    readonly coreTraits: readonly string[];
    readonly selfImage: string;
    readonly sentenceEndings: readonly string[];
    readonly exclamations: readonly string[];
    readonly tone: string;
    readonly volume: string;
  };
  readonly relationshipGradients: Readonly<Record<RelationshipGradient, VoiceGradient>>;
  readonly habits: {
    readonly interaction: readonly string[];
  };
  readonly tabooTopics: {
    readonly neverSay: readonly string[];
  };
  readonly guidance: {
    readonly emphasize: readonly string[];
    readonly avoid: readonly string[];
    readonly referenceLines: readonly string[];
  };
}

const CARDS = KOJO_VOICE_CARDS as Readonly<Record<string, Readonly<Record<string, KojoVoiceCard>>>>;

export interface CharacterVoiceSlice {
  readonly lines: readonly string[];
  readonly referenceLines: readonly string[];
}

function compact(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function renderBriefText(text: string, masterName: string, targetName: string): string {
  return compact(text)
    .replaceAll("%CALLNAME:MASTER%", masterName)
    .replaceAll("CALLNAME:MASTER%", masterName)
    .replaceAll("%CALLNAME:TARGET%", targetName)
    .replace(/%[A-Z][^%\r\n]*%/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Raw card access for the structured character-card builder
 * (`character-card.ts`). Callers must render brief text via renderBriefText. */
export function getKojoVoiceCard(
  target: number,
  selectedVariant: string,
): KojoVoiceCard | null {
  return CARDS[String(target)]?.[selectedVariant] ?? null;
}

/** The relationship-gradient key the card exposes for a live lens. Mirrors the
 * selection compileKojoVoiceSlice applies when flattening the card to prose. */
export function relationshipGradientKey(
  lens: AiRelationshipLens,
): RelationshipGradient {
  return gradientFor(lens);
}

function gradientFor(lens: AiRelationshipLens): RelationshipGradient {
  if (lens.stage === "affection") return "crush";
  if (lens.stage === "love" || lens.stage === "lover") return "love";
  return lens.openness === "guarded" ? "stranger" : "friendly";
}

function renderList(
  values: readonly string[],
  masterName: string,
  targetName: string,
  limit: number,
): string[] {
  return values
    .map((value) => renderBriefText(value, masterName, targetName))
    .filter(Boolean)
    .slice(0, limit);
}

export function compileKojoVoiceSlice(input: {
  target: number;
  selectedVariant: string;
  variantLabel?: string;
  relationship: AiRelationshipLens | null;
  includeRelationshipGradient?: boolean;
  masterName: string;
  targetName: string;
}): CharacterVoiceSlice | null {
  const raw = CARDS[String(input.target)]?.[input.selectedVariant];
  if (!raw) return null;
  const disabled = disabledPresetCardFields(currentAiSettings().presetCardDisabledFields, input.target);
  const text = (key: PresetCardField, value: string) => presetText(disabled, key, value);
  const list = (key: PresetCardField, value: readonly string[]) => presetList(disabled, key, value);
  const card: KojoVoiceCard = {
    ...raw,
    identity: { ...raw.identity, species: text("identity.species", raw.identity.species), group: text("identity.group", raw.identity.group) },
    stableVoice: {
      coreTraits: list("core_traits", raw.stableVoice.coreTraits), selfImage: text("self_image", raw.stableVoice.selfImage),
      tone: text("voice.tone", raw.stableVoice.tone), volume: text("voice.volume", raw.stableVoice.volume),
      sentenceEndings: list("voice.sentence_endings", raw.stableVoice.sentenceEndings), exclamations: list("voice.exclamations", raw.stableVoice.exclamations),
    },
    habits: { interaction: list("interaction_habits", raw.habits.interaction) },
    tabooTopics: { neverSay: list("never_say", raw.tabooTopics.neverSay) },
    guidance: { emphasize: list("emphasize", raw.guidance.emphasize), avoid: list("avoid", raw.guidance.avoid), referenceLines: list("reference_lines", raw.guidance.referenceLines) },
    relationshipGradients: Object.fromEntries(Object.entries(raw.relationshipGradients).map(([key, value]) => [key, {
      attitude: text(`relationship_gradients.${key}.attitude` as PresetCardField, value.attitude),
      boundaries: text(`relationship_gradients.${key}.boundaries` as PresetCardField, value.boundaries),
      behaviors: list(`relationship_gradients.${key}.behaviors` as PresetCardField, value.behaviors),
    }])) as unknown as KojoVoiceCard["relationshipGradients"],
  };
  const render = (value: string): string => renderBriefText(value, input.masterName, input.targetName);
  const relationshipKey = input.relationship ? gradientFor(input.relationship) : "friendly";
  const baseGradient = card.relationshipGradients[relationshipKey];
  const angryGradient = input.relationship?.tension === "angry"
    ? card.relationshipGradients.angry
    : null;
  const relationshipLines = input.includeRelationshipGradient === false ? [] : [
    `本角色在当前关系阶段的表达：${render(baseGradient.attitude)}`,
    `当前关系下的行为边界：${render(baseGradient.boundaries)}`,
    ...renderList(baseGradient.behaviors, input.masterName, input.targetName, 2)
      .map((value) => `可参考的表现方式：${value}`),
    ...(angryGradient
      ? [
          `当前愤怒时的角色化表达：${render(angryGradient.attitude)}`,
          `愤怒只改变本段语气和距离：${render(angryGradient.boundaries)}`,
        ]
      : []),
  ].filter((line) => !line.endsWith("："));
  return {
    lines: [
      `口上变体画像：以下内容描述${input.variantLabel ? `「${input.variantLabel}」` : "当前"}变体的稳定声音和倾向，不是当前状态或必须逐条表现的清单。`,
      `变体编号：${card.variantId}`,
      `身份：${[card.identity.name, card.identity.species, card.identity.group].filter(Boolean).join("；")}`,
      `核心人格：${renderList(card.stableVoice.coreTraits, input.masterName, input.targetName, 4).join("；")}`,
      `自我认知：${render(card.stableVoice.selfImage)}`,
      `说话方式：${render(card.stableVoice.tone)}`,
      `音量与节奏：${render(card.stableVoice.volume)}`,
      disabled.includes("voice.sentence_endings") ? "" : `常用句尾：${renderList(card.stableVoice.sentenceEndings, input.masterName, input.targetName, 8).join("、") || "无固定句尾"}`,
      disabled.includes("voice.exclamations") ? "" : `常用感叹：${renderList(card.stableVoice.exclamations, input.masterName, input.targetName, 6).join("、") || "无固定感叹"}`,
      ...relationshipLines,
      ...renderList(card.habits.interaction, input.masterName, input.targetName, 2)
        .map((value) => `互动习惯：${value}`),
      ...renderList(card.guidance.emphasize, input.masterName, input.targetName, 3)
        .map((value) => `应保留：${value}`),
      ...renderList(card.guidance.avoid, input.masterName, input.targetName, 3)
        .map((value) => `避免写成：${value}`),
      ...renderList(card.tabooTopics.neverSay, input.masterName, input.targetName, 2)
        .map((value) => `认知或设定边界：${value}`),
    ].filter((line) => Boolean(line) && !line.endsWith("：")),
    referenceLines: renderList(
      card.guidance.referenceLines,
      input.masterName,
      input.targetName,
      3,
    ),
  };
}

/** Backward-compatible name for callers that only know the old default-card API. */
export const compileDefaultKojoVoiceSlice = compileKojoVoiceSlice;
