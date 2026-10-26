import type { Rng } from "../command/types.js";
import type { GameState } from "../state/index.js";
import { getTflag } from "../state/tflag.js";
import { showLowerUnderwear } from "../state/clothing.js";
import { createGameStateKojoHostRegistry } from "../kojo/host-registry.js";
import { DEFAULT_KOJO_SYMBOLS, resolveKojoSymbol, type KojoSymbolNamespace, type KojoSymbolTables } from "../kojo/symbol-table.js";
import { bathCheck, chkDateNow, inHome, outRoof } from "../world/location-predicates.js";
import { locationToRoomId, roomIdToLocation } from "../world/room-id-location.js";
import { resolveKojoCharacterReference } from "../kojo/character-references.js";
import type {
  KojoVmExecutionOptions,
  KojoVmNumberSymbolContext,
  KojoVmPrintForm,
  KojoVmStringSymbolContext,
} from "./types.js";

function charaTextForm(mode: string): KojoVmPrintForm {
  switch (mode.trim().toLowerCase()) {
    case "l": return "PRINTFORML";
    case "w": return "PRINTFORMW";
    case "strl": return "PRINTL";
    case "strw": return "PRINTW";
    case "str": return "PRINT";
    default: return "PRINTFORM";
  }
}

const STATE_NAMESPACES = new Set<KojoSymbolNamespace>([
  "TALENT", "CFLAG", "TCVAR", "ABL", "BASE", "MAXBASE", "EXP", "PALAM", "SOURCE", "NOWEX", "EQUIP", "STAIN", "TEQUIP", "MARK", "ITEM",
]);

// These dispatcher sentinels select optional custom-command branches. The
// modern runtime has no custom command registry yet, so it faithfully exposes
// the upstream inactive value rather than making the ordinary COMMAND branch
// indeterminate.
const INACTIVE_CUSTOM_COMMAND_SYMBOLS = new Set([
  "ADD_CUSTOM_SCOM",
  "ADD_CUSTOM_COM",
  "ADD_SELECTED_SCOM",
  "ADD_SELECTCUSTOMCOM",
]);

function numberToken(token: string, context: KojoVmNumberSymbolContext, target: number): number | null {
  let value = token.trim();
  while (value.startsWith("(") && value.endsWith(")")) value = value.slice(1, -1).trim();
  const normalized = value.toUpperCase();
  if (/^-?\d+$/.test(value)) return Number(value);
  if (normalized === "MASTER" || normalized === "PLAYER") return 0;
  if (normalized === "TARGET") return context.numberSymbols.TARGET ?? target;
  const arg = /^ARG(?::(\d+))?$/i.exec(value);
  if (arg) return context.args[Number(arg[1] ?? 0)] ?? 0;
  const local = /^LOCAL(?::(\d+))?$/i.exec(value);
  if (local) return context.locals[Number(local[1] ?? 0)] ?? 0;
  const result = /^RESULT(?::(\d+))?$/i.exec(value);
  if (result) return context.results[Number(result[1] ?? 0)] ?? 0;
  const variable = context.numberVariables[normalized];
  if (variable !== undefined) return variable;
  return null;
}

function splitNamespacePieces(raw: string): string[] {
  const pieces: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < raw.length; index++) {
    const char = raw[index]!;
    if (char === "(") depth++;
    else if (char === ")") depth--;
    else if (char === ":" && depth === 0) {
      pieces.push(raw.slice(start, index).trim());
      start = index + 1;
    }
  }
  pieces.push(raw.slice(start).trim());
  return pieces;
}

function splitCallArguments(raw: string): string[] | null {
  const values: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < raw.length; index++) {
    const char = raw[index]!;
    if (char === "(") depth++;
    else if (char === ")") {
      depth--;
      if (depth < 0) return null;
    } else if (char === "," && depth === 0) {
      values.push(raw.slice(start, index).trim());
      start = index + 1;
    }
  }
  if (depth !== 0) return null;
  values.push(raw.slice(start).trim());
  return values;
}

function memoryCstr(state: Readonly<GameState>, subject: number, key: string): string | undefined {
  const bucket = key === "0"
    ? state.kojoMemory?.[subject]?.firstTime
    : key === "1"
      ? state.kojoMemory?.[subject]?.once
      : undefined;
  if (!bucket) return undefined;
  // Legacy FIRSTTIME/ONCE store slash-delimited CSTR entries. The modern
  // memory key keeps SELECTCOM explicit to prevent collisions with literals.
  const entries = Object.keys(bucket).map((entry) => entry.startsWith("SELECTCOM:") ? entry.slice("SELECTCOM:".length) : entry);
  return entries.length === 0 ? "" : `/${entries.join("/")}/`;
}

/**
 * `CSTR:MASTER:12` used to be the slash-delimited temporary panty list.
 * Upstream now stores the same authority in `PANTS_TEMP`; retain the legacy
 * string view only for authored predicates that have not yet been rewritten.
 */
function pantyCollectionCstr(state: Readonly<GameState>, subject: number, key: string): string | undefined {
  if (subject !== 0 || key !== "12") return undefined;
  const entries: string[] = [];
  for (const [charaRaw, pieces] of Object.entries(state.pantsTemp ?? {})) {
    const charaNum = Number(charaRaw);
    const callName = stateSlot(state, charaNum)?.callName;
    if (!callName) return undefined;
    for (const [pieceRaw, count] of Object.entries(pieces)) {
      for (let index = 0; index < count; index++) entries.push(`${callName}${pieceRaw}`);
    }
  }
  return entries.length === 0 ? "" : `/${entries.join("/")}/`;
}

function resolveCstr(raw: string, context: KojoVmStringSymbolContext, state: Readonly<GameState>, target: number): string | null {
  const match = /^CSTR:(.+)$/i.exec(raw.trim());
  if (!match) return null;
  const pieces = splitNamespacePieces(match[1]);
  if (pieces.length < 2) return null;
  const subject = numberToken(pieces.shift()!, context, target);
  if (subject === null) return null;
  const key = pieces.join(":");
  const memory = memoryCstr(state, subject, key);
  if (memory !== undefined) return memory;
  const pants = pantyCollectionCstr(state, subject, key);
  if (pants !== undefined) return pants;
  const result = createGameStateKojoHostRegistry({ state }).readCstr({ subject, key });
  if (result.status === "supported" || result.status === "empty") return result.value ?? "";
  // These two CSTR slots are the legacy representation of the already
  // modeled FIRSTTIME/ONCE arrays, whose empty state is well-defined.
  return key === "0" || key === "1" ? "" : null;
}

function stateSlot(state: Readonly<GameState>, charaNum: number) {
  return charaNum === 0 ? state.master : state.charas[charaNum];
}

function resolveCallName(raw: string, context: KojoVmStringSymbolContext, state: Readonly<GameState>, target: number): string | null {
  const match = /^CALLNAME:(.+)$/i.exec(raw.trim());
  if (!match) return null;
  const subject = numberToken(match[1]!, context, target);
  if (subject === null) return null;
  return stateSlot(state, subject)?.callName || null;
}

function resolveName(raw: string, context: KojoVmStringSymbolContext, state: Readonly<GameState>, target: number): string | null {
  const name = /^NAME:(.+)$/i.exec(raw.trim());
  if (name) {
    const subject = numberToken(name[1]!, context, target);
    return subject === null ? null : stateSlot(state, subject)?.callName ?? (subject === 0 ? "你" : null);
  }
  const masterName = /^MASTERNAME:(.+)$/i.exec(raw.trim());
  if (!masterName) return null;
  const observer = numberToken(masterName[1]!, context, target);
  if (observer === null || !stateSlot(state, observer)) return null;
  const pending = [...context.writes].reverse().find((write) => "kind" in write && write.kind === "string" && write.target.toUpperCase() === `MASTERNAME:${observer}`);
  return pending && "kind" in pending && pending.kind === "string"
    ? pending.value
    : state.displayNames?.[observer]?.[0] ?? state.master.callName ?? "你";
}

/** Browser-safe `@PANTSNAME` read path. The upstream function is a pure
 * display query over the subject's worn lower underwear; unknown call shapes
 * deliberately remain unresolved instead of guessing a garment name. */
function resolvePantsName(
  raw: string,
  context: KojoVmStringSymbolContext,
  state: Readonly<GameState>,
  target: number,
): string | null {
  const match = /^PANTSNAME\((.*)\)$/i.exec(raw.trim());
  if (!match) return null;
  const callArgs = splitCallArguments(match[1]!);
  if (!callArgs || callArgs.length < 2 || callArgs.length > 3) return null;
  const subject = numberToken(callArgs[1]!, context, target);
  if (subject === null) return null;
  const slot = stateSlot(state, subject);
  if (!slot) return null;
  // PANTSNAME's first parameter is an EQUIP value. We support the canonical
  // lower-underwear source form and reject arbitrary numbers until their
  // clothing category can be proved against the catalog.
  const equip = /^EQUIP:([^:]+):(.+)$/i.exec(callArgs[0]!);
  if (!equip || numberToken(equip[1]!, context, target) !== subject || equip[2] !== "下半身内衣２") return null;
  const withDescriptor = callArgs[2] === undefined ? false : numberToken(callArgs[2], context, target) === 1;
  return showLowerUnderwear(slot, withDescriptor) || null;
}

function resolveOutRoof(
  raw: string,
  context: KojoVmNumberSymbolContext,
  state: Readonly<GameState>,
  target: number,
): number | null {
  const match = /^OUTROOF:(.+)$/i.exec(raw.trim());
  if (!match) return null;
  const namespace = /^CFLAG:(.+)$/i.exec(match[1]!);
  if (!namespace) return null;
  const pieces = splitNamespacePieces(namespace[1]);
  if (pieces.length !== 2 || pieces[1] !== "現在位置") return null;
  const subject = numberToken(pieces[0]!, context, target);
  const slot = subject === null ? undefined : stateSlot(state, subject);
  return slot?.location ? outRoof(state, slot.location) : null;
}

/** The modern state owns a character's current location as a string, while
 * authored ERB reads CFLAG:*:現在位置 as its room id. Expose only canonical
 * reverse mappings; an unbuilt or noncanonical location stays unresolved. */
function resolveCurrentLocation(
  raw: string,
  context: KojoVmNumberSymbolContext,
  state: Readonly<GameState>,
  target: number,
): number | null | undefined {
  const match = /^CFLAG:(.+)$/i.exec(raw.trim());
  if (!match) return undefined;
  const pieces = splitNamespacePieces(match[1]);
  if (pieces.length !== 2 || pieces[1] !== "現在位置") return undefined;
  const subject = numberToken(pieces[0]!, context, target);
  const slot = subject === null ? undefined : stateSlot(state, subject);
  return slot?.location ? locationToRoomId(slot.location) : null;
}

function resolveLocationPredicate(raw: string, state: Readonly<GameState>): number | null | undefined {
  const match = /^(BATHCHECK|IN_HOME):(-?\d+)$/i.exec(raw.trim());
  if (!match) return undefined;
  const location = roomIdToLocation(Number(match[2]));
  if (!location) return null;
  return match[1].toUpperCase() === "BATHCHECK"
    ? (bathCheck(state, location) ? 1 : 0)
    : (inHome(location) ? 1 : 0);
}

/** Builds the deterministic, browser-safe subset of the Emuera host required
 * by the initial COMMAND dispatcher. It is a reader only: VM writes continue
 * through the staged-effect bridge and unknown symbols stay unsupported. */
export function createKojoVmGameStateHost(options: {
  state: Readonly<GameState>;
  target: number;
  commandNo: number;
  rng: Rng;
  symbols?: KojoSymbolTables;
}): Pick<KojoVmExecutionOptions, "resolveNumberSymbol" | "resolveStringSymbol" | "resolveKojoMemory" | "hostCapabilities"> {
  const symbols = options.symbols ?? DEFAULT_KOJO_SYMBOLS;
  const resolveNumberSymbol = (context: KojoVmNumberSymbolContext): number | null => {
    const raw = context.raw.trim();
    const outdoor = resolveOutRoof(raw, context, options.state, options.target);
    if (outdoor !== null) return outdoor;
    const currentLocation = resolveCurrentLocation(raw, context, options.state, options.target);
    if (currentLocation !== undefined) return currentLocation;
    const locationPredicate = resolveLocationPredicate(raw, options.state);
    if (locationPredicate !== undefined) return locationPredicate;
    if (raw === "MASTER" || raw === "PLAYER") return 0;
    if (raw === "TARGET") return context.numberSymbols.TARGET ?? options.target;
    const characterReference = resolveKojoCharacterReference(raw);
    if (characterReference !== null) return characterReference;
    if (raw === "SELECTCOM") return options.state.turnContext?.selectCom ?? options.commandNo;
    // Emuera TIME is the minute-of-day value used by COMMAND kojo branches.
    // The deterministic runtime stores the same unit in tickValue.
    if (raw === "TIME") return options.state.time.tickValue;
    const dateNow = /^CHK_DATENOW:(-?\d+)$/i.exec(raw);
    if (dateNow) return chkDateNow(Number(dateNow[1])) ? 1 : 0;
    // Calendar authority: upstream DAY/DAY:0 is one-based and monotonic,
    // while the modern state stores a zero-based dayIndex. DAY:2 and DAY:3
    // are the separately tracked season and date fields.
    const day = /^DAY(?::(\d+))?$/i.exec(raw);
    if (day) {
      const index = Number(day[1] ?? 0);
      if (index === 0) return options.state.time.dayIndex + 1;
      if (index === 2) return options.state.time.season ?? 1;
      if (index === 3) return options.state.time.date ?? 1;
      return null;
    }
    if (INACTIVE_CUSTOM_COMMAND_SYMBOLS.has(raw.toUpperCase())) return -1;
    const rand = /^RAND:(\d+)$/i.exec(raw);
    if (rand) {
      const upper = Number(rand[1]);
      return upper > 0 ? options.rng.int(upper) : null;
    }
    const no = /^NO:(.+)$/i.exec(raw);
    if (no) return numberToken(no[1], context, options.target);
    const namespace = /^([A-Z]+):(.*)$/i.exec(raw);
    if (!namespace) return null;
    const ns = namespace[1].toUpperCase() as KojoSymbolNamespace;
    const pieces = splitNamespacePieces(namespace[2]);
    if (ns === "FLAG") {
      const id = resolveKojoSymbol(symbols, "FLAG", pieces.join(":"));
      return id === null ? null : options.state.flagStore[id] ?? 0;
    }
    if (ns === "TFLAG") {
      const id = resolveKojoSymbol(symbols, "TFLAG", pieces.join(":"));
      return id === null ? null : getTflag(options.state, id);
    }
    if (ns === "ITEM") {
      const id = resolveKojoSymbol(symbols, "ITEM", pieces.join(":"));
      return id === null ? null : options.state.items?.[id] ?? 0;
    }
    if (!STATE_NAMESPACES.has(ns)) return null;
    let subject = options.target;
    // `TCVAR:302` addresses TARGET's slot 302. Only a second colon segment
    // makes the first token a subject, as in `CFLAG:59:1011` or
    // `CFLAG:ARG:口上セレクタ`.
    const scope = pieces.length > 1
      ? numberToken(pieces[0] ?? "", context, options.target)
      : null;
    if (scope !== null) {
      subject = scope;
      pieces.shift();
    }
    const id = resolveKojoSymbol(symbols, ns, pieces.join(":"));
    if (id === null) return null;
    if (ns === "SOURCE") return options.state.turnContext?.frame?.sourceByChara[subject]?.[id] ?? null;
    // NOWEX is command-local and is cleared by settlement. It must therefore
    // come from the authoritative execution frame, never a persistent EX bag.
    // An existing frame with no per-character entry is the ordinary zero
    // value; only a missing frame is indeterminate and must fail closed.
    if (ns === "NOWEX") {
      const frame = options.state.turnContext?.frame;
      return frame ? (frame.nowExByChara[subject]?.[id] ?? 0) : null;
    }
    const bag = stateSlot(options.state, subject)?.state as unknown as Record<string, Record<number, number>> | undefined;
    return bag?.[ns]?.[id] ?? 0;
  };
  const resolveStringSymbol = (context: KojoVmStringSymbolContext): string | null =>
    resolveCstr(context.raw, context, options.state, options.target)
    ?? resolveCallName(context.raw, context, options.state, options.target)
    ?? resolveName(context.raw, context, options.state, options.target)
    ?? resolvePantsName(context.raw, context, options.state, options.target);
  const resolveKojoMemory: NonNullable<KojoVmExecutionOptions["resolveKojoMemory"]> = (context) => {
    const charaNum = context.subject === undefined ? options.target : context.subject === -1 ? 0 : context.subject;
    const slot = stateSlot(options.state, charaNum);
    if (!slot) return null;
    const bucket = context.memory === "FIRSTTIME"
      ? options.state.kojoMemory?.[charaNum]?.firstTime
      : options.state.kojoMemory?.[charaNum]?.once;
    return { charaNum, seen: Boolean(bucket?.[context.key]) };
  };
  return {
    resolveNumberSymbol,
    resolveStringSymbol,
    resolveKojoMemory,
    hostCapabilities: {
      CHARA_TEXT: ({ args, stringArgs, location }) => {
        const text = stringArgs[0];
        const target = args[0];
        if (text === undefined || target === undefined || !Number.isSafeInteger(target) || target < 0) return null;
        return {
          lines: [{ text, form: charaTextForm(stringArgs[1] ?? "l"), location }],
        };
      },
      DISPLAY_COM_IMAGE: () => ({ returnValue: 0 }),
      TRAIN_MESSAGE: () => ({ returnValue: 0 }),
      AUTO_AEGI: () => ({ returnValue: 0 }),
      COLORMESSAGE: () => ({ returnValue: 0 }),
    },
  };
}
