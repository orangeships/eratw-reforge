import type { CharaSlot, GameState } from "./game-state.js";
import { alcoholTaste } from "./alcohol.js";
import { CFLAG_ID, EXP_ID, TALENT_ID } from "./settlement.js";
import { TFLAG_ID, getTflag } from "./tflag.js";

/** Named relationship stages used by authored dialogue. This is a read model:
 * command handlers remain the sole authority that grants/removes the source
 * talents. */
export type DialogueRelationshipStage = "ordinary" | "affection" | "love" | "lover";

export function deriveDialogueRelationshipStage(slot: CharaSlot): DialogueRelationshipStage {
  if ((slot.state.TALENT[TALENT_ID.恋人] ?? 0) !== 0) return "lover";
  if ((slot.state.TALENT[TALENT_ID.恋慕] ?? 0) !== 0) return "love";
  if ((slot.state.TALENT[TALENT_ID.思慕] ?? 0) !== 0) return "affection";
  return "ordinary";
}

/** Whether authored dialogue may select a relationship-specific voice arm. */
export function hasRelationshipDialogueState(slot: CharaSlot): boolean {
  return [
    TALENT_ID.思慕,
    TALENT_ID.恋慕,
    TALENT_ID.炮友,
    TALENT_ID.愛欲,
    TALENT_ID.恋人,
  ].some((id) => (slot.state.TALENT[id] ?? 0) !== 0);
}

/** Read-only facts that recur in authored dialogue but are not relationship
 * authority. Centralizing them prevents character packs from spelling raw
 * CFLAG/TALENT/EXP ids. */
export interface SexualDialogueFacts {
  readonly pentUp: number;
  readonly isIgnorant: boolean;
  readonly ecstasyExperience: number;
  readonly isStronglyPentUp: boolean;
}

export function deriveSexualDialogueFacts(slot: CharaSlot): SexualDialogueFacts {
  const pentUp = slot.state.CFLAG[CFLAG_ID.溜まってる度] ?? 0;
  const isIgnorant = (slot.state.TALENT[TALENT_ID.無知] ?? 0) !== 0;
  const ecstasyExperience = slot.state.EXP[EXP_ID.絶頂経験] ?? 0;
  return {
    pentUp,
    isIgnorant,
    ecstasyExperience,
    isStronglyPentUp: pentUp > 500 && isIgnorant && ecstasyExperience > 10,
  };
}

/** Read-only pregnancy facts for dialogue. Pregnancy settlement remains the
 * authority; packs only consume these named presentation predicates. */
export interface PregnancyDialogueFacts {
  readonly isPregnant: boolean;
  readonly isUnaware: boolean;
  readonly days: number;
  readonly isAwareLatePregnancy: boolean;
}

export function derivePregnancyDialogueFacts(slot: CharaSlot): PregnancyDialogueFacts {
  const isPregnant = (slot.state.TALENT[TALENT_ID.妊娠] ?? 0) !== 0;
  const isUnaware = (slot.state.CFLAG[CFLAG_ID.無自覚妊娠] ?? 0) !== 0;
  const days = slot.state.CFLAG[CFLAG_ID.妊娠経過日数] ?? 0;
  return {
    isPregnant,
    isUnaware,
    days,
    isAwareLatePregnancy: isPregnant && !isUnaware && days > 40,
  };
}

/** Transient character status facts relevant to presentation only. */
export interface DialogueStatusFacts {
  readonly isSleeping: boolean;
}

export function deriveDialogueStatusFacts(slot: CharaSlot): DialogueStatusFacts {
  return {
    isSleeping: (slot.state.CFLAG[CFLAG_ID.睡眠] ?? 0) !== 0,
  };
}

/** The command resolver owns the turn-local SELECTCOM outcome. Dialogue sees
 * only the stable acceptance fact, never the raw TFLAG storage or lifecycle. */
export interface DialogueCommandOutcomeFacts {
  readonly isAccepted: boolean;
  readonly selection: DialogueCommandResult;
  readonly resolutionOverride: DialogueCommandResult;
}

export type DialogueCommandResult = "greatSuccess" | "success" | "failure" | "other";

function commandResult(value: number): DialogueCommandResult {
  if (value === 1) return "greatSuccess";
  if (value === 0) return "success";
  if (value === -1) return "failure";
  return "other";
}

export function deriveDialogueCommandOutcomeFacts(
  state: Parameters<typeof getTflag>[0],
): DialogueCommandOutcomeFacts {
  const selection = getTflag(state, TFLAG_ID.SELECTCOM的分岐);
  return {
    isAccepted: selection >= 0,
    selection: commandResult(selection),
    resolutionOverride: commandResult(getTflag(state, TFLAG_ID.口上によるCOM成否判定)),
  };
}

/** Read-only alcohol facts for serving-drink dialogue. The drink handler owns
 * the served item and settlement; packs only receive its taste classification. */
export interface DialogueDrinkFacts {
  readonly taste: number;
  readonly preference: "liked" | "disliked" | "neutral";
}

export function deriveDialogueDrinkFacts(
  state: GameState,
  charaNum: number,
): DialogueDrinkFacts {
  const itemId = getTflag(state, TFLAG_ID.SOURCEなどに影響しないSELECTCOMの分岐);
  const taste = alcoholTaste(state, charaNum, itemId);
  return {
    taste,
    preference: taste >= 15 ? "liked" : taste <= 9 ? "disliked" : "neutral",
  };
}
