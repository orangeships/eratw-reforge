import type { GameState } from "../state/game-state.js";
import type { AgentObservation } from "./types.js";
import { ensureAgentRuntime, ensureCognitiveState, COGNITIVE_CAPS } from "./init.js";
import { getVisibleExperiences } from "../experience.js";

/** Max new observations per character per projection pass. */
const MAX_NEW_PER_PROJECTION = 24;

/**
 * Compile observations for a single character from the day's events.
 * Reads accepted Experience and deterministic interaction signals. Raw
 * settlement strings (EXP/ABL/numeric deltas) are intentionally excluded;
 * relationship changes belong to the structured daily-ledger evidence.
 * Merges with existing buffer and trims to `COGNITIVE_CAPS.observations`.
 *
 * The projection is safe to call during the day as well as at Night.  It only
 * consumes accepted experiences and structured interaction signals; callers
 * decide whether the returned observations are queued for an optional L2
 * reaction or simply made available to L1/L3.
 */
export function compileObservations(
  state: GameState,
  charaNum: number,
  observedDayIndex: number = state.time.dayIndex,
): AgentObservation[] {
  const runtime = ensureAgentRuntime(state);
  const cog = ensureCognitiveState(runtime, charaNum);
  const dayIndex = observedDayIndex;
  const tick = state.time.tickValue;
  const slot = state.charas[charaNum];
  const location = slot?.location ?? "未知";

  const existing = cog.observations;
  let seq = 0;
  const newObs: AgentObservation[] = [];
  const knownSources = new Set(existing.flatMap((entry) => entry.sourceEventIds));

  const append = (observation: Omit<AgentObservation, "id">, stableId?: string): void => {
    if (observation.sourceEventIds.some((id) => knownSources.has(id))) return;
    for (const id of observation.sourceEventIds) knownSources.add(id);
    newObs.push({
      ...observation,
      id: stableId ?? `obs-${charaNum}-${dayIndex}-${tick}-${seq++}`,
    });
  };

  // Accepted Experience is projected first. Observation.tick is the time the
  // observer learns the fact; Experience retains the event's start/end ticks.
  for (const experience of getVisibleExperiences(state.acceptedExperiences ?? [], charaNum)) {
    if (newObs.length >= MAX_NEW_PER_PROJECTION) break;
    append({
      tick,
      dayIndex,
      kind: `experience:${experience.kind}`,
      text: experience.payload.summary,
      participants: [...experience.participantIds],
      location: experience.locationIds[0] ?? location,
      witnessCharaNums: [charaNum],
      factTags: ["accepted-experience", experience.factClass, experience.kind],
      sourceEventIds: [`experience:${experience.id}`, ...experience.sourceIds],
      baseImportance: experience.factClass === "runtime-hard" ? 7 : 4,
    }, `obs-experience:${charaNum}:${experience.id}`);
  }

  // A successful free-chat exchange is a deterministic, character-private
  // episode.  Project the bounded transcript as evidence too, so an optional
  // daytime L2 reaction can understand what was actually said instead of
  // receiving only the generic `dialogue` engagement signal.  The episode is
  // still not a world fact and never grants knowledge to another observer.
  for (const episode of (cog.pendingEpisodes ?? [])
    .filter((entry) => entry.dayIndex <= dayIndex)
    .slice(-12)) {
    if (newObs.length >= MAX_NEW_PER_PROJECTION) break;
    const text = episode.lines
      .map((line) => `${line.speaker === "player" ? "玩家" : "角色"}：${line.text}`)
      .join(" / ")
      .slice(0, 1200);
    append({
      tick: episode.updatedTick,
      dayIndex: episode.dayIndex,
      kind: "player-dialogue",
      text,
      participants: [charaNum],
      location,
      witnessCharaNums: [charaNum],
      factTags: ["player-dialogue", "pending-episode"],
      sourceEventIds: [`episode:${episode.id}`],
      baseImportance: Math.min(10, Math.max(1, episode.heat + 3)),
    }, `obs-episode:${charaNum}:${episode.id}`);
  }

  // ── 1. Deterministic interaction signals ───────────────────
  const eng = runtime.engagements[charaNum];
  if (eng) {
    const recentSignals = eng.signals.filter((s) => s.dayIndex === dayIndex && s.kind !== "relation_delta");
    for (const [index, signal] of recentSignals.entries()) {
      if (newObs.length >= MAX_NEW_PER_PROJECTION) break;
      append({
        tick: signal.tick,
        dayIndex: signal.dayIndex,
        kind: signal.kind,
        text: signal.label,
        participants: [charaNum],
        location,
        witnessCharaNums: [charaNum],
        factTags: [signal.kind],
        sourceEventIds: [`signal:${signal.tick}:${signal.kind}:${index}`],
        baseImportance: Math.min(10, Math.max(1, signal.points)),
      });
    }
  }

  // ── 2. Commission decision (A5) ────────────────────────────
  const commDecision = cog.commissionDecision;
  if (commDecision && newObs.length < MAX_NEW_PER_PROJECTION) {
    if (commDecision.action === "propose" && commDecision.candidateId) {
      append({
        tick,
        dayIndex,
        kind: "commission_decision",
        text: `决定明天向主人公提出委托（${commDecision.candidateId}）`,
        participants: [charaNum],
        location,
        witnessCharaNums: [charaNum],
        factTags: ["commission", "decision"],
        sourceEventIds: [`commission:${commDecision.decidedAtDay}:${commDecision.action}:${commDecision.candidateId ?? "none"}`],
        baseImportance: 7,
      });
    } else if (commDecision.action === "defer") {
      append({
        tick,
        dayIndex,
        kind: "commission_decision",
        text: "决定暂时不向主人公提出委托",
        participants: [charaNum],
        location,
        witnessCharaNums: [charaNum],
        factTags: ["commission", "decision"],
        sourceEventIds: [`commission:${commDecision.decidedAtDay}:defer`],
        baseImportance: 3,
      });
    }
  }

  // ── Merge and trim ─────────────────────────────────────────
  const merged = [...existing, ...newObs];
  if (merged.length > COGNITIVE_CAPS.observations) {
    cog.observations = merged.slice(-COGNITIVE_CAPS.observations);
  } else {
    cog.observations = merged;
  }
  return newObs;
}
