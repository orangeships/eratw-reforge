import { create } from "zustand";
import { configureStateTopics, resetStateTopics } from "../../../modernization/runtime/ai-state/context.js";
import { LazyStore } from "@tauri-apps/plugin-store";
import { DEFAULT_AI_CHARACTER_LORE } from "./character-lore.generated.js";
import type {
  AiCharacterCardOverride,
  AiCharacterProfile,
  AiCommandHistoryEntry,
  AiDebugEntry,
  AiInteractionHistoryEntry,
  AiSettings,
} from "./types.js";
import { normalizeCardOverride } from "./character-card-ai.js";
import { normalizePresetCardDisabledFields, DEFAULT_DISABLED_PRESET_CARD_FIELDS, PRESET_CARD_DEFAULTS_VERSION } from "./preset-card-fields.js";
import { normalizeAiPromptOverrides } from "./prompt-catalog.js";
import {
  normalizeS4EvaluationRecords,
  upsertS4EvaluationRecord,
  type S4LazyEvaluationRecord,
} from "./s4-evaluation.js";

const STORAGE_KEY = "eratw:ai-settings:v1";
const TAURI_STORE_KEY = "ai_kojo_settings_v1";
const S4_EVALUATION_STORAGE_KEY = "eratw:s4-evaluation:v1";
const tauriStore = new LazyStore("settings.json");
let tauriPersistQueue: Promise<void> = Promise.resolve();
const DEBUG_LIMIT = 30;
const HISTORY_LIMIT = 60;

export const DEFAULT_AI_CHARACTER_PROFILE: AiCharacterProfile = {
  enabled: true,
  lore: "",
  styleGuide: "",
};

/** 本版本随包内置的「保底默认」连接参数：游戏对话走 UU 的
 *  OpenAI-compatible 入口，Gemini 模型名由 UU 分组解析。玩家仍可在设置窗
 *  覆盖成自己的 baseUrl/apiKey/model。API key 不随源码分发，运行时由本地
 *  环境或设置注入。 */
const LEGACY_SHIPPED_DEFAULT_BASE_URL = "https://api.minimaxi.com/v1";
const LEGACY_SHIPPED_DEFAULT_MODEL = "MiniMax-M3";
const SHIPPED_DEFAULT_BASE_URL = "https://uuapi.io/v1";
const SHIPPED_DEFAULT_MODEL = "gemini-3.8-flash";
const LEGACY_DEFAULT_MAX_TOKENS = 260;
export const AI_MAX_TOKENS_LIMIT = 16_384;

export const DEFAULT_AI_SETTINGS: AiSettings = {
  // 用户拍板：开关默认为开，开箱即有模型 API（key 由 .env.local 构建注入，
  // gitignored——不入仓库；dist 产物运行时必需包含）。
  enabled: true,
  kojoEnabled: true,
  fullAiKojoEnabled: false,
  relationshipChangesEnabled: false,
  dialogueActionsEnabled: false,
  dialogueActionProvider: "chat",
  dialogueActionApiKey: "",
  stateQueryEnabled: false,
  ambientEnabled: false,
  lazyMaterializationEnabled: false,
  storyEnabled: false,
  narrativeEnabled: false,
  daytimeReactionEnabled: false,
  narrativeFrequency: "moderate",
  radioEnabled: true,
  // EVENT_COUNTER AI 选择:gameplay 选择层,默认关(计划拍板)。
  counterEnabled: false,
  reasoningEffort: "medium",
  allowUnsupportedAuthored: false,
  baseUrl: SHIPPED_DEFAULT_BASE_URL,
  model: SHIPPED_DEFAULT_MODEL,
  apiKey: "",
  timeoutMs: 90_000,
  temperature: 0.75,
  maxTokens: 1_024,
  promptOverrides: {},
  characterProfiles: {},
  characterCardOverrides: {},
  presetCardDefaultsVersion: PRESET_CARD_DEFAULTS_VERSION,
  presetCardDisabledFields: {},
};

function clampCharacterProfile(value: Partial<AiCharacterProfile> | undefined): AiCharacterProfile {
  const generatedPersona = typeof value?.generatedPersona === "string"
    ? value.generatedPersona.trim().slice(0, 240)
    : "";
  const generatedPersonaSource = value?.generatedPersonaSource === "ai" || value?.generatedPersonaSource === "fallback"
    ? value.generatedPersonaSource
    : undefined;
  const generatedPersonaKey = typeof value?.generatedPersonaKey === "string"
    ? value.generatedPersonaKey.trim().slice(0, 180)
    : "";
  return {
    enabled: value?.enabled !== false,
    lore: typeof value?.lore === "string" ? value.lore.slice(0, 12_000) : "",
    styleGuide: typeof value?.styleGuide === "string" ? value.styleGuide.slice(0, 4_000) : "",
    ...(generatedPersona ? { generatedPersona } : {}),
    ...(generatedPersona && generatedPersonaSource ? { generatedPersonaSource } : {}),
    ...(generatedPersona && generatedPersonaKey ? { generatedPersonaKey } : {}),
  };
}

function characterProfileFor(charaNum: number, value: Partial<AiCharacterProfile> | undefined): AiCharacterProfile {
  const profile = clampCharacterProfile(value);
  return {
    ...profile,
    lore: typeof value?.lore === "string"
      ? profile.lore
      : DEFAULT_AI_CHARACTER_LORE[charaNum] ?? "",
  };
}

/** `promptLayers` is the removed "extra prepended layer prompt" feature; it is
 *  dropped on load so old saves cannot leak the dead key into settings. */
type PersistedAiSettings = Partial<AiSettings> & { kojoFamilies?: unknown; promptLayers?: unknown };

function migrateLegacyShippedConnection(value: PersistedAiSettings): PersistedAiSettings {
  const baseUrl = typeof value.baseUrl === "string"
    ? value.baseUrl.trim().replace(/\/+$/, "")
    : "";
  const model = typeof value.model === "string" ? value.model.trim() : "";
  if (baseUrl !== LEGACY_SHIPPED_DEFAULT_BASE_URL || model !== LEGACY_SHIPPED_DEFAULT_MODEL) {
    return value;
  }
  return {
    ...value,
    baseUrl: SHIPPED_DEFAULT_BASE_URL,
    model: SHIPPED_DEFAULT_MODEL,
    apiKey: "",
  };
}

export function normalizeAiSettings(value: PersistedAiSettings): AiSettings {
  try { if (value.stateTopics !== undefined) configureStateTopics(value.stateTopics); else resetStateTopics(); }
  catch { value = { ...value, stateTopics: undefined }; resetStateTopics(); }
  value = migrateLegacyShippedConnection(value);
  const currentValue = { ...value };
  delete currentValue.kojoFamilies;
  delete currentValue.promptLayers;
  const characterProfiles = Object.fromEntries(
    Object.entries(value.characterProfiles ?? {}).map(([id, profile]) => [
      id,
      clampCharacterProfile(profile),
    ]),
  );
  const characterCardOverrides = Object.fromEntries(
    Object.entries((value.characterCardOverrides ?? {}) as Record<string, unknown>)
      .map(([id, override]) => [id, normalizeCardOverride(override)] as const)
      .filter(([, override]) => Object.keys(override).some((key) => key !== "append" && key !== "remove")
        || Object.keys(override.append ?? {}).length > 0 || Object.keys(override.remove ?? {}).length > 0),
  );
  const usesLegacyGeminiDefaults = value.baseUrl?.trim().replace(/\/+$/, "") === SHIPPED_DEFAULT_BASE_URL &&
    value.model?.trim().toLowerCase() === SHIPPED_DEFAULT_MODEL &&
    (value.reasoningEffort === undefined || value.reasoningEffort === "low") &&
    (value.maxTokens === undefined || Number(value.maxTokens) === LEGACY_DEFAULT_MAX_TOKENS);
  const reasoningEffort = value.reasoningEffort === "off" || value.reasoningEffort === "high" || value.reasoningEffort === "medium" || value.reasoningEffort === "low"
    ? value.reasoningEffort
    : DEFAULT_AI_SETTINGS.reasoningEffort;
  const requestedMaxTokens = usesLegacyGeminiDefaults
    ? DEFAULT_AI_SETTINGS.maxTokens
    : Math.trunc(Number(value.maxTokens) || DEFAULT_AI_SETTINGS.maxTokens);
  return {
    ...DEFAULT_AI_SETTINGS,
    ...currentValue,
    enabled: value.enabled === true,
    kojoEnabled: value.kojoEnabled !== false,
    // Replacement is separately consented and must remain off for settings
    // persisted before this field existed.
    fullAiKojoEnabled: value.fullAiKojoEnabled === true,
    relationshipChangesEnabled: value.relationshipChangesEnabled === true,
    dialogueActionsEnabled: value.dialogueActionsEnabled === true,
    dialogueActionProvider: value.dialogueActionProvider === "jev" ? "jev" : "chat",
    dialogueActionApiKey: typeof value.dialogueActionApiKey === "string" ? value.dialogueActionApiKey : "",
    stateQueryEnabled: value.stateQueryEnabled === true,
    // This is a new, independently consented feature. Old settings that do
    // not carry the field must remain off even when the master switch is on.
    ambientEnabled: value.ambientEnabled === true,
    lazyMaterializationEnabled: value.lazyMaterializationEnabled === true,
    storyEnabled: value.storyEnabled === true,
    narrativeEnabled: value.narrativeEnabled === true,
    // Daytime L2 adds provider calls and therefore remains an explicit,
    // independently persisted opt-in. The synchronous fact projection does
    // not depend on this switch.
    daytimeReactionEnabled: value.daytimeReactionEnabled === true,
    narrativeFrequency: value.narrativeFrequency === "sparse" || value.narrativeFrequency === "frequent"
      ? value.narrativeFrequency
      : "moderate",
    radioEnabled: value.radioEnabled !== false,
    // The previous shipped Gemini build persisted hidden low/260 defaults.
    // Lift that untouched pair once; an explicit low selection paired with the
    // new visible response budget remains stable on subsequent loads.
    reasoningEffort: usesLegacyGeminiDefaults ? "medium" : reasoningEffort,
    allowUnsupportedAuthored: value.allowUnsupportedAuthored === true,
    baseUrl: typeof value.baseUrl === "string" ? value.baseUrl : DEFAULT_AI_SETTINGS.baseUrl,
    model: typeof value.model === "string" ? value.model : DEFAULT_AI_SETTINGS.model,
    apiKey: typeof value.apiKey === "string" ? value.apiKey : "",
    timeoutMs: usesLegacyGeminiDefaults
      ? DEFAULT_AI_SETTINGS.timeoutMs
      : Math.max(1_000, Math.min(180_000, Number(value.timeoutMs) || DEFAULT_AI_SETTINGS.timeoutMs)),
    temperature: Math.max(0, Math.min(2, Number(value.temperature) || DEFAULT_AI_SETTINGS.temperature)),
    maxTokens: Math.max(128, Math.min(AI_MAX_TOKENS_LIMIT, requestedMaxTokens)),
    promptOverrides: normalizeAiPromptOverrides(value.promptOverrides),
    characterProfiles,
    characterCardOverrides,
    presetCardDefaultsVersion: PRESET_CARD_DEFAULTS_VERSION,
    presetCardDisabledFields: normalizePresetCardDisabledFields(
      value.presetCardDefaultsVersion === PRESET_CARD_DEFAULTS_VERSION
        ? value.presetCardDisabledFields
        : Object.fromEntries(Object.entries(normalizePresetCardDisabledFields(value.presetCardDisabledFields))
          .map(([id, fields]) => [id, [...fields, ...DEFAULT_DISABLED_PRESET_CARD_FIELDS]])),
    ),
  };
}

function loadSettings(): AiSettings {
  if (typeof window === "undefined") return DEFAULT_AI_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeAiSettings(JSON.parse(raw) as PersistedAiSettings) : DEFAULT_AI_SETTINGS;
  } catch {
    return DEFAULT_AI_SETTINGS;
  }
}

function persistSettings(settings: AiSettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Settings persistence is best-effort; live settings still work.
  }
  tauriPersistQueue = tauriPersistQueue
    .then(async () => {
      await tauriStore.set(TAURI_STORE_KEY, settings);
      await tauriStore.save();
    })
    .catch(() => undefined);
}

function loadS4EvaluationEntries(): S4LazyEvaluationRecord[] {
  if (typeof window === "undefined") return [];
  try {
    return normalizeS4EvaluationRecords(JSON.parse(
      window.localStorage.getItem(S4_EVALUATION_STORAGE_KEY) ?? "[]",
    ));
  } catch {
    return [];
  }
}

function persistS4EvaluationEntries(entries: readonly S4LazyEvaluationRecord[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(S4_EVALUATION_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // S4 diagnostics are best-effort and must never block gameplay.
  }
}

interface AiState {
  settings: AiSettings;
  debugEntries: AiDebugEntry[];
  interactionHistory: AiInteractionHistoryEntry[];
  s4EvaluationEntries: S4LazyEvaluationRecord[];
  updateSettings: (patch: Partial<AiSettings>) => void;
  updateCharacterProfile: (charaNum: number, patch: Partial<AiCharacterProfile>) => void;
  updateCharacterCardOverride: (charaNum: number, override: AiCharacterCardOverride | null) => void;
  addDebugEntry: (entry: AiDebugEntry) => void;
  patchDebugEntry: (requestId: string, patch: Partial<AiDebugEntry>) => void;
  addInteractionHistory: (entry: AiInteractionHistoryEntry) => void;
  patchCommandHistory: (
    id: string,
    patch: Partial<Pick<AiCommandHistoryEntry, "aiLines" | "visibleLines">>,
  ) => void;
  clearDebug: () => void;
  clearS4Evaluation: () => void;
  /** 问题3 — drop every AI-generated persona so profiles fall back to the
   *  deterministic lore; persisted immediately. */
  clearGeneratedPersonas: () => void;
  resetEphemeral: () => void;
}

export const useAiStore = create<AiState>((set) => ({
  settings: loadSettings(),
  debugEntries: [],
  interactionHistory: [],
  s4EvaluationEntries: loadS4EvaluationEntries(),
  updateSettings(patch) {
    set((state) => {
      const settings = normalizeAiSettings({ ...state.settings, ...patch });
      persistSettings(settings);
      return { settings };
    });
  },
  updateCharacterProfile(charaNum, patch) {
    set((state) => {
      const key = String(charaNum);
      const profile = characterProfileFor(charaNum, {
        ...state.settings.characterProfiles[key],
        ...patch,
      });
      const settings = normalizeAiSettings({
        ...state.settings,
        characterProfiles: {
          ...state.settings.characterProfiles,
          [key]: profile,
        },
      });
      persistSettings(settings);
      return { settings };
    });
  },
  updateCharacterCardOverride(charaNum, override) {
    set((state) => {
      const key = String(charaNum);
      const nextOverrides = { ...state.settings.characterCardOverrides };
      if (override === null) delete nextOverrides[key];
      else nextOverrides[key] = override;
      const settings = normalizeAiSettings({
        ...state.settings,
        characterCardOverrides: nextOverrides,
      });
      persistSettings(settings);
      return { settings };
    });
  },
  addDebugEntry(entry) {
    set((state) => {
      const s4EvaluationEntries = upsertS4EvaluationRecord(state.s4EvaluationEntries, entry);
      if (entry.feature === "agent-materialization") persistS4EvaluationEntries(s4EvaluationEntries);
      return {
        debugEntries: [entry, ...state.debugEntries].slice(0, DEBUG_LIMIT),
        s4EvaluationEntries,
      };
    });
  },
  patchDebugEntry(requestId, patch) {
    set((state) => {
      const debugEntries = state.debugEntries.map((entry) =>
        entry.requestId === requestId ? { ...entry, ...patch } : entry);
      const patched = debugEntries.find((entry) => entry.requestId === requestId);
      const s4EvaluationEntries = patched
        ? upsertS4EvaluationRecord(state.s4EvaluationEntries, patched)
        : state.s4EvaluationEntries;
      if (patched?.feature === "agent-materialization") persistS4EvaluationEntries(s4EvaluationEntries);
      return { debugEntries, s4EvaluationEntries };
    });
  },
  addInteractionHistory(entry) {
    set((state) => ({ interactionHistory: [...state.interactionHistory, entry].slice(-HISTORY_LIMIT) }));
  },
  patchCommandHistory(id, patch) {
    set((state) => ({
      interactionHistory: state.interactionHistory.map((entry) =>
        entry.id === id && entry.source === "command" ? { ...entry, ...patch } : entry),
    }));
  },
  clearDebug() {
    set({ debugEntries: [] });
  },
  clearS4Evaluation() {
    persistS4EvaluationEntries([]);
    set({ s4EvaluationEntries: [] });
  },
  clearGeneratedPersonas() {
    set((state) => {
      const characterProfiles = Object.fromEntries(
        Object.entries(state.settings.characterProfiles).map(([key, profile]) => [
          key,
          clampCharacterProfile({
            ...profile,
            generatedPersona: undefined,
            generatedPersonaSource: undefined,
            generatedPersonaKey: undefined,
          }),
        ]),
      );
      const settings = normalizeAiSettings({ ...state.settings, characterProfiles });
      persistSettings(settings);
      return { settings };
    });
  },
  resetEphemeral() {
    set({ debugEntries: [], interactionHistory: [] });
  },
}));

export function currentAiSettings(): AiSettings {
  return useAiStore.getState().settings;
}

export function currentAiCharacterProfile(charaNum: number): AiCharacterProfile {
  return characterProfileFor(charaNum, useAiStore.getState().settings.characterProfiles[String(charaNum)]);
}

/** Prefer the native app settings file when running in Tauri. Browser/player
 *  builds transparently retain the localStorage fallback. */
export async function hydrateAiSettings(): Promise<void> {
  try {
    const saved = await tauriStore.get<Partial<AiSettings>>(TAURI_STORE_KEY);
    if (!saved || typeof saved !== "object") return;
    const settings = normalizeAiSettings(saved);
    if (typeof window !== "undefined") {
      try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch { /* best effort */ }
    }
    useAiStore.setState({ settings });
  } catch {
    // Plain browser builds have no Tauri IPC; the eager localStorage value wins.
  }
}
