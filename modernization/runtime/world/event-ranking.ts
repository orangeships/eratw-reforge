import type { GameState, AcceptedEventRanking } from "../state/game-state.js";

export type EventChannel = "daily" | "outing-departure" | "outing-return" | "banquet";

export interface EventCandidate {
  id: number;
  name: string;
  source: "upstream" | "modern";
  probability?: string;
  weight?: number;
  characterIds?: number[];
  locationIds?: string[];
  safety: readonly ("deterministic" | "authored" | "fail-closed")[];
}

export interface EventOpportunitySet {
  setId: string;
  contextHash: string;
  channel: EventChannel;
  dayIndex: number;
  contextKey: string;
  candidates: readonly EventCandidate[];
}

export interface EventRankingProposal {
  setId: string;
  contextHash: string;
  rankedCandidateIds: number[];
}

export interface EventRankingAcceptance {
  accepted: boolean;
  state: GameState;
  diagnostics: string[];
  ranking?: AcceptedEventRanking;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Browser-safe stable context hash (no crypto/network dependency). */
export function eventContextHash(channel: EventChannel, dayIndex: number, contextKey: string, candidates: readonly EventCandidate[]): string {
  const text = canonical({ channel, dayIndex, contextKey, candidates });
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function compileEventOpportunitySet(options: {
  channel: EventChannel;
  dayIndex: number;
  contextKey: string;
  candidates: readonly EventCandidate[];
  setId?: string;
}): EventOpportunitySet {
  const candidates = options.candidates.map((candidate) => {
    const safe: EventCandidate = {
      id: Math.trunc(candidate.id),
      name: candidate.name,
      source: candidate.source,
      safety: [...candidate.safety],
    };
    if (candidate.probability !== undefined) safe.probability = candidate.probability;
    if (candidate.weight !== undefined) safe.weight = candidate.weight;
    if (candidate.characterIds) safe.characterIds = [...candidate.characterIds];
    if (candidate.locationIds) safe.locationIds = [...candidate.locationIds];
    return safe;
  });
  const contextHash = eventContextHash(options.channel, options.dayIndex, options.contextKey, candidates);
  return {
    setId: options.setId ?? `${options.channel}:${options.dayIndex}:${options.contextKey}`,
    contextHash,
    channel: options.channel,
    dayIndex: options.dayIndex,
    contextKey: options.contextKey,
    candidates,
  };
}

export function acceptEventRanking(
  state: GameState,
  opportunity: EventOpportunitySet,
  proposal: EventRankingProposal,
): EventRankingAcceptance {
  const diagnostics: string[] = [];
  const ids = opportunity.candidates.map((candidate) => candidate.id);
  const ranked = proposal.rankedCandidateIds;
  if (proposal.setId !== opportunity.setId) diagnostics.push("ranking set is unknown or stale");
  if (proposal.contextHash !== opportunity.contextHash) diagnostics.push("ranking context hash mismatch");
  if (ranked.length !== ids.length) diagnostics.push("ranking must include every candidate exactly once");
  if (new Set(ranked).size !== ranked.length) diagnostics.push("ranking contains duplicate candidate ids");
  if (ranked.some((id) => !ids.includes(id))) diagnostics.push("ranking contains an unknown candidate id");
  if (diagnostics.length > 0) return { accepted: false, state, diagnostics };
  const ranking: AcceptedEventRanking = {
    setId: opportunity.setId,
    contextHash: opportunity.contextHash,
    channel: opportunity.channel,
    dayIndex: opportunity.dayIndex,
    candidateIds: [...ranked],
    acceptedAtTick: state.time.tickValue,
  };
  const next = state.acceptedEventRankings ? [...state.acceptedEventRankings] : [];
  next.push(ranking);
  state.acceptedEventRankings = next;
  return { accepted: true, state, diagnostics, ranking };
}

export function consumeEventRanking(state: GameState, opportunity: EventOpportunitySet): number[] | undefined {
  const index = state.acceptedEventRankings?.findIndex((ranking) =>
    ranking.setId === opportunity.setId && ranking.contextHash === opportunity.contextHash && ranking.dayIndex === opportunity.dayIndex,
  ) ?? -1;
  if (index < 0) return undefined;
  const ranking = state.acceptedEventRankings![index]!;
  state.acceptedEventRankings!.splice(index, 1);
  return [...ranking.candidateIds];
}
