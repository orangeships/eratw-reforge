import { create } from "zustand";
import { LazyStore } from "@tauri-apps/plugin-store";
import { DEFAULT_AI_CHARACTER_LORE } from "./character-lore.generated.js";
import type {
  AiCharacterProfile,
  AiCommandHistoryEntry,
  AiDebugEntry,
  AiInteractionHistoryEntry,
  AiSettings,
} from "./types.js";

const STORAGE_KEY = "eratw:ai-settings:v1";
const TAURI_STORE_KEY = "ai_kojo_settings_v1";
const tauriStore = new LazyStore("settings.json");
const DEBUG_LIMIT = 30;
const HISTORY_LIMIT = 60;

export const DEFAULT_AI_CHARACTER_PROFILE: AiCharacterProfile = {
  enabled: true,
  lore: "",
  styleGuide: "",
};

/** 本版本随包内置的「保底默认」连接参数：未配置任何 AI 服务时，玩家开启
 *  AI 即直接可用 MiniMax 云端 OpenAI-compatible 端点。玩家仍可在设置窗
 *  覆盖成自己的 baseUrl/apiKey/model（例如换成本地 Ollama）。默认模型用
 *  MiniMax-M3：只有它支持 `thinking:{type:"disabled"}`（M2.x 会强制思考，
 *  260 token 预算被 <think> 吃光、正式 JSON 出不来）。API key 不随代码/构建物
 *  分发，玩家需在设置中填写自己的 key。 */
const SHIPPED_DEFAULT_BASE_URL = "https://api.minimaxi.com/v1";
const SHIPPED_DEFAULT_MODEL = "MiniMax-M3";

export const DEFAULT_AI_SETTINGS: AiSettings = {
  enabled: false,
  kojoEnabled: true,
  ambientEnabled: false,
  kojoFamilies: ["comm", "daily", "kaji", "sekuhara"],
  radioEnabled: true,
  reasoningEffort: "low",
  allowUnsupportedAuthored: false,
  baseUrl: SHIPPED_DEFAULT_BASE_URL,
  model: SHIPPED_DEFAULT_MODEL,
  apiKey: "",
  timeoutMs: 15_000,
  temperature: 0.75,
  maxTokens: 260,
  characterProfiles: {},
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

function clampSettings(value: Partial<AiSettings>): AiSettings {
  const characterProfiles = Object.fromEntries(
    Object.entries(value.characterProfiles ?? {}).map(([id, profile]) => [
      id,
      clampCharacterProfile(profile),
    ]),
  );
  return {
    ...DEFAULT_AI_SETTINGS,
    ...value,
    enabled: value.enabled === true,
    kojoEnabled: value.kojoEnabled !== false,
    // This is a new, independently consented feature. Old settings that do
    // not carry the field must remain off even when the master switch is on.
    ambientEnabled: value.ambientEnabled === true,
    radioEnabled: value.radioEnabled !== false,
    reasoningEffort: value.reasoningEffort === "high" || value.reasoningEffort === "medium"
      ? value.reasoningEffort
      : "low",
    allowUnsupportedAuthored: value.allowUnsupportedAuthored === true,
    kojoFamilies: Array.isArray(value.kojoFamilies)
      ? value.kojoFamilies.filter((f): f is string => typeof f === "string")
      : DEFAULT_AI_SETTINGS.kojoFamilies,
    baseUrl: typeof value.baseUrl === "string" ? value.baseUrl : DEFAULT_AI_SETTINGS.baseUrl,
    model: typeof value.model === "string" ? value.model : DEFAULT_AI_SETTINGS.model,
    apiKey: typeof value.apiKey === "string" ? value.apiKey : "",
    timeoutMs: Math.max(1_000, Math.min(60_000, Number(value.timeoutMs) || DEFAULT_AI_SETTINGS.timeoutMs)),
    temperature: Math.max(0, Math.min(2, Number(value.temperature) || DEFAULT_AI_SETTINGS.temperature)),
    maxTokens: Math.max(64, Math.min(1_024, Math.trunc(Number(value.maxTokens) || DEFAULT_AI_SETTINGS.maxTokens))),
    characterProfiles,
  };
}

function loadSettings(): AiSettings {
  if (typeof window === "undefined") return DEFAULT_AI_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? clampSettings(JSON.parse(raw) as Partial<AiSettings>) : DEFAULT_AI_SETTINGS;
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
  void tauriStore.set(TAURI_STORE_KEY, settings)
    .then(() => tauriStore.save())
    .catch(() => undefined);
}

interface AiState {
  settings: AiSettings;
  debugEntries: AiDebugEntry[];
  interactionHistory: AiInteractionHistoryEntry[];
  updateSettings: (patch: Partial<AiSettings>) => void;
  updateCharacterProfile: (charaNum: number, patch: Partial<AiCharacterProfile>) => void;
  addDebugEntry: (entry: AiDebugEntry) => void;
  patchDebugEntry: (requestId: string, patch: Partial<AiDebugEntry>) => void;
  addInteractionHistory: (entry: AiInteractionHistoryEntry) => void;
  patchCommandHistory: (
    id: string,
    patch: Partial<Pick<AiCommandHistoryEntry, "aiLines" | "visibleLines">>,
  ) => void;
  clearDebug: () => void;
  resetEphemeral: () => void;
}

export const useAiStore = create<AiState>((set) => ({
  settings: loadSettings(),
  debugEntries: [],
  interactionHistory: [],
  updateSettings(patch) {
    set((state) => {
      const settings = clampSettings({ ...state.settings, ...patch });
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
      const settings = clampSettings({
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
  addDebugEntry(entry) {
    set((state) => ({ debugEntries: [entry, ...state.debugEntries].slice(0, DEBUG_LIMIT) }));
  },
  patchDebugEntry(requestId, patch) {
    set((state) => ({
      debugEntries: state.debugEntries.map((entry) =>
        entry.requestId === requestId ? { ...entry, ...patch } : entry),
    }));
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
    const settings = clampSettings(saved);
    if (typeof window !== "undefined") {
      try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch { /* best effort */ }
    }
    useAiStore.setState({ settings });
  } catch {
    // Plain browser builds have no Tauri IPC; the eager localStorage value wins.
  }
}
