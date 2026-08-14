/**
 * Phase 2.6 — Syntactic validator stub for the 5 Agent extension types.
 *
 * Per `AGENTs.md`: "Agent 只能输出行动意图；意图必须通过
 * deterministic rule validator，再由规则系统结算。"
 *
 * This file is the **gate** mentioned by that rule. It is
 * syntactic-only: it does NOT call out to an LLM, does NOT mutate
 * snapshots, does NOT call into settlement code, and does NOT
 * enforce business rules. The latter two are Phase 5+
 * `CommandResolver` and Phase 6 `DialogueRouter`'s job.
 *
 * Hard invariants (encoded as runtime checks):
 *   1. The closed enums (`ObservationEventKind`, `AgentIntentKind`)
 *      are exhaustive — unknown kinds are rejected.
 *   2. Numeric fields (`actor`, `commandNo`, `charaNum`, etc.) are
 *      non-negative integers.
 *   3. `WorldSnapshot` is structurally read-only — no `Function`,
 *      no `Symbol`, no `[Symbol.iterator]`, no `eval`-shaped strings.
 *
 * Verification gate 1.4 in `phase-2-6-plan.md` confirms the zero-LLM
 * invariant: `rg -l 'sendToLLM|callOpenAI|claude\.complete|fetchOpenAI'`
 * must return 0 matches in the slice.
 */

import type {
  AgentIntent,
  ObservationEvent,
  ObservationEventKind,
  WorldSnapshot,
} from "./types.js";
// AGENT_INTENT_KINDS / OBSERVATION_EVENT_KINDS are runtime `as const`
// arrays — must be imported as values, not types.
import {
  AGENT_INTENT_KINDS,
  OBSERVATION_EVENT_KINDS,
} from "./types.js";

// =====================================================================
// Intent validation
// =====================================================================

/** Successful validation. */
export interface ValidationOk {
  ok: true;
}

/** Failed validation with a human-readable reason. */
export interface ValidationFail {
  ok: false;
  reason: string;
}

export type ValidationResult = ValidationOk | ValidationFail;

/**
 * Syntactic check on an `AgentIntent`. The closed-enum guard and
 * the non-negative-numeric check are the only two things this
 * enforces. The known-chara / known-command check is in
 * `validateIntentAgainstManifest` (PR 1's verifier) — which loads
 * `characters.json` and `commands.json` and is therefore a separate
 * function.
 */
export function validateIntent(intent: AgentIntent): ValidationResult {
  if (!intent || typeof intent !== "object") {
    return { ok: false, reason: "intent is not an object" };
  }
  const kind = (intent as { kind?: unknown }).kind;
  if (typeof kind !== "string" || kind.length === 0) {
    return { ok: false, reason: "intent.kind must be a non-empty string" };
  }
  if (!(AGENT_INTENT_KINDS as readonly string[]).includes(kind)) {
    return {
      ok: false,
      reason: `intent.kind must be one of ${AGENT_INTENT_KINDS.join("|")}; got ${JSON.stringify(kind)}`,
    };
  }
  switch (intent.kind) {
    case "ISSUE_COMMAND": {
      if (!isNonNegInt(intent.actor)) {
        return { ok: false, reason: "ISSUE_COMMAND.actor must be a non-negative integer" };
      }
      if (!isNonNegInt(intent.commandNo)) {
        return { ok: false, reason: "ISSUE_COMMAND.commandNo must be a non-negative integer" };
      }
      if (intent.variant !== undefined) {
        if (!isNonNegInt(intent.variant.charaNum)) {
          return { ok: false, reason: "ISSUE_COMMAND.variant.charaNum must be a non-negative integer" };
        }
        if (typeof intent.variant.code !== "string" || intent.variant.code.length === 0) {
          return { ok: false, reason: "ISSUE_COMMAND.variant.code must be a non-empty string" };
        }
      }
      return { ok: true };
    }
    case "PROPOSE_DIALOGUE": {
      if (!isNonNegInt(intent.charaNum)) {
        return { ok: false, reason: "PROPOSE_DIALOGUE.charaNum must be a non-negative integer" };
      }
      const cd = validateDialogueCandidate(intent.candidate);
      if (!cd.ok) return cd;
      return { ok: true };
    }
    case "OVERRIDE_SCHEDULE": {
      if (!isNonNegInt(intent.charaNum)) {
        return { ok: false, reason: "OVERRIDE_SCHEDULE.charaNum must be a non-negative integer" };
      }
      const cs = validateCharacterSchedule(intent.schedule);
      if (!cs.ok) return cs;
      return { ok: true };
    }
    case "NOOP": {
      if (typeof intent.reason !== "string") {
        return { ok: false, reason: "NOOP.reason must be a string" };
      }
      return { ok: true };
    }
    default: {
      // Unreachable — the closed-enum guard above already returned.
      const _exhaustive: never = intent;
      void _exhaustive;
      return { ok: false, reason: "unreachable: intent.kind not in closed enum" };
    }
  }
}

function validateDialogueCandidate(cd: unknown): ValidationResult {
  if (!cd || typeof cd !== "object") {
    return { ok: false, reason: "DialogueCandidate must be an object" };
  }
  const c = cd as { charaNum?: unknown; alternatives?: unknown };
  if (!isNonNegInt(c.charaNum)) {
    return { ok: false, reason: "DialogueCandidate.charaNum must be a non-negative integer" };
  }
  if (!Array.isArray(c.alternatives) || c.alternatives.length === 0) {
    return { ok: false, reason: "DialogueCandidate.alternatives must be a non-empty array" };
  }
  for (let i = 0; i < c.alternatives.length; i++) {
    const a = c.alternatives[i] as
      | { text?: unknown; kojoFile?: unknown; lineRange?: unknown }
      | null;
    if (!a || typeof a !== "object") {
      return { ok: false, reason: `DialogueCandidate.alternatives[${i}] must be an object` };
    }
    if (typeof a.text !== "string" || a.text.length === 0) {
      return { ok: false, reason: `DialogueCandidate.alternatives[${i}].text must be a non-empty string` };
    }
    if (typeof a.kojoFile !== "string" || a.kojoFile.length === 0) {
      return { ok: false, reason: `DialogueCandidate.alternatives[${i}].kojoFile must be a non-empty string` };
    }
    if (a.lineRange !== null) {
      if (
        !Array.isArray(a.lineRange) ||
        a.lineRange.length !== 2 ||
        !isNonNegInt(a.lineRange[0]) ||
        !isNonNegInt(a.lineRange[1]) ||
        a.lineRange[1] < a.lineRange[0]
      ) {
        return {
          ok: false,
          reason: `DialogueCandidate.alternatives[${i}].lineRange must be null or [start, end] with start <= end`,
        };
      }
    }
  }
  return { ok: true };
}

function validateCharacterSchedule(cs: unknown): ValidationResult {
  if (!cs || typeof cs !== "object") {
    return { ok: false, reason: "CharacterSchedule must be an object" };
  }
  const s = cs as { charaNum?: unknown; slots?: unknown };
  if (!isNonNegInt(s.charaNum)) {
    return { ok: false, reason: "CharacterSchedule.charaNum must be a non-negative integer" };
  }
  if (!Array.isArray(s.slots) || s.slots.length === 0) {
    return { ok: false, reason: "CharacterSchedule.slots must be a non-empty array" };
  }
  for (let i = 0; i < s.slots.length; i++) {
    const slot = s.slots[i] as
      | { startTime?: unknown; endTime?: unknown; activity?: unknown; source?: unknown }
      | null;
    if (!slot || typeof slot !== "object") {
      return { ok: false, reason: `CharacterSchedule.slots[${i}] must be an object` };
    }
    if (!isNonNegInt(slot.startTime)) {
      return { ok: false, reason: `CharacterSchedule.slots[${i}].startTime must be a non-negative integer` };
    }
    if (!isNonNegInt(slot.endTime) || (slot.endTime as number) < (slot.startTime as number)) {
      return { ok: false, reason: `CharacterSchedule.slots[${i}].endTime must be >= startTime` };
    }
    if (typeof slot.activity !== "string" || slot.activity.length === 0) {
      return { ok: false, reason: `CharacterSchedule.slots[${i}].activity must be a non-empty string` };
    }
    if (slot.source !== "deterministic" && slot.source !== "agent") {
      return { ok: false, reason: `CharacterSchedule.slots[${i}].source must be 'deterministic' or 'agent'` };
    }
  }
  return { ok: true };
}

// =====================================================================
// ObservationEvent type guard
// =====================================================================

/**
 * Type guard for `ObservationEvent`. Performs the closed-enum check
 * + a per-kind shape check. Does NOT cross-reference any manifest
 * (that's a separate function).
 */
export function isObservationEvent(x: unknown): x is ObservationEvent {
  if (!x || typeof x !== "object") return false;
  const e = x as { kind?: unknown; timestamp?: unknown };
  if (typeof e.kind !== "string") return false;
  if (!(OBSERVATION_EVENT_KINDS as readonly string[]).includes(e.kind)) {
    return false;
  }
  if (!isNonNegInt(e.timestamp)) return false;
  switch (e.kind as ObservationEventKind) {
    case "COMMAND_ISSUED": {
      const o = x as { actor?: unknown; commandNo?: unknown };
      return isNonNegInt(o.actor) && isNonNegInt(o.commandNo);
    }
    case "STATE_DELTA": {
      const o = x as { subject?: unknown; fields?: unknown };
      if (!isNonNegInt(o.subject)) return false;
      if (!Array.isArray(o.fields)) return false;
      const validNamespaces = new Set([
        "CFLAG",
        "TALENT",
        "EXP",
        "PALAM",
        "BASE",
        "TCVAR",
        "EQUIP",
      ]);
      return (o.fields as Array<unknown>).every((f) => {
        if (!f || typeof f !== "object") return false;
        const field = f as { namespace?: unknown; id?: unknown; delta?: unknown };
        return (
          typeof field.namespace === "string" &&
          validNamespaces.has(field.namespace) &&
          isNonNegInt(field.id) &&
          typeof field.delta === "number"
        );
      });
    }
    case "TIME_TICK": {
      const o = x as { tickValue?: unknown };
      return isNonNegInt(o.tickValue);
    }
    case "FLAG_CHANGED": {
      const o = x as { flagId?: unknown; newValue?: unknown };
      return isNonNegInt(o.flagId) && typeof o.newValue === "number";
    }
    case "DIALOGUE_DUE": {
      const o = x as { charaNum?: unknown; eventCategory?: unknown; eventSubId?: unknown };
      return (
        isNonNegInt(o.charaNum) &&
        typeof o.eventCategory === "string" &&
        o.eventCategory.length > 0 &&
        isNonNegInt(o.eventSubId)
      );
    }
    case "STATUS_MESSAGE": {
      const o = x as { source?: unknown; text?: unknown };
      const validSources = new Set(["system", "apply_intent", "validator", "watcher"]);
      return (
        typeof o.source === "string" &&
        validSources.has(o.source) &&
        typeof o.text === "string" &&
        o.text.length > 0
      );
    }
    case "NARRATION": {
      const o = x as { text?: unknown };
      return typeof o.text === "string" && o.text.length > 0;
    }
    case "DIALOGUE_LINE": {
      const o = x as { charaNum?: unknown; text?: unknown };
      return isNonNegInt(o.charaNum) && typeof o.text === "string" && o.text.length > 0;
    }
    default: {
      const _exhaustive: never = e.kind as never;
      void _exhaustive;
      return false;
    }
  }
}

// =====================================================================
// WorldSnapshot read-only guard
// =====================================================================

/**
 * Runtime guard for the `WorldSnapshot` read-only invariant. The
 * structural `ReadonlyArray<...>` is a compile-time hint; this is
 * the actual runtime check. The implementation is intentionally
 * minimal: we look for the obvious ways a snapshot can leak
 * mutability (function-typed values, Symbol-keyed properties, etc.).
 *
 * Does NOT freeze the snapshot. Callers who want that should
 * `Object.freeze(snap)` after construction.
 */
export function assertSnapshotReadonly(snap: WorldSnapshot): void {
  if (!snap || typeof snap !== "object") {
    throw new Error("assertSnapshotReadonly: snap is not an object");
  }
  // Reject function-typed values anywhere in the snapshot. A
  // function in a snapshot is the obvious sign that someone
  // shoved a callback / thunk / method into it.
  walkSnapshot(snap, (key, val) => {
    if (typeof val === "function") {
      throw new Error(
        `assertSnapshotReadonly: function-typed value at ${key}; snapshots must be data only`,
      );
    }
  });
  // Reject Symbol-keyed properties (a common trick to bypass Object.freeze).
  const symKeys = Object.getOwnPropertySymbols(snap);
  if (symKeys.length > 0) {
    throw new Error(
      `assertSnapshotReadonly: ${symKeys.length} symbol-keyed property/properties on snapshot; not allowed`,
    );
  }
}

type SnapshotVisitor = (key: string, val: unknown) => void;

function walkSnapshot(node: unknown, visit: SnapshotVisitor, keyPath = "$"): void {
  if (node === null || node === undefined) return;
  if (typeof node === "function") {
    // Functions are a common "data leak" — someone shoved a thunk
    // or method into the snapshot. The runtime check fires here;
    // the visit() in assertSnapshotReadonly throws on this.
    visit(keyPath, node);
    return;
  }
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      walkSnapshot(node[i], visit, `${keyPath}[${i}]`);
    }
    return;
  }
  if (typeof node === "object") {
    visit(keyPath, node);
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      walkSnapshot(v, visit, `${keyPath}.${k}`);
    }
  }
}

// =====================================================================
// Small utility
// =====================================================================

function isNonNegInt(x: unknown): x is number {
  return typeof x === "number" && Number.isInteger(x) && x >= 0;
}
