import { resolveKojoFunctionDetailed, resolveKojoNodeWithChoices } from "../static-router.js";
import { createGameStateKojoHostRegistry } from "../host-registry.js";
import { applyKojoEffects } from "../effects.js";
import type { CharacterDialoguePack, NativeDialogueContext, NativeDialogueTrigger } from "../native-dialogue.js";
import type { GameState } from "../../state/game-state.js";
import { TCVAR_ID } from "../../state/settlement.js";
import type { InteractiveKojoResolution, KojoFunctionResolution, KojoNode, KojoStagedEffect } from "../types.js";
import type { Rng } from "../../command/types.js";

/** Build output shared by all indexed source-backed native dialogue packs. */
export interface GeneratedNativeDialogueAssets {
  readonly sourceRouteCount: number;
  readonly byCom: Readonly<Record<string, KojoNode>>;
  readonly byScom: Readonly<Record<string, KojoNode>>;
  readonly byEvent: Readonly<Record<string, KojoNode>>;
  readonly bySpEvent: Readonly<Record<string, KojoNode>>;
  readonly byCounter: Readonly<Record<string, KojoNode>>;
  /** Literal dispatcher return contract from the wrapper that called the
   * indexed `_1` body. Dynamic RESULT propagation stays on the wrapper path. */
  readonly commandReturnPolicies?: Readonly<Record<string, GeneratedCommandReturnPolicy>>;
  /** Counter wrappers which source-verifiedly call EVENT_COUNTER_MESSAGE
   * before their indexed personal `_1` body. */
  readonly sharedCounterActions?: readonly number[];
  /** Event arms whose source-verified wrapper calls MESSAGE_GOODMONING
   * before the indexed personal body. */
  readonly sharedEventArms?: readonly number[];
  /** PALAM arms whose source-verified wrapper calls PALAM_MESSAGE_<arm>
   * before the indexed personal body. */
  readonly sharedPalamArms?: readonly string[];
  /** SP_EVENT subids whose source-verified wrapper calls
   * SPEVENT_MESSAGE_<subid> before the indexed personal body. */
  readonly sharedSpEventSubids?: readonly number[];
  /** When true, the personal mark wrapper is preceded by the shared
   * MARK_MESSAGE dispatcher. */
  readonly sharedMarkArms?: readonly number[];
  readonly byPalam: Readonly<Record<string, KojoNode>>;
  readonly encounter?: KojoNode;
  readonly mark?: KojoNode;
  /** The character's `@M_KOJO_UPDATE_K{XX}` body — invoked from the
   *  shop UPDATE menu via `TRYCALLFORM` semantics in upstream eraTW.
   *  Optional because most characters omit the update hook. */
  readonly update?: KojoNode;
}

export interface GeneratedCommandReturnPolicy {
  readonly kind: "constant";
  readonly value: number;
}

/** Generated direct action bodies from COUNTER_MESSAGE.ERB. They are not
 * character dialogue: a character pack composes one before its personal
 * COUNTER body only when that pack's upstream wrapper calls the dispatcher. */
export interface SharedCounterDialogueAssets {
  readonly sourceActionCount: number;
  readonly byAction: Readonly<Record<string, KojoNode>>;
}

/** Generated common EVENT bodies from upstream event dispatchers. */
export interface SharedEventDialogueAssets {
  readonly sourceArmCount: number;
  readonly byArm: Readonly<Record<string, KojoNode>>;
}

/**
 * Generated common PALAM bodies from upstream `EVENT_MESSAGE_ORGASM.ERB`.
 * The dedup prologue and color-restoration epilogue are stripped at build
 * time: the prologue becomes a per-chara bit guard on the active
 * `KojoExecutionFrame.doubleMessageBlockedByChara[target]` map, and the
 * color restoration becomes a `reset-color` host event, preserving renderer
 * channel state without pretending it is dialogue text.
 */
export interface SharedPalamDialogueAssets {
  readonly sourceArmCount: number;
  readonly byArm: Readonly<Record<string, KojoNode>>;
  /** Bit index in the per-chara frame-local dedup map (DIM.ERH:854). */
  readonly dedupBits: Readonly<Record<string, number>>;
  /** PALAM arms whose original body restores the active kojo color. */
  readonly colorResetArms: Readonly<Record<string, boolean>>;
  /** Arms whose final upstream WAIT maps to the dialogue acknowledgement boundary. */
  readonly terminalWaitArms: Readonly<Record<string, boolean>>;
}

/**
 * Generated common SPEVENT_MESSAGE_<subid> bodies from upstream
 * `EVENT_MESSAGE_MARK.ERB`. Same dedup prologue / color-restoration
 * stripping rules as `SharedPalamDialogueAssets`; the runtime guards via
 * `frame-double-message-bit(subid)` keyed on the SPEVENT_MESSAGE_<subid>
 * bit defined in `DIM.ERH:856`.
 */
export interface SharedSpEventDialogueAssets {
  readonly sourceSubidCount: number;
  readonly bySubid: Readonly<Record<string, KojoNode>>;
  readonly dedupBits: Readonly<Record<string, number>>;
  readonly omittedColorChannels: Readonly<Record<string, boolean>>;
}

/**
 * Generated MARK_MESSAGE dispatcher body. Its source-local
 * `MARK_MESSAGE_A/P/S/R/T` calls are expanded into this node in upstream
 * order; the dispatcher and its temporary `M:n` values stay frame-local.
 */
export interface SharedMarkDialogueAssets {
  readonly sourceBody: KojoNode;
  readonly dedupBit: number;
  /** MARK_MESSAGE's SET_KOJO_COLOR epilogue maps to `reset-color`. */
  readonly hasColorReset: boolean;
}

function nodeFor(assets: GeneratedNativeDialogueAssets, trigger: NativeDialogueTrigger): KojoNode | undefined {
  switch (trigger.kind) {
    case "command.completed": return (trigger.commandKind === "SCOM" ? assets.byScom : assets.byCom)[String(trigger.commandNo)];
    case "character.event": return assets.byEvent[String(trigger.arm)];
    case "character.spEvent": return assets.bySpEvent[String(trigger.subid)];
    case "counter.triggered": return assets.byCounter[String(trigger.action)];
    case "palam.changed": return assets.byPalam[`${trigger.palam}:${String(trigger.detail ?? "")}`] ?? assets.byPalam[`${trigger.palam}:`];
    case "character.firstMet": return assets.encounter;
    case "mark.acquired": return assets.mark;
  }
}

function sharedPalamArmOf(
  assets: GeneratedNativeDialogueAssets,
  trigger: NativeDialogueTrigger,
): string | undefined {
  if (trigger.kind !== "palam.changed") return undefined;
  const arm = trigger.palam;
  return assets.sharedPalamArms?.includes(arm) ? arm : undefined;
}

function sharedSpEventSubidOf(
  assets: GeneratedNativeDialogueAssets,
  trigger: NativeDialogueTrigger,
): number | undefined {
  if (trigger.kind !== "character.spEvent") return undefined;
  return assets.sharedSpEventSubids?.includes(trigger.subid) ? trigger.subid : undefined;
}

function sharedMarkArmOf(
  assets: GeneratedNativeDialogueAssets,
  trigger: NativeDialogueTrigger,
): number | undefined {
  if (trigger.kind !== "mark.acquired") return undefined;
  return assets.sharedMarkArms?.includes(trigger.markId) ? trigger.markId : undefined;
}

function argsFor(trigger: NativeDialogueTrigger): readonly number[] {
  if (trigger.kind === "character.event" || trigger.kind === "character.spEvent" || trigger.kind === "palam.changed") return trigger.args;
  return [];
}

const COUNTER_SUBJECT_LOCAL_ACTIONS = new Set([
  50, 51, 52, 53, 54, 55, 57, 58, 59, 60, 70, 71, 72, 73, 74, 75, 76,
  77, 80, 85, 87, 88, 89, 90, 91,
]);

function canSeedCounterSubjectLocal(state: Readonly<GameState>, charaNum: number): boolean {
  const target = state.charas[charaNum];
  if (!target) return false;
  return [
    TCVAR_ID.脱衣主角下半身,
    TCVAR_ID.脱衣目标下半身,
    TCVAR_ID.脱衣主角上半身,
    TCVAR_ID.脱衣目标上半身,
  ].every((id) => (target.state.TCVAR[id] ?? 0) === 0);
}

function withDispatcherReturnPolicy(
  assets: GeneratedNativeDialogueAssets,
  trigger: NativeDialogueTrigger,
  resolution: KojoFunctionResolution,
): KojoFunctionResolution {
  if (trigger.kind !== "command.completed") return resolution;
  const policy = assets.commandReturnPolicies?.[`${trigger.commandKind}:${trigger.commandNo}`];
  if (!policy) return resolution;
  return {
    ...resolution,
    returnValue: policy.value,
  };
}

/** Frame-local dedup guard. Returns `true` when the per-target bit is
 * already set in the active command frame, meaning the shared message has
 * already rendered in this command. Mirrors upstream
 * `IF GETBIT(DOUBLE_MESSAGE_BLOCKED:TARGET, N)` semantics. */
function frameBlocksDoubleMessage(
  state: Readonly<GameState>,
  target: number,
  bit: number,
): boolean {
  const frame = state.turnContext?.frame;
  if (!frame) return false;
  const bag = frame.doubleMessageBlockedByChara;
  if (!bag) return false;
  const current = bag[target] ?? 0;
  return (current & (1 << bit)) !== 0;
}

/** Compose shared + personal PALAM body under the per-frame dedup bit
 * guard. Mirrors upstream `PALAM_MESSAGE_<arm>` whose prologue is the
 * bit check and whose epilogue sets it before the printed text. */
function composeSharedPalamResolution(
  state: Readonly<GameState>,
  charaNum: number,
  arm: string,
  shared: KojoNode,
  dedupBit: number,
  colorHandling: "none" | "omit" | "reset",
  rng: Rng,
  args: readonly number[],
  resolvePersonal: (state: Readonly<GameState>) => KojoFunctionResolution,
): KojoFunctionResolution {
  const bitSetEffect: KojoStagedEffect = {
    kind: "frame-double-message-bit",
    target: charaNum,
    bit: dedupBit,
  };
  if (frameBlocksDoubleMessage(state, charaNum, dedupBit)) {
    // First call already rendered this frame. Upstream emits nothing and
    // returns so the personal arm runs its own branch (or nothing).
    return {
      status: "gated",
      lines: [],
      effects: [],
      unsupportedPredicates: [],
      unsupportedEffects: [],
      diagnostics: [],
      returnValue: 0,
      resultSlots: {},
    };
  }
  const sharedResult = resolveKojoFunctionDetailed(shared, charaNum, state, rng, args, {
    hostRegistry: createGameStateKojoHostRegistry({ state }),
  });
  // Unlike COUNTER/EVENT, the shared PALAM body may legitimately contain
  // structures the parser cannot yet execute (FOR/NEXT, deep SELECTCASE/
  // RAND, `CALL PrintMilkAndOmorashi`, `WAIT`, …). When that happens the
  // shared layer flips to `unsupported`, but the personal arm is still
  // author-owned and must run: only the *bit-set guard* is the shared host's
  // job. We therefore always run the personal pass and merge the diagnostics
  // so the personal text is not silently dropped. The frame-local bit-set
  // effect is always staged (when the personal arm is `unsupported` we still
  // stage it; applyKojoEffects will commit it on its own pass and the next
  // call within the frame will see the bit set).
  const stateAfterShared = applyKojoEffects(state, sharedResult.effects);
  const personal = resolvePersonal(stateAfterShared);
  const mergedDiagnostics = [
    ...sharedResult.diagnostics,
    ...personal.diagnostics,
    ...(colorHandling === "omit"
      ? [{ code: "unresolved-text" as const, detail: `${arm} omitted non-text color channel` }]
      : []),
  ];
  const mergedUnsupportedEffects = [
    ...sharedResult.unsupportedEffects,
    ...personal.unsupportedEffects,
    ...(colorHandling === "omit" ? [`${arm} omitted non-text color channel`] : []),
  ];
  // Surface the shared host's failure explicitly so diagnostics carry it.
  if (sharedResult.status === "unsupported") {
    mergedUnsupportedEffects.unshift(`${arm} shared host reported unsupported`);
  }
  const mergedUnsupportedPredicates = [
    ...sharedResult.unsupportedPredicates,
    ...personal.unsupportedPredicates,
  ];
  // The status follows the personal arm first; if personal is unsupported
  // the whole route stays unsupported (fail-closed). If the shared arm was
  // unsupported but personal resolved cleanly, we still surface the shared
  // failure via diagnostics + unsupportedEffects without breaking the lines.
  let status: "resolved" | "gated" | "unsupported";
  if (personal.status === "unsupported") status = "unsupported";
  else if (sharedResult.status === "resolved" || personal.status === "resolved") status = "resolved";
  else status = "gated";
  return {
    status,
    lines: [...sharedResult.lines, ...personal.lines],
    effects: [bitSetEffect, ...sharedResult.effects, ...personal.effects],
    unsupportedPredicates: mergedUnsupportedPredicates,
    unsupportedEffects: mergedUnsupportedEffects,
    diagnostics: mergedDiagnostics,
    hostEvents: [
      ...(sharedResult.hostEvents ?? []),
      ...(personal.hostEvents ?? []),
      ...(colorHandling === "reset" ? [{ kind: "reset-color" as const }] : []),
    ],
    returnValue: personal.returnValue,
    resultSlots: personal.resultSlots,
  };
}

function composeSharedPalamInteractive(
  state: Readonly<GameState>,
  charaNum: number,
  arm: string,
  shared: KojoNode,
  dedupBit: number,
  colorHandling: "none" | "omit" | "reset",
  rng: Rng,
  args: readonly number[],
  choices: readonly number[],
  resolvePersonal: (state: Readonly<GameState>) => InteractiveKojoResolution,
): InteractiveKojoResolution {
  const bitSetEffect: KojoStagedEffect = {
    kind: "frame-double-message-bit",
    target: charaNum,
    bit: dedupBit,
  };
  if (frameBlocksDoubleMessage(state, charaNum, dedupBit)) {
    return {
      status: "gated",
      lines: [],
      pending: null,
      effects: [],
      unsupportedPredicates: [],
      unsupportedEffects: [],
      diagnostics: [],
    };
  }
  const sharedResult = resolveKojoNodeWithChoices(shared, charaNum, state, rng, args, choices, {
    hostRegistry: createGameStateKojoHostRegistry({ state }),
  });
  if (sharedResult.pending) return sharedResult;
  const stateAfterShared = applyKojoEffects(state, sharedResult.effects);
  const personal = resolvePersonal(stateAfterShared);
  const diagnostics = [
    ...sharedResult.diagnostics,
    ...personal.diagnostics,
    ...(colorHandling === "omit"
      ? [{ code: "unresolved-text" as const, detail: `${arm} omitted non-text color channel` }]
      : []),
  ];
  let unsupportedEffects = [
    ...sharedResult.unsupportedEffects,
    ...personal.unsupportedEffects,
  ];
  if (colorHandling === "omit") unsupportedEffects.push(`${arm} omitted non-text color channel`);
  if (sharedResult.status === "unsupported") {
    unsupportedEffects.unshift(`${arm} shared host reported unsupported`);
  }
  let status: "resolved" | "gated" | "unsupported";
  if (personal.status === "unsupported") status = "unsupported";
  else if (sharedResult.status === "resolved" || personal.status === "resolved") status = "resolved";
  else status = "gated";
  return {
    status,
    lines: [...sharedResult.lines, ...personal.lines],
    pending: personal.pending,
    effects: [bitSetEffect, ...sharedResult.effects, ...personal.effects],
    unsupportedPredicates: [
      ...sharedResult.unsupportedPredicates,
      ...personal.unsupportedPredicates,
    ],
    unsupportedEffects,
    diagnostics,
    hostEvents: [
      ...(sharedResult.hostEvents ?? []),
      ...(personal.hostEvents ?? []),
      ...(colorHandling === "reset" ? [{ kind: "reset-color" as const }] : []),
    ],
  };
}

export function generatedAssetClaims(assets: GeneratedNativeDialogueAssets, trigger: NativeDialogueTrigger): boolean {
  return nodeFor(assets, trigger) !== undefined;
}

export function resolveGeneratedAsset(
  assets: GeneratedNativeDialogueAssets,
  context: NativeDialogueContext,
  rng: Rng,
  sharedCounterAssets?: SharedCounterDialogueAssets,
  sharedEventAssets?: SharedEventDialogueAssets,
  sharedPalamAssets?: SharedPalamDialogueAssets,
  sharedSpEventAssets?: SharedSpEventDialogueAssets,
  sharedMarkAssets?: SharedMarkDialogueAssets,
): KojoFunctionResolution | null {
  const node = nodeFor(assets, context.trigger);
  if (!node) return null;
  const commandNo = context.trigger.kind === "command.completed" ? context.trigger.commandNo : undefined;
  const resolvePersonal = (state: NativeDialogueContext["state"]) => withDispatcherReturnPolicy(
    assets,
    context.trigger,
    resolveKojoFunctionDetailed(node, context.charaNum, state, rng, argsFor(context.trigger), {
      commandNo,
      hostRegistry: createGameStateKojoHostRegistry({ state }),
    }),
  );
  if (context.trigger.kind !== "counter.triggered" || !assets.sharedCounterActions?.includes(context.trigger.action)) {
    if (context.trigger.kind !== "character.event" || !assets.sharedEventArms?.includes(context.trigger.arm)) {
      const sharedPalamArm = sharedPalamArmOf(assets, context.trigger);
      if (sharedPalamArm) {
        const sharedNode = sharedPalamAssets?.byArm[sharedPalamArm];
        const dedupBit = sharedPalamAssets?.dedupBits[sharedPalamArm];
        if (!sharedNode || dedupBit === undefined) {
          return unsupportedSharedPalam(sharedPalamArm);
        }
        const resetsColor = sharedPalamAssets.colorResetArms[sharedPalamArm] === true;
        return composeSharedPalamResolution(
          context.state,
          context.charaNum,
          sharedPalamArm,
          sharedNode,
          dedupBit,
          resetsColor ? "reset" : "none",
          rng,
          argsFor(context.trigger),
          resolvePersonal,
        );
      }
      const sharedSpEventSubid = sharedSpEventSubidOf(assets, context.trigger);
      if (sharedSpEventSubid !== undefined && context.trigger.kind === "character.spEvent") {
        const sharedNode = sharedSpEventAssets?.bySubid[String(sharedSpEventSubid)];
        const dedupBit = sharedSpEventAssets?.dedupBits[String(sharedSpEventSubid)];
        if (!sharedNode || dedupBit === undefined) {
          return unsupportedSharedSpEvent(sharedSpEventSubid);
        }
        const omitColor = sharedSpEventAssets.omittedColorChannels[String(sharedSpEventSubid)] === true;
        return composeSharedPalamResolution(
          context.state,
          context.charaNum,
          `SPEVENT_MESSAGE_${sharedSpEventSubid}`,
          sharedNode,
          dedupBit,
          omitColor ? "omit" : "none",
          rng,
          argsFor(context.trigger),
          resolvePersonal,
        );
      }
      const sharedMarkArm = sharedMarkArmOf(assets, context.trigger);
      if (sharedMarkArm !== undefined && context.trigger.kind === "mark.acquired" && sharedMarkAssets) {
        const sharedNode = sharedMarkAssets.sourceBody;
        const dedupBit = sharedMarkAssets.dedupBit;
        return composeSharedPalamResolution(
          context.state,
          context.charaNum,
          "MARK_MESSAGE",
          sharedNode,
          dedupBit,
          sharedMarkAssets.hasColorReset ? "reset" : "none",
          rng,
          argsFor(context.trigger),
          resolvePersonal,
        );
      }
      return resolvePersonal(context.state);
    }
    const common = sharedEventAssets?.byArm[String(context.trigger.arm)];
    if (!common) return unsupportedSharedEvent(context.trigger.arm);
    const shared = resolveKojoFunctionDetailed(common, context.charaNum, context.state, rng, argsFor(context.trigger), {
      hostRegistry: createGameStateKojoHostRegistry({ state: context.state }),
    });
    if (shared.status === "unsupported") return shared;
    const personal = resolvePersonal(applyKojoEffects(context.state, shared.effects));
    if (personal.status === "unsupported") return personal;
    return {
      status: shared.status === "resolved" || personal.status === "resolved" ? "resolved" : "gated",
      lines: [...shared.lines, ...personal.lines],
      effects: [...shared.effects, ...personal.effects],
      unsupportedPredicates: [],
      unsupportedEffects: [],
      diagnostics: [],
      returnValue: personal.returnValue,
      resultSlots: personal.resultSlots,
    };
  }
  const common = sharedCounterAssets?.byAction[String(context.trigger.action)];
  if (!common) return unsupportedSharedCounter(context.trigger.action);
  if (COUNTER_SUBJECT_LOCAL_ACTIONS.has(context.trigger.action) &&
    !canSeedCounterSubjectLocal(context.state, context.charaNum)) {
    return unsupportedCounterDatuiPrelude(context.trigger.action);
  }
  const shared = resolveKojoFunctionDetailed(common, context.charaNum, context.state, rng, [], {
    hostRegistry: createGameStateKojoHostRegistry({ state: context.state }),
    vm: { locals: [], result: [], namedLocals: { 有主语: 0 } },
    // The regenerated shared asset keeps %CALLNAME:TARGET% as a runtime
    // token — resolve it against the pack's target so the narration names
    // the actual character instead of the neutral fallback.
    targetName: context.targetName,
    masterName: context.masterName,
  });
  if (shared.status === "unsupported") return shared;
  const personal = resolvePersonal(applyKojoEffects(context.state, shared.effects));
  if (personal.status === "unsupported") return personal;
  return {
    status: shared.status === "resolved" || personal.status === "resolved" ? "resolved" : "gated",
    lines: [...shared.lines, ...personal.lines],
    effects: [...shared.effects, ...personal.effects],
    unsupportedPredicates: [],
    unsupportedEffects: [],
    diagnostics: [],
    returnValue: personal.returnValue,
    resultSlots: personal.resultSlots,
  };
}

export function resolveGeneratedAssetInteractive(
  assets: GeneratedNativeDialogueAssets,
  context: NativeDialogueContext,
  rng: Rng,
  choices: readonly number[],
  sharedCounterAssets?: SharedCounterDialogueAssets,
  sharedEventAssets?: SharedEventDialogueAssets,
  sharedPalamAssets?: SharedPalamDialogueAssets,
  sharedSpEventAssets?: SharedSpEventDialogueAssets,
  sharedMarkAssets?: SharedMarkDialogueAssets,
): InteractiveKojoResolution | null {
  const node = nodeFor(assets, context.trigger);
  if (!node) return null;
  const commandNo = context.trigger.kind === "command.completed" ? context.trigger.commandNo : undefined;
  const resolvePersonal = (state: NativeDialogueContext["state"]) => resolveKojoNodeWithChoices(node, context.charaNum, state, rng, argsFor(context.trigger), choices, {
    commandNo,
    hostRegistry: createGameStateKojoHostRegistry({ state }),
  });
  if (context.trigger.kind !== "counter.triggered" || !assets.sharedCounterActions?.includes(context.trigger.action)) {
    if (context.trigger.kind !== "character.event" || !assets.sharedEventArms?.includes(context.trigger.arm)) {
      const sharedPalamArm = sharedPalamArmOf(assets, context.trigger);
      if (sharedPalamArm) {
        const sharedNode = sharedPalamAssets?.byArm[sharedPalamArm];
        const dedupBit = sharedPalamAssets?.dedupBits[sharedPalamArm];
        if (!sharedNode || dedupBit === undefined) {
          return interactiveUnsupportedSharedPalam(sharedPalamArm);
        }
        const resetsColor = sharedPalamAssets.colorResetArms[sharedPalamArm] === true;
        return composeSharedPalamInteractive(
          context.state,
          context.charaNum,
          sharedPalamArm,
          sharedNode,
          dedupBit,
          resetsColor ? "reset" : "none",
          rng,
          argsFor(context.trigger),
          choices,
          resolvePersonal,
        );
      }
      const sharedSpEventSubid = sharedSpEventSubidOf(assets, context.trigger);
      if (sharedSpEventSubid !== undefined && context.trigger.kind === "character.spEvent") {
        const sharedNode = sharedSpEventAssets?.bySubid[String(sharedSpEventSubid)];
        const dedupBit = sharedSpEventAssets?.dedupBits[String(sharedSpEventSubid)];
        if (!sharedNode || dedupBit === undefined) {
          return interactiveUnsupportedSharedSpEvent(sharedSpEventSubid);
        }
        const omitColor = sharedSpEventAssets.omittedColorChannels[String(sharedSpEventSubid)] === true;
        return composeSharedPalamInteractive(
          context.state,
          context.charaNum,
          `SPEVENT_MESSAGE_${sharedSpEventSubid}`,
          sharedNode,
          dedupBit,
          omitColor ? "omit" : "none",
          rng,
          argsFor(context.trigger),
          choices,
          resolvePersonal,
        );
      }
      const sharedMarkArm = sharedMarkArmOf(assets, context.trigger);
      if (sharedMarkArm !== undefined && context.trigger.kind === "mark.acquired" && sharedMarkAssets) {
        return composeSharedPalamInteractive(
          context.state,
          context.charaNum,
          "MARK_MESSAGE",
          sharedMarkAssets.sourceBody,
          sharedMarkAssets.dedupBit,
          sharedMarkAssets.hasColorReset ? "reset" : "none",
          rng,
          argsFor(context.trigger),
          choices,
          resolvePersonal,
        );
      }
      return resolvePersonal(context.state);
    }
    const common = sharedEventAssets?.byArm[String(context.trigger.arm)];
    if (!common) return interactiveUnsupportedSharedEvent(context.trigger.arm);
    const shared = resolveKojoNodeWithChoices(common, context.charaNum, context.state, rng, argsFor(context.trigger), choices, {
      hostRegistry: createGameStateKojoHostRegistry({ state: context.state }),
    });
    if (shared.status === "unsupported" || shared.pending) return shared;
    const personal = resolvePersonal(applyKojoEffects(context.state, shared.effects));
    if (personal.status === "unsupported") return personal;
    return {
      status: shared.status === "resolved" || personal.status === "resolved" ? "resolved" : "gated",
      lines: [...shared.lines, ...personal.lines],
      pending: personal.pending,
      effects: [...shared.effects, ...personal.effects],
      unsupportedPredicates: [],
      unsupportedEffects: [],
      diagnostics: [],
    };
  }
  const common = sharedCounterAssets?.byAction[String(context.trigger.action)];
  if (!common) return interactiveUnsupportedSharedCounter(context.trigger.action);
  if (COUNTER_SUBJECT_LOCAL_ACTIONS.has(context.trigger.action) &&
    !canSeedCounterSubjectLocal(context.state, context.charaNum)) {
    return interactiveUnsupportedCounterDatuiPrelude(context.trigger.action);
  }
  const shared = resolveKojoNodeWithChoices(common, context.charaNum, context.state, rng, [], choices, {
    hostRegistry: createGameStateKojoHostRegistry({ state: context.state }),
    vm: { locals: [], result: [], namedLocals: { 有主语: 0 } },
    // Unbranded shared asset: resolve %CALLNAME:TARGET% at runtime.
    targetName: context.targetName,
    masterName: context.masterName,
  });
  if (shared.status === "unsupported" || shared.pending) return shared;
  const personal = resolvePersonal(applyKojoEffects(context.state, shared.effects));
  if (personal.status === "unsupported") return personal;
  return {
    status: shared.status === "resolved" || personal.status === "resolved" ? "resolved" : "gated",
    lines: [...shared.lines, ...personal.lines],
    pending: personal.pending,
    effects: [...shared.effects, ...personal.effects],
    unsupportedPredicates: [],
    unsupportedEffects: [],
    diagnostics: [],
  };
}

/**
 * Adapt one generated indexed asset to the shared Browser/Tauri native-pack
 * contract. The pack claims every source-backed route, including routes that
 * currently resolve as unsupported, so they cannot silently fall through to
 * the compatibility or AI router.
 */
export function createGeneratedNativeDialoguePack(
  charaNum: number,
  variantId: string,
  assets: GeneratedNativeDialogueAssets,
  sharedCounterAssets?: SharedCounterDialogueAssets,
  sharedEventAssets?: SharedEventDialogueAssets,
  sharedPalamAssets?: SharedPalamDialogueAssets,
  sharedSpEventAssets?: SharedSpEventDialogueAssets,
  sharedMarkAssets?: SharedMarkDialogueAssets,
): CharacterDialoguePack {
  return {
    charaNum,
    variantId,
    claims: (trigger) => generatedAssetClaims(assets, trigger),
    rules: [],
    resolve: (context, rng) => resolveGeneratedAsset(
      assets,
      context,
      rng,
      sharedCounterAssets,
      sharedEventAssets,
      sharedPalamAssets,
      sharedSpEventAssets,
      sharedMarkAssets,
    ),
    resolveInteractive: (context, rng, choices) => resolveGeneratedAssetInteractive(
      assets,
      context,
      rng,
      choices,
      sharedCounterAssets,
      sharedEventAssets,
      sharedPalamAssets,
      sharedSpEventAssets,
      sharedMarkAssets,
    ),
  };
}

function unsupportedSharedCounter(action: number): KojoFunctionResolution {
  const detail = `shared COUNTER:${action} asset unavailable`;
  return {
    status: "unsupported",
    lines: [],
    effects: [],
    unsupportedPredicates: [],
    unsupportedEffects: [detail],
    diagnostics: [{ code: "unsupported-effect", detail }],
    returnValue: 0,
    resultSlots: {},
  };
}

function interactiveUnsupportedSharedCounter(action: number): InteractiveKojoResolution {
  return { ...unsupportedSharedCounter(action), pending: null };
}

function unsupportedCounterDatuiPrelude(action: number): KojoFunctionResolution {
  const detail = `shared COUNTER:${action} requires an unmodeled DATUI_MESSAGE prelude`;
  return {
    status: "unsupported",
    lines: [],
    effects: [],
    unsupportedPredicates: [],
    unsupportedEffects: [detail],
    diagnostics: [{ code: "unsupported-effect", detail }],
    returnValue: 0,
    resultSlots: {},
  };
}

function interactiveUnsupportedCounterDatuiPrelude(action: number): InteractiveKojoResolution {
  return { ...unsupportedCounterDatuiPrelude(action), pending: null };
}

function unsupportedSharedEvent(arm: number): KojoFunctionResolution {
  const detail = `shared EVENT:${arm} asset unavailable`;
  return {
    status: "unsupported",
    lines: [],
    effects: [],
    unsupportedPredicates: [],
    unsupportedEffects: [detail],
    diagnostics: [{ code: "unsupported-effect", detail }],
    returnValue: 0,
    resultSlots: {},
  };
}

function interactiveUnsupportedSharedEvent(arm: number): InteractiveKojoResolution {
  return { ...unsupportedSharedEvent(arm), pending: null };
}

function unsupportedSharedPalam(arm: string): KojoFunctionResolution {
  const detail = `shared PALAM:${arm} asset unavailable`;
  return {
    status: "unsupported",
    lines: [],
    effects: [],
    unsupportedPredicates: [],
    unsupportedEffects: [detail],
    diagnostics: [{ code: "unsupported-effect", detail }],
    returnValue: 0,
    resultSlots: {},
  };
}

function interactiveUnsupportedSharedPalam(arm: string): InteractiveKojoResolution {
  return { ...unsupportedSharedPalam(arm), pending: null };
}

function unsupportedSharedSpEvent(subid: number): KojoFunctionResolution {
  const detail = `shared SP_EVENT:${subid} asset unavailable`;
  return {
    status: "unsupported",
    lines: [],
    effects: [],
    unsupportedPredicates: [],
    unsupportedEffects: [detail],
    diagnostics: [{ code: "unsupported-effect", detail }],
    returnValue: 0,
    resultSlots: {},
  };
}

function interactiveUnsupportedSharedSpEvent(subid: number): InteractiveKojoResolution {
  return { ...unsupportedSharedSpEvent(subid), pending: null };
}
