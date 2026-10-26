import {
  resolveKojoNode,
  resolveKojoNodeDetailed,
  resolveKojoFunctionDetailed,
  resolveKojoNodeWithChoices,
  hasActionableKojoNode,
  palamKojoKey,
  iraiKojoSelectorKeys,
  mergeIraiKojoResolutions,
  resolveActiveKojoVariantCode,
} from "../../../modernization/runtime";
import { resolveDiaryCall } from "../../../modernization/runtime/kojo/diary-call.js";
import { iraiIdToClient } from "../../../modernization/runtime/state/commission.js";
import type {
  DialogueRouter,
  DiaryHappenResolution,
  InteractiveKojoResolution,
  KojoFunctionResolution,
  KojoLine,
  KojoResolution,
} from "../../../modernization/runtime";
import type { KojoNode } from "../../../modernization/runtime/kojo/types.js";
import type { Rng } from "../../../modernization/runtime/command/types.js";
import type { GameState } from "../../../modernization/runtime/state/index.js";
import { CFLAG_ID, FLAG_ID } from "../../../modernization/runtime/state/settlement.js";
import { getTflag, TFLAG_ID } from "../../../modernization/runtime/state/tflag.js";
import { withMarkKojoContext } from "../../../modernization/runtime/kojo/mark-kojo.js";
import {
  DEFAULT_KOJO_SYMBOLS,
  SCOPED_KOJO_SYMBOLS,
  mergeKojoSymbolTables,
} from "../../../modernization/runtime/kojo/symbol-table.js";

export interface BrowserKojoVariant {
  variantId?: string;
  variantCode?: string;
  label?: string;
  description?: string;
  byCommand: Record<string, KojoNode>;
  /** Personal SCOM trees selected by upstream TFLAG:50 dispatch. */
  byScom?: Record<string, KojoNode>;
  byEventArm?: Record<string, KojoNode>;
  byDailyEvent?: Record<string, KojoNode>;
  bySpEvent?: Record<string, KojoNode>;
  /** Authored DAYEVENT_COND return hook for this character/variant. */
  byDayEventCondition?: KojoNode;
  /** Authored IRAI_BLOCKED return hook for this character/variant. */
  byIraiBlocked?: KojoNode;
  byEncounter?: KojoNode;
  /** Per-character opening/update body (`@M_KOJO_UPDATE_K{n}`). */
  byUpdate?: KojoNode;
  /** Private-room description tree (`@K{n}{infix}_ROOM_DESCRIPTION`). */
  byRoomDescription?: KojoNode;
  byMark?: KojoNode;
  byCounter?: Record<string, KojoNode>;
  byPalam?: Record<string, KojoNode>;
  byIrai?: Record<string, Record<string, Record<string, KojoNode>>>;
  /** Diary (日記) slice baked from `M_KOJO{infix}_DIARY_K{n}_EXIST/TEXT/…`.
   *  EXIST gate (true iff the resolved body emits a PRINT line under
   *  `resolveKojoNode`) + TEXT pages (page-keyed; index collapses to
   *  key 0 since pages are runtime branches inside TEXT bodies). */
  byDiaryExist?: KojoNode;
  byDiaryText?: Record<string, KojoNode>;
  byDiaryBeforeCheck?: KojoNode;
  byDiaryAfterCheck?: KojoNode;
  /** Per-page HAPPEN triggers (`pageNum → body`). BEFORE_CHECK iterates
   *  1..MAX and resolves each via `resolveDiaryHappen` to decide if
   *  the page should be queued today. */
  byDiaryHappens?: Record<string, KojoNode>;
}

export interface BrowserKojoChara extends BrowserKojoVariant {
  callName?: string;
  defaultVariantId?: string;
  variants?: Record<string, BrowserKojoVariant>;
}

export interface BrowserKojoBundle {
  byChara: Record<string, BrowserKojoChara>;
}

function roleplayEnabledForTarget(state: Readonly<GameState>, charaNum: number): boolean {
  if (state.disabledKojo?.[charaNum]) return false;
  const roleplayTarget = state.flagStore[FLAG_ID.扮演] ?? 0;
  if (roleplayTarget === 0) return true;
  const slot = charaNum === 0 ? state.master : state.charas[charaNum];
  const personalFlags = (slot?.state as unknown as Record<string, Record<number, number>> | undefined)?.["C" + "FLAG"];
  return (personalFlags?.[CFLAG_ID.扮演口上有] ?? 0) !== 0;
}

function activeKojoVariant(
  chara: BrowserKojoChara | undefined,
  state: Readonly<GameState>,
  charaNum: number,
): BrowserKojoVariant | undefined {
  if (!chara) return undefined;
  if (chara.variants) {
    const variantId = resolveActiveKojoVariantCode(
      state,
      charaNum,
      Object.keys(chara.variants),
      chara.defaultVariantId ?? "0",
    );
    if (chara.variants[variantId]) return chara.variants[variantId];
  }
  return chara;
}

function emptyKojoResolution(
  status: "not-authored" | "gated",
): KojoResolution {
  return {
    status,
    lines: [],
    effects: [],
    unsupportedPredicates: [],
    unsupportedEffects: [],
    diagnostics: [],
  };
}

function emptyKojoFunctionResolution(
  status: "not-authored" | "gated",
): KojoFunctionResolution {
  return {
    status,
    lines: [],
    effects: [],
    unsupportedPredicates: [],
    unsupportedEffects: [],
    diagnostics: [],
    returnValue: 0,
    resultSlots: {},
  };
}

function emptyInteractiveKojoResolution(
  status: "not-authored" | "gated",
): InteractiveKojoResolution {
  return {
    status,
    lines: [],
    pending: null,
    effects: [],
    unsupportedPredicates: [],
    unsupportedEffects: [],
    diagnostics: [],
  };
}

function commandNodeFor(
  variant: BrowserKojoVariant | undefined,
  commandNo: number,
  state: Readonly<GameState>,
): KojoNode | undefined {
  if (!variant) return undefined;
  const key = String(commandNo);
  return getTflag(state, TFLAG_ID.派生コマンド) !== 0
    ? variant.byScom?.[key]
    : variant.byCommand?.[key];
}

export function createBrowserKojoRouter(bundle: BrowserKojoBundle): DialogueRouter {
  const encounterContext = (state: Readonly<GameState>) => ({
    nameResolver: (reference: number | string) =>
      typeof reference === "number"
        ? state.charas[reference]?.callName ?? bundle.byChara[String(reference)]?.callName
        : undefined,
  });

  const resolveCommandDetailed = (
    charaNum: number,
    commandNo: number,
    state: Readonly<GameState>,
    rng: Rng,
    options?: { probeReadonly?: boolean },
  ): KojoResolution => {
    if (!roleplayEnabledForTarget(state, charaNum)) {
      return emptyKojoResolution("gated");
    }
    const chara = bundle.byChara[String(charaNum)];
    const variant = activeKojoVariant(chara, state, charaNum);
    const node = commandNodeFor(variant, commandNo, state);
    if (!node) {
      return emptyKojoResolution("not-authored");
    }
    return resolveKojoNodeDetailed(node, charaNum, state, rng, [], {
      commandNo,
      probeReadonly: options?.probeReadonly,
    });
  };

  const resolveIraiDetailed = (
    charaNum: number,
    role: string,
    scene: string,
    iraiId: number,
    state: Readonly<GameState>,
    rng: Rng,
  ): KojoResolution => {
    if (!roleplayEnabledForTarget(state, charaNum)) return emptyKojoResolution("gated");
    const chara = bundle.byChara[String(charaNum)];
    const variant = activeKojoVariant(chara, state, charaNum);
    const clientId = iraiIdToClient(iraiId);
    const targetName = state.charas[charaNum]?.callName ?? chara?.callName ?? "对方";
    const clientName =
      state.charas[clientId]?.callName ?? bundle.byChara[String(clientId)]?.callName ?? targetName;
    const context = {
      nameResolver: (reference: number | string) =>
        typeof reference === "number"
          ? state.charas[reference]?.callName ?? bundle.byChara[String(reference)]?.callName
          : undefined,
      callNameAliases: { CHARA: targetName, CLIENT_ID: clientName },
      subjectAliases: { CLIENT_ID: clientId },
      targetName,
    };
    const resolutions: KojoResolution[] = [];
    for (const selector of iraiKojoSelectorKeys(iraiId)) {
      const byRole = variant?.byIrai?.[selector];
      const node = byRole?.[role]?.[scene] ?? byRole?.["*"]?.[scene];
      if (node) resolutions.push(resolveKojoNodeDetailed(node, charaNum, state, rng, [], context));
    }
    return mergeIraiKojoResolutions(resolutions);
  };

  return {
    hasUpdateKojo(charaNum, state) {
      if (!roleplayEnabledForTarget(state, charaNum)) return false;
      const chara = bundle.byChara[String(charaNum)];
      const update = activeKojoVariant(chara, state, charaNum)?.byUpdate;
      return update !== undefined && hasActionableKojoNode(update);
    },
    resolveUpdateKojoInteractive(charaNum, state, rng, choices) {
      if (!roleplayEnabledForTarget(state, charaNum)) {
        return emptyInteractiveKojoResolution("gated");
      }
      const chara = bundle.byChara[String(charaNum)];
      const node = activeKojoVariant(chara, state, charaNum)?.byUpdate;
      if (!node) return emptyInteractiveKojoResolution("not-authored");
      return resolveKojoNodeWithChoices(node, charaNum, state, rng, [], choices);
    },
    collect(charaNum: number, commandNo: number, state: Readonly<GameState>, rng: Rng): KojoLine[] {
      return resolveCommandDetailed(charaNum, commandNo, state, rng).lines;
    },
    collectDetailed: resolveCommandDetailed,
    collectInteractive(
      charaNum: number,
      commandNo: number,
      state: Readonly<GameState>,
      rng: Rng,
      choices: readonly number[],
    ) {
      if (!roleplayEnabledForTarget(state, charaNum)) {
        return emptyInteractiveKojoResolution("gated");
      }
      const chara = bundle.byChara[String(charaNum)];
      const variant = activeKojoVariant(chara, state, charaNum);
      const node = commandNodeFor(variant, commandNo, state);
      if (!node) return emptyInteractiveKojoResolution("not-authored");
      return resolveKojoNodeWithChoices(node, charaNum, state, rng, [], choices, { commandNo });
    },
    resolveEventKojo(
      charaNum: number,
      arm: number,
      state: Readonly<GameState>,
      rng: Rng,
      args: number[] = [],
    ): KojoLine[] {
      if (!roleplayEnabledForTarget(state, charaNum)) return [];
      const chara = bundle.byChara[String(charaNum)];
      const variant = activeKojoVariant(chara, state, charaNum);
      const node = variant?.byEventArm?.[String(arm)];
      if (!node) return [];
      return resolveKojoNode(node, charaNum, state, rng, args);
    },
    resolveEventKojoDetailed(charaNum, arm, state, rng, args = []) {
      if (!roleplayEnabledForTarget(state, charaNum)) {
        return emptyKojoResolution("gated");
      }
      const chara = bundle.byChara[String(charaNum)];
      const variant = activeKojoVariant(chara, state, charaNum);
      const node = variant?.byEventArm?.[String(arm)];
      if (!node) {
        return emptyKojoResolution("not-authored");
      }
      return resolveKojoNodeDetailed(node, charaNum, state, rng, args);
    },
    resolveEventKojoInteractive(charaNum, arm, state, rng, args, choices) {
      if (!roleplayEnabledForTarget(state, charaNum)) {
        return emptyInteractiveKojoResolution("gated");
      }
      const chara = bundle.byChara[String(charaNum)];
      const variant = activeKojoVariant(chara, state, charaNum);
      const node = variant?.byEventArm?.[String(arm)];
      if (!node) return emptyInteractiveKojoResolution("not-authored");
      return resolveKojoNodeWithChoices(node, charaNum, state, rng, args ?? [], choices);
    },
    resolveDailyKojo(charaNum, eventId, state, rng, args = []) {
      if (!roleplayEnabledForTarget(state, charaNum)) return [];
      const chara = bundle.byChara[String(charaNum)];
      const node = activeKojoVariant(chara, state, charaNum)?.byDailyEvent?.[String(eventId)];
      return node ? resolveKojoNode(node, charaNum, state, rng, args) : [];
    },
    resolveDailyKojoDetailed(charaNum, eventId, state, rng, args = []) {
      if (!roleplayEnabledForTarget(state, charaNum)) return emptyKojoResolution("gated");
      const chara = bundle.byChara[String(charaNum)];
      const node = activeKojoVariant(chara, state, charaNum)?.byDailyEvent?.[String(eventId)];
      return node
        ? resolveKojoNodeDetailed(node, charaNum, state, rng, args)
        : emptyKojoResolution("not-authored");
    },
    resolveDailyKojoInteractive(charaNum, eventId, state, rng, args, choices) {
      if (!roleplayEnabledForTarget(state, charaNum)) return emptyInteractiveKojoResolution("gated");
      const chara = bundle.byChara[String(charaNum)];
      const node = activeKojoVariant(chara, state, charaNum)?.byDailyEvent?.[String(eventId)];
      return node
        ? resolveKojoNodeWithChoices(node, charaNum, state, rng, args ?? [], choices)
        : emptyInteractiveKojoResolution("not-authored");
    },
    resolveSpEventKojo(
      charaNum: number,
      subid: number,
      state: Readonly<GameState>,
      rng: Rng,
      args: number[] = [],
    ): KojoLine[] {
      if (!roleplayEnabledForTarget(state, charaNum)) return [];
      const chara = bundle.byChara[String(charaNum)];
      const variant = activeKojoVariant(chara, state, charaNum);
      const node = variant?.bySpEvent?.[String(subid)];
      if (!node) return [];
      return resolveKojoNode(node, charaNum, state, rng, args);
    },
    resolveSpEventKojoDetailed(charaNum, subid, state, rng, args = []) {
      if (!roleplayEnabledForTarget(state, charaNum)) {
        return emptyKojoResolution("gated");
      }
      const chara = bundle.byChara[String(charaNum)];
      const variant = activeKojoVariant(chara, state, charaNum);
      const node = variant?.bySpEvent?.[String(subid)];
      if (!node) {
        return emptyKojoResolution("not-authored");
      }
      return resolveKojoNodeDetailed(node, charaNum, state, rng, args);
    },
    resolveDayEventCondition(charaNum, type, scenario, state, rng) {
      if (!roleplayEnabledForTarget(state, charaNum)) {
        return emptyKojoFunctionResolution("gated");
      }
      const chara = bundle.byChara[String(charaNum)];
      const variant = activeKojoVariant(chara, state, charaNum);
      const node = variant?.byDayEventCondition;
      if (!node) return emptyKojoFunctionResolution("not-authored");
      return resolveKojoFunctionDetailed(
        node,
        charaNum,
        state,
        rng,
        [scenario],
        { stringArgs: [type] },
      );
    },
    resolveIraiBlocked(charaNum, localId, state, rng) {
      if (!roleplayEnabledForTarget(state, charaNum)) {
        return emptyKojoFunctionResolution("gated");
      }
      const chara = bundle.byChara[String(charaNum)];
      const variant = activeKojoVariant(chara, state, charaNum);
      const node = variant?.byIraiBlocked;
      if (!node) return emptyKojoFunctionResolution("not-authored");
      return resolveKojoFunctionDetailed(node, charaNum, state, rng, [localId]);
    },
    resolveSpEventKojoInteractive(charaNum, subid, state, rng, args, choices) {
      if (!roleplayEnabledForTarget(state, charaNum)) {
        return emptyInteractiveKojoResolution("gated");
      }
      const chara = bundle.byChara[String(charaNum)];
      const variant = activeKojoVariant(chara, state, charaNum);
      const node = variant?.bySpEvent?.[String(subid)];
      if (!node) return emptyInteractiveKojoResolution("not-authored");
      return resolveKojoNodeWithChoices(node, charaNum, state, rng, args ?? [], choices);
    },
    resolveEncounterKojo(
      charaNum: number,
      state: Readonly<GameState>,
      rng: Rng,
    ): KojoLine[] {
      if (!roleplayEnabledForTarget(state, charaNum)) return [];
      const chara = bundle.byChara[String(charaNum)];
      const variant = activeKojoVariant(chara, state, charaNum);
      const node = variant?.byEncounter;
      if (!node) return [];
      return resolveKojoNode(node, charaNum, state, rng, [], encounterContext(state));
    },
    resolveEncounterKojoDetailed(charaNum, state, rng) {
      if (!roleplayEnabledForTarget(state, charaNum)) {
        return emptyKojoResolution("gated");
      }
      const chara = bundle.byChara[String(charaNum)];
      const variant = activeKojoVariant(chara, state, charaNum);
      const node = variant?.byEncounter;
      if (!node) {
        return emptyKojoResolution("not-authored");
      }
      return resolveKojoNodeDetailed(node, charaNum, state, rng, [], encounterContext(state));
    },
    resolveEncounterKojoInteractive(
      charaNum: number,
      state: Readonly<GameState>,
      rng: Rng,
      choices: readonly number[],
    ) {
      if (!roleplayEnabledForTarget(state, charaNum)) {
        return emptyInteractiveKojoResolution("gated");
      }
      const chara = bundle.byChara[String(charaNum)];
      const variant = activeKojoVariant(chara, state, charaNum);
      const node = variant?.byEncounter;
      if (!node) return emptyInteractiveKojoResolution("not-authored");
      return resolveKojoNodeWithChoices(
        node,
        charaNum,
        state,
        rng,
        [],
        choices,
        encounterContext(state),
      );
    },
    resolveRoomDescriptionKojo(
      charaNum: number,
      state: Readonly<GameState>,
      rng: Rng,
    ): KojoLine[] {
      if (!roleplayEnabledForTarget(state, charaNum)) return [];
      const chara = bundle.byChara[String(charaNum)];
      const variant = activeKojoVariant(chara, state, charaNum);
      const node = variant?.byRoomDescription;
      if (!node) return [];
      return resolveKojoNode(node, charaNum, state, rng);
    },
    resolveRoomDescriptionKojoDetailed(charaNum, state, rng) {
      if (!roleplayEnabledForTarget(state, charaNum)) {
        return emptyKojoResolution("gated");
      }
      const chara = bundle.byChara[String(charaNum)];
      const variant = activeKojoVariant(chara, state, charaNum);
      const node = variant?.byRoomDescription;
      if (!node) {
        return emptyKojoResolution("not-authored");
      }
      return resolveKojoNodeDetailed(node, charaNum, state, rng);
    },
    resolveMarkKojo(charaNum, level, state, rng, markId = 3) {
      if (!roleplayEnabledForTarget(state, charaNum)) return [];
      const chara = bundle.byChara[String(charaNum)];
      const variant = activeKojoVariant(chara, state, charaNum);
      const node = variant?.byMark;
      if (!node) return [];
      return resolveKojoNode(
        node,
        charaNum,
        withMarkKojoContext(state, markId, level),
        rng,
      );
    },
    resolveMarkKojoDetailed(charaNum, level, state, rng, markId = 3) {
      if (!roleplayEnabledForTarget(state, charaNum)) {
        return emptyKojoResolution("gated");
      }
      const chara = bundle.byChara[String(charaNum)];
      const variant = activeKojoVariant(chara, state, charaNum);
      const node = variant?.byMark;
      if (!node) return emptyKojoResolution("not-authored");
      return resolveKojoNodeDetailed(
        node,
        charaNum,
        withMarkKojoContext(state, markId, level),
        rng,
      );
    },
    resolveMarkKojoInteractive(charaNum, level, state, rng, choices, markId = 3) {
      if (!roleplayEnabledForTarget(state, charaNum)) {
        return emptyInteractiveKojoResolution("gated");
      }
      const chara = bundle.byChara[String(charaNum)];
      const variant = activeKojoVariant(chara, state, charaNum);
      const node = variant?.byMark;
      if (!node) return emptyInteractiveKojoResolution("not-authored");
      return resolveKojoNodeWithChoices(
        node,
        charaNum,
        withMarkKojoContext(state, markId, level),
        rng,
        [],
        choices,
      );
    },
    resolveCounterKojo(charaNum, counterAction, state, rng) {
      if (!roleplayEnabledForTarget(state, charaNum)) return [];
      const chara = bundle.byChara[String(charaNum)];
      const variant = activeKojoVariant(chara, state, charaNum);
      const node = variant?.byCounter?.[String(counterAction)];
      return node ? resolveKojoNode(node, charaNum, state, rng) : [];
    },
    resolveCounterKojoDetailed(charaNum, counterAction, state, rng) {
      if (!roleplayEnabledForTarget(state, charaNum)) {
        return emptyKojoResolution("gated");
      }
      const chara = bundle.byChara[String(charaNum)];
      const variant = activeKojoVariant(chara, state, charaNum);
      const node = variant?.byCounter?.[String(counterAction)];
      return node
        ? resolveKojoNodeDetailed(node, charaNum, state, rng)
        : emptyKojoResolution("not-authored");
    },
    resolveCounterKojoInteractive(charaNum, counterAction, state, rng, choices) {
      if (!roleplayEnabledForTarget(state, charaNum)) {
        return emptyInteractiveKojoResolution("gated");
      }
      const chara = bundle.byChara[String(charaNum)];
      const variant = activeKojoVariant(chara, state, charaNum);
      const node = variant?.byCounter?.[String(counterAction)];
      return node
        ? resolveKojoNodeWithChoices(node, charaNum, state, rng, [], choices)
        : emptyInteractiveKojoResolution("not-authored");
    },
    resolvePalamKojo(charaNum, kind, detail, state, rng, args = []) {
      if (!roleplayEnabledForTarget(state, charaNum)) return [];
      const chara = bundle.byChara[String(charaNum)];
      const variant = activeKojoVariant(chara, state, charaNum);
      const node = variant?.byPalam?.[palamKojoKey(kind, detail)];
      return node ? resolveKojoNode(node, charaNum, state, rng, args) : [];
    },
    resolvePalamKojoDetailed(charaNum, kind, detail, state, rng, args = []) {
      if (!roleplayEnabledForTarget(state, charaNum)) {
        return emptyKojoResolution("gated");
      }
      const chara = bundle.byChara[String(charaNum)];
      const variant = activeKojoVariant(chara, state, charaNum);
      const node = variant?.byPalam?.[palamKojoKey(kind, detail)];
      return node
        ? resolveKojoNodeDetailed(node, charaNum, state, rng, args)
        : emptyKojoResolution("not-authored");
    },
    resolvePalamKojoInteractive(charaNum, kind, detail, state, rng, args, choices) {
      if (!roleplayEnabledForTarget(state, charaNum)) {
        return emptyInteractiveKojoResolution("gated");
      }
      const chara = bundle.byChara[String(charaNum)];
      const variant = activeKojoVariant(chara, state, charaNum);
      const node = variant?.byPalam?.[palamKojoKey(kind, detail)];
      return node
        ? resolveKojoNodeWithChoices(node, charaNum, state, rng, args ?? [], choices)
        : emptyInteractiveKojoResolution("not-authored");
    },
    hasDiaryKojo(
      charaNum: number,
      state: Readonly<GameState>,
      rng: Rng,
    ): boolean {
      if (!roleplayEnabledForTarget(state, charaNum)) return false;
      const chara = bundle.byChara[String(charaNum)];
      const variant = activeKojoVariant(chara, state, charaNum);
      const node = variant?.byDiaryExist;
      if (!node) return false;
      const resolved = resolveKojoFunctionDetailed(node, charaNum, state, rng, [], {
        nameResolver: (reference) =>
          typeof reference === "number"
            ? state.charas[reference]?.callName ?? bundle.byChara[String(reference)]?.callName
            : undefined,
      });
      return resolved.status === "resolved" && resolved.returnValue !== 0;
    },
    resolveDiaryHook(charaNum, kind, state, rng) {
      if (!roleplayEnabledForTarget(state, charaNum)) {
        return emptyKojoFunctionResolution("gated");
      }
      const chara = bundle.byChara[String(charaNum)];
      const variant = activeKojoVariant(chara, state, charaNum);
      const node = kind === "exist"
        ? variant?.byDiaryExist
        : kind === "before-check"
          ? variant?.byDiaryBeforeCheck
          : variant?.byDiaryAfterCheck;
      return node
        ? resolveKojoFunctionDetailed(node, charaNum, state, rng, [], {
            nameResolver: (reference) =>
              typeof reference === "number"
                ? state.charas[reference]?.callName ?? bundle.byChara[String(reference)]?.callName
                : undefined,
          })
        : emptyKojoFunctionResolution("not-authored");
    },
    resolveDiaryKojo(
      charaNum: number,
      page: number,
      state: Readonly<GameState>,
      rng: Rng,
      args: number[] = [],
      mode?: string,
    ): KojoLine[] {
      if (!roleplayEnabledForTarget(state, charaNum)) return [];
      const chara = bundle.byChara[String(charaNum)];
      const variant = activeKojoVariant(chara, state, charaNum);
      // The bundle collapses all pages to key 0 (pages are runtime
      // branches inside the TEXT body). The TEXT body then branches
      // on the `args[0]` (ARG:3 page flag) — faithful to upstream's
      // CALLFORM DIARY_K{n}_TEXT_K{n}(ARG:3, ARGS:2, ARG:4) call.
      // Inject `page` as ARG:3 so `IF ARG:3 == n` branches resolve.
      const node = variant?.byDiaryText?.["0"];
      if (!node) return [];
      const call = resolveDiaryCall(
        page,
        args,
        mode,
        mergeKojoSymbolTables(DEFAULT_KOJO_SYMBOLS, SCOPED_KOJO_SYMBOLS[String(charaNum)]),
      );
      return resolveKojoNode(node, charaNum, state, rng, call.args, call.context);
    },
    resolveDiaryKojoDetailed(charaNum, page, state, rng, args = [], mode?: string) {
      if (!roleplayEnabledForTarget(state, charaNum)) {
        return emptyKojoResolution("gated");
      }
      const chara = bundle.byChara[String(charaNum)];
      const variant = activeKojoVariant(chara, state, charaNum);
      const node = variant?.byDiaryText?.["0"];
      if (!node) {
        return emptyKojoResolution("not-authored");
      }
      const call = resolveDiaryCall(
        page,
        args,
        mode,
        mergeKojoSymbolTables(DEFAULT_KOJO_SYMBOLS, SCOPED_KOJO_SYMBOLS[String(charaNum)]),
      );
      return resolveKojoNodeDetailed(node, charaNum, state, rng, call.args, call.context);
    },
    resolveDiaryKojoInteractive(charaNum, page, state, rng, args, choices, mode?: string) {
      if (!roleplayEnabledForTarget(state, charaNum)) {
        return emptyInteractiveKojoResolution("gated");
      }
      const chara = bundle.byChara[String(charaNum)];
      const variant = activeKojoVariant(chara, state, charaNum);
      const node = variant?.byDiaryText?.["0"];
      if (!node) return emptyInteractiveKojoResolution("not-authored");
      const call = resolveDiaryCall(
        page,
        args,
        mode,
        mergeKojoSymbolTables(DEFAULT_KOJO_SYMBOLS, SCOPED_KOJO_SYMBOLS[String(charaNum)]),
      );
      return resolveKojoNodeWithChoices(node, charaNum, state, rng, call.args, choices, call.context);
    },
    resolveDiaryHappen(
      charaNum: number,
      page: number,
      state: Readonly<GameState>,
      rng: Rng,
    ): DiaryHappenResolution {
      const noFire = { fired: false, resultSlot1: 0 as const, resultSlot2: 0 as const };
      if (!roleplayEnabledForTarget(state, charaNum)) return noFire;
      const chara = bundle.byChara[String(charaNum)];
      const variant = activeKojoVariant(chara, state, charaNum);
      const node = variant?.byDiaryHappens?.[String(page)];
      if (!node) return noFire;
      const resolved = resolveKojoFunctionDetailed(node, charaNum, state, rng);
      if (resolved.status === "unsupported" || resolved.status === "partial") {
        return {
          ...noFire,
          status: resolved.status,
          diagnostics: resolved.diagnostics,
        };
      }
      const slot1 = resolved.resultSlots[1];
      const slot2 = resolved.resultSlots[2];
      return {
        fired: resolved.returnValue !== 0,
        resultSlot1:
          slot1 === 1 || slot1 === 2 || slot1 === 3 ? slot1 : 0,
        resultSlot2: slot2 === 1 ? 1 : 0,
        effects: resolved.effects,
        status: resolved.status,
        diagnostics: resolved.diagnostics,
      };
    },
    resolveIraiKojo(charaNum, role, scene, iraiId, state, rng): KojoLine[] {
      return resolveIraiDetailed(charaNum, role, scene, iraiId, state, rng).lines;
    },
    resolveIraiKojoDetailed: resolveIraiDetailed,
  };
}
