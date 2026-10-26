import type {
  AgentCognitiveState,
  AgentMindItem,
  AgentMindItemUpdate,
  AgentMindStateV1,
  AgentMindUpdatesV1,
  AgentPendingEpisode,
  AgentPendingEpisodeChoice,
  AgentPendingEpisodeLine,
  AgentRuntimeState,
  AgentSocialThread,
  AgentSocialThreadKind,
  AgentSocialThreadUpdate,
} from "./types.js";

/** Storage and prompt limits for the L2 subjective state. */
export const AGENT_MIND_CAPS = {
  beliefs: 4,
  goals: 3,
  threads: 6,
  evidenceIds: 8,
  pendingEpisodes: 12,
  episodeLines: 8,
  episodeChars: 1200,
  episodeChoices: 4,
  choiceLines: 4,
  shortText: 180,
  threadText: 300,
  relationshipText: 300,
  choiceLabel: 120,
  lineText: 300,
} as const;

export const AGENT_MIND_VERSION = 1 as const;

function boundedText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/\0/g, "").trim();
  return text ? text.slice(0, max) : undefined;
}

function finiteTick(value: unknown, fallback = 0): number {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : fallback;
}

function boundedEvidence(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map((entry) => boundedText(entry, 160))
    .filter((entry): entry is string => entry !== undefined))]
    .slice(0, AGENT_MIND_CAPS.evidenceIds);
}

function topic(value: unknown): AgentMindItem["topic"] | undefined {
  return value === "self" || value === "player" || value === "relationship" ? value : undefined;
}

function threadKind(value: unknown): AgentSocialThreadKind | undefined {
  return value === "promise" || value === "conflict" || value === "secret" || value === "question"
    ? value
    : undefined;
}

function normalizeMindItem(value: unknown, fallbackTopic: AgentMindItem["topic"] = "relationship"): AgentMindItem | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const id = boundedText(raw.id, 160);
  const text = boundedText(raw.text, AGENT_MIND_CAPS.shortText);
  if (!id || !text) return undefined;
  const itemTopic = topic(raw.topic) ?? fallbackTopic;
  const status = raw.status === "resolved" ? "resolved" : "active";
  return {
    id,
    topic: itemTopic,
    text,
    createdTick: finiteTick(raw.createdTick),
    updatedTick: finiteTick(raw.updatedTick, finiteTick(raw.createdTick)),
    evidenceIds: boundedEvidence(raw.evidenceIds),
    status,
  };
}

function normalizeThread(value: unknown): AgentSocialThread | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const id = boundedText(raw.id, 160);
  const text = boundedText(raw.text, AGENT_MIND_CAPS.threadText);
  const kind = threadKind(raw.kind);
  if (!id || !text || !kind) return undefined;
  return {
    id,
    kind,
    text,
    createdTick: finiteTick(raw.createdTick),
    updatedTick: finiteTick(raw.updatedTick, finiteTick(raw.createdTick)),
    evidenceIds: boundedEvidence(raw.evidenceIds),
    status: raw.status === "resolved" ? "resolved" : "open",
  };
}

export function createAgentMindState(updatedTick = 0): AgentMindStateV1 {
  return {
    version: AGENT_MIND_VERSION,
    revision: 0,
    updatedTick: finiteTick(updatedTick),
    relationshipToPlayer: "",
    currentTendency: "",
    beliefs: [],
    goals: [],
    threads: [],
  };
}

/** Clean persisted or model-provided mind data without ever throwing. */
export function normalizeAgentMindState(value: unknown): AgentMindStateV1 {
  const fallback = createAgentMindState();
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const raw = value as Record<string, unknown>;
  const beliefs = Array.isArray(raw.beliefs)
    ? raw.beliefs.map((entry) => normalizeMindItem(entry)).filter((entry): entry is AgentMindItem => !!entry)
    : [];
  const goals = Array.isArray(raw.goals)
    ? raw.goals.map((entry) => normalizeMindItem(entry)).filter((entry): entry is AgentMindItem => !!entry)
    : [];
  const threads = Array.isArray(raw.threads)
    ? raw.threads.map(normalizeThread).filter((entry): entry is AgentSocialThread => !!entry)
    : [];
  const sortRecent = <T extends { updatedTick: number; id: string }>(entries: T[], limit: number): T[] => {
    // A hand-edited save can contain duplicate ids. Keep the newest copy so
    // a later model update can never address two projects at once.
    const unique = new Map<string, T>();
    for (const entry of entries) {
      const previous = unique.get(entry.id);
      if (!previous || entry.updatedTick >= previous.updatedTick) unique.set(entry.id, entry);
    }
    return [...unique.values()]
      .sort((left, right) => left.updatedTick - right.updatedTick || left.id.localeCompare(right.id))
      .slice(-limit);
  };
  const rawRevision = Number.isFinite(raw.revision) ? Math.trunc(Number(raw.revision)) : 0;
  return {
    version: AGENT_MIND_VERSION,
    revision: Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, rawRevision)),
    updatedTick: finiteTick(raw.updatedTick),
    relationshipToPlayer: boundedText(raw.relationshipToPlayer, AGENT_MIND_CAPS.relationshipText) ?? "",
    currentTendency: boundedText(raw.currentTendency, AGENT_MIND_CAPS.relationshipText) ?? "",
    beliefs: sortRecent(beliefs, AGENT_MIND_CAPS.beliefs),
    goals: sortRecent(goals, AGENT_MIND_CAPS.goals),
    threads: sortRecent(threads, AGENT_MIND_CAPS.threads),
  };
}

function normalizeEpisodeLine(value: unknown): AgentPendingEpisodeLine | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const text = boundedText(raw.text, AGENT_MIND_CAPS.lineText);
  if (!text || (raw.speaker !== "player" && raw.speaker !== "character")) return undefined;
  return { speaker: raw.speaker, text };
}

function normalizeChoice(value: unknown): AgentPendingEpisodeChoice | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const label = boundedText(raw.label, AGENT_MIND_CAPS.choiceLabel);
  if (!label || !Array.isArray(raw.lines)) return undefined;
  const lines = raw.lines
    .map((line) => boundedText(line, AGENT_MIND_CAPS.lineText))
    .filter((line): line is string => line !== undefined)
    .slice(0, AGENT_MIND_CAPS.choiceLines);
  return { label, lines };
}

export function normalizeAgentPendingEpisodes(value: unknown): AgentPendingEpisode[] {
  if (!Array.isArray(value)) return [];
  const episodes: AgentPendingEpisode[] = [];
  const ids = new Set<string>();
  const sessionIds = new Set<string>();
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const raw = candidate as Record<string, unknown>;
    const id = boundedText(raw.id, 180);
    const sessionId = boundedText(raw.sessionId, 180);
    const charaNum = Number(raw.charaNum);
    const dayIndex = finiteTick(raw.dayIndex);
    if (!id || !sessionId || ids.has(id) || sessionIds.has(sessionId) || !Number.isSafeInteger(charaNum) || charaNum <= 0) continue;
    if (!Array.isArray(raw.lines)) continue;
    const lines = raw.lines
      .map(normalizeEpisodeLine)
      .filter((line): line is AgentPendingEpisodeLine => !!line)
      .slice(0, AGENT_MIND_CAPS.episodeLines);
    if (lines.length === 0) continue;
    let total = 0;
    const boundedLines: AgentPendingEpisodeLine[] = [];
    for (const line of lines) {
      if (total >= AGENT_MIND_CAPS.episodeChars) break;
      const text = line.text.slice(0, Math.min(AGENT_MIND_CAPS.lineText, AGENT_MIND_CAPS.episodeChars - total));
      if (!text) continue;
      boundedLines.push({ speaker: line.speaker, text });
      total += text.length;
    }
    if (boundedLines.length < 2
      || !boundedLines.some((line) => line.speaker === "player")
      || !boundedLines.some((line) => line.speaker === "character")) continue;
    let choiceChars = total;
    const choices = Array.isArray(raw.choices)
      ? raw.choices.map(normalizeChoice).filter((choice): choice is AgentPendingEpisodeChoice => !!choice).slice(0, AGENT_MIND_CAPS.episodeChoices)
        .map((choice) => ({
          label: choice.label,
          lines: choice.lines.map((line) => {
            if (choiceChars >= AGENT_MIND_CAPS.episodeChars) return "";
            const clipped = line.slice(0, Math.min(AGENT_MIND_CAPS.lineText, AGENT_MIND_CAPS.episodeChars - choiceChars));
            choiceChars += clipped.length;
            return clipped;
          }).filter(Boolean),
        }))
        .filter((choice) => choice.lines.length > 0)
      : [];
    ids.add(id);
    sessionIds.add(sessionId);
    episodes.push({
      id,
      charaNum,
      sessionId,
      ...(typeof raw.requestId === "string" ? { requestId: raw.requestId.slice(0, 180) } : {}),
      dayIndex,
      createdTick: finiteTick(raw.createdTick),
      updatedTick: finiteTick(raw.updatedTick, finiteTick(raw.createdTick)),
      lines: boundedLines,
      choices,
      heat: Math.max(0, Math.min(20, Number.isFinite(raw.heat) ? Number(raw.heat) : 0)),
    });
  }
  return episodes
    .sort((left, right) => left.updatedTick - right.updatedTick || left.id.localeCompare(right.id))
    .slice(-AGENT_MIND_CAPS.pendingEpisodes);
}

function stableEpisodeToken(value: string): string {
  const token = value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 72);
  return token || "session";
}

function evidenceIsValid(ids: readonly string[] | undefined, known: ReadonlySet<string>): boolean {
  return !!ids && ids.length > 0 && ids.length <= AGENT_MIND_CAPS.evidenceIds
    && ids.every((id) => typeof id === "string" && known.has(id));
}

function nextMindId(prefix: string, charaNum: number, dayIndex: number, mind: AgentMindStateV1, extraIds: readonly string[] = []): string {
  const used = new Set([
    ...mind.beliefs.map((item) => item.id),
    ...mind.goals.map((item) => item.id),
    ...mind.threads.map((item) => item.id),
    ...extraIds,
  ]);
  let sequence = 0;
  let id = `mind-${prefix}-${charaNum}-${dayIndex}-${mind.revision}-${sequence}`;
  while (used.has(id)) {
    sequence += 1;
    id = `mind-${prefix}-${charaNum}-${dayIndex}-${mind.revision}-${sequence}`;
  }
  return id;
}

function applyItemUpdates(
  current: AgentMindStateV1,
  entries: readonly AgentMindItem[],
  updates: readonly AgentMindItemUpdate[] | undefined,
  options: { collection: "beliefs" | "goals"; charaNum: number; dayIndex: number; tick: number; knownEvidence: ReadonlySet<string>; diagnostics: string[] },
): AgentMindItem[] {
  const result = [...entries];
  for (const update of (updates ?? []).slice(0, options.collection === "beliefs" ? 4 : 3)) {
    const evidence = update.evidenceIds;
    if (!evidenceIsValid(evidence, options.knownEvidence)) {
      options.diagnostics.push(`${options.collection} update dropped: unknown or missing evidence`);
      continue;
    }
    if (update.action === "add") {
      const text = boundedText(update.text, AGENT_MIND_CAPS.shortText);
      const updateTopic = topic(update.topic);
      if (!text || !updateTopic) {
        options.diagnostics.push(`${options.collection} add dropped: invalid fields`);
        continue;
      }
      result.push({
        id: nextMindId(options.collection === "beliefs" ? "belief" : "goal", options.charaNum, options.dayIndex, current, result.map((item) => item.id)),
        topic: updateTopic,
        text,
        createdTick: options.tick,
        updatedTick: options.tick,
        evidenceIds: [...(evidence ?? [])],
        status: "active",
      });
      continue;
    }
    const index = result.findIndex((item) => item.id === update.id);
    if (index < 0) {
      options.diagnostics.push(`${options.collection} ${update.action} dropped: unknown id`);
      continue;
    }
    if (update.action === "resolve") {
      result[index] = { ...result[index]!, evidenceIds: [...(evidence ?? [])], updatedTick: options.tick, status: "resolved" };
      continue;
    }
    const text = boundedText(update.text, AGENT_MIND_CAPS.shortText);
    const updateTopic = topic(update.topic);
    if (!text || !updateTopic) {
      options.diagnostics.push(`${options.collection} update dropped: invalid fields`);
      continue;
    }
    result[index] = { ...result[index]!, topic: updateTopic, text, evidenceIds: [...(evidence ?? [])], updatedTick: options.tick, status: "active" };
  }
  return result;
}

function applyThreadUpdates(
  current: AgentMindStateV1,
  entries: readonly AgentSocialThread[],
  updates: readonly AgentSocialThreadUpdate[] | undefined,
  options: { charaNum: number; dayIndex: number; tick: number; knownEvidence: ReadonlySet<string>; diagnostics: string[] },
): AgentSocialThread[] {
  const result = [...entries];
  for (const update of (updates ?? []).slice(0, AGENT_MIND_CAPS.threads)) {
    if (!evidenceIsValid(update.evidenceIds, options.knownEvidence)) {
      options.diagnostics.push("threads update dropped: unknown or missing evidence");
      continue;
    }
    if (update.action === "add") {
      const text = boundedText(update.text, AGENT_MIND_CAPS.threadText);
      const kind = threadKind(update.kind);
      if (!text || !kind) {
        options.diagnostics.push("thread add dropped: invalid fields");
        continue;
      }
      result.push({
        id: nextMindId("thread", options.charaNum, options.dayIndex, current, result.map((item) => item.id)),
        kind,
        text,
        createdTick: options.tick,
        updatedTick: options.tick,
        evidenceIds: [...update.evidenceIds!],
        status: "open",
      });
      continue;
    }
    const index = result.findIndex((item) => item.id === update.id);
    if (index < 0) {
      options.diagnostics.push(`thread ${update.action} dropped: unknown id`);
      continue;
    }
    if (update.action === "resolve") {
      result[index] = { ...result[index]!, evidenceIds: [...update.evidenceIds!], updatedTick: options.tick, status: "resolved" };
      continue;
    }
    const text = boundedText(update.text, AGENT_MIND_CAPS.threadText);
    const kind = threadKind(update.kind);
    if (!text || !kind) {
      options.diagnostics.push("thread update dropped: invalid fields");
      continue;
    }
    result[index] = { ...result[index]!, kind, text, evidenceIds: [...update.evidenceIds!], updatedTick: options.tick, status: "open" };
  }
  return result;
}

export interface ApplyMindUpdatesResult {
  mind: AgentMindStateV1;
  diagnostics: string[];
}

/** Apply only evidence-backed, bounded proposals; unknown model fields never reach state. */
export function applyAgentMindUpdates(
  current: AgentMindStateV1,
  updates: AgentMindUpdatesV1 | undefined,
  context: { charaNum: number; dayIndex: number; tick: number; knownEvidenceIds: ReadonlySet<string> },
): ApplyMindUpdatesResult {
  const base = normalizeAgentMindState(current);
  const diagnostics: string[] = [];
  let changed = false;
  let relationshipToPlayer = base.relationshipToPlayer;
  let currentTendency = base.currentTendency;
  if (updates) {
    const relationship = boundedText(updates.relationshipToPlayer, AGENT_MIND_CAPS.relationshipText);
    if (relationship !== undefined && relationship !== relationshipToPlayer) {
      relationshipToPlayer = relationship;
      changed = true;
    }
    const tendency = boundedText(updates.currentTendency, AGENT_MIND_CAPS.relationshipText);
    if (tendency !== undefined && tendency !== currentTendency) {
      currentTendency = tendency;
      changed = true;
    }
  }
  const beliefs = applyItemUpdates(base, base.beliefs, updates?.beliefs, {
    collection: "beliefs", charaNum: context.charaNum, dayIndex: context.dayIndex, tick: context.tick,
    knownEvidence: context.knownEvidenceIds, diagnostics,
  });
  const goals = applyItemUpdates(base, base.goals, updates?.goals, {
    collection: "goals", charaNum: context.charaNum, dayIndex: context.dayIndex, tick: context.tick,
    knownEvidence: context.knownEvidenceIds, diagnostics,
  });
  const threads = applyThreadUpdates(base, base.threads, updates?.threads, {
    charaNum: context.charaNum, dayIndex: context.dayIndex, tick: context.tick,
    knownEvidence: context.knownEvidenceIds, diagnostics,
  });
  if (beliefs.length !== base.beliefs.length || goals.length !== base.goals.length || threads.length !== base.threads.length
    || beliefs.some((item, index) => item !== base.beliefs[index])
    || goals.some((item, index) => item !== base.goals[index])
    || threads.some((item, index) => item !== base.threads[index])) changed = true;
  if (!changed) return { mind: base, diagnostics };
  return {
    mind: normalizeAgentMindState({
      ...base,
      revision: base.revision + 1,
      updatedTick: context.tick,
      relationshipToPlayer,
      currentTendency,
      beliefs,
      goals,
      threads,
    }),
    diagnostics,
  };
}

function emptyCognition(): AgentCognitiveState {
  return {
    observations: [], memories: [], reflections: [], goals: [],
    mind: createAgentMindState(), pendingEpisodes: [],
    daytimeSync: {
      version: 1,
      pendingObservationIds: [],
      consumedObservationIds: [],
      revision: 0,
      lastProjectedTick: 0,
    },
    diaries: [], lastUpdatedTick: 0,
  };
}

export interface AppendPlayerAiChatInput {
  charaNum: number;
  sessionId: string;
  requestId?: string;
  dayIndex: number;
  tick: number;
  semantic: string;
  responseLines: readonly string[];
  heat?: number;
}

function episodeTextLines(input: AppendPlayerAiChatInput): AgentPendingEpisodeLine[] {
  const raw: AgentPendingEpisodeLine[] = [
    { speaker: "player", text: input.semantic },
    ...input.responseLines.map((text) => ({ speaker: "character" as const, text })),
  ];
  let total = 0;
  const lines: AgentPendingEpisodeLine[] = [];
  for (const line of raw.slice(0, AGENT_MIND_CAPS.episodeLines)) {
    const text = boundedText(line.text, AGENT_MIND_CAPS.lineText);
    if (!text || total >= AGENT_MIND_CAPS.episodeChars) continue;
    const clipped = text.slice(0, Math.min(AGENT_MIND_CAPS.lineText, AGENT_MIND_CAPS.episodeChars - total));
    if (!clipped) continue;
    lines.push({ speaker: line.speaker, text: clipped });
    total += clipped.length;
  }
  return lines;
}

/** Append a successful final free-chat response to the character's sidecar. */
export function appendPlayerAiChatEpisode(
  runtime: AgentRuntimeState,
  input: AppendPlayerAiChatInput,
): boolean {
  if (!runtime.settings.masterEnabled || input.charaNum <= 0 || !input.sessionId) return false;
  const lines = episodeTextLines(input);
  if (lines.length < 2) return false;
  const cognition = runtime.cognitions[input.charaNum] ?? (runtime.cognitions[input.charaNum] = emptyCognition());
  cognition.mind ??= createAgentMindState();
  cognition.pendingEpisodes ??= [];
  if (cognition.pendingEpisodes.some((episode) => episode.sessionId === input.sessionId
    || (input.requestId !== undefined && episode.requestId === input.requestId))) return false;
  const existingIds = new Set(cognition.pendingEpisodes.map((episode) => episode.id));
  const prefix = `episode-${input.charaNum}-${Math.max(0, Math.trunc(input.dayIndex))}-${Math.max(0, Math.trunc(input.tick))}-${stableEpisodeToken(input.sessionId)}`;
  let sequence = 0;
  let id = prefix;
  while (existingIds.has(id)) id = `${prefix}-${++sequence}`;
  cognition.pendingEpisodes.push({
    id,
    charaNum: input.charaNum,
    sessionId: input.sessionId,
    ...(input.requestId ? { requestId: input.requestId } : {}),
    dayIndex: Math.max(0, Math.trunc(input.dayIndex)),
    createdTick: Math.max(0, Math.trunc(input.tick)),
    updatedTick: Math.max(0, Math.trunc(input.tick)),
    lines,
    choices: [],
    heat: Math.max(0, Math.min(20, input.heat ?? 3)),
  });
  cognition.pendingEpisodes = normalizeAgentPendingEpisodes(cognition.pendingEpisodes);
  return true;
}

/** Record a picked AI branch in the same pending episode, if it still exists. */
export function appendAiChatBranch(
  runtime: AgentRuntimeState,
  input: { charaNum: number; sessionId: string; tick: number; label: string; lines: readonly string[] },
): boolean {
  const cognition = runtime.cognitions[input.charaNum];
  const episode = cognition?.pendingEpisodes?.find((candidate) => candidate.sessionId === input.sessionId);
  if (!episode) return false;
  const label = boundedText(input.label, AGENT_MIND_CAPS.choiceLabel);
  if (!label || episode.choices.some((choice) => choice.label === label)) return false;
  const branchLines = input.lines
    .map((line) => boundedText(line, AGENT_MIND_CAPS.lineText))
    .filter((line): line is string => line !== undefined)
    .slice(0, AGENT_MIND_CAPS.choiceLines);
  if (branchLines.length === 0) return false;
  episode.choices = [...episode.choices, { label, lines: branchLines }].slice(-AGENT_MIND_CAPS.episodeChoices);
  const selectionLine: AgentPendingEpisodeLine = { speaker: "player", text: `选择：${label}` };
  const additions: AgentPendingEpisodeLine[] = [selectionLine, ...branchLines.map((text) => ({ speaker: "character" as const, text }))];
  let total = episode.lines.reduce((sum, line) => sum + line.text.length, 0);
  for (const line of additions) {
    if (episode.lines.length >= AGENT_MIND_CAPS.episodeLines || total >= AGENT_MIND_CAPS.episodeChars) break;
    const text = line.text.slice(0, Math.min(AGENT_MIND_CAPS.lineText, AGENT_MIND_CAPS.episodeChars - total));
    if (!text) continue;
    episode.lines.push({ speaker: line.speaker, text });
    total += text.length;
  }
  episode.updatedTick = Math.max(0, Math.trunc(input.tick));
  episode.heat = Math.min(20, episode.heat + 1);
  cognition!.pendingEpisodes = normalizeAgentPendingEpisodes(cognition!.pendingEpisodes);
  return true;
}

export function consumePendingEpisodes(cognition: AgentCognitiveState, observationDayIndex: number, sourceIds?: readonly string[]): string[] {
  const pending = cognition.pendingEpisodes ?? [];
  const selected = sourceIds ? new Set(sourceIds) : null;
  const consumed = pending.filter((episode) => episode.dayIndex <= observationDayIndex && (!selected || selected.has(episode.id))).map((episode) => episode.id);
  const consumedIds = new Set(consumed);
  cognition.pendingEpisodes = pending.filter((episode) => !consumedIds.has(episode.id));
  return consumed;
}
