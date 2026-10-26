import { cloneGameState, type GameState } from "../state/game-state.js";
import { CFLAG_ID, FLAG_ID } from "../state/settlement.js";
import { deriveRelationshipAuthority } from "../state/attitude.js";
import { ROOM_CATALOG_BY_LOCATION } from "../world/room-catalog.js";
import { compileNarrativeSnapshot } from "./snapshot.js";
import { compileStoryGraphProposalV2 } from "./compiler.js";
import { isOpenStoryProgram } from "./reconciliation.js";
import { cancelNarrativeHooks, refreshNarrativeHooks, type NarrativeHookV1 } from "./dialogue-hook.js";
import { validateStoryletDocument, type StoryletBindingsV1, type StoryletDocumentV1, type StoryletSceneV1 } from "./storylet-document.js";
import type { StoryGraphNodeV2 } from "./types.js";
import { activeNarrativeStoryCount } from "./lifecycle.js";

export interface StoryletInstanceV1 {
  version: 1; id: string; document: StoryletDocumentV1; bindings: StoryletBindingsV1;
  createdAtTick: number; status: "active" | "completed" | "cancelled" | "expired";
  currentSceneId: string; phase: "waiting" | "ready" | "playing" | "waiting-hooks";
  seenEventIds: string[]; startedSceneIds: string[]; observedLocation: string;
  programId?: string; graphOutcome?: string; blockedReason?: string;
  history: Array<{ sceneId: string; tick: number; outcome?: string; hookResults: Record<string, string> }>;
}
export interface StoryletDialogueEvent { id: string; kind: "dialogue"; speakerId: number; commandNo: 300 | 19986; tick: number }
const sceneOf = (s: StoryletInstanceV1) => s.document.scenes.find(scene => scene.id === s.currentSceneId)!;
const sceneLocation = (state: GameState, s: StoryletInstanceV1, scene: StoryletSceneV1) => scene.place ? s.bindings.locations[scene.place]! : state.master.location;
const hookId = (s: StoryletInstanceV1, scene: StoryletSceneV1, id: string) => `${s.id}:${scene.id}:${id}`;

export function validateStoryletBindings(doc: StoryletDocumentV1, bindings: unknown): bindings is StoryletBindingsV1 {
  if (!bindings || typeof bindings !== "object" || Array.isArray(bindings)) return false;
  const b = bindings as StoryletBindingsV1;
  if (Object.keys(b).sort().join() !== "characters,locations" || !b.characters || !b.locations || Array.isArray(b.characters) || Array.isArray(b.locations)) return false;
  return Object.keys(b.characters).sort().join() === [...doc.roles].sort().join()
    && Object.keys(b.locations).sort().join() === [...doc.places].sort().join()
    && Object.values(b.characters).every(n => Number.isSafeInteger(n) && n > 0)
    && new Set(Object.values(b.characters)).size === doc.roles.length
    && Object.values(b.locations).every(l => typeof l === "string" && !!ROOM_CATALOG_BY_LOCATION[l]);
}

export function normalizeStorylets(value: unknown): StoryletInstanceV1[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 32) throw new Error("Invalid storylet instances");
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid storylet instance");
    const s = raw as StoryletInstanceV1;
    if (Object.keys(s).some(k => !["version", "id", "document", "bindings", "createdAtTick", "status", "currentSceneId", "phase", "seenEventIds", "startedSceneIds", "observedLocation", "programId", "graphOutcome", "blockedReason", "history"].includes(k))
      || s.version !== 1 || typeof s.id !== "string" || !s.id || s.id.length > 180 || validateStoryletDocument(s.document).length
      || !validateStoryletBindings(s.document, s.bindings) || !Number.isSafeInteger(s.createdAtTick) || s.createdAtTick < 0
      || !["active", "completed", "cancelled", "expired"].includes(s.status) || !["waiting", "ready", "playing", "waiting-hooks"].includes(s.phase)
      || !s.document.scenes.some(scene => scene.id === s.currentSceneId) || typeof s.observedLocation !== "string"
      || !Array.isArray(s.seenEventIds) || s.seenEventIds.length > 64 || new Set(s.seenEventIds).size !== s.seenEventIds.length || s.seenEventIds.some(id => typeof id !== "string" || !id || id.length > 240)
      || !Array.isArray(s.startedSceneIds) || s.startedSceneIds.length > 12 || new Set(s.startedSceneIds).size !== s.startedSceneIds.length
      || s.startedSceneIds.some(id => !s.document.scenes.some(scene => scene.id === id))
      || [s.programId, s.graphOutcome, s.blockedReason].some(v => v !== undefined && (typeof v !== "string" || !v || v.length > 800))
      || s.phase === "playing" && (!s.programId || !s.startedSceneIds.includes(s.currentSceneId))
      || !Array.isArray(s.history) || s.history.length > 12 || s.history.some(h => !h || !s.document.scenes.some(scene => scene.id === h.sceneId)
        || !Number.isSafeInteger(h.tick) || h.tick < 0 || !h.hookResults || typeof h.hookResults !== "object" || Array.isArray(h.hookResults)
        || Object.keys(h.hookResults).length > 4 || Object.values(h.hookResults).some(v => !["resolved", "declined", "expired", "cancelled"].includes(v))
        || h.outcome !== undefined && typeof h.outcome !== "string")) throw new Error("Invalid storylet instance");
  }
  if (new Set(value.map(s => s.id)).size !== value.length || value.filter(s => s.status === "active").length > 3) throw new Error("Storylet budget exceeded");
  return structuredClone(value);
}

export function acceptStorylet(input: Readonly<GameState>, document: unknown, bindings: unknown) {
  const diagnostics = validateStoryletDocument(document);
  const doc = document as StoryletDocumentV1;
  if (diagnostics.length) return { accepted: false as const, state: input, diagnostics };
  if (!validateStoryletBindings(doc, bindings) || Object.values(bindings.characters).some(n => !input.charas[n])) return { accepted: false as const, state: input, diagnostics: ["storylet bindings are invalid"] };
  if (activeNarrativeStoryCount(input) >= 3
    || input.storylets?.some(s => s.status === "active" && s.document.id === doc.id)) return { accepted: false as const, state: input, diagnostics: ["storylet active budget or duplicate document"] };
  const state = cloneGameState(input);
  const existing = state.storylets ?? [];
  const serial = state.nextStoryletSerial ?? 0;
  if (!Number.isSafeInteger(serial) || serial < 0 || serial >= Number.MAX_SAFE_INTEGER) return { accepted: false as const, state: input, diagnostics: ["storylet identity allocator is invalid"] };
  const id = `storylet:${doc.id}:${state.time.tickValue}:${serial}`;
  state.nextStoryletSerial = serial + 1;
  if (existing.length === 32) existing.splice(existing.findIndex(s => s.status !== "active"), 1);
  existing.push({ version: 1, id, document: structuredClone(doc), bindings: structuredClone(bindings), createdAtTick: state.time.tickValue,
    status: "active", currentSceneId: doc.start, phase: "waiting", seenEventIds: [], startedSceneIds: [], observedLocation: state.master.location, history: [] });
  state.storylets = existing;
  refreshStorylets(state);
  return { accepted: true as const, state, diagnostics: [] };
}

function readiness(state: GameState, s: StoryletInstanceV1, scene: StoryletSceneV1): string | null {
  if ((state.flagStore[FLAG_ID.時間停止] ?? 0) || (state.master.state.CFLAG[CFLAG_ID.诶嘿嘿] ?? 0)) return "等待非 H 的正常时间";
  if (state.master.location !== sceneLocation(state, s, scene)) return "等待剧情地点";
  const elapsed = state.time.tickValue - s.createdAtTick, g = scene.guard;
  if (g?.startAfterMinutes !== undefined && elapsed < g.startAfterMinutes) return "等待剧情时间";
  if (g?.hours && (state.time.hourOfDay < g.hours.start || state.time.hourOfDay >= g.hours.end)) return "等待剧情时段";
  for (const role of scene.participants) {
    const slot = state.charas[s.bindings.characters[role]!];
    if (!slot || slot.location !== state.master.location || (slot.state.CFLAG[CFLAG_ID.睡眠] ?? 0)
      || (slot.state.CFLAG[CFLAG_ID.诶嘿嘿] ?? 0)) return "等待参演角色到场并能够交流";
  }
  return null;
}

function armHooks(state: GameState, s: StoryletInstanceV1, scene: StoryletSceneV1): boolean {
  if (readiness(state, s, scene)) return false;
  for (const authored of scene.hooks ?? []) {
    const id = hookId(s, scene, authored.id);
    if (state.narrativeHooks?.some(h => h.id === id)) continue;
    if ((state.narrativeHooks?.length ?? 0) >= 24) {
      state.narrativeHooks = state.narrativeHooks!.filter(h => !["resolved", "declined", "expired", "cancelled"].includes(h.status)
        || state.storylets?.some(owner => owner.status === "active" && owner.id === h.storyId && owner.currentSceneId === h.sceneId));
      if (state.narrativeHooks.length >= 24) { s.blockedReason = "剧情钩子数量已达上限"; return false; }
    }
    const h: NarrativeHookV1 = { version: 1, id, storyId: s.id, sceneId: scene.id, speakerId: s.bindings.characters[authored.speaker]!,
      revision: 1, priority: 10, objective: authored.objective, guard: { ...authored.relationship, locationIds: [sceneLocation(state, s, scene)],
        ...(scene.guard?.endAfterMinutes === undefined && !scene.guard?.hours ? {} : { endTick: Math.min(
          scene.guard?.endAfterMinutes === undefined ? Number.MAX_SAFE_INTEGER : s.createdAtTick + scene.guard.endAfterMinutes,
          scene.guard?.hours ? Math.floor(state.time.tickValue / 1440) * 1440 + scene.guard.hours.end * 60 : Number.MAX_SAFE_INTEGER) }) },
      factIds: [], status: "pending", ...(authored.fallback ? { fallback: [...authored.fallback] } : {}),
      ...(authored.completion ? { completion: { kind: authored.completion } } : {}),
      ...(authored.responses ? { responses: structuredClone(authored.responses) } : {}) };
    state.narrativeHooks = [...state.narrativeHooks ?? [], h];
  }
  return true;
}

export function recordStoryletDialogue(state: GameState, event: StoryletDialogueEvent): void {
  if (!event.id || event.tick !== state.time.tickValue || ![300, 19986].includes(event.commandNo)) return;
  const speaker = state.charas[event.speakerId];
  if (!speaker || deriveRelationshipAuthority(speaker, state.master, state).rebellionMark >= 3) return;
  for (const s of state.storylets ?? []) {
    if (s.status !== "active" || s.phase !== "waiting" || s.seenEventIds.includes(event.id)) continue;
    const scene = sceneOf(s);
    if (scene.trigger.kind !== "dialogue" || s.bindings.characters[scene.trigger.speaker] !== event.speakerId) continue;
    s.seenEventIds = [...s.seenEventIds, event.id].slice(-64);
    if (!readiness(state, s, scene)) s.phase = "ready";
  }
}

/** Pure deterministic reconciliation; waiting stories never occupy GameState.storyProgram. */
export function refreshStorylets(state: GameState): void {
  refreshNarrativeHooks(state);
  for (const s of state.storylets ?? []) {
    if (s.status !== "active") continue;
    const scene = sceneOf(s);
    if (s.phase === "waiting" && scene.hooks?.length && scene.hooks.every(h => state.narrativeHooks?.find(x => x.id === hookId(s, scene, h.id))?.status === "expired")) s.phase = "waiting-hooks";
    if (s.phase === "playing") {
      const program = state.storyProgram;
      if (!program || program.id !== s.programId) { s.status = "cancelled"; s.blockedReason = "场景执行器已被替换"; cancelNarrativeHooks(state, s.id); continue; }
      if (program.status === "aborted") { s.status = "cancelled"; cancelNarrativeHooks(state, s.id); continue; }
      if (program.status !== "completed") continue;
      if (program.version === 2) {
        const ending = program.nodes.find(n => n.kind === "end" && program.executedNodeIds.includes(n.id));
        if (ending?.kind === "end") s.graphOutcome = ending.outcomeId;
      }
      s.phase = "waiting-hooks"; state.storyProgram = null;
    }
    if (s.phase === "waiting-hooks") {
      const hooks = (scene.hooks ?? []).map(h => state.narrativeHooks?.find(x => x.id === hookId(s, scene, h.id)));
      const transition = scene.transitions?.find(tr => {
        const when = tr.when;
        return when.kind === "outcome" ? when.id === s.graphOutcome : hooks.some(h => h?.id === hookId(s, scene, when.id) && h.status === when.status);
      });
      if (transition || hooks.every(h => h && ["resolved", "declined", "expired", "cancelled"].includes(h.status))) {
        s.history.push({ sceneId: scene.id, tick: state.time.tickValue, ...(s.graphOutcome ? { outcome: s.graphOutcome } : {}),
          hookResults: Object.fromEntries(hooks.filter(h => !!h && ["resolved", "declined", "expired", "cancelled"].includes(h.status)).map(h => [h!.id, h!.status])) });
        // Never leave abandoned invitations selectable after moving to the next scene.
        for (const h of hooks) if (h && !["resolved", "declined", "expired", "cancelled"].includes(h.status)) h.status = "cancelled";
        if (transition) { s.currentSceneId = transition.next; s.phase = "waiting"; delete s.programId; delete s.graphOutcome; }
        else s.status = "completed";
      }
      continue;
    }
    if (scene.guard?.endAfterMinutes !== undefined && state.time.tickValue - s.createdAtTick >= scene.guard.endAfterMinutes) {
      s.status = "expired"; cancelNarrativeHooks(state, s.id); continue;
    }
    const reason = readiness(state, s, scene);
    s.blockedReason = reason ?? undefined;
    if (s.phase === "waiting" && !reason) {
      if (!armHooks(state, s, scene)) continue;
      if (scene.trigger.kind === "immediate" || scene.trigger.kind === "arrival") {
        const source = s.observedLocation === state.master.location ? "readiness" : "arrival";
        s.seenEventIds = [...s.seenEventIds, `${source}:${s.id}:${scene.id}:${state.time.tickValue}`].slice(-64);
        s.phase = "ready";
      }
    }
    s.observedLocation = state.master.location;
  }
}

export function startReadyStorylet(state: GameState, allowForeground = true): { started: boolean; diagnostics: string[] } {
  refreshStorylets(state);
  if (isOpenStoryProgram(state.storyProgram)) return { started: false, diagnostics: [] };
  const s = state.storylets?.find(s => s.status === "active" && s.phase === "ready" && (allowForeground || !sceneOf(s).graph) && !readiness(state, s, sceneOf(s)));
  if (!s) return { started: false, diagnostics: [] };
  const scene = sceneOf(s);
  if (s.startedSceneIds.includes(scene.id)) return { started: false, diagnostics: ["scene already started"] };
  if (!scene.graph) { s.startedSceneIds.push(scene.id); s.phase = "waiting-hooks"; refreshStorylets(state); return { started: false, diagnostics: [] }; }
  const participants = [0, ...scene.participants.map(r => s.bindings.characters[r]!)];
  const context = compileNarrativeSnapshot(state, [], participants);
  const nodes: StoryGraphNodeV2[] = scene.graph.nodes.map(n => n.kind === "narration" ? { id: n.id, kind: "narration", text: n.text, nextNodeId: n.next }
    : n.kind === "speech" ? { id: n.id, kind: "expression", actorId: s.bindings.characters[n.speaker]!, objective: "表达作者已接受的当前场景台词", fallbackText: n.text, nextNodeId: n.next }
      : n.kind === "choice" ? { id: n.id, kind: "player-choice", question: n.question, options: n.options.map(o => ({ id: o.id, label: o.label, nextNodeId: o.next })) }
        : { id: n.id, kind: "end", outcomeId: n.outcome, summary: n.summary });
  const compiled = compileStoryGraphProposalV2({ version: 2, proposalId: `${s.id}:${scene.id}`, title: s.document.title,
    contextHash: context.snapshot.contextHash, participantIds: participants, locationIds: [sceneLocation(state, s, scene)], factIds: [], startNodeId: scene.graph.start, nodes }, context, { createdAtTick: state.time.tickValue });
  if (!compiled.accepted) { s.blockedReason = compiled.diagnostics.join("; "); return { started: false, diagnostics: compiled.diagnostics }; }
  s.startedSceneIds.push(scene.id); s.phase = "playing"; s.programId = compiled.program.id; state.storyProgram = compiled.program;
  return { started: true, diagnostics: [] };
}
