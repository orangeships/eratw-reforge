import type { GameState } from "../state/index.js";
import { findCharaCstr } from "../state/chara-data.js";
import { locationToRoomId } from "../world/room-id-location.js";

/** A host read must never use `0` or an empty string to conceal an absent
 * context/capability. These statuses are shared by native KojoNode assets and
 * the compatibility VM. */
export type KojoHostStatus = "supported" | "empty" | "missing-context" | "unsupported";

export interface KojoHostResult<T> {
  readonly status: KojoHostStatus;
  readonly value?: T;
  readonly detail?: string;
}

export interface KojoCstrRequest {
  readonly subject: number;
  readonly key: string;
}

export interface KojoFormatterRequest {
  readonly name: string;
  readonly args: readonly string[];
}

export interface KojoHostArrayRequest {
  readonly name: string;
  readonly indices: readonly number[];
}

/** Registry boundary for browser/Tauri-safe authored host facilities. New
 * shared text adapters must return structured output through this contract;
 * unresolved facilities remain explicitly unsupported. */
export interface KojoHostRegistry {
  readonly readCstr: (request: KojoCstrRequest) => KojoHostResult<string>;
  readonly format: (request: KojoFormatterRequest) => KojoHostResult<string>;
  readonly readArray: (request: KojoHostArrayRequest) => KojoHostResult<number>;
  /** Optional string-valued array bridge (for CHARADATA/SAVEDATA tables). */
  readonly readStringArray?: (request: KojoHostArrayRequest) => KojoHostResult<string>;
  readonly readString: (name: string) => KojoHostResult<string>;
}

function empty(detail?: string): KojoHostResult<string> {
  return { status: "empty", value: "", detail };
}

function supported(value: string): KojoHostResult<string> {
  return value.length === 0 ? empty() : { status: "supported", value };
}

/** Legacy read-only view used by K59's authored panty-collection event.
 * `pantsTemp` remains the authority; no duplicate CSTR state is persisted. */
function pantyCollectionCstr(state: Readonly<GameState>, subject: number, key: string): string | undefined {
  if (subject !== 0 || key !== "12") return undefined;
  const entries: string[] = [];
  for (const [charaRaw, pieces] of Object.entries(state.pantsTemp ?? {})) {
    const charaNum = Number(charaRaw);
    const callName = charaNum === 0
      ? state.master.callName
      : state.charas[charaNum]?.callName;
    if (!callName) return undefined;
    for (const [pieceRaw, count] of Object.entries(pieces)) {
      for (let index = 0; index < count; index++) entries.push(`${callName}${pieceRaw}`);
    }
  }
  return entries.length === 0 ? "" : `/${entries.join("/")}/`;
}

/** Construct the shared read-only host from authoritative GameState. The
 * optional CSTR reader is useful for browser/Tauri data adapters; `undefined`
 * means “this CSTR key is not modeled”, never an authored empty string. */
export function createGameStateKojoHostRegistry(options: {
  readonly state: Readonly<GameState>;
  readonly resolveCstr?: (subject: number, key: string) => string | undefined;
}): KojoHostRegistry {
  const cstrReader = options.resolveCstr ?? findCharaCstr;
  return {
    readCstr: ({ subject, key }) => {
      if (!Number.isSafeInteger(subject) || subject < 0) {
        return { status: "missing-context", detail: `invalid CSTR subject ${subject}` };
      }
      if (subject !== 0 && !options.state.charas[subject]) {
        return { status: "missing-context", detail: `missing CSTR subject ${subject}` };
      }
      const authored = options.state.kojoStrings?.cstr?.[subject]?.[Number(key)];
      if (authored !== undefined) return supported(authored);
      // A bundled CSTR definition remains authoritative even for 0/1; the
      // FIRSTTIME/ONCE compatibility view is only its fallback.
      const direct = cstrReader(subject, key);
      if (direct !== undefined) return supported(direct);
      const pants = pantyCollectionCstr(options.state, subject, key);
      if (pants !== undefined) return supported(pants);
      // K10/1 COM44 asks whether the just-recorded virgin-loss history names
      // a vibrator. The modern command frame does not persist arbitrary CSTR,
      // but for this exact route the upstream producer is unambiguous: COM44
      // is the vibrator command and the surrounding TCVAR:破瓜 guard proves
      // the loss happened in this command. Keep every other history read
      // unsupported instead of inventing a general CSTR value.
      const commandNo = options.state.turnContext?.frame?.commandNo
        ?? options.state.turnContext?.selectCom;
      if (subject === 10 && key === "処女喪失履歴" && commandNo === 44) {
        return supported("振动棒");
      }
      // FIRSTTIME/ONCE CSTR views have a well-defined empty representation
      // even when the target has not produced any memory entries yet.
      if (key === "0" || key === "1") {
        const bucket = key === "0"
          ? options.state.kojoMemory?.[subject]?.firstTime
          : options.state.kojoMemory?.[subject]?.once;
        if (!bucket) return empty();
        const entries = Object.keys(bucket).map((entry) => entry.startsWith("SELECTCOM:") ? entry.slice(10) : entry);
        return supported(entries.length === 0 ? "" : `/${entries.join("/")}/`);
      }
      return { status: "unsupported", detail: `CSTR:${subject}:${key}` };
    },
    // Formatter routing remains intentionally closed until each formatter has
    // a source-backed adapter. This result is still explicit and testable.
    format: ({ name }) => ({ status: "unsupported", detail: `formatter:${name}` }),
    readArray: ({ name, indices }) => {
      const index = indices[0];
      if (!Number.isSafeInteger(index) || index! < 0) {
        return { status: "missing-context", detail: `${name}:${indices.join(":")}` };
      }
      if (name === "STONE_PLAYCOUNT" && index === 2) {
        return { status: "supported", value: options.state.stoneContestProgress?.clerkStoryStage ?? 0 };
      }
      if (name === "LEARNED_MENU") {
        return { status: "supported", value: options.state.learnedMenu?.[index!] ?? 0 };
      }
      if (name === "PRIVATEROOM") {
        const slot = index === 0 ? options.state.master : options.state.charas[index!];
        if (!slot) return { status: "missing-context", detail: `PRIVATEROOM:${index}` };
        const room = locationToRoomId(slot.homeLocation ?? slot.location ?? "");
        return room === null
          ? { status: "unsupported", detail: `PRIVATEROOM:${index}` }
          : { status: "supported", value: room };
      }
      if (name === "CHILD_SEX_PREG") {
        const slot = indices[1];
        if (!Number.isSafeInteger(slot) || slot! < 0) {
          return { status: "missing-context", detail: `CHILD_SEX_PREG:${indices.join(":")}` };
        }
        return {
          status: "supported",
          value: options.state.childSexPreg?.[index!]?.[slot!] ?? 0,
        };
      }
      return { status: "unsupported", detail: `${name}:${indices.join(":")}` };
    },
    // CHILD_ACT and similar string arrays do not yet have a modern state
    // owner. Keep the capability explicit so native and VM routes report a
    // missing host instead of silently selecting a random CASE arm.
    readStringArray: ({ name, indices }) => ({
      status: "unsupported",
      detail: `${name}:${indices.join(":")}`,
    }),
    readString: (name) => {
      if (name === "DISH_TASTE") {
        return options.state.dish
          ? { status: "supported", value: options.state.dish.taste }
          : { status: "missing-context", detail: name };
      }
      return { status: "unsupported", detail: name };
    },
  };
}
