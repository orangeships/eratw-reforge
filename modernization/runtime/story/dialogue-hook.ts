import type { GameState } from "../state/game-state.js";
import { deriveRelationshipAuthority } from "../state/attitude.js";
import { CFLAG_ID, FLAG_ID } from "../state/settlement.js";
import { isExperienceVisibleTo } from "../experience.js";
import { ensureArcEvolution, ensureArcMaintenance } from "./arc-maintenance.js";

/** Shared by ordinary talk and the shell's explicit AI chat command. */
export const STORY_DIALOGUE_COMMANDS = [300, 19986] as const;
export type HookDisposition = "raise" | "defer" | "decline";
export interface NarrativeHookV1 {
  version: 1;
  id: string;
  storyId: string;
  sceneId: string;
  speakerId: number;
  revision: number;
  priority: number;
  objective: string;
  guard: {
    locationIds?: string[];
    startTick?: number;
    endTick?: number;
    minFavor?: number;
    minTrust?: number;
    maxRebellion?: number;
  };
  /** IDs refer only to accepted, speaker-visible facts, never future plans. */
  factIds: string[];
  fallback?: string[];
  completion?: { kind: "expression" | "player-response" } | { kind: "capability"; programId: string; idempotencyKey: string };
  responses?: Array<{ id: string; label: string; result: "accept" | "reject"; lines: string[] }>;
  playerResponse?: { id: string; sessionId: string; result: "accept" | "reject"; tick: number; priorExecutionIds?: string[] };
  status: "pending" | "offered" | "blocked" | "resolved" | "deferred" | "declined" | "cancelled" | "expired";
  lastReceipt?: HookReceiptV1;
  /** Actual validated L1 expression, never dialogue prewritten by L3. */
  expressedLines?: string[];
}
export interface HookGrantV1 {
  hookId: string;
  revision: number;
  speakerId: number;
  sessionId: string;
  commandNo: number;
  dependencyKey: string;
}
export interface HookReceiptV1 {
  hookId: string;
  revision: number;
  speakerId: number;
  sessionId: string;
  disposition: HookDisposition;
  lineIds: string[];
  expressedAtTick: number;
}

const text = (x: unknown, max = 180): x is string => typeof x === "string" && x.trim().length > 0 && x.length <= max;
const strings = (x: unknown, max: number): x is string[] => Array.isArray(x) && x.length <= max && x.every(v => text(v)) && new Set(x).size === x.length;
const integer = (x: unknown): x is number => Number.isSafeInteger(x);
const exact = (x: object, allowed: string[]) => Object.keys(x).every(k => allowed.includes(k));

export function isNarrativeHook(value: unknown): value is NarrativeHookV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const h = value as NarrativeHookV1;
  if (!exact(h, ["version", "id", "storyId", "sceneId", "speakerId", "revision", "priority", "objective", "guard", "factIds", "fallback", "status", "lastReceipt", "completion", "responses", "playerResponse", "expressedLines"])) return false;
  if (h.expressedLines !== undefined && (!Array.isArray(h.expressedLines) || !h.expressedLines.length || h.expressedLines.length > 8 || h.expressedLines.some(line => !text(line, 1200)))) return false;
  if (h.version !== 1 || !text(h.id) || !text(h.storyId) || !text(h.sceneId) || !integer(h.speakerId) || h.speakerId <= 0
    || !integer(h.revision) || h.revision < 1 || !integer(h.priority) || Math.abs(h.priority) > 100 || !text(h.objective, 800)
    || !strings(h.factIds, 16) || !["pending", "offered", "blocked", "resolved", "deferred", "declined", "cancelled", "expired"].includes(h.status)) return false;
  if (h.completion !== undefined && (!h.completion || typeof h.completion !== "object"
    || (h.completion.kind === "capability" ? !exact(h.completion, ["kind", "programId", "idempotencyKey"])
      || !text(h.completion.programId) || !text(h.completion.idempotencyKey)
      : !exact(h.completion, ["kind"]) || !["expression", "player-response"].includes(h.completion.kind)))) return false;
  if (h.responses !== undefined && (!Array.isArray(h.responses) || !h.responses.length || h.responses.length > 4
    || h.responses.some(r => !r || !exact(r, ["id", "label", "result", "lines"]) || !text(r.id) || !text(r.label, 80)
      || !["accept", "reject"].includes(r.result) || !Array.isArray(r.lines) || !r.lines.length || r.lines.length > 8 || !r.lines.every(l => text(l, 1200)))
    || new Set(h.responses.map(r => r.id)).size !== h.responses.length || new Set(h.responses.map(r => r.label)).size !== h.responses.length)) return false;
  if (h.playerResponse !== undefined && (!h.playerResponse || !exact(h.playerResponse, ["id", "sessionId", "result", "tick", "priorExecutionIds"])
    || !text(h.playerResponse.sessionId) || h.playerResponse.sessionId !== h.lastReceipt?.sessionId
    || !integer(h.playerResponse.tick) || h.playerResponse.tick < 0
    || h.playerResponse.priorExecutionIds !== undefined && !strings(h.playerResponse.priorExecutionIds, 256)
    || !h.responses?.some(r => r.id === h.playerResponse!.id && r.result === h.playerResponse!.result))) return false;
  const g = h.guard;
  if (!g || typeof g !== "object" || Array.isArray(g) || !exact(g, ["locationIds", "startTick", "endTick", "minFavor", "minTrust", "maxRebellion"])) return false;
  if (g.locationIds !== undefined && (!strings(g.locationIds, 8) || !g.locationIds.length)) return false;
  for (const k of ["startTick", "endTick", "minFavor", "minTrust", "maxRebellion"] as const) if (g[k] !== undefined && (!integer(g[k]) || g[k]! < 0)) return false;
  if (g.startTick !== undefined && g.endTick !== undefined && g.endTick <= g.startTick) return false;
  if (g.maxRebellion !== undefined && g.maxRebellion > 3) return false;
  if (h.fallback !== undefined && (!Array.isArray(h.fallback) || !h.fallback.length || h.fallback.length > 8 || !h.fallback.every(v => text(v, 1200)))) return false;
  const r = h.lastReceipt;
  return r === undefined || (!!r && typeof r === "object" && exact(r, ["hookId", "revision", "speakerId", "sessionId", "disposition", "lineIds", "expressedAtTick"])
    && r.hookId === h.id && r.revision === h.revision && r.speakerId === h.speakerId && text(r.sessionId)
    && ["raise", "defer", "decline"].includes(r.disposition) && strings(r.lineIds, 8) && r.lineIds.length > 0 && integer(r.expressedAtTick) && r.expressedAtTick >= 0);
}

export function normalizeNarrativeHooks(value: unknown): NarrativeHookV1[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 24 || !value.every(isNarrativeHook)
    || new Set(value.map(h => h.id)).size !== value.length) throw new Error("Invalid narrative dialogue hooks");
  return structuredClone(value);
}

/** A grant depends on this speaker's declared relationship inputs, not other NPC minds. */
export function hookBlockReason(state: Readonly<GameState>, h: NarrativeHookV1): string | null {
  const owner = state.narrativeEvents?.find(event => event.program.id === h.storyId);
  if (owner?.status === "cancelled" && owner.program.lifecycleReason?.startsWith("dialogue-wait:")) return "本次互动未推进，等待下一次演化";
  const ownerArcId = state.narrativeEvents?.find(e => e.program.id === h.storyId)?.arcId
    ?? (state.storyProgram?.version === 2 && state.storyProgram.id === h.storyId ? state.storyProgram.arcId : undefined);
  const arc = state.storyArcs?.find(a => a.id === h.storyId || a.id === ownerArcId);
  if (arc?.status === "paused") return "故事线已暂停";
  if (arc && arc.status !== "active") return "故事线已结束";
  const slot = state.charas[h.speakerId];
  if (!slot) return "角色不存在";
  if (slot.location !== state.master.location) return "角色不在同一地点";
  if ((state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0
    || (state.master.state.CFLAG[CFLAG_ID.诶嘿嘿] ?? 0) !== 0 || (slot.state.CFLAG[CFLAG_ID.诶嘿嘿] ?? 0) !== 0
    || (slot.state.CFLAG[CFLAG_ID.睡眠] ?? 0) !== 0) return "当前无法进行剧情交流";
  const r = deriveRelationshipAuthority(slot, state.master, state);
  // COM300's canonical third-level rebellion refusal also applies to hook communication.
  if (r.rebellionMark >= 3 || (h.guard.maxRebellion !== undefined && r.rebellionMark > h.guard.maxRebellion)
    || (h.guard.minFavor !== undefined && r.favor < h.guard.minFavor) || (h.guard.minTrust !== undefined && r.trust < h.guard.minTrust)) return "当前关系不满足剧情条件";
  if (h.guard.locationIds && !h.guard.locationIds.includes(state.master.location)) return "尚未到达剧情地点";
  if (h.guard.startTick !== undefined && state.time.tickValue < h.guard.startTick) return "尚未到达剧情时间";
  if (h.guard.endTick !== undefined && state.time.tickValue >= h.guard.endTick) return "剧情时间已经过期";
  return null;
}

function dependencyKey(state: Readonly<GameState>, h: NarrativeHookV1): string | null {
  if (hookBlockReason(state, h)) return null;
  const slot = state.charas[h.speakerId]!;
  const r = deriveRelationshipAuthority(slot, state.master, state);
  return JSON.stringify([h.revision, h.storyId, h.sceneId, h.objective, h.guard, h.factIds, h.fallback, h.completion, h.responses, h.lastReceipt?.sessionId ?? null, slot.location, r.rebellionMark,
    h.guard.minFavor === undefined ? null : r.favor, h.guard.minTrust === undefined ? null : r.trust]);
}

export function selectNarrativeHook(state: Readonly<GameState>, speakerId: number, commandNo: number): NarrativeHookV1 | undefined {
  if (!STORY_DIALOGUE_COMMANDS.some(n => n === commandNo)) return undefined;
  return (state.narrativeHooks ?? []).filter(h => isNarrativeHook(h) && h.speakerId === speakerId
    && (["pending", "deferred"].includes(h.status) || h.status === "blocked" && h.lastReceipt?.disposition !== "raise") && dependencyKey(state, h) !== null)
    .sort((a, b) => b.priority - a.priority || (a.guard.endTick ?? Number.MAX_SAFE_INTEGER) - (b.guard.endTick ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id, "en"))[0];
}

export function issueHookGrant(state: Readonly<GameState>, speakerId: number, commandNo: number, sessionId: string): HookGrantV1 | null {
  const h = selectNarrativeHook(state, speakerId, commandNo);
  if (!h || !text(sessionId)) return null;
  return { hookId: h.id, revision: h.revision, speakerId, sessionId, commandNo, dependencyKey: dependencyKey(state, h)! };
}

/** Accepted deterministic text provides a playable route when no model is required. */
export function publishHookFallback(state: GameState, speakerId: number, commandNo: number, sessionId: string): string[] | null {
  const hook = selectNarrativeHook(state, speakerId, commandNo);
  if (!hook?.fallback) return null;
  const grant = issueHookGrant(state, speakerId, commandNo, sessionId)!;
  const lines = hook.fallback.map((text, index) => ({ id: `${hook.id}:${hook.revision}:line:${index}`, text }));
  if (!commitHookReceipt(state, grant, { hookId: hook.id, revision: hook.revision, disposition: "raise", lineIds: lines.map(l => l.id) }, lines)) return null;
  return [...hook.fallback];
}

/** Call only at the owner-bound complete reply publication point. Never consumes partials. */
export function commitHookReceipt(state: GameState, grant: HookGrantV1, result: unknown, publishedLines: readonly { id: string; text: string }[]): boolean {
  const h = state.narrativeHooks?.find(h => h.id === grant.hookId);
  if (!h || !isNarrativeHook(h) || h.revision !== grant.revision || h.speakerId !== grant.speakerId
    || !STORY_DIALOGUE_COMMANDS.some(n => n === grant.commandNo) || !["pending", "deferred", "blocked"].includes(h.status)
    || h.lastReceipt?.sessionId === grant.sessionId || dependencyKey(state, h) !== grant.dependencyKey
    || !result || typeof result !== "object" || Array.isArray(result)) return false;
  const r = result as { hookId: string; revision: number; disposition: HookDisposition; lineIds: string[] };
  if (!exact(r, ["hookId", "revision", "disposition", "lineIds"]) || r.hookId !== h.id || r.revision !== h.revision
    || !["raise", "defer", "decline"].includes(r.disposition) || !strings(r.lineIds, 8) || !r.lineIds.length
    || new Set(publishedLines.map(l => l.id)).size !== publishedLines.length
    || r.lineIds.some(id => !publishedLines.some(l => l.id === id && text(l.text, 12000)))) return false;
  h.lastReceipt = { ...r, lineIds: [...r.lineIds], speakerId: h.speakerId, sessionId: grant.sessionId, expressedAtTick: state.time.tickValue };
  h.expressedLines = publishedLines.filter(line => r.lineIds.includes(line.id)).map(line => line.text.slice(0, 1200));
  h.status = r.disposition === "raise" ? h.completion?.kind === "expression" ? "resolved" : "offered" : r.disposition === "defer" ? "deferred" : "declined";
  if (r.disposition !== "raise") waitForNextNarrativeEvolution(state, h, r.disposition === "defer" ? "角色暂缓引出剧情" : "角色没有接受本次剧情方向");
  return true;
}

/** Stop this opportunity, not the Arc. No next node, reward, summary or synthetic success. */
export function waitForNextNarrativeEvolution(state: GameState, hook: NarrativeHookV1, reason: string): boolean {
  const program = state.storyProgram;
  const node = program?.version === 2 && program.id === hook.storyId ? program.nodes.find(entry => entry.id === program.cursorNodeId) : undefined;
  if (!program || program.version !== 2 || program.status !== "active" || node?.kind !== "dialogue-hook" || node.id !== hook.sceneId) return false;
  program.status = "aborted";
  program.lifecycleReason = `dialogue-wait:${reason}`.slice(0, 240);
  const event = state.narrativeEvents?.find(entry => entry.program.id === program.id);
  if (event) { event.status = "cancelled"; event.lifecycleReason = program.lifecycleReason; event.program = structuredClone(program); }
  const arc = state.storyArcs?.find(entry => entry.id === program.arcId);
  if (arc?.status === "active") {
    const maintenance = ensureArcMaintenance(arc);
    const evolution = ensureArcEvolution(arc);
    evolution.nextTrigger = "clock-boundary";
    evolution.cooldownUntilTick = state.time.tickValue + 180;
    maintenance.disposition = "wait";
    maintenance.nextChance = null;
    maintenance.waitOn = { kind: "time", latestTick: evolution.cooldownUntilTick };
    maintenance.lastFailure = { atTick: state.time.tickValue, reason };
    arc.nextOpportunities = [];
  }
  if (state.activeEventContext?.arcId === program.arcId && program.arcId) state.activeEventContext = null;
  return true;
}

/** A complete reply without a valid result is not evidence that the goal was achieved. */
export function deferUnprocessedProgramHook(state: GameState, grant: HookGrantV1, reason: string): boolean {
  const hook = state.narrativeHooks?.find(entry => entry.id === grant.hookId);
  if (!hook || hook.revision !== grant.revision || dependencyKey(state, hook) !== grant.dependencyKey
    || !["pending", "deferred", "blocked"].includes(hook.status)) return false;
  if (!waitForNextNarrativeEvolution(state, hook, reason)) return false;
  hook.status = "deferred";
  return true;
}

/** Explicit Runtime choice: acceptance alone never satisfies an action completion. */
export function commitHookPlayerResponse(state: GameState, hookId: string, revision: number, sessionId: string, responseId: string): boolean {
  const h = state.narrativeHooks?.find(h => h.id === hookId);
  const response = h?.responses?.find(r => r.id === responseId);
  if (!h || !isNarrativeHook(h) || h.revision !== revision || h.status !== "offered" || h.playerResponse
    || h.lastReceipt?.sessionId !== sessionId || h.lastReceipt.disposition !== "raise" || !response || hookBlockReason(state, h)) return false;
  h.playerResponse = { id: response.id, sessionId, result: response.result, tick: state.time.tickValue };
  if (h.completion?.kind === "capability") {
    const completion = h.completion;
    h.playerResponse.priorExecutionIds = (state.acceptedExperiences ?? []).filter(e => "programId" in e.payload
      && e.payload.programId === completion.programId && e.payload.outcomeId === completion.idempotencyKey).map(e => e.id);
  }
  h.status = response.result === "reject" ? "declined" : h.completion?.kind === "capability" ? "offered" : "resolved";
  return true;
}

/** Reconcile only actual world conditions and accepted execution records. Never rewrites expression history. */
export function refreshNarrativeHooks(state: GameState): void {
  for (const h of state.narrativeHooks ?? []) {
    if (!isNarrativeHook(h) || ["resolved", "declined", "cancelled", "expired"].includes(h.status)) continue;
    const completion = h.completion;
    if (completion?.kind === "capability" && h.playerResponse?.result === "accept" && h.lastReceipt?.disposition === "raise"
      && state.acceptedExperiences?.some(e => e.factClass === "story-runtime" && e.kind === "story-beat"
        && isExperienceVisibleTo(e, h.speakerId) && e.endTick >= h.playerResponse!.tick
        && !(h.playerResponse!.priorExecutionIds ?? []).includes(e.id)
        && (h.guard.endTick === undefined || e.endTick < h.guard.endTick)
        && "programId" in e.payload && e.payload.programId === completion.programId
        && e.payload.beatId === `capability:${completion.idempotencyKey}` && e.payload.outcomeId === completion.idempotencyKey)) { h.status = "resolved"; continue; }
    if (h.guard.endTick !== undefined && state.time.tickValue >= h.guard.endTick) { h.status = "expired"; continue; }
    if (hookBlockReason(state, h)) { h.status = "blocked"; continue; }
    if (h.status === "blocked") h.status = h.lastReceipt?.disposition === "raise" ? "offered" : h.lastReceipt?.disposition === "defer" ? "deferred" : "pending";
  }
}

export function cancelNarrativeHooks(state: GameState, storyId: string): void {
  for (const h of state.narrativeHooks ?? []) if (isNarrativeHook(h) && h.storyId === storyId && !["resolved", "declined", "expired"].includes(h.status)) h.status = "cancelled";
}
