import type { GameState } from "../state/game-state.js";
import type { AgentObservation } from "./types.js";
import { ensureAgentRuntime, ensureCognitiveState, COGNITIVE_CAPS } from "./init.js";

/** Max new observations per character per night. */
const MAX_NEW_PER_NIGHT = 24;

/**
 * Compile observations for a single character from the day's events.
 * Reads `daySettlementReport`, `nightReport`, and engagement signals.
 * Merges with existing buffer and trims to `COGNITIVE_CAPS.observations`.
 *
 * Only call this at night (during `finishPlayerSleep`), when the day
 * is fully settled and `daySettlementReport` is available.
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

  const append = (observation: Omit<AgentObservation, "id">): void => {
    if (observation.sourceEventIds.some((id) => knownSources.has(id))) return;
    for (const id of observation.sourceEventIds) knownSources.add(id);
    newObs.push({
      ...observation,
      id: `obs-${charaNum}-${dayIndex}-${tick}-${seq++}`,
    });
  };

  // ── 1. Day settlement report entries ───────────────────────
  const report = state.daySettlementReport ?? [];
  const charaReport = report.find((e) => e.charaNum === charaNum);
  if (charaReport && charaReport.changes.length > 0) {
    for (const [index, change] of charaReport.changes.slice(0, 12).entries()) {
      if (newObs.length >= MAX_NEW_PER_NIGHT) break;
      append({
        tick,
        dayIndex,
        kind: "daily_change",
        text: `${charaReport.name}: ${change}`,
        participants: [charaNum],
        location,
        witnessCharaNums: [charaNum],
        factTags: ["daily-change"],
        sourceEventIds: [`settlement:${dayIndex}:${charaNum}:${index}`],
        baseImportance: 4,
      });
    }
  }

  // ── 2. Night report events involving the character ──────────
  const nightEvents = state.nightReport ?? [];
  for (const [index, evt] of nightEvents.entries()) {
    if (newObs.length >= MAX_NEW_PER_NIGHT) break;
    // Check if this event mentions the character
    const text = textOfEvent(evt);
    if (!text) continue;
    const slotName = slot?.callName ?? `#${charaNum}`;
    if (!text.includes(slotName) && !text.includes(`#${charaNum}`)) continue;
    append({
      tick,
      dayIndex,
      kind: eventKind(evt),
      text: text.slice(0, 200),
      participants: [charaNum],
      location,
      witnessCharaNums: [charaNum],
      factTags: [eventKind(evt)],
      sourceEventIds: [`night:${dayIndex}:${index}`],
      baseImportance: 5,
    });
  }

  // ── 3. Engagement signals ──────────────────────────────────
  const eng = runtime.engagements[charaNum];
  if (eng) {
    const recentSignals = eng.signals.filter((s) => s.dayIndex === dayIndex);
    for (const [index, signal] of recentSignals.entries()) {
      if (newObs.length >= MAX_NEW_PER_NIGHT) break;
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

  // ── 4. Commission decision (A5) ────────────────────────────
  const commDecision = cog.commissionDecision;
  if (commDecision && newObs.length < MAX_NEW_PER_NIGHT) {
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

function textOfEvent(evt: unknown): string {
  if (!evt || typeof evt !== "object") return "";
  const e = evt as Record<string, unknown>;
  if (typeof e.text === "string" && e.text) return e.text;
  if (typeof e.summary === "string" && e.summary) return e.summary;
  if (typeof e.message === "string" && e.message) return e.message;
  return "";
}

function eventKind(evt: unknown): string {
  if (!evt || typeof evt !== "object") return "unknown";
  const e = evt as Record<string, unknown>;
  if (typeof e.kind === "string") return e.kind;
  if (typeof e.type === "string") return e.type;
  return "night_event";
}
