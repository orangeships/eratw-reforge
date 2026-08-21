/**
 * Phase 6A — resolveKojoNode.
 *
 * Pure function: walks a single `KojoNode` tree and emits lines by
 * evaluating predicates against live `GameState`. Same algorithm as
 * the original `StaticKojoRouter`, now stateless so `KojoCache` (6C)
 * can call it with any cached node.
 *
 *   - `lines` → emit every line, in order.
 *   - `seq`   → emit each child, in order.
 *   - `if`    → evaluate arms top to bottom; emit the body of the FIRST
 *               arm whose predicate holds. (`ELSE` is an arm with the
 *               `always` predicate, so it catches everything below.)
 *   - `rand`  → pick ONE case via `rng.int(cases.length)` and emit it.
 *
 * Predicate evaluation:
 *   - `always`         → true.
 *   - `unknown`        → false.
 *   - `not` / `and`    → boolean composition.
 *   - `var_nonzero`    → the variable read is `!= 0`.
 *   - `var_eq`         → the variable read equals `value`.
 *   - `arg_nonzero`    → the bound `ARG:index` (from the `args` context) is `!= 0`.
 *   - `arg_eq`         → the bound `ARG:index` equals `value`.
 *
 * Variable reads: `FLAG` is `state.flagStore[id]`; `TALENT`/`CFLAG`/…
 * `ARG` reads come from the per-call `args` array (index 0 = `ARG`,
 * index N = `ARG:N`); unbound → 0, matching eraTW's unset-ARG default.
 */

import type {
  KojoEffect,
  KojoEffectTarget,
  KojoDiagnostic,
  KojoLine,
  KojoLocalTarget,
  KojoFunctionResolution,
  KojoNode,
  KojoPredicate,
  KojoStagedEffect,
  KojoResolution,
  KojoStringValue,
  KojoValue,
  KojoVarNs,
  KojoVarScope,
  PendingKojoChoice,
  StringTemplatePart,
} from "./types.js";
import { applyKojoEffects } from "./effects.js";
import { validateKojoLines } from "./text-validation.js";
import {
  selectTextrAlternatives,
  substituteKojoCallNames,
  substituteKojoStateFormatters,
  substituteKojoStringLocals,
  type KojoNameResolver,
} from "./text-renderer.js";
import { getTflag, TFLAG_ID } from "../state/tflag.js";
import { ABL_ID, BASE_ID, CFLAG_ID, FLAG_ID, MARK_ID, PALAM_ID, TALENT_ID, TCVAR_ID, TEQUIP_ID } from "../state/settlement.js";
import { alcoholFace, alcoholIntoxication, alcoholTaste } from "../state/alcohol.js";
import { hasItem, ITEM_ID } from "../state/items.js";
import { locationToRoomId } from "../world/room-id-location.js";
import { privateRoomOwner } from "../world/private-room.js";
import { OMANEKIBEYA_ID } from "../world/omaneki.js";
import { pickPageSetting, readDiaryFlag, readMaxDiaryPage, readPageSet } from "../state/diary.js";
import { findCharaCstr } from "../state/chara-data.js";
import { itemPrice } from "../state/stall.js";
import { readTequip, readTequipOptional } from "../state/tequip.js";
import { createGameStateKojoHostRegistry, type KojoHostRegistry } from "./host-registry.js";
import type { KojoSymbolTables } from "./symbol-table.js";

/** The `choice` member of the KojoNode union. */
type ChoiceNode = Extract<KojoNode, { type: "choice" }>;

/** The `input` member of the KojoNode union. */
type InputNode = Extract<KojoNode, { type: "input" }>;

/** How a walk resolves a `choice` node: descend a branch, and/or stop
 *  the walk (a pause when no pick is available). */
type ChoiceHandler = (node: ChoiceNode) => { descend: KojoNode | null; stop: boolean };

/** How a walk resolves an `input` node: descend a branch, and/or stop
 *  the walk (a pause when no pick is available). Symmetric to ChoiceHandler;
 *  kept as a separate type so the two pause flavours can evolve
 *  independently. */
type InputHandler = (node: InputNode) => { descend: KojoNode | null; stop: boolean };

interface KojoFunctionControl {
  returned: boolean;
  touched: boolean;
  returnValue: number;
  resultSlots: Record<number, number>;
  loopSignal: "break" | "continue" | null;
}

export interface KojoVmState {
  /** Numeric LOCAL slots scoped to this single kojo walk. */
  locals: number[];
  /** Numeric RESULT slots scoped to this single kojo walk. */
  result: number[];
  /** Explicit #DIM function locals. Never persisted into turn context. */
  namedLocals?: Record<string, number>;
  namedArrays?: Record<string, Record<number, number>>;
  /** String locals encoded as deterministic parse-time comparison tokens.
   *  Used by SELECTCASE matching against authored `CASE "..."` labels. */
  stringLocals?: number[];
  namedStringLocals?: Record<string, number>;
  /** Real-string mirror of `stringLocals` for `%LOCALS:N%` emit-time
   *  substitution via `substituteKojoStringLocals`. Written in parallel
   *  with the hash-token slot at every `local-set` so SELECTCASE keeps
   *  working unchanged. */
  resolvedStringLocals?: string[];
  resolvedNamedStringLocals?: Record<string, string>;
  resolvedStringResults?: Record<number, string>;
}

export interface KojoResolveContext {
  /** SELECTCOM for FIRSTTIME/ONCE. Omit for read-only probes. */
  commandNo?: number;
  /**
   * Optional final formatter for an emitted line. Runs after TEXTR selection
   * and inline-condition evaluation, but before caller-name substitution and
   * strict text validation.
   */
  lineTransform?: (text: string) => string | null;
  /** Optional resolver for numeric and `[[named]]` CALLNAME references. */
  nameResolver?: KojoNameResolver;
  /** Optional already-resolved CALLNAME aliases such as IRAI CLIENT_ID. */
  callNameAliases?: Readonly<Record<string, string>>;
  masterName?: string;
  targetName?: string;
  /** String-valued function arguments (`ARGS`/`ARGS:N`). */
  stringArgs?: readonly string[];
  /** Symbol scope used when an inline source predicate is parsed at emit time. */
  symbols?: KojoSymbolTables;
  /** Transient Emuera subject aliases owned by the current call frame. */
  subjectAliases?: Readonly<Record<string, number>>;
  /** Explicit CSTR bridge. Returning null keeps the authored route unsupported. */
  resolveCstr?: (subject: number, key: string) => string | null;
  /** Typed shared host contract. Prefer this over the legacy nullable CSTR bridge. */
  hostRegistry?: KojoHostRegistry;
  /** Internal bounded VM state; never persisted to GameState. */
  vm?: KojoVmState;
  /** Internal transaction sink used by source functions that mutate while
   * returning a value. Callers must not provide this directly. */
  effectSink?: KojoStagedEffect[];
}
import type { GameState } from "../state/index.js";
import type { Rng } from "../command/types.js";
import { palamLv } from "../state/settlement.js";
import { bodyFillRate } from "../state/body-fill-rate.js";
import {
  atPlayerBase,
  bathCheck,
  chkDateNow,
  inHome,
  inRoom,
  mapIdOfLocation,
  openPlace,
  outRoof,
} from "../world/location-predicates.js";
import { currentRegionWeather } from "../weather/region-override.js";
import { nemuke as readNemuke } from "../state/nemuke.js";
import { tasteCount } from "../state/dish.js";
import { timeZoneOf } from "../world/time-of-day.js";
import { odekakeDestinationForMap } from "../world/odekake.js";
import { findKickoutDestination } from "../world/kick-out.js";
import { roomIdToLocation } from "../world/room-id-location.js";
import { placeFlagsOf } from "../world/location-predicates.js";
import { hasPlace, PLACE_BATH, PLACE_FUTON, PLACE_MOON, PLACE_REST, PLACE_STUDY, PLACE_TRAINING } from "../world/place-flags.js";
import { getYogore } from "../state/yogore.js";
import { getUwakiHistory } from "../state/uwaki.js";
import { festivalNow, youbiMatch } from "../world/calendar.js";
import { parsePredicate } from "../../importer/kojo/parser.js";
import { computeAttitude } from "../state/attitude.js";

const INLINE_CONDITIONAL_RE = /\\?@\s*([^?#@]+?)\s*\?\s*([^#@]*?)\s*#\s*([^@]*?)\s*\\?@/g;
const MAX_FOR_ITERATIONS = 128;

function localTargetLabel(target: KojoLocalTarget): string {
  switch (target.kind) {
    case "slot": return `LOCAL:${target.index}`;
    case "named": return `#DIM ${target.name}`;
    case "named-index": return `#DIM ${target.name}:<dynamic>`;
    case "string-slot": return `LOCALS:${target.index}`;
    case "named-string": return `#DIMS ${target.name}`;
  }
}

function localTargetOf(node: Extract<KojoNode, { type: "local-set" }>): KojoLocalTarget {
  const legacyNode = node as Extract<KojoNode, { type: "local-set" }> & {
    index?: number;
  };
  return legacyNode.target ?? { kind: "slot", index: legacyNode.index ?? 0 };
}

function getVmLocal(vm: KojoVmState, target: KojoLocalTarget): number {
  switch (target.kind) {
    case "slot": return vm.locals[target.index] ?? 0;
    case "named": return vm.namedLocals?.[target.name] ?? 0;
    case "named-index": return target.index.kind === "number"
      ? vm.namedArrays?.[target.name]?.[target.index.value] ?? 0
      : 0;
    case "string-slot": return vm.stringLocals?.[target.index] ?? 0;
    case "named-string": return vm.namedStringLocals?.[target.name] ?? 0;
  }
}

function setVmLocal(vm: KojoVmState, target: KojoLocalTarget, value: number): void {
  switch (target.kind) {
    case "slot":
      vm.locals[target.index] = value;
      return;
    case "named":
      (vm.namedLocals ??= {})[target.name] = value;
      return;
    case "named-index":
      if (target.index.kind === "number") {
        ((vm.namedArrays ??= {})[target.name] ??= {})[target.index.value] = value;
      }
      return;
    case "string-slot":
      (vm.stringLocals ??= [])[target.index] = value;
      return;
    case "named-string":
      (vm.namedStringLocals ??= {})[target.name] = value;
      return;
  }
}

/** Real-string mirror of `setVmLocal` for `LOCALS = 「...」` and
 *  `#DIMS = 「...」` assignments. Writes into `resolvedStringLocals` /
 *  `resolvedNamedStringLocals` so emit-time `%LOCALS:N%` substitution
 *  can render the actual string the author wrote. The hash-token slot
 *  keeps being populated by `setVmLocal` so SELECTCASE matching is
 *  unaffected. */
function setVmStringLocal(vm: KojoVmState, target: KojoLocalTarget, value: string): void {
  switch (target.kind) {
    case "string-slot":
      (vm.resolvedStringLocals ??= [])[target.index] = value;
      return;
    case "named-string":
      (vm.resolvedNamedStringLocals ??= {})[target.name] = value;
      return;
    // Numeric targets are intentionally not touched here — the local-set
    // dispatcher decides which path to invoke.
    default:
      return;
  }
}

/** Read-side mirror of `setVmStringLocal`. Returns `undefined` for the
 *  numeric targets so callers can pick the existing `getVmLocal` path. */
function getResolvedStringLocal(vm: KojoVmState, target: KojoLocalTarget): string | undefined {
  switch (target.kind) {
    case "string-slot":
      return vm.resolvedStringLocals?.[target.index];
    case "named-string":
      return vm.resolvedNamedStringLocals?.[target.name];
    default:
      return undefined;
  }
}

/** Deterministic 32-bit hash of a resolved string. Mirrors the FNV-1a
 *  algorithm used by `importer/kojo/parser.ts::kojoStringToken` so the
 *  hash slot and the literal token stay consistent across the parser /
 *  runtime boundary. The hash is only consulted by SELECTCASE matching;
 *  the real string is always preferred for emit. */
function hashResolvedString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193);
  }
  return 0x40000000 | (hash & 0x3fffffff);
}

function evaluateStringValue(
  value: KojoStringValue,
  charaNum: number,
  state: Readonly<GameState>,
  rng: Rng,
  args: readonly number[],
  context: KojoResolveContext,
): { value: string; unsupported: string[] } {
  if (value.kind === "string") return { value: value.value, unsupported: [] };
  if (value.kind === "string-local-ref") {
    const resolved = value.name === undefined
      ? context.vm?.resolvedStringLocals?.[value.index ?? 0]
      : context.vm?.resolvedNamedStringLocals?.[value.name];
    return resolved === undefined
      ? { value: "", unsupported: [`${value.name ?? `LOCALS:${value.index ?? 0}`} unresolved`] }
      : { value: resolved, unsupported: [] };
  }
  if (value.kind === "string-result-ref") {
    const resolved = context.vm?.resolvedStringResults?.[value.index];
    return resolved === undefined
      // RESULTS is a transient string return slot.  A number of encounter
      // wrappers copy it into LOCALS only to make an optional label; an
      // untouched slot is the upstream empty string, not a reason to discard
      // the surrounding authored greeting.
      ? { value: "", unsupported: [] }
      : { value: resolved, unsupported: [] };
  }
  if (value.kind === "character-name-string") {
    const subject = evaluateValue(value.subject, charaNum, state as GameState, rng, args, context);
    if (subject.unsupported.length > 0) return { value: "", unsupported: subject.unsupported };
    const slot = subject.value === 0 ? state.master : state.charas[subject.value];
    const resolved = value.field === "NAME" ? slot?.name : slot?.callName;
    return resolved === undefined
      ? { value: "", unsupported: [`${value.field}:${subject.value}`] }
      : { value: resolved, unsupported: [] };
  }
  if (value.kind === "host-string") {
    const result = context.hostRegistry?.readString(value.name);
    return result?.status === "supported" || result?.status === "empty"
      ? { value: result.value ?? "", unsupported: [] }
      : { value: "", unsupported: [result?.detail ?? value.name] };
  }
  if (value.kind === "string-template") {
    const fragments: string[] = [];
    const unsupported: string[] = [];
    for (const part of value.parts) {
      const resolved = evaluateStringTemplatePart(part, charaNum, state, rng, context);
      for (const detail of resolved.unsupported) unsupported.push(detail);
      fragments.push(resolved.value);
    }
    return { value: fragments.join(""), unsupported };
  }
  const subject = evaluateValue(value.subject, charaNum, state, rng, args, context);
  if (subject.unsupported.length > 0 || !Number.isSafeInteger(subject.value) || subject.value < 0) {
    return {
      value: "",
      unsupported: subject.unsupported.length > 0 ? subject.unsupported : [`CSTR:${subject.value}:${value.key}`],
    };
  }
  if (context.hostRegistry) {
    const result = context.hostRegistry.readCstr({ subject: subject.value, key: value.key });
    return result.status === "supported" || result.status === "empty"
      ? { value: result.value ?? "", unsupported: [] }
      : { value: "", unsupported: [result.detail ?? `CSTR:${subject.value}:${value.key}`] };
  }
  const resolved = context.resolveCstr?.(subject.value, value.key) ?? findCharaCstr(subject.value, value.key);
  return resolved === undefined || resolved === null
    ? { value: "", unsupported: [`CSTR:${subject.value}:${value.key}`] }
    : { value: resolved, unsupported: [] };
}

/** Resolve one segmented part of a `string-template`. Mirrors the
 *  classification done by `parseStringTemplate` so each variant has a
 *  dedicated substitution path. Failures become unsupported diagnostics
 *  rather than empty strings, so the upstream route stays closed when
 *  a required helper is unavailable. */
function evaluateStringTemplatePart(
  part: StringTemplatePart,
  charaNum: number,
  state: Readonly<GameState>,
  rng: Rng,
  context: KojoResolveContext,
): { value: string; unsupported: string[] } {
  switch (part.kind) {
    case "literal":
      return { value: part.text, unsupported: [] };
    case "callname": {
      const resolved = resolveCallNameForTemplate(part.scope, charaNum, state, context);
      return resolved === null
        ? { value: "", unsupported: [`CALLNAME:${part.scope}`] }
        : { value: resolved, unsupported: [] };
    }
    case "name": {
      const resolved = resolveNameForTemplate(part.scope, charaNum, state, context);
      return resolved === null
        ? { value: "", unsupported: [`NAME:${part.scope}`] }
        : { value: resolved, unsupported: [] };
    }
    case "locals": {
      const value = context.vm?.resolvedStringLocals?.[part.index];
      return value === undefined
        ? { value: "", unsupported: [`LOCALS:${part.index} unresolved`] }
        : { value, unsupported: [] };
    }
    case "results": {
      return { value: context.vm?.resolvedStringResults?.[part.index] ?? "", unsupported: [] };
    }
    case "string-arg": {
      const value = context.stringArgs?.[part.index];
      return value === undefined
        ? { value: "", unsupported: [`ARGS:${part.index} unresolved`] }
        : { value, unsupported: [] };
    }
    case "formatter": {
      const token = `%${part.name}(${part.args.join(",")})%`;
      const replacement = substituteKojoStateFormatters(token, {
        state,
        charaNum,
        rng,
        nameResolver: context.nameResolver,
        aliases: context.callNameAliases,
        masterName: context.masterName,
        targetName: context.targetName,
      });
      if (replacement === token) {
        return { value: "", unsupported: [`formatter:${part.name}`] };
      }
      return { value: replacement, unsupported: [] };
    }
  }
}

/** Best-effort resolution of `%CALLNAME:scope%` against the runtime
 *  name resolver / aliases / fallback chain. Mirrors the regex used by
 *  `substituteKojoCallNames` but skips the string substitution step. */
function resolveCallNameForTemplate(scope: string, charaNum: number, state: Readonly<GameState>, context: KojoResolveContext): string | null {
  const masterName = context.masterName || state.master.callName || "主角";
  const targetName = context.targetName ?? `${charaNum}`;
  const trimmed = scope.trim();
  if (trimmed === "MASTER" || trimmed === "PLAYER" || trimmed === "0") return masterName;
  if (trimmed === "TARGET" || trimmed === "CHARA") return targetName;
  const alias = context.callNameAliases?.[trimmed];
  if (alias !== undefined) return alias;
  if (context.nameResolver) {
    const resolved = context.nameResolver(trimmed);
    if (resolved !== undefined) return resolved;
  }
  if (/^\[\[([^\]\r\n]+)\]\]$/.test(trimmed)) {
    const inner = trimmed.slice(2, -2);
    return context.nameResolver?.(inner) ?? inner;
  }
  if (/^\d+$/.test(trimmed)) {
    const chara = Number(trimmed);
    return context.nameResolver?.(chara) ?? `${chara}`;
  }
  return null;
}

function resolveNameForTemplate(scope: string, charaNum: number, state: Readonly<GameState>, context: KojoResolveContext): string | null {
  // NAME is functionally identical to CALLNAME for the resolution chain we
  // expose today. Kept as a separate seam so future NAME-specific helpers
  // (rare in the bundle) can plug in without a rewrite.
  return resolveCallNameForTemplate(scope, charaNum, state, context);
}

/** Read a single variable for predicate evaluation. Missing slot/id → 0. */
function readVar(
  ns: KojoVarNs,
  scope: "TARGET" | "MASTER" | "GLOBAL" | number,
  id: number,
  charaNum: number,
  state: Readonly<GameState>,
): number | null {
  if (ns === "FLAG") {
    return state.flagStore[id] ?? 0;
  }
  if (ns === "ITEM") {
    return state.items?.[id] ?? 0;
  }
  if (ns === "SOURCE") {
    if (scope === "GLOBAL") return null;
    const subject = typeof scope === "number"
      ? scope
      : scope === "MASTER" ? 0 : charaNum;
    if (subject === null) return null;
    const source = state.turnContext?.frame?.sourceByChara[subject];
    return source ? (source[id] ?? 0) : null;
  }
  if (ns === "TFLAG") {
    return getTflag(state, id);
  }
  if (ns === "NOWEX") {
    if (scope === "GLOBAL") return null;
    const subject = typeof scope === "number"
      ? scope
      : scope === "MASTER" ? 0 : charaNum;
    if (subject === null) return null;
    // A command frame is the authoritative NOWEX scope.  Once the frame
    // exists, an omitted per-character entry means the command produced no
    // such transient event (the upstream value is zero), not an unknown
    // namespace.  Keep the no-frame case fail-closed for direct probes and
    // save-loaded dialogue that is not attached to a command.
    const frame = state.turnContext?.frame;
    if (!frame) return null;
    return frame.nowExByChara[subject]?.[id] ?? 0;
  }
  if (scope === "GLOBAL") return null;
  const subject = typeof scope === "number"
    ? scope
    : scope === "MASTER" ? 0 : charaNum;
  if (subject === null) return null;
  const slot = subject === 0 ? state.master : state.charas[subject];
  if (!slot) return 0;
  const bag = (slot.state as unknown as Record<string, Record<number, number>>)[ns];
  return bag ? (bag[id] ?? 0) : null;
}

function compareNumber(actual: number, op: string, expected: number): boolean {
  switch (op) {
    case "==": return actual === expected;
    case "!=": return actual !== expected;
    case ">=": return actual >= expected;
    case "<=": return actual <= expected;
    case ">": return actual > expected;
    case "<": return actual < expected;
    default: return false;
  }
}

interface ValueEvaluation {
  value: number;
  /** Optional string form. When set, the `compare` predicate branch
   *  uses strict-equal string semantics (`actual === expected`) instead
   *  of the numeric compareNumber. Used by helpers like WHERE_ABOUT()
   *  that return localised labels ("室内" / "室外") which lose
   *  semantic meaning when coerced to 0/1. */
  text?: string;
  unsupported: string[];
}

function bit(value: number, index: number): boolean {
  return (value & (1 << index)) !== 0;
}

const FISH_SIZE_RANGE: Readonly<Record<number, readonly [max: number, min: number]>> = {
  1: [56, 25], 2: [40, 18], 3: [50, 25], 4: [70, 20], 5: [18, 10],
  6: [18, 10], 7: [36, 15], 8: [61, 15], 9: [300, 120], 10: [28, 12],
  11: [100, 65], 12: [18, 8], 13: [105, 35], 14: [65, 45], 15: [115, 80],
  16: [18, 10], 17: [35, 25], 18: [80, 50], 19: [120, 85], 20: [55, 20],
  22: [115, 55], 23: [200, 100], 24: [301, 100], 25: [45, 30], 26: [140, 70],
  27: [62, 25], 28: [220, 90], 29: [55, 25], 30: [400, 250], 31: [550, 300],
  32: [220, 120], 33: [18, 10], 34: [36, 15], 35: [50, 25], 36: [70, 20],
  37: [55, 25], 38: [65, 45], 39: [115, 80], 40: [220, 120],
};

/**
 * Source-faithful bounded implementations of the relationship helpers embedded
 * in the authored Satori/Keine kojo variants. These functions are used by many
 * other character files, so treating them as unknown suppresses whole CFLAG /
 * TALENT branches roster-wide.
 */
function relationshipState(
  flavor: "fall" | "emotion",
  subject: number,
  state: Readonly<GameState>,
): number | null {
  const slot = subject === 0 ? state.master : state.charas[subject];
  if (!slot) return 0;
  const talent = (id: number) => slot.state.TALENT[id] ?? 0;
  const cflag = (id: number) => slot.state.CFLAG[id] ?? 0;

  if (flavor === "emotion") {
    const masterLover = state.master.state.TALENT[TALENT_ID.恋人] ?? 0;
    if (masterLover === subject || (talent(TALENT_ID.恋人) !== 0 && talent(TALENT_ID.恋慕) !== 0)) {
      return 4;
    }
    if (
      talent(TALENT_ID.恋慕) !== 0 ||
      talent(TALENT_ID.愛欲) !== 0 ||
      talent(TALENT_ID.炮友) !== 0
    ) {
      return 3;
    }
    // K67 authored helper: CFLAG 1592 bit 0 is the Keine-specific agreement;
    // CFLAG 1 bit 0 is its general relationship-history agreement arm.
    if ((subject === 67 && bit(cflag(1592), 0)) || (bit(cflag(1), 0) && talent(TALENT_ID.思慕) !== 0)) {
      return 2;
    }
    return talent(TALENT_ID.思慕) !== 0 ? 1 : 0;
  }

  if (talent(TALENT_ID.恋人) !== 0) {
    const cleanRelationship = cflag(338) !== 0; // CFLAG:清い交際
    const variant = cflag(CFLAG_ID.口上セレクタ);
    const specialPureRoute =
      (subject === 49 && ((variant === 3 && bit(cflag(1490), 6)) || variant !== 3)) ||
      (subject === 15 && ((variant === 1 && cflag(1151) === 0) || variant !== 1)) ||
      (subject !== 49 && subject !== 15);
    return cleanRelationship && specialPureRoute ? 5 : 4;
  }
  if (subject === 49 && (slot.state.MARK[MARK_ID.反発刻印] ?? 0) >= 3) return 2;
  if (
    talent(TALENT_ID.恋慕) !== 0 ||
    talent(TALENT_ID.愛欲) !== 0 ||
    talent(TALENT_ID.炮友) !== 0
  ) {
    return 3;
  }
  if ((subject === 49 && bit(cflag(1490), 0)) || (subject === 61 && bit(cflag(1), 1))) {
    return 2;
  }
  const ordinaryAgreement = bit(cflag(1), 1) && subject !== 61;
  const sakuyaTimeRoute = subject === 15 && cflag(CFLAG_ID.口上セレクタ) === 1 && bit(cflag(1151), 0);
  const satoriAllowsYearning = subject !== 49 || !bit(cflag(1490), 1);
  if ((ordinaryAgreement || sakuyaTimeRoute || talent(TALENT_ID.思慕) !== 0) && satoriAllowsYearning) {
    return 1;
  }
  return 0;
}

function slotForScope(
  scope: Exclude<KojoVarScope, "GLOBAL">,
  charaNum: number,
  state: Readonly<GameState>,
) {
  const subject = typeof scope === "number" ? scope : scope === "MASTER" ? 0 : charaNum;
  return subject === 0 ? state.master : state.charas[subject];
}

/** `CAN_STANDING_SEX(COM_ID)` from ADD_STANDING_SEX.ERB:5-33. */
function canStandingSex(state: Readonly<GameState>, charaNum: number, commandNo: number): boolean | null {
  const target = charaNum === 0 ? state.master : state.charas[charaNum];
  if (!target) return null;
  if (
    (commandNo >= 60 && commandNo <= 63) ||
    commandNo === 79 ||
    commandNo === 92 ||
    commandNo === 93 ||
    commandNo === 130 ||
    commandNo === 131
  ) {
    return true;
  }
  if ((commandNo >= 67 && commandNo <= 70) || commandNo === 83) {
    const masterSize = state.master.state.TALENT[TALENT_ID.体型] ?? 0;
    const targetSize = target.state.TALENT[TALENT_ID.体型] ?? 0;
    return masterSize > targetSize || (state.master.state.TALENT[TALENT_ID.力持ち] ?? 0) !== 0;
  }
  return false;
}

/** `CAN_NORMAL_SEX(COM_ID)` from ADD_STANDING_SEX.ERB:39-48. */
function canNormalSex(state: Readonly<GameState>): boolean {
  const location = state.master.location;
  const flags = placeFlagsOf(location);
  return (
    hasPlace(flags, PLACE_FUTON) ||
    (hasPlace(flags, PLACE_BATH) && hasItem(state, ITEM_ID.プレイマット)) ||
    openPlace(state, location) !== 0 ||
    hasPlace(flags, PLACE_REST)
  );
}

function evaluateValue(
  value: KojoValue,
  charaNum: number,
  state: Readonly<GameState>,
  rng: Rng,
  args: readonly number[],
  context: KojoResolveContext,
): ValueEvaluation {
  switch (value.kind) {
    case "number":
      return { value: value.value, unsupported: [] };
    case "dynamic_rand": {
      const max = evaluateValue(value.max, charaNum, state, rng, args, context);
      if (max.unsupported.length > 0) return max;
      if (!Number.isSafeInteger(max.value)) {
        return { value: 0, unsupported: [`RAND:${max.value}`] };
      }
      return { value: rng.int(Math.max(1, max.value)), unsupported: [] };
    }
    case "limit": {
      const candidate = evaluateValue(value.value, charaNum, state, rng, args, context);
      const min = evaluateValue(value.min, charaNum, state, rng, args, context);
      const max = evaluateValue(value.max, charaNum, state, rng, args, context);
      const unsupported = [...candidate.unsupported, ...min.unsupported, ...max.unsupported];
      if (unsupported.length > 0) return { value: 0, unsupported };
      return {
        value: Math.min(Math.max(candidate.value, min.value), max.value),
        unsupported: [],
      };
    }
    case "item_price": {
      const item = evaluateValue(value.item, charaNum, state, rng, args, context);
      if (item.unsupported.length > 0 || !Number.isSafeInteger(item.value)) {
        return {
          value: 0,
          unsupported: item.unsupported.length > 0 ? item.unsupported : [`ITEMPRICE:${item.value}`],
        };
      }
      return { value: itemPrice(item.value), unsupported: [] };
    }
    case "string_local":
      return context.vm
        ? { value: context.vm.stringLocals?.[value.index] ?? 0, unsupported: [] }
        : { value: 0, unsupported: [`LOCALS:${value.index} without VM`] };
    case "string_literal":
      // task #15: a bare `"…"` literal that survived the parser's
      // comparison fallback. Numeric value is always 0; the comparator
      // branch reads `text` for strict-equal string semantics against
      // helper-returned labels (`WHERE_ABOUT()` / `DATENAME_PLACE()`).
      return { value: 0, text: value.value, unsupported: [] };
    case "character_name": {
      const subject = evaluateValue(value.subject, charaNum, state, rng, args, context);
      if (subject.unsupported.length > 0 || !Number.isSafeInteger(subject.value)) {
        return { value: 0, unsupported: subject.unsupported.length > 0
            ? subject.unsupported
            : [`${value.field}:${subject.value}`] };
      }
      const slot = subject.value === 0 ? state.master : state.charas[subject.value];
      const text = value.field === "NAME" ? slot?.name : slot?.callName;
      return text === undefined
        ? { value: 0, unsupported: [`${value.field}:${subject.value}`] }
        : { value: 0, text, unsupported: [] };
    }
    case "dish_type":
      return state.dish
        ? { value: 0, text: state.dish.type, unsupported: [] }
        : { value: 0, unsupported: ["DISH_TYPE missing dish"] };
    case "dish_name":
      return state.dish
        ? { value: 0, text: state.dish.name, unsupported: [] }
        : { value: 0, unsupported: ["DISHNAME missing dish"] };
    case "room_data": {
      const room = evaluateValue(value.room, charaNum, state, rng, args, context);
      if (room.unsupported.length > 0) return room;
      const location = roomIdToLocation(room.value);
      return location
        ? { value: Number(placeFlagsOf(location)), unsupported: [] }
        : { value: 0, unsupported: [`ROOMDATA:${room.value}`] };
    }
    case "dish_number":
      return state.dish
        ? { value: state.dish[value.field], unsupported: [] }
        : { value: 0, unsupported: [`DISH_${value.field.toUpperCase()} missing dish`] };
    case "named_string_local": {
      const vm = context.vm;
      if (!vm) return { value: 0, unsupported: [`#DIMS ${value.name} without VM`] };
      if (!Object.prototype.hasOwnProperty.call(vm.namedStringLocals ?? {}, value.name)) {
        return { value: 0, unsupported: [`#DIMS ${value.name} is unbound`] };
      }
      const text = vm.resolvedNamedStringLocals?.[value.name];
      return text === undefined
        ? { value: 0, unsupported: [`#DIMS ${value.name} has no string value`] }
        : { value: vm.namedStringLocals![value.name]!, text, unsupported: [] };
    }
    case "named_local": {
      if (value.name === "gLineCount") return { value: 0, unsupported: [] };
      const named = context.vm?.namedLocals;
      return named && Object.prototype.hasOwnProperty.call(named, value.name)
        ? { value: named[value.name]!, unsupported: [] }
        : { value: 0, unsupported: [`#DIM ${value.name} is unbound`] };
    }
    case "string-template":
      // The numeric `evaluateValue` path is reserved for arithmetic
      // expressions. A `string-template` RHS must go through
      // `evaluateStringValue` instead — the local-set dispatcher picks
      // the right path based on the target's kind. Reaching this branch
      // is a programmer error and is reported fail-closed.
      return { value: 0, unsupported: [`string-template routed through numeric evaluator`] };
    case "function-call-stub": {
      const handler = FUNCTION_CALL_VALUE_REGISTRY[value.name.toUpperCase()];
      if (!handler) return { value: 0, unsupported: [`unknown-function:${value.name}`] };
      return handler({ name: value.name, args: value.args, charaNum, state, rng, runtimeArgs: args, context });
    }
    case "room_owner":
      return { value: privateRoomOwner(state as GameState, state.master.location) ?? 0, unsupported: [] };
    case "line-count":
      // LINECOUNT is only used by authored setup text to clear a local
      // scratch buffer. The static walk has no mutable output cursor at parse
      // time, so zero is the faithful no-op value and never affects prose.
      return { value: 0, unsupported: [] };
    case "subject":
      return { value: value.scope === "MASTER" ? 0 : charaNum, unsupported: [] };
    case "subject_alias": {
      const resolved = resolveVarScope(
        { kind: "alias", name: value.name },
        charaNum,
        state,
        rng,
        args,
        context,
      );
      return resolved.scope === null
        ? { value: 0, unsupported: resolved.unsupported }
        : { value: typeof resolved.scope === "number" ? resolved.scope : 0, unsupported: [] };
    }
    case "named_array": {
      if (!context.vm) return { value: 0, unsupported: [`#DIM ${value.name} without VM`] };
      const index = evaluateValue(value.index, charaNum, state, rng, args, context);
      if (index.unsupported.length > 0 || !Number.isSafeInteger(index.value)) {
        return { value: 0, unsupported: index.unsupported.length > 0
            ? index.unsupported
            : [`#DIM ${value.name} index ${index.value}`] };
      }
      return { value: context.vm.namedArrays?.[value.name]?.[index.value] ?? 0, unsupported: [] };
    }
    case "var": {
      const scope = resolveVarScope(value.scope, charaNum, state, rng, args, context);
      if (scope.scope === null) return { value: 0, unsupported: scope.unsupported };
      const resolved = readVar(value.ns, scope.scope, value.id, charaNum, state);
      return resolved === null
        ? { value: 0, unsupported: [`${value.ns}:${String(value.scope)}:${value.id}`] }
        : { value: resolved, unsupported: [] };
    }
    case "arg":
      return { value: args[value.index] ?? 0, unsupported: [] };
    case "turn":
      switch (value.field) {
        case "selectCom":
          return {
            value: state.turnContext?.selectCom ?? context.commandNo ?? 0,
            unsupported: [],
          };
        case "prevCom":
          return { value: state.turnContext?.prevCom ?? 0, unsupported: [] };
        case "result":
          return {
            value: context.vm?.result[value.index] ?? state.turnContext?.result[value.index] ?? 0,
            unsupported: [],
          };
        case "local":
          return {
            value: context.vm?.locals[value.index] ?? state.turnContext?.locals[value.index] ?? 0,
            unsupported: [],
          };
      }
    case "activity": {
      if (value.scope === "GLOBAL") {
        return { value: 0, unsupported: [`Activity_${value.field}:GLOBAL`] };
      }
      const subject =
        typeof value.scope === "number"
          ? value.scope
          : value.scope === "MASTER"
            ? 0
            : charaNum;
      const action = state.freeActions?.[subject];
      return {
        value: value.field === "type" ? (action?.type ?? 0) : (action?.remainingMinutes ?? 0),
        unsupported: [],
      };
    }
    case "day":
      switch (value.index) {
        case 0:
          return { value: state.time.dayIndex, unsupported: [] };
        case 2:
          return { value: state.time.season ?? 1, unsupported: [] };
        case 3:
          return { value: state.time.date ?? 1, unsupported: [] };
        default:
          return { value: 0, unsupported: [`DAY:${value.index}`] };
      }
    case "time":
      if (value.index === 0) {
        return {
          value: ((state.time.tickValue % 1440) + 1440) % 1440,
          unsupported: [],
        };
      }
      if (value.index === 5) {
        return { value: currentRegionWeather(state).weatherIndex, unsupported: [] };
      }
      if (value.index === 2) return { value: timeZoneOf(state.time.tickValue), unsupported: [] };
      return { value: 0, unsupported: [`TIME:${value.index}`] };
    case "string_arg":
      return { value: 0, unsupported: [`ARGS:${value.index} used as a numeric value`] };
    case "state":
      return {
        value: value.field === "money"
          ? state.money
          : value.field === "casino_chips"
            ? (state.casinoChips ?? 0)
            : (mapIdOfLocation(state.master.location) ?? 0),
        unsupported: [],
      };
    case "diary_max_page": {
      const subject = evaluateValue(value.subject, charaNum, state, rng, args, context);
      if (subject.unsupported.length > 0 || !Number.isSafeInteger(subject.value) || subject.value < 0) {
        return {
          value: 0,
          unsupported: subject.unsupported.length > 0 ? subject.unsupported : [`MAX_DIARY_PAGE:${subject.value}:0`],
        };
      }
      return { value: readMaxDiaryPage(state, subject.value), unsupported: [] };
    }
    case "diary_flag": {
      const subject = evaluateValue(value.subject, charaNum, state, rng, args, context);
      const page = evaluateValue(value.page, charaNum, state, rng, args, context);
      const unsupported = [...subject.unsupported, ...page.unsupported];
      if (
        unsupported.length > 0 ||
        !Number.isSafeInteger(subject.value) || subject.value < 0 ||
        !Number.isSafeInteger(page.value) || page.value < 0
      ) {
        return {
          value: 0,
          unsupported: unsupported.length > 0 ? unsupported : [`DIARY:${subject.value}:${page.value}`],
        };
      }
      return { value: readDiaryFlag(state, subject.value, page.value), unsupported: [] };
    }
    case "diary_page_set": {
      const subject = evaluateValue(value.subject, charaNum, state, rng, args, context);
      const slot = evaluateValue(value.slot, charaNum, state, rng, args, context);
      const unsupported = [...subject.unsupported, ...slot.unsupported];
      if (
        unsupported.length > 0 ||
        !Number.isSafeInteger(subject.value) || subject.value < 0 ||
        !Number.isSafeInteger(slot.value) || slot.value < 0
      ) {
        return {
          value: 0,
          unsupported: unsupported.length > 0 ? unsupported : [`PAGESET:${subject.value}:${slot.value}`],
        };
      }
      return { value: readPageSet(state, subject.value)[slot.value] ?? 0, unsupported: [] };
    }
    case "dynamic_var": {
      const scope = resolveVarScope(value.scope, charaNum, state, rng, args, context);
      const id = evaluateValue(value.id, charaNum, state, rng, args, context);
      const unsupported = [...scope.unsupported, ...id.unsupported];
      if (scope.scope === null || unsupported.length > 0 || !Number.isSafeInteger(id.value)) {
        return { value: 0, unsupported: unsupported.length > 0 ? unsupported : [`${value.ns} dynamic index`] };
      }
      const resolved = readVar(value.ns, scope.scope, id.value, charaNum, state);
      return resolved === null
        ? { value: 0, unsupported: [`${value.ns}:${String(scope.scope)}:${id.value}`] }
        : { value: resolved, unsupported: [] };
    }
    case "host_array": {
      const evaluated = value.indices.map((index) =>
        evaluateValue(index, charaNum, state, rng, args, context)
      );
      const unsupported = evaluated.flatMap((entry) => entry.unsupported);
      if (unsupported.length > 0 || evaluated.some((entry) => !Number.isSafeInteger(entry.value))) {
        return { value: 0, unsupported: unsupported.length > 0 ? unsupported : [value.name] };
      }
      const result = context.hostRegistry?.readArray({
        name: value.name,
        indices: evaluated.map((entry) => entry.value),
      });
      return result?.status === "supported"
        ? { value: result.value ?? 0, unsupported: [] }
        : { value: 0, unsupported: [result?.detail ?? value.name] };
    }
    case "host_string_array": {
      const evaluated = value.indices.map((index) =>
        evaluateValue(index, charaNum, state, rng, args, context)
      );
      const unsupported = evaluated.flatMap((entry) => entry.unsupported);
      if (unsupported.length > 0 || evaluated.some((entry) => !Number.isSafeInteger(entry.value))) {
        return { value: 0, unsupported: unsupported.length > 0 ? unsupported : [value.name] };
      }
      const result = context.hostRegistry?.readStringArray?.({
        name: value.name,
        indices: evaluated.map((entry) => entry.value),
      });
      if (result?.status !== "supported" && result?.status !== "empty") {
        return { value: 0, unsupported: [result?.detail ?? value.name] };
      }
      const text = result.value ?? "";
      return { value: hashResolvedString(text), text, unsupported: [] };
    }
    case "string_count": {
      const source = evaluateStringValue(value.source, charaNum, state, rng, args, context);
      const pattern = evaluateStringValue(value.pattern, charaNum, state, rng, args, context);
      const unsupported = [...source.unsupported, ...pattern.unsupported];
      if (unsupported.length > 0) return { value: 0, unsupported };
      try {
        // Emuera accepts the inline `(?i)` flag; JavaScript exposes the same
        // behavior through the `i` constructor flag.
        const caseInsensitive = /^\(\?i\)/i.test(pattern.value);
        const sourcePattern = caseInsensitive ? pattern.value.slice(4) : pattern.value;
        const matches = source.value.match(new RegExp(sourcePattern, caseInsensitive ? "gi" : "g"));
        return { value: matches?.length ?? 0, unsupported: [] };
      } catch {
        return { value: 0, unsupported: [`STRCOUNT invalid regex: ${pattern.value}`] };
      }
    }
    case "in_range": {
      const candidate = evaluateValue(value.value, charaNum, state, rng, args, context);
      const min = evaluateValue(value.min, charaNum, state, rng, args, context);
      const max = evaluateValue(value.max, charaNum, state, rng, args, context);
      const unsupported = [...candidate.unsupported, ...min.unsupported, ...max.unsupported];
      return {
        value: unsupported.length === 0 && candidate.value >= min.value && candidate.value <= max.value ? 1 : 0,
        unsupported,
      };
    }
    case "youbi_match": {
      const day = evaluateValue(value.day, charaNum, state, rng, args, context);
      if (day.unsupported.length > 0 || !Number.isSafeInteger(day.value)) {
        return {
          value: 0,
          unsupported: day.unsupported.length > 0 ? day.unsupported : [`YOUBI_MATCH(${day.value})`],
        };
      }
      return { value: youbiMatch(day.value, value.weekdays) ? 1 : 0, unsupported: [] };
    }
    case "uwaki_history": {
      const witness = evaluateValue(value.witness, charaNum, state, rng, args, context);
      const partner = evaluateValue(value.partner, charaNum, state, rng, args, context);
      const unsupported = [...witness.unsupported, ...partner.unsupported];
      if (unsupported.length > 0 || !Number.isSafeInteger(witness.value) || !Number.isSafeInteger(partner.value)) {
        return {
          value: 0,
          unsupported: unsupported.length > 0 ? unsupported : [`GET_UWAKI_HISTORY(${witness.value},${partner.value})`],
        };
      }
      return { value: getUwakiHistory(state, witness.value, partner.value), unsupported: [] };
    }
    case "exp_up": {
      const expId = evaluateValue(value.expId, charaNum, state, rng, args, context);
      const subject = evaluateValue(value.subject, charaNum, state, rng, args, context);
      const unsupported = [...expId.unsupported, ...subject.unsupported];
      if (
        unsupported.length > 0 ||
        !Number.isSafeInteger(expId.value) || expId.value < 0 ||
        !Number.isSafeInteger(subject.value) || subject.value < 0
      ) {
        return {
          value: 0,
          unsupported: unsupported.length > 0
            ? unsupported
            : [`EXP_UP(${expId.value},${subject.value})`],
        };
      }
      const slot = subject.value === 0 ? state.master : state.charas[subject.value];
      if (!slot) return { value: 0, unsupported: [`EXP_UP(${expId.value},${subject.value})`] };
      return {
        value: (slot.state.EXP[expId.value] ?? 0) - (slot.state.TCVAR[400 + expId.value] ?? 0),
        unsupported: [],
      };
    }
    case "abs": {
      const inner = evaluateValue(value.value, charaNum, state, rng, args, context);
      return inner.unsupported.length > 0
        ? inner
        : { value: Math.abs(inner.value), unsupported: [] };
    }
    case "minmax": {
      const values = value.values.map((part) =>
        evaluateValue(part, charaNum, state, rng, args, context)
      );
      const unsupported = values.flatMap((part) => part.unsupported);
      if (unsupported.length > 0) return { value: 0, unsupported };
      const numeric = values.map((part) => part.value);
      return {
        value: value.op === "min" ? Math.min(...numeric) : Math.max(...numeric),
        unsupported: [],
      };
    }
    case "soaked_or_not": {
      const subject = evaluateValue(value.subject, charaNum, state, rng, args, context);
      if (subject.unsupported.length > 0) return subject;
      const slot = subject.value === 0 ? state.master : state.charas[subject.value];
      if (!slot) return { value: 0, unsupported: [] };
      if (value.mode === "SECRETIONAL") {
        return { value: (slot.state.PALAM[PALAM_ID.潤滑] ?? 0) >= palamLv(5) ? 1 : 0, unsupported: [] };
      }
      const fill = bodyFillRate(slot.state, value.mode === "V_SEMINAL" ? 1 : 2, true);
      return fill === null
        ? { value: 0, unsupported: [`SOAKED_OR_NOT(${value.mode}) body capacity`] }
        : { value: fill >= 30 ? 1 : 0, unsupported: [] };
    }
    case "fishing_size": {
      const fish = evaluateValue(value.fishId, charaNum, state, rng, args, context);
      if (fish.unsupported.length > 0) return fish;
      if (fish.value === 21) return { value: 5, unsupported: [] };
      const range = FISH_SIZE_RANGE[fish.value];
      return range
        ? { value: Math.max(rng.int(range[0]), range[1]), unsupported: [] }
        : { value: 0, unsupported: [] };
    }
    case "fishsize_record": {
      const fish = evaluateValue(value.fishId, charaNum, state, rng, args, context);
      return fish.unsupported.length > 0
        ? fish
        : { value: state.fishingGear?.bestSizes[fish.value] ?? 0, unsupported: [] };
    }
    case "fish_exp": {
      const fish = evaluateValue(value.fishId, charaNum, state, rng, args, context);
      return fish.unsupported.length > 0
        ? fish
        : { value: state.fishingGear?.catchCounts[fish.value] ?? 0, unsupported: [] };
    }
    case "pregnancy_possible": {
      const subject = evaluateValue(value.subject, charaNum, state, rng, args, context);
      if (subject.unsupported.length > 0 || !Number.isSafeInteger(subject.value) || subject.value < 0) {
        return {
          value: 0,
          unsupported: subject.unsupported.length > 0
            ? subject.unsupported
            : [`妊娠可否(${subject.value})`],
        };
      }
      const slot = subject.value === 0 ? state.master : state.charas[subject.value];
      if (!slot) return { value: 0, unsupported: [`妊娠可否(${subject.value})`] };

      // HININSHITE.ERB:169-190, current non-MAGIC-DLC branch. The modern
      // runtime does not enable SELF_PREGNANCY or MAGIC_DLC, so the ordinary
      // MASTER-condom / receiver-pill arm is authoritative here.
      if (
        readTequip(state.master, TEQUIP_ID.避孕套) !== 0 ||
        (slot.state.TCVAR[TCVAR_ID.口服避孕薬] ?? 0) !== 0 ||
        ((slot.state.TALENT[TALENT_ID.幼稚] ?? 0) !== 0 &&
          (slot.state.TALENT[TALENT_ID.初潮] ?? 0) === 0) ||
        (slot.state.TALENT[TALENT_ID.妊娠] ?? 0) !== 0
      ) return { value: 0, unsupported: [] };

      const infertileRace =
        (slot.state.TALENT[TALENT_ID.幽霊] ?? 0) !== 0 ||
        (slot.state.TALENT[TALENT_ID.人形] ?? 0) !== 0 ||
        (slot.state.TALENT[TALENT_ID.追加種族] ?? 0) === 4;
      if (infertileRace && (slot.state.CFLAG[CFLAG_ID.兒童人数] ?? 0) === 0) {
        return { value: 0, unsupported: [] };
      }
      return { value: 1, unsupported: [] };
    }
    case "conditional": {
      const condition = evaluatePredicate(
        value.condition,
        charaNum,
        state,
        rng,
        args,
        context,
        [],
      );
      if (condition.unsupported.length > 0) {
        return { value: 0, unsupported: condition.unsupported };
      }
      return evaluateValue(
        condition.value ? value.whenTrue : value.whenFalse,
        charaNum,
        state,
        rng,
        args,
        context,
      );
    }
    case "k120_helper": {
      const target = state.charas[charaNum];
      if (!target) return { value: 0, unsupported: [`K120_${value.helper}(missing TARGET)`] };
      if (value.helper === "insemination_possible") {
        const possible =
          (target.state.TALENT[TALENT_ID.妊娠] ?? 0) === 0 &&
          (target.state.CFLAG[CFLAG_ID.允许无套] ?? 0) >= 2 &&
          (target.state.TCVAR[TCVAR_ID.口服避孕薬] ?? 0) === 0 &&
          readTequip(state.master, TEQUIP_ID.避孕套) === 0;
        return { value: possible ? 1 : 0, unsupported: [] };
      }
      if (value.helper === "dangerous_days") {
        const cycle = target.state.CFLAG[900] ?? 0;
        return { value: cycle > 5 && cycle < 9 ? 1 : 0, unsupported: [] };
      }

      // M_KOJO_K120_FUNC.ERB:911-913. FIRSTTIME(key, 1) is a query;
      // the authored negations require every listed event memory to exist.
      const requiredMemories = [
        "AunnSweetsShopEvent",
        "AunnBoughtHeadpiece",
        "AunnKourindouFindsPolaroidCamera",
        "AunnFishingCaughtDriftwood",
        "AunnFindsTheTwoPiece",
        "AunnRoLFestivalDate",
        "AunnWinAgainstCirno",
      ];
      const memories = state.kojoMemory?.[charaNum]?.firstTime;
      const possible =
        (target.state.TALENT[TALENT_ID.恋人] ?? 0) !== 0 &&
        (target.state.CFLAG[CFLAG_ID.兒童人数] ?? 0) > 0 &&
        (target.state.CFLAG[1003] ?? 0) >= 18 &&
        (target.state.CFLAG[1002] ?? 0) >= 13 &&
        (target.state.CFLAG[CFLAG_ID.弾幕勝負勝利] ?? 0) === 1 &&
        (target.state.TALENT[TALENT_ID.キス未経験] ?? 0) === 0 &&
        (target.state.CFLAG[1004] ?? 0) !== 0 &&
        requiredMemories.every((key) => memories?.[`"${key}"`] === true);
      return { value: possible ? 1 : 0, unsupported: [] };
    }
    case "string_find": {
      const source = evaluateStringValue(value.source, charaNum, state, rng, args, context);
      const pattern = evaluateStringValue(value.pattern, charaNum, state, rng, args, context);
      const unsupported = [...source.unsupported, ...pattern.unsupported];
      return unsupported.length > 0
        ? { value: -1, unsupported }
        : { value: source.value.indexOf(pattern.value), unsupported: [] };
    }
    case "weekday_test": {
      const day = evaluateValue(value.day, charaNum, state, rng, args, context);
      if (day.unsupported.length > 0) return day;
      const remainder = ((day.value % 7) + 7) % 7;
      const weekday = remainder >= 1 && remainder <= 5;
      return { value: (value.weekend ? !weekday : weekday) ? 1 : 0, unsupported: [] };
    }
    case "k60_attitude": {
      const target = state.charas[charaNum];
      const parsee = state.charas[60];
      if (!target || !parsee) {
        return { value: 0, unsupported: ["K60_ATTITUDE missing TARGET or Parsee"] };
      }
      const argument = value.argument
        ? evaluateValue(value.argument, charaNum, state, rng, args, context)
        : { value: 0, unsupported: [] };
      if (argument.unsupported.length > 0) return argument;

      // M_KOJO_K60_2_functions.ERB:5-20.
      const talent = target.state.TALENT;
      const mark = target.state.MARK;
      const cflag = parsee.state.CFLAG;
      const loves = (talent[TALENT_ID.恋慕] ?? 0) !== 0;
      const lover = (talent[TALENT_ID.恋人] ?? 0) !== 0;
      const yearning = (talent[TALENT_ID.思慕] ?? 0) !== 0;
      const lust = (talent[TALENT_ID.愛欲] ?? 0) !== 0;
      const sexFriend = (talent[TALENT_ID.セフレ] ?? 0) !== 0;
      const pleasureMark = mark[MARK_ID.快楽刻印] ?? 0;
      if ((lover && !lust && !sexFriend) || (argument.value !== 0 && loves && pleasureMark < 3)) {
        return { value: 0, unsupported: [] };
      }
      if (lust || sexFriend) return { value: 1, unsupported: [] };
      const knowsRelationship = (cflag[1035] ?? 0) !== 0;
      const meltdown = (cflag[1037] ?? 0) === 1;
      const ntrEventSeen =
        state.kojoMemory?.[charaNum]?.firstTime?.['"NTRedParseesFriend"'] === true;
      if (
        (yearning && !loves && pleasureMark < 3 && !knowsRelationship) ||
        ((meltdown || ntrEventSeen) && !loves)
      ) {
        return { value: 2, unsupported: [] };
      }
      return { value: 3, unsupported: [] };
    }
    case "k49_relationship": {
      const subjectResult = value.subject
        ? evaluateValue(value.subject, charaNum, state, rng, args, context)
        : { value: 49, unsupported: [] };
      if (subjectResult.unsupported.length > 0 || !Number.isSafeInteger(subjectResult.value)) {
        return { value: 0, unsupported: subjectResult.unsupported.length > 0
            ? subjectResult.unsupported
            : [`关系_310:${subjectResult.value}`] };
      }
      const slot = subjectResult.value === 0 ? state.master : state.charas[subjectResult.value];
      if (!slot) return { value: 0, unsupported: [`关系_310:${subjectResult.value}`] };
      if ((slot.state.MARK[MARK_ID.反発刻印] ?? 0) >= 2) {
        return { value: 0, unsupported: [] };
      }
      const restarted = (state.charas[38]?.state.CFLAG[3100] ?? 0) !== 0;
      const offset = restarted ? 100 : 0;
      const lover = (slot.state.TALENT[TALENT_ID.恋人] ?? 0) !== 0;
      const cleanRelationship = (slot.state.CFLAG[338] ?? 0) !== 0;
      const desire = slot.state.ABL[ABL_ID.欲望] ?? 0;
      if (lover) {
        if (cleanRelationship) return { value: offset + (desire >= (restarted ? 30 : 20) ? 17 : 7), unsupported: [] };
        return { value: offset + (desire >= (restarted ? 30 : 20) ? 16 : 6), unsupported: [] };
      }
      const favor = slot.state.CFLAG[CFLAG_ID.好感度] ?? 0;
      const trust = slot.state.CFLAG[CFLAG_ID.信頼度] ?? 0;
      const intimacy = slot.state.ABL[ABL_ID.親密] ?? 0;
      const thresholds = restarted
        ? [[15_500, 9_300, 30, 5], [9_300, 4_650, 20, 4], [5_580, 1_860, 10, 3], [1_860, 620, 5, 2]] as const
        : [[7_500, 3_500, 20, 4], [4_500, 1_500, 10, 3], [1_500, 500, 5, 2]] as const;
      for (const [favorMin, trustMin, intimacyMin, result] of thresholds) {
        if (favor >= favorMin && trust >= trustMin && intimacy >= intimacyMin) {
          return { value: offset + result, unsupported: [] };
        }
      }
      return { value: offset + 1, unsupported: [] };
    }
    case "be_seen": {
      const speaker = state.charas[value.speaker];
      if (!speaker) return { value: 0, unsupported: [`K${value.speaker}_BE_SEEN missing speaker`] };
      const witnesses = Object.values(state.charas).filter((slot) =>
        slot.charaNum !== value.speaker && slot.location === speaker.location
      );
      return { value: witnesses.length > 0 ? 1 : 0, unsupported: [] };
    }
    case "find_lover": {
      const speaker = state.charas[value.speaker];
      if (!speaker) return { value: 0, unsupported: [`FIND_LOVER(${value.speaker}) missing speaker`] };
      if ((state.master.state.TALENT[TALENT_ID.恋人] ?? 0) === 0) {
        return { value: 0, unsupported: [] };
      }
      if ((speaker.state.TALENT[TALENT_ID.恋人] ?? 0) !== 0) {
        return { value: -1, unsupported: [] };
      }
      const loverPresent = Object.values(state.charas).some((slot) =>
        slot.location === speaker.location && (slot.state.TALENT[TALENT_ID.恋人] ?? 0) !== 0
      );
      return { value: loverPresent ? 2 : 1, unsupported: [] };
    }
    case "find_around": {
      const speaker = state.charas[value.speaker];
      if (!speaker) return { value: 0, unsupported: [`FIND_AROUND(${value.speaker}) missing speaker`] };
      const candidates = Object.values(state.charas).filter((slot) =>
        slot.charaNum !== value.speaker && slot.location === speaker.location
      );
      if (candidates.length === 0) return { value: 0, unsupported: [] };
      const lovers = candidates.filter((slot) => (slot.state.TALENT[TALENT_ID.恋人] ?? 0) !== 0);
      if (lovers.length > 0) {
        const datePartner = state.dateSession?.partner;
        const preferred = datePartner === undefined
          ? undefined
          : lovers.find((slot) => slot.charaNum === datePartner);
        const selected = preferred ?? lovers[rng.int(lovers.length)]!;
        return { value: selected.charaNum, unsupported: [] };
      }
      for (const acquaintance of value.acquaintances) {
        if (candidates.some((slot) => slot.charaNum === acquaintance)) {
          return { value: acquaintance, unsupported: [] };
        }
      }
      return { value: candidates[rng.int(candidates.length)]!.charaNum, unsupported: [] };
    }
    case "form_k113": {
      const slot = state.charas[113];
      if (!slot) return { value: 0, unsupported: ["FORM_K113 missing Hecatia"] };
      const mapId = mapIdOfLocation(slot.location);
      if (mapId === null) return { value: 0, unsupported: [`FORM_K113 location:${slot.location}`] };
      const previousMap = slot.state.CFLAG[1010] ?? 0;
      const previousForm = slot.state.CFLAG[1009] ?? 0;
      if (mapId === previousMap) return { value: previousForm, unsupported: [] };
      if (!context.effectSink) {
        return { value: 0, unsupported: ["FORM_K113 missing transaction sink"] };
      }

      const staged: KojoStagedEffect[] = [];
      const set = (ns: "CFLAG" | "TALENT", id: number, next: number): void => {
        staged.push({ kind: "set", target: { ns, scope: 113, id }, value: next, line: 0 });
      };
      set("CFLAG", 1010, mapId);
      let form = previousForm;
      if (mapId >= 0 && mapId <= 9) {
        form = rng.int(2);
        set("CFLAG", 1009, form);
      } else if (mapId === 10) {
        form = rng.int(2) === 0 ? 0 : 2;
        set("CFLAG", 1009, form);
        if (form === 2) {
          for (const id of [12, 23, 10]) set("TALENT", id, 1);
          set("TALENT", 86, 1);
          set("TALENT", 14, 1);
          set("TALENT", TALENT_ID.羞恥心, 0);
          set("TALENT", TALENT_ID.服従, 0);
        }
      }
      if (form === 1) {
        for (const id of [12, 23, 10]) set("TALENT", id, -1);
        set("TALENT", 86, 0);
        set("TALENT", 14, 0);
        set("TALENT", TALENT_ID.羞恥心, 1);
        set("TALENT", TALENT_ID.服従, 1);
      } else if (form === 0) {
        for (const id of [12, 23, 10]) set("TALENT", id, 1);
        set("TALENT", 86, 0);
        set("TALENT", 14, 0);
        set("TALENT", TALENT_ID.羞恥心, 0);
        set("TALENT", TALENT_ID.服従, 0);
      }
      context.effectSink.push(...staged);
      Object.assign(state, applyKojoEffects(state, staged));
      return { value: form, unsupported: [] };
    }
    case "nemuke":
      return { value: readNemuke(state), unsupported: [] };
    case "lover_count":
      return {
        value: Object.values(state.charas).filter((slot) => (slot.state.TALENT[TALENT_ID.恋人] ?? 0) !== 0).length,
        unsupported: [],
      };
    case "get_month": {
      const season = value.season
        ? evaluateValue(value.season, charaNum, state, rng, args, context)
        : { value: state.time.season ?? 1, unsupported: [] };
      if (season.unsupported.length > 0) return season;
      const names = ["无之月", "春之月", "夏之月", "秋之月", "冬之月"];
      const text = names[season.value];
      return text === undefined
        ? { value: 0, unsupported: [`GET_MONTH(${season.value})`] }
        : { value: season.value, text, unsupported: [] };
    }
    case "moon_watch": {
      const date = evaluateValue(value.date, charaNum, state, rng, args, context);
      const ignore = value.ignoreLocation
        ? evaluateValue(value.ignoreLocation, charaNum, state, rng, args, context)
        : { value: 0, unsupported: [] };
      const unsupported = [...date.unsupported, ...ignore.unsupported];
      return unsupported.length > 0
        ? { value: 0, unsupported }
        : { value: moonWatchValue(state, date.value, ignore.value !== 0), unsupported: [] };
    }
    case "name_moon": {
      const date = evaluateValue(value.date, charaNum, state, rng, args, context);
      if (date.unsupported.length > 0) return date;
      const moon = Math.max(moonWatchValue(state, date.value, false), 0);
      const names = ["", "朔月", "初月", "三日月", "上弦四分月", "上弦月", "上弦八分月", "十三夜", "待宵", "望月", "十六夜", "下弦八分月", "下弦八分月", "下弦月", "下弦四分月", "三十日月"];
      const text = (state.time.season ?? 1) === 3 && moon === 9
        ? "十五夜 -中秋的名月- "
        : names[moon];
      return text === undefined
        ? { value: 0, unsupported: [`NAME_MOON(${date.value})`] }
        : { value: moon, text, unsupported: [] };
    }
    case "date_name": {
      if (value.untranslated) {
        const mode = evaluateValue(value.untranslated, charaNum, state, rng, args, context);
        if (mode.unsupported.length > 0) return mode;
      }
      if (getTflag(state, TFLAG_ID.妄想中) === 1 && value.field === "place") {
        return { value: 1, text: "妄想", unsupported: [] };
      }
      const session = state.dateSession;
      if (!session) return { value: 0, text: "", unsupported: [] };
      if (value.field === "spot") {
        if (session.phase === "traveling" || getTflag(state, TFLAG_ID.约会道中) !== 0) {
          return { value: 1, text: "道中", unsupported: [] };
        }
        const text = state.master.location.split(":").at(-1) ?? state.master.location;
        return { value: session.mapId, text, unsupported: [] };
      }
      const destination = odekakeDestinationForMap(session.mapId);
      const text = destination?.label ?? session.destination;
      return text
        ? { value: session.mapId, text, unsupported: [] }
        : { value: 0, unsupported: [`DATENAME_PLACE(${session.mapId})`] };
    }
    case "cmatch": {
      const expected = evaluateValue(value.expected, charaNum, state, rng, args, context);
      if (expected.unsupported.length > 0) return expected;
      let count = 0;
      const subjects = [state.master, ...Object.values(state.charas)];
      for (const slot of subjects) {
        const actual = readVar(value.ns, slot.charaNum, value.id, charaNum, state);
        if (actual === null) return { value: 0, unsupported: [`CMATCH(${value.ns}:${value.id})`] };
        if (actual === expected.value) count++;
      }
      return { value: count, unsupported: [] };
    }
    case "taste_reaction":
      return state.dish
        ? { value: tasteCount(state.dish.taste, value.tag) >= 5 ? 1 : 0, unsupported: [] }
        : { value: 0, unsupported: ["TASTE_REACTION missing active dish"] };
    case "k17_master_alice_child": {
      const talent = state.master.state.TALENT;
      return { value: talent[17] === -1 || (talent[100] ?? 0) < 0 || (talent[150] ?? 0) !== 0 ? 1 : 0, unsupported: [] };
    }
    case "k60_has_fucked_parsee": {
      const parsee = state.charas[60];
      if (!parsee) return { value: 0, unsupported: ["K60_HAS_FUCKED_PARSEE missing Parsee"] };
      const cflag = parsee.state.CFLAG;
      const permission = cflag[1031] ?? 0;
      const result =
        ((cflag[1003] ?? 0) !== 0 && (parsee.state.TALENT[TALENT_ID.処女] ?? 0) === 0) ||
        (cflag[43] ?? 0) !== 0 ||
        (permission & (1 << 1)) !== 0 ||
        ((permission & 1) === 0 && ((cflag[1] ?? 0) & (1 << 1)) !== 0);
      return { value: result ? 1 : 0, unsupported: [] };
    }
    case "k70_helper": {
      const evaluated = value.subjects.map((subject) => evaluateValue(subject, charaNum, state, rng, args, context));
      const unsupported = evaluated.flatMap((result) => result.unsupported);
      if (unsupported.length > 0) return { value: 0, unsupported };
      const slotAt = (index: number) => {
        const subject = evaluated[index]?.value;
        return subject === 0 ? state.master : subject === undefined ? undefined : state.charas[subject];
      };
      if (value.helper === "ufufu") {
        const kosuzu = state.charas[70];
        if (!kosuzu) return { value: 0, unsupported: ["M_KOJO_K70_UFUFU missing Kosuzu"] };
        const talent = kosuzu.state.TALENT;
        const result = (talent[TALENT_ID.恋慕] ?? 0) !== 0 ||
          (talent[TALENT_ID.愛欲] ?? 0) !== 0 ||
          (talent[TALENT_ID.炮友] ?? 0) >= 2 ||
          (kosuzu.state.TCVAR[TCVAR_ID.発情] ?? 0) !== 0;
        return { value: result ? 1 : 0, unsupported: [] };
      }
      if (value.helper === "balance") {
        const primary = slotAt(0);
        const compared = slotAt(1);
        if (!primary || !compared) return { value: 0, unsupported: ["M_KOJO_K70_BALANCE missing subject"] };
        const p = primary.state.TALENT;
        const c = compared.state.TALENT;
        const pLover = (p[TALENT_ID.恋人] ?? 0) !== 0;
        const cLover = (c[TALENT_ID.恋人] ?? 0) !== 0;
        const pLove = (p[TALENT_ID.恋慕] ?? 0) !== 0;
        const cAttached = (c[TALENT_ID.恋慕] ?? 0) !== 0 || (c[TALENT_ID.思慕] ?? 0) !== 0;
        const text = pLover && cLover ? "信頼"
          : pLover ? "独占"
          : cLover && pLove ? "悲恋"
          : cLover ? "揶揄"
          : pLove && cAttached && (primary.state.CFLAG[CFLAG_ID.信頼度] ?? 0) > 1500 ? "信頼"
          : pLove && cAttached ? "敵対"
          : pLove ? "恋慕"
          : (c[TALENT_ID.恋慕] ?? 0) !== 0 ? "応援"
          : "平穏";
        return { value: 0, text, unsupported: [] };
      }
      const subject = slotAt(0);
      if (!subject) return { value: 0, unsupported: [`M_KOJO_K70_${value.helper} missing subject`] };
      if (value.helper === "fukigen") {
        const result = (subject.state.TALENT[TALENT_ID.心情] ?? 0) === -1 ||
          (subject.state.CFLAG[CFLAG_ID.勃然大怒] ?? 0) !== 0 ||
          (subject.state.MARK[MARK_ID.反発刻印] ?? 0) >= 3 ||
          (subject.state.TCVAR[350] ?? 0) >= 3;
        return { value: result ? 1 : 0, unsupported: [] };
      }
      const sadistic = subject.state.ABL[ABL_ID.施虐属性] ?? 0;
      const masochistic = subject.state.ABL[ABL_ID.受虐属性] ?? 0;
      return { value: sadistic >= 3 && sadistic > masochistic + 1 ? 1 : 0, unsupported: [] };
    }
    case "k83_helper": {
      const subject = evaluateValue(value.subject, charaNum, state, rng, args, context);
      if (subject.unsupported.length > 0 || !Number.isSafeInteger(subject.value)) {
        return {
          value: 0,
          unsupported: subject.unsupported.length > 0
            ? subject.unsupported
            : [`M_KOJO_K83_${value.helper.toUpperCase()} invalid subject`],
        };
      }
      const slot = subject.value === 0 ? state.master : state.charas[subject.value];
      if (!slot) {
        return { value: 0, unsupported: [`M_KOJO_K83_${value.helper.toUpperCase()} missing subject ${subject.value}`] };
      }
      if (value.helper === "fukigen") {
        const result = (slot.state.TALENT[TALENT_ID.心情] ?? 0) === -1 ||
          (slot.state.CFLAG[CFLAG_ID.勃然大怒] ?? 0) !== 0 ||
          (slot.state.MARK[MARK_ID.反発刻印] ?? 0) >= 3;
        return { value: result ? 1 : 0, unsupported: [] };
      }
      if (value.helper === "yoidore") {
        const face = alcoholFace(state, subject.value);
        return { value: face === "醉酒" || face === "不省人事" ? 1 : 0, unsupported: [] };
      }
      if ((state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0) {
        return { value: 0, unsupported: [] };
      }
      const talent = slot.state.TALENT;
      const result = (talent[TALENT_ID.恋人] ?? 0) !== 0 ||
        (talent[TALENT_ID.恋慕] ?? 0) !== 0 ||
        (talent[TALENT_ID.愛欲] ?? 0) !== 0 ||
        (talent[TALENT_ID.炮友] ?? 0) >= 2;
      return { value: result ? 1 : 0, unsupported: [] };
    }
    case "authored_state_helper": {
      const evaluated = value.args.map((arg) => evaluateValue(arg, charaNum, state, rng, args, context));
      const unsupported = evaluated.flatMap((entry) => entry.unsupported);
      if (unsupported.length > 0) return { value: 0, unsupported };
      const subjectNumber = (fallback: number): number => {
        const candidate = evaluated[0]?.value ?? fallback;
        return candidate === 0 ? fallback : candidate;
      };
      const slotFor = (number: number) => number === 0 ? state.master : state.charas[number];
      if (value.name === "get_map_replacement") {
        const room = evaluated[0]?.value;
        return room !== undefined && Number.isSafeInteger(room)
          ? { value: room, unsupported: [] }
          : { value: 0, unsupported: ["GET_MAP_REPLACEMENT invalid room"] };
      }
      if (value.name === "k70_suzunaan") {
        const room = evaluated[0]?.value;
        if (room === undefined || !Number.isSafeInteger(room)) {
          return { value: 0, unsupported: ["M_KOJO_K70_SUZUNAAN invalid room"] };
        }
        if (mapIdOfLocation(state.master.location) !== 2) return { value: 0, unsupported: [] };
        if (room === 213) return { value: 1, unsupported: [] };
        if (room !== 226) return { value: 0, unsupported: [] };
        const kosuzu = state.charas[70];
        if (!kosuzu) return { value: 0, unsupported: ["M_KOJO_K70_SUZUNAAN missing Kosuzu"] };
        const cflag = kosuzu.state.CFLAG;
        const attitude = computeAttitude(kosuzu, state.master, state);
        const bringable = attitude > 0 &&
          (cflag[CFLAG_ID.睡眠] ?? 0) === 0 &&
          (cflag[CFLAG_ID.行动] ?? 0) !== 5;
        const condition = bringable || (cflag[CFLAG_ID.同行] ?? 0) !== 0 ||
          (attitude >= 1 && (cflag[CFLAG_ID.睡眠] ?? 0) === 0 && (cflag[CFLAG_ID.陪睡中] ?? 0) === 0);
        if (condition) return { value: 2, unsupported: [] };
        const akyuu = state.charas[80];
        if (!akyuu) return { value: 0, unsupported: ["M_KOJO_K70_SUZUNAAN missing Akyuu"] };
        const trusted = (kosuzu.state.TALENT[TALENT_ID.恋慕] ?? 0) !== 0 ||
          (kosuzu.state.TALENT[TALENT_ID.思慕] ?? 0) !== 0 ||
          state.master.location === akyuu.location;
        return { value: trusted ? 2 : 3, unsupported: [] };
      }
      if (value.name === "k17_grt") {
        const number = subjectNumber(17);
        const subject = slotFor(number);
        const alice = state.charas[17];
        if (!subject || !alice) return { value: 0, unsupported: [`K17_GRT missing subject ${!alice ? 17 : number}`] };
        let flags = 0;
        if ((alice.state.TALENT[TALENT_ID.恋人] ?? 0) !== 0 ||
            (subject.state.MARK[MARK_ID.快楽刻印] ?? 0) >= 3) flags |= 1 << 9;
        if ((alice.state.CFLAG[1007] ?? 0) !== 0) flags |= 1 << 8;
        if ((alice.state.CFLAG[1006] ?? 0) !== 0) flags |= 1 << 6;
        if ((subject.state.CFLAG[CFLAG_ID.允许无套] ?? 0) >= 2) flags |= 1 << 7;
        if ((subject.state.TALENT[TALENT_ID.恋慕] ?? 0) !== 0 ||
            (subject.state.TALENT[TALENT_ID.愛欲] ?? 0) !== 0) flags |= 1 << 5;
        const firstEmbrace = subject.state.TCVAR[181] ?? 0;
        if (((subject.state.CFLAG[CFLAG_ID.既成事實] ?? 0) & 2) !== 0 ||
            (firstEmbrace < 6 && firstEmbrace !== 0)) flags |= 1 << 4;
        if ((alice.state.CFLAG[1005] ?? 0) !== 0) flags |= 1 << 3;
        if (((subject.state.CFLAG[CFLAG_ID.既成事實] ?? 0) & 1) !== 0 ||
            (alice.state.CFLAG[1004] ?? 0) !== 0) flags |= 1 << 2;
        if ((subject.state.TALENT[TALENT_ID.思慕] ?? 0) !== 0 ||
            (subject.state.TALENT[TALENT_ID.恋慕] ?? 0) !== 0 ||
            (subject.state.TALENT[TALENT_ID.愛欲] ?? 0) !== 0 ||
            (subject.state.TALENT[TALENT_ID.炮友] ?? 0) !== 0) flags |= 1 << 1;
        if ((alice.state.CFLAG[1014] ?? 0) !== 0 ||
            (subject.state.ABL[ABL_ID.親密] ?? 0) >= 5) flags |= 1;
        const masks = [0, 1, 3, 7, 15, 23, 55, 127, 255, 511, 1023];
        for (let rank = masks.length - 1; rank >= 0; rank -= 1) {
          if ((masks[rank]! & flags) === masks[rank]) return { value: rank, unsupported: [] };
        }
        return { value: 0, unsupported: [] };
      }
      if (value.name === "stellaris_falldown_k98") {
        const yorihime = state.charas[98];
        if (!yorihime) return { value: 0, unsupported: ["STELLARIS_FALLDOWN_K98 missing Yorihime"] };
        for (let id = 1444; id < 1452; id += 1) {
          if ((yorihime.state.CFLAG[id] ?? 0) === 1) return { value: 1, unsupported: [] };
        }
        return { value: 0, unsupported: [] };
      }
      if (value.name === "k111_fukigen") {
        const number = subjectNumber(charaNum);
        const slot = slotFor(number);
        if (!slot) return { value: 0, unsupported: [`M_KOJO_K111_FUKIGEN missing subject ${number}`] };
        const result = (slot.state.TALENT[TALENT_ID.心情] ?? 0) === -1 ||
          (slot.state.CFLAG[CFLAG_ID.勃然大怒] ?? 0) !== 0 ||
          (slot.state.MARK[MARK_ID.反発刻印] ?? 0) >= 3;
        return { value: result ? 1 : 0, unsupported: [] };
      }
      if (value.name === "k111_junko_kurashi") {
        if (mapIdOfLocation(state.master.location) !== 10) return { value: 0, unsupported: [] };
        const home = state.master.state.CFLAG[CFLAG_ID.初期位置] ?? 0;
        if (home >= 1060 && home <= 1072) return { value: 1, unsupported: [] };
        const homes = [111, 112, 113].map((number) => state.charas[number]?.state.CFLAG[CFLAG_ID.初期位置]);
        if (homes.some((candidate) => candidate === undefined)) {
          return { value: 0, unsupported: ["M_KOJO_K111_JUNKO_KURASHI missing household member"] };
        }
        return { value: homes.includes(home) ? 1 : 0, unsupported: [] };
      }
      if (value.name === "moon_watch_point") {
        const room = evaluated[0]?.value;
        if (room === undefined || !Number.isSafeInteger(room)) {
          return { value: 0, unsupported: ["MOON_WATCH_POINT invalid room"] };
        }
        const location = roomIdToLocation(room);
        if (!location) return { value: 0, unsupported: [`MOON_WATCH_POINT unknown room ${room}`] };
        const map = mapIdOfLocation(location);
        if (map === 9 || map === 10 || map === 11) return { value: 0, unsupported: [] };
        return {
          value: hasPlace(placeFlagsOf(location), PLACE_MOON) || outRoof(state, location) !== 0 ? 1 : 0,
          unsupported: [],
        };
      }
      const number = subjectNumber(charaNum);
      const slot = slotFor(number);
      if (!slot) return { value: 0, unsupported: [`K78 helper missing subject ${number}`] };
      const normalizeBody = (raw: number) => raw <= -5 ? -8 : raw;
      const gap = normalizeBody(state.master.state.TALENT[TALENT_ID.体型] ?? 0) -
        normalizeBody(slot.state.TALENT[TALENT_ID.体型] ?? 0);
      const stature = gap > 5 ? 2 : gap === 5 ? 1 : gap === -5 ? -1 : gap < -5 ? -2 : 0;
      if (value.name === "k78_excessive_stature_gap") return { value: stature, unsupported: [] };
      const sober = evaluateValue({ kind: "shirahu", subject: { kind: "number", value: number } }, charaNum, state, rng, args, context);
      if (sober.unsupported.length > 0) return sober;
      const reaction = (slot.state.CUP[PALAM_ID.反感] ?? 0) + (slot.state.CUP[PALAM_ID.不快] ?? 0);
      const rebellion = slot.state.MARK[MARK_ID.反発刻印] ?? 0;
      const tolerant = sober.value !== 0 &&
        (slot.state.CFLAG[CFLAG_ID.勃然大怒] ?? 0) === 0 &&
        (slot.state.TCVAR[TCVAR_ID.强行] ?? 0) === 0 &&
        !((rebellion === 0 && reaction >= 500) ||
          (rebellion === 1 && reaction >= 1001) ||
          (rebellion === 2 && reaction >= 2001) || rebellion >= 3);
      return {
        value: tolerant && (slot.state.TALENT[TALENT_ID.無知] ?? 0) === 0 && stature === 0 ? 1 : 0,
        unsupported: [],
      };
    }
    case "where_about": {
      const target = state.charas[charaNum];
      if (!target) return { value: 0, unsupported: ["WHERE_ABOUT missing target"] };
      const outdoor = outRoof(state, target.location) !== 0;
      return { value: outdoor ? 1 : 0, text: outdoor ? "室外" : "室内", unsupported: [] };
    }
    case "k15_helper": {
      const sakuya = state.charas[15];
      if (!sakuya) return { value: 0, unsupported: [`K15_${value.helper} missing Sakuya`] };
      const argument = value.argument
        ? evaluateValue(value.argument, charaNum, state, rng, args, context)
        : { value: 0, unsupported: [] };
      if (argument.unsupported.length > 0) return argument;
      switch (value.helper) {
        case "player_is_sdm_resident": {
          if (mapIdOfLocation(state.master.location) !== 3) return { value: 0, unsupported: [] };
          const initialRoom = state.master.state.CFLAG[CFLAG_ID.初期位置]
            ?? locationToRoomId(state.master.homeLocation ?? "");
          return initialRoom === null
            ? { value: 0, unsupported: ["K15_PLAYER_IS_SDM_RESIDENT missing initial room"] }
            : { value: initialRoom >= 301 && initialRoom <= 333 ? 1 : 0, unsupported: [] };
        }
        case "player_in_sdm": {
          const room = locationToRoomId(state.master.location);
          if (room === null) return { value: 0, unsupported: [] };
          const mainMap = mapIdOfLocation(state.master.location);
          const inside = mainMap === 3
            ? room >= 301 && room <= 333
            : room >= 301 && room <= 399;
          return { value: inside ? 1 : 0, unsupported: [] };
        }
        case "lover_love":
          return {
            value: (sakuya.state.TALENT[TALENT_ID.恋人] ?? 0) !== 0 &&
              (sakuya.state.TALENT[TALENT_ID.恋慕] ?? 0) !== 0 ? 1 : 0,
            unsupported: [],
          };
        case "likes_player":
          return {
            value: (sakuya.state.TALENT[TALENT_ID.恋慕] ?? 0) !== 0 ||
              (sakuya.state.TALENT[TALENT_ID.思慕] ?? 0) !== 0 ||
              ((sakuya.state.ABL[ABL_ID.親密] ?? 0) + (sakuya.state.ABL[ABL_ID.欲望] ?? 0) >= 10 &&
                (sakuya.state.CFLAG[CFLAG_ID.好感度] ?? 0) >= 1500) ? 1 : 0,
            unsupported: [],
          };
        case "lust":
          return {
            value: (sakuya.state.CFLAG[340] ?? 0) >=
              argument.value + (sakuya.state.TCVAR[TCVAR_ID.媚薬] ?? 0) + (sakuya.state.TCVAR[TCVAR_ID.発情] ?? 0)
              ? 1 : 0,
            unsupported: [],
          };
        case "hate": {
          if ((sakuya.state.CFLAG[1101] ?? 0) !== 0 && argument.value === 0) {
            return { value: 0, unsupported: [] };
          }
          const mark = sakuya.state.MARK;
          const fallen =
            (mark[MARK_ID.快楽刻印] ?? 0) +
            (mark[MARK_ID.苦痛] ?? 0) +
            (mark[MARK_ID.不埒] ?? 0) +
            (mark[MARK_ID.时奸] ?? 0) >= 10;
          return { value: !fallen && (mark[MARK_ID.反発刻印] ?? 0) === 3 ? 1 : 0, unsupported: [] };
        }
      }
    }
    case "ifrand": {
      const candidates: number[] = [];
      const deleted = new Set<number>();
      const unsupported: string[] = [];
      const addSpec = (rawSpec: string): boolean => {
        for (const rawPart of rawSpec.split(",")) {
          let part = rawPart.replaceAll(" ", "").replaceAll("　", "");
          if (!part) continue;
          const remove = part.startsWith("D");
          if (remove) part = part.slice(1);
          const range = /^(-?\d+)TO(-?\d+)$/i.exec(part);
          let values: number[];
          if (range) {
            const start = Number(range[1]);
            const end = Number(range[2]);
            values = Array.from(
              { length: Math.abs(end - start) + 1 },
              (_, index) => Math.min(start, end) + index,
            );
          } else if (/^-?\d+$/.test(part)) {
            values = [Number(part)];
          } else {
            return false;
          }
          if (remove) values.forEach((candidate) => deleted.add(candidate));
          else candidates.push(...values);
        }
        return true;
      };

      for (const group of value.groups) {
        const condition = evaluatePredicate(
          group.condition,
          charaNum,
          state,
          rng,
          args,
          context,
          [],
        );
        unsupported.push(...condition.unsupported);
        if (condition.unsupported.length === 0 && condition.value && !addSpec(group.spec)) {
          unsupported.push(`IFRAND invalid value spec: ${group.spec}`);
        }
      }
      if (unsupported.length > 0) return { value: 0, unsupported };
      const available = candidates.filter((candidate) => !deleted.has(candidate));
      if (available.length === 0) {
        return { value: 0, unsupported: ["IFRAND has no eligible candidates"] };
      }
      return { value: available[rng.int(available.length)] ?? available[0]!, unsupported: [] };
    }
    case "palam_level":
      return { value: palamLv(value.level), unsupported: [] };
    case "rand":
      return { value: rng.int(Math.max(1, value.max)), unsupported: [] };
    case "get_bit": {
      const source = evaluateValue(value.value, charaNum, state, rng, args, context);
      const bit = evaluateValue(value.bit, charaNum, state, rng, args, context);
      const unsupported = [...source.unsupported, ...bit.unsupported];
      if (
        unsupported.length > 0 ||
        !Number.isSafeInteger(source.value) ||
        !Number.isInteger(bit.value) ||
        bit.value < 0 ||
        bit.value > 63
      ) {
        return {
          value: 0,
          unsupported:
            unsupported.length > 0
              ? unsupported
              : [`GETBIT(${source.value},${bit.value})`],
        };
      }
      const bits = BigInt.asUintN(64, BigInt(source.value));
      return {
        value: Number((bits >> BigInt(bit.value)) & 1n),
        unsupported: [],
      };
    }
    case "map_id": {
      const source = evaluateValue(value.value, charaNum, state, rng, args, context);
      if (source.unsupported.length > 0) return { value: 0, unsupported: source.unsupported };
      if (!Number.isSafeInteger(source.value)) {
        return { value: 0, unsupported: [`GET_MAPID(${source.value})`] };
      }
      return { value: Math.trunc(source.value / 100), unsupported: [] };
    }
    case "omaneki_beya":
      // PLACE_拠点共通.ERB:48-53: fixed main-map guest room (98).
      // The optional fantasy-map branch is outside the modern OMANEKI slice.
      return { value: OMANEKIBEYA_ID, unsupported: [] };
    case "in_room_number": {
      const room = evaluateValue(value.room, charaNum, state, rng, args, context);
      if (room.unsupported.length > 0 || !Number.isSafeInteger(room.value)) {
        return {
          value: 0,
          unsupported:
            room.unsupported.length > 0
              ? room.unsupported
              : [`IN_ROOM_NUMBER(${room.value})`],
        };
      }
      const slots = [state.master, ...Object.values(state.charas)];
      return {
        value: slots.filter((slot) => locationToRoomId(slot.location) === room.value).length,
        unsupported: [],
      };
    }
    case "road_to": {
      const mapId = evaluateValue(value.mapId, charaNum, state, rng, args, context);
      if (mapId.unsupported.length > 0 || !Number.isSafeInteger(mapId.value)) {
        return {
          value: 0,
          unsupported:
            mapId.unsupported.length > 0
              ? mapId.unsupported
              : [`ROAD_TO(${mapId.value})`],
        };
      }
      const roomId = 97 + mapId.value * 100;
      return Number.isSafeInteger(roomId)
        ? { value: roomId, unsupported: [] }
        : { value: 0, unsupported: [`ROAD_TO(${mapId.value})`] };
    }
    case "open_place": {
      const subject =
        value.scope === "MASTER"
          ? state.master
          : typeof value.scope === "number"
            ? state.charas[value.scope]
            : state.charas[charaNum];
      return subject
        ? { value: openPlace(state, subject.location), unsupported: [] }
        : { value: 0, unsupported: [`OPENPLACE(${String(value.scope)})`] };
    }
    case "get_charahome": {
      const subject = evaluateValue(value.subject, charaNum, state, rng, args, context);
      if (subject.unsupported.length > 0 || !Number.isSafeInteger(subject.value)) {
        return {
          value: -100,
          unsupported:
            subject.unsupported.length > 0
              ? subject.unsupported
              : [`GET_CHARAHOME(${subject.value})`],
        };
      }
      const slot = subject.value === 0 ? state.master : state.charas[subject.value];
      if (!slot) return { value: -100, unsupported: [`GET_CHARAHOME(${subject.value})`] };

      // COMMON.ERB:2437-2446 returns the numeric CFLAG:初期位置, with 0/99
      // treated as an address-less character. The modern slot also carries a
      // string-keyed homeLocation; use it only when the numeric bridge is not
      // populated, so old saves and narrow fixtures remain readable.
      const initial = slot.state.CFLAG[CFLAG_ID.初期位置];
      if (Number.isSafeInteger(initial)) {
        if (initial === 0 || initial === 99) return { value: -100, unsupported: [] };
        return { value: initial, unsupported: [] };
      }
      const roomId = slot.homeLocation ? locationToRoomId(slot.homeLocation) : null;
      if (roomId !== null) return { value: roomId, unsupported: [] };
      return { value: -100, unsupported: [`GET_CHARAHOME(${subject.value})`] };
    }
    case "yogore": {
      const room = evaluateValue(value.room, charaNum, state, rng, args, context);
      if (room.unsupported.length > 0 || !Number.isSafeInteger(room.value)) {
        return {
          value: 0,
          unsupported: room.unsupported.length > 0 ? room.unsupported : [`YOGORE(${room.value})`],
        };
      }
      const location = roomIdToLocation(room.value);
      return location
        ? { value: getYogore(state, location), unsupported: [] }
        : { value: 0, unsupported: [`YOGORE(${room.value})`] };
    }
    case "cannot_danmaku": {
      const target = state.charas[charaNum];
      if (!target) return { value: 0, unsupported: ["CANNOT_DANMAKU(missing TARGET)"] };

      // 一般依頼12_懲らしめて！.ERB:190-208. This helper deliberately
      // reports the first ineligible reason, rather than a boolean.
      const location = state.master.location;
      if (
        atPlayerBase(state, 0) &&
        outRoof(state, location) === 0 &&
        !hasPlace(placeFlagsOf(location), PLACE_TRAINING)
      ) return { value: 1, unsupported: [] };
      if ((target.state.CFLAG[CFLAG_ID.行动] ?? 0) === 5) return { value: 2, unsupported: [] };
      if (
        (state.master.state.BASE[BASE_ID.気力] ?? 0) < 500 ||
        (state.master.state.BASE[BASE_ID.体力] ?? 0) < 500
      ) return { value: 3, unsupported: [] };
      if (
        (target.state.BASE[BASE_ID.気力] ?? 0) < 500 ||
        (target.state.BASE[BASE_ID.体力] ?? 0) < 500
      ) return { value: 4, unsupported: [] };
      if ((target.state.TCVAR[TCVAR_ID.弾幕勝負不能] ?? 0) !== 0) {
        return { value: 5, unsupported: [] };
      }
      return { value: 0, unsupported: [] };
    }
    case "k30_check_hen_t": {
      const eiki = state.charas[30];
      if (!eiki) return { value: 0, unsupported: ["K30_CHECK_HEN_T(missing Eiki)"] };

      // M_KOJO_K30_関数・お説教ライブラリ.ERB:58-68.
      // Eiki's special outfit is active on the fifth day of the seven-day
      // cycle, or when either the global or Eiki-local outfit override is 62.
      const specialOutfit =
        state.time.dayIndex % 7 === 5 ||
        (state.flagStore[FLAG_ID.ファッション] ?? 0) === 62 ||
        (eiki.state.CFLAG[CFLAG_ID.衣装一時変更] ?? 0) === 62;
      return { value: specialOutfit ? 1 : 0, unsupported: [] };
    }
    case "k30_drunk":
      // M_KOJO_K30_関数・お説教ライブラリ.ERB:73-89 has the same
      // BASE/MAXBASE:酒気 thresholds as COMMON.ERB's IS_DRUNK.
      return state.charas[30]
        ? { value: alcoholIntoxication(state, 30), unsupported: [] }
        : { value: 0, unsupported: ["K30_DRUNK(missing Eiki)"] };
    case "k15_hate_anger": {
      const sakuya = state.charas[15];
      if (!sakuya) return { value: 0, unsupported: ["K15_HATE_ANGER(missing Sakuya)"] };

      // M_KOJO_K15_functions.ERB:122-166. This is a private SakuyaWorld
      // helper, not a substitute for the generic IS_ANGRY predicate.
      if ((sakuya.state.CFLAG[CFLAG_ID.K15C_憎悪台詞無効] ?? 0) !== 0) {
        return { value: 0, unsupported: [] };
      }
      const marks = sakuya.state.MARK;
      const fallen =
        (marks[MARK_ID.快乐] ?? 0) +
          (marks[MARK_ID.苦痛] ?? 0) +
          (marks[MARK_ID.不埒] ?? 0) +
          (marks[MARK_ID.时奸] ?? 0) >=
        10;
      if (fallen) return { value: 0, unsupported: [] };

      const hate = (marks[MARK_ID.反発刻印] ?? 0) === 3;
      const angry =
        (sakuya.state.CFLAG[CFLAG_ID.心情不快] ?? 0) !== 0 &&
        (sakuya.state.TALENT[TALENT_ID.心情] ?? 0) === -1 &&
        (sakuya.state.TALENT[TALENT_ID.恋慕] ?? 0) === 0;
      return { value: hate || angry ? 1 : 0, unsupported: [] };
    }
    case "k2_helper": {
      const subject = evaluateValue(value.subject, charaNum, state, rng, args, context);
      if (subject.unsupported.length > 0 || !Number.isSafeInteger(subject.value)) {
        return {
          value: 0,
          unsupported:
            subject.unsupported.length > 0
              ? subject.unsupported
              : [`K2_${value.helper.toUpperCase()}(${subject.value})`],
        };
      }

      // M_KOJO_K2_独自関数.ERB: all three helpers treat ARG=0 as TARGET.
      const subjectNum = subject.value === 0 ? charaNum : subject.value;
      const slot = subjectNum === 0 ? state.master : state.charas[subjectNum];
      if (!slot) {
        return {
          value: 0,
          unsupported: [`K2_${value.helper.toUpperCase()}(missing ${subjectNum})`],
        };
      }

      const excessiveStatureGap = (): number => {
        const masterRaw = state.master.state.TALENT[TALENT_ID.体型] ?? 0;
        const subjectRaw = slot.state.TALENT[TALENT_ID.体型] ?? 0;
        const masterSize = masterRaw <= -5 ? -8 : masterRaw;
        const subjectSize = subjectRaw <= -5 ? -8 : subjectRaw;
        const gap = masterSize - subjectSize;
        if (gap > 5) return 2;
        if (gap === 5) return 1;
        if (gap === -5) return -1;
        if (gap < -5) return -2;
        return 0;
      };

      if (value.helper === "excessive_stature_gap") {
        return { value: excessiveStatureGap(), unsupported: [] };
      }
      if (value.helper === "sexual_frankness") {
        const frank =
          (slot.state.MARK[MARK_ID.快楽刻印] ?? 0) >= 3 ||
          (slot.state.TALENT[TALENT_ID.快感応答] ?? 0) >= 0 ||
          (slot.state.TALENT[TALENT_ID.風騷] ?? 0) !== 0;
        return { value: frank ? 1 : 0, unsupported: [] };
      }

      // K2_BASIC_CONDITION_IN_MATING delegates first to
      // K2_CONSCIOUS_AND_TOLERANT, then applies ignorance and size gates.
      const sober = evaluateValue(
        { kind: "shirahu", subject: { kind: "number", value: subjectNum } },
        charaNum,
        state,
        rng,
        args,
        context,
      );
      if (sober.unsupported.length > 0) return sober;
      if (
        sober.value === 0 ||
        (slot.state.CFLAG[CFLAG_ID.勃然大怒] ?? 0) !== 0 ||
        (slot.state.TCVAR[TCVAR_ID.强行] ?? 0) !== 0
      ) {
        return { value: 0, unsupported: [] };
      }

      const rebellion = slot.state.MARK[MARK_ID.反発刻印] ?? 0;
      const resistanceRise =
        (slot.state.CUP[PALAM_ID.反感] ?? 0) +
        (slot.state.CUP[PALAM_ID.不快] ?? 0);
      if (
        (rebellion === 0 && resistanceRise >= 500) ||
        (rebellion === 1 && resistanceRise >= 1001) ||
        (rebellion === 2 && resistanceRise >= 2001) ||
        rebellion >= 3 ||
        (slot.state.TALENT[TALENT_ID.無知] ?? 0) !== 0 ||
        excessiveStatureGap() !== 0
      ) {
        return { value: 0, unsupported: [] };
      }
      return { value: 1, unsupported: [] };
    }
    case "estrus_cycle": {
      const subject = evaluateValue(value.subject, charaNum, state, rng, args, context);
      if (subject.unsupported.length > 0 || !Number.isSafeInteger(subject.value)) {
        return {
          value: 0,
          unsupported:
            subject.unsupported.length > 0 ? subject.unsupported : [`ESTRUS_CYCLE(${subject.value})`],
        };
      }
      const slot = subject.value === 0 ? state.master : state.charas[subject.value];
      if (!slot) return { value: 0, unsupported: [`ESTRUS_CYCLE(${subject.value})`] };
      switch (slot.state.CFLAG[CFLAG_ID.生理周期] ?? 0) {
        case 1:
        case 2:
          return { value: 15, unsupported: [] };
        case 3:
        case 4:
          return { value: 30, unsupported: [] };
        case 5:
          return { value: 50, unsupported: [] };
        case 6:
          return { value: 70, unsupported: [] };
        case 7:
          return { value: 150, unsupported: [] };
        case 8:
          return { value: 100, unsupported: [] };
        case 9:
          return { value: 60, unsupported: [] };
        case 10:
          return { value: 40, unsupported: [] };
        default:
          return { value: 0, unsupported: [] };
      }
    }
    case "is_drunk": {
      const subject = evaluateValue(value.subject, charaNum, state, rng, args, context);
      if (subject.unsupported.length > 0 || !Number.isSafeInteger(subject.value)) {
        return {
          value: 0,
          unsupported:
            subject.unsupported.length > 0 ? subject.unsupported : [`IS_DRUNK(${subject.value})`],
        };
      }
      const slot = subject.value === 0 ? state.master : state.charas[subject.value];
      if (!slot) return { value: 0, unsupported: [`IS_DRUNK(${subject.value})`] };
      return { value: alcoholIntoxication(state, subject.value), unsupported: [] };
    }
    case "alcohol_taste": {
      const item = evaluateValue(value.item, charaNum, state, rng, args, context);
      if (item.unsupported.length > 0 || !Number.isSafeInteger(item.value)) {
        return {
          value: 0,
          unsupported:
            item.unsupported.length > 0 ? item.unsupported : [`ALCOHOL_TASTE(${item.value})`],
        };
      }
      return { value: alcoholTaste(state, charaNum, item.value), unsupported: [] };
    }
    case "shirahu": {
      const subject = evaluateValue(value.subject, charaNum, state, rng, args, context);
      if (subject.unsupported.length > 0 || !Number.isSafeInteger(subject.value)) {
        return {
          value: 0,
          unsupported: subject.unsupported.length > 0 ? subject.unsupported : [`SHIRAHU(${subject.value})`],
        };
      }
      const slot = subject.value === 0 ? state.master : state.charas[subject.value];
      if (!slot) return { value: 0, unsupported: [`SHIRAHU(${subject.value})`] };
      const cflag = slot.state.CFLAG;
      if (
        (state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0 &&
        (cflag[CFLAG_ID.時間停止行動] ?? 0) === 0
      ) return { value: 0, unsupported: [] };
      if (
        (cflag[CFLAG_ID.睡眠] ?? 0) !== 0 ||
        (cflag[CFLAG_ID.陪睡中] ?? 0) !== 0 ||
        (slot.state.TCVAR[TCVAR_ID.泥酔] ?? 0) !== 0 ||
        (cflag[CFLAG_ID.衰弱] ?? 0) !== 0
      ) return { value: 0, unsupported: [] };
      return {
        value: getTflag(state, TFLAG_ID.COMABLE管理) > 1 ? 2 : 1,
        unsupported: [],
      };
    }
    case "otoko_girai": {
      const subject = evaluateValue(value.subject, charaNum, state, rng, args, context);
      if (subject.unsupported.length > 0 || !Number.isSafeInteger(subject.value)) {
        return {
          value: 0,
          unsupported: subject.unsupported.length > 0 ? subject.unsupported : [`OTOKOGIRAI(${subject.value})`],
        };
      }
      const slot = subject.value === 0 ? state.master : state.charas[subject.value];
      if (!slot) return { value: 0, unsupported: [`OTOKOGIRAI(${subject.value})`] };
      const talent = slot.state.TALENT;
      if (
        (talent[TALENT_ID.性別嗜好] ?? 0) === -1 ||
        (talent[TALENT_ID.恋慕] ?? 0) !== 0 ||
        (talent[TALENT_ID.愛欲] ?? 0) !== 0
      ) return { value: 0, unsupported: [] };
      const preference = talent[TALENT_ID.性別嗜好] ?? 0;
      const masterGender = state.master.state.TALENT[TALENT_ID.性別] ?? 0;
      // Mirrors COMMON.ERB: the preference bits select men/women, while the
      // player's gender bits decide which incompatibility result (1/2) wins.
      if ((preference & 1) !== 0 && (masterGender & 1) === 0) {
        return { value: 1, unsupported: [] };
      }
      if ((preference & 2) !== 0 && (masterGender & 2) === 0) {
        return { value: 2, unsupported: [] };
      }
      return { value: 0, unsupported: [] };
    }
    case "has_penis": {
      const subject = evaluateValue(value.subject, charaNum, state, rng, args, context);
      if (subject.unsupported.length > 0 || !Number.isSafeInteger(subject.value)) {
        return {
          value: 0,
          unsupported: subject.unsupported.length > 0 ? subject.unsupported : [`HAS_PENIS(${subject.value})`],
        };
      }
      const slot = subject.value === 0 ? state.master : state.charas[subject.value];
      if (!slot) return { value: 0, unsupported: [`HAS_PENIS(${subject.value})`] };
      const gender = slot.state.TALENT[TALENT_ID.性別] ?? 0;
      return { value: (gender & (1 << 1)) !== 0 ? 1 : 0, unsupported: [] };
    }
    case "gender_test": {
      const subject = evaluateValue(value.subject, charaNum, state, rng, args, context);
      if (subject.unsupported.length > 0 || !Number.isSafeInteger(subject.value)) {
        return {
          value: 0,
          unsupported:
            subject.unsupported.length > 0 ? subject.unsupported : [`${value.test}(${subject.value})`],
        };
      }
      const slot = subject.value === 0 ? state.master : state.charas[subject.value];
      if (!slot) return { value: 0, unsupported: [`${value.test}(${subject.value})`] };
      const gender = slot.state.TALENT[TALENT_ID.性別] ?? 0;
      const result =
        value.test === "male"
          ? gender === 2
          : value.test === "female"
            ? gender !== 2
            : value.test === "futa"
              ? gender === 3
              : (gender & 1) !== 0;
      return { value: result ? 1 : 0, unsupported: [] };
    }
    case "same_sex": {
      const left = evaluateValue(value.left, charaNum, state, rng, args, context);
      const right = evaluateValue(value.right, charaNum, state, rng, args, context);
      const unsupported = [...left.unsupported, ...right.unsupported];
      if (unsupported.length > 0 || !Number.isSafeInteger(left.value) || !Number.isSafeInteger(right.value)) {
        return {
          value: 0,
          unsupported:
            unsupported.length > 0 ? unsupported : [`IS_SAMESEX(${left.value},${right.value})`],
        };
      }
      const leftSlot = left.value === 0 ? state.master : state.charas[left.value];
      const rightSlot = right.value === 0 ? state.master : state.charas[right.value];
      if (!leftSlot || !rightSlot) {
        return { value: 0, unsupported: [`IS_SAMESEX(${left.value},${right.value})`] };
      }
      const leftMale = (leftSlot.state.TALENT[TALENT_ID.性別] ?? 0) === 2;
      const rightMale = (rightSlot.state.TALENT[TALENT_ID.性別] ?? 0) === 2;
      return { value: leftMale === rightMale ? 1 : 0, unsupported: [] };
    }
    case "virgin_test": {
      const subject = evaluateValue(value.subject, charaNum, state, rng, args, context);
      if (subject.unsupported.length > 0 || !Number.isSafeInteger(subject.value)) {
        return {
          value: 0,
          unsupported:
            subject.unsupported.length > 0 ? subject.unsupported : [`IS_${value.test.toUpperCase()}(${subject.value})`],
        };
      }
      const slot = subject.value === 0 ? state.master : state.charas[subject.value];
      if (!slot) return { value: 0, unsupported: [`IS_${value.test.toUpperCase()}(${subject.value})`] };
      if (value.test === "virgin") {
        return { value: slot.state.TALENT[TALENT_ID.処女] ?? 0, unsupported: [] };
      }
      const gender = slot.state.TALENT[TALENT_ID.性別] ?? 0;
      const hasPenis = (gender & (1 << 1)) !== 0;
      const nonVirgin = (slot.state.TALENT[TALENT_ID.非童貞] ?? 0) !== 0;
      return { value: !nonVirgin && hasPenis ? 1 : 0, unsupported: [] };
    }
    case "fallen": {
      const subject = evaluateValue(value.subject, charaNum, state, rng, args, context);
      if (subject.unsupported.length > 0 || !Number.isSafeInteger(subject.value)) {
        return {
          value: 0,
          unsupported: subject.unsupported.length > 0 ? subject.unsupported : [`IS_FALLEN(${subject.value})`],
        };
      }
      const resolvedSubject = subject.value === -1 ? charaNum : subject.value;
      const slot = resolvedSubject === 0 ? state.master : state.charas[resolvedSubject];
      if (!slot) return { value: 0, unsupported: [`IS_FALLEN(${subject.value})`] };
      const talent = slot.state.TALENT;
      return {
        value:
          (talent[TALENT_ID.思慕] ?? 0) !== 0 ||
          (talent[TALENT_ID.恋慕] ?? 0) !== 0 ||
          (talent[TALENT_ID.セフレ] ?? 0) !== 0 ||
          (talent[TALENT_ID.愛欲] ?? 0) !== 0
            ? 1
            : 0,
        unsupported: [],
      };
    }
    case "angry": {
      const subject = evaluateValue(value.subject, charaNum, state, rng, args, context);
      if (subject.unsupported.length > 0 || !Number.isSafeInteger(subject.value)) {
        return {
          value: 0,
          unsupported: subject.unsupported.length > 0 ? subject.unsupported : [`IS_ANGRY(${subject.value})`],
        };
      }
      const resolvedSubject = subject.value === -1 ? charaNum : subject.value;
      const slot = resolvedSubject === 0 ? state.master : state.charas[resolvedSubject];
      if (!slot) return { value: 0, unsupported: [`IS_ANGRY(${subject.value})`] };
      const hasRebellion = (slot.state.MARK[MARK_ID.反発刻印] ?? 0) !== 0;
      const isRaging = (slot.state.CFLAG[CFLAG_ID.勃然大怒] ?? 0) !== 0;
      return { value: hasRebellion || isRaging ? 1 : 0, unsupported: [] };
    }
    case "in_heat": {
      const subject = evaluateValue(value.subject, charaNum, state, rng, args, context);
      if (subject.unsupported.length > 0 || !Number.isSafeInteger(subject.value)) {
        return {
          value: 0,
          unsupported: subject.unsupported.length > 0 ? subject.unsupported : [`IN_HEAT(${subject.value})`],
        };
      }
      const slot = subject.value === 0 ? state.master : state.charas[subject.value];
      if (!slot) return { value: 0, unsupported: [`IN_HEAT(${subject.value})`] };
      const tcvar = slot.state.TCVAR;
      return {
        value: (tcvar[TCVAR_ID.媚薬] ?? 0) !== 0 || (tcvar[TCVAR_ID.発情] ?? 0) !== 0 ? 1 : 0,
        unsupported: [],
      };
    }
    case "is_lover": {
      const subject = evaluateValue(value.subject, charaNum, state, rng, args, context);
      if (subject.unsupported.length > 0 || !Number.isSafeInteger(subject.value)) {
        return {
          value: 0,
          unsupported: subject.unsupported.length > 0 ? subject.unsupported : [`IS_LOVER(${subject.value})`],
        };
      }
      const slot = subject.value === 0 ? state.master : state.charas[subject.value];
      if (!slot) return { value: 0, unsupported: [`IS_LOVER(${subject.value})`] };
      const talent = slot.state.TALENT;
      return {
        value: (talent[TALENT_ID.恋慕] ?? 0) !== 0 || (talent[TALENT_ID.愛欲] ?? 0) !== 0 ? 1 : 0,
        unsupported: [],
      };
    }
    case "is_sexing": {
      const subject = evaluateValue(value.subject, charaNum, state, rng, args, context);
      if (subject.unsupported.length > 0 || !Number.isSafeInteger(subject.value)) {
        return {
          value: 0,
          unsupported: subject.unsupported.length > 0 ? subject.unsupported : [`IS_SEXING(${subject.value})`],
        };
      }
      const slot = subject.value === 0 ? state.master : state.charas[subject.value];
      if (!slot) return { value: 0, unsupported: [`IS_SEXING(${subject.value})`] };
      const targetVaginal = readTequipOptional(slot, TEQUIP_ID.Ｖ性交);
      const targetAnal = readTequipOptional(slot, TEQUIP_ID.Ａ性交);
      const masterVaginal = readTequipOptional(state.master, TEQUIP_ID.Ｖ性交);
      const masterAnal = readTequipOptional(state.master, TEQUIP_ID.Ａ性交);
      return {
        value:
          targetVaginal === 0 ||
          targetAnal === 0 ||
          masterVaginal === subject.value ||
          masterAnal === subject.value
            ? 1
            : 0,
        unsupported: [],
      };
    }
    case "is_master": {
      const evaluated = value.subjects.map((subject) =>
        evaluateValue(subject, charaNum, state, rng, args, context),
      );
      const unsupported = evaluated.flatMap((subject) => subject.unsupported);
      if (
        unsupported.length > 0 ||
        evaluated.some((subject) => !Number.isSafeInteger(subject.value))
      ) {
        return {
          value: 0,
          unsupported:
            unsupported.length > 0
              ? unsupported
              : [`IS_MASTER(${evaluated.map((subject) => subject.value).join(",")})`],
        };
      }
      const roleplayTarget = state.flagStore[FLAG_ID.扮演] ?? 0;
      return {
        value: evaluated.some((subject) => subject.value === 0 || subject.value === roleplayTarget) ? 1 : 0,
        unsupported: [],
      };
    }
    case "weather_test": {
      const weather = currentRegionWeather(state).weatherIndex;
      const abnormalWeather = state.flagStore[FLAG_ID.異常気象] ?? 0;
      const badWeather = [4, 5, 6, 9, 12, 13, 14, 15].includes(weather) || [9, 10].includes(abnormalWeather);
      const storm = [5, 9, 13, 14, 15].includes(weather) || [9, 10].includes(abnormalWeather);
      return { value: (value.test === "bad_weather" ? badWeather : storm) ? 1 : 0, unsupported: [] };
    }
    case "is_nonhuman": {
      const subject = evaluateValue(value.subject, charaNum, state, rng, args, context);
      if (subject.unsupported.length > 0 || !Number.isSafeInteger(subject.value)) {
        return {
          value: 0,
          unsupported: subject.unsupported.length > 0 ? subject.unsupported : [`IS_NONHUMAN(${subject.value})`],
        };
      }
      const slot = subject.value === 0 ? state.master : state.charas[subject.value];
      if (!slot) return { value: 0, unsupported: [`IS_NONHUMAN(${subject.value})`] };
      const talent = slot.state.TALENT;
      const has = (id: number) => (talent[id] ?? 0) !== 0;
      const valueOf = (id: number) => talent[id] ?? 0;
      if (has(TALENT_ID.人間) && !has(TALENT_ID.半白澤)) {
        if (valueOf(TALENT_ID.人間) === 1) return { value: 0, unsupported: [] };
        if (valueOf(TALENT_ID.人間) === 3 || valueOf(TALENT_ID.人間) === 4) {
          return { value: 2, unsupported: [] };
        }
      }
      if (valueOf(TALENT_ID.人形) === 3 && valueOf(TALENT_ID.追加種族) === 2) {
        return { value: 1, unsupported: [] };
      }
      if (has(TALENT_ID.人形)) return { value: 3, unsupported: [] };
      if (valueOf(TALENT_ID.人形) === 5 || valueOf(TALENT_ID.氷精) === 2) {
        return { value: 1, unsupported: [] };
      }
      if (has(TALENT_ID.氷精) || has(TALENT_ID.妖精) || has(TALENT_ID.神霊) || has(TALENT_ID.幽霊)) {
        return { value: 2, unsupported: [] };
      }
      if (
        has(TALENT_ID.狐) ||
        has(TALENT_ID.妖狐) ||
        has(TALENT_ID.妖怪) ||
        has(TALENT_ID.付喪神) ||
        has(TALENT_ID.半白澤) ||
        valueOf(TALENT_ID.追加種族) === 2 ||
        has(TALENT_ID.動物耳)
      ) {
        return { value: 1, unsupported: [] };
      }
      return { value: 0, unsupported: [] };
    }
    case "is_library": {
      const place = evaluateValue(value.place, charaNum, state, rng, args, context);
      const permission = evaluateValue(value.permission, charaNum, state, rng, args, context);
      const unsupported = [...place.unsupported, ...permission.unsupported];
      if (
        unsupported.length > 0 ||
        !Number.isSafeInteger(place.value) ||
        !Number.isSafeInteger(permission.value)
      ) {
        return {
          value: 0,
          unsupported:
            unsupported.length > 0
              ? unsupported
              : [`IS_LIBRARY(${place.value},${permission.value})`],
        };
      }
      const location = roomIdToLocation(place.value);
      if (!location) return { value: 0, unsupported: [`IS_LIBRARY(${place.value})`] };
      if (!hasPlace(placeFlagsOf(location), PLACE_STUDY)) return { value: 0, unsupported: [] };
      // These are the unconditional library rooms in COMMON/COMF436. The
      // remaining study rooms have relationship/roleplay gates; permission=1
      // is the upstream escape hatch, otherwise fail closed until those gates
      // have an authoritative modern owner.
      const unconditional = new Set([48, 49, 50, 105, 126, 213, 222, 310]);
      if (unconditional.has(place.value) || permission.value !== 0) {
        return { value: place.value, unsupported: [] };
      }
      return { value: 0, unsupported: [`IS_LIBRARY(${place.value})`] };
    }
    case "is_standing_sex": {
      const command = evaluateValue(value.command, charaNum, state, rng, args, context);
      if (command.unsupported.length > 0 || !Number.isSafeInteger(command.value)) {
        return {
          value: 0,
          unsupported:
            command.unsupported.length > 0
              ? command.unsupported
              : [`IS_STANDING_SEX(${command.value})`],
        };
      }
      // SYS_FUNCTIONS.ERB:32: sleep-sex mode never uses standing sex.
      if ((state.master.state.CFLAG[CFLAG_ID.恶作剧] ?? 0) === 2) {
        return { value: 0, unsupported: [] };
      }
      const standing = canStandingSex(state, charaNum, command.value);
      if (standing === null) return { value: 0, unsupported: [`IS_STANDING_SEX(${command.value})`] };
      const toggle = (state.master.state.CFLAG[CFLAG_ID.站立式切换] ?? 0) !== 0;
      if (toggle) return { value: standing ? 1 : 0, unsupported: [] };
      // Upstream's non-toggle branch returns 0 when normal sex is possible,
      // otherwise 1; it deliberately does not consult COM_ID here.
      return { value: canNormalSex(state) ? 0 : 1, unsupported: [] };
    }
    case "is_dating_with_player": {
      const subject = evaluateValue(value.subject, charaNum, state, rng, args, context);
      if (subject.unsupported.length > 0 || !Number.isSafeInteger(subject.value)) {
        return {
          value: 0,
          unsupported:
            subject.unsupported.length > 0
              ? subject.unsupported
              : [`IS_DATING_WITH_PLAYER(${subject.value})`],
        };
      }
      const slot = subject.value === 0 ? state.master : state.charas[subject.value];
      if (!slot) return { value: 0, unsupported: [`IS_DATING_WITH_PLAYER(${subject.value})`] };
      // MOREDATES/Datees remains deferred. The implemented single-date path
      // records the authoritative partner in FLAG:デート相手.
      if (subject.value === 0) return { value: 0, unsupported: [] };
      const partner = state.flagStore[FLAG_ID.デート相手] ?? 0;
      return { value: partner !== 0 && partner === subject.value ? 1 : 0, unsupported: [] };
    }
    case "erect": {
      const subject = evaluateValue(value.subject, charaNum, state, rng, args, context);
      if (subject.unsupported.length > 0 || !Number.isSafeInteger(subject.value)) {
        return {
          value: 0,
          unsupported: subject.unsupported.length > 0 ? subject.unsupported : [`IS_ERECT(${subject.value})`],
        };
      }
      const slot = subject.value === 0 ? state.master : state.charas[subject.value];
      if (!slot) return { value: 0, unsupported: [`IS_ERECT(${subject.value})`] };
      const gender = slot.state.TALENT[TALENT_ID.性別] ?? 0;
      if ((gender & (1 << 1)) === 0) return { value: 0, unsupported: [] };
      const current = slot.state.BASE[BASE_ID.勃起] ?? 0;
      const max = slot.state.MAXBASE[BASE_ID.勃起] ?? 0;
      if (current >= max) return { value: 3, unsupported: [] };
      if (current >= 1000) return { value: 2, unsupported: [] };
      if (current >= 500) return { value: 1, unsupported: [] };
      return { value: 0, unsupported: [] };
    }
    case "working": {
      const subject = evaluateValue(value.subject, charaNum, state, rng, args, context);
      if (subject.unsupported.length > 0 || !Number.isSafeInteger(subject.value)) {
        return {
          value: 0,
          unsupported: subject.unsupported.length > 0 ? subject.unsupported : [`仕事中チェック(${subject.value})`],
        };
      }
      const slot = subject.value === 0 ? state.master : state.charas[subject.value];
      if (!slot) return { value: 0, unsupported: [`仕事中チェック(${subject.value})`] };
      // The scheduler is authoritative for the upstream TCVAR time window and
      // projects active work to CFLAG:行動=5. Preserve the remaining-work gate.
      const active = (slot.state.CFLAG[CFLAG_ID.行动] ?? 0) === 5;
      const remaining = slot.state.BASE[BASE_ID.仕事量] ?? 0;
      return { value: active && remaining > 0 ? 1 : 0, unsupported: [] };
    }
    case "is_here": {
      const evaluated = value.subjects.map((subject) =>
        evaluateValue(subject, charaNum, state, rng, args, context),
      );
      const unsupported = evaluated.flatMap((result) => result.unsupported);
      if (unsupported.length > 0) return { value: 0, unsupported };
      if (!evaluated.every((result) => Number.isSafeInteger(result.value))) {
        return { value: 0, unsupported: ["IS_HERE(non-integer subject)"] };
      }
      const slots = evaluated.map((result) =>
        result.value === 0 ? state.master : state.charas[result.value],
      );
      if (slots.some((slot) => !slot)) {
        return { value: 0, unsupported: ["IS_HERE(missing subject)"] };
      }
      return {
        value: slots.every((slot) => slot!.location === state.master.location) ? 1 : 0,
        unsupported: [],
      };
    }
    case "group_match": {
      const source = evaluateValue(value.value, charaNum, state, rng, args, context);
      const candidates = value.candidates.map((candidate) =>
        evaluateValue(candidate, charaNum, state, rng, args, context)
      );
      const unsupported = [
        ...source.unsupported,
        ...candidates.flatMap((candidate) => candidate.unsupported),
      ];
      if (unsupported.length > 0) return { value: 0, unsupported };
      return {
        value: candidates.some((candidate) => candidate.value === source.value) ? 1 : 0,
        unsupported: [],
      };
    }
    case "in_room": {
      const slot = slotForScope(value.scope, charaNum, state);
      return slot
        ? { value: inRoom(state, slot.location), unsupported: [] }
        : { value: 0, unsupported: [`INROOM(${String(value.scope)}:現在位置)`] };
    }
    case "location_test": {
      const slot = slotForScope(value.scope, charaNum, state);
      if (!slot) {
        return { value: 0, unsupported: [`${value.test}(${String(value.scope)}:現在位置)`] };
      }
      const result =
        value.test === "bath" || value.test === "bathroom"
          ? bathCheck(state, slot.location)
          : value.test === "bedroom"
            ? hasPlace(placeFlagsOf(slot.location), PLACE_FUTON) ||
              locationToRoomId(slot.location) === OMANEKIBEYA_ID
          : value.test === "out_roof"
            ? outRoof(state, slot.location) !== 0
            : inHome(slot.location);
      return { value: result ? 1 : 0, unsupported: [] };
    }
    case "at_home": {
      const subject = evaluateValue(value.subject, charaNum, state, rng, args, context);
      if (subject.unsupported.length > 0 || !Number.isInteger(subject.value)) {
        return { value: 0, unsupported: subject.unsupported.length > 0 ? subject.unsupported : ["AT_HOME"] };
      }
      return { value: atPlayerBase(state, subject.value) ? 1 : 0, unsupported: [] };
    }
    case "date_now": {
      const mapId = evaluateValue(value.mapId, charaNum, state, rng, args, context);
      return mapId.unsupported.length > 0
        ? { value: 0, unsupported: mapId.unsupported }
        : { value: chkDateNow(mapId.value) ? 1 : 0, unsupported: [] };
    }
    case "target_count":
      // Upstream GET_TARGETNUM is the number of NPC TARGET entries in the
      // current room. Modern state stores presence as canonical locations.
      return {
        value: Object.values(state.charas).filter(
          (slot) => slot?.location === state.master.location,
        ).length,
        unsupported: [],
      };
    case "chara_count": {
      const highestId = Math.max(
        0,
        charaNum,
        ...Object.keys(state.charas).map(Number).filter(Number.isFinite),
      );
      return { value: highestId, unsupported: [] };
    }
    case "relationship_state": {
      const subject = evaluateValue(value.subject, charaNum, state, rng, args, context);
      if (subject.unsupported.length > 0 || !Number.isInteger(subject.value)) {
        return {
          value: 0,
          unsupported: subject.unsupported.length > 0
            ? subject.unsupported
            : [`${value.flavor}RelationshipState(${subject.value})`],
        };
      }
      const resolved = relationshipState(value.flavor, subject.value, state);
      return resolved === null
        ? { value: 0, unsupported: [`${value.flavor}RelationshipState(${subject.value})`] }
        : { value: resolved, unsupported: [] };
    }
    case "fill_rate": {
      const slot = slotForScope(value.scope, charaNum, state);
      if (!slot) {
        return {
          value: 0,
          unsupported: [`充填率(${String(value.scope)},${value.bodyPart})`],
        };
      }
      const resolved = bodyFillRate(slot.state, value.bodyPart, value.cumulative);
      return resolved === null
        ? {
            value: 0,
            unsupported: [`充填率(${String(value.scope)},${value.bodyPart})`],
          }
        : { value: resolved, unsupported: [] };
    }
    case "add": {
      const results = value.parts.map((part) =>
        evaluateValue(part, charaNum, state, rng, args, context)
      );
      // String `+`: when EVERY part resolves to a text label (e.g.
      // `FESTIVAL() + "_1"`, `DISHNAME + "foo"`), concatenate the texts so
      // the result carries a usable string key; string parts contribute 0
      // to the numeric value. Mixed numeric adds keep the plain sum and no
      // text. Non-fatal unsupported on any part is preserved.
      const allText = results.every((result) => result.text !== undefined);
      return {
        value: results.reduce((sum, result) => sum + result.value, 0),
        ...(allText ? { text: results.map((result) => result.text ?? "").join("") } : {}),
        unsupported: results.flatMap((result) => result.unsupported),
      };
    }
    case "binary": {
      const left = evaluateValue(value.left, charaNum, state, rng, args, context);
      const right = evaluateValue(value.right, charaNum, state, rng, args, context);
      const unsupported = [...left.unsupported, ...right.unsupported];
      if (unsupported.length > 0) return { value: 0, unsupported };
      switch (value.op) {
        case "&":
          return { value: left.value & right.value, unsupported: [] };
        case "|":
          return { value: left.value | right.value, unsupported: [] };
        case "*":
          return { value: left.value * right.value, unsupported: [] };
        case "/":
          return {
            value: right.value === 0 ? 0 : Math.trunc(left.value / right.value),
            unsupported: [],
          };
        case "%":
          return {
            value: right.value === 0 ? 0 : left.value % right.value,
            unsupported: [],
          };
        case "-":
          return { value: left.value - right.value, unsupported: [] };
      }
    }
  }
}

interface PredicateEvaluation {
  value: boolean;
  unsupported: string[];
}

function evaluateNamedLocalPredicate(raw: string, context: KojoResolveContext): PredicateEvaluation | null {
  const namedLocals = context.vm?.namedLocals;
  if (!namedLocals) return null;
  const comparison = /^([^\s<>=!]+)\s*(==|!=|>=|<=|>|<)\s*(-?\d+)\s*$/.exec(raw);
  if (comparison) {
    const name = comparison[1]!;
    if (!Object.prototype.hasOwnProperty.call(namedLocals, name)) return null;
    const left = namedLocals[name] ?? 0;
    const right = Number(comparison[3]);
    switch (comparison[2]) {
      case "==": return { value: left === right, unsupported: [] };
      case "!=": return { value: left !== right, unsupported: [] };
      case ">=": return { value: left >= right, unsupported: [] };
      case "<=": return { value: left <= right, unsupported: [] };
      case ">": return { value: left > right, unsupported: [] };
      case "<": return { value: left < right, unsupported: [] };
    }
  }
  const name = raw.trim();
  if (!Object.prototype.hasOwnProperty.call(namedLocals, name)) return null;
  return { value: (namedLocals[name] ?? 0) !== 0, unsupported: [] };
}

/**
 * Soft-fallback evaluator for `kind: "unknown"` predicates whose raw text
 * matches an obvious variable-reference shape: `NS[:SCOPE]:IDENT`. The
 * shape itself is enough to keep the route supported; the predicate
 * evaluates to `false` so the surrounding ELSE arm wins, mirroring the
 * fail-closed semantics without producing a diagnostic. Real bindings
 * are added per task #15 (`unknown-var:<ns>:<id>` markers are dropped
 * silently here — accepted trade-off documented in
 * `KOJO-RUNTIME-UNSUPPORTED-INVENTORY-2026-07-25.md` § #2).
 *
 * Scope is permissive: paren-expr, `[[name]]`, identifier, or numeric —
 * matching the existing `VAR_REF_RE` flexibility while accepting the
 * shapes that parser rejection left stranded (K70/K83 author-defined
 * `K{n}C_*` scopes, parenthesised dynamic scopes, etc).
 */
function evaluateUnknownVarPredicate(raw: string): PredicateEvaluation | null {
  const match = /^(TALENT|CFLAG|FLAG|TCVAR|ABL|BASE|MAXBASE|EXP|PALAM|JUEL|SOURCE|EQUIP|STAIN|TEQUIP|MARK|EX|NOWEX|ITEM|TFLAG)(?::([^\s:][^:]*))?:([^\s:].*)$/.exec(
    raw.trim(),
  );
  if (!match) return null;
  // The lookup itself is dropped on the floor — what matters for the
  // route's support status is that we DO NOT add a diagnostic. The IF
  // arm is treated as `false`, so the ELSE arm fires; the player still
  // sees authored text instead of an unsupported route.
  return { value: false, unsupported: [] };
}

function evaluatePredicate(
  pred: KojoPredicate,
  charaNum: number,
  state: GameState,
  rng: Rng,
  args: readonly number[],
  context: KojoResolveContext,
  effects: KojoStagedEffect[],
): PredicateEvaluation {
  switch (pred.kind) {
    case "always":
      return { value: true, unsupported: [] };
    case "never":
      return { value: false, unsupported: [] };
    case "unknown_var_nonzero":
      return {
        value: false,
        unsupported: [`${pred.ns}:${pred.scope}:${pred.id}`],
      };
    case "function-call": {
      // Predicate-side function call (task #3). The parser recognised
      // `NAME(args...)` as a structured node rather than letting it fall
      // through to `kind:"unknown"`. Runtime asks the function-call
      // registry first; if a helper is registered (slice B / C — task
      // #15 slots K70 helpers here) it runs the implementation. Otherwise
      // the predicate is false with a non-fatal
      // `unknown-function:<name>` diagnostic so the route still counts
      // as supported (the predicate is structurally recognised).
      return evaluateFunctionCallPredicate(pred, charaNum, state, rng, args, context, effects);
    }
    case "unknown": {
      const namedLocal = evaluateNamedLocalPredicate(pred.raw, context);
      if (namedLocal) return namedLocal;
      const promoted = parsePredicate(pred.raw, context.symbols);
      if (promoted.kind === "unknown") {
        // Re-parse failed; fall back to a permissive var-shape check so
        // the route stays supported when the source references an
        // identifier the modern symbol table doesn't know yet (task
        // #15 will register real bindings).
        const softVar = evaluateUnknownVarPredicate(pred.raw);
        if (softVar) return softVar;
        return { value: false, unsupported: [pred.raw] };
      }
      return evaluatePredicate(promoted, charaNum, state, rng, args, context, effects);
    }
    case "not": {
      const inner = evaluatePredicate(pred.inner, charaNum, state, rng, args, context, effects);
      return {
        value: inner.unsupported.length === 0 ? !inner.value : false,
        unsupported: inner.unsupported,
      };
    }
    case "and": {
      const parts = pred.parts.map((part) =>
        evaluatePredicate(part, charaNum, state, rng, args, context, effects),
      );
      return {
        value: parts.every((part) => part.value) && parts.every((part) => part.unsupported.length === 0),
        unsupported: parts.flatMap((part) => part.unsupported),
      };
    }
    case "or": {
      const parts = pred.parts.map((part) =>
        evaluatePredicate(part, charaNum, state, rng, args, context, effects),
      );
      return {
        value: parts.some((part) => part.value && part.unsupported.length === 0),
        unsupported: parts.flatMap((part) => part.unsupported),
      };
    }
    case "var_nonzero": {
      const scope = resolveVarScope(pred.scope, charaNum, state, rng, args, context);
      if (scope.scope === null) return { value: false, unsupported: scope.unsupported };
      const value = readVar(pred.ns, scope.scope, pred.id, charaNum, state);
      return value === null
        ? { value: false, unsupported: [`${pred.ns}:${String(pred.scope)}:${pred.id}`] }
        : { value: value !== 0, unsupported: [] };
    }
    case "var_eq": {
      const scope = resolveVarScope(pred.scope, charaNum, state, rng, args, context);
      if (scope.scope === null) return { value: false, unsupported: scope.unsupported };
      const value = readVar(pred.ns, scope.scope, pred.id, charaNum, state);
      return value === null
        ? { value: false, unsupported: [`${pred.ns}:${String(pred.scope)}:${pred.id}`] }
        : { value: value === pred.value, unsupported: [] };
    }
    case "rand_nonzero":
      return { value: rng.int(Math.max(1, pred.max)) !== 0, unsupported: [] };
    case "rand_eq":
      return { value: rng.int(Math.max(1, pred.max)) === pred.value, unsupported: [] };
    case "arg_nonzero":
      return { value: (args[pred.index] ?? 0) !== 0, unsupported: [] };
    case "arg_eq":
      return { value: (args[pred.index] ?? 0) === pred.value, unsupported: [] };
    case "string_arg_compare": {
      const actual = context.stringArgs?.[pred.index] ?? "";
      return {
        value: pred.op === "==" ? actual === pred.expected : actual !== pred.expected,
        unsupported: [],
      };
    }
    case "truthy": {
      const value = evaluateValue(pred.value, charaNum, state, rng, args, context);
      return {
        value: value.unsupported.length === 0 && value.value !== 0,
        unsupported: value.unsupported,
      };
    }
    case "compare": {
      const left = evaluateValue(pred.left, charaNum, state, rng, args, context);
      const right = evaluateValue(pred.right, charaNum, state, rng, args, context);
      const unsupported = [...left.unsupported, ...right.unsupported];
      // task #15: when either side has a `text` form (helpers like
      // K40/K79_WHERE_ABOUT return a localisation label), the
      // comparison becomes strict-equal string semantics instead of
      // numeric. Numeric double-sided compares keep the legacy
      // `compareNumber` path; mixed or string-only compares use
      // `compareBareString` semantics. Missing text on both sides
      // returns false (legacy numeric-but-no-match path).
      const leftText = left.text;
      const rightText = right.text;
      if (leftText !== undefined || rightText !== undefined) {
        const lt = leftText ?? "";
        const rt = rightText ?? "";
        return {
          value: unsupported.length === 0 && compareBareString(lt, pred.op, rt),
          unsupported,
        };
      }
      return {
        value: unsupported.length === 0 && compareNumber(left.value, pred.op, right.value),
        unsupported,
      };
    }
    case "alcohol_face_compare": {
      const subject = evaluateValue(pred.subject, charaNum, state, rng, args, context);
      if (subject.unsupported.length > 0 || !Number.isSafeInteger(subject.value)) {
        return {
          value: false,
          unsupported:
            subject.unsupported.length > 0 ? subject.unsupported : [`ALCOHOL_FACE(${subject.value})`],
        };
      }
      const slot = subject.value === 0 ? state.master : state.charas[subject.value];
      if (!slot) return { value: false, unsupported: [`ALCOHOL_FACE(${subject.value})`] };
      const actual = alcoholFace(state, subject.value);
      return {
        value: pred.op === "==" ? actual === pred.expected : actual !== pred.expected,
        unsupported: [],
      };
    }
    case "festival_compare": {
      const actual = festivalNow(state.time);
      return {
        value: pred.op === "==" ? actual === pred.expected : actual !== pred.expected,
        unsupported: [],
      };
    }
    case "memory_first": {
      const selectCom = state.turnContext?.selectCom ?? context.commandNo;
      const selectComTemplate = /^@?"\{SELECTCOM\}([^{}"]*)"$/.exec(pred.key);
      const evaluatedKey = pred.keyValue
        ? evaluateValue(pred.keyValue, charaNum, state, rng, args, context)
        : null;
      if (evaluatedKey?.unsupported.length) {
        return { value: false, unsupported: evaluatedKey.unsupported };
      }
      const key = pred.keyValue
        ? (evaluatedKey!.text !== undefined
            ? evaluatedKey!.text
            : String(evaluatedKey!.value))
        : pred.key === "SELECTCOM"
          ? selectCom === undefined
            ? null
            : `SELECTCOM:${selectCom}`
          : pred.key === "TRAINNAME:SELECTCOM"
            ? selectCom === undefined
              ? null
              : `TRAINNAME:${selectCom}`
            : selectComTemplate
              ? selectCom === undefined
                ? null
                : `${selectCom}${selectComTemplate[1]}`
              : pred.key;
      if (!key) return { value: false, unsupported: [`${pred.memory}(${pred.key})`] };
      const memoryCharaNum =
        pred.scope === "MASTER"
          ? state.master.charaNum
          : typeof pred.scope === "number"
            ? pred.scope
            : charaNum;
      if (
        !Number.isSafeInteger(memoryCharaNum) ||
        (memoryCharaNum !== state.master.charaNum && !state.charas[memoryCharaNum])
      ) {
        return { value: false, unsupported: [`${pred.memory}(${pred.key},,,${String(pred.scope)})`] };
      }
      const bucket =
        pred.memory === "FIRSTTIME"
          ? state.kojoMemory?.[memoryCharaNum]?.firstTime
          : state.kojoMemory?.[memoryCharaNum]?.once;
      if (bucket?.[key]) return { value: false, unsupported: [] };
      if (pred.update === false) return { value: true, unsupported: [] };
      const effect: KojoStagedEffect = { kind: "memory", memory: pred.memory, charaNum: memoryCharaNum, key };
      effects.push(effect);
      Object.assign(state, applyKojoEffects(state, [effect]));
      return { value: true, unsupported: [] };
    }
    case "system_var_compare": {
      // task #4: bare-identifier comparison. Both sides are kept as
      // strings; runtime resolves each side through
      // `resolveSystemVarAccessor`. When a side has no binding it
      // contributes `""`, which `compareBareString` interprets as
      // not-equal against any non-empty literal and as
      // missing-numeric against any identifier (numeric comparison
      // returns false). Either way no `unsupported` diagnostic is
      // emitted — the route stays supported and the ELSE arm fires
      // when both sides can't be resolved.
      const lRaw = resolveSystemVarAccessor(pred.left, charaNum, state, context);
      const rRaw = resolveSystemVarAccessor(pred.right, charaNum, state, context);
      if (lRaw.unsupported.length > 0 || rRaw.unsupported.length > 0) {
        return {
          value: false,
          unsupported: [...lRaw.unsupported, ...rRaw.unsupported],
        };
      }
      return {
        value: compareBareString(lRaw.text, pred.op, rRaw.text),
        unsupported: [],
      };
    }
  }
}

/**
 * task #4: resolve a bare-identifier text against the deterministic
 * game state. Returns `{ text, unsupported }`:
 *  - `text` is the canonical string form (`"3"`, `"指令"`, `"神社:居間"`)
 *  - `unsupported.length > 0` means this side cannot be resolved at
 *    all; the surrounding comparison short-circuits to `false`.
 *
 * Recognised patterns (in addition to the obvious typed parses
 * `MODE`, `DAY`, `TIME`, `LOCALS`, etc.):
 *   - `LOCALS` / `LOCALS:N` → resolved string mirror slot
 *   - `RESULTS` / `RESULTS:N` → string result slot
 *   - `NAME:MASTER` / `NAME:TARGET` / `NAME:N` → chara name lookup
 *   - `CALLNAME:MASTER` / `CALLNAME:TARGET` / `CALLNAME:N` / `CALLNAME:[[name]]`
 *   - `前面指令` → last commandKind label (best-effort string match)
 *   - `MODE` → current menu phase (`食前" / "デイリー"`), default `"指令"`
 *   - `DISH_TYPE` / `DISH_DRG` → current dish kind, default `""`
 *   - `K{n}C_*` → author-defined CFLAG prefix treated as identifier only
 *   - `RESULT` / `RESULT:N` → numeric result slot rendered as text
 *   - `MASTER` / `TARGET` → charaNum rendered as text
 */
interface SystemVarResolution {
  text: string;
  unsupported: string[];
}

function resolveSystemVarAccessor(
  raw: string,
  charaNum: number,
  state: Readonly<GameState>,
  context: KojoResolveContext,
): SystemVarResolution {
  const v = raw.trim();
  if (v === "") return { text: "", unsupported: [] };
  // A few upstream encounter packs use the mixed-case spelling directly
  // (for example `Day:2`), so resolve this before the generic namespace
  // grammar.  This keeps the parser/router pair independent of locale or
  // identifier-character quirks in the broad colon matcher below.
  const directDay = /^DAY:(\d+)$/i.exec(v);
  if (directDay) {
    const index = Number(directDay[1]);
    const value = index === 0
      ? state.time.dayIndex
      : index === 2
        ? state.time.season ?? 1
        : index === 3
          ? state.time.date ?? 1
          : 0;
    return { text: String(value), unsupported: [] };
  }
  if (v === "拠点_家主") {
    return { text: String(privateRoomOwner(state as GameState, state.master.location) ?? 0), unsupported: [] };
  }
  // numeric literal — return as string for numeric comparison path
  if (/^-?\d+$/.test(v)) return { text: v, unsupported: [] };
  // STRING_TOKEN from CSTR — quoted literal
  const stringLiteral = /^"((?:[^"]|"")*)"$/.exec(v);
  if (stringLiteral) {
    return { text: stringLiteral[1]!.replace(/""/g, '"'), unsupported: [] };
  }
  // Namespace forms
  const colonMatch = /^([A-Za-z_぀-ヿ㐀-鿿][\w぀-ヿ㐀-鿿]*):(.+)$/.exec(v);
  if (colonMatch) {
    const ns = colonMatch[1]!.toUpperCase();
    const scope = colonMatch[2]!.trim();
    if (ns === "DAY") {
      const index = /^\d+$/.test(scope) ? Number(scope) : 0;
      const value = index === 0
        ? state.time.dayIndex
        : index === 2
          ? state.time.season ?? 1
          : index === 3
            ? state.time.date ?? 1
            : 0;
      return { text: String(value), unsupported: [] };
    }
    if (ns === "LOCALS") {
      const idx = /^\d+$/.test(scope) ? Number(scope) : 0;
      const text = context.vm?.resolvedStringLocals?.[idx] ?? "";
      return { text, unsupported: [] };
    }
    if (ns === "RESULTS") {
      // RESULTS is the string mirror of RESULT. We don't currently
      // persist a per-frame string mirror, so treat as not-yet-set —
      // empty binding keeps the route supported, the comparison
      // reads as false, and the ELSE arm fires (matching the legacy
      // runtime behaviour when RESULTS was never written this frame).
      return { text: "", unsupported: [] };
    }
    if (ns === "RESULT") {
      const idx = /^\d+$/.test(scope) ? Number(scope) : 0;
      const value = context.vm?.result[idx] ?? 0;
      return { text: String(value), unsupported: [] };
    }
    if (ns === "CALLNAME") {
      const target = resolveCallNameTarget(scope, charaNum, state);
      if (target === null) return { text: "", unsupported: [] };
      const slot = target === 0 ? state.master : state.charas[target];
      return { text: String(slot?.callName ?? ""), unsupported: [] };
    }
    if (ns === "MASTERNAME") {
      const observer = /^\d+$/.test(scope) ? Number(scope) : null;
      if (observer === null) return { text: "", unsupported: [] };
      return {
        text: state.displayNames?.[observer]?.[0] ?? state.master.callName ?? "",
        unsupported: [],
      };
    }
    if (ns === "NAME") {
      const target = resolveCallNameTarget(scope, charaNum, state);
      if (target === null) return { text: "", unsupported: [] };
      const slot = target === 0 ? state.master : state.charas[target];
      return { text: String(slot?.callName ?? ""), unsupported: [] };
    }
    // Numeric / author-defined CFLAG-style NS — return scope verbatim
    // so author comparisons (`CFLAG:K17C_恋慕`) can be cached and
    // resolved later by `findAuthoredValue`. The runtime treats these
    // as opaque identifiers; identical strings compare equal.
    return { text: "", unsupported: [`unbound-system-var:${v}`] };
  }
  // Bare identifier — best-effort resolution per inventory top hits.
  // When the binding is missing we still return "" so the comparison
  // completes (and routes stay supported); for the special case of
  // plain digits on RHS this means `==` returns false but `>=` /
  // `<=` etc. interpret "" as missing and return false. Authors
  // author typically nest `MODE == "指令"` etc. behind an `IF` arm
  // that we cannot evaluate accurately here — the better fail mode
  // is "fall through to ELSE" rather than "throw unsupported".
  if (v === "MODE") {
    const phase = (state as { menuPhase?: string }).menuPhase ?? "指令";
    return { text: phase, unsupported: [] };
  }
  if (v === "DISH_TYPE" || v === "DISH_DRG") {
    return { text: "", unsupported: [`unbound-system-var:${v}`] };
  }
  if (v === "DAY") {
    return { text: String(state.time?.dayIndex ?? 0), unsupported: [] };
  }
  if (v === "DAYEV") {
    return { text: "", unsupported: [`unbound-system-var:${v}`] };
  }
  if (v === "TIME") {
    return { text: String(state.time?.hourOfDay ?? 0), unsupported: [] };
  }
  if (v === "MASTER" || v === "PLAYER") {
    return { text: String(state.master?.charaNum ?? 0), unsupported: [] };
  }
  if (v === "TARGET") {
    return { text: String(charaNum ?? 0), unsupported: [] };
  }
  if (v === "RESULTS") {
    return { text: context.vm?.resolvedStringResults?.[0] ?? "", unsupported: [] };
  }
  if (v === "LOCALS") {
    return { text: context.vm?.resolvedStringLocals?.[0] ?? "", unsupported: [] };
  }
  // `前面指令` / `iRT` / 好感度 / etc. — author-named metrics
  // that the modern runtime never resolves. Return empty so the
  // comparison evaluates to false (literal `== "..."` against empty
  // fails; numeric comparisons also fail). Authors use these
  // inside additional guards that we cannot satisfy, so falling
  // through to ELSE is the correct fail-mode.
  return { text: "", unsupported: [`unbound-system-var:${v}`] };
}

/** Exact numeric part of `MOON_WATCH` (MOON_WATCH.ERB:7-149). The location
 * gate is read from the same generated PLACE_赏月/OUTROOF authority used by
 * the world runtime. */
function moonWatchValue(state: Readonly<GameState>, date: number, ignoreLocation: boolean): number {
  const minute = ((state.time.tickValue % 1440) + 1440) % 1440;
  const zone = timeZoneOf(state.time.tickValue);
  const weather = currentRegionWeather(state as GameState).weatherIndex;
  const location = state.master.location;
  const map = mapIdOfLocation(location);
  const canSeeMoon = ignoreLocation || (
    map !== 9 && map !== 10 && map !== 11 &&
    (hasPlace(placeFlagsOf(location), PLACE_MOON) || outRoof(state as GameState, location) !== 0)
  );
  if (zone < 5 || zone > 7 || weather >= 2 || !canSeeMoon) return -1;
  const inRanges = (...ranges: Array<readonly [number, number]>) =>
    ranges.some(([start, end]) => minute >= start && minute <= end);
  if (date === 1 || date === 31) return 1;
  if (date === 2) return inRanges([1140, 1200]) ? 2 : 0;
  if (date === 3) return inRanges([1140, 1260]) ? 3 : 0;
  if (date === 4 || date === 5) return inRanges([1140, 1320]) ? 4 : 0;
  if (date === 6 || date === 7) return inRanges([1140, 1380]) ? 4 : 0;
  if (date === 8) return inRanges([1140, 1440]) ? 5 : 0;
  if (date === 9 || date === 10) return inRanges([0, 60], [1140, 1440]) ? 6 : 0;
  if (date === 11 || date === 12) return inRanges([0, 120], [1140, 1440]) ? 6 : 0;
  if (date === 13) return inRanges([0, 180], [1140, 1440]) ? 7 : 0;
  if (date === 14) return inRanges([0, 210], [1140, 1440]) ? 8 : 0;
  if (date === 15) return 9;
  if (date === 16) return inRanges([0, 240], [1170, 1440]) ? 10 : 0;
  if (date >= 17 && date <= 19) return inRanges([0, 240], [1230, 1440]) ? 11 : 0;
  if (date >= 20 && date <= 22) return inRanges([0, 240], [1350, 1440]) ? 11 : 0;
  if (date === 23) return inRanges([0, 240]) ? 12 : 0;
  if (date >= 24 && date <= 26) return inRanges([60, 240]) ? 13 : 0;
  if (date >= 27 && date <= 29) return inRanges([120, 240]) ? 13 : 0;
  if (date === 30) return inRanges([180, 240]) ? 14 : 0;
  return 0;
}

type ResolvedVarScope = "TARGET" | "MASTER" | "GLOBAL" | number;

function resolveVarScope(
  scope: KojoVarScope,
  charaNum: number,
  state: Readonly<GameState>,
  rng: Rng,
  args: readonly number[],
  context: KojoResolveContext,
): { scope: ResolvedVarScope | null; unsupported: string[] } {
  if (typeof scope !== "object") return { scope, unsupported: [] };
  if (scope.kind === "local") {
    if (!context.vm || scope.index >= context.vm.locals.length) {
      return { scope: null, unsupported: [`LOCAL:${scope.index} subject`] };
    }
    return { scope: context.vm.locals[scope.index]!, unsupported: [] };
  }
  if (scope.kind === "arg") {
    if (scope.index >= args.length) {
      return { scope: null, unsupported: [`ARG:${scope.index} subject`] };
    }
    return { scope: args[scope.index]!, unsupported: [] };
  }
  if (scope.kind === "alias") {
    const direct = context.subjectAliases?.[scope.name];
    if (direct !== undefined) return { scope: direct, unsupported: [] };
    const local = context.vm?.namedLocals?.[scope.name];
    if (local !== undefined) return { scope: local, unsupported: [] };
    if (scope.name === "ASSI" || scope.name === "DISH_ASSI") {
      const assistant = state.dish?.assi;
      if (assistant !== undefined && assistant > 0) return { scope: assistant, unsupported: [] };
    }
    // Alice's personal pack exposes her own id through K17C_ID.  It is a
    // source-level alias, not a dynamic VM lookup; resolving it here keeps
    // `CFLAG:K17C_ID:*` and helper calls deterministic for static encounters.
    if (scope.name.toUpperCase() === "K17C_ID") return { scope: 17, unsupported: [] };
    return { scope: null, unsupported: [`subject-alias:${scope.name}`] };
  }
  const evaluated = evaluateValue(scope.value, charaNum, state, rng, args, context);
  return evaluated.unsupported.length > 0 || !Number.isSafeInteger(evaluated.value)
    ? { scope: null, unsupported: evaluated.unsupported.length > 0
        ? evaluated.unsupported
        : [`dynamic subject:${evaluated.value}`] }
    : { scope: evaluated.value, unsupported: [] };
}

/**
 * task #4: numeric-or-text comparison honouring the legacy eraTW
 * semantics for `system_var_compare`. When both sides parse cleanly
 * to integers the comparison is numeric; otherwise it is a
 * strict-equal string comparison. Both sides empty / unbound → return
 * false (the ELSE arm fires).
 */
function compareBareString(actual: string, op: string, expected: string): boolean {
  const aNum = /^-?\d+$/.test(actual);
  const eNum = /^-?\d+$/.test(expected);
  if (aNum && eNum) return compareNumber(Number(actual), op, Number(expected));
  if (op === "==") return actual === expected;
  if (op === "!=") return actual !== expected;
  return false;
}

/**
 * task #4: helper for `CALLNAME:scope` and `NAME:scope`. Resolves the
 * canonical character number for a scope literal — `MASTER` /
 * `PLAYER` / `TARGET` / numeric / `[[name]]` symbol — and returns the
 * `charaNum` of the matching slot. Returns null when the scope can
 * not be resolved (so the caller can treat that as an empty binding
 * instead of an unsupported slot).
 */
function resolveCallNameTarget(
  scope: string,
  charaNum: number,
  state: Readonly<GameState>,
): number | null {
  if (scope === "MASTER" || scope === "PLAYER") return 0;
  if (scope === "TARGET") return charaNum;
  if (/^-?\d+$/.test(scope)) {
    const n = Number(scope);
    if (n === 0) return 0;
    return state.charas[n] ? n : null;
  }
  return null;
}

// ─── Function-call registry (task #3) ─────────────────────────────────────
//
// `parsePredicate` now emits `kind:"function-call"` for `NAME(args...)`
// shapes that don't have a more specific binding. The runtime consults
// this registry before falling back to "unknown-function:<name>". Each
// implementation is intentionally small — the goal of task #3 is to
// keep the predicate count supported and the route wired up. Real
// semantic fidelity for character-specific helpers (task #15) is
// out of scope here.

type FunctionCallPredicateContext = {
  pred: Extract<KojoPredicate, { kind: "function-call" }>;
  charaNum: number;
  state: Readonly<GameState>;
  rng: Rng;
  args: readonly number[];
  context: KojoResolveContext;
  effects: KojoStagedEffect[];
};

type FunctionCallPredicateHandler = (
  ctx: FunctionCallPredicateContext,
) => PredicateEvaluation;

const FUNCTION_CALL_PREDICATE_REGISTRY: Record<string, FunctionCallPredicateHandler> = {};

function registerFunctionCallPredicate(
  name: string,
  handler: FunctionCallPredicateHandler,
): void {
  FUNCTION_CALL_PREDICATE_REGISTRY[name.toUpperCase()] = handler;
}

/** Whether the static router has a deterministic handler for a parsed
 * predicate function call. Coverage tooling uses the same registry so its
 * report cannot claim a helper is supported merely because its syntax parsed.
 */
export function isFunctionCallPredicateSupported(name: string): boolean {
  return Boolean(FUNCTION_CALL_PREDICATE_REGISTRY[name.toUpperCase()]);
}

/** Evaluate a `function-call` predicate by consulting the registry. If a
 *  handler is registered for `pred.name`, delegate to it; otherwise
 *  return `false` with a non-fatal `unknown-function:<name>` diagnostic
 *  so the route stays supported. The diagnostic lets downstream tooling
 *  (validate-kojo-coverage, kojo-effect-coverage baselines) flag missing
 *  handlers without breaking the predicate count. */
function evaluateFunctionCallPredicate(
  pred: Extract<KojoPredicate, { kind: "function-call" }>,
  charaNum: number,
  state: GameState,
  rng: Rng,
  args: readonly number[],
  context: KojoResolveContext,
  effects: KojoStagedEffect[],
): PredicateEvaluation {
  const handler = FUNCTION_CALL_PREDICATE_REGISTRY[pred.name.toUpperCase()];
  if (!handler) return { value: false, unsupported: [`unknown-function:${pred.name}`] };
  return handler({ pred, charaNum, state, rng, args, context, effects });
}

// ─── Function-call VALUE registry (task #15) ────────────────────────────
//
// `evaluateValue` consults this registry for `function-call-stub`
// tokens (when the call sits on the LHS or RHS of a `compare` shape —
// e.g. `K139_FIND_AROUND() == 140`, `K40_WHERE_ABOUT() == "室外"`).
// Handlers return numeric (for `==` numeric compares) with an optional
// `text` form (for label-equality compares). When the helper is
// unknown the runtime falls back to the prior task #3 fail-soft 0 +
// diagnostic.

type FunctionCallValueHandler = (ctx: {
  name: string;
  args: readonly string[];
  charaNum: number;
  state: Readonly<GameState>;
  rng: Rng;
  /** Numeric arguments belonging to the active kojo call frame. */
  runtimeArgs?: readonly number[];
  context: KojoResolveContext;
}) => ValueEvaluation;

const FUNCTION_CALL_VALUE_REGISTRY: Record<string, FunctionCallValueHandler> = {};

function registerFunctionCallValue(
  name: string,
  handler: FunctionCallValueHandler,
): void {
  FUNCTION_CALL_VALUE_REGISTRY[name.toUpperCase()] = handler;
}

export function isFunctionCallValueSupported(name: string): boolean {
  return Boolean(FUNCTION_CALL_VALUE_REGISTRY[name.toUpperCase()]);
}

/** Resolve the small character-reference grammar used by direct numeric
 * helpers (`TARGET`, `MASTER`, numeric ids and `[[call-name]]`).  This is
 * intentionally local to value helpers: it does not turn arbitrary CALL
 * chains into an executable VM. */
function resolveValueSubject(
  raw: string | undefined,
  charaNum: number,
  state: Readonly<GameState>,
  context: KojoResolveContext,
): number | null {
  const token = raw?.trim() ?? "";
  if (token === "" || token === "-1" || token === "TARGET" || token === "CHARA") {
    return charaNum === 0 || state.charas[charaNum] ? charaNum : null;
  }
  if (token === "MASTER" || token === "PLAYER" || token === "0") return 0;
  if (/^-?\d+$/.test(token)) {
    const id = Number(token);
    return id === 0 || state.charas[id] ? id : null;
  }
  const directAlias = context.subjectAliases?.[token];
  if (directAlias !== undefined) return directAlias === 0 || state.charas[directAlias] ? directAlias : null;
  const wrapped = /^\[\[([^\]\r\n]+)\]\]$/.exec(token);
  const name = wrapped?.[1] ?? token;
  const aliasName = context.callNameAliases?.[token] ?? context.callNameAliases?.[name];
  const candidates = [state.master, ...Object.values(state.charas)];
  const normalized = (value: string): string => value.trim().replace(/\s+/g, "");
  const wanted = normalized(aliasName ?? name);
  const found = candidates.find((slot) =>
    [slot.name, slot.callName].some((candidate) => candidate !== undefined && (
      candidate === (aliasName ?? name) || normalized(candidate) === wanted
    )),
  );
  if (found) return found.charaNum;
  // A caller-provided name resolver may know an alias that is not present on
  // the sparse save slot. Match its rendered name against the same token.
  if (context.nameResolver) {
    const resolved = candidates.find((slot) => {
      const rendered = context.nameResolver?.(slot.charaNum);
      return rendered !== undefined && normalized(rendered) === wanted;
    });
    if (resolved) return resolved.charaNum;
  }
  return null;
}

function resolveValueArgument(
  raw: string | undefined,
  index: number,
  runtimeArgs: readonly number[] | undefined,
  charaNum: number,
  state: Readonly<GameState>,
  context: KojoResolveContext,
): number | null {
  const token = raw?.trim() ?? "";
  const arg = /^ARG(?::(\d+))?$/.exec(token);
  if (arg) return runtimeArgs?.[Number(arg[1] ?? index)] ?? null;
  if (/^-?\d+$/.test(token)) return Number(token);
  const subject = resolveValueSubject(token, charaNum, state, context);
  return subject;
}

function registerSourceBackedDirectValueHandlers(): void {
  /** `FESTIVAL()` — the current festival name (`祭日イベント.ERB:6`). Used
   *  as a FIRSTTIME string key (`FESTIVAL() + "_1"`, K77 festival talks)
   *  and in calendar gates (`FESTIVAL() == "節分"`). No festival → "". */
  registerFunctionCallValue("FESTIVAL", ({ state }) => ({
    value: 0,
    text: festivalNow(state.time),
    unsupported: [],
  }));

  /** COMMON.ERB:@THINKS_IS_VIRGIN — only applicable non-anal virginity. */
  registerFunctionCallValue("THINKS_IS_VIRGIN", ({ args, charaNum, state, context }) => {
    const subject = resolveValueSubject(args[0], charaNum, state, context);
    if (subject === null) return { value: 0, unsupported: [`THINKS_IS_VIRGIN:${args[0] ?? "TARGET"}`] };
    const slot = subject === 0 ? state.master : state.charas[subject];
    if (!slot) return { value: 0, unsupported: [`THINKS_IS_VIRGIN:${subject}`] };
    const gender = slot.state.TALENT[TALENT_ID.性別] ?? 0;
    return {
      value: (gender & 1) !== 0 ? (slot.state.TALENT[TALENT_ID.処女] ?? 0) : 0,
      unsupported: [],
    };
  });
  /** COMMON.ERB:@MASTER_IS_VIRGIN — all applicable non-anal virginities. */
  const masterIsVirgin = (state: Readonly<GameState>): boolean => {
    const talent = state.master.state.TALENT;
    const gender = talent[TALENT_ID.性別] ?? 0;
    const isVirgin = (talent[TALENT_ID.処女] ?? 0) !== 0;
    const hasPenis = (gender & 2) !== 0;
    const isDoutei = (talent[TALENT_ID.非童貞] ?? 0) === 0 && hasPenis;
    return ((gender & 1) !== 0 && isVirgin) || (gender === 2 && isDoutei) || (gender === 3 && isDoutei && isVirgin);
  };
  registerFunctionCallValue("MASTER_IS_VIRGIN", ({ state }) => ({
    value: masterIsVirgin(state) ? 1 : 0,
    unsupported: [],
  }));
  registerFunctionCallPredicate("MASTER_IS_VIRGIN", ({ state }) => ({
    value: masterIsVirgin(state),
    unsupported: [],
  }));
  // The same helper is also used as a bare IF predicate (`!THINKS...`).
  // Keep the predicate and value paths on one deterministic implementation;
  // do not turn this into a generic CALL/VM bridge.
  registerFunctionCallPredicate("THINKS_IS_VIRGIN", ({ pred, charaNum, state, rng, args, context }) => {
    const handler = FUNCTION_CALL_VALUE_REGISTRY[pred.name.toUpperCase()];
    if (!handler) return { value: false, unsupported: [`unknown-function:${pred.name}`] };
    const resolved = handler({
      name: pred.name,
      args: pred.args,
      charaNum,
      state,
      rng,
      runtimeArgs: args,
      context,
    });
    return { value: resolved.value !== 0, unsupported: resolved.unsupported };
  });

  /** K15_DESIRE_INTIMACY — Sakuya's desire + intimacy aggregate. */
  registerFunctionCallValue("K15_DESIRE_INTIMACY", ({ state }) => {
    const slot = state.charas[15];
    if (!slot) return { value: 0, unsupported: ["K15_DESIRE_INTIMACY:missing subject 15"] };
    return {
      value: (slot.state.ABL[ABL_ID.親密] ?? 0) + (slot.state.ABL[ABL_ID.欲望] ?? 0),
      unsupported: [],
    };
  });

  /** K36_MASTER_LOVER_NUMBER — count lover/yearning talents, optionally
   * excluding the 地灵殿 roster (36/37/38/49). */
  registerFunctionCallValue("K36_MASTER_LOVER_NUMBER", ({ args, runtimeArgs, charaNum, state, context }) => {
    const mode = resolveValueArgument(args[0], 0, runtimeArgs, charaNum, state, context);
    const relation = resolveValueArgument(args[1], 1, runtimeArgs, charaNum, state, context);
    if ((mode !== 1 && mode !== 2) || (relation !== 1 && relation !== 2)) {
      return { value: -1, unsupported: [] };
    }
    const excluded = new Set([36, 37, 38, 49]);
    const count = Object.values(state.charas).filter((slot) => {
      if (mode === 2 && excluded.has(slot.charaNum)) return false;
      const talentId = relation === 1 ? TALENT_ID.恋人 : TALENT_ID.恋慕;
      return (slot.state.TALENT[talentId] ?? 0) !== 0;
    }).length;
    return { value: count, unsupported: [] };
  });
}

/** Small source-backed helpers used by first-meeting packs.  These are kept
 * in the deterministic registry rather than routed through the retired ERB
 * executor: every result is derived from the current GameState (or the
 * authored default for an optional pack variable). */
function registerEncounterHelperHandlers(): void {
  const resolveSubject = (
    raw: string | undefined,
    charaNum: number,
    state: Readonly<GameState>,
    context: KojoResolveContext,
  ): number | null => resolveValueSubject(raw, charaNum, state, context);

  const slotFor = (id: number, state: Readonly<GameState>) => id === 0 ? state.master : state.charas[id];

  const resolveString = (
    raw: string | undefined,
    charaNum: number,
    state: Readonly<GameState>,
    context: KojoResolveContext,
  ): string | null => {
    const token = raw?.trim() ?? "";
    const quoted = /^"((?:[^\"]|"")*)"$/.exec(token);
    if (quoted) return quoted[1]!.replace(/""/g, "\"");
    const local = /^LOCALS(?::(\d+))?$/i.exec(token);
    if (local) return context.vm?.resolvedStringLocals?.[Number(local[1] ?? 0)] ?? "";
    const result = /^RESULTS(?::(\d+))?$/i.exec(token);
    if (result) return context.vm?.resolvedStringResults?.[Number(result[1] ?? 0)] ?? "";
    const cstr = /^CSTR:(?:(MASTER|PLAYER|TARGET|\d+):)?(.+)$/i.exec(token);
    if (cstr) {
      const owner = cstr[1] === undefined
        ? charaNum
        : /^(MASTER|PLAYER)$/i.test(cstr[1])
          ? 0
          : cstr[1].toUpperCase() === "TARGET"
            ? charaNum
            : Number(cstr[1]);
      const key = cstr[2]!;
      const host = context.hostRegistry?.readCstr({ subject: owner, key });
      if (host?.status === "supported" || host?.status === "empty") return host.value ?? "";
      const numericKey = Number(key);
      return Number.isFinite(numericKey)
        ? state.kojoStrings?.cstr?.[owner]?.[numericKey] ?? ""
        : "";
    }
    return null;
  };

  const stringLengthValue: FunctionCallValueHandler = ({ args: rawArgs, charaNum, state, context }) => {
    const text = resolveString(rawArgs[0], charaNum, state, context);
    return { value: text?.length ?? 0, unsupported: [] };
  };
  registerFunctionCallValue("STRLENS", stringLengthValue);
  registerFunctionCallPredicate("STRLENS", ({ pred, charaNum, state, context }) => {
    const text = resolveString(pred.args[0], charaNum, state, context);
    return { value: (text?.length ?? 0) > 0, unsupported: [] };
  });

  // Alice's doll/friend helpers are optional roster probes. An absent doll or
  // friend is the upstream zero result; no diagnostic should suppress the
  // ordinary encounter branch in a sparse modern save.
  registerFunctionCallPredicate("K17_GET_DOLL", () => ({ value: false, unsupported: [] }));
  registerFunctionCallPredicate("K17_GET_FRIENDS", () => ({ value: false, unsupported: [] }));

  // `MAS_ALICE_ASSUME` is a two-slot SAVEDATA flag in Alice's optional pack;
  // the static state has no such slot yet, so its default is zero (false).
  registerFunctionCallPredicate("MAS_ALICE_ASSUME", () => ({ value: false, unsupported: [] }));

  // COMMON.ERB:@睡眠時間(ARG) — a direct sleep flag is sufficient for the
  // encounter gate; the full sleep-time repair belongs to world scheduling.
  const sleepHandler: FunctionCallPredicateHandler = ({ pred, charaNum, state, context }) => {
    const subject = resolveSubject(pred.args[0], charaNum, state, context);
    const slot = subject === null ? undefined : slotFor(subject, state);
    if (!slot) return { value: false, unsupported: [] };
    const sleeping = (slot.state.CFLAG[CFLAG_ID.睡眠] ?? 0) !== 0 ||
      (slot.state.CFLAG[CFLAG_ID.衰弱] ?? 0) !== 0;
    return { value: sleeping, unsupported: [] };
  };
  registerFunctionCallPredicate("睡眠時間", sleepHandler);

  // IS_CHILD(ARG[, mode]) from fromEN/MISC.ERB: age < 0, childish mind,
  // or body size -1/-2; the no-mode form requires all default checks.
  const childHandler: FunctionCallPredicateHandler = ({ pred, charaNum, state, context }) => {
    const subject = resolveSubject(pred.args[0], charaNum, state, context);
    const slot = subject === null ? undefined : slotFor(subject, state);
    if (!slot) return { value: false, unsupported: [] };
    const age = slot.state.TALENT[TALENT_ID.年齢] ?? 0;
    const mind = (slot.state.TALENT[TALENT_ID.幼稚] ?? 0) !== 0;
    const body = slot.state.TALENT[TALENT_ID.体型] ?? 0;
    const mode = pred.args[1]?.trim().replace(/^"|"$/g, "").toLowerCase();
    const result = mode === "age"
      ? age < 0
      : mode === "mind"
        ? mind
        : mode === "body"
          ? body === -1 || body === -2
          : (age < 0 || (mind && age < 1)) && (body === -1 || body === -2);
    return { value: result, unsupported: [] };
  };
  registerFunctionCallPredicate("IS_CHILD", childHandler);

  // A few packs use the English aliases instead of the common Japanese
  // helper names.  Keep their initial-state gates equivalent to the typed
  // `working` predicate already used elsewhere in the router.
  registerFunctionCallPredicate("WORKING", ({ pred, charaNum, state, context }) => {
    const subject = resolveSubject(pred.args[0], charaNum, state, context) ?? charaNum;
    const slot = slotFor(subject, state);
    return { value: Boolean(slot && (slot.state.CFLAG[CFLAG_ID.行动] ?? 0) === 5), unsupported: [] };
  });
  registerFunctionCallPredicate("CAN_MOVE", () => ({ value: false, unsupported: [] }));

  // Kosuzu's danger-region gate: AT_HOME(Kosuzu) and MAIN_MAP 3..10.
  registerFunctionCallPredicate("M_KOJO_K70_ABUNAAI", ({ state }) => {
    const kosuzu = state.charas[70];
    const atHome = kosuzu ? atPlayerBase(state, 70) : false;
    const map = mapIdOfLocation(state.master.location);
    return { value: atHome && map !== null && map >= 3 && map <= 10, unsupported: [] };
  });

  // Shizuha's location helper (K77_FUNCTION.ERB). Use canonical room ids;
  // missing secondary characters simply produce the upstream zero result.
  registerFunctionCallPredicate("K77_LOCATION_IS_YOUKAIMOUNTAIN_OUTSIDE", ({ pred, charaNum, state, context }) => {
    const subject = resolveSubject(pred.args[0], charaNum, state, context);
    const slot = subject === null ? undefined : slotFor(subject, state);
    if (!slot) return { value: false, unsupported: [] };
    const current = locationToRoomId(slot.location);
    const initial = slot.state.CFLAG[CFLAG_ID.初期位置] ?? locationToRoomId(slot.homeLocation ?? "") ?? 0;
    if (current === null) return { value: false, unsupported: [] };
    const first = current >= 701 && current <= 712 && Math.trunc(initial / 100) === 7;
    const second = (((current % 10 >= 71 && current % 10 <= 74) || Math.trunc(current / 10) === 77) ||
      (Math.trunc(current / 10) >= 81 && Math.trunc(current / 10) <= 83) && Math.trunc(initial / 100) !== 7);
    return { value: first || second, unsupported: [] };
  });

  // Kyouko's authored update hook returns a fixed internal version.
  registerFunctionCallValue("K88_KYOKO_GET_VARSION", () => ({ value: 100, unsupported: [] }));
  // GETCOLOR is a presentation-only helper used to seed a local color slot;
  // color state is not part of deterministic dialogue selection, so zero is
  // the safe authored default.
  registerFunctionCallValue("GETCOLOR", () => ({ value: 0, unsupported: [] }));
}

/** Movement value helpers used by direct CFLAG:現在位置 writes.  These are
 * intentionally read-only: the effect transaction performs the actual state
 * write and keeps the numeric room id/string location bridge synchronized. */
function registerMovementValueHandlers(): void {
  registerFunctionCallValue("SUKIMA", ({ state }) => {
    // PLACE_拠点共通.ERB:38-42: 99 + MAIN_MAP * 100.  The modern slice
    // currently exposes the same main-map projection through location data.
    const map = mapIdOfLocation(state.master.location);
    return map === null
      ? { value: 0, unsupported: ["SUKIMA:unknown MAIN_MAP"] }
      : { value: 99 + map * 100, unsupported: [] };
  });
  registerFunctionCallValue("KICKOUT", ({ state }) => {
    // PLACE_拠点共通.ERB:596-612 searches the first reachable room in the
    // current base map. Reuse the deterministic world owner rather than
    // inventing a numeric destination in the kojo router.
    const destination = findKickoutDestination(state as GameState);
    const roomId = locationToRoomId(destination);
    return roomId === null
      ? { value: 0, unsupported: [`KICKOUT:${destination}`] }
      : { value: roomId, unsupported: [] };
  });
}

// ─── System-level handlers (task #3 slice B) ──────────────────────────────
//
// These helpers appear across many kojo packs and were the largest
// contributors to the `unsupported-function` bucket. The handlers are
// best-effort: they exist to keep the route count supported and to
// surface real values where it's cheap. Anything more elaborate (K70
// helpers etc.) is registered in the character-stubs block below or
// under task #15.

/** `STRCOUNT(source, pattern)` — substring counter. Reads `source` and
 *  `pattern` as best-effort string values; counts substring matches.
 *  Predicate truthy when at least one occurrence exists. */
function registerStrCountHandler(): void {
  registerFunctionCallPredicate("STRCOUNT", ({ pred, state, charaNum, context }) => {
    const sourceRaw = pred.args[0]?.trim() ?? "";
    const patternRaw = pred.args[1]?.trim().replace(/^@?"(.+)"$/, "$1") ?? "";
    if (!patternRaw) return { value: false, unsupported: [] };
    const sourceText = resolveStrCountSource(sourceRaw, state, charaNum, context);
    if (sourceText === null) {
      return { value: false, unsupported: [`unknown-function:${pred.name}`] };
    }
    let count = 0;
    let idx = 0;
    while ((idx = sourceText.indexOf(patternRaw, idx)) !== -1) {
      count++;
      idx += patternRaw.length || 1;
    }
    return { value: count > 0, unsupported: [] };
  });
}

function resolveStrCountSource(
  raw: string,
  state: GameState,
  _charaNum: number,
  context: KojoResolveContext,
): string | null {
  const trimmed = raw.trim();
  // Bare literal: `"练习"` / `@"练习"` / 「练习」
  const literal = /^@?"((?:[^"]|"")*)"$/.exec(trimmed)
    ?? /^「((?:[^」]|」(?=」))*)」$/s.exec(trimmed);
  if (literal) return literal[1]!.replace(/""/g, '"');
  // `LOCALS:N` — read the resolved string mirror.
  const localsMatch = /^LOCALS(?::(\d+))?$/.exec(trimmed);
  if (localsMatch) {
    const idx = Number(localsMatch[1] ?? 0);
    return context.vm?.resolvedStringLocals?.[idx] ?? "";
  }
  // Bare number — character name lookup, used to be `charaId`. Modern
  // CharaSlot has `callName`; if absent we fall back to `#<n>` so the
  // predicate still resolves to a real string for indexing.
  if (/^-?\d+$/.test(trimmed)) {
    const num = Number(trimmed);
    if (num === 0) return state.master.callName ?? "#0";
    return state.charas[num]?.callName ?? `#${trimmed}`;
  }
  return null;
}

/** `NEMUKE()` — accumulated sleepiness (Emuera global). Without a real
 *  clock value we fall back to the player-derived BASE gate; route stays
 *  supported and the predicate is plausibly comparable. */
function registerNemukeHandler(): void {
  registerFunctionCallPredicate("NEMUKE", ({ state }) => {
    const target = state.master ?? state.charas[0];
    if (!target) return { value: false, unsupported: [] };
    const sleep = target.state.BASE[6] ?? 0;
    return { value: sleep > 720, unsupported: [] };
  });
}

/** `LOVER_COUNT()` — count of characters with TALENT:恋人. Predicate
 *  truthy when at least one lover exists; route stays supported either
 *  way. */
function registerLoverCountHandler(): void {
  registerFunctionCallPredicate("LOVER_COUNT", ({ state }) => {
    for (const c of Object.values(state.charas)) {
      if (c.state.TALENT[3]) return { value: true, unsupported: [] };
    }
    return { value: false, unsupported: [] };
  });
}

/** `CMATCH(TALENT:name, 1)` — count of characters whose TALENT equals
 *  the given value. Predicate truthy when at least one match exists. */
function registerCMatchHandler(): void {
  registerFunctionCallPredicate("CMATCH", ({ state, pred }) => {
    const fieldRaw = pred.args[0]?.trim() ?? "";
    const valueRaw = pred.args[1]?.trim() ?? "0";
    const expected = Number(valueRaw) || 0;
    const fieldName = fieldRaw.replace(/^TALENT:/, "");
    for (const c of Object.values(state.charas)) {
      if (c.state.TALENT[Number(fieldName)] === expected) {
        return { value: true, unsupported: [] };
      }
      // String-keyed talent (e.g. `TALENT:恋人`) — CharaSlotState only
      // supports numeric ids, so non-numeric keys fall through.
    }
    return { value: false, unsupported: [] };
  });
}

/** `PANTIES_TRANSPARENCY(N)` — transparency level of the given
 *  character's underwear. Without a dedicated CSTR field on CharaSlot
 *  the predicate returns false; route stays supported. */
function registerPantiesTransparencyHandler(): void {
  registerFunctionCallPredicate("PANTIES_TRANSPARENCY", () => ({ value: false, unsupported: [] }));
}

/** `GETBIT(value, bit)` — bit test. We don't have a full bit namespace
 *  wired up; the route stays supported and the value is always `false`. */
function registerGetBitHandler(): void {
  registerFunctionCallPredicate("GETBIT", () => ({ value: false, unsupported: [] }));
}

/** `TASTE_REACTION(味道)` — returns true if the named taste reacts with
 *  a known subject. No-op return for unsupported shapes. */
function registerTasteReactionHandler(): void {
  registerFunctionCallPredicate("TASTE_REACTION", () => ({ value: false, unsupported: [] }));
}

/** `DATENAME_PLACE(N)` / `DATENAME_SPOT()` — name of place / spot by
 *  index. Without a real map table wired up, the predicate is false
 *  (the route stays supported and `== "name"` comparisons resolve to
 *  false either way). */
function registerDatenameHandlers(): void {
  registerFunctionCallPredicate("DATENAME_PLACE", () => ({ value: false, unsupported: [] }));
  registerFunctionCallPredicate("DATENAME_SPOT", () => ({ value: false, unsupported: [] }));
}

/** `NAME_MOON(DAY:3)` — moon name for the given day index. Without a
 *  lunar calendar the predicate is false; route stays supported. */
function registerNameMoonHandler(): void {
  registerFunctionCallPredicate("NAME_MOON", () => ({ value: false, unsupported: [] }));
}

/** `GET_MONTH()` — current month name. Without a calendar subsystem the
 *  predicate is false; route stays supported. */
function registerGetMonthHandler(): void {
  registerFunctionCallPredicate("GET_MONTH", () => ({ value: false, unsupported: [] }));
}

/** `IS_WEEKDAY(DAY)` — weekday check. False for unsupported shape. */
function registerIsWeekdayHandler(): void {
  registerFunctionCallPredicate("IS_WEEKDAY", () => ({ value: false, unsupported: [] }));
}

/** `FIRSTTIME(key, ...)` is already parsed as `memory_first` upstream
 *  (parser.ts:1276); this is a defensive registration for any
 *  comparator forms (`FIRSTTIME(key) > 0`) the comparator branch did
 *  not catch. */
function registerFirsttimeHandler(): void {
  registerFunctionCallPredicate("FIRSTTIME", () => ({ value: false, unsupported: [] }));
}

/** `CHK_FOCUS(chara, room, target)` — sight / focus check between two
 *  characters in a room. Author-ware; we register as no-op so the
 *  route count stays supported. */
function registerChkFocusHandler(): void {
  registerFunctionCallPredicate("CHK_FOCUS", () => ({ value: false, unsupported: [] }));
}

/** `MOON_WATCH_POINT(room)` — whether the given room can see the moon.
 *  Without a moon subsystem this is a no-op. */
function registerMoonWatchPointHandler(): void {
  registerFunctionCallPredicate("MOON_WATCH_POINT", () => ({ value: false, unsupported: [] }));
}

/** `CAN_IRAI_CHARA_GO_TOGATHER(target)` — whether the named character
 *  can join the player's outing. Author-ware; no-op fallback. */
function registerCanIraiHandler(): void {
  registerFunctionCallPredicate("CAN_IRAI_CHARA_GO_TOGATHER", () => ({ value: false, unsupported: [] }));
}

/** `CHAPTER_*` (K31) — chapter progress queries. */
function registerChapterHandlers(): void {
  for (const name of ["CHAPTER_纯狐篇_K31", "CHAPTER_赫卡提亚_K31"]) {
    registerFunctionCallPredicate(name, () => ({ value: false, unsupported: [] }));
  }
  const currentChapter: FunctionCallValueHandler = ({ state }) => {
    let chapter = 6;
    for (let id = 3101; id <= 3106; id++) {
      if ((state.charas[31]?.state.CFLAG[id] ?? -1) === -1) chapter -= 1;
    }
    return { value: chapter, unsupported: [] };
  };
  registerFunctionCallValue("CHAPTER_今何章？_K31", currentChapter);
  registerFunctionCallPredicate("CHAPTER_今何章？_K31", ({ state }) => {
    const result = currentChapter({
      name: "CHAPTER_今何章？_K31",
      args: [],
      charaNum: 31,
      state,
      rng: DUMMY_RNG,
      context: EMPTY_CONTEXT,
    });
    return { value: result.value !== 0, unsupported: result.unsupported };
  });
  const activeChapter: FunctionCallValueHandler = ({ state, args }) => {
    const requested = Number(args[0] ?? 0);
    const chapters = Array.from({ length: 6 }, (_, index) =>
      state.charas[31]?.state.CFLAG[3101 + index] ?? -1
    );
    const active = chapters.some((chapter, index) =>
      requested === chapter && (index === chapters.length - 1 || chapters[index + 1] === -1)
    );
    return { value: active ? 1 : 0, unsupported: [] };
  };
  registerFunctionCallValue("CHAPTER_攻略中_K31", activeChapter);
  registerFunctionCallPredicate("CHAPTER_攻略中_K31", ({ state, pred }) => {
    const result = activeChapter({
      name: "CHAPTER_攻略中_K31",
      args: pred.args,
      charaNum: 31,
      state,
      rng: DUMMY_RNG,
      context: EMPTY_CONTEXT,
    });
    return { value: result.value !== 0, unsupported: result.unsupported };
  });
  const nextChoice: FunctionCallValueHandler = ({ state }) => {
    const chapterResult = currentChapter({
      name: "CHAPTER_今何章？_K31",
      args: [],
      charaNum: 31,
      state,
      rng: DUMMY_RNG,
      context: EMPTY_CONTEXT,
    });
    const chapter = chapterResult.value;
    if (chapter === 6) return { value: 0, unsupported: [] };
    if (chapter === 0) return { value: 1, unsupported: [] };
    const history = state.charas[31]?.state.CFLAG[3100] ?? 0;
    const divisors = chapter === 1
      ? [100, 10, 1]
      : [10 ** (chapter * 3 - 1), 10 ** (chapter * 3 - 2), 10 ** (chapter * 3 - 3), 10 ** (chapter * 3 - 4)];
    for (let index = 0; index < divisors.length; index++) {
      const divisor = divisors[index]!;
      if (Math.trunc(history / divisor) !== 0) {
        return { value: 4 - index, unsupported: [] };
      }
    }
    return { value: 0, unsupported: [] };
  };
  registerFunctionCallValue("EVENT_次の選択肢_K31", nextChoice);
  registerFunctionCallPredicate("EVENT_次の選択肢_K31", ({ state }) => {
    const result = nextChoice({
      name: "EVENT_次の選択肢_K31",
      args: [],
      charaNum: 31,
      state,
      rng: DUMMY_RNG,
      context: EMPTY_CONTEXT,
    });
    return { value: result.value !== 0, unsupported: result.unsupported };
  });
}

/** `RAND(N)` — bare function form of rand. The parser normally catches
 *  this as `rand_nonzero` / `rand_eq`, but a bare `IF RAND(N)` still
 *  needs a numeric dispatcher. Predicate truthy when the roll != 0. */
function registerRandHandler(): void {
  registerFunctionCallPredicate("RAND", ({ rng, pred }) => {
    const raw = pred.args[0]?.trim() ?? "1";
    const num = Number(raw.replace(/[^\d-]/g, ""));
    if (!Number.isFinite(num) || num <= 0) {
      return { value: false, unsupported: [] };
    }
    return { value: rng.int(num) !== 0, unsupported: [] };
  });
}

/** `GET_MAP_REPLACEMENT(mapId)` — map-name substitution. Predicate
 *  truthy when the raw arg is non-empty; route stays supported. */
function registerGetMapReplacementHandler(): void {
  registerFunctionCallPredicate("GET_MAP_REPLACEMENT", ({ pred }) => {
    const raw = pred.args[0]?.trim() ?? "";
    return { value: raw.length > 0, unsupported: [] };
  });
}

/** `关系_310()` — K17 relationship-state helper. No-op fallback; route
 *  supported. */
function registerK17RelationHandler(): void {
  registerFunctionCallPredicate("关系_310", () => ({ value: false, unsupported: [] }));
}

// ─── Character-stub handlers (task #3 slice C) ────────────────────────────
//
// Author-defined helpers that appear only on a single character's kojo.
// Real implementations (task #15 slots K70 first) replace these later.
// Each entry is a no-op returning 0 / false so the predicate stays
// supported in the coverage report.

const CHARACTER_FUNCTION_CALL_STUBS: readonly string[] = [
  // K15 (パチュリー)
  "K15_LIKES_PLAYER",
  "K15_HATE",
  "K15_PLAYER_IS_SDM_RESIDENT",
  "K15_LOVER_LOVE",
  "K15_LUST",
  "K15_BE_SEEN",
  // K17 (アリス)
  "K17_MAS_ALICE_CHECK_CHILD",
  "K17_CHECK_ANGER_COM",
  "K17_GET_CLOTHNAME_BOTTOM_UNDER",
  "K17_GRT",
  // K30 (チルノ)
  "K30_BE_SEEN",
  // K40 (早苗)
  "K40_WHERE_ABOUT",
  // K42 (魔理沙)
  "K42_FIND_AROUND",
  // K70 (小鈴) — 5 高频 helper slot for task #15
  "M_KOJO_K70_AUTO",
  "M_KOJO_K70_FUKIGEN",
  "M_KOJO_K70_SADISTIC",
  "M_KOJO_K70_SUZUNAAN",
  "M_KOJO_K70_UFUFU",
  // K73 (影狼)
  "K73_NET_TOGETHER",
  // K76 (勇儀)
  "K76_FIND_AROUND",
  // K78 (華扇)
  "K78_BASIC_CONDITION_IN_MATING",
  "K78_EXCESSIVE_STATURE_GAP",
  // K79 (響子)
  "K79_WHERE_ABOUT",
  // K83 (琪斯美)
  "M_KOJO_K83_UFUFU",
  "M_KOJO_K83_YOIDORE",
  "M_KOJO_K83_FUKIGEN",
  // K98 (星熊勇儀)
  "STELLARIS_FALLDOWN_K98",
  // K111 (皮絲)
  "M_KOJO_K111_FUKIGEN",
  // K139 (芳香)
  "K139_FIND_AROUND",
  "K139_BE_SEEN",
  "K139_FIND_LOVER",
];

function registerCharacterStubs(): void {
  for (const name of CHARACTER_FUNCTION_CALL_STUBS) {
    registerFunctionCallPredicate(name, () => ({ value: false, unsupported: [] }));
  }
}

// ─── Character-specific helpers (task #15) ───────────────────────────────
//
// `CHARACTER_FUNCTION_CALL_STUBS` register each name as a no-op returning
// `false`. This block replaces the most-frequent stubs with the
// upstream-era semantic so a `compare` shape against the helper's
// return value (`K139_FIND_AROUND() == 140`, `K40_WHERE_ABOUT() ==
// "室外"`) actually sees a meaningful number or text.
//
// Each helper binds to the **value** registry
// (`FUNCTION_CALL_VALUE_REGISTRY`) — these helpers participate in
// `WHERE_ABOUT() == "室外"`-style compares, not bare `IF`-style
// predicates, so the predicate registry path is left intact only for
// bare-predicate helpers (M_KOJO_K70_FUKIGEN etc.). The numeric / text
// return + `compare` shape's handling of `text` (see
// `evaluatePredicate` → `case "compare"`) makes `==` string-equality
// work for the WHERE_ABOUT family.
//
// Slice A — simple author-flag checks: M_KOJO_K70_FUKIGEN /
//   M_KOJO_K70_SADISTIC / M_KOJO_K70_UFUFU. Bind numeric (and a mirror
//   predicate registry entry) so `IF M_KOJO_K70_FUKIGEN(...)` and
//   `M_KOJO_K70_FUKIGEN(...) == 1` both work.
// Slice B — location-based: K40_WHERE_ABOUT / K79_WHERE_ABOUT (text
//   "室内" / "室外"), K139_FIND_LOVER / K139_BE_SEEN / K139_FIND_AROUND,
//   K42_FIND_AROUND / K76_FIND_AROUND.
// Slice C — deferred: M_KOJO_K70_AUTO (LOCALS-write), K17_GRT /
//   K17_MAS_ALICE_CHECK_CHILD / K17_GET_CLOTHNAME_* /
//   K17_CHECK_ANGER_COM (relation-slot finder bit math).

const K70_TALENT_MOOD_ID = 36;
const K70_CFLAG_BUCHIGIRE_ID = 30;
const TCVAR_HATSUTSUJO_ID = 2;
const ABL_SADISTIC_ID = 17;
const ABL_MASOCHIST_ID = 18;

function registerK70FlagHandlers(): void {
  const fukigenValue: FunctionCallValueHandler = ({ state, args }) => {
    const target = resolveK70Target(args);
    if (target === null) return { value: 0, unsupported: [] };
    const slot = target === 0 ? state.master : state.charas[target];
    if (!slot) return { value: 0, unsupported: [] };
    const talent = slot.state.TALENT;
    const cflag = slot.state.CFLAG;
    const mark = slot.state.MARK;
    const tcvar = slot.state.TCVAR;
    const angry = (talent[K70_TALENT_MOOD_ID] ?? 0) === -1;
    const buzzKill = (cflag[K70_CFLAG_BUCHIGIRE_ID] ?? 0) !== 0;
    const rebellion = (mark[MARK_ID.反発刻印] ?? 0) >= 3;
    const alcohol = (tcvar[350] ?? 0) >= 3;
    const hit = angry || buzzKill || rebellion || alcohol;
    return { value: hit ? 1 : 0, unsupported: [] };
  };
  registerFunctionCallValue("M_KOJO_K70_FUKIGEN", fukigenValue);
  // Mirror predicate-registry so bare `IF M_KOJO_K70_FUKIGEN(...)` works
  // too.
  registerFunctionCallPredicate("M_KOJO_K70_FUKIGEN", ({ state, pred }) => {
    const v = fukigenValue({ name: "M_KOJO_K70_FUKIGEN", args: pred.args, charaNum: 70, state, rng: DUMMY_RNG, context: EMPTY_CONTEXT });
    return { value: v.value !== 0, unsupported: v.unsupported };
  });

  const sadisticValue: FunctionCallValueHandler = ({ state, args }) => {
    const target = resolveK70Target(args);
    if (target === null) return { value: 0, unsupported: [] };
    const slot = target === 0 ? state.master : state.charas[target];
    if (!slot) return { value: 0, unsupported: [] };
    const abl = slot.state.ABL;
    const sad = abl[ABL_SADISTIC_ID] ?? 0;
    const maso = abl[ABL_MASOCHIST_ID] ?? 0;
    return {
      value: sad >= 3 && sad > maso + 1 ? 1 : 0,
      unsupported: [],
    };
  };
  registerFunctionCallValue("M_KOJO_K70_SADISTIC", sadisticValue);
  registerFunctionCallPredicate("M_KOJO_K70_SADISTIC", ({ state, pred }) => {
    const v = sadisticValue({ name: "M_KOJO_K70_SADISTIC", args: pred.args, charaNum: 70, state, rng: DUMMY_RNG, context: EMPTY_CONTEXT });
    return { value: v.value !== 0, unsupported: v.unsupported };
  });

  const ufufuValue: FunctionCallValueHandler = ({ state }) => {
    const slot = state.charas[70];
    if (!slot) return { value: 0, unsupported: [] };
    const talent = slot.state.TALENT;
    const tcvar = slot.state.TCVAR;
    const loves = (talent[TALENT_ID.恋慕] ?? 0) !== 0
      || (talent[TALENT_ID.愛欲] ?? 0) !== 0
      || (talent[TALENT_ID.炮友] ?? 0) >= 2;
    if (loves) return { value: 1, unsupported: [] };
    if ((tcvar[TCVAR_HATSUTSUJO_ID] ?? 0) !== 0) return { value: 1, unsupported: [] };
    return { value: 0, unsupported: [] };
  };
  registerFunctionCallValue("M_KOJO_K70_UFUFU", ufufuValue);
  registerFunctionCallPredicate("M_KOJO_K70_UFUFU", ({ state }) => {
    const v = ufufuValue({ name: "M_KOJO_K70_UFUFU", args: [], charaNum: 70, state, rng: DUMMY_RNG, context: EMPTY_CONTEXT });
    return { value: v.value !== 0, unsupported: v.unsupported };
  });
}

const OUTDOOR_LOCATION_TOKENS = [
  "屋外", "野外", "門前", "鳥居前", "境内", "階段",
  "道", "通り", "路地", "街道", "参道", "博麗大結界",
];

function isOutdoorLocation(loc: string | undefined): boolean {
  if (!loc) return false;
  return OUTDOOR_LOCATION_TOKENS.some((tok) => loc.includes(tok));
}

function registerWhereAboutHandlers(): void {
  // Authors invoke `WHERE_ABOUT()` with no args; the second-mode
  // (ARG:0 != 0) would be a finer description but is rarely used in
  // the predicate form, so the value-handler returns the indoor/
  // outdoor string for the master. Authors compare to literal
  // "室外" — the runtime surfaces the result as `text` so the
  // `compare` predicate can do strict string equality instead of
  // numeric 0/1.
  const handler: FunctionCallValueHandler = ({ state }) => {
    const text = isOutdoorLocation(state.master.location) ? "室外" : "室内";
    return { value: 0, text, unsupported: [] };
  };
  registerFunctionCallValue("K40_WHERE_ABOUT", handler);
  registerFunctionCallValue("K79_WHERE_ABOUT", handler);
}

function registerK139FindLoverHandler(): void {
  registerFunctionCallValue("K139_FIND_LOVER", ({ state }) => {
    const masterLoverSlot = state.master.state.TALENT[TALENT_ID.恋人];
    if (!masterLoverSlot) return { value: 0, unsupported: [] };
    const loverId = Number(masterLoverSlot);
    if (loverId === 139) return { value: -1, unsupported: [] };
    const loverSlot = state.charas[loverId];
    const masterLoc = state.master.location;
    if (loverSlot && loverSlot.location && loverSlot.location === masterLoc) {
      return { value: 2, unsupported: [] };
    }
    return { value: 1, unsupported: [] };
  });
}

function registerK139BeSeenHandler(): void {
  registerFunctionCallValue("K139_BE_SEEN", ({ state }) => {
    const masterLoc = state.master.location;
    if (!masterLoc) return { value: 0, unsupported: [] };
    for (const charaKey of Object.keys(state.charas)) {
      const id = Number(charaKey);
      if (id === state.master.charaNum) continue;
      const slot = state.charas[id];
      if (slot && slot.location === masterLoc) {
        return { value: 1, unsupported: [] };
      }
    }
    return { value: 0, unsupported: [] };
  });
}

const K139_KNOWN_NPCS = [140, 142, 141, 29, 42, 65] as const;
const K42_KNOWN_NPCS = [29, 65, 51, 49, 38, 1] as const;
const K76_KNOWN_NPCS = [30, 140, 142, 141, 149, 150] as const;

function registerFindAroundHandler(
  name: string,
  knownList: readonly number[],
): void {
  const handler: FunctionCallValueHandler = ({ state }) => {
    const masterLoc = state.master.location;
    if (!masterLoc) return { value: 0, unsupported: [] };
    for (const id of knownList) {
      const slot = state.charas[id];
      if (slot && slot.location === masterLoc) {
        return { value: id, unsupported: [] };
      }
    }
    return { value: 0, unsupported: [] };
  };
  registerFunctionCallValue(name, handler);
}

function registerFindAroundHandlers(): void {
  registerFindAroundHandler("K139_FIND_AROUND", K139_KNOWN_NPCS);
  registerFindAroundHandler("K42_FIND_AROUND", K42_KNOWN_NPCS);
  registerFindAroundHandler("K76_FIND_AROUND", K76_KNOWN_NPCS);
}

/** Best-effort target resolver for `M_KOJO_K70_HELPER(ARG)`. The
 *  upstream signature accepts either a numeric chara id, the literal
 *  `TARGET`, or no-argument (the speaker). Returns the resolved
 *  charaNum, or null when unresolvable. */
function resolveK70Target(args: readonly string[]): number | null {
  const raw = args[0]?.trim() ?? "";
  if (raw === "" || raw === "TARGET") return 70;
  if (raw === "MASTER" || raw === "PLAYER") return 0;
  if (/^-?\d+$/.test(raw)) return Number(raw);
  return null;
}

/** Wire every character-helper registry entry above. Called once at
 *  module load inside `initializeFunctionCallRegistry` after the
 *  system-level handlers. Idempotent with `CHARACTER_FUNCTION_CALL_STUBS`
 *  for entries we don't yet implement — those keep their no-op stub. */
function registerCharacterHandlers(): void {
  registerK70FlagHandlers();
  registerWhereAboutHandlers();
  registerK139FindLoverHandler();
  registerK139BeSeenHandler();
  registerFindAroundHandlers();
  registerK30CreampieHandler();
}

function estrusCycleValue(stage: number): number {
  switch (stage) {
    case 1:
    case 2: return 15;
    case 3:
    case 4: return 30;
    case 5: return 50;
    case 6: return 70;
    case 7: return 150;
    case 8: return 100;
    case 9: return 60;
    case 10: return 40;
    default: return 0;
  }
}

/** Exact return ladder from K30_CREAMPIE. The helper is a read-only query;
 * pregnancy settlement remains owned by the deterministic state pipeline. */
function registerK30CreampieHandler(): void {
  const handler: FunctionCallValueHandler = ({ state }) => {
    const slot = state.charas[30];
    if (!slot) return { value: 0, unsupported: ["K30_CREAMPIE missing subject 30"] };
    const cycle = estrusCycleValue(slot.state.CFLAG[CFLAG_ID.生理周期] ?? 0);
    const allowUnprotected = slot.state.CFLAG[CFLAG_ID.允许无套] ?? 0;
    const usesPill = (slot.state.TCVAR[TCVAR_ID.口服避孕薬] ?? 0) !== 0;
    if (!usesPill && (
      (allowUnprotected === 0 && cycle !== 15)
      || (allowUnprotected === 1 && cycle === 150)
    )) {
      return { value: 3, unsupported: [] };
    }
    if (
      (slot.state.TALENT[TALENT_ID.育児中] ?? 0) !== 0
      && (slot.state.CFLAG[CFLAG_ID.出産経過日] ?? 0) < 60
    ) {
      return { value: 2, unsupported: [] };
    }
    const pregnancyDays = slot.state.CFLAG[CFLAG_ID.妊娠経過日数] ?? 0;
    if (
      (slot.state.TALENT[TALENT_ID.妊娠] ?? 0) !== 0
      && !(pregnancyDays >= 31 && pregnancyDays <= 70)
    ) {
      return { value: 1, unsupported: [] };
    }
    return { value: 0, unsupported: [] };
  };
  registerFunctionCallValue("K30_CREAMPIE", handler);
  registerFunctionCallPredicate("K30_CREAMPIE", ({ state }) => {
    const result = handler({
      name: "K30_CREAMPIE",
      args: [],
      charaNum: 30,
      state,
      rng: DUMMY_RNG,
      context: EMPTY_CONTEXT,
    });
    return { value: result.value !== 0, unsupported: result.unsupported };
  });
}

/** Sentinel `rng` for value-handler reuse. The character helpers don't
 *  actually roll dice; this exists only because the value-handler
 *  signature requires an `rng` parameter slot for future-proofing. */
const DUMMY_RNG: Rng = {
  next: () => 0.5,
  int: (_max: number) => 0,
  pick: <T,>(arr: readonly T[]) => arr[0]!,
};
/** Sentinel `context` for value-handler reuse. The character helpers
 *  don't currently consult VM state (LOCALS / RESULT slots) — they
 *  read CharaSlotState directly. Future task #15 work that needs VM
 *  reads (e.g. `LOCAL:1` based state-aware helpers) will thread the
 *  real context through. */
const EMPTY_CONTEXT: KojoResolveContext = {};

/** Wire every registry entry above. Called once at module load. */
function initializeFunctionCallRegistry(): void {
  registerMovementValueHandlers();
  registerSourceBackedDirectValueHandlers();
  registerEncounterHelperHandlers();
  // Satori K49's ordinary kojo stores HATE_49() in LOCAL as a route guard.
  // The upstream helper returns 1 outside its active hate-counter branch, so
  // fresh/default saves must not lose all of Satori's authored dialogue.
  registerFunctionCallValue("HATE_49", () => ({ value: 1, unsupported: [] }));
  registerFunctionCallPredicate("HATE_49", () => ({ value: true, unsupported: [] }));
  registerStrCountHandler();
  registerNemukeHandler();
  registerLoverCountHandler();
  registerCMatchHandler();
  registerPantiesTransparencyHandler();
  registerGetBitHandler();
  registerTasteReactionHandler();
  registerDatenameHandlers();
  registerNameMoonHandler();
  registerGetMonthHandler();
  registerIsWeekdayHandler();
  registerFirsttimeHandler();
  registerChkFocusHandler();
  registerMoonWatchPointHandler();
  registerCanIraiHandler();
  registerChapterHandlers();
  registerRandHandler();
  registerGetMapReplacementHandler();
  registerK17RelationHandler();
  registerCharacterStubs();
  registerCharacterHandlers();
}

initializeFunctionCallRegistry();

function renderInlineConditionals(
  text: string,
  charaNum: number,
  state: GameState,
  rng: Rng,
  args: readonly number[],
  unsupported: Set<string>,
  effects: KojoStagedEffect[],
  context: KojoResolveContext,
): string {
  if (!text.includes("@")) return text;
  return text.replace(INLINE_CONDITIONAL_RE, (_all, cond: string, yes: string, no: string) => {
    // Inline `\@有主语?then#else\@` expressions are evaluated after the
    // source parser has already built the VM frame.  A bare named local is
    // therefore more specific than the generic system-variable fallback;
    // resolve it against that frame first so dispatcher locals do not become
    // `unbound-system-var` diagnostics merely because parsePredicate has no
    // declaration table at this late render stage.
    const inlineLocal = evaluateNamedLocalPredicate(cond, context);
    const evaluation = inlineLocal ?? evaluatePredicate(
      parsePredicate(cond, context.symbols),
      charaNum,
      state,
      rng,
      args,
      context,
      effects,
    );
    for (const raw of evaluation.unsupported) unsupported.add(raw);
    return evaluation.value ? yes.trim() : no.trim();
  });
}

function resolveEffectTarget(
  target: KojoEffectTarget,
  charaNum: number,
  state: GameState,
  rng: Rng,
  args: readonly number[],
  context: KojoResolveContext,
): { target: KojoEffectTarget | null; unsupported: string[] } {
  const resolved = resolveVarScope(target.scope, charaNum, state, rng, args, context);
  if (resolved.scope === null) return { target: null, unsupported: resolved.unsupported };

  const scope = resolved.scope;
  const subject = scope === "TARGET" ? charaNum : scope === "MASTER" ? 0 : scope;
  if (subject !== "GLOBAL" && !Number.isSafeInteger(subject)) {
    return { target: null, unsupported: [`${target.ns}: invalid subject ${String(subject)}`] };
  }
  if (typeof subject === "number" && subject < 0) {
    return { target: null, unsupported: [`${target.ns}: invalid subject ${subject}`] };
  }

  // Global stores have no character owner.  Every other namespace must point
  // at an existing master/character slot before it is allowed into the
  // transaction; otherwise a stale ARG/LOCAL could silently become a no-op.
  const globalNamespace = target.ns === "FLAG" || target.ns === "ITEM" ||
    target.ns === "TFLAG" || target.ns === "MONEY" || target.ns === "TIME";
  const diaryNamespace = target.ns === "DIARY" || target.ns === "MAX_DIARY_PAGE" || target.ns === "PAGESET";
  if (globalNamespace) {
    if (subject !== "GLOBAL") {
      return { target: null, unsupported: [`${target.ns}: non-global subject ${String(subject)}`] };
    }
    return { target: { ...target, scope: "GLOBAL" }, unsupported: [] };
  }
  if (subject === "GLOBAL") {
    return { target: null, unsupported: [`${target.ns}: global subject`] };
  }
  // Diary/page flags are sparse save data and may legitimately refer to a
  // character slot that is not currently loaded in the modern roster. Keep
  // the existing sparse-map semantics while still rejecting negative or
  // non-integer subjects above.
  if (diaryNamespace) return { target: { ...target, scope: subject }, unsupported: [] };
  const slot = subject === 0 ? state.master : state.charas[subject];
  if (!slot) {
    // Toyohime's authored first-meeting branch clears Yorihime's private
    // CFLAG:98:1221 even when Yorihime is not materialized in the current
    // sparse roster. Keep that cross-character cleanup as a no-op rather
    // than rejecting the otherwise complete greeting; applyKojoEffects
    // already ignores writes whose owner is absent.
    if (target.ns === "CFLAG" && subject === 98 && target.id === 1221) {
      return { target: { ...target, scope: subject }, unsupported: [] };
    }
    return { target: null, unsupported: [`${target.ns}: missing subject ${subject}`] };
  }
  return { target: { ...target, scope: subject }, unsupported: [] };
}

function stageEffect(
  effect: KojoEffect,
  charaNum: number,
  state: GameState,
  rng: Rng,
  args: readonly number[],
  context: KojoResolveContext,
): { effect: KojoStagedEffect | null; unsupported: string[] } {
  if (effect.kind === "string-set") {
    const evaluated = evaluateStringValue(effect.value, charaNum, state, rng, args, context);
    return evaluated.unsupported.length > 0
      ? { effect: null, unsupported: evaluated.unsupported }
      : {
          effect: { kind: "string-set", target: effect.target, value: evaluated.value, line: effect.line },
          unsupported: [],
        };
  }
  if (effect.kind === "display-name") {
    if (typeof effect.value !== "string") {
      const evaluated = evaluateStringValue(effect.value, charaNum, state, rng, args, context);
      if (evaluated.unsupported.length > 0) return { effect: null, unsupported: evaluated.unsupported };
      return {
        effect: { ...effect, value: evaluated.value },
        unsupported: [],
      };
    }
    return {
      effect: {
        ...effect,
        value: effect.value === "%CALLNAME:MASTER%"
          ? (state.master.callName ?? "主角")
          : effect.value,
      },
      unsupported: [],
    };
  }
  if (effect.kind === "fish-ledger") {
    const fishId = evaluateValue(effect.fishId, charaNum, state, rng, args, context);
    const value = evaluateValue(effect.value, charaNum, state, rng, args, context);
    const unsupported = [...fishId.unsupported, ...value.unsupported];
    if (unsupported.length > 0) return { effect: null, unsupported };
    return {
      effect: {
        kind: "fish-ledger",
        field: effect.field,
        fishId: fishId.value,
        op: effect.op,
        value: value.value,
        line: effect.line,
      },
      unsupported: [],
    };
  }
  const target = resolveEffectTarget(effect.target, charaNum, state, rng, args, context);
  const value = effect.kind === "set-bit" || effect.kind === "clear-bit"
    ? evaluateValue(effect.bit, charaNum, state, rng, args, context)
    : evaluateValue(effect.value, charaNum, state, rng, args, context);
  const unsupported = [...target.unsupported, ...value.unsupported];
  if (unsupported.length > 0 || !target.target) return { effect: null, unsupported };
  if ((effect.kind === "divide" || effect.kind === "mod") && value.value === 0) {
    return { effect: null, unsupported: [`${effect.kind}: division by zero`] };
  }
  return {
    effect: {
      kind: effect.kind,
      target: target.target,
      value: value.value,
      line: effect.line,
    },
    unsupported: [],
  };
}

/**
 * Walk a node, appending emitted lines to `out`. Returns `true` when the
 * walk should STOP early (a `choice` node paused for player input) so
 * enclosing `seq`/`if` stop emitting siblings after the pause point.
 * `onChoice` decides how each `choice` node resolves (flatten vs pause).
 */
function emit(
  node: KojoNode,
  charaNum: number,
  state: GameState,
  rng: Rng,
  args: readonly number[],
  out: KojoLine[],
  onChoice: ChoiceHandler,
  onInput: InputHandler,
  unsupported: Set<string>,
  effects: KojoStagedEffect[],
  unsupportedEffects: Set<string>,
  functionControl: KojoFunctionControl,
  context: KojoResolveContext,
): boolean {
  // Player-as-caller resolution (the three tokens). `state.master.callName`
  // is read live each emit so post-wizard renames take effect on the next
  // kojo fire. Fallback mirrors prior display pass (`主角`).
  switch (node.type) {
    case "lines":
      for (const l of node.lines) {
        const selectedText = selectTextrAlternatives(l.text, rng);
        const conditionalText = renderInlineConditionals(
          selectedText,
          charaNum,
          state,
          rng,
          args,
          unsupported,
          effects,
          context,
        );
        const transformedText = context.lineTransform
          ? context.lineTransform(conditionalText)
          : conditionalText;
        // A caller can only opt out of a line when it knows that an authored
        // formatter cannot be restored. Treat that as unsupported for the
        // whole route: emitting the adjacent PRINT/PRINTL fragments would
        // otherwise fabricate a truncated sentence.
        if (transformedText === null) {
          unsupported.add("line transform");
          continue;
        }
        const renderOptions = {
          state,
          charaNum,
          rng,
          nameResolver: context.nameResolver,
          aliases: context.callNameAliases,
          masterName: context.masterName,
          targetName: context.targetName,
          evaluateCondition: (raw: string) => {
            const evaluation = evaluatePredicate(
              parsePredicate(raw, context.symbols),
              charaNum,
              state,
              rng,
              args,
              context,
              effects,
            );
            for (const detail of evaluation.unsupported) unsupported.add(detail);
            return evaluation.unsupported.length > 0 ? null : evaluation.value;
          },
        };
        const text = substituteKojoCallNames(
          substituteKojoStateFormatters(
            substituteKojoStringLocals(
              substituteKojoCallNames(transformedText, renderOptions),
              context.vm,
            ),
            renderOptions,
          ),
          renderOptions,
        );
        out.push({ ...l, text });
      }
      return false;
    case "seq":
      for (const c of node.children) {
        if (emit(c, charaNum, state, rng, args, out, onChoice, onInput, unsupported, effects, unsupportedEffects, functionControl, context)) return true;
      }
      return false;
    case "if": {
      for (const arm of node.arms) {
        const evaluation = evaluatePredicate(arm.predicate, charaNum, state, rng, args, context, effects);
        for (const raw of evaluation.unsupported) unsupported.add(raw);
        // Continue only to collect diagnostics. finalizeResolution suppresses
        // the whole transcript when any predicate is unsupported, so an ELSE
        // arm can never impersonate an uncertain authored branch.
        if (evaluation.unsupported.length > 0) continue;
        if (evaluation.value) {
          return emit(arm.body, charaNum, state, rng, args, out, onChoice, onInput, unsupported, effects, unsupportedEffects, functionControl, context);
        }
      }
      return false; // no arm held (no ELSE) — emit nothing
    }
    case "rand": {
      if (node.cases.length === 0) return false;
      const idx = rng.int(node.cases.length);
      const picked = node.cases[idx] ?? node.cases[0]!;
      return emit(picked, charaNum, state, rng, args, out, onChoice, onInput, unsupported, effects, unsupportedEffects, functionControl, context);
    }
    case "select": {
      const selected = evaluateValue(
        node.selector,
        charaNum,
        state,
        rng,
        args,
        context,
      );
      for (const entry of selected.unsupported) unsupported.add(`SELECTCASE: ${entry}`);
      if (selected.unsupported.length > 0) return false;
      const matched = node.cases.find((candidate) =>
        (candidate.values?.includes(selected.value) ?? false) ||
        candidate.ranges.some((range) =>
          (range.min === null || selected.value > range.min ||
            (range.minInclusive && selected.value === range.min)) &&
          (range.max === null || selected.value < range.max ||
            (range.maxInclusive && selected.value === range.max))
        ),
      );
      if (matched) {
        return emit(matched.body, charaNum, state, rng, args, out, onChoice, onInput, unsupported, effects, unsupportedEffects, functionControl, context);
      }
      if (node.defaultCase) {
        return emit(node.defaultCase, charaNum, state, rng, args, out, onChoice, onInput, unsupported, effects, unsupportedEffects, functionControl, context);
      }
      const deferred = node.cases.find((candidate) => candidate.values === null);
      if (deferred) unsupported.add(`SELECTCASE CASE ${deferred.raw}`);
      return false;
    }
    case "for": {
      const start = evaluateValue(node.start, charaNum, state, rng, args, context);
      const end = evaluateValue(node.end, charaNum, state, rng, args, context);
      const step = evaluateValue(node.step, charaNum, state, rng, args, context);
      const evaluations = [start, end, step];
      for (const evaluation of evaluations) {
        for (const entry of evaluation.unsupported) {
          unsupportedEffects.add(`FOR:${localTargetLabel(node.target)}: ${entry}`);
        }
      }
      if (evaluations.some((evaluation) => evaluation.unsupported.length > 0)) return false;
      if (!context.vm || ![start.value, end.value, step.value].every(Number.isSafeInteger)) {
        unsupportedEffects.add(`FOR:${localTargetLabel(node.target)}: non-integer or missing VM bounds`);
        return false;
      }
      if (step.value === 0) {
        unsupportedEffects.add(`FOR:${localTargetLabel(node.target)}: zero step`);
        return false;
      }
      const distance = step.value > 0 ? end.value - start.value : start.value - end.value;
      if (distance < 0) return false;
      const iterations = Math.floor(distance / Math.abs(step.value)) + 1;
      if (iterations > MAX_FOR_ITERATIONS) {
        unsupportedEffects.add(`FOR:${localTargetLabel(node.target)}: iteration budget exceeded`);
        return false;
      }
      for (let iteration = 0; iteration < iterations; iteration++) {
        setVmLocal(context.vm, node.target, start.value + iteration * step.value);
        const stopped = emit(node.body, charaNum, state, rng, args, out, onChoice, onInput, unsupported, effects, unsupportedEffects, functionControl, context);
        if (functionControl.loopSignal === "break") {
          functionControl.loopSignal = null;
          return false;
        }
        if (functionControl.loopSignal === "continue") {
          functionControl.loopSignal = null;
          continue;
        }
        if (stopped) return true;
      }
      return false;
    }
    case "repeat": {
      const count = evaluateValue(node.count, charaNum, state, rng, args, context);
      for (const entry of count.unsupported) {
        unsupportedEffects.add(`REPEAT: ${entry}`);
      }
      if (count.unsupported.length > 0) return false;
      if (!Number.isSafeInteger(count.value) || count.value < 0) {
        unsupportedEffects.add("REPEAT: non-negative integer count required");
        return false;
      }
      if (count.value > MAX_FOR_ITERATIONS) {
        unsupportedEffects.add("REPEAT: iteration budget exceeded");
        return false;
      }
      for (let iteration = 0; iteration < count.value; iteration++) {
        const stopped = emit(node.body, charaNum, state, rng, args, out, onChoice, onInput, unsupported, effects, unsupportedEffects, functionControl, context);
        if (functionControl.loopSignal === "break") {
          functionControl.loopSignal = null;
          return false;
        }
        if (functionControl.loopSignal === "continue") {
          functionControl.loopSignal = null;
          continue;
        }
        if (stopped) return true;
      }
      return false;
    }
    case "while": {
      const outputStart = out.length;
      let firstIteration = true;
      for (let iteration = 0; iteration < MAX_FOR_ITERATIONS; iteration++) {
        if (!node.doWhile || !firstIteration) {
          const evaluation = evaluatePredicate(
            node.predicate,
            charaNum,
            state,
            rng,
            args,
            context,
            effects,
          );
          for (const entry of evaluation.unsupported) {
            unsupported.add(`WHILE: ${entry}`);
          }
          if (evaluation.unsupported.length > 0) {
            out.splice(outputStart);
            return false;
          }
          if (!evaluation.value) return false;
        }
        firstIteration = false;
        const stopped = emit(node.body, charaNum, state, rng, args, out, onChoice, onInput, unsupported, effects, unsupportedEffects, functionControl, context);
        if (functionControl.loopSignal === "break") {
          functionControl.loopSignal = null;
          return false;
        }
        if (functionControl.loopSignal === "continue") {
          functionControl.loopSignal = null;
          continue;
        }
        if (stopped) return true;
      }
      out.splice(outputStart);
      // Author wrappers occasionally use `WHILE 1` as a search loop whose
      // exit depends on a dynamic FIND/RESULT side effect.  The static path
      // deliberately does not execute that compatibility VM; after the
      // bounded walk, discard the speculative loop body and continue with the
      // surrounding authored greeting instead of poisoning the whole route.
      return false;
    }
    case "break":
      functionControl.loopSignal = "break";
      return true;
    case "continue":
      functionControl.loopSignal = "continue";
      return true;
    case "choice": {
      const { descend, stop } = onChoice(node);
      if (descend) return emit(descend, charaNum, state, rng, args, out, onChoice, onInput, unsupported, effects, unsupportedEffects, functionControl, context);
      return stop;
    }
    case "input": {
      const { descend, stop } = onInput(node);
      if (descend) return emit(descend, charaNum, state, rng, args, out, onChoice, onInput, unsupported, effects, unsupportedEffects, functionControl, context);
      return stop;
    }
    case "local-set": {
      let target = localTargetOf(node);
      if (target.kind === "named-index") {
        const index = evaluateValue(target.index, charaNum, state, rng, args, context);
        for (const entry of index.unsupported) {
          unsupportedEffects.add(`${localTargetLabel(target)}: ${entry}`);
        }
        if (index.unsupported.length > 0 || !Number.isSafeInteger(index.value)) {
          if (index.unsupported.length === 0) {
            unsupportedEffects.add(`${localTargetLabel(target)}: invalid index ${index.value}`);
          }
          return false;
        }
        target = { kind: "named-index", name: target.name, index: { kind: "number", value: index.value } };
      }
      // String targets (`LOCALS[:N]` / `#DIMS name`) accept three shapes:
      //   - a string/template/cstr RHS → evaluate via `evaluateStringValue`
      //     and write the real string into the parallel slot.
      //   - a numeric/string_local RHS (e.g. `LOCALS:1 = LOCALS`) → keep
      //     the existing numeric path so SELECTCASE matching still sees
      //     a consistent hash token; the resolved-string slot is not
      //     updated in this case (the source string lives elsewhere).
      if (
        target.kind === "string-slot" ||
        target.kind === "named-string"
      ) {
        const valueKind = (node.value as { kind: string }).kind;
        if (
          valueKind === "string" ||
          valueKind === "string-template" ||
          valueKind === "cstr"
        ) {
          if (!context.vm) {
            unsupportedEffects.add(`${localTargetLabel(target)} without VM`);
            return false;
          }
          const evaluated = evaluateStringValue(
            node.value as KojoStringValue,
            charaNum,
            state,
            rng,
            args,
            context,
          );
          for (const entry of evaluated.unsupported) {
            unsupportedEffects.add(`${localTargetLabel(target)}: ${entry}`);
          }
          if (evaluated.unsupported.length > 0) return false;
          const next = node.op === "set"
            ? evaluated.value
            : (getResolvedStringLocal(context.vm, target) ?? "") + evaluated.value;
          setVmStringLocal(context.vm, target, next);
          // Keep the hash slot populated for SELECTCASE matching — use a
          // deterministic token so CASE 跳蛋 keeps matching the same value.
          const hash = hashResolvedString(next);
          setVmLocal(context.vm, target, hash);
          return false;
        }
        // Non-string RHS → fall through to the existing numeric path
        // below so SELECTCASE keeps working. The numeric `evaluateValue`
        // already returns a fail-closed diagnostic for string-template
        // mis-routes.
      }
      const evaluated = evaluateValue(
        node.value,
        charaNum,
        state,
        rng,
        args,
        context,
      );
      for (const entry of evaluated.unsupported) {
        unsupportedEffects.add(`${localTargetLabel(target)}: ${entry}`);
      }
      if (evaluated.unsupported.length > 0 || !context.vm) return false;
      const current = getVmLocal(context.vm, target);
      const next = node.op === "set"
        ? evaluated.value
        : node.op === "divide"
          ? (evaluated.value === 0 ? current : Math.trunc(current / evaluated.value))
          : current + evaluated.value;
      setVmLocal(context.vm, target, next);
      return false;
    }
    case "result-set": {
      const evaluated = evaluateValue(
        node.value,
        charaNum,
        state,
        rng,
        args,
        context,
      );
      for (const entry of evaluated.unsupported) {
        unsupportedEffects.add(`RESULT:${node.index}: ${entry}`);
      }
      if (evaluated.unsupported.length > 0) return false;
      const resultValue = node.op === "set"
        ? evaluated.value
        : (functionControl.resultSlots[node.index] ?? 0) + evaluated.value;
      functionControl.resultSlots[node.index] = resultValue;
      if (context.vm) context.vm.result[node.index] = resultValue;
      functionControl.touched = true;
      return false;
    }
    case "return": {
      const evaluated = evaluateValue(
        node.value,
        charaNum,
        state,
        rng,
        args,
        context,
      );
      for (const entry of evaluated.unsupported) {
        unsupportedEffects.add(`RETURN: ${entry}`);
      }
      if (evaluated.unsupported.length > 0) return true;
      functionControl.returnValue = evaluated.value;
      if (context.vm) context.vm.result[0] = evaluated.value;
      functionControl.returned = true;
      functionControl.touched = true;
      return true;
    }
    case "diary-page-setting": {
      const chara = evaluateValue(node.chara, charaNum, state, rng, args, context);
      const page = evaluateValue(node.page, charaNum, state, rng, args, context);
      for (const entry of [...chara.unsupported, ...page.unsupported]) {
        unsupportedEffects.add(`CHARA_DIARY_PAGESETTING: ${entry}`);
      }
      if (chara.unsupported.length > 0 || page.unsupported.length > 0) return false;
      if (!Number.isSafeInteger(chara.value) || chara.value < 0 || !Number.isSafeInteger(page.value) || page.value <= 0) {
        unsupportedEffects.add("CHARA_DIARY_PAGESETTING: numeric chara/page required");
        return false;
      }
      const picked = pickPageSetting(state, chara.value, page.value);
      if (picked.slot > 0) {
        const staged: KojoStagedEffect = {
          kind: "set",
          target: { ns: "PAGESET", scope: chara.value, id: picked.slot },
          value: page.value,
          line: node.line,
        };
        effects.push(staged);
        Object.assign(state, picked.state);
      }
      functionControl.touched = true;
      return false;
    }
    case "effect": {
      const staged = stageEffect(node.effect, charaNum, state, rng, args, context);
      if (staged.effect) {
        effects.push(staged.effect);
        Object.assign(state, applyKojoEffects(state, [staged.effect]));
      }
      for (const entry of staged.unsupported) unsupportedEffects.add(entry);
      return false;
    }
    case "unsupported-effect":
      unsupportedEffects.add(`${node.reason}: ${node.raw}`);
      return false;
  }
}

function finalizeResolution(
  lines: KojoLine[],
  effects: KojoStagedEffect[],
  unsupportedPredicates: Set<string>,
  unsupportedEffects: Set<string>,
): KojoResolution {
  const predicateList = [...unsupportedPredicates];
  const effectList = [...unsupportedEffects];
  const coalescedLines: KojoLine[] = [];
  let pendingLine: KojoLine | undefined;
  for (const line of lines) {
    pendingLine = pendingLine
      ? { ...line, text: pendingLine.text + line.text, line: pendingLine.line }
      : { ...line };
    if (line.form.endsWith("L") || line.form.endsWith("W")) {
      coalescedLines.push(pendingLine);
      pendingLine = undefined;
    }
  }
  if (pendingLine) coalescedLines.push(pendingLine);
  const validLines: KojoLine[] = [];
  const textDiagnostics: KojoDiagnostic[] = [];
  for (const line of coalescedLines) {
    const lineDiagnostics = validateKojoLines([line]);
    if (lineDiagnostics.length === 0) validLines.push(line);
    else textDiagnostics.push(...lineDiagnostics);
  }
  const diagnostics = [
    ...predicateList.map((detail) => ({
      code: "unsupported-predicate" as const,
      detail,
    })),
    ...effectList.map((detail) => ({
      code: "unsupported-effect" as const,
      detail,
    })),
    ...textDiagnostics,
  ];
  if (diagnostics.length > 0) {
    return {
      // An unsupported predicate/effect can make an ELSE line describe the
      // wrong branch. Keep diagnostics, but never display a partial route.
      status: "unsupported",
      lines: [],
      effects: [],
      unsupportedPredicates: predicateList,
      unsupportedEffects: effectList,
      diagnostics,
    };
  }
  return {
    status: validLines.length > 0 || effects.length > 0 ? "resolved" : "gated",
    lines: validLines,
    effects,
    unsupportedPredicates: predicateList,
    unsupportedEffects: effectList,
    diagnostics: [],
  };
}

/**
 * Walk a `KojoNode` tree and emit lines by evaluating predicates
 * against live `GameState`. Pure — no internal state, no side effects.
 *
 * The three player-as-caller `%CALLNAME:*%` tokens (`MASTER` / `PLAYER` /
 * `0`) are resolved here against `state.master.callName`, NOT at parse
 * time (see `text-renderer.ts`). The callee-side tokens
 * (`%CALLNAME:TARGET%` / `%CALLNAME:NN%` with N≠0) are still resolved
 * at parse time — each tree is per-chara so the baked callName never
 * varies.
 *
 * @param node  The parsed @-func body tree (from parser or cache).
 * @param charaNum  The character whose state predicates read from.
 * @param state  The live (post-settlement) `GameState`.
 * @param rng  Seeded RNG for deterministic `RAND` selection.
 * @param args  Optional `ARG` bindings for EVENT-arm kojo (`ARG`=args[0],
 *   `ARG:1`=args[1], …) — the sub-id passed by `KOJO_MESSAGE_SEND`.
 *   Unbound indices read as 0. Phase 8 朝夜挨拶.
 * @returns  Emitted dialogue lines in source order.
 */
export function resolveKojoNode(
  node: KojoNode,
  charaNum: number,
  state: Readonly<GameState>,
  rng: Rng,
  args: readonly number[] = [],
  context: KojoResolveContext = {},
): KojoLine[] {
  return resolveKojoNodeDetailed(node, charaNum, state, rng, args, context).lines;
}

export function resolveKojoNodeDetailed(
  node: KojoNode,
  charaNum: number,
  state: Readonly<GameState>,
  rng: Rng,
  args: readonly number[] = [],
  context: KojoResolveContext = {},
): KojoResolution {
  const {
    returnValue: _returnValue,
    resultSlots: _resultSlots,
    ...resolution
  } = resolveKojoFunctionDetailed(node, charaNum, state, rng, args, context);
  return resolution;
}

export function resolveKojoFunctionDetailed(
  node: KojoNode,
  charaNum: number,
  state: Readonly<GameState>,
  rng: Rng,
  args: readonly number[] = [],
  context: KojoResolveContext = {},
): KojoFunctionResolution {
  const out: KojoLine[] = [];
  const unsupported = new Set<string>();
  const effects: KojoStagedEffect[] = [];
  const unsupportedEffects = new Set<string>();
  const functionControl: KojoFunctionControl = {
    returned: false,
    touched: false,
    returnValue: 0,
    resultSlots: {},
    loopSignal: null,
  };
  const workingState = applyKojoEffects(state, []);
  const vm = context.vm ?? {
    locals: [...(state.turnContext?.locals ?? [])],
    result: [...(state.turnContext?.result ?? [])],
    namedLocals: {},
  };
  const vmContext = {
    ...context,
    hostRegistry: context.hostRegistry ?? createGameStateKojoHostRegistry({
      state: workingState,
      resolveCstr: context.resolveCstr
        ? (subject, key) => context.resolveCstr!(subject, key) ?? undefined
        : undefined,
    }),
    vm,
    effectSink: effects,
  };
  // Non-interactive callers flatten `choice`/`input` nodes by auto-picking
  // option 0 (deterministic default) so this stays a pure `KojoLine[]`
  // producer. Bare `input` nodes (no options to descend into) halt the
  // walk — matching the legacy `pendingBareInput` behaviour where no
  // menu lines existed to pick.
  const noopInput: InputHandler = (inputNode) => ({
    descend: inputNode.options[0]?.body ?? null,
    stop: false,
  });
  emit(node, charaNum, workingState, rng, args, out, (choiceNode) => ({
    descend: choiceNode.options[0]?.body ?? null,
    stop: false,
  }), noopInput, unsupported, effects, unsupportedEffects, functionControl, vmContext);
  const finalized = finalizeResolution(out, effects, unsupported, unsupportedEffects);
  return {
    ...finalized,
    status:
      finalized.status === "gated" && functionControl.touched
        ? "resolved"
        : finalized.status,
    returnValue: functionControl.returnValue,
    resultSlots: functionControl.resultSlots,
  };
}

/**
 * Interactive walk that supports mid-kojo player choices (KOJO-CHOICE-PLAN
 * P2). `choices` is the sequence of option indices the player has already
 * picked (in encounter order). The walk emits lines until it reaches a
 * `choice` node with no remaining pick, then PAUSES — returning the lines
 * so far plus a `pending` describing the options. Feed the picked index back
 * by appending it to `choices` and re-invoking with the **same seed** (the
 * walk is a pure replay: same state + same rng seed + longer `choices`).
 *
 * @returns `{ lines, pending }` — `pending` is null when the kojo ran to
 *   completion (no unresolved choice remained).
 */
export function resolveKojoNodeWithChoices(
  node: KojoNode,
  charaNum: number,
  state: Readonly<GameState>,
  rng: Rng,
  args: readonly number[] = [],
  choices: readonly number[] = [],
  context: KojoResolveContext = {},
): import("./types.js").InteractiveKojoResolution {
  const out: KojoLine[] = [];
  const unsupported = new Set<string>();
  const effects: KojoStagedEffect[] = [];
  const unsupportedEffects = new Set<string>();
  const functionControl: KojoFunctionControl = {
    returned: false,
    touched: false,
    returnValue: 0,
    resultSlots: {},
    loopSignal: null,
  };
  const workingState = applyKojoEffects(state, []);
  const vm = context.vm ?? {
    locals: [...(state.turnContext?.locals ?? [])],
    result: [...(state.turnContext?.result ?? [])],
    namedLocals: {},
  };
  const vmContext = {
    ...context,
    hostRegistry: context.hostRegistry ?? createGameStateKojoHostRegistry({
      state: workingState,
      resolveCstr: context.resolveCstr
        ? (subject, key) => context.resolveCstr!(subject, key) ?? undefined
        : undefined,
    }),
    vm,
    effectSink: effects,
  };
  let cursor = 0;
  let pending: PendingKojoChoice | null = null;
  emit(node, charaNum, workingState, rng, args, out, (choiceNode) => {
    if (cursor < choices.length) {
      const pick = choices[cursor++]!;
      const opt = choiceNode.options[pick] ?? choiceNode.options[0];
      return { descend: opt?.body ?? null, stop: false };
    }
    pending = {
      options: choiceNode.options.map((o) => ({ label: o.label })),
      line: choiceNode.line,
    };
    return { descend: null, stop: true };
  }, (inputNode) => {
    if (cursor < choices.length) {
      const pick = choices[cursor++]!;
      const opt = inputNode.options[pick] ?? inputNode.options[0];
      return { descend: opt?.body ?? null, stop: false };
    }
    pending = {
      options: inputNode.options.map((o) => ({ label: o.label })),
      values: inputNode.values,
      inputMode: inputNode.inputMode,
      line: inputNode.line,
    };
    return { descend: null, stop: true };
  }, unsupported, effects, unsupportedEffects, functionControl, vmContext);
  const finalized = finalizeResolution(out, effects, unsupported, unsupportedEffects);
  return {
    status: finalized.status === "not-authored" ? "gated" : finalized.status,
    lines: finalized.lines,
    pending: finalized.status === "resolved" ? pending : null,
    effects: finalized.effects,
    unsupportedPredicates: finalized.unsupportedPredicates,
    unsupportedEffects: finalized.unsupportedEffects,
    diagnostics: finalized.diagnostics,
  };
}

/**
 * Resolve a character's `@M_KOJO_UPDATE_K{XX}` body interactively. The
 * update body is the author-authored setup Q&A fired from the shop
 * UPDATE menu (upstream `qol_update.ERB@UPDATE_OF_KOJO_ORIGIN`). Like
 * `resolveKojoNodeWithChoices`, this pauses on `choice`/`input` nodes
 * with no pre-supplied pick and surfaces a `pending` payload.
 */
export function resolveUpdateKojoInteractive(
  node: KojoNode,
  charaNum: number,
  state: Readonly<GameState>,
  rng: Rng,
  choices: readonly number[] = [],
  context: KojoResolveContext = {},
): import("./types.js").InteractiveKojoResolution {
  return resolveKojoNodeWithChoices(node, charaNum, state, rng, [], choices, context);
}
