import type { GameState } from "../state/game-state.js";
import { BASE_ID, CFLAG_ID, FLAG_ID } from "../state/settlement.js";

export const DIALOGUE_ACCOMPANY_ACTIONS = {
  "allow-accompany": "角色明确接受玩家现在一起出门的邀请；条件已经满足。",
  "invite-accompany": "角色主动邀请玩家现在一起出门，仍在等待玩家回应；不能替玩家同意。",
  "reject-accompany": "角色明确拒绝玩家现在一起出门的邀请。",
  "cancel-accompany": "角色明确撤回此前一起出门的约定或邀请。",
  "stop-accompany": "角色明确决定结束当前同行，不再跟随玩家。",
} as const;
export type DialogueAccompanyAction = keyof typeof DIALOGUE_ACCOMPANY_ACTIONS;

/** Closed capability proposals; a judge never names game fields or numeric effects. */
export interface DialogueActionInput {
  requestId: string;
  target: number;
  day: number;
  tick: number;
  location: string;
  playerText: string;
  characterText: string;
  allowedActions?: readonly DialogueAccompanyAction[];
  previousRequestId?: string;
  following?: boolean;
}

export interface DialogueActionJudge {
  judge(input: DialogueActionInput, signal: AbortSignal): Promise<unknown>;
}

/** Session-only permission. Save migration discards it, including forged saved values. */
export interface DialogueAccompanyPermit {
  phase: "offer" | "following" | "invited" | "rejected" | "cancelled";
  requestId: string;
  target: number;
  day: number;
  issuedTick: number;
  expiresTick: number;
  location: string;
}

export function canOfferDialogueAccompany(state: Readonly<GameState>, target: number): boolean {
  return canHoldDialogueConsent(state, target, false);
}

function canHoldDialogueConsent(state: Readonly<GameState>, target: number, following: boolean): boolean {
  const slot = state.charas[target];
  if (!slot || target <= 0 || target === state.master.charaNum || slot.location !== state.master.location) return false;
  const flags = slot.state.CFLAG;
  return !(state.flagStore[FLAG_ID.時間停止] ?? 0)
    && (state.master.state.BASE[BASE_ID.気力] ?? 0) > 0
    && !(state.master.state.CFLAG[CFLAG_ID.睡眠] ?? 0)
    && !(state.master.state.CFLAG[CFLAG_ID.陪睡中] ?? 0)
    && !(state.master.state.CFLAG[CFLAG_ID.诶嘿嘿] ?? 0)
    && !(state.master.state.CFLAG[CFLAG_ID.约会中] ?? 0)
    && !(flags[CFLAG_ID.睡眠] ?? 0) && !(flags[CFLAG_ID.陪睡中] ?? 0)
    && !(flags[CFLAG_ID.诶嘿嘿] ?? 0)
    && (following ? (flags[CFLAG_ID.同行] ?? 0) > 0 : !(flags[CFLAG_ID.同行] ?? 0))
    && (flags[CFLAG_ID.行动] ?? 0) !== 5;
}

export function prepareDialogueActionInput(
  state: Readonly<GameState>, target: number, requestId: string, playerText: string, characterText: string,
): DialogueActionInput | null {
  const following = canHoldDialogueConsent(state, target, true);
  if ((!canOfferDialogueAccompany(state, target) && !following) || !requestId || !characterText.trim() || characterText.length > 4000) return null;
  const previous = state.aiDialogueAccompany?.[target];
  const pending = previous && ["offer", "invited"].includes(previous.phase);
  const allowedActions: DialogueAccompanyAction[] = following ? ["stop-accompany"]
    : ["allow-accompany", "invite-accompany", pending ? "cancel-accompany" : "reject-accompany"];
  return { requestId, target, day: state.time.dayIndex, tick: state.time.tickValue,
    location: state.master.location, playerText: playerText.slice(0, 1000), characterText,
    allowedActions, previousRequestId: previous?.requestId, following };
}

export function hasDialogueAccompanyPermit(state: Readonly<GameState>, target: number): boolean {
  return validConsentPhase(state, target, "offer");
}

export function hasDialogueOutingConsent(state: Readonly<GameState>, target: number): boolean {
  return validConsentPhase(state, target, "following");
}

function validConsentPhase(state: Readonly<GameState>, target: number, phase: DialogueAccompanyPermit["phase"]): boolean {
  const permit = state.aiDialogueAccompany?.[target];
  return !!permit && permit.phase === phase && permit.target === target && permit.day === state.time.dayIndex
    && permit.location === state.master.location && state.time.tickValue >= permit.issuedTick
    && state.time.tickValue < permit.expiresTick && canHoldDialogueConsent(state, target, phase === "following");
}

export function hasDialogueAccompanyDecision(state: Readonly<GameState>, target: number): boolean {
  const phase = state.aiDialogueAccompany?.[target]?.phase;
  return !!phase && validConsentPhase(state, target, phase);
}

/** A spoken refusal and an unanswered NPC invitation also bind high-affection characters. */
export function blocksDialogueAccompany(state: Readonly<GameState>, target: number): boolean {
  const phase = state.aiDialogueAccompany?.[target]?.phase;
  return !!phase && ["invited", "rejected", "cancelled"].includes(phase)
    && validConsentPhase(state, target, phase);
}

export function dialogueAccompanyInvitations(state: Readonly<GameState>): DialogueAccompanyPermit[] {
  return Object.values(state.aiDialogueAccompany ?? {}).filter(permit => permit.phase === "invited"
    && validConsentPhase(state, permit.target, "invited")).sort((a, b) => a.issuedTick - b.issuedTick || a.target - b.target);
}

/** A player response is a deterministic input, never another model decision. */
export function respondDialogueAccompany(state: GameState, target: number, requestId: string,
  response: "accept" | "reject" | "cancel"): boolean {
  if (!["accept", "reject", "cancel"].includes(response)) return false;
  const permit = state.aiDialogueAccompany?.[target];
  if (!permit || permit.requestId !== requestId || !hasDialogueAccompanyDecision(state, target)
    || (response === "cancel" ? !["offer", "invited"].includes(permit.phase) : permit.phase !== "invited")) return false;
  permit.phase = response === "accept" ? "offer" : response === "reject" ? "rejected" : "cancelled";
  // Invalidate earlier judgments and repeated button clicks without refreshing the deadline.
  permit.requestId = `${requestId}:player-${response}`;
  return true;
}

/** COM351 consumes the offer but retains its receipt for one immediate COM405 departure. */
export function carryDialogueConsentToOuting(state: GameState, target: number): void {
  if (hasDialogueAccompanyPermit(state, target)) state.aiDialogueAccompany![target]!.phase = "following";
  else clearDialogueAccompanyPermit(state, target);
}

export function clearDialogueAccompanyPermit(state: GameState, target: number): void {
  if (state.aiDialogueAccompany) delete state.aiDialogueAccompany[target];
}

/** Called at state publication so leaving and returning cannot revive an old agreement. */
export function pruneDialogueAccompanyPermits(state: GameState): void {
  for (const target of Object.keys(state.aiDialogueAccompany ?? {}).map(Number)) {
    if (!hasDialogueAccompanyDecision(state, target)) clearDialogueAccompanyPermit(state, target);
  }
}

/** Returns a diagnostic, mutating only the Runtime-owned permission sidecar. */
export function acceptDialogueActionProposal(state: GameState, input: DialogueActionInput, proposal: unknown): string {
  const following = canHoldDialogueConsent(state, input.target, true);
  if ((!canOfferDialogueAccompany(state, input.target) && !following) || input.day !== state.time.dayIndex
    || input.tick !== state.time.tickValue || input.location !== state.master.location) return "stale";
  if (state.aiDialogueAccompany?.[input.target]?.requestId === input.requestId) return "duplicate";
  if (input.allowedActions && (state.aiDialogueAccompany?.[input.target]?.requestId !== input.previousRequestId
    || following !== input.following)) return "stale";
  if (!proposal || typeof proposal !== "object" || Array.isArray(proposal)) return "invalid";
  const value = proposal as Record<string, unknown>;
  if (value.action === "none" && Object.keys(value).every(key => key === "action")) return "none";
  const action = value.action as DialogueAccompanyAction;
  if (Object.keys(value).sort().join(",") !== "action,evidence" || !Object.hasOwn(DIALOGUE_ACCOMPANY_ACTIONS, action)
    || !(input.allowedActions ?? ["allow-accompany"]).includes(action)
    || (following ? action !== "stop-accompany" : action === "stop-accompany")
    || (action === "reject-accompany" && ["offer", "invited"].includes(state.aiDialogueAccompany?.[input.target]?.phase ?? ""))
    || (action === "cancel-accompany" && !["offer", "invited"].includes(state.aiDialogueAccompany?.[input.target]?.phase ?? ""))
    || typeof value.evidence !== "string" || value.evidence.trim().length < 2 || value.evidence.length > 120
    || !input.characterText.includes(value.evidence)) return "invalid";
  // The adapter executes the existing COM351 handler, including its settlement,
  // only after this validated stop intent. No model-authored field mutation.
  if (action === "stop-accompany") return "stop-requested";
  const phase = action === "allow-accompany" ? "offer" : action === "invite-accompany" ? "invited"
    : action === "reject-accompany" ? "rejected" : "cancelled";
  state.aiDialogueAccompany ??= {};
  state.aiDialogueAccompany[input.target] = { phase, requestId: input.requestId, target: input.target,
    day: input.day, issuedTick: input.tick, expiresTick: input.tick + 30, location: input.location };
  return "accepted";
}
