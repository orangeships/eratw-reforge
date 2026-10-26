import { DEFAULT_AI_CHARACTER_LORE } from "./character-lore.generated.js";

/** Only authored preset content is switchable here. Runtime identity/state and
 * player additions are deliberately outside this catalog. */
const BASE_FIELDS = [
  ["identity.species", "种族", "身份"], ["identity.group", "所属", "身份"],
  ["intro", "人物介绍", "身份"],
  ["preset_lore", "内置补充设定", "身份"],
  ["core_traits", "核心特质", "性格与习惯"], ["self_image", "自我认知", "性格与习惯"],
  ["interaction_habits", "互动习惯", "性格与习惯"],
  ["voice.tone", "语气", "说话风格"], ["voice.volume", "音量与节奏", "说话风格"],
  ["voice.sentence_endings", "常用句尾", "说话风格"], ["voice.exclamations", "常用感叹", "说话风格"],
  ["reference_lines", "参考台词", "说话风格"],
  ["never_say", "绝不提及", "创作约束"], ["emphasize", "强调", "创作约束"], ["avoid", "避免", "创作约束"],
] as const;
export const PRESET_GRADIENTS = [
  ["stranger", "陌生"], ["friendly", "友好"], ["crush", "倾心"], ["love", "爱恋"], ["angry", "愤怒"],
] as const;
const GRADIENT_PARTS = [["attitude", "态度"], ["boundaries", "边界"], ["behaviors", "表现方式"]] as const;
export type PresetCardField = typeof BASE_FIELDS[number][0]
  | `relationship_gradients.${typeof PRESET_GRADIENTS[number][0]}.${typeof GRADIENT_PARTS[number][0]}`;
export const PRESET_CARD_FIELDS: readonly { key: PresetCardField; label: string; group: string }[] = [
  ...BASE_FIELDS.map(([key, label, group]) => ({ key, label, group })),
  ...PRESET_GRADIENTS.flatMap(([gradient, name]) => GRADIENT_PARTS.map(([part, label]) => ({
    key: `relationship_gradients.${gradient}.${part}` as PresetCardField,
    label: `${name} · ${label}`, group: "关系阶段",
  }))),
];
const KEYS = new Set<string>(PRESET_CARD_FIELDS.map(field => field.key));
export const PRESET_CARD_DEFAULTS_VERSION = 1;
export const DEFAULT_DISABLED_PRESET_CARD_FIELDS: readonly PresetCardField[] = [
  "core_traits", "interaction_habits", "never_say", "emphasize", "avoid",
];
export function disabledPresetCardFields(
  fields: Record<string, PresetCardField[]> | undefined, target: number,
): readonly PresetCardField[] {
  return fields?.[String(target)] ?? DEFAULT_DISABLED_PRESET_CARD_FIELDS;
}
export function normalizePresetCardDisabledFields(value: unknown): Record<string, PresetCardField[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([id, fields]) => {
    if (!/^[1-9]\d*$/.test(id) || !Array.isArray(fields)) return [];
    const valid = new Set(fields.filter((key): key is PresetCardField => typeof key === "string" && KEYS.has(key)));
    const ordered = PRESET_CARD_FIELDS.filter(field => valid.has(field.key)).map(field => field.key);
    return [[id, ordered]];
  }));
}
export function presetText(disabled: readonly PresetCardField[], key: PresetCardField, value: string): string {
  return disabled.includes(key) ? "" : value;
}
export function presetList(disabled: readonly PresetCardField[], key: PresetCardField, value: readonly string[]): readonly string[] {
  return disabled.includes(key) ? [] : value;
}
/** Prefilled lore shares the legacy text area with player lore. Suppress only
 * the untouched bundled text; never subtract substrings from a player's edit. */
export function presetLore(disabled: readonly PresetCardField[], target: number, lore: string): string {
  return disabled.includes("preset_lore") && lore.trim() === (DEFAULT_AI_CHARACTER_LORE[target] ?? "").trim() ? "" : lore;
}
