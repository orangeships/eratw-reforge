/**
 * Phase 6C — KojoCache.
 *
 * Runtime cache layer that implements `DialogueRouter`. Loads a
 * `KojoCommandIndex` at construction, then resolves
 * `(charaNum, commandNo, state, rng) → KojoLine[]` on demand:
 *
 *   1. Determine active variant via `CFLAG:{charaNum}:998`.
 *   2. Select COM:{cmd} or SCOM:{cmd} from the canonical TFLAG:50 dispatch.
 *   3. If found → read ERB file slice → extract @-func → parse → cache
 *      KojoNode → resolveKojoNode.
 *   4. If not found → try variant catchAll.
 *   5. If nothing found → return [] (silent, no error).
 *
 * Cached nodes live for the session lifetime. Restart the app to pick
 * up ERB edits (Phase 10 may add file watching for dev mode).
 */

import { extractFuncs } from "../../importer/kojo/extractor.js";
import { parseFunc } from "../../importer/kojo/parser.js";
import { bindStaticCallArguments } from "../../importer/kojo/static-call.js";
import { resolveDiaryStaticCall } from "../../importer/kojo/diary-static.js";
import { DEFAULT_CONTEXT, type SubstituteContext } from "../../importer/kojo/substitute.js";
import type { ParsedKojoFunc } from "../../importer/kojo/parser-types.js";
import type {
  DialogueRouter,
  DiaryHappenResolution,
  InteractiveKojoResolution,
  KojoCommandIndex,
  KojoFunctionResolution,
  KojoLine,
  KojoNode,
  KojoResolution,
  PalamKojoKind,
  VariantIndex,
  FuncLocation,
  IraiSceneLocation,
} from "./types.js";
import {
  resolveKojoNode,
  resolveKojoNodeDetailed,
  resolveKojoFunctionDetailed,
  resolveKojoNodeWithChoices,
} from "./static-router.js";
import { resolveActiveKojoVariantCode } from "./variant-selection.js";
import {
  DEFAULT_KOJO_SYMBOLS,
  GLOBAL_KOJO_DECLARATIONS,
  SCOPED_KOJO_DECLARATIONS,
  SCOPED_KOJO_SYMBOLS,
  mergeKojoSymbolTables,
} from "./symbol-table.js";
import { withMarkKojoContext } from "./mark-kojo.js";
import { palamKojoKey } from "./palam-kojo.js";
import { iraiKojoSelectorKeys } from "./irai-kojo.js";
import { iraiIdToClient } from "../state/commission.js";
import { resolveDiaryCall } from "./diary-call.js";
import { getTflag, TFLAG_ID } from "../state/tflag.js";
import type { GameState } from "../state/index.js";
import type { Rng } from "../command/types.js";

function containsUnsupportedKojoNode(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if ((value as { type?: string }).type === "unsupported-effect") return true;
  return Object.values(value).some((child) =>
    Array.isArray(child)
      ? child.some(containsUnsupportedKojoNode)
      : containsUnsupportedKojoNode(child)
  );
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
  status: "not-authored" | "gated" | "unsupported",
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

/** FLAG:扮演. Raw ids keep this file independent from translated enum names. */
const ROLEPLAY_FLAG_ID = 1030;

/** CFLAG:扮演口上有. */
const ROLEPLAY_KOJO_PRESENT_CFLAG_ID = 373;

/** Cache key → parsed KojoNode tree. */
type CacheEntry = { node: KojoNode; cachedAt: number };
type CommandKind = "COM" | "SCOM";

function commandKindFor(state: Readonly<GameState>): CommandKind {
  return getTflag(state, TFLAG_ID.派生コマンド) !== 0 ? "SCOM" : "COM";
}

function commandLocationFor(
  variant: VariantIndex,
  commandKind: CommandKind,
  commandNo: number,
): FuncLocation | undefined {
  const prefixes = commandKind === "SCOM"
    ? ["SCOM", "CUSTOM_SCOM"]
    : ["COM", "CUSTOM_COM"];
  for (const prefix of prefixes) {
    const location = variant.commands[`${prefix}:${commandNo}`];
    if (location) return location;
  }
  return undefined;
}

/**
 * Synchronous source reader. `filePath` is relative to
 * `ERB/口上・メッセージ関連/`; the caller decides whether that means Node fs,
 * Tauri asset://, or a test fixture.
 */
export type KojoSourceReader = (filePath: string, projectRoot: string) => string;

/** Optional construction deps. */
export interface KojoCacheOptions {
  /**
   * `charaNum → callName` (the callee shown in `%CALLNAME:TARGET%` /
   * `%CALLNAME:N%`). Used to substitute kojo text at parse time so each
   * chara's lines name themselves correctly. Missing entry → "对方".
   * Inject from `charas.bundle.json` (see `node-index.ts`).
   */
  nameResolver?: (charaNum: number) => string | undefined;
  /**
   * Deprecated for `%CALLNAME:MASTER%`/etc. The three caller tokens are
   * resolved at emit time against `state.master.callName` (not parsed
   * here). Kept on the type for backward-compatible call sites that
   * still pass `masterName`; the constructor value is no longer used.
   */
  masterName?: string;
  /**
   * Read one ERB source file synchronously. Injected so this cache can run both
   * in Node (`node-index.ts`) and in the Tauri renderer (sync asset XHR)
   * without statically importing `node:fs` into the browser bundle.
   */
  readText?: KojoSourceReader;
}

export class KojoCache implements DialogueRouter {
  private readonly index: KojoCommandIndex;
  private readonly projectRoot: string;
  private readonly nameResolver?: (charaNum: number) => string | undefined;
  private readonly readText: KojoSourceReader;
  /** Parsed KojoNode cache. Key = `${charaNum}:${variantCode}:${comType}:${cmd}`. */
  private readonly cache = new Map<string, CacheEntry>();

  constructor(index: KojoCommandIndex, projectRoot: string, opts: KojoCacheOptions = {}) {
    this.index = index;
    this.projectRoot = projectRoot;
    this.nameResolver = opts.nameResolver;
    // `opts.masterName` is preserved on the type but no longer consulted
    // — caller tokens resolve at runtime against live `state.master.callName`.
    this.readText = opts.readText ?? (() => {
      throw new Error("KojoCache requires a synchronous readText(filePath, projectRoot) implementation");
    });
  }

  // ── DialogueRouter impl ──────────────────────────────────────────

  collect(
    charaNum: number,
    commandNo: number,
    state: Readonly<GameState>,
    rng: Rng,
  ): KojoLine[] {
    if (!this.kojoEnabledForTarget(state, charaNum)) return [];

    // 1. Resolve active variant
    const variantCode = this.resolveVariant(charaNum, state);
    const variant = this.findVariant(charaNum, variantCode);

    // 2. Select the command body using the same TFLAG:50 dispatch as the
    // upstream KOJO_MESSAGE.ERB and browser bundle.
    const commandKind = commandKindFor(state);

    // The fallback chain is walked top-down; the FIRST step that yields
    // at least one line wins. A step that resolves to zero lines is a
    // miss (e.g. a personal body whose only branch is gated behind a
    // function-call predicate the parser can't evaluate → `unknown`),
    // so we continue to the next personal-kojo fallback.
    const tryNode = (node: KojoNode | null): KojoLine[] =>
      node
        ? resolveKojoNodeDetailed(
            node,
            charaNum,
            state,
            rng,
            [],
            { commandNo },
          ).lines
        : [];

    if (variant) {
      const loc = commandLocationFor(variant, commandKind, commandNo);
      if (loc) {
        const lines = tryNode(this.getOrParse(charaNum, variantCode, commandKind, commandNo, loc));
        if (lines.length > 0) return lines;
      }
      if (variant.catchAll) {
        const lines = tryNode(this.getOrParse(charaNum, variantCode, "CATCHALL", 0, variant.catchAll));
        if (lines.length > 0) return lines;
      }
    }

    // 3. Nothing found. EVENT_MESSAGE_COMxxx is now routed by
    // TrainMessageRouter as common
    // action prose, not by this personal-kojo cache.

    // 4. Nothing found — silent (no crash).
    return [];
  }

  collectDetailed(
    charaNum: number,
    commandNo: number,
    state: Readonly<GameState>,
    rng: Rng,
  ) {
    if (!this.kojoEnabledForTarget(state, charaNum)) return emptyKojoResolution("gated");
    const variantCode = this.resolveVariant(charaNum, state);
    const variant = this.findVariant(charaNum, variantCode);
    if (!variant) return emptyKojoResolution("not-authored");
    const commandKind = commandKindFor(state);
    const loc = commandLocationFor(variant, commandKind, commandNo);
    if (loc) {
      const node = this.getOrParse(charaNum, variantCode, commandKind, commandNo, loc);
      if (node) return resolveKojoNodeDetailed(node, charaNum, state, rng, [], { commandNo });
    }
    if (variant.catchAll) {
      const node = this.getOrParse(charaNum, variantCode, "CATCHALL", 0, variant.catchAll);
      if (node) return resolveKojoNodeDetailed(node, charaNum, state, rng, [], { commandNo });
    }
    return emptyKojoResolution("not-authored");
  }

  collectInteractive(
    charaNum: number,
    commandNo: number,
    state: Readonly<GameState>,
    rng: Rng,
    choices: readonly number[],
  ): InteractiveKojoResolution {
    if (!this.kojoEnabledForTarget(state, charaNum)) {
      return emptyInteractiveKojoResolution("gated");
    }
    const variantCode = this.resolveVariant(charaNum, state);
    const variant = this.findVariant(charaNum, variantCode);
    if (!variant) return emptyInteractiveKojoResolution("not-authored");

    const commandKind = commandKindFor(state);
    const loc = commandLocationFor(variant, commandKind, commandNo);
    if (loc) {
      const node = this.getOrParse(
        charaNum,
        variantCode,
        commandKind,
        commandNo,
        loc,
      );
      if (node) {
        return resolveKojoNodeWithChoices(
          node,
          charaNum,
          state,
          rng,
          [],
          choices,
          { commandNo },
        );
      }
    }
    if (variant.catchAll) {
      const node = this.getOrParse(
        charaNum,
        variantCode,
        "CATCHALL",
        0,
        variant.catchAll,
      );
      if (node) {
        return resolveKojoNodeWithChoices(
          node,
          charaNum,
          state,
          rng,
          [],
          choices,
          { commandNo },
        );
      }
    }
    return emptyInteractiveKojoResolution("not-authored");
  }

  resolveEventKojo(
    charaNum: number,
    arm: number,
    state: Readonly<GameState>,
    rng: Rng,
    args: number[] = [],
  ): KojoLine[] {
    if (!this.kojoEnabledForTarget(state, charaNum)) return [];

    // 1. Resolve active variant (same CFLAG:998 selector as collect).
    const variantCode = this.resolveVariant(charaNum, state);
    const variant = this.findVariant(charaNum, variantCode);
    if (!variant?.events) return [];

    // 2. Look up the EVENT:{arm} func location.
    const loc = variant.events[`EVENT:${arm}`];
    if (!loc) return [];

    // 3. Parse + resolve (reuses the same body parser as COM funcs; the
    //    EVENT-arm bodies use the same IF TALENT/CFLAG + PRINTFORML
    //    constructs). The `args` (ARG/ARG:1 sub-id from
    //    KOJO_MESSAGE_SEND) bind the `IF ARG == n` branches — Phase 8
    //    朝夜挨拶. Bodies whose every branch is gated behind a `LOCAL:1 = 0`
    //    记入チェック (disabled by the author) resolve to [] — faithful.
    const node = this.getOrParseEventArm(charaNum, variantCode, arm, loc);
    return node ? resolveKojoNode(node, charaNum, state, rng, args) : [];
  }

  resolveEventKojoDetailed(charaNum: number, arm: number, state: Readonly<GameState>, rng: Rng, args: number[] = []) {
    if (!this.kojoEnabledForTarget(state, charaNum)) return emptyKojoResolution("gated");
    const variantCode = this.resolveVariant(charaNum, state);
    const variant = this.findVariant(charaNum, variantCode);
    const loc = variant?.events?.[`EVENT:${arm}`];
    const node = loc ? this.getOrParseEventArm(charaNum, variantCode, arm, loc) : null;
    return node
      ? resolveKojoNodeDetailed(node, charaNum, state, rng, args)
      : emptyKojoResolution("not-authored");
  }

  resolveEventKojoInteractive(
    charaNum: number,
    arm: number,
    state: Readonly<GameState>,
    rng: Rng,
    args: readonly number[] | undefined,
    choices: readonly number[],
  ): InteractiveKojoResolution {
    if (!this.kojoEnabledForTarget(state, charaNum)) {
      return emptyInteractiveKojoResolution("gated");
    }
    const variantCode = this.resolveVariant(charaNum, state);
    const variant = this.findVariant(charaNum, variantCode);
    const loc = variant?.events?.[`EVENT:${arm}`];
    const node = loc
      ? this.getOrParseEventArm(charaNum, variantCode, arm, loc)
      : null;
    return node
      ? resolveKojoNodeWithChoices(
          node,
          charaNum,
          state,
          rng,
          args ?? [],
          choices,
        )
      : emptyInteractiveKojoResolution("not-authored");
  }

  resolveSpEventKojo(
    charaNum: number,
    subid: number,
    state: Readonly<GameState>,
    rng: Rng,
    args: number[] = [],
  ): KojoLine[] {
    if (!this.kojoEnabledForTarget(state, charaNum)) return [];

    // 1. Resolve active variant (same CFLAG:998 selector as collect).
    const variantCode = this.resolveVariant(charaNum, state);
    const variant = this.findVariant(charaNum, variantCode);
    if (!variant?.spEvents) return [];

    // 2. Look up the SP_EVENT:{subid} func location.
    const loc = variant.spEvents[`SP_EVENT:${subid}`];
    if (!loc) return [];

    // 3. Parse + resolve. The `args` (ARG:3/ARG:4 from KOJO_MESSAGE_SEND)
    //    bind the `IF ARG == n` per-scenario branches. Bodies whose every
    //    branch is gated (disabled by the author) resolve to [] — faithful.
    const node = this.getOrParseSpEvent(charaNum, variantCode, subid, loc);
    return node ? resolveKojoNode(node, charaNum, state, rng, args) : [];
  }

  resolveSpEventKojoDetailed(charaNum: number, subid: number, state: Readonly<GameState>, rng: Rng, args: number[] = []) {
    if (!this.kojoEnabledForTarget(state, charaNum)) return emptyKojoResolution("gated");
    const variantCode = this.resolveVariant(charaNum, state);
    const variant = this.findVariant(charaNum, variantCode);
    const loc = variant?.spEvents?.[`SP_EVENT:${subid}`];
    const node = loc ? this.getOrParseSpEvent(charaNum, variantCode, subid, loc) : null;
    return node
      ? resolveKojoNodeDetailed(node, charaNum, state, rng, args)
      : emptyKojoResolution("not-authored");
  }

  resolveDayEventCondition(
    charaNum: number,
    type: "day" | "night",
    scenario: number,
    state: Readonly<GameState>,
    rng: Rng,
  ): KojoFunctionResolution {
    if (!this.kojoEnabledForTarget(state, charaNum)) {
      return emptyKojoFunctionResolution("gated");
    }
    const variantCode = this.resolveVariant(charaNum, state);
    const variant = this.findVariant(charaNum, variantCode);
    const loc = variant?.dayEventCondition;
    const node = loc
      ? this.getOrParseDayEventCondition(charaNum, variantCode, loc)
      : null;
    return node
      ? resolveKojoFunctionDetailed(
          node,
          charaNum,
          state,
          rng,
          [scenario],
          { stringArgs: [type] },
        )
      : emptyKojoFunctionResolution("not-authored");
  }

  resolveIraiBlocked(
    charaNum: number,
    localId: number,
    state: Readonly<GameState>,
    rng: Rng,
  ): KojoFunctionResolution {
    if (!this.kojoEnabledForTarget(state, charaNum)) {
      return emptyKojoFunctionResolution("gated");
    }
    const variantCode = this.resolveVariant(charaNum, state);
    const variant = this.findVariant(charaNum, variantCode);
    const loc = variant?.iraiBlocked;
    const node = loc
      ? this.getOrParseIraiBlocked(charaNum, variantCode, loc)
      : null;
    return node
      ? resolveKojoFunctionDetailed(node, charaNum, state, rng, [localId])
      : emptyKojoFunctionResolution("not-authored");
  }

  resolveSpEventKojoInteractive(
    charaNum: number,
    subid: number,
    state: Readonly<GameState>,
    rng: Rng,
    args: readonly number[] | undefined,
    choices: readonly number[],
  ): InteractiveKojoResolution {
    if (!this.kojoEnabledForTarget(state, charaNum)) {
      return emptyInteractiveKojoResolution("gated");
    }
    const variantCode = this.resolveVariant(charaNum, state);
    const variant = this.findVariant(charaNum, variantCode);
    const loc = variant?.spEvents?.[`SP_EVENT:${subid}`];
    const node = loc
      ? this.getOrParseSpEvent(charaNum, variantCode, subid, loc)
      : null;
    return node
      ? resolveKojoNodeWithChoices(
          node,
          charaNum,
          state,
          rng,
          args ?? [],
          choices,
        )
      : emptyInteractiveKojoResolution("not-authored");
  }

  resolveEncounterKojo(
    charaNum: number,
    state: Readonly<GameState>,
    rng: Rng,
  ): KojoLine[] {
    if (!this.kojoEnabledForTarget(state, charaNum)) return [];

    // 1. Resolve active variant (same CFLAG:998 selector as collect).
    const variantCode = this.resolveVariant(charaNum, state);
    const variant = this.findVariant(charaNum, variantCode);
    if (!variant?.encounter) return [];

    // 2. Parse + resolve the first-meeting greeting body (KOJO_MESSAGE.ERB:63,
    //    dispatched from @SYOTAIMEN when 面識==0). No arm/args — one func.
    const node = this.getOrParseEncounter(charaNum, variantCode, variant.encounter);
    return node
      ? resolveKojoNode(node, charaNum, state, rng, [], {
          nameResolver: (reference) =>
            typeof reference === "number" ? this.nameResolver?.(reference) : undefined,
        })
      : [];
  }

  resolveEncounterKojoDetailed(charaNum: number, state: Readonly<GameState>, rng: Rng) {
    if (!this.kojoEnabledForTarget(state, charaNum)) return emptyKojoResolution("gated");
    const variantCode = this.resolveVariant(charaNum, state);
    const variant = this.findVariant(charaNum, variantCode);
    const node = variant?.encounter
      ? this.getOrParseEncounter(charaNum, variantCode, variant.encounter)
      : null;
    return node
      ? resolveKojoNodeDetailed(node, charaNum, state, rng, [], {
          nameResolver: (reference) =>
            typeof reference === "number" ? this.nameResolver?.(reference) : undefined,
        })
      : emptyKojoResolution("not-authored");
  }

  resolveEncounterKojoInteractive(
    charaNum: number,
    state: Readonly<GameState>,
    rng: Rng,
    choices: readonly number[],
  ): InteractiveKojoResolution {
    if (!this.kojoEnabledForTarget(state, charaNum)) {
      return emptyInteractiveKojoResolution("gated");
    }
    const variantCode = this.resolveVariant(charaNum, state);
    const variant = this.findVariant(charaNum, variantCode);
    const node = variant?.encounter
      ? this.getOrParseEncounter(charaNum, variantCode, variant.encounter)
      : null;
    return node
      ? resolveKojoNodeWithChoices(
          node,
          charaNum,
          state,
          rng,
          [],
          choices,
          {
            nameResolver: (reference) =>
              typeof reference === "number" ? this.nameResolver?.(reference) : undefined,
          },
        )
      : emptyInteractiveKojoResolution("not-authored");
  }

  resolveRoomDescriptionKojo(
    charaNum: number,
    state: Readonly<GameState>,
    rng: Rng,
  ): KojoLine[] {
    if (!this.kojoEnabledForTarget(state, charaNum)) return [];

    // Active variant, same CFLAG:998 selector as collect.
    const variantCode = this.resolveVariant(charaNum, state);
    const variant = this.findVariant(charaNum, variantCode);
    if (!variant?.roomDescription) return [];

    // `@K{n}{infix}_ROOM_DESCRIPTION` — one func, no arm/args (ANOTHER_TALK.
    // ERB:1023 dispatch). Builds the room's ambient description in LOCALS.
    const node = this.getOrParseRoomDescription(charaNum, variantCode, variant.roomDescription);
    return node ? resolveKojoNode(node, charaNum, state, rng) : [];
  }

  resolveRoomDescriptionKojoDetailed(
    charaNum: number,
    state: Readonly<GameState>,
    rng: Rng,
  ): KojoResolution {
    if (!this.kojoEnabledForTarget(state, charaNum)) return emptyKojoResolution("gated");
    const variantCode = this.resolveVariant(charaNum, state);
    const variant = this.findVariant(charaNum, variantCode);
    const node = variant?.roomDescription
      ? this.getOrParseRoomDescription(charaNum, variantCode, variant.roomDescription)
      : null;
    return node
      ? resolveKojoNodeDetailed(node, charaNum, state, rng)
      : emptyKojoResolution("not-authored");
  }

  resolveUpdateKojoInteractive(
    charaNum: number,
    state: Readonly<GameState>,
    rng: Rng,
    choices: readonly number[],
  ): InteractiveKojoResolution {
    if (!this.kojoEnabledForTarget(state, charaNum)) {
      return emptyInteractiveKojoResolution("gated");
    }
    const variantCode = this.resolveVariant(charaNum, state);
    const variant = this.findVariant(charaNum, variantCode);
    const node = variant?.update
      ? this.getOrParseUpdate(charaNum, variantCode, variant.update)
      : null;
    return node
      ? resolveKojoNodeWithChoices(
          node,
          charaNum,
          state,
          rng,
          [],
          choices,
        )
      : emptyInteractiveKojoResolution("not-authored");
  }

  hasUpdateKojo(charaNum: number, state: Readonly<GameState>): boolean {
    if (!this.kojoEnabledForTarget(state, charaNum)) return false;
    const variantCode = this.resolveVariant(charaNum, state);
    return Boolean(this.findVariant(charaNum, variantCode)?.update);
  }

  resolveMarkKojo(
    charaNum: number,
    level: 1 | 2 | 3,
    state: Readonly<GameState>,
    rng: Rng,
    markId: 0 | 1 | 2 | 3 | 5 = 3,
  ): KojoLine[] {
    if (!this.kojoEnabledForTarget(state, charaNum)) return [];
    const variantCode = this.resolveVariant(charaNum, state);
    const variant = this.findVariant(charaNum, variantCode);
    if (!variant?.mark) return [];
    const node = this.getOrParseMark(charaNum, variantCode, variant.mark);
    return node
      ? resolveKojoNode(
          node,
          charaNum,
          withMarkKojoContext(state, markId, level),
          rng,
        )
      : [];
  }

  resolveMarkKojoDetailed(
    charaNum: number,
    level: 1 | 2 | 3,
    state: Readonly<GameState>,
    rng: Rng,
    markId: 0 | 1 | 2 | 3 | 5 = 3,
  ) {
    if (!this.kojoEnabledForTarget(state, charaNum)) {
      return emptyKojoResolution("gated");
    }
    const variantCode = this.resolveVariant(charaNum, state);
    const variant = this.findVariant(charaNum, variantCode);
    const node = variant?.mark
      ? this.getOrParseMark(charaNum, variantCode, variant.mark)
      : null;
    return node
      ? resolveKojoNodeDetailed(
          node,
          charaNum,
          withMarkKojoContext(state, markId, level),
          rng,
        )
      : emptyKojoResolution("not-authored");
  }

  resolveMarkKojoInteractive(
    charaNum: number,
    level: 1 | 2 | 3,
    state: Readonly<GameState>,
    rng: Rng,
    choices: readonly number[],
    markId: 0 | 1 | 2 | 3 | 5 = 3,
  ): InteractiveKojoResolution {
    if (!this.kojoEnabledForTarget(state, charaNum)) {
      return emptyInteractiveKojoResolution("gated");
    }
    const variantCode = this.resolveVariant(charaNum, state);
    const variant = this.findVariant(charaNum, variantCode);
    const node = variant?.mark
      ? this.getOrParseMark(charaNum, variantCode, variant.mark)
      : null;
    return node
      ? resolveKojoNodeWithChoices(
          node,
          charaNum,
          withMarkKojoContext(state, markId, level),
          rng,
          [],
          choices,
        )
      : emptyInteractiveKojoResolution("not-authored");
  }

  resolveCounterKojo(
    charaNum: number,
    counterAction: number,
    state: Readonly<GameState>,
    rng: Rng,
  ): KojoLine[] {
    if (!this.kojoEnabledForTarget(state, charaNum)) return [];
    const variantCode = this.resolveVariant(charaNum, state);
    const variant = this.findVariant(charaNum, variantCode);
    const loc = variant?.counters?.[counterAction];
    const node = loc
      ? this.getOrParseCounter(charaNum, variantCode, counterAction, loc)
      : null;
    return node ? resolveKojoNode(node, charaNum, state, rng) : [];
  }

  resolveCounterKojoDetailed(
    charaNum: number,
    counterAction: number,
    state: Readonly<GameState>,
    rng: Rng,
  ): KojoResolution {
    if (!this.kojoEnabledForTarget(state, charaNum)) {
      return emptyKojoResolution("gated");
    }
    const variantCode = this.resolveVariant(charaNum, state);
    const variant = this.findVariant(charaNum, variantCode);
    const loc = variant?.counters?.[counterAction];
    const node = loc
      ? this.getOrParseCounter(charaNum, variantCode, counterAction, loc)
      : null;
    return node
      ? resolveKojoNodeDetailed(node, charaNum, state, rng)
      : emptyKojoResolution("not-authored");
  }

  resolveCounterKojoInteractive(
    charaNum: number,
    counterAction: number,
    state: Readonly<GameState>,
    rng: Rng,
    choices: readonly number[],
  ): InteractiveKojoResolution {
    if (!this.kojoEnabledForTarget(state, charaNum)) {
      return emptyInteractiveKojoResolution("gated");
    }
    const variantCode = this.resolveVariant(charaNum, state);
    const variant = this.findVariant(charaNum, variantCode);
    const loc = variant?.counters?.[counterAction];
    const node = loc
      ? this.getOrParseCounter(charaNum, variantCode, counterAction, loc)
      : null;
    return node
      ? resolveKojoNodeWithChoices(node, charaNum, state, rng, [], choices)
      : emptyInteractiveKojoResolution("not-authored");
  }

  resolvePalamKojo(
    charaNum: number,
    kind: PalamKojoKind,
    detail: string | number | undefined,
    state: Readonly<GameState>,
    rng: Rng,
    args: number[] = [],
  ): KojoLine[] {
    if (!this.kojoEnabledForTarget(state, charaNum)) return [];
    const variantCode = this.resolveVariant(charaNum, state);
    const variant = this.findVariant(charaNum, variantCode);
    const key = palamKojoKey(kind, detail);
    const loc = variant?.palams?.[key];
    const node = loc
      ? this.getOrParsePalam(charaNum, variantCode, key, loc)
      : null;
    return node ? resolveKojoNode(node, charaNum, state, rng, args) : [];
  }

  resolvePalamKojoDetailed(
    charaNum: number,
    kind: PalamKojoKind,
    detail: string | number | undefined,
    state: Readonly<GameState>,
    rng: Rng,
    args: number[] = [],
  ): KojoResolution {
    if (!this.kojoEnabledForTarget(state, charaNum)) {
      return emptyKojoResolution("gated");
    }
    const variantCode = this.resolveVariant(charaNum, state);
    const variant = this.findVariant(charaNum, variantCode);
    const key = palamKojoKey(kind, detail);
    const loc = variant?.palams?.[key];
    const node = loc
      ? this.getOrParsePalam(charaNum, variantCode, key, loc)
      : null;
    return node
      ? resolveKojoNodeDetailed(node, charaNum, state, rng, args)
      : emptyKojoResolution("not-authored");
  }

  resolvePalamKojoInteractive(
    charaNum: number,
    kind: PalamKojoKind,
    detail: string | number | undefined,
    state: Readonly<GameState>,
    rng: Rng,
    args: readonly number[] | undefined,
    choices: readonly number[],
  ): InteractiveKojoResolution {
    if (!this.kojoEnabledForTarget(state, charaNum)) {
      return emptyInteractiveKojoResolution("gated");
    }
    const variantCode = this.resolveVariant(charaNum, state);
    const variant = this.findVariant(charaNum, variantCode);
    const key = palamKojoKey(kind, detail);
    const loc = variant?.palams?.[key];
    const node = loc
      ? this.getOrParsePalam(charaNum, variantCode, key, loc)
      : null;
    return node
      ? resolveKojoNodeWithChoices(node, charaNum, state, rng, args ?? [], choices)
      : emptyInteractiveKojoResolution("not-authored");
  }

  hasDiaryKojo(
    charaNum: number,
    state: Readonly<GameState>,
    rng: Rng,
  ): boolean {
    if (!this.kojoEnabledForTarget(state, charaNum)) return false;

    const variantCode = this.resolveVariant(charaNum, state);
    const variant = this.findVariant(charaNum, variantCode);
    const loc = variant?.diaryExist;
    if (!loc) return false;

    const node = this.getOrParseDiaryExist(charaNum, variantCode, loc);
    if (!node) return false;
    const resolved = resolveKojoFunctionDetailed(node, charaNum, state, rng, [], {
      nameResolver: (reference) =>
        typeof reference === "number" ? this.nameResolver?.(reference) : undefined,
    });
    return resolved.status === "resolved" && resolved.returnValue !== 0;
  }

  resolveDiaryHook(
    charaNum: number,
    kind: "exist" | "before-check" | "after-check",
    state: Readonly<GameState>,
    rng: Rng,
  ): KojoFunctionResolution {
    if (!this.kojoEnabledForTarget(state, charaNum)) return emptyKojoFunctionResolution("gated");
    const variantCode = this.resolveVariant(charaNum, state);
    const variant = this.findVariant(charaNum, variantCode);
    const loc = kind === "exist"
      ? variant?.diaryExist
      : kind === "before-check"
        ? variant?.diaryBeforeCheck
        : variant?.diaryAfterCheck;
    if (!loc) return emptyKojoFunctionResolution("not-authored");
    const node = kind === "exist"
      ? this.getOrParseDiaryExist(charaNum, variantCode, loc)
      : kind === "before-check"
        ? this.getOrParseDiaryBeforeCheck(charaNum, variantCode, loc)
        : this.getOrParseDiaryAfterCheck(charaNum, variantCode, loc);
    return node
      ? resolveKojoFunctionDetailed(node, charaNum, state, rng, [], {
          nameResolver: (reference) =>
            typeof reference === "number" ? this.nameResolver?.(reference) : undefined,
        })
      : emptyKojoFunctionResolution("unsupported");
  }

  resolveDiaryKojo(
    charaNum: number,
    page: number,
    state: Readonly<GameState>,
    rng: Rng,
    args: number[] = [],
    mode?: string,
  ): KojoLine[] {
    if (!this.kojoEnabledForTarget(state, charaNum)) return [];

    const variantCode = this.resolveVariant(charaNum, state);
    const variant = this.findVariant(charaNum, variantCode);
    const loc = variant?.diaryText?.[page] ?? variant?.diaryText?.[0];
    if (!loc) return [];

    // TEXT bodies take 3 args: ARG:3 (page flag/mode), ARGS:2 (string),
    // ARG:4 (extra flag). The runtime parser already binds these via
    // `args` slot — `resolveKojoNode` reads `args[0]=ARG:3` etc.
    const node = this.getOrParseDiaryText(charaNum, variantCode, page, loc);
    const call = resolveDiaryCall(
      page,
      args,
      mode,
      mergeKojoSymbolTables(DEFAULT_KOJO_SYMBOLS, SCOPED_KOJO_SYMBOLS[String(charaNum)]),
    );
    return node
      ? resolveKojoNode(node, charaNum, state, rng, call.args, call.context)
      : [];
  }

  resolveDiaryKojoDetailed(charaNum: number, page: number, state: Readonly<GameState>, rng: Rng, args: number[] = [], mode?: string) {
    if (!this.kojoEnabledForTarget(state, charaNum)) return emptyKojoResolution("gated");
    const variantCode = this.resolveVariant(charaNum, state);
    const variant = this.findVariant(charaNum, variantCode);
    const loc = variant?.diaryText?.[page] ?? variant?.diaryText?.[0];
    const node = loc ? this.getOrParseDiaryText(charaNum, variantCode, page, loc) : null;
    const call = resolveDiaryCall(
      page,
      args,
      mode,
      mergeKojoSymbolTables(DEFAULT_KOJO_SYMBOLS, SCOPED_KOJO_SYMBOLS[String(charaNum)]),
    );
    return node
      ? resolveKojoNodeDetailed(node, charaNum, state, rng, call.args, call.context)
      : emptyKojoResolution("not-authored");
  }

  resolveDiaryKojoInteractive(
    charaNum: number,
    page: number,
    state: Readonly<GameState>,
    rng: Rng,
    args: readonly number[] | undefined,
    choices: readonly number[],
    mode?: string,
  ): InteractiveKojoResolution {
    if (!this.kojoEnabledForTarget(state, charaNum)) {
      return emptyInteractiveKojoResolution("gated");
    }
    const variantCode = this.resolveVariant(charaNum, state);
    const variant = this.findVariant(charaNum, variantCode);
    const loc = variant?.diaryText?.[page] ?? variant?.diaryText?.[0];
    const node = loc
      ? this.getOrParseDiaryText(charaNum, variantCode, page, loc)
      : null;
    const call = resolveDiaryCall(
      page,
      args,
      mode,
      mergeKojoSymbolTables(DEFAULT_KOJO_SYMBOLS, SCOPED_KOJO_SYMBOLS[String(charaNum)]),
    );
    return node
      ? resolveKojoNodeWithChoices(
          node,
          charaNum,
          state,
          rng,
          call.args,
          choices,
          call.context,
        )
      : emptyInteractiveKojoResolution("not-authored");
  }

  resolveDiaryHappen(
    charaNum: number,
    page: number,
    state: Readonly<GameState>,
    rng: Rng,
  ): DiaryHappenResolution {
    const noFire = { fired: false, resultSlot1: 0 as const, resultSlot2: 0 as const };
    if (!this.kojoEnabledForTarget(state, charaNum)) return noFire;

    const variantCode = this.resolveVariant(charaNum, state);
    const variant = this.findVariant(charaNum, variantCode);
    const loc = variant?.diaryHappens?.[page];
    if (!loc) return noFire;

    const node = this.getOrParseDiaryHappen(charaNum, variantCode, page, loc);
    if (!node) return noFire;
    const resolved = resolveKojoFunctionDetailed(node, charaNum, state, rng, [], {
      nameResolver: (reference) =>
        typeof reference === "number" ? this.nameResolver?.(reference) : undefined,
    });
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
  }

  resolveIraiKojo(
    charaNum: number,
    role: string,
    scene: string,
    iraiId: number,
    state: Readonly<GameState>,
    rng: Rng,
  ): KojoLine[] {
    if (!this.kojoEnabledForTarget(state, charaNum)) return [];

    const variantCode = this.resolveVariant(charaNum, state);
    const variant = this.findVariant(charaNum, variantCode);
    if (!variant) return [];

    const out: KojoLine[] = [];
    const clientId = iraiIdToClient(iraiId);
    const targetName =
      this.nameResolver?.(charaNum) ?? state.charas[charaNum]?.callName ?? "对方";
    const clientName =
      this.nameResolver?.(clientId) ?? state.charas[clientId]?.callName ?? targetName;
    const context = {
      nameResolver: (reference: number | string) =>
        typeof reference === "number" ? this.nameResolver?.(reference) : undefined,
      callNameAliases: { CHARA: targetName, CLIENT_ID: clientName },
      subjectAliases: { CLIENT_ID: clientId },
      targetName,
    };

    // The generic IRAI wrapper TRYCALLs a name hook and then a local-id hook.
    // Those calls are additive upstream, so never stop after the first body.
    for (const selector of iraiKojoSelectorKeys(iraiId)) {
      const byRole = variant.irai?.[selector];
      const loc = byRole?.[role]?.[scene] ?? byRole?.["*"]?.[scene];
      if (!loc) continue;
      const node = this.getOrParseIrai(charaNum, variantCode, selector, role, scene, loc);
      if (node) out.push(...resolveKojoNode(node, charaNum, state, rng, [], context));
    }
    return out;
  }

  // ── Cache stats (for tests / debug) ───────────────────────────────

  /** Number of cached entries. */
  cacheSize(): number {
    return this.cache.size;
  }

  /** Clear all cached entries (e.g. for hot-reload in dev mode). */
  clearCache(): void {
    this.cache.clear();
  }

  /** Expose the index for tests. */
  getIndex(): Readonly<KojoCommandIndex> {
    return this.index;
  }

  // ── Internals ─────────────────────────────────────────────────────

  /** Read CFLAG:{charaNum}:998 → variantCode string. Defaults to "". */
  private resolveVariant(charaNum: number, state: Readonly<GameState>): string {
    const variants = this.index.variants[charaNum] ?? [];
    return resolveActiveKojoVariantCode(
      state,
      charaNum,
      variants.map((variant) => variant.variantCode),
      "",
    );
  }

  /** Apply the same opening-flow kojo gates as the browser bundle router. */
  private kojoEnabledForTarget(state: Readonly<GameState>, charaNum: number): boolean {
    // `disabledKojo` is an explicit per-character opt-out from the opening
    // flow. It must be honored for single-variant packs as well as variants
    // with multiple authored branches so every adapter shares the same gate.
    if (state.disabledKojo?.[charaNum]) return false;
    const roleplayTarget = state.flagStore[ROLEPLAY_FLAG_ID] ?? 0;
    if (roleplayTarget === 0) return true;
    const slot = charaNum === 0 ? state.master : state.charas[charaNum];
    return (slot?.state.CFLAG?.[ROLEPLAY_KOJO_PRESENT_CFLAG_ID] ?? 0) !== 0;
  }

  /** Find the variant index entry for a (charaNum, variantCode). Falls
   *  back to variantCode "" (default) if the requested one doesn't exist. */
  private findVariant(charaNum: number, variantCode: string): VariantIndex | undefined {
    const vis = this.index.variants[charaNum];
    if (!vis) return undefined;
    // Exact match first
    const exact = vis.find((v) => v.variantCode === variantCode);
    if (exact) return exact;
    // Fall back to default variant
    if (variantCode !== "") return vis.find((v) => v.variantCode === "");
    return undefined;
  }

  /** Get a parsed KojoNode from cache, or parse and cache it. */
  private getOrParse(
    charaNum: number,
    variantCode: string,
    comType: string,
    cmd: number,
    loc: FuncLocation,
  ): KojoNode | null {
    const key = `${charaNum}:${variantCode}:${comType}:${cmd}`;
    const cached = this.cache.get(key);
    if (cached) return cached.node;

    const node = this.parseFuncFromFile(loc, charaNum, variantCode);
    if (node) {
      this.cache.set(key, { node, cachedAt: Date.now() });
    }
    return node;
  }

  /** Parse an EVENT-arm personal kojo (`M_KOJO_EVENT_K{n}_{arm}`) from
   *  cache or file. Keyed per-(chara, variant, arm) since the body is
   *  callName-substituted at parse time. Phase 8 朝夜挨拶. */
  private getOrParseEventArm(
    charaNum: number,
    variantCode: string,
    arm: number,
    loc: FuncLocation,
  ): KojoNode | null {
    const key = `EVENT_ARM:${charaNum}:${variantCode}:${arm}`;
    const cached = this.cache.get(key);
    if (cached) return cached.node;
    const node = this.parseFuncFromFile(loc, charaNum, variantCode);
    if (node) {
      this.cache.set(key, { node, cachedAt: Date.now() });
    }
    return node;
  }

  /** SP_EVENT cache+parse — same shape as the EVENT-arm helper, keyed by
   *  scenario subid (DAYEVENT slice). */
  private getOrParseSpEvent(
    charaNum: number,
    variantCode: string,
    subid: number,
    loc: FuncLocation,
  ): KojoNode | null {
    const key = `SP_EVENT:${charaNum}:${variantCode}:${subid}`;
    const cached = this.cache.get(key);
    if (cached) return cached.node;
    const node = this.parseFuncFromFile(loc, charaNum, variantCode);
    if (node) {
      this.cache.set(key, { node, cachedAt: Date.now() });
    }
    return node;
  }

  /** ENCOUNTER cache+parse — same shape as the EVENT-arm helper, but there is
   *  a single first-meeting func per (chara, variant), so no arm key. */
  private getOrParseEncounter(
    charaNum: number,
    variantCode: string,
    loc: FuncLocation,
  ): KojoNode | null {
    const key = `ENCOUNTER:${charaNum}:${variantCode}`;
    const cached = this.cache.get(key);
    if (cached) return cached.node;
    // ENCOUNTER bodies may delegate their opening setup prompt to a helper in
    // the same ERB file. Luna K6 does this with
    // `CALL KOJO_OPTION_K6_RESULT_1`; without static same-file expansion the
    // prompt and its CFLAG write are silently skipped.
    const node = this.parseFuncFromFile(loc, charaNum, variantCode, false, true);
    if (node) {
      this.cache.set(key, { node, cachedAt: Date.now() });
    }
    return node;
  }

  /** ROOM_DESCRIPTION cache+parse — one `@K{n}{infix}_ROOM_DESCRIPTION` body
   *  per (chara, variant). The func builds the room's ambient description in
   *  `LOCALS`; the parser already models string-local assignments, so the
   *  static-router can evaluate it against live state. */
  private getOrParseRoomDescription(
    charaNum: number,
    variantCode: string,
    loc: FuncLocation,
  ): KojoNode | null {
    const key = `ROOM_DESCRIPTION:${charaNum}:${variantCode}`;
    const cached = this.cache.get(key);
    if (cached) return cached.node;
    const node = this.parseFuncFromFile(loc, charaNum, variantCode);
    if (node) {
      this.cache.set(key, { node, cachedAt: Date.now() });
    }
    return node;
  }

  /** UPDATE cache+parse — one `@M_KOJO_UPDATE_K{XX}` body per (chara, variant),
   *  invoked from the shop UPDATE menu via `TRYCALLFORM M_KOJO{suffix}_UPDATE_K{N}`
   *  upstream. The body is author-authored setup Q&A guarded by a per-character
   *  `CFLAG:VERSION` check; the cache key is `(chara, variant)` only. */
  private getOrParseUpdate(
    charaNum: number,
    variantCode: string,
    loc: FuncLocation,
  ): KojoNode | null {
    const key = `UPDATE:${charaNum}:${variantCode}`;
    const cached = this.cache.get(key);
    if (cached) return cached.node;
    const node = this.parseFuncFromFile(loc, charaNum, variantCode);
    if (node) {
      this.cache.set(key, { node, cachedAt: Date.now() });
    }
    return node;
  }

  /** DAYEVENT_COND cache+parse. The function is a return-value hook and
   * receives the scenario as ARG plus "day"/"night" as ARGS. */
  private getOrParseDayEventCondition(
    charaNum: number,
    variantCode: string,
    loc: FuncLocation,
  ): KojoNode | null {
    const key = `DAYEVENT_COND:${charaNum}:${variantCode}`;
    const cached = this.cache.get(key);
    if (cached) return cached.node;
    const node = this.parseFuncFromFile(loc, charaNum, variantCode, true);
    if (node) {
      this.cache.set(key, { node, cachedAt: Date.now() });
    }
    return node;
  }

  /** IRAI_BLOCKED cache+parse. The function receives the local request id as ARG. */
  private getOrParseIraiBlocked(
    charaNum: number,
    variantCode: string,
    loc: FuncLocation,
  ): KojoNode | null {
    const key = `IRAI_BLOCKED:${charaNum}:${variantCode}`;
    const cached = this.cache.get(key);
    if (cached) return cached.node;
    const node = this.parseFuncFromFile(loc, charaNum, variantCode, true);
    if (node) {
      this.cache.set(key, { node, cachedAt: Date.now() });
    }
    return node;
  }

  private getOrParseMark(
    charaNum: number,
    variantCode: string,
    loc: FuncLocation,
  ): KojoNode | null {
    const key = `MARK:${charaNum}:${variantCode}`;
    const cached = this.cache.get(key);
    if (cached) return cached.node;
    const node = this.parseFuncFromFile(loc, charaNum, variantCode);
    if (node) {
      this.cache.set(key, { node, cachedAt: Date.now() });
    }
    return node;
  }

  /** COUNTER cache+parse, keyed by the upstream `TCVAR:20` action id. */
  private getOrParseCounter(
    charaNum: number,
    variantCode: string,
    counterAction: number,
    loc: FuncLocation,
  ): KojoNode | null {
    const key = `COUNTER:${charaNum}:${variantCode}:${counterAction}`;
    const cached = this.cache.get(key);
    if (cached) return cached.node;
    const node = this.parseFuncFromFile(loc, charaNum, variantCode);
    if (node) {
      this.cache.set(key, { node, cachedAt: Date.now() });
    }
    return node;
  }

  /** PALAM cache+parse, keyed by the exact source phase/detail string. */
  private getOrParsePalam(
    charaNum: number,
    variantCode: string,
    key: string,
    loc: FuncLocation,
  ): KojoNode | null {
    const cacheKey = `PALAM:${charaNum}:${variantCode}:${key}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached.node;
    const node = this.parseFuncFromFile(loc, charaNum, variantCode);
    if (node) {
      this.cache.set(cacheKey, { node, cachedAt: Date.now() });
    }
    return node;
  }

  /** IRAI scene cache+parse, keyed by source selector, role, and scene. */
  private getOrParseIrai(
    charaNum: number,
    variantCode: string,
    selector: string,
    role: string,
    scene: string,
    loc: IraiSceneLocation,
  ): KojoNode | null {
    const key = `IRAI:${charaNum}:${variantCode}:${selector}:${role}:${scene}`;
    const cached = this.cache.get(key);
    if (cached) return cached.node;
    const node = this.parseFuncFromFile(loc, charaNum, variantCode);
    if (node) {
      this.cache.set(key, { node, cachedAt: Date.now() });
    }
    return node;
  }

  /** DIARY EXIST gate cache+parse. Keyed by (chara, variant); the body is
   *  a small PRINTFORML marker + optional TALENT/CFLAG gate, evaluated
   *  via `resolveKojoNode` to decide "has diary". */
  private getOrParseDiaryExist(
    charaNum: number,
    variantCode: string,
    loc: FuncLocation,
  ): KojoNode | null {
    const key = `DIARY_EXIST:${charaNum}:${variantCode}`;
    const cached = this.cache.get(key);
    if (cached) return cached.node;
    const node = this.parseFuncFromFile(loc, charaNum, variantCode);
    if (node) {
      this.cache.set(key, { node, cachedAt: Date.now() });
    }
    return node;
  }

  private getOrParseDiaryBeforeCheck(
    charaNum: number,
    variantCode: string,
    loc: FuncLocation,
  ): KojoNode | null {
    const key = `DIARY_BEFORE_CHECK:${charaNum}:${variantCode}`;
    const cached = this.cache.get(key);
    if (cached) return cached.node;
    const node = this.parseFuncFromFile(loc, charaNum, variantCode, true, true);
    if (node) this.cache.set(key, { node, cachedAt: Date.now() });
    return node;
  }

  private getOrParseDiaryAfterCheck(
    charaNum: number,
    variantCode: string,
    loc: FuncLocation,
  ): KojoNode | null {
    const key = `DIARY_AFTER_CHECK:${charaNum}:${variantCode}`;
    const cached = this.cache.get(key);
    if (cached) return cached.node;
    const node = this.parseFuncFromFile(loc, charaNum, variantCode, true, true);
    if (node) this.cache.set(key, { node, cachedAt: Date.now() });
    return node;
  }

  /** DIARY TEXT page cache+parse. Keyed by (chara, variant, page); each page
   *  is one KojoNode that takes 3 args (ARG:3, ARGS:2, ARG:4). */
  private getOrParseDiaryText(
    charaNum: number,
    variantCode: string,
    page: number,
    loc: FuncLocation,
  ): KojoNode | null {
    const key = `DIARY_TEXT:${charaNum}:${variantCode}:${page}`;
    const cached = this.cache.get(key);
    if (cached) return cached.node;
    const node = this.parseFuncFromFile(loc, charaNum, variantCode);
    if (node) {
      this.cache.set(key, { node, cachedAt: Date.now() });
    }
    return node;
  }

  /** DIARY HAPPEN page cache+parse. Keyed by (chara, variant, page); no args. */
  private getOrParseDiaryHappen(
    charaNum: number,
    variantCode: string,
    page: number,
    loc: FuncLocation,
  ): KojoNode | null {
    const key = `DIARY_HAPPEN:${charaNum}:${variantCode}:${page}`;
    const cached = this.cache.get(key);
    if (cached) return cached.node;
    const node = this.parseFuncFromFile(
      loc,
      charaNum,
      variantCode,
      true,
    );
    if (node) {
      this.cache.set(key, { node, cachedAt: Date.now() });
    }
    return node;
  }

  /**
   * Read an ERB file slice, extract the @-func, parse it into a
   * KojoNode tree. Returns null on any failure (file missing, parse
   * error, etc.) so the caller can continue the fallback chain.
   */
  private parseFuncFromFile(
    loc: FuncLocation | IraiSceneLocation,
    charaNum: number,
    _variantCode: string,
    captureFunctionResults = false,
    expandSameFileStaticCalls = false,
  ): KojoNode | null {
    try {
      const isIraiScene = "sceneLineStart" in loc && "sceneLineEnd" in loc;
      // Build the substitution context. Only callee-side tokens are
      // pre-resolved here (`%CALLNAME:TARGET%` / `%CALLNAME:NN%` for
      // N≠0). The three player-caller tokens (`MASTER`/`PLAYER`/`0`)
      // are left verbatim in the cached node and resolved at emit time
      // against live `state.master.callName` —
      // `runtime/kojo/text-renderer.ts::substituteKojoCallNames`. With no
      // resolver wired, the callee falls back to "对方" (readable,
      // chara-neutral). Because the cache key includes `charaNum`, the
      // per-chara substituted node is never shared across characters.
      const ctx: SubstituteContext = {
        ...DEFAULT_CONTEXT,
        calleeName: this.nameResolver?.(charaNum) ?? "对方",
        calleeCharaNum: charaNum,
        ...(isIraiScene
          ? { deferredCallNameAliases: ["CHARA", "CLIENT_ID"] }
          : {}),
      };

      // Read the file and extract the target lines
      const text = this.readText(loc.filePath, this.projectRoot);
      const lines = text.split("\n");
      const slice = isIraiScene
        ? [
            lines[loc.lineStart - 1] ?? `@${loc.funcName.replace(/^@/, "")}`,
            ...lines.slice(
              Math.max(0, loc.sceneLineStart - 1),
              Math.min(Math.max(0, loc.sceneLineEnd - 1), lines.length),
            ),
          ].join("\n")
        : lines.slice(loc.lineStart - 1, Math.min(loc.lineEnd, lines.length)).join("\n");

      // Extract @-funcs from the slice. The target func should be the
      // first one (since lineStart points to its declaration).
      const funcs = extractFuncs(slice);
      if (funcs.length === 0) return null;

      // Find the func matching our target name
      const targetName = loc.funcName.startsWith("@")
        ? loc.funcName.slice(1)
        : loc.funcName;
      const fn = funcs.find((f) => f.name === targetName) ?? funcs[0]!;

      const effectiveSymbols = mergeKojoSymbolTables(
        DEFAULT_KOJO_SYMBOLS,
        SCOPED_KOJO_SYMBOLS[String(charaNum)],
      );
      const scopedDeclarations = SCOPED_KOJO_DECLARATIONS[String(charaNum)];

      // Parse into KojoNode tree
      const functions = expandSameFileStaticCalls
        ? new Map(extractFuncs(text).map((candidate) => [candidate.name.toUpperCase(), candidate]))
        : null;
      const parseWithStaticCalls = (
        current: typeof fn,
        visiting: ReadonlySet<string>,
      ): ParsedKojoFunc => parseFunc(current, ctx, {
        captureFunctionResults,
        symbols: effectiveSymbols,
        namedLocals: [
          ...GLOBAL_KOJO_DECLARATIONS.numeric,
          ...(scopedDeclarations?.numeric ?? []),
        ],
        namedStringLocals: [
          ...GLOBAL_KOJO_DECLARATIONS.string,
          ...(scopedDeclarations?.string ?? []),
        ],
        resolveStaticCall: functions
          ? (functionName, args, line) => {
              const callee = functions.get(`@${functionName}`.toUpperCase());
              const canonical = callee?.name.toUpperCase();
              if (callee && canonical && !visiting.has(canonical)) {
                const bound = bindStaticCallArguments(callee, args);
                const body = parseWithStaticCalls(bound, new Set([...visiting, canonical])).body;
                // Preserve the cache's existing fail-closed boundary: expand a
                // helper only when its whole static body is supported. This lets
                // K6's first authored option run without pulling the separate,
                // still-unsupported ASK_M ability-customization helper into the
                // same transaction and discarding the completed first choice.
                if (!containsUnsupportedKojoNode(body)) return body;
              }
              return resolveDiaryStaticCall(functionName, args, line, effectiveSymbols);
            }
          : undefined,
      });
      const parsed = parseWithStaticCalls(fn, new Set([fn.name.toUpperCase()]));
      return parsed.body;
    } catch {
      return null;
    }
  }
}
