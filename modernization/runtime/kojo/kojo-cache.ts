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

import { parseKojoSource } from "./source-parser.js";
import type { KojoAsyncParser } from "./async-parser.js";
import { recordKojoPerformance } from "./performance.js";
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
  hasActionableKojoNode,
} from "./static-router.js";
import { resolveActiveKojoVariantCode } from "./variant-selection.js";
import {
  DEFAULT_KOJO_SYMBOLS,
  SCOPED_KOJO_SYMBOLS,
  mergeKojoSymbolTables,
} from "./symbol-table.js";
import { withMarkKojoContext } from "./mark-kojo.js";
import { palamKojoKey } from "./palam-kojo.js";
import { collectCharaKojoFilePaths } from "./interactive-preload.js";
import {
  collectInteractiveKojoPreparations,
  MAX_INTERACTIVE_PREPARATIONS,
  yieldForKojoPreparation,
  type InteractiveKojoPreparationOptions,
  type InteractiveKojoTarget,
} from "./interactive-preparation.js";
import { iraiKojoSelectorKeys, mergeIraiKojoResolutions } from "./irai-kojo.js";
import { iraiIdToClient } from "../state/commission.js";
import { resolveDiaryCall } from "./diary-call.js";
import { getTflag, TFLAG_ID } from "../state/tflag.js";
import type { GameState } from "../state/index.js";
import type { Rng } from "../command/types.js";

function stableSourceFingerprint(text: string): string {
  // FNV-1a keeps this synchronous and dependency-free in Browser/Tauri.
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
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
type CacheEntry = { node: KojoNode | null; cachedAt: number; sourceFingerprint?: string };
type SourceEntry = { text: string; lines: string[]; fingerprint: string };

/**
 * Build a `SourceEntry` with a lazily computed `fingerprint`.
 *
 * The index generator stamps `contentFingerprint` on 100% of the 51095
 * locations it emits, and both writers use `loc.contentFingerprint ??
 * source.fingerprint` — so the runtime hash is a fallback that in practice is
 * never read. It was still being computed eagerly on every cold file, as a
 * char-by-char FNV-1a pass over the whole text: 2.3 million iterations for
 * `M_KOJO_K58_1_日常系コマンド.ERB`, on the main thread, for a value nobody
 * asks for. A getter keeps the value identical whenever it *is* consulted.
 */
export function makeSourceEntry(text: string): SourceEntry {
  const entry: SourceEntry = {
    text,
    lines: text.split("\n"),
    fingerprint: "",
  };
  Object.defineProperty(entry, "fingerprint", {
    configurable: true,
    enumerable: true,
    get(): string {
      const fingerprint = stableSourceFingerprint(text);
      Object.defineProperty(entry, "fingerprint", {
        configurable: true, enumerable: true, writable: true, value: fingerprint,
      });
      return fingerprint;
    },
  });
  return entry;
}
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
  /**
   * Optional asynchronous mirror of `readText`, used ONLY by
   * `preloadSources` to warm `sourceCache` off the main-thread critical
   * path (the Tauri renderer injects a non-blocking `fetch`). When absent
   * (Node runtime, tests, bundle routers), `preloadSources` is a no-op and
   * the synchronous reader keeps today's semantics.
   */
  readTextAsync?: (filePath: string, projectRoot: string) => Promise<string>;
  /** Optional background compiler. Its request contains source identity, never GameState. */
  parseAsync?: KojoAsyncParser;
  /**
   * Resident budget for cached ERB source text, in UTF-16 code units.
   * Defaults to `DEFAULT_MAX_SOURCE_CACHE_CHARS`; 0 disables eviction.
   */
  maxSourceCacheChars?: number;
}

/** Files fetched concurrently by `preloadSources`. Small on purpose: the
 *  asset-protocol round trip is cheap per file, but an unbounded fan-out
 *  would compete with gameplay fetches for the WebView's connection pool. */
export const KOJO_PRELOAD_CONCURRENCY = 8;

/**
 * Character budget for resident ERB source text, in UTF-16 code units.
 *
 * `sourceCache` used to grow for the lifetime of the process with no bound.
 * The checkout's kojo tree is ~155 MiB of ERB and the index references 1717
 * files; each cached entry holds both `text` and a `split("\n")` array, so a
 * long session that touched most of the roster drifted into hundreds of MiB of
 * live objects and every later interaction paid major GC for it. That is the
 * "it gets laggier the longer I play" half of the dev-shell cost, and it is
 * independent of the blocking-read half.
 *
 * Sized to keep a comfortable working set — the night sweep alone spans ~469
 * files, and the in-room working set is a handful — while capping the tail.
 * Eviction is least-recently-used, and a re-read is always correct because a
 * `CacheEntry` holds the *parsed* node, never a reference to the SourceEntry.
 */
export const DEFAULT_MAX_SOURCE_CACHE_CHARS = 32_000_000;

/**
 * Blocking source-read telemetry.
 *
 * The dev shell injects a SYNCHRONOUS reader (`readTauriKojoTextSync`, a
 * blocking sync XHR over the asset protocol), so every cold kojo file stalls
 * the WebView main thread inside the command settlement window. Node cannot
 * see that cost — `readFileSync` off a warm page cache is an order of magnitude
 * cheaper than a sync XHR — so the only place the real number exists is the
 * renderer. This ring buffer is polled by the 「耗时」 perf panel.
 */
export interface KojoSourceReadRecord {
  filePath: string;
  chars: number;
  ms: number;
}

const SOURCE_READ_LIMIT = 20;
const sourceReadLog: KojoSourceReadRecord[] = [];

/** Newest-first read log for the perf panel. */
export function kojoSourceReadRecords(): readonly KojoSourceReadRecord[] {
  return sourceReadLog;
}

export function resetKojoSourceReadRecordsForTests(): void {
  sourceReadLog.length = 0;
}

function recordSourceRead(filePath: string, text: string, ms: number): void {
  sourceReadLog.unshift({ filePath, chars: text.length, ms });
  if (sourceReadLog.length > SOURCE_READ_LIMIT) sourceReadLog.length = SOURCE_READ_LIMIT;
}

export class KojoCache implements DialogueRouter {
  private readonly index: KojoCommandIndex;
  private readonly projectRoot: string;
  private readonly nameResolver?: (charaNum: number) => string | undefined;
  /** Read one ERB source file synchronously (see `readTextAsync` for the
   *  preload mirror). */
  private readonly readText: KojoSourceReader;
  private readonly readTextAsync?: (filePath: string, projectRoot: string) => Promise<string>;
  private readonly parseAsync?: KojoAsyncParser;
  private readonly preparing = new Map<string, Promise<void>>();
  /** Parsed KojoNode cache. Key = `${charaNum}:${variantCode}:${comType}:${cmd}`. */
  private readonly cache = new Map<string, CacheEntry>();
  /** Unused speculative nodes have a separate, bounded lifetime. */
  private readonly preparedCacheKeys = new Set<string>();
  /** One synchronous source read per ERB file, bounded by
   * `maxSourceCacheChars` and evicted least-recently-used first. */
  private readonly sourceCache = new Map<string, SourceEntry>();
  /** Resident source size in code units, kept in step with `sourceCache`. */
  private sourceCacheChars = 0;
  /** Resident budget in code units. 0 disables eviction (test/debug escape). */
  private readonly maxSourceCacheChars: number;
  /** In-flight async reads from `preloadSources`, deduped per file. */
  private readonly preloading = new Map<string, Promise<void>>();
  /** Invalidates speculative work when the caller explicitly clears the cache. */
  private cacheGeneration = 0;

  constructor(index: KojoCommandIndex, projectRoot: string, opts: KojoCacheOptions = {}) {
    this.index = index;
    this.projectRoot = projectRoot;
    this.nameResolver = opts.nameResolver;
    // `opts.masterName` is preserved on the type but no longer consulted
    // — caller tokens resolve at runtime against live `state.master.callName`.
    this.readText = opts.readText ?? (() => {
      throw new Error("KojoCache requires a synchronous readText(filePath, projectRoot) implementation");
    });
    this.readTextAsync = opts.readTextAsync;
    this.parseAsync = opts.parseAsync;
    this.maxSourceCacheChars = Math.max(
      0,
      opts.maxSourceCacheChars ?? DEFAULT_MAX_SOURCE_CACHE_CHARS,
    );
  }

  /**
   * Warm the kojo source behind the given characters through the async
   * reader, so a later synchronous first touch hits memory instead of the
   * renderer's blocking sync XHR.
   *
   * This is the interactive counterpart to `preloadSources`: the night
   * preload set covers the sleep settlement, but `commands` (日常系コマンド) —
   * the surface the player clicks most — was left cold on purpose to keep
   * boot I/O bounded. Scoping the warm to the characters actually present in
   * the room keeps it to a few files instead of the ~1248-file remainder, and
   * `readTextAsync` is non-blocking, so this is safe to fire on every room
   * change. No-op without an async reader (Node runtime, tests).
   */
  async preloadCharaSources(charaNums: readonly number[]): Promise<void> {
    if (!this.readTextAsync || charaNums.length === 0) return;
    await this.preloadSources(collectCharaKojoFilePaths(this.index, charaNums));
  }

  /** Read and parse the active interactive routes without RNG, effects or state mutation. */
  async prepareInteractiveKojo(
    state: Readonly<GameState>,
    targets: readonly InteractiveKojoTarget[],
    options: InteractiveKojoPreparationOptions = {},
  ): Promise<void> {
    if (!this.readTextAsync && !this.parseAsync) return;
    const generation = this.cacheGeneration;
    const cancelled = (): boolean => options.signal?.aborted === true || generation !== this.cacheGeneration;
    const yieldControl = options.yieldControl ?? yieldForKojoPreparation;
    const tasks = collectInteractiveKojoPreparations(this.index, state, targets, options);
    if (cancelled()) return;
    const wanted = new Set(tasks.map((task) => task.key));
    for (const key of this.preparedCacheKeys) {
      if (!options.retainPrepared && !wanted.has(key)) {
        this.cache.delete(key);
        this.preparedCacheKeys.delete(key);
      }
    }
    for (const task of tasks) {
      if (cancelled()) return;
      const cached = this.cache.get(task.key);
      if (cached && (!task.location.contentFingerprint || cached.sourceFingerprint === task.location.contentFingerprint)) {
        if (options.retainPrepared && this.preparedCacheKeys.delete(task.key)) this.preparedCacheKeys.add(task.key);
        continue;
      }
      if (this.parseAsync) {
        const location = { ...task.location };
        const preparationKey = `${generation}:${task.key}:${JSON.stringify(location)}`;
        let pending = this.preparing.get(preparationKey);
        if (!pending) {
          // Shared work is not owned by one caller's AbortSignal: cancelling room
          // speculation must not cancel a click that is waiting for the same node.
          pending = this.parseAsync({
            location, charaNum: task.charaNum, revision: generation,
            calleeName: this.nameResolver?.(task.charaNum),
            expandSameFileStaticCalls: task.expandSameFileStaticCalls,
          }).then((result) => {
            if (generation !== this.cacheGeneration) return;
            if (location.contentFingerprint !== task.location.contentFingerprint) throw new Error("kojo source index changed during compilation");
            const current = this.cache.get(task.key);
            if (current && (!location.contentFingerprint || current.sourceFingerprint === location.contentFingerprint)) return;
            this.cache.set(task.key, {
              node: result.node, cachedAt: Date.now(),
              sourceFingerprint: location.contentFingerprint ?? result.sourceFingerprint,
            });
            this.preparedCacheKeys.add(task.key);
            this.trimPreparedCache();
          }).finally(() => {
            if (this.preparing.get(preparationKey) === pending) this.preparing.delete(preparationKey);
          });
          this.preparing.set(preparationKey, pending);
        }
        await pending;
        if (cancelled()) return;
        continue;
      }
      await this.preloadSources([task.location.filePath]);
      if (cancelled()) return;
      await yieldControl();
      if (cancelled()) return;
      // An unreadable or evicted file must never fall through to the blocking reader.
      const source = this.sourceCache.get(task.location.filePath);
      if (!source) continue;
      // A player command may have parsed this route while preparation yielded.
      const current = this.cache.get(task.key);
      if (current && (!task.location.contentFingerprint || current.sourceFingerprint === task.location.contentFingerprint)) continue;
      const node = this.parseFuncFromFile(task.location, task.charaNum, task.variantCode,
        false, task.expandSameFileStaticCalls);
      this.cache.set(task.key, {
        node,
        cachedAt: Date.now(),
        sourceFingerprint: task.location.contentFingerprint ?? source.fingerprint,
      });
      this.preparedCacheKeys.add(task.key);
      this.trimPreparedCache();
    }
  }

  private trimPreparedCache(): void {
    if (this.preparedCacheKeys.size > MAX_INTERACTIVE_PREPARATIONS) {
      const oldest = this.preparedCacheKeys.values().next().value!;
      this.preparedCacheKeys.delete(oldest);
      this.cache.delete(oldest);
    }
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
    options?: { probeReadonly?: boolean },
  ) {
    if (!this.kojoEnabledForTarget(state, charaNum)) return emptyKojoResolution("gated");
    const variantCode = this.resolveVariant(charaNum, state);
    const variant = this.findVariant(charaNum, variantCode);
    if (!variant) return emptyKojoResolution("not-authored");
    const commandKind = commandKindFor(state);
    const loc = commandLocationFor(variant, commandKind, commandNo);
    const context = { commandNo, probeReadonly: options?.probeReadonly };
    if (loc) {
      const node = this.getOrParse(charaNum, variantCode, commandKind, commandNo, loc);
      if (node) return resolveKojoNodeDetailed(node, charaNum, state, rng, [], context);
    }
    if (variant.catchAll) {
      const node = this.getOrParse(charaNum, variantCode, "CATCHALL", 0, variant.catchAll);
      if (node) return resolveKojoNodeDetailed(node, charaNum, state, rng, [], context);
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

  resolveDailyKojo(
    charaNum: number,
    eventId: number,
    state: Readonly<GameState>,
    rng: Rng,
    args: number[] = [],
  ): KojoLine[] {
    return this.resolveDailyKojoDetailed(charaNum, eventId, state, rng, args).lines;
  }

  resolveDailyKojoDetailed(
    charaNum: number,
    eventId: number,
    state: Readonly<GameState>,
    rng: Rng,
    args: number[] = [],
  ): KojoResolution {
    if (!this.kojoEnabledForTarget(state, charaNum)) return emptyKojoResolution("gated");
    const variantCode = this.resolveVariant(charaNum, state);
    const variant = this.findVariant(charaNum, variantCode);
    const loc = variant?.dailyEvents?.[`DAILY:${eventId}`];
    const node = loc ? this.getOrParseDailyEvent(charaNum, variantCode, eventId, loc) : null;
    return node
      ? resolveKojoNodeDetailed(node, charaNum, state, rng, args)
      : emptyKojoResolution("not-authored");
  }

  resolveDailyKojoInteractive(
    charaNum: number,
    eventId: number,
    state: Readonly<GameState>,
    rng: Rng,
    args: readonly number[] | undefined,
    choices: readonly number[],
  ): InteractiveKojoResolution {
    if (!this.kojoEnabledForTarget(state, charaNum)) return emptyInteractiveKojoResolution("gated");
    const variantCode = this.resolveVariant(charaNum, state);
    const variant = this.findVariant(charaNum, variantCode);
    const loc = variant?.dailyEvents?.[`DAILY:${eventId}`];
    const node = loc ? this.getOrParseDailyEvent(charaNum, variantCode, eventId, loc) : null;
    return node
      ? resolveKojoNodeWithChoices(node, charaNum, state, rng, args ?? [], choices)
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
          // UPDATE_K resource checks in the indexed packs only guard optional
          // portrait recommendations. This adapter has no resource manifest,
          // so deterministically take the absent-resource branch while leaving
          // ordinary dialogue routes fail-closed.
          { resourceExists: () => false },
        )
      : emptyInteractiveKojoResolution("not-authored");
  }

  hasUpdateKojo(charaNum: number, state: Readonly<GameState>): boolean {
    if (!this.kojoEnabledForTarget(state, charaNum)) return false;
    const variantCode = this.resolveVariant(charaNum, state);
    const update = this.findVariant(charaNum, variantCode)?.update;
    if (!update) return false;
    const node = this.getOrParseUpdate(charaNum, variantCode, update);
    return node !== null && hasActionableKojoNode(node);
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
    return this.resolveIraiKojoDetailed(charaNum, role, scene, iraiId, state, rng).lines;
  }

  resolveIraiKojoDetailed(
    charaNum: number,
    role: string,
    scene: string,
    iraiId: number,
    state: Readonly<GameState>,
    rng: Rng,
  ): KojoResolution {
    if (!this.kojoEnabledForTarget(state, charaNum)) return emptyKojoResolution("gated");

    const variantCode = this.resolveVariant(charaNum, state);
    const variant = this.findVariant(charaNum, variantCode);
    if (!variant) return emptyKojoResolution("not-authored");

    const resolutions: KojoResolution[] = [];
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
      if (node) {
        resolutions.push(resolveKojoNodeDetailed(node, charaNum, state, rng, [], context));
      } else {
        resolutions.push({
          status: "unsupported",
          lines: [],
          effects: [],
          unsupportedPredicates: [],
          unsupportedEffects: [],
          diagnostics: [{ code: "unresolved-text", detail: `IRAI source could not be parsed: ${loc.filePath}:${loc.lineStart}` }],
        });
      }
    }
    return mergeIraiKojoResolutions(resolutions);
  }

  // ── Cache stats (for tests / debug) ───────────────────────────────

  /**
   * Warm `sourceCache` for the given files through the injected async
   * reader so later synchronous reads (e.g. the whole night-settlement kojo
   * sweep) hit memory instead of a blocking sync XHR per file.
   *
   * - No-op when no `readTextAsync` was injected (Node runtime, tests).
   * - Idempotent and race-safe: cached files are skipped and in-flight reads
   *   are joined; `getSource` winning mid-preload is respected.
   * - A single unreadable file is swallowed (the sync reader keeps today's
   *   error semantics for that file) so one bad path cannot reject the batch.
   */
  async preloadSources(filePaths: readonly string[]): Promise<void> {
    if (!this.readTextAsync) return;
    const pending = [...new Set(filePaths)].filter((filePath) =>
      !this.sourceCache.has(filePath));
    for (let index = 0; index < pending.length; index += KOJO_PRELOAD_CONCURRENCY) {
      const batch = pending.slice(index, index + KOJO_PRELOAD_CONCURRENCY);
      await Promise.all(batch.map((filePath) => this.preloadOne(filePath)));
    }
  }

  private preloadOne(filePath: string): Promise<void> {
    const inFlight = this.preloading.get(filePath);
    if (inFlight) return inFlight;
    const generation = this.cacheGeneration;
    const load = (async () => {
      const text = (await this.readTextAsync!(filePath, this.projectRoot)).replace(/^\uFEFF/, "");
      // A synchronous `getSource` may have cached the file while the async
      // read was in flight — never overwrite the entry the sync path trusts.
      if (generation === this.cacheGeneration && !this.sourceCache.has(filePath)) {
        this.sourceCache.set(filePath, makeSourceEntry(text));
        this.sourceCacheChars += text.length;
        this.evictSourcesIfNeeded();
      }
    })().finally(() => {
      if (this.preloading.get(filePath) === load) this.preloading.delete(filePath);
    }).catch(() => {
      // Swallowed: keep the sync reader as the fallback for this file.
    });
    this.preloading.set(filePath, load);
    return load;
  }

  /** Number of cached entries. */
  cacheSize(): number {
    return this.cache.size;
  }

  /** Clear all cached entries (e.g. for hot-reload in dev mode). */
  clearCache(): void {
    this.cacheGeneration += 1;
    this.preloading.clear();
    this.preparing.clear();
    this.cache.clear();
    this.preparedCacheKeys.clear();
    this.sourceCache.clear();
    this.sourceCacheChars = 0;
  }

  /** Resident ERB source files, for tests / debug. */
  sourceCacheSize(): number {
    return this.sourceCache.size;
  }

  /** Resident ERB source size in code units, for tests / debug. */
  residentSourceChars(): number {
    return this.sourceCacheChars;
  }

  /** Expose the index for tests. */
  getIndex(): Readonly<KojoCommandIndex> {
    return this.index;
  }

  /** Lets preparation coordinators retry after explicit cache invalidation. */
  get preparationRevision(): number {
    return this.cacheGeneration;
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
    if (cached && (!loc.contentFingerprint || cached.sourceFingerprint === loc.contentFingerprint)) {
      this.preparedCacheKeys.delete(key);
      return cached.node;
    }

    const source = this.getSource(loc.filePath);
    const node = this.parseFuncFromFile(loc, charaNum, variantCode);
    this.cache.set(key, { node, cachedAt: Date.now(), sourceFingerprint: loc.contentFingerprint ?? source.fingerprint });
    return node;
  }

  getCounterKojoMetadata(
    charaNum: number,
    counterAction: number,
    state: Readonly<GameState>,
  ) {
    const variantCode = this.resolveVariant(charaNum, state);
    const loc = this.findVariant(charaNum, variantCode)?.counters?.[counterAction];
    return {
      variantCode,
      sourceFile: loc?.filePath,
      functionName: loc?.funcName,
    };
  }

  private getSource(filePath: string): SourceEntry {
    const cached = this.sourceCache.get(filePath);
    if (cached) {
      // Refresh recency — a Map preserves insertion order, so re-inserting
      // the same key is the LRU touch.
      this.sourceCache.delete(filePath);
      this.sourceCache.set(filePath, cached);
      return cached;
    }
    const startedAt = performance.now();
    const text = this.readText(filePath, this.projectRoot).replace(/^\uFEFF/, "");
    recordSourceRead(filePath, text, performance.now() - startedAt);
    const entry = makeSourceEntry(text);
    recordKojoPerformance("read", performance.now() - startedAt);
    this.sourceCache.set(filePath, entry);
    this.sourceCacheChars += text.length;
    this.evictSourcesIfNeeded();
    return entry;
  }

  /** Drop least-recently-used sources until the resident budget is respected. */
  private evictSourcesIfNeeded(): void {
    if (this.maxSourceCacheChars <= 0) return;
    // A file whose async read is still pending is not in `sourceCache` yet, so
    // it is unreachable from this loop and needs no guard. A file that IS
    // resident was inserted exactly once, by the completed read, so evicting
    // it here cannot cause a duplicate re-insert.
    for (const [filePath, entry] of this.sourceCache) {
      if (this.sourceCacheChars <= this.maxSourceCacheChars) return;
      this.sourceCache.delete(filePath);
      this.sourceCacheChars -= entry.text.length;
    }
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
    if (cached) {
      this.preparedCacheKeys.delete(key);
      return cached.node;
    }
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

  private getOrParseDailyEvent(
    charaNum: number,
    variantCode: string,
    eventId: number,
    loc: FuncLocation,
  ): KojoNode | null {
    const key = `DAILY:${charaNum}:${variantCode}:${eventId}`;
    const cached = this.cache.get(key);
    if (cached) return cached.node;
    const node = this.parseFuncFromFile(loc, charaNum, variantCode);
    if (node) this.cache.set(key, { node, cachedAt: Date.now() });
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
    if (cached) {
      this.preparedCacheKeys.delete(key);
      return cached.node;
    }
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
    if (cached) {
      this.preparedCacheKeys.delete(key);
      return cached.node;
    }
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
    if (cached && (!loc.contentFingerprint || cached.sourceFingerprint === loc.contentFingerprint)) {
      return cached.node;
    }
    const source = this.getSource(loc.filePath);
    const node = this.parseFuncFromFile(loc, charaNum, variantCode);
    this.cache.set(key, {
      node,
      cachedAt: Date.now(),
      sourceFingerprint: loc.contentFingerprint ?? source.fingerprint,
    });
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
      return parseKojoSource(loc, charaNum, this.getSource(loc.filePath), {
        calleeName: this.nameResolver?.(charaNum),
        captureFunctionResults,
        expandSameFileStaticCalls,
      });
    } catch {
      return null;
    }
  }
}
