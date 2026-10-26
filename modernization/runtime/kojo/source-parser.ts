import { extractFuncs } from "../../importer/kojo/extractor.js";
import { parseFunc } from "../../importer/kojo/parser.js";
import { bindStaticCallArguments } from "../../importer/kojo/static-call.js";
import { resolveDiaryStaticCall } from "../../importer/kojo/diary-static.js";
import { DEFAULT_CONTEXT, type SubstituteContext } from "../../importer/kojo/substitute.js";
import type { ParsedKojoFunc } from "../../importer/kojo/parser-types.js";
import {
  DEFAULT_KOJO_SYMBOLS,
  GLOBAL_KOJO_DECLARATIONS,
  SCOPED_KOJO_DECLARATIONS,
  SCOPED_KOJO_SYMBOLS,
  mergeKojoSymbolTables,
} from "./symbol-table.js";
import type { FuncLocation, IraiSceneLocation, KojoNode } from "./types.js";
import { recordKojoPerformance } from "./performance.js";

export interface KojoParseOptions {
  calleeName?: string;
  captureFunctionResults?: boolean;
  expandSameFileStaticCalls?: boolean;
}

function containsUnsupportedKojoNode(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if ((value as { type?: string }).type === "unsupported-effect") return true;
  return Object.values(value).some((child) =>
    Array.isArray(child)
      ? child.some(containsUnsupportedKojoNode)
      : containsUnsupportedKojoNode(child)
  );
}

/** Shared pure compiler: no I/O, GameState, RNG or committed effects. */
export function parseKojoSource(
  loc: FuncLocation | IraiSceneLocation,
  charaNum: number,
  source: { text: string; lines?: readonly string[] },
  options: KojoParseOptions = {},
): KojoNode | null {
  const startedAt = performance.now();
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
      calleeName: options.calleeName ?? "对方",
      calleeCharaNum: charaNum,
      ...(isIraiScene
        ? { deferredCallNameAliases: ["CHARA", "CLIENT_ID"] }
        : {}),
    };

    // Read the file and extract the target lines
    const text = source.text;
    const lines = source.lines ?? text.split("\n");
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
    const functions = options.expandSameFileStaticCalls
      ? new Map(extractFuncs(text).map((candidate) => [candidate.name.toUpperCase(), candidate]))
      : null;
    const parseWithStaticCalls = (
      current: typeof fn,
      visiting: ReadonlySet<string>,
    ): ParsedKojoFunc => parseFunc(current, ctx, {
      captureFunctionResults: options.captureFunctionResults ?? false,
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
  } finally {
    recordKojoPerformance("parse", performance.now() - startedAt);
  }
}
