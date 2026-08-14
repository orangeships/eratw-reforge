import type { AgentPlanCandidate, AgentPlanSelection } from "./types.js";

/**
 * Validate a single plan selection against the candidate opportunity set.
 * Returns `null` if valid, or an error message string.
 */
export function validatePlanSelection(
  selection: AgentPlanSelection,
  candidates: AgentPlanCandidate[],
): string | null {
  // Must reference a valid candidate
  const candidate = candidates.find(
    (c) =>
      c.id === selection.candidateId &&
      c.windowStart === selection.windowStart &&
      c.windowEnd === selection.windowEnd,
  );
  if (!candidate) {
    return `unknown candidate "${selection.candidateId}" for window ${selection.windowStart}-${selection.windowEnd}`;
  }

  // Window must match exactly
  if (
    selection.windowStart !== candidate.windowStart ||
    selection.windowEnd !== candidate.windowEnd
  ) {
    return `window mismatch: selection ${selection.windowStart}-${selection.windowEnd} vs candidate ${candidate.windowStart}-${candidate.windowEnd}`;
  }

  return null; // valid
}

/**
 * Validate all plan selections, returning only the valid ones.
 * Invalid selections are silently dropped (per the plan: reject individually,
 * don't kill the whole plan).
 */
export function filterValidSelections(
  selections: AgentPlanSelection[],
  candidates: AgentPlanCandidate[],
  options: { notBeforeMinute?: number } = {},
): { valid: AgentPlanSelection[]; dropped: string[] } {
  const valid: AgentPlanSelection[] = [];
  const dropped: string[] = [];
  const occupiedWindows = new Set<string>();
  for (const sel of selections) {
    const err = validatePlanSelection(sel, candidates);
    if (err) {
      dropped.push(err);
      continue;
    }
    if (sel.windowStart < 0 || sel.windowEnd > 1440 || sel.windowStart >= sel.windowEnd) {
      dropped.push(`invalid window ${sel.windowStart}-${sel.windowEnd}`);
      continue;
    }
    if (options.notBeforeMinute !== undefined && sel.windowStart < options.notBeforeMinute) {
      dropped.push(`window ${sel.windowStart}-${sel.windowEnd} has already started`);
      continue;
    }
    const windowKey = `${sel.windowStart}:${sel.windowEnd}`;
    if (occupiedWindows.has(windowKey)) {
      dropped.push(`multiple selections for window ${sel.windowStart}-${sel.windowEnd}`);
      continue;
    }
    const overlaps = valid.some((accepted) =>
      sel.windowStart < accepted.windowEnd && accepted.windowStart < sel.windowEnd,
    );
    if (overlaps) {
      dropped.push(`overlapping window ${sel.windowStart}-${sel.windowEnd}`);
      continue;
    }
    occupiedWindows.add(windowKey);
    valid.push(sel);
  }
  return { valid, dropped };
}
