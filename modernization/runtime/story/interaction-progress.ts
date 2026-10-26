import { acceptExperience, ACCEPTED_EXPERIENCE_SCHEMA_VERSION, isExperienceVisibleTo, type AcceptedExperience, type StoryInteractionExperiencePayload } from "../experience.js";
import type { GameState } from "../state/game-state.js";
import { CFLAG_ID, FLAG_ID } from "../state/settlement.js";
import type { StoryArcInstanceV1 } from "./types.js";
import { ensureArcMaintenance } from "./arc-maintenance.js";
import { cancelNarrativeHooks } from "./dialogue-hook.js";

const KINDS = ["proposal", "accept", "reject", "withdraw", "request", "report", "claim"] as const;
type ContributionKind = typeof KINDS[number];
export interface StoryInteractionGrantV1 { arcId: string; revision: number }
export interface StoryInteractionSignalV1 extends StoryInteractionGrantV1 {
  kind: ContributionKind; summary: string; lineIds: string[];
}
export interface StoryInteractionIssueV1 {
  id: string; description: string; status: "open" | "changed" | "settled" | "abandoned";
  evidenceIds: string[];
}
export interface StoryInteractionStateV1 {
  version: 1; revision: number;
  evidenceIds: string[]; evaluatedEvidenceIds: string[];
  signals: Array<{ evidenceId: string; kind: ContributionKind; summary: string; lineIds: string[] }>;
  issues: StoryInteractionIssueV1[];
  /** Suspends only this Arc's unexecuted frontier, not the dialogue being read. */
  pending: boolean;
  assessmentAttempt?: { revision: number; atTick: number };
  lastAssessment?: { summary: string; evidenceIds: string[]; frontier: "keep" | "replan" | "conclude"; atTick: number };
}
export interface StoryInteractionRequestV1 {
  revision: number;
  evidence: AcceptedExperience[];
  evidenceScope?: string;
  signals: StoryInteractionStateV1["signals"];
  issues: StoryInteractionIssueV1[];
  pending: boolean;
  frontier?: { programId: string; status: string; cursorNodeId: string | null; unexecutedNodes: Array<{ id: string; kind: string }> };
}
export interface StoryInteractionUpdateV1 {
  revision: number; evidenceIds: string[];
  issues: StoryInteractionIssueV1[];
  frontier: "keep" | "replan" | "conclude";
  summary: string;
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max = 160): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const exact = (v: Record<string, unknown>, keys: string[], optional: string[] = []) => keys.every(k => k in v) && Object.keys(v).every(k => [...keys, ...optional].includes(k));
const ids = (v: unknown, max = 24): v is string[] => Array.isArray(v) && v.length <= max && v.every(id => text(id)) && new Set(v).size === v.length;
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const issue = (v: unknown): v is StoryInteractionIssueV1 => object(v) && exact(v, ["id", "description", "status", "evidenceIds"])
  && text(v.id, 80) && text(v.description, 300) && ["open", "changed", "settled", "abandoned"].includes(String(v.status)) && ids(v.evidenceIds) && v.evidenceIds.length > 0;

export function isStoryInteractionState(value: unknown): value is StoryInteractionStateV1 {
  if (!object(value) || !exact(value, ["version", "revision", "evidenceIds", "evaluatedEvidenceIds", "signals", "issues", "pending"], ["lastAssessment", "assessmentAttempt"])
    || value.version !== 1 || !integer(value.revision) || !ids(value.evidenceIds) || !ids(value.evaluatedEvidenceIds)
    || value.evaluatedEvidenceIds.some(id => !(value.evidenceIds as string[]).includes(id))
    || !Array.isArray(value.signals) || value.signals.length > 24 || value.signals.some(s => !object(s)
      || !exact(s, ["evidenceId", "kind", "summary", "lineIds"]) || !(value.evidenceIds as string[]).includes(String(s.evidenceId))
      || !KINDS.includes(s.kind as ContributionKind) || !text(s.summary, 300) || !ids(s.lineIds, 8) || !s.lineIds.length)
    || !Array.isArray(value.issues) || value.issues.length > 8 || !value.issues.every(issue)
    || new Set(value.issues.map(i => i.id)).size !== value.issues.length || typeof value.pending !== "boolean") return false;
  if (value.assessmentAttempt !== undefined && (!object(value.assessmentAttempt) || !exact(value.assessmentAttempt, ["revision", "atTick"])
    || !integer(value.assessmentAttempt.revision) || !integer(value.assessmentAttempt.atTick))) return false;
  const a = value.lastAssessment;
  return a === undefined || object(a) && exact(a, ["summary", "evidenceIds", "frontier", "atTick"])
    && text(a.summary, 300) && ids(a.evidenceIds) && ["keep", "replan", "conclude"].includes(String(a.frontier)) && integer(a.atTick);
}

function interactionOf(arc: StoryArcInstanceV1): StoryInteractionStateV1 {
  const maintenance = ensureArcMaintenance(arc);
  maintenance.interaction ??= { version: 1, revision: 0, evidenceIds: [], evaluatedEvidenceIds: [], signals: [], issues: [], pending: false };
  return maintenance.interaction;
}
export function storyInteractionGrants(state: Readonly<GameState>, speakerId: number): StoryInteractionGrantV1[] {
  const slot = state.charas[speakerId];
  if (!slot || state.flagStore?.[FLAG_ID.時間停止] || slot.state.CFLAG[CFLAG_ID.睡眠]
    || slot.state.CFLAG[CFLAG_ID.诶嘿嘿] || state.master.state.CFLAG[CFLAG_ID.睡眠] || state.master.state.CFLAG[CFLAG_ID.诶嘿嘿]) return [];
  return (state.storyArcs ?? []).filter(a => a.status === "active" && state.time.tickValue <= a.deadlineTick
    && a.templateId === "free-story" && a.participantRoles.some(r => r.characterId === speakerId))
    .slice(0, 3).map(a => ({ arcId: a.id, revision: a.maintenance?.interaction?.revision ?? 0 }));
}
export function hasPendingStoryInteraction(arc: Readonly<StoryArcInstanceV1>): boolean {
  return arc.maintenance?.interaction?.pending === true;
}
/** A progress request may run while its own foreground is suspended, never another story's. */
export function canAssessStoryInteractions(state: Readonly<GameState>, arcId?: string): boolean {
  const p = state.storyProgram;
  return !p || !["active", "awaiting-player", "paused"].includes(p.status)
    || p.version === 2 && (arcId === undefined || p.arcId === arcId) && !!state.storyArcs?.some(a => a.id === p.arcId && hasPendingStoryInteraction(a));
}

export function compileStoryInteractionRequest(state: Readonly<GameState>, arc: Readonly<StoryArcInstanceV1>): StoryInteractionRequestV1 | undefined {
  const i = arc.maintenance?.interaction;
  if (!i) return undefined;
  const unread = (state.acceptedExperiences ?? []).filter(e => i.evidenceIds.includes(e.id) && !i.evaluatedEvidenceIds.includes(e.id));
  const signalled = new Set(i.signals.map(s => s.evidenceId));
  // Reuse the actual Experience records; only bound the prompt projection.
  // Prioritize material contributions, then recent unsignalled context.
  const selected = [...unread.filter(e => signalled.has(e.id)), ...unread.filter(e => !signalled.has(e.id)).reverse()].slice(0, 6);
  const evidence = selected.map(e => {
    const copy = structuredClone(e);
    if (copy.kind === "story-interaction" && "lines" in copy.payload) {
      copy.payload.truncated ||= copy.payload.lines.some(line => line.text.length > 200);
      copy.payload.lines = copy.payload.lines.map(line => ({ ...line, text: line.text.slice(0, 200) }));
    }
    return copy;
  });
  if (!evidence.length) return undefined;
  const p = state.storyProgram?.version === 2 && state.storyProgram.arcId === arc.id ? state.storyProgram : undefined;
  return { revision: i.revision, evidence: structuredClone(evidence), signals: i.signals.filter(s => evidence.some(e => e.id === s.evidenceId)), issues: structuredClone(i.issues), pending: i.pending,
    evidenceScope: "原始发布记录的有界片段；每条最多200字。截断、转述和主张均不证明行动完成；信息不足时保持未决，不补造后半句。",
    ...(p ? { frontier: { programId: p.id, status: p.status, cursorNodeId: p.cursorNodeId,
      unexecutedNodes: p.nodes.filter(n => !p.executedNodeIds.includes(n.id)).map(n => ({ id: n.id, kind: n.kind })) } } : {}) };
}

/** A failed/stale assessment is still a paid attempt. Persist its existing daily budget. */
export function reserveStoryInteractionAssessment(state: GameState, arc: StoryArcInstanceV1): void {
  const i = interactionOf(arc);
  if (!i.pending) return;
  i.assessmentAttempt = { revision: i.revision, atTick: state.time.tickValue };
  const maintenance = ensureArcMaintenance(arc);
  maintenance.evolution ??= {};
  const e = maintenance.evolution;
  e.attemptsToday = e.attemptsDayIndex === state.time.dayIndex ? (e.attemptsToday ?? 0) + 1 : 1;
  e.attemptsDayIndex = state.time.dayIndex;
}

/** Called only after final owner-bound publication. Proposals never create world actions. */
export function recordStoryInteraction(state: GameState, input: {
  id: string; sessionId: string; speakerId: number; commandNo: number; playerText?: string;
  lines: readonly { text: string }[]; grants?: readonly StoryInteractionGrantV1[]; signals?: unknown; runtime?: boolean; choice?: boolean; world?: boolean;
  origin?: { tick: number; location: string };
}): boolean {
  const grants = input.grants ?? storyInteractionGrants(state, input.speakerId);
  const arcs = grants.flatMap(g => {
    const arc = state.storyArcs?.find(a => a.id === g.arcId && a.status === "active" && a.templateId === "free-story"
      && state.time.tickValue <= a.deadlineTick && a.participantRoles.some(r => r.characterId === input.speakerId));
    return arc ? [{ arc, grant: g }] : [];
  });
  if (!arcs.length || !text(input.id) || !text(input.sessionId) || !state.charas[input.speakerId] || !integer(input.commandNo)) return false;
  const origin = input.origin ?? { tick: state.time.tickValue, location: state.master.location };
  if (!integer(origin.tick) || origin.tick > state.time.tickValue || !text(origin.location)) return false;
  const suppliedSignals = Array.isArray(input.signals) && input.signals.length <= 3 ? input.signals : [];
  const referenced = suppliedSignals.flatMap((s: unknown) => object(s) && Array.isArray(s.lineIds) && s.lineIds.length <= 8
    ? s.lineIds.flatMap((id: unknown) => typeof id === "string" && /^reply:\d+$/.test(id) ? [Number(id.slice(6))] : []) : []);
  const indices = [...new Set([...referenced.filter(n => n >= 0 && n < input.lines.length), ...input.lines.map((_, index) => index)])].slice(0, 8).sort((a, b) => a - b);
  const lines: StoryInteractionExperiencePayload["lines"] = [
    ...(input.playerText?.trim() ? [{ id: "player:0", speaker: "player" as const, text: input.playerText.trim().slice(0, 600) }] : []),
    ...indices.map(index => ({ id: `reply:${index}`, speaker: input.runtime ? "runtime" as const : "character" as const, text: input.lines[index]!.text.trim().slice(0, 600) })).filter(l => l.text),
  ];
  if (!lines.length) return false;
  const id = `interaction:${input.id}`;
  if (id.length > 160) return false;
  const prior = state.acceptedExperiences?.find(e => e.id === id);
  const payload: StoryInteractionExperiencePayload = { summary: `与${state.charas[input.speakerId]!.callName ?? input.speakerId}进行了一次${input.runtime ? "互动" : "交谈"}。`, source: input.world ? "world" : input.choice ? "choice" : input.runtime ? "command" : "dialogue", sessionId: input.sessionId,
    commandNo: input.commandNo, speakerId: input.speakerId, lines,
    truncated: (input.playerText?.trim().length ?? 0) > 600 || indices.length < input.lines.length || indices.some(n => input.lines[n]!.text.trim().length > 600) };
  if (prior && (prior.kind !== "story-interaction" || JSON.stringify(prior.payload) !== JSON.stringify(payload))) return false;
  if (!prior) {
    const result = acceptExperience(state.acceptedExperiences ?? [], { id, schemaVersion: ACCEPTED_EXPERIENCE_SCHEMA_VERSION,
      factClass: "runtime-hard", kind: "story-interaction", startTick: origin.tick, endTick: origin.tick,
      actorIds: [0, input.speakerId], participantIds: [0, input.speakerId], locationIds: [origin.location],
      visibility: { participantIds: [0, input.speakerId], witnessIds: [], public: false }, sourceIds: [input.id], contextHash: input.id, payload });
    if (!result.accepted) return false;
    state.acceptedExperiences = result.experiences;
  }
  let wrote = false;
  for (const { arc, grant } of arcs) {
    const i = interactionOf(arc);
    if (i.evidenceIds.includes(id)) continue;
    const fresh = i.revision === grant.revision;
    i.evidenceIds = [...i.evidenceIds, id].slice(-24);
    i.evaluatedEvidenceIds = i.evaluatedEvidenceIds.filter(e => i.evidenceIds.includes(e));
    i.signals = i.signals.filter(s => i.evidenceIds.includes(s.evidenceId));
    const signal = fresh ? suppliedSignals.find((s: unknown) => object(s) && s.arcId === arc.id) : undefined;
    if (object(signal) && exact(signal, ["arcId", "revision", "kind", "summary", "lineIds"]) && signal.revision === grant.revision
      && KINDS.includes(signal.kind as ContributionKind) && text(signal.summary, 300) && ids(signal.lineIds, 8) && signal.lineIds.length > 0
      && signal.lineIds.every(lineId => lines.some(l => l.id === lineId && l.speaker === "character"))) {
      i.signals.push({ evidenceId: id, kind: signal.kind as ContributionKind, summary: signal.summary, lineIds: signal.lineIds });
      i.pending = true;
    }
    i.revision++;
    if (input.world || input.choice && !input.runtime
      || input.runtime && i.issues.some(item => item.status === "open" || item.status === "changed")) i.pending = true;
    wrote = true;
  }
  return wrote;
}

/** A selected L1 response is evidence of the player's contribution, not an
 * executed movement, transfer, reward or agreement by another character. */
export function recordPlayerStoryChoice(state: GameState, input: {
  id: string; sessionId: string; speakerId: number; label: string;
  lines: readonly { text: string }[]; grant: StoryInteractionGrantV1;
}): boolean {
  if (!text(input.label, 200) || !input.lines.length || input.lines.length > 4
    || input.lines.some(line => !text(line.text, 600))
    || state.charas[input.speakerId]?.location !== state.master.location
    || !storyInteractionGrants(state, input.speakerId).some(grant => grant.arcId === input.grant.arcId && grant.revision === input.grant.revision)) return false;
  return recordStoryInteraction(state, { id: input.id, sessionId: input.sessionId, speakerId: input.speakerId,
    commandNo: 0, playerText: input.label, lines: input.lines, grants: [input.grant], choice: true });
}

/** Only witnessed changes in the currently staged scene interrupt its plan. */
export function recordStoryWorldChanges(before: Readonly<GameState>, after: GameState, sourceId: string): boolean {
  const p = before.storyProgram;
  if (p?.version !== 2 || !["active", "awaiting-player"].includes(p.status) || !p.locationIds.includes(before.master.location)) return false;
  let wrote = false;
  for (const id of p.actorIds.filter(id => id > 0)) {
    const oldSlot = before.charas[id], slot = after.charas[id];
    if (!oldSlot || !slot || oldSlot.location !== before.master.location) continue;
    const playerLeft = before.master.location !== after.master.location;
    const actorLeft = !playerLeft && oldSlot.location !== slot.location;
    if (!playerLeft && !actorLeft) continue;
    const grants = storyInteractionGrants(before, id).filter(g => g.arcId === p.arcId);
    if (!grants.length) continue;
    const evidenceId = `${sourceId}:${id}`;
    wrote = recordStoryInteraction(after, { id: evidenceId, sessionId: evidenceId, speakerId: id, commandNo: 0, runtime: true, world: true, grants,
      origin: { tick: after.time.tickValue, location: before.master.location },
      lines: [{ text: playerLeft ? `玩家离开了${before.master.location}，原来的同场互动暂时中断。` : `${slot.callName ?? id}不再位于${before.master.location}，原来的同场互动暂时中断。` }] }) || wrote;
  }
  return wrote;
}

export function validateStoryInteractionUpdate(value: unknown, request: StoryInteractionRequestV1 | undefined): string[] {
  if (!request || !object(value) || !exact(value, ["revision", "evidenceIds", "issues", "frontier", "summary"])
    || value.revision !== request.revision || !ids(value.evidenceIds) || value.evidenceIds.length === 0
    || value.evidenceIds.some(id => !request.evidence.some(e => e.id === id))
    || request.evidence.some(e => !(value.evidenceIds as string[]).includes(e.id))
    || !Array.isArray(value.issues) || value.issues.length > 8 || !value.issues.every(issue)
    || new Set(value.issues.map(i => i.id)).size !== value.issues.length
    || request.issues.some(old => !(value.issues as StoryInteractionIssueV1[]).some(item => item.id === old.id))
    || value.issues.some(i => i.evidenceIds.some(id => !(value.evidenceIds as string[]).includes(id) && !request.issues.some(old => old.evidenceIds.includes(id))))
    || !["keep", "replan", "conclude"].includes(String(value.frontier)) || !text(value.summary, 300)) return ["interaction assessment is invalid or stale"];
  if (value.frontier === "conclude" && value.issues.some(i => issue(i) && ["open", "changed"].includes(i.status))) return ["interaction conclusion leaves unhandled issues"];
  return [];
}

/** Accept a narrative assessment, preserving evidence visibility and executed history. */
export function applyStoryInteractionUpdate(state: GameState, arc: StoryArcInstanceV1, update: StoryInteractionUpdateV1): void {
  const i = interactionOf(arc);
  i.issues = structuredClone(update.issues);
  i.evaluatedEvidenceIds = [...new Set([...i.evaluatedEvidenceIds, ...update.evidenceIds])].filter(id => i.evidenceIds.includes(id)).slice(-24);
  i.pending = i.signals.some(s => !i.evaluatedEvidenceIds.includes(s.evidenceId));
  i.lastAssessment = { summary: update.summary, evidenceIds: [...update.evidenceIds], frontier: update.frontier, atTick: state.time.tickValue };
  i.revision++;
  if (update.frontier === "keep") return;
  const maintenance = ensureArcMaintenance(arc);
  const executed = state.storyProgram?.version === 2 && state.storyProgram.arcId === arc.id ? state.storyProgram.executedCapabilityIds : [];
  maintenance.executedCapabilityIds = [...new Set([...(maintenance.executedCapabilityIds ?? []), ...executed])].slice(0, 512);
  maintenance.plannedBeats = [];
  maintenance.nextChance = null;
  maintenance.waitOn = null;
  arc.nextOpportunities = [];
  for (const event of state.narrativeEvents ?? []) {
    if (event.arcId !== arc.id || !["scheduled", "ready", "active"].includes(event.status)) continue;
    event.status = "cancelled";
    event.lifecycleReason = "interaction-progress: superseded unexecuted scene";
    event.program.status = "aborted";
    event.program.lifecycleReason = event.lifecycleReason;
    cancelNarrativeHooks(state, event.program.id);
  }
  const p = state.storyProgram;
  if (p?.version === 2 && p.arcId === arc.id && ["active", "awaiting-player", "paused"].includes(p.status)) {
    p.status = "aborted";
    p.lifecycleReason = "interaction-progress: superseded unexecuted frontier";
    cancelNarrativeHooks(state, p.id);
  }
}

/** L1 only sees assessed changes whose supporting interactions it actually knows. */
export function storyInteractionContext(state: Readonly<GameState>, speakerId: number) {
  return storyInteractionGrants(state, speakerId).map(grant => {
    const arc = state.storyArcs!.find(a => a.id === grant.arcId)!;
    const i = arc.maintenance?.interaction;
    const visible = (id: string) => state.acceptedExperiences?.some(e => e.id === id && isExperienceVisibleTo(e, speakerId));
    return { ...grant, title: arc.title, initialBackground: arc.background?.text,
      issues: i?.issues.filter(item => item.evidenceIds.every(visible)) ?? [],
      ownContributions: i?.signals.filter(s => visible(s.evidenceId)).slice(-4) ?? [],
      assessmentPending: i?.pending ?? false };
  });
}
