import type { ObservationEvent } from "../../../modernization/schemas/types.js";
import type {
  AmbientInitiativeKind,
  AmbientInitiativeMode,
  AmbientInitiativeOpportunity,
  AmbientInitiativeTrigger,
} from "../../../modernization/runtime/world/ambient-initiative.js";
import type { GameState } from "../../../modernization/runtime/state/game-state.js";
import type { DialogueRouter } from "../../../modernization/runtime/kojo/types.js";
import type { AiPromptOverrides } from "./prompt-catalog.js";
import type { PresetCardField } from "./preset-card-fields.js";

export interface AiSettings {
  /** Master switch for every optional AI presentation feature. */
  enabled: boolean;
  /** AI-generated dialogue for otherwise silent everyday kojo routes. */
  kojoEnabled: boolean;
  /** Default-off replacement mode for eligible command kojo: the resolved
   * authored lines become bounded style reference and AI supplies the visible
   * dialogue. Provider/validation failure restores the authored lines. */
  fullAiKojoEnabled: boolean;
  /** Independent opt-in: free chat can settle bounded favor/trust deltas. */
  relationshipChangesEnabled?: boolean;
  /** Default-off closed accompaniment/invitation decisions after chat or command kojo. */
  dialogueActionsEnabled?: boolean;
  dialogueActionProvider?: "chat" | "jev";
  /** Shared JEV classification key (diary and optional dialogue actions), never the L1 provider key. */
  dialogueActionApiKey?: string;
  /** One optional state lookup; automatic kojo never adds a round trip. */
  stateQueryEnabled?: boolean;
  stateTopics?: unknown;
  /** Disposable initiative prose shown directly on the current scene. */
  ambientEnabled: boolean;
  /** S2 single-character off-screen experience materialization. */
  lazyMaterializationEnabled: boolean;
  /** S5/S6 bounded short-event selection and story-expression route. */
  storyEnabled: boolean;
  /** L3 V2 Narrative Director. Independent and default-off even when the AI
   * master switch or StoryProgram V1 debug route is enabled. */
  narrativeEnabled: boolean;
  /** Daytime L2 mind reaction. Facts remain synchronous when this is off. */
  daytimeReactionEnabled?: boolean;
  narrativeFrequency: "sparse" | "moderate" | "frequent";
  /** AI-authored connective prose for the deterministic radio forecast. */
  radioEnabled: boolean;
  /** EVENT_COUNTER action selection by AI (pool-member picks only; the
   *  deterministic weighted draw stays the fallback and the validator). This
   *  is a gameplay choice, not presentation text, so it gates independently
   *  from kojoEnabled/fullAiKojoEnabled and defaults off. */
  counterEnabled: boolean;
  /** Provider reasoning scale. Gemini 3 uses the OpenAI-compatible
   *  reasoning_effort field; provider-specific adapters map it as needed.
   *  `off` is an explicit request to disable provider-supported thinking. */
  reasoningEffort: "off" | "low" | "medium" | "high";
  /** M3 opt-in: fill silent authored routes whose resolver status is exactly
   *  unsupported. Gated/partial routes remain ineligible. */
  allowUnsupportedAuthored: boolean;
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
  temperature: number;
  maxTokens: number;
  /** Player-edited AI prompt blocks, keyed by prompt-catalog slot id. Only the
   *  blocks the player actually changed are stored; every other route sends its
   *  code default verbatim. Runtime context selection, character-card
   *  projection, output contracts and validators all stay program-owned. */
  promptOverrides: AiPromptOverrides;
  characterProfiles: Record<string, AiCharacterProfile>;
  /** Player-approved structured deltas over the derived character card.
   *  Stored per character id; null keys are absent (original card). */
  characterCardOverrides: Record<string, AiCharacterCardOverride>;
  /** Version of the one-time preset-default migration. */
  presetCardDefaultsVersion?: number;
  /** Per-character disabled authored fields; applied before player additions. */
  presetCardDisabledFields?: Record<string, PresetCardField[]>;
}

export type { AiPromptOverrides, AiPromptSlotId } from "./prompt-catalog.js";

/** 卡片段落键：列表字段按条目增删，标量字段整体替换。 */
export type AiCharacterCardListKey =
  | "core_traits"
  | "interaction_habits"
  | "never_say"
  | "emphasize"
  | "avoid"
  | "voice_sentence_endings"
  | "voice_exclamations";

export interface AiCharacterCardOverride {
  self_image?: string;
  voice_tone?: string;
  voice_volume?: string;
  append?: Partial<Record<AiCharacterCardListKey, readonly string[]>>;
  remove?: Partial<Record<AiCharacterCardListKey, readonly string[]>>;
}

export interface AiCharacterProfile {
  /** Per-character child switch under the global AI switch. */
  enabled: boolean;
  /** User-maintained canon/personality notes (e.g. pasted from a wiki). */
  lore: string;
  /** Voice, wording, address and out-of-character prohibitions. */
  styleGuide: string;
  /** Short generated seed for a dynamic character's ordinary dialogue. */
  generatedPersona?: string;
  /** Provenance of the generated persona; fallback is deterministic/local. */
  generatedPersonaSource?: "ai" | "fallback";
  /** Dynamic-character identity guard so reused ids cannot inherit old text. */
  generatedPersonaKey?: string;
}

/** Event kojo context kinds for AI prompt construction. */
export type EventKojoContext =
  | "sneak-in-refused"     // 潜入被拒绝（EVENT 12 sub 1,4）
  | "sneak-in-allowed"     // 潜入被允许（EVENT 12 sub 1,2）
  | "sneak-in-rage"        // 潜入遇到愤怒（EVENT 12 sub 2,1）
  | "kick-out-bedroom"     // 被从卧室赶出（EVENT 3 sub 7,1）
  | "other";               // 其他 EVENT 口上

export interface PrepareAiEventKojoInput {
  target: number;
  eventArm: number;        // EVENT 号（3, 12 等）
  eventSub: number[];      // sub 参数（如 [7, 1] 或 [1, 4]）
  state: Readonly<GameState>;
  router: DialogueRouter;
  seed: number;
  context: EventKojoContext;
  /** 事件的简短描述，用于 prompt 上下文 */
  contextDescription: string;
}

/** Witness kojo — an awake co-located NPC reacts to a target-less command
 * (神签 / 摆摊 / 道具自用 …). The command has no focused TARGET, so the
 * speaker is chosen deterministically from the bystanders. */
export interface PrepareAiWitnessKojoInput {
  commandNo: number;
  beforeState: Readonly<GameState>;
  afterState: Readonly<GameState>;
  events: readonly ObservationEvent[];
  seed: number;
  router: DialogueRouter;
}

export interface AiCompletionRequest {
  stateContext?: {
    canQuery: boolean;
    topics: Array<{ id: string; label: string }>;
    query: (topics: string[]) => unknown;
    trace: unknown;
    durationMs: number;
  };
  system: string;
  user: string;
  /** Accepted, observer-scoped recent turns between system and current user.
   * Other routes omit this and retain their two-message request. */
  contextMessages?: readonly AiContextMessage[];
  temperature: number;
  maxTokens: number;
  /** Request provider-level JSON enforcement for structured kojo output. */
  jsonMode?: boolean;
}

export interface AiContextMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export interface AiTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** Some OpenAI-compatible providers omit usage, so S4 keeps a labeled estimate. */
  source: "provider" | "estimated";
}

export interface AiProvider {
  /** `onPartial` receives the accumulated assistant content while an SSE
   *  response is arriving. Providers without streaming may omit callbacks. */
  complete(
    request: AiCompletionRequest,
    signal: AbortSignal,
    onPartial?: (accumulated: string) => void,
    onUsage?: (usage: AiTokenUsage) => void,
  ): Promise<string>;
}

export interface AiGeneratedLine {
  text: string;
  form: "PRINTFORML" | "PRINTFORMDL";
  /** Optional current responses. Story-bound selections feed narrative
   * evidence; gameplay effects and accepted hook responses remain Runtime-owned. */
  aiChoice?: {
    /** Optional current Arc; publication binds its Runtime revision. */
    storyArcId?: string;
    options: Array<{
      label: string;
      lines: Array<{ text: string; form: "PRINTFORML" | "PRINTFORMDL" }>;
    }>;
  };
}

/** The route provenance recorded for an AI completion. */
export type AiRouteStatus = "not-authored" | "unsupported" | "authored-empty" | "authored-reference" | "story-hook";

export type AiKojoPresentationMode = "supplement" | "replace-authored";

interface AiInteractionHistoryBase {
  id: string;
  source: "command" | "ambient";
  timestamp: number;
  location: string;
  sceneEpoch: number;
  gameTick: number;
  participantIds: number[];
  witnessIds: number[];
  visibleLines: string[];
}

export interface AiCommandHistoryEntry extends AiInteractionHistoryBase {
  source: "command";
  target: number;
  targetName: string;
  commandNo: number;
  commandLabel: string;
  outcome: "ok" | "blocked" | "noop";
  visibleEvents: string[];
  aiLines: string[];
}

export interface AiAmbientHistoryEntry extends AiInteractionHistoryBase {
  source: "ambient";
  mode: AmbientInitiativeMode;
  trigger: AmbientInitiativeTrigger;
  initiativeKind: AmbientInitiativeKind;
}

export type AiInteractionHistoryEntry = AiCommandHistoryEntry | AiAmbientHistoryEntry;

export interface AiDebugEntry {
  /** L3 diagnostics only; never a gameplay or save field. */
  narrativePhase?: "evolution" | "situations" | "opening" | "graph" | "validating" | "continuation" | "expression" | "commit";
  timings?: Record<string, number>;
  stateTrace?: unknown;
  relationshipResult?: unknown;
  dialogueActionResult?: unknown;
  requestId: string;
  createdAt: number;
  feature: "command-kojo" | "counter-kojo" | "ai-chat" | "witness-kojo" | "ambient-initiative" | "agent-materialization" | "agent-daytime" | "agent-diary" | "narrative-director";
  target?: number;
  commandNo?: number;
  participants?: number[];
  mode?: AmbientInitiativeMode;
  trigger?: AmbientInitiativeTrigger;
  routeStatus?: AiRouteStatus;
  status: "pending" | "success" | "skipped" | "error" | "cancelled";
  acceptedCount?: number;
  gameDayIndex?: number;
  gameTick?: number;
  lazyTrigger?: "encounter" | "debug";
  providerStarted?: boolean;
  queueWaitMs?: number;
  tokenUsage?: AiTokenUsage;
  experienceBytesDelta?: number;
  saveBytesDelta?: number;
  skipReason?: string;
  durationMs?: number;
  prompt?: string;
  response?: string;
  error?: string;
}

export interface PreparedAiKojoRequest {
  storyGrants?: import("../../../modernization/runtime/story/interaction-progress.js").StoryInteractionGrantV1[];
  storyEvidenceOrigin?: { tick: number; location: string };
  preparationMs?: number;
  relationshipGrant?: import("../../../modernization/runtime/ai-state/relationship.js").RelationshipGrant;
  hookGrant?: import("../../../modernization/runtime/story/dialogue-hook.js").HookGrantV1;
  /** P0 探针（AI-PREPARE-PERF-PLAN.md §4）：本请求准备窗口内的
   * kojo 求值/clone 计数，随 debug entry timings 发布。 */
  resolutionStats?: import("../../../modernization/runtime/kojo/stats.js").KojoResolveStats;
  requestId: string;
  sessionId: string;
  target: number;
  commandNo: number;
  routeStatus: AiRouteStatus;
  presentationMode: AiKojoPresentationMode;
  /** Player-visible non-dialogue facts retained when authored dialogue is
   * replaced successfully. Used only by ephemeral history bookkeeping. */
  visibleEventsOnSuccess: string[];
  historyEntryId: string;
  completion: AiCompletionRequest;
  settings: AiSettings;
  /** Diagnostics classification; ordinary command completion is the default. */
  feature?: "command-kojo" | "counter-kojo" | "ai-chat" | "witness-kojo";
  /** Counter presentation shares the command history entry for context but
   * must not overwrite the command's own history publication. */
  recordHistory?: boolean;
  /** Present only for fully enabled AI chat. The provider may select one; the
   * deterministic runtime still recompiles and validates it before commit. */
  actionOffers?: import("../../../modernization/runtime/agent/action-offers.js").AgentActionOfferV1[];
}

export type SceneAmbientForm = "speech" | "action";

export interface SceneAmbientLine {
  participantId: number;
  form: SceneAmbientForm;
  text: string;
}

export interface SceneAmbientEntry {
  requestId: string;
  trigger: AmbientInitiativeTrigger;
  mode: AmbientInitiativeMode;
  kind: AmbientInitiativeKind;
  participantIds: number[];
  lines: SceneAmbientLine[];
  complete: boolean;
}

export interface SceneAmbientSession {
  location: string;
  sceneEpoch: number;
  entry: SceneAmbientEntry | null;
  requestId: string | null;
  hidden: boolean;
  publishedCount: number;
  locationCooldownUntil: number;
  characterCooldownUntil: Record<number, number>;
}

export interface PreparedSceneAmbientRequest {
  requestId: string;
  sceneEpoch: number;
  opportunity: AmbientInitiativeOpportunity;
  completion: AiCompletionRequest;
  settings: AiSettings;
}

export type AiDialogueEvent = Extract<ObservationEvent, { kind: "DIALOGUE_LINE" }>;
