import type { GameState } from "../state/game-state.js";
import { applyRelationshipDelta } from "../state/relationship.js";
import { deriveRelationshipAuthority } from "../state/attitude.js";
import { CFLAG_ID } from "../state/settlement.js";
import { isTimeStopped } from "../command/h-mode.js";
import { alcoholFace } from "../state/alcohol.js";

export interface AiRelationshipAccount { sequence: number; day: number; favorSpent: number; trustSpent: number }
export interface AiRelationshipLedger { version: 1; accounts: Record<number, AiRelationshipAccount> }
export interface RelationshipGrant {
  id: string; evidenceId: string; target: number; sequence: number; day: number; tick: number; fingerprint: string;
  favorLimit: number; trustLimit: number;
}
export interface RelationshipProposal { grant_id: string; favor_delta: number; trust_delta: number; evidence_ids: string[]; reason: string }
export const RELATIONSHIP_LIMITS = { favor: 5, trust: 1, dailyFavor: 20, dailyTrust: 4 } as const;

function account(state: Readonly<GameState>, target: number): AiRelationshipAccount {
  return state.aiRelationshipLedger?.accounts[target] ?? { sequence: 0, day: state.time.dayIndex, favorSpent: 0, trustSpent: 0 };
}
function eligible(state: Readonly<GameState>, target: number): boolean {
  const slot = state.charas[target];
  return Boolean(target > 0 && slot && slot.location === state.master.location && !isTimeStopped(state)
    && !(slot.state.CFLAG[CFLAG_ID.睡眠] ?? 0) && alcoholFace(state, target) !== "不省人事");
}
function fingerprint(state: Readonly<GameState>, target: number): string {
  return JSON.stringify([state.time.tickValue, state.time.dayIndex, state.master.location, state.charas[target]?.location,
    state.charas[target] ? deriveRelationshipAuthority(state.charas[target]!, state.master, state) : null, account(state, target)]);
}
export function issueRelationshipGrant(state: Readonly<GameState>, target: number, interactionId: string): RelationshipGrant | undefined {
  if (!eligible(state, target) || !interactionId || interactionId.length > 180) return undefined;
  const a = account(state, target);
  const daily = a.day === state.time.dayIndex ? a : { favorSpent: 0, trustSpent: 0 };
  const favorLimit = Math.min(RELATIONSHIP_LIMITS.favor, RELATIONSHIP_LIMITS.dailyFavor - daily.favorSpent);
  const trustLimit = Math.min(RELATIONSHIP_LIMITS.trust, RELATIONSHIP_LIMITS.dailyTrust - daily.trustSpent);
  if (favorLimit <= 0 && trustLimit <= 0) return undefined;
  return { id: `${interactionId}:${target}:${a.sequence}`, evidenceId: interactionId, target, sequence: a.sequence,
    day: state.time.dayIndex, tick: state.time.tickValue, fingerprint: fingerprint(state, target), favorLimit, trustLimit };
}

/** Applies to the caller's private transaction state; no UI/provider authority. */
export function settleRelationshipProposal(state: GameState, grant: RelationshipGrant, raw: unknown):
  { status: "applied" | "rejected" | "duplicate"; reason: string; favorDelta: number; trustDelta: number } {
  const reject = (reason: string, status: "rejected" | "duplicate" = "rejected") => ({ status, reason, favorDelta: 0, trustDelta: 0 });
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return reject("invalid-shape");
  const p = raw as Record<string, unknown>;
  if (Object.keys(p).sort().join("|") !== "evidence_ids|favor_delta|grant_id|reason|trust_delta") return reject("unknown-fields");
  if (p.grant_id !== grant.id || !Array.isArray(p.evidence_ids) || p.evidence_ids.length !== 1 || p.evidence_ids[0] !== grant.evidenceId
    || typeof p.reason !== "string" || !p.reason.trim() || p.reason.length > 300) return reject("invalid-evidence");
  if (typeof p.favor_delta !== "number" || !Number.isSafeInteger(p.favor_delta) || typeof p.trust_delta !== "number" || !Number.isSafeInteger(p.trust_delta)) return reject("invalid-delta");
  const a = account(state, grant.target);
  if (a.sequence !== grant.sequence) return reject("consumed-grant", "duplicate");
  if (!eligible(state, grant.target) || fingerprint(state, grant.target) !== grant.fingerprint) return reject("stale-context");
  const favorSpent = a.day === state.time.dayIndex ? a.favorSpent : 0;
  const trustSpent = a.day === state.time.dayIndex ? a.trustSpent : 0;
  if (Math.abs(p.favor_delta) > Math.min(grant.favorLimit, RELATIONSHIP_LIMITS.favor)
    || Math.abs(p.trust_delta) > Math.min(grant.trustLimit, RELATIONSHIP_LIMITS.trust)
    || favorSpent + Math.abs(p.favor_delta) > RELATIONSHIP_LIMITS.dailyFavor
    || trustSpent + Math.abs(p.trust_delta) > RELATIONSHIP_LIMITS.dailyTrust) return reject("budget");
  const before = deriveRelationshipAuthority(state.charas[grant.target]!, state.master, state);
  if (!applyRelationshipDelta(state, grant.target, p.favor_delta, p.trust_delta)) return reject("missing-character");
  state.aiRelationshipLedger ??= { version: 1, accounts: {} };
  state.aiRelationshipLedger.accounts[grant.target] = { sequence: a.sequence + 1, day: state.time.dayIndex,
    favorSpent: favorSpent + Math.abs(p.favor_delta), trustSpent: trustSpent + Math.abs(p.trust_delta) };
  const after = deriveRelationshipAuthority(state.charas[grant.target]!, state.master, state);
  return { status: "applied", reason: "accepted", favorDelta: after.favor - before.favor, trustDelta: after.trust - before.trust };
}

export function normalizeRelationshipLedger(raw: unknown): AiRelationshipLedger {
  const accounts: Record<number, AiRelationshipAccount> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { version: 1, accounts };
  const value = raw as { version?: unknown; accounts?: unknown };
  if (value.version !== 1 || !value.accounts || typeof value.accounts !== "object" || Array.isArray(value.accounts)) return { version: 1, accounts };
  for (const [key, entry] of Object.entries(value.accounts).slice(0, 4096)) {
    if (!/^\d+$/.test(key) || !Number.isSafeInteger(Number(key)) || !entry || typeof entry !== "object") continue;
    const e = entry as AiRelationshipAccount;
    if (![e.sequence, e.day, e.favorSpent, e.trustSpent].every(n => Number.isSafeInteger(n) && n >= 0)) continue;
    accounts[Number(key)] = { sequence: e.sequence, day: e.day, favorSpent: Math.min(e.favorSpent, 20), trustSpent: Math.min(e.trustSpent, 4) };
  }
  return { version: 1, accounts };
}
