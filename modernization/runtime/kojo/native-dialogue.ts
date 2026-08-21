import type { Rng } from "../command/types.js";
import { deriveRelationshipAuthority, type RelationshipAuthoritySnapshot } from "../state/attitude.js";
import {
  deriveDialogueRelationshipStage,
  deriveDialogueStatusFacts,
  deriveDialogueCommandOutcomeFacts,
  deriveDialogueDrinkFacts,
  derivePregnancyDialogueFacts,
  deriveSexualDialogueFacts,
  type DialogueRelationshipStage,
  type DialogueCommandOutcomeFacts,
  type DialogueDrinkFacts,
  type DialogueStatusFacts,
  type PregnancyDialogueFacts,
  type SexualDialogueFacts,
} from "../state/dialogue-context.js";
import type { GameState } from "../state/game-state.js";
import { isTimeStopped } from "../command/h-mode.js";
import { getTflag, TFLAG_ID } from "../state/tflag.js";
import type {
  DialogueRouter,
  InteractiveKojoResolution,
  KojoLine,
  KojoResolution,
  PalamKojoKind,
} from "./types.js";
import { validateKojoLines } from "./text-validation.js";

export type NativeDialogueTrigger =
  | { kind: "command.completed"; commandNo: number; commandKind?: "COM" | "SCOM" }
  | { kind: "character.firstMet" }
  | { kind: "character.event"; arm: number; args: readonly number[] }
  | { kind: "character.spEvent"; subid: number; args: readonly number[] }
  | { kind: "character.roomDescription" }
  | { kind: "mark.acquired"; markId: 0 | 1 | 2 | 3 | 5; level: 1 | 2 | 3 }
  | { kind: "counter.triggered"; action: number }
  | { kind: "palam.changed"; palam: PalamKojoKind; detail: string | number | undefined; args: readonly number[] };

export interface NativeDialogueContext {
  readonly trigger: NativeDialogueTrigger;
  readonly charaNum: number;
  readonly masterName: string;
  readonly targetName: string;
  readonly location: string;
  readonly time: Readonly<Pick<GameState["time"], "tickValue" | "dayIndex" | "hourOfDay">>;
  readonly timeStopped: boolean;
  readonly relationship: RelationshipAuthoritySnapshot;
  readonly relationshipStage: DialogueRelationshipStage;
  readonly sexual: SexualDialogueFacts;
  readonly pregnancy: PregnancyDialogueFacts;
  readonly status: DialogueStatusFacts;
  readonly command: DialogueCommandOutcomeFacts;
  readonly drink: DialogueDrinkFacts;
  /** Immutable authoritative state for generated, source-backed assets. */
  readonly state: Readonly<GameState>;
}

export interface NativeDialogueRule {
  readonly id: string;
  readonly on: NativeDialogueTrigger["kind"];
  readonly priority: number;
  readonly when: (context: NativeDialogueContext) => boolean;
  readonly lines: (context: NativeDialogueContext, rng: Rng) => readonly KojoLine[];
}

export type NativeDialogueResolver = (
  context: NativeDialogueContext,
  rng: Rng,
) => KojoResolution | null;

export type NativeDialogueInteractiveResolver = (
  context: NativeDialogueContext,
  rng: Rng,
  choices: readonly number[],
) => InteractiveKojoResolution | null;

/** A character/variant-owned set of native dialogue rules. `claims` is
 * deliberately separate from a rule match: an authored native route that is
 * currently gated must stay silent rather than falling through to legacy ERB
 * or an AI response. */
export interface CharacterDialoguePack {
  readonly charaNum: number;
  /** Browser/Tauri selectedKojoVariants id; "0" is the default variant. */
  readonly variantId: string;
  readonly claims: (trigger: NativeDialogueTrigger) => boolean;
  readonly rules: readonly NativeDialogueRule[];
  /** Generated semantic assets cover the large authored route families. */
  readonly resolve?: NativeDialogueResolver;
  readonly resolveInteractive?: NativeDialogueInteractiveResolver;
}

function emptyResolution(status: "not-authored" | "gated"): KojoResolution {
  return {
    status,
    lines: [],
    effects: [],
    unsupportedPredicates: [],
    unsupportedEffects: [],
    diagnostics: [],
  };
}

function nativeContext(
  trigger: NativeDialogueTrigger,
  charaNum: number,
  state: Readonly<GameState>,
): NativeDialogueContext | null {
  const target = state.charas[charaNum];
  if (!target) return null;
  return {
    trigger,
    charaNum,
    masterName: state.master.callName?.trim() || "主人公",
    targetName: target.callName?.trim() || `角色${charaNum}`,
    location: target.location,
    time: state.time,
    timeStopped: isTimeStopped(state),
    relationship: deriveRelationshipAuthority(target, state.master, state),
    relationshipStage: deriveDialogueRelationshipStage(target),
    sexual: deriveSexualDialogueFacts(target),
    pregnancy: derivePregnancyDialogueFacts(target),
    status: deriveDialogueStatusFacts(target),
    command: deriveDialogueCommandOutcomeFacts(state),
    drink: deriveDialogueDrinkFacts(state as GameState, charaNum),
    state,
  };
}

function activePack(
  packs: readonly CharacterDialoguePack[],
  charaNum: number,
  state: Readonly<GameState>,
): CharacterDialoguePack | undefined {
  const selected = state.selectedKojoVariants?.[charaNum] ?? "0";
  return packs.find((pack) => pack.charaNum === charaNum && pack.variantId === selected);
}

function commandTrigger(state: Readonly<GameState>, commandNo: number): NativeDialogueTrigger {
  return {
    kind: "command.completed",
    commandNo,
    commandKind: getTflag(state, TFLAG_ID.派生コマンド) !== 0 ? "SCOM" : "COM",
  };
}

export function resolveNativeDialogue(
  pack: CharacterDialoguePack,
  trigger: NativeDialogueTrigger,
  charaNum: number,
  state: Readonly<GameState>,
  rng: Rng,
): KojoResolution {
  if (!pack.claims(trigger)) return emptyResolution("not-authored");
  const context = nativeContext(trigger, charaNum, state);
  if (!context) return emptyResolution("gated");
  const matched = pack.rules
    .filter((rule) => rule.on === trigger.kind && rule.when(context))
    .sort((left, right) => right.priority - left.priority)[0];
  if (!matched) return pack.resolve?.(context, rng) ?? emptyResolution("gated");
  const lines = [...matched.lines(context, rng)];
  const invalid = validateKojoLines(lines);
  if (invalid.length > 0) {
    return {
      status: "unsupported",
      lines: [],
      effects: [],
      unsupportedPredicates: [],
      unsupportedEffects: invalid.map((issue) => issue.detail),
      diagnostics: invalid.map((issue) => ({
        code: "unresolved-text" as const,
        detail: issue.detail,
        line: issue.line,
      })),
    };
  }
  return {
    status: "resolved",
    lines,
    effects: [],
    unsupportedPredicates: [],
    unsupportedEffects: [],
    diagnostics: [],
  };
}

function detailedOrCollected(
  router: DialogueRouter,
  charaNum: number,
  commandNo: number,
  state: Readonly<GameState>,
  rng: Rng,
): KojoResolution {
  return router.collectDetailed?.(charaNum, commandNo, state, rng) ?? {
    ...emptyResolution("not-authored"),
    status: "resolved",
    lines: router.collect(charaNum, commandNo, state, rng),
  };
}

function interactiveFrom(resolution: KojoResolution): InteractiveKojoResolution {
  return {
    status: resolution.status,
    lines: resolution.lines,
    pending: null,
    effects: resolution.effects,
    unsupportedPredicates: resolution.unsupportedPredicates,
    unsupportedEffects: resolution.unsupportedEffects,
    diagnostics: resolution.diagnostics,
  };
}

function resolveNativeInteractive(
  pack: CharacterDialoguePack,
  trigger: NativeDialogueTrigger,
  charaNum: number,
  state: Readonly<GameState>,
  rng: Rng,
  choices: readonly number[],
): InteractiveKojoResolution {
  const context = nativeContext(trigger, charaNum, state);
  if (!context) return interactiveFrom(emptyResolution("gated"));
  return pack.resolveInteractive?.(context, rng, choices) ??
    interactiveFrom(resolveNativeDialogue(pack, trigger, charaNum, state, rng));
}

/** Overlay native packs without changing the established DialogueRouter
 * contract. The returned router inherits every unowned category from the
 * base adapter, so Browser and Tauri consume the identical native result. */
export function createNativeDialogueRouter(
  base: DialogueRouter,
  packs: readonly CharacterDialoguePack[],
): DialogueRouter {
  const router = Object.create(base) as DialogueRouter;
  const commandDetailed = (
    charaNum: number,
    commandNo: number,
    state: Readonly<GameState>,
    rng: Rng,
  ): KojoResolution => {
    const pack = activePack(packs, charaNum, state);
    const trigger = commandTrigger(state, commandNo);
    if (pack?.claims(trigger)) return resolveNativeDialogue(pack, trigger, charaNum, state, rng);
    return detailedOrCollected(base, charaNum, commandNo, state, rng);
  };
  const encounterDetailed = (
    charaNum: number,
    state: Readonly<GameState>,
    rng: Rng,
  ): KojoResolution => {
    const pack = activePack(packs, charaNum, state);
    const trigger: NativeDialogueTrigger = { kind: "character.firstMet" };
    if (pack?.claims(trigger)) return resolveNativeDialogue(pack, trigger, charaNum, state, rng);
    return base.resolveEncounterKojoDetailed?.(charaNum, state, rng) ?? {
      ...emptyResolution("not-authored"),
      status: "resolved",
      lines: base.resolveEncounterKojo?.(charaNum, state, rng) ?? [],
    };
  };
  const eventDetailed = (
    charaNum: number,
    arm: number,
    state: Readonly<GameState>,
    rng: Rng,
    args: readonly number[] = [],
  ): KojoResolution => {
    const pack = activePack(packs, charaNum, state);
    const trigger: NativeDialogueTrigger = { kind: "character.event", arm, args };
    if (pack?.claims(trigger)) return resolveNativeDialogue(pack, trigger, charaNum, state, rng);
    return base.resolveEventKojoDetailed?.(charaNum, arm, state, rng, [...args]) ?? {
      ...emptyResolution("not-authored"),
      status: "resolved",
      lines: base.resolveEventKojo(charaNum, arm, state, rng, [...args]),
    };
  };
  const spEventDetailed = (
    charaNum: number,
    subid: number,
    state: Readonly<GameState>,
    rng: Rng,
    args: readonly number[] = [],
  ): KojoResolution => {
    const pack = activePack(packs, charaNum, state);
    const trigger: NativeDialogueTrigger = { kind: "character.spEvent", subid, args };
    if (pack?.claims(trigger)) return resolveNativeDialogue(pack, trigger, charaNum, state, rng);
    return base.resolveSpEventKojoDetailed?.(charaNum, subid, state, rng, [...args]) ?? {
      ...emptyResolution("not-authored"),
      status: "resolved",
      lines: base.resolveSpEventKojo(charaNum, subid, state, rng, [...args]),
    };
  };
  const markDetailed = (
    charaNum: number,
    level: 1 | 2 | 3,
    state: Readonly<GameState>,
    rng: Rng,
    markId: 0 | 1 | 2 | 3 | 5 = 3,
  ): KojoResolution => {
    const pack = activePack(packs, charaNum, state);
    const trigger: NativeDialogueTrigger = { kind: "mark.acquired", markId, level };
    if (pack?.claims(trigger)) return resolveNativeDialogue(pack, trigger, charaNum, state, rng);
    return base.resolveMarkKojoDetailed?.(charaNum, level, state, rng, markId) ?? {
      ...emptyResolution("not-authored"),
      status: "resolved",
      lines: base.resolveMarkKojo?.(charaNum, level, state, rng, markId) ?? [],
    };
  };
  const counterDetailed = (
    charaNum: number,
    action: number,
    state: Readonly<GameState>,
    rng: Rng,
  ): KojoResolution => {
    const pack = activePack(packs, charaNum, state);
    const trigger: NativeDialogueTrigger = { kind: "counter.triggered", action };
    if (pack?.claims(trigger)) return resolveNativeDialogue(pack, trigger, charaNum, state, rng);
    return base.resolveCounterKojoDetailed?.(charaNum, action, state, rng) ?? {
      ...emptyResolution("not-authored"),
      status: "resolved",
      lines: base.resolveCounterKojo?.(charaNum, action, state, rng) ?? [],
    };
  };
  const palamDetailed = (
    charaNum: number,
    palam: PalamKojoKind,
    detail: string | number | undefined,
    state: Readonly<GameState>,
    rng: Rng,
    args: readonly number[] = [],
  ): KojoResolution => {
    const pack = activePack(packs, charaNum, state);
    const trigger: NativeDialogueTrigger = { kind: "palam.changed", palam, detail, args };
    if (pack?.claims(trigger)) return resolveNativeDialogue(pack, trigger, charaNum, state, rng);
    return base.resolvePalamKojoDetailed?.(charaNum, palam, detail, state, rng, [...args]) ?? {
      ...emptyResolution("not-authored"),
      status: "resolved",
      lines: base.resolvePalamKojo?.(charaNum, palam, detail, state, rng, [...args]) ?? [],
    };
  };

  router.collect = (charaNum, commandNo, state, rng) =>
    commandDetailed(charaNum, commandNo, state, rng).lines;
  router.collectDetailed = commandDetailed;
  router.collectInteractive = (charaNum, commandNo, state, rng, choices) => {
    const pack = activePack(packs, charaNum, state);
    const trigger = commandTrigger(state, commandNo);
    if (pack?.claims(trigger)) return resolveNativeInteractive(pack, trigger, charaNum, state, rng, choices);
    return base.collectInteractive?.(charaNum, commandNo, state, rng, choices) ??
      interactiveFrom(detailedOrCollected(base, charaNum, commandNo, state, rng));
  };
  router.collectContinuation = (charaNum, commandNo, state, rng) => {
    const pack = activePack(packs, charaNum, state);
    const trigger = commandTrigger(state, commandNo);
    if (pack?.claims(trigger)) return { resolution: commandDetailed(charaNum, commandNo, state, rng), pending: null };
    return base.collectContinuation?.(charaNum, commandNo, state, rng) ?? {
      resolution: detailedOrCollected(base, charaNum, commandNo, state, rng), pending: null,
    };
  };
  router.resolveEncounterKojo = (charaNum, state, rng) =>
    encounterDetailed(charaNum, state, rng).lines;
  router.resolveEncounterKojoDetailed = encounterDetailed;
  router.resolveEncounterKojoInteractive = (charaNum, state, rng, choices) => {
    const pack = activePack(packs, charaNum, state);
    const trigger: NativeDialogueTrigger = { kind: "character.firstMet" };
    if (pack?.claims(trigger)) return resolveNativeInteractive(pack, trigger, charaNum, state, rng, choices);
    return base.resolveEncounterKojoInteractive?.(charaNum, state, rng, choices) ??
      interactiveFrom(encounterDetailed(charaNum, state, rng));
  };
  router.resolveEncounterKojoContinuation = (charaNum, state, rng) => {
    const pack = activePack(packs, charaNum, state);
    const trigger: NativeDialogueTrigger = { kind: "character.firstMet" };
    if (pack?.claims(trigger)) return { resolution: encounterDetailed(charaNum, state, rng), pending: null };
    return base.resolveEncounterKojoContinuation?.(charaNum, state, rng) ?? {
      resolution: encounterDetailed(charaNum, state, rng), pending: null,
    };
  };
  const roomDescriptionDetailed = (
    charaNum: number,
    state: Readonly<GameState>,
    rng: Rng,
  ): KojoResolution => {
    const pack = activePack(packs, charaNum, state);
    const trigger: NativeDialogueTrigger = { kind: "character.roomDescription" };
    if (pack?.claims(trigger)) return resolveNativeDialogue(pack, trigger, charaNum, state, rng);
    return base.resolveRoomDescriptionKojoDetailed?.(charaNum, state, rng) ?? {
      ...emptyResolution("not-authored"),
      status: "resolved",
      lines: base.resolveRoomDescriptionKojo?.(charaNum, state, rng) ?? [],
    };
  };
  router.resolveRoomDescriptionKojo = (charaNum, state, rng) =>
    roomDescriptionDetailed(charaNum, state, rng).lines;
  router.resolveRoomDescriptionKojoDetailed = roomDescriptionDetailed;
  router.resolveEventKojo = (charaNum, arm, state, rng, args = []) =>
    eventDetailed(charaNum, arm, state, rng, args).lines;
  router.resolveEventKojoDetailed = eventDetailed;
  router.resolveEventKojoInteractive = (charaNum, arm, state, rng, args, choices) => {
    const pack = activePack(packs, charaNum, state);
    const trigger: NativeDialogueTrigger = { kind: "character.event", arm, args: args ?? [] };
    if (pack?.claims(trigger)) return resolveNativeInteractive(pack, trigger, charaNum, state, rng, choices);
    return base.resolveEventKojoInteractive?.(charaNum, arm, state, rng, args, choices) ??
      interactiveFrom(eventDetailed(charaNum, arm, state, rng, args));
  };
  router.resolveSpEventKojo = (charaNum, subid, state, rng, args = []) =>
    spEventDetailed(charaNum, subid, state, rng, args).lines;
  router.resolveSpEventKojoDetailed = spEventDetailed;
  router.resolveSpEventKojoInteractive = (charaNum, subid, state, rng, args, choices) => {
    const pack = activePack(packs, charaNum, state);
    const trigger: NativeDialogueTrigger = { kind: "character.spEvent", subid, args: args ?? [] };
    if (pack?.claims(trigger)) return resolveNativeInteractive(pack, trigger, charaNum, state, rng, choices);
    return base.resolveSpEventKojoInteractive?.(charaNum, subid, state, rng, args, choices) ??
      interactiveFrom(spEventDetailed(charaNum, subid, state, rng, args));
  };
  router.resolveMarkKojo = (charaNum, level, state, rng, markId = 3) =>
    markDetailed(charaNum, level, state, rng, markId).lines;
  router.resolveMarkKojoDetailed = markDetailed;
  router.resolveCounterKojo = (charaNum, action, state, rng) =>
    counterDetailed(charaNum, action, state, rng).lines;
  router.resolveCounterKojoDetailed = counterDetailed;
  router.resolveCounterKojoInteractive = (charaNum, action, state, rng, choices) => {
    const pack = activePack(packs, charaNum, state);
    const trigger: NativeDialogueTrigger = { kind: "counter.triggered", action };
    if (pack?.claims(trigger)) return resolveNativeInteractive(pack, trigger, charaNum, state, rng, choices);
    return base.resolveCounterKojoInteractive?.(charaNum, action, state, rng, choices) ??
      interactiveFrom(counterDetailed(charaNum, action, state, rng));
  };
  router.resolveUpdateKojoInteractive = (charaNum, state, rng, choices) =>
    base.resolveUpdateKojoInteractive?.(charaNum, state, rng, choices) ??
    interactiveFrom(emptyResolution("not-authored"));
  router.hasUpdateKojo = (charaNum, state) =>
    base.hasUpdateKojo?.(charaNum, state) ?? false;
  router.resolvePalamKojo = (charaNum, palam, detail, state, rng, args = []) =>
    palamDetailed(charaNum, palam, detail, state, rng, args).lines;
  router.resolvePalamKojoDetailed = palamDetailed;
  return router;
}
