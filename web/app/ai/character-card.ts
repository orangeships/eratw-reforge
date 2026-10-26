import type { GameState } from "../../../modernization/runtime/state/index.js";
import { buildTalentCategories } from "../../../modernization/runtime/state/talent-categories.js";
import { mobGirlProfileForCharacter } from "../../../modernization/runtime/world/dynamic-characters.js";
import charasBundle from "../game/charas.bundle.json";
import kojoCatalogBundle from "../game/kojo.catalog.bundle.json";
import {
  getKojoVoiceCard,
  renderBriefText,
} from "./character-voice.js";
import { fallbackMobGirlBasePersona, mobGirlPersonaKey } from "./mob-girl-profile.js";
import { currentAiCharacterProfile, currentAiSettings } from "./store.js";
import { disabledPresetCardFields, presetList, presetText, presetLore, type PresetCardField } from "./preset-card-fields.js";

type CharaBundleEntry = {
  id?: number;
  name?: string;
  callName?: string;
  CSTR?: Record<string, string>;
};

const CHARAS = charasBundle as Record<string, CharaBundleEntry>;
const KOJO_CATALOG = kojoCatalogBundle as {
  byChara?: Record<string, {
    defaultVariantId?: string;
    variants?: Record<string, { label?: string; description?: string }>;
  }>;
};

/** Structured, byte-stable character card for the six-part AI prompt
 * (modernization/docs/PROMPT-STRUCTURE-PLAN.md ②). Unlike the prose voice
 * slice, every relationship gradient stays in the card: the runtime context
 * only names the active key, so the card prefix is cacheable per
 * (target, variant, master name, user-editable settings, mental traits). */
export interface AiCharacterCard {
  readonly target: number;
  readonly name: string;
  readonly call_name: string;
  readonly player_name: string;
  readonly identity: {
    readonly species: string;
    readonly group: string;
  };
  readonly intro: readonly string[];
  readonly core_traits: readonly string[];
  readonly self_image: string;
  readonly voice: {
    readonly tone: string;
    readonly volume: string;
    readonly sentence_endings: readonly string[];
    readonly exclamations: readonly string[];
  };
  readonly interaction_habits: readonly string[];
  readonly never_say: readonly string[];
  readonly emphasize: readonly string[];
  readonly avoid: readonly string[];
  readonly mental_traits_weak: readonly string[];
  readonly relationship_gradients: Readonly<Record<string, {
    readonly attitude: string;
    readonly boundaries: string;
    readonly behaviors: readonly string[];
  }>>;
  readonly generated_persona: string;
  readonly user_overrides: {
    readonly lore: string;
    readonly style_guide: string;
  };
  readonly variant: string;
}

export interface AiCharacterCardInput {
  readonly state: Readonly<GameState>;
  readonly target: number;
  /** NPC-to-NPC prompts must not receive this character's private
   * relationship material toward the player. Mental traits and lore stay
   * (they are public identity); the relationship itself lives in runtime. */
  readonly visibility: "player" | "npc-public";
  /** Empty list allows the settings panel to preview the untouched preset. */
  readonly disabledPresetFields?: readonly PresetCardField[];
}

const CARD_LIMITS = {
  coreTraits: 4,
  sentenceEndings: 8,
  exclamations: 6,
  habits: 3,
  neverSay: 3,
  emphasize: 3,
  avoid: 3,
  intro: 10,
} as const;

const cardCache = new Map<string, { key: string; card: AiCharacterCard }>();

function hashKey(parts: readonly string[]): string {
  let hash = 2166136261;
  for (const part of parts) {
    for (let index = 0; index < part.length; index += 1) {
      hash ^= part.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    hash ^= 0x1f;
  }
  return (hash >>> 0).toString(36);
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

export function buildAiCharacterCard(input: AiCharacterCardInput): AiCharacterCard {
  const { state, target } = input;
  const disabled = input.disabledPresetFields ?? disabledPresetCardFields(currentAiSettings().presetCardDisabledFields, target);
  const live = state.charas[target];
  const data = CHARAS[String(target)] ?? {};
  const cstr = data.CSTR ?? {};
  const charaCatalog = KOJO_CATALOG.byChara?.[String(target)];
  const selected = state.selectedKojoVariants?.[target] ?? charaCatalog?.defaultVariantId ?? "0";
  const targetName = live?.callName ?? data.callName ?? `#${target}`;
  const masterName = state.master.callName ?? "主角";
  const card = getKojoVoiceCard(target, selected);
  const profile = currentAiCharacterProfile(target);
  const mentalTraits = live
    ? buildTalentCategories(live)
      .find((category) => category.key === "MENTAL")
      ?.tags.map((trait) => trait.name)
    : undefined;
  const dynamicProfile = mobGirlProfileForCharacter(state as GameState, target);
  const generatedPersona = dynamicProfile
    ? profile.generatedPersonaKey === mobGirlPersonaKey(dynamicProfile)
      ? profile.generatedPersona ?? fallbackMobGirlBasePersona(dynamicProfile).persona
      : fallbackMobGirlBasePersona(dynamicProfile).persona
    : profile.generatedPersona ?? "";
  const lore = input.visibility === "player" ? presetLore(disabled, target, profile.lore.trim()) : "";
  const styleGuide = input.visibility === "player" ? profile.styleGuide.trim() : "";

  // The cache key covers every input the render depends on, so a hit implies
  // byte-identical output (stable key order + JSON.stringify downsteam).
  const key = hashKey([
    String(target),
    selected,
    masterName,
    targetName,
    mentalTraits?.join("") ?? "",
    generatedPersona,
    lore,
    styleGuide,
    String(input.visibility),
    disabled.join("|"),
  ]);
  const cached = cardCache.get(String(target));
  if (cached && cached.key === key) return cached.card;

  const render = (value: string): string => renderBriefText(value, masterName, targetName);
  const built: AiCharacterCard = {
    target,
    name: data.name ?? live?.callName ?? `#${target}`,
    call_name: targetName,
    player_name: masterName,
    identity: card
      ? {
          species: render(card.identity.species),
          group: render(card.identity.group),
        }
      : { species: "", group: "" },
    intro: Array.from({ length: CARD_LIMITS.intro }, (_, index) => cstr[String(index + 10)])
      .filter((value): value is string => Boolean(value?.trim()))
      .map((value) => value.trim()),
    core_traits: card
      ? renderList(card.stableVoice.coreTraits, masterName, targetName, CARD_LIMITS.coreTraits)
      : [],
    self_image: card ? render(card.stableVoice.selfImage) : "",
    voice: card
      ? {
          tone: render(card.stableVoice.tone),
          volume: render(card.stableVoice.volume),
          sentence_endings: renderList(
            card.stableVoice.sentenceEndings, masterName, targetName, CARD_LIMITS.sentenceEndings),
          exclamations: renderList(
            card.stableVoice.exclamations, masterName, targetName, CARD_LIMITS.exclamations),
        }
      : { tone: "", volume: "", sentence_endings: [], exclamations: [] },
    interaction_habits: card
      ? renderList(card.habits.interaction, masterName, targetName, CARD_LIMITS.habits)
      : [],
    never_say: card
      ? renderList(card.tabooTopics.neverSay, masterName, targetName, CARD_LIMITS.neverSay)
      : [],
    emphasize: card
      ? renderList(card.guidance.emphasize, masterName, targetName, CARD_LIMITS.emphasize)
      : [],
    avoid: card
      ? renderList(card.guidance.avoid, masterName, targetName, CARD_LIMITS.avoid)
      : [],
    mental_traits_weak: mentalTraits ?? [],
    relationship_gradients: card
      ? Object.fromEntries(
          Object.entries(card.relationshipGradients).map(([gradientKey, gradient]) => [
            gradientKey,
            {
              attitude: render(gradient.attitude),
              boundaries: render(gradient.boundaries),
              behaviors: renderList(gradient.behaviors, masterName, targetName, 2),
            },
          ]),
        )
      : {},
    generated_persona: generatedPersona,
    user_overrides: { lore, style_guide: styleGuide },
    variant: selected,
  };
  const filtered: AiCharacterCard = {
    ...built,
    identity: { species: presetText(disabled, "identity.species", built.identity.species), group: presetText(disabled, "identity.group", built.identity.group) },
    intro: presetList(disabled, "intro", built.intro),
    core_traits: presetList(disabled, "core_traits", built.core_traits),
    self_image: presetText(disabled, "self_image", built.self_image),
    voice: {
      tone: presetText(disabled, "voice.tone", built.voice.tone),
      volume: presetText(disabled, "voice.volume", built.voice.volume),
      sentence_endings: presetList(disabled, "voice.sentence_endings", built.voice.sentence_endings),
      exclamations: presetList(disabled, "voice.exclamations", built.voice.exclamations),
    },
    interaction_habits: presetList(disabled, "interaction_habits", built.interaction_habits),
    never_say: presetList(disabled, "never_say", built.never_say),
    emphasize: presetList(disabled, "emphasize", built.emphasize),
    avoid: presetList(disabled, "avoid", built.avoid),
    relationship_gradients: Object.fromEntries(Object.entries(built.relationship_gradients).map(([gradient, value]) => [gradient, {
      attitude: presetText(disabled, `relationship_gradients.${gradient}.attitude` as PresetCardField, value.attitude),
      boundaries: presetText(disabled, `relationship_gradients.${gradient}.boundaries` as PresetCardField, value.boundaries),
      behaviors: presetList(disabled, `relationship_gradients.${gradient}.behaviors` as PresetCardField, value.behaviors),
    }])),
  };
  cardCache.set(String(target), { key, card: filtered });
  return filtered;
}

/** Style-reference lines curated for the character card (prompt part ④).
 * Deterministic prefix selection; gradient-aware retrieval is phase 2. */
export function characterCardStyleExamples(card: AiCharacterCard, disabled = disabledPresetCardFields(currentAiSettings().presetCardDisabledFields, card.target)): readonly string[] {
  if (disabled.includes("reference_lines")) return [];
  const voiceCard = getKojoVoiceCard(card.target, card.variant);
  if (!voiceCard) return [];
  return renderList(
    voiceCard.guidance.referenceLines,
    card.player_name,
    card.call_name,
    2,
  );
}
