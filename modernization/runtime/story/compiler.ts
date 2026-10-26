import type { NarrativeContextV1 } from "./snapshot.js";
import { narrativeContextHash } from "./snapshot.js";
import { validateStoryGraphProposalV2, validateStoryProgramV2 } from "./validator-v2.js";
import {
  STORY_PROGRAM_V2_VERSION,
  type StoryGraphNodeV2,
  type StoryGraphProposalV2,
  type StoryProgramV2,
} from "./types.js";

export interface CompileStoryGraphOptions {
  createdAtTick: number;
  eventId?: string;
  arcId?: string;
  windowStartTick?: number;
  windowEndTick?: number;
}

export type StoryGraphCompilationResult =
  | { accepted: true; diagnostics: []; program: StoryProgramV2 }
  | { accepted: false; diagnostics: string[] };

/** Rewrite every implicit "fall through to the next array entry" link into an
 * explicit `nextNodeId`.
 *
 * Executor and validator both fall back to `index + 1` when a linear node has
 * no `nextNodeId`. That is fine for an immutable authored graph, but a
 * conversation that spans many rounds must prune finished nodes, and pruning
 * would silently re-point every implicit link at whatever slid into the gap.
 * Normalising once, at compile time, makes later pruning safe; the fallback
 * stays in the executor so saved programs compiled before this change still
 * resume correctly. */
export function normalizeExplicitLinks(nodes: readonly StoryGraphNodeV2[]): StoryGraphNodeV2[] {
  return nodes.map((node, index) => {
    if (node.kind === "end" || node.kind === "player-choice" || node.kind === "agent-choice" || node.kind === "director-choice") {
      return structuredClone(node);
    }
    if (node.nextNodeId) return structuredClone(node);
    const fallback = nodes[index + 1]?.id;
    return fallback ? { ...structuredClone(node), nextNodeId: fallback } : structuredClone(node);
  });
}

/** Accept an untrusted graph only after validating it against the exact
 * immutable snapshot/capability set. The returned program is a detached,
 * persisted runtime object and no longer consults model output. */
export function compileStoryGraphProposalV2(
  proposal: unknown,
  context: NarrativeContextV1,
  options: CompileStoryGraphOptions,
): StoryGraphCompilationResult {
  const diagnostics = validateStoryGraphProposalV2(proposal, {
    snapshot: context.snapshot,
    capabilities: context.capabilities,
    ...(options.windowStartTick === undefined ? {} : { windowStartTick: options.windowStartTick }),
    ...(options.windowEndTick === undefined ? {} : { windowEndTick: options.windowEndTick }),
  });
  if (diagnostics.length > 0) return { accepted: false, diagnostics };
  const accepted = structuredClone(proposal) as StoryGraphProposalV2;
  const usedCapabilityIds = new Set(
    accepted.nodes.filter((node) => node.kind === "capability").map((node) => node.capabilityId),
  );
  const capabilities = context.capabilities
    .filter((capability) => usedCapabilityIds.has(capability.id))
    .map((capability) => structuredClone(capability));
  const id = `story-v2:${options.createdAtTick}:${narrativeContextHash({ proposalId: accepted.proposalId, contextHash: accepted.contextHash, eventId: options.eventId ?? null, arcId: options.arcId ?? null })}`;
  const program: StoryProgramV2 = {
    version: STORY_PROGRAM_V2_VERSION,
    id,
    title: accepted.title,
    contextHash: accepted.contextHash,
    createdAtTick: options.createdAtTick,
    actorIds: [...accepted.participantIds],
    locationIds: [...accepted.locationIds],
    acceptedFactIds: [...accepted.factIds],
    startNodeId: accepted.startNodeId,
    nodes: normalizeExplicitLinks(accepted.nodes),
    cursorNodeId: accepted.startNodeId,
    status: "active",
    executedNodeIds: [],
    executedCapabilityIds: [],
    selectedChoices: {},
    capabilities,
    ...(options.eventId ? { eventId: options.eventId } : {}),
    ...(options.arcId ? { arcId: options.arcId } : {}),
  };
  const persistedDiagnostics = validateStoryProgramV2(program);
  return persistedDiagnostics.length > 0
    ? { accepted: false, diagnostics: persistedDiagnostics }
    : { accepted: true, diagnostics: [], program };
}

/** Append a new round to a program that is waiting on the player.
 *
 * This deliberately does NOT reuse `validateStoryGraphProposalV2`'s context
 * check: a continuation is generated from the world as it is *now*, so its
 * context hash is expected to differ from the one the story started under.
 * The new round is validated against the fresh snapshot while the program
 * keeps its original identity, because the dialogue session, the narrative
 * event and any saved references all point at `program.id`.
 *
 * Returns `diagnostics`-only failure without touching the input. */
export function compileStoryGraphContinuation(
  program: Readonly<StoryProgramV2>,
  proposal: unknown,
  context: NarrativeContextV1,
  options: { createdAtTick: number; windowStartTick?: number; windowEndTick?: number },
): StoryGraphCompilationResult {
  if (program.status !== "awaiting-player") {
    return { accepted: false, diagnostics: ["story program is not awaiting the player"] };
  }
  // The continuation is its own small graph, checked exactly like a first act.
  const diagnostics = validateStoryGraphProposalV2(proposal, {
    snapshot: context.snapshot,
    capabilities: context.capabilities,
    ...(options.windowStartTick === undefined ? {} : { windowStartTick: options.windowStartTick }),
    ...(options.windowEndTick === undefined ? {} : { windowEndTick: options.windowEndTick }),
  });
  if (diagnostics.length > 0) return { accepted: false, diagnostics };
  const accepted = structuredClone(proposal) as StoryGraphProposalV2;
  // A parked round is closed. Never carry old branches into a fresh graph.
  // Namespace ids to keep archived Experience identities unique.
  if (accepted.participantIds.some((id) => !program.actorIds.includes(id))
    || program.actorIds.some((id) => id !== 0 && !accepted.participantIds.includes(id))) {
    return { accepted: false, diagnostics: ["continuation changed the accepted cast"] };
  }
  // The next round happens where this story already is. The cast was staged
  // into the first act's scene and is held there; letting a later round name a
  // different room would describe people who are somewhere else — the exact
  // defect staging exists to prevent, one round later.
  if (accepted.locationIds[0] !== program.locationIds[0]) {
    return { accepted: false, diagnostics: ["continuation changed the accepted scene"] };
  }
  const prefix = `r${(program.roundIndex ?? 0) + 1}:`;
  const renamed = normalizeExplicitLinks(accepted.nodes).map((node) => {
    const clone = structuredClone(node) as StoryGraphNodeV2 & { options?: Array<{ nextNodeId: string }> };
    clone.id = `${prefix}${clone.id}`;
    if (clone.kind === "player-choice" || clone.kind === "agent-choice" || clone.kind === "director-choice") {
      clone.options = clone.options!.map((option) => ({ ...option, nextNodeId: `${prefix}${option.nextNodeId}` }));
    } else if (clone.kind !== "end" && clone.nextNodeId) {
      clone.nextNodeId = `${prefix}${clone.nextNodeId}`;
    }
    return clone;
  });
  const usedCapabilityIds = new Set(
    renamed.filter((node) => node.kind === "capability").map((node) => (node as { capabilityId: string }).capabilityId),
  );
  const appendedCapabilities = context.capabilities
    .filter((capability) => usedCapabilityIds.has(capability.id))
    .map((capability) => structuredClone(capability));
  const next: StoryProgramV2 = {
    ...(structuredClone(program) as StoryProgramV2),
    contextHash: accepted.contextHash,
    nodes: renamed,
    // The story's own scene, not the proposal's: the round stays where the
    // cast was staged, whatever else the graph stage listed.
    locationIds: [...program.locationIds],
    acceptedFactIds: [...accepted.factIds],
    startNodeId: `${prefix}${accepted.startNodeId}`,
    cursorNodeId: `${prefix}${accepted.startNodeId}`,
    status: "active",
    capabilities: appendedCapabilities,
    executedNodeIds: [],
    executedCapabilityIds: [],
    selectedChoices: {},
  };
  delete next.continuationEvidence;
  delete next.continuationAttemptId;
  const persistedDiagnostics = validateStoryProgramV2(next);
  return persistedDiagnostics.length > 0
    ? { accepted: false, diagnostics: persistedDiagnostics }
    : { accepted: true, diagnostics: [], program: next };
}
