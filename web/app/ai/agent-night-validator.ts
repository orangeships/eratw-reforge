import type { AgentNightResponse, AgentMemoryDraft } from "../../../modernization/runtime/agent/types.js";
import { jsonBody } from "./response-validator.js";

const MAX_MEMORIES = 4;
const MAX_GOAL_UPDATES = 2;
const MAX_TEXT = {
  memory: 300,
  reflection: 500,
  goal: 300,
  diary: 600,
} as const;

/**
 * Parse & validate a night cognitive-cycle JSON response.
 * Throws on any violation — the caller (agent-night.ts) catches and
 * falls back to deterministic behaviour for that character.
 */
export function parseAgentNightResponse(raw: string): AgentNightResponse {
  const body = jsonBody(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error("Agent night response is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Agent night response must be a JSON object");
  }
  const obj = parsed as Record<string, unknown>;

  if (obj.schemaVersion !== 1) throw new Error("schemaVersion must be 1");
  if (typeof obj.charaNum !== "number" || !Number.isInteger(obj.charaNum)) {
    throw new Error("charaNum must be an integer");
  }
  if (typeof obj.dayIndex !== "number" || !Number.isInteger(obj.dayIndex)) {
    throw new Error("dayIndex must be an integer");
  }
  if (typeof obj.contextHash !== "string" || !obj.contextHash) {
    throw new Error("contextHash must be a non-empty string");
  }

  // ── memoryDrafts ──────────────────────────────────────────
  let memoryDrafts: AgentMemoryDraft[] | undefined;
  if (obj.memoryDrafts !== undefined) {
    if (!Array.isArray(obj.memoryDrafts)) {
      throw new Error("memoryDrafts must be an array");
    }
    if (obj.memoryDrafts.length > MAX_MEMORIES) {
      throw new Error(`memoryDrafts max ${MAX_MEMORIES}, got ${obj.memoryDrafts.length}`);
    }
    memoryDrafts = [];
    for (let i = 0; i < obj.memoryDrafts.length; i++) {
      const draft = obj.memoryDrafts[i] as Record<string, unknown>;
      if (!draft || typeof draft !== "object") throw new Error(`memoryDrafts[${i}] must be an object`);
      if (typeof draft.observationId !== "string" || !draft.observationId) {
        throw new Error(`memoryDrafts[${i}].observationId must be a non-empty string`);
      }
      if (typeof draft.text !== "string" || !draft.text.trim()) {
        throw new Error(`memoryDrafts[${i}].text must be a non-empty string`);
      }
      if (draft.text.length > MAX_TEXT.memory) {
        throw new Error(`memoryDrafts[${i}].text exceeds ${MAX_TEXT.memory} chars`);
      }
      if (typeof draft.importance !== "number" || !Number.isFinite(draft.importance)) {
        throw new Error(`memoryDrafts[${i}].importance must be a number`);
      }
      if (draft.importance < 0 || draft.importance > 10) {
        throw new Error(`memoryDrafts[${i}].importance must be 0-10`);
      }
      memoryDrafts.push({
        observationId: String(draft.observationId),
        text: String(draft.text).trim().slice(0, MAX_TEXT.memory),
        importance: Math.max(0, Math.min(10, Math.round(draft.importance))),
      });
    }
  }

  // ── reflection ────────────────────────────────────────────
  let reflection: AgentNightResponse["reflection"];
  if (obj.reflection !== undefined) {
    if (obj.reflection === null) {
      reflection = undefined;
    } else if (typeof obj.reflection === "object" && obj.reflection !== null) {
      const r = obj.reflection as Record<string, unknown>;
      if (typeof r.text !== "string" || !r.text.trim()) {
        throw new Error("reflection.text must be a non-empty string");
      }
      if (r.text.length > MAX_TEXT.reflection) {
        throw new Error(`reflection.text exceeds ${MAX_TEXT.reflection} chars`);
      }
      reflection = { text: String(r.text).trim().slice(0, MAX_TEXT.reflection) };
    }
  }

  // ── goalUpdates ───────────────────────────────────────────
  let goalUpdates: AgentNightResponse["goalUpdates"];
  if (obj.goalUpdates !== undefined) {
    if (!Array.isArray(obj.goalUpdates)) {
      throw new Error("goalUpdates must be an array");
    }
    if (obj.goalUpdates.length > MAX_GOAL_UPDATES) {
      throw new Error(`goalUpdates max ${MAX_GOAL_UPDATES}, got ${obj.goalUpdates.length}`);
    }
    const validStatuses = new Set(["active", "completed", "abandoned"]);
    goalUpdates = [];
    for (let i = 0; i < obj.goalUpdates.length; i++) {
      const g = obj.goalUpdates[i] as Record<string, unknown>;
      if (!g || typeof g !== "object") throw new Error(`goalUpdates[${i}] must be an object`);
      if (typeof g.text !== "string" || !g.text.trim()) {
        throw new Error(`goalUpdates[${i}].text must be a non-empty string`);
      }
      if (g.text.length > MAX_TEXT.goal) {
        throw new Error(`goalUpdates[${i}].text exceeds ${MAX_TEXT.goal} chars`);
      }
      if (typeof g.status !== "string" || !validStatuses.has(g.status)) {
        throw new Error(`goalUpdates[${i}].status must be active|completed|abandoned`);
      }
      goalUpdates.push({
        ...(typeof g.goalId === "string" && g.goalId ? { goalId: g.goalId } : {}),
        text: String(g.text).trim().slice(0, MAX_TEXT.goal),
        status: g.status as "active" | "completed" | "abandoned",
      });
    }
  }

  // ── diary ─────────────────────────────────────────────────
  let diary: AgentNightResponse["diary"];
  if (obj.diary !== undefined) {
    if (obj.diary === null) {
      diary = undefined;
    } else if (typeof obj.diary === "object" && obj.diary !== null) {
      const d = obj.diary as Record<string, unknown>;
      if (typeof d.text !== "string" || !d.text.trim()) {
        throw new Error("diary.text must be a non-empty string");
      }
      if (d.text.length > MAX_TEXT.diary) {
        throw new Error(`diary.text exceeds ${MAX_TEXT.diary} chars`);
      }
      if (!Array.isArray(d.sourceObservationIds) || d.sourceObservationIds.length === 0) {
        throw new Error("diary.sourceObservationIds must be a non-empty array");
      }
      const sourceObservationIds = d.sourceObservationIds.filter(
        (id): id is string => typeof id === "string" && id.length > 0,
      );
      if (sourceObservationIds.length !== d.sourceObservationIds.length || sourceObservationIds.length > 8) {
        throw new Error("diary.sourceObservationIds contains invalid ids");
      }
      diary = { text: String(d.text).trim().slice(0, MAX_TEXT.diary), sourceObservationIds };
    }
  }

  // ── planSelections (A3) ──────────────────────────────────
  let planSelections: AgentNightResponse["planSelections"];
  if (obj.planSelections !== undefined) {
    if (!Array.isArray(obj.planSelections)) {
      throw new Error("planSelections must be an array");
    }
    if (obj.planSelections.length > 6) {
      throw new Error(`planSelections max 6, got ${obj.planSelections.length}`);
    }
    planSelections = [];
    for (let i = 0; i < obj.planSelections.length; i++) {
      const ps = obj.planSelections[i] as Record<string, unknown>;
      if (!ps || typeof ps !== "object") throw new Error(`planSelections[${i}] must be an object`);
      if (typeof ps.candidateId !== "string" || !ps.candidateId) {
        throw new Error(`planSelections[${i}].candidateId must be a non-empty string`);
      }
      if (typeof ps.windowStart !== "number" || !Number.isFinite(ps.windowStart)) {
        throw new Error(`planSelections[${i}].windowStart must be a number`);
      }
      if (typeof ps.windowEnd !== "number" || !Number.isFinite(ps.windowEnd)) {
        throw new Error(`planSelections[${i}].windowEnd must be a number`);
      }
      planSelections.push({
        candidateId: String(ps.candidateId),
        windowStart: Math.trunc(ps.windowStart),
        windowEnd: Math.trunc(ps.windowEnd),
      });
    }
  }

  // ── commissionSelections (A5) ──────────────────────────────
  let commissionSelections: AgentNightResponse["commissionSelections"];
  if (obj.commissionSelections !== undefined) {
    if (!Array.isArray(obj.commissionSelections)) {
      throw new Error("commissionSelections must be an array");
    }
    if (obj.commissionSelections.length > 1) {
      throw new Error(`commissionSelections max 1, got ${obj.commissionSelections.length}`);
    }
    const validActions = new Set(["propose", "defer"]);
    commissionSelections = [];
    for (let i = 0; i < obj.commissionSelections.length; i++) {
      const cs = obj.commissionSelections[i] as Record<string, unknown>;
      if (!cs || typeof cs !== "object") throw new Error(`commissionSelections[${i}] must be an object`);
      if (typeof cs.candidateId !== "string" || !cs.candidateId) {
        throw new Error(`commissionSelections[${i}].candidateId must be a non-empty string`);
      }
      if (typeof cs.action !== "string" || !validActions.has(cs.action)) {
        throw new Error(`commissionSelections[${i}].action must be propose|defer`);
      }
      commissionSelections.push({
        candidateId: String(cs.candidateId),
        action: cs.action as "propose" | "defer",
      });
    }
  }

  return {
    schemaVersion: 1,
    charaNum: obj.charaNum,
    dayIndex: obj.dayIndex,
    contextHash: obj.contextHash,
    memoryDrafts,
    reflection,
    goalUpdates,
    diary,
    planSelections,
    commissionSelections,
  };
}
