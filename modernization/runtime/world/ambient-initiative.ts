/**
 * Pure, browser-safe opportunity selection for optional L1 scene ambience.
 *
 * This module decides only whether a presentation opportunity exists and who
 * may appear in it. It never advances the clock, mutates GameState, or calls a
 * model. The Web sidecar owns request/session lifecycles.
 *
 * Upstream reference: `ERB/ANOTHER_TALK.ERB @ANOTHER_TALK_SET_TALKER` picks an
 * initiator and then the highest non-zero directional `RELATION:A:B` partner;
 * `MESSAGE_TALK(2)` reads both directions to distinguish mutual, one-sided,
 * and strained exchanges. We reuse only those pairing/tone semantics. The
 * generated prose itself is an intentional modern, default-off extension.
 */

export type AmbientInitiativeTrigger =
  | "location-idle"
  | "interaction-ended"
  | "free-action-changed"
  | "roster-changed";

export type AmbientInitiativeMode =
  | "character-dialogue"
  | "scene-interaction";

export type AmbientInitiativeKind =
  | "self-gesture"
  | "address-player"
  | "question-player"
  | "npc-exchange"
  | "event-echo";

export type AmbientNpcExchangeTone = "mutual" | "one-sided" | "strained" | "neutral";

export interface AmbientInitiativeCandidate {
  participantId: number;
  /** Relationship authority projected to a public 0..1 opportunity weight. */
  playerAffinity: number;
}

export interface AmbientInitiativeOpportunity {
  trigger: AmbientInitiativeTrigger;
  mode: AmbientInitiativeMode;
  kind: AmbientInitiativeKind;
  location: string;
  participantIds: number[];
  probability: number;
  initiatorId: number;
  partnerId?: number;
  forwardRelation?: number;
  reverseRelation?: number;
  exchangeTone?: AmbientNpcExchangeTone;
}

export interface SelectAmbientInitiativeInput {
  trigger: AmbientInitiativeTrigger;
  seed: number;
  nowMs: number;
  location: string;
  candidates: readonly AmbientInitiativeCandidate[];
  relationOf: (from: number, to: number) => number;
  locationCooldownUntil?: number;
  characterCooldownUntil?: Readonly<Record<number, number>>;
  scenePublishedCount: number;
  requestInFlight: boolean;
}

const BASE_PROBABILITY: Readonly<Record<AmbientInitiativeTrigger, number>> = {
  "location-idle": 0.07,
  "interaction-ended": 0.15,
  "free-action-changed": 0.20,
  "roster-changed": 0.20,
};

const MAX_PROBABILITY = 0.25;
const MAX_RELATION_MULTIPLIER = 1.3;

function mix32(value: number): number {
  let mixed = value | 0;
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x45d9f3b);
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x45d9f3b);
  return (mixed ^ (mixed >>> 16)) >>> 0;
}

/** Stable unit interval value used by tests and the selector. */
export function ambientRandomUnit(seed: number, salt: number): number {
  return mix32((seed | 0) ^ Math.imul(salt | 0, 0x9e3779b1)) / 0x1_0000_0000;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

export function ambientInitiativeProbability(
  trigger: AmbientInitiativeTrigger,
  candidates: readonly AmbientInitiativeCandidate[],
): number {
  const strongestAffinity = candidates.reduce(
    (strongest, candidate) => Math.max(strongest, clamp01(candidate.playerAffinity)),
    0,
  );
  const multiplier = Math.min(MAX_RELATION_MULTIPLIER, 1 + strongestAffinity * 0.3);
  return Math.min(MAX_PROBABILITY, BASE_PROBABILITY[trigger] * multiplier);
}

function weightedKind(
  seed: number,
  mode: AmbientInitiativeMode,
  trigger: AmbientInitiativeTrigger,
  hasPartner: boolean,
  affinity: number,
): AmbientInitiativeKind {
  const weights: Array<readonly [AmbientInitiativeKind, number]> = mode === "character-dialogue"
    ? [
        ["address-player", 22 + affinity * 18],
        ["question-player", 12 + affinity * 16],
      ]
    : [
        ["self-gesture", Math.max(10, 32 - affinity * 12)],
        ...(hasPartner ? [["npc-exchange", 28] as const] : []),
        ...(trigger === "interaction-ended" || trigger === "free-action-changed"
          ? [["event-echo", 18] as const]
          : []),
      ];
  const total = weights.reduce((sum, [, weight]) => sum + weight, 0);
  // Salt 3 is reserved for the independent 50/50 mode decision. Keep kind
  // selection on its own deterministic stream so changing the mode does not
  // reuse the same random value for two different decisions.
  let roll = ambientRandomUnit(seed, 4) * total;
  for (const [kind, weight] of weights) {
    if (roll < weight) return kind;
    roll -= weight;
  }
  return weights[weights.length - 1]![0];
}

function exchangeTone(forward: number, reverse: number): AmbientNpcExchangeTone {
  if (forward > 100 && reverse > 100) return "mutual";
  if ((forward > 100 && reverse < 100) || (forward < 100 && reverse > 100)) {
    return "one-sided";
  }
  if (forward < 100 && reverse < 100) return "strained";
  return "neutral";
}

export function selectAmbientInitiativeOpportunity(
  input: SelectAmbientInitiativeInput,
): AmbientInitiativeOpportunity | null {
  if (input.requestInFlight || input.scenePublishedCount >= 3) return null;
  if ((input.locationCooldownUntil ?? 0) > input.nowMs) return null;
  const candidates = input.candidates.filter(
    (candidate) =>
      candidate.participantId > 0 &&
      (input.characterCooldownUntil?.[candidate.participantId] ?? 0) <= input.nowMs,
  );
  if (candidates.length === 0) return null;

  const probability = ambientInitiativeProbability(input.trigger, candidates);
  if (ambientRandomUnit(input.seed, 1) >= probability) return null;

  const initiator = candidates[Math.floor(ambientRandomUnit(input.seed, 2) * candidates.length)]!;
  const mode: AmbientInitiativeMode = ambientRandomUnit(input.seed, 3) < 0.5
    ? "character-dialogue"
    : "scene-interaction";
  const possiblePartners = candidates
    .filter((candidate) => candidate.participantId !== initiator.participantId)
    .map((candidate) => ({
      candidate,
      relation: input.relationOf(initiator.participantId, candidate.participantId),
    }))
    // Faithful to ANOTHER_TALK: a zero directional relation is not a pair.
    .filter((entry) => entry.relation !== 0)
    .sort((left, right) =>
      right.relation - left.relation ||
      left.candidate.participantId - right.candidate.participantId,
    );
  const partner = possiblePartners[0];
  const kind = weightedKind(
    input.seed,
    mode,
    input.trigger,
    partner !== undefined,
    clamp01(initiator.playerAffinity),
  );

  if (kind !== "npc-exchange" || !partner) {
    return {
      trigger: input.trigger,
      mode,
      kind: kind === "npc-exchange" ? "self-gesture" : kind,
      location: input.location,
      participantIds: [initiator.participantId],
      probability,
      initiatorId: initiator.participantId,
    };
  }

  const forwardRelation = partner.relation;
  const reverseRelation = input.relationOf(partner.candidate.participantId, initiator.participantId);
  return {
    trigger: input.trigger,
    mode,
    kind,
    location: input.location,
    participantIds: [initiator.participantId, partner.candidate.participantId],
    probability,
    initiatorId: initiator.participantId,
    partnerId: partner.candidate.participantId,
    forwardRelation,
    reverseRelation,
    exchangeTone: exchangeTone(forwardRelation, reverseRelation),
  };
}
