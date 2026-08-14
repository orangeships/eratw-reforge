import type { ObservationEvent } from "../../schemas/types.js";
import { resolveKojoNodeDetailed } from "../kojo/static-router.js";
import type { KojoLine, KojoNode } from "../kojo/types.js";
import type { GameState } from "../state/index.js";
import type { Rng } from "./types.js";

export interface TrainMessageBundle {
  generatedAt?: string;
  source?: string;
  byCommand: Record<string, KojoNode>;
}

export interface TrainMessageRouter {
  collect(
    commandNo: number,
    target: number,
    state: Readonly<GameState>,
    rng: Rng,
  ): KojoLine[];
}

export interface TrainMessageRouterOptions {
  callNames?: Record<number, string>;
  masterName?: string;
}

export const NOOP_TRAIN_MESSAGE_ROUTER: TrainMessageRouter = {
  collect: () => [],
};

const INLINE_TERNARY_RE = /\\@\s*([^?#@]+?)\s*\?\s*([^#@]*?)\s*#\s*([^@]*?)\s*\\@/g;
const VAR_RE = /^(TALENT|CFLAG|TCVAR|ABL|BASE|FLAG)(?::(TARGET|MASTER))?:(.+)$/;

// TRAIN_MESSAGE owns the source-verified inline ternary/TEXTR subset. A
// COND_STR condition needs a formatter bridge that this route does not own;
// letting the shared renderer choose a branch would fabricate authored prose.
const UNSUPPORTED_TRAIN_FORMATTER_RE = /%COND_STR\s*\(/i;

const NAME_IDS: Partial<Record<string, Record<string, number>>> = {
  TALENT: {
    恋慕: 3,
    恋人: 7,
    思慕: 8,
  },
  CFLAG: {
    現在位置: 2,
    行動: 325,
    睡眠: 313,
  },
};

function readStateVar(
  ref: string,
  target: number,
  state: Readonly<GameState>,
): number | null {
  const m = VAR_RE.exec(ref.trim());
  if (!m) return null;
  const ns = m[1]!;
  const scope = ns === "FLAG" ? "GLOBAL" : (m[2] ?? "TARGET");
  const rawId = m[3]!.trim();
  const id = /^\d+$/.test(rawId)
    ? Number(rawId)
    : NAME_IDS[ns]?.[rawId];
  if (id === undefined) return null;
  if (ns === "FLAG" || scope === "GLOBAL") return state.flagStore[id] ?? 0;
  const subject = scope === "MASTER" ? 0 : target;
  const slot = subject === 0 ? state.master : state.charas[subject];
  if (!slot) return 0;
  const bag = (slot.state as unknown as Record<string, Record<number, number>>)[ns];
  return bag?.[id] ?? 0;
}

function evaluateInlineCondition(
  raw: string,
  target: number,
  state: Readonly<GameState>,
): boolean | null {
  const expr = raw.trim();
  if (!expr) return null;

  // The common action prose often uses this to pluralise "TARGET". The
  // modern command issue path targets a single focused chara, so the faithful
  // single-target answer is false.
  if (/^GET_TARGETNUM\(\)\s*>\s*1$/i.test(expr)) return false;

  const cmp = /^(.+?)\s*(==|!=|>=|<=|>|<)\s*(-?\d+)$/.exec(expr);
  if (cmp) {
    const left = readStateVar(cmp[1]!, target, state);
    if (left === null) return null;
    const right = Number(cmp[3]!);
    switch (cmp[2]) {
      case "==": return left === right;
      case "!=": return left !== right;
      case ">=": return left >= right;
      case "<=": return left <= right;
      case ">": return left > right;
      case "<": return left < right;
    }
  }

  const value = readStateVar(expr, target, state);
  return value === null ? null : value !== 0;
}

function renderTrainText(
  raw: string,
  target: number,
  state: Readonly<GameState>,
): string | null {
  let out = raw;
  let unsupported = false;

  out = out.replace(INLINE_TERNARY_RE, (_m, cond: string, yes: string, no: string) => {
    const evaluated = evaluateInlineCondition(cond, target, state);
    if (evaluated === null) {
      unsupported = true;
      return "";
    }
    const pickYes = evaluated;
    return pickYes ? yes : no;
  });

  // HIP(TARGET) is a large upstream randomized formatter. Until its exact
  // state/RNG table is ported, it is not safe to invent an adjective here.
  if (/%HIP\(TARGET\)%/i.test(out)) unsupported = true;
  if (UNSUPPORTED_TRAIN_FORMATTER_RE.test(out)) unsupported = true;

  return unsupported ? null : out.replace(/\s+/g, " ").trim();
}

function shouldFlushLine(form: KojoLine["form"]): boolean {
  return form === "PRINTL" ||
    form === "PRINTW" ||
    form === "PRINTDW" ||
    form === "PRINTDL" ||
    form === "PRINTFORML" ||
    form === "PRINTFORMW" ||
    form === "PRINTFORMDL" ||
    form === "PRINTFORMDW";
}

function normalizeTrainLines(
  lines: readonly KojoLine[],
): KojoLine[] {
  const out: KojoLine[] = [];
  let buffer = "";
  let firstLine = 0;

  const flush = (form: KojoLine["form"], line: number): void => {
    const text = buffer.trim();
    buffer = "";
    firstLine = 0;
    if (!text) return;
    out.push({ form, text, line });
  };

  for (const line of lines) {
    const text = line.text;
    if (text) {
      if (!firstLine) firstLine = line.line;
      buffer += text;
    }
    if (shouldFlushLine(line.form)) {
      flush(line.form, firstLine || line.line);
    }
  }
  flush("PRINTFORML", firstLine);
  return out;
}

export function createTrainMessageRouter(
  bundle: TrainMessageBundle,
  opts: TrainMessageRouterOptions = {},
): TrainMessageRouter {
  return {
    collect(commandNo, target, state, rng) {
      const node = bundle.byCommand[String(commandNo)];
      if (!node) return [];
      const resolved = resolveKojoNodeDetailed(node, target, state, rng, [], {
        commandNo,
        lineTransform: (text) => renderTrainText(text, target, state),
        nameResolver: (reference) =>
          typeof reference === "number" ? opts.callNames?.[reference] : undefined,
        masterName: opts.masterName,
        targetName: opts.callNames?.[target],
      });
      return normalizeTrainLines(resolved.lines);
    },
  };
}

export function trainLinesToNarrationEvents(
  lines: readonly KojoLine[],
  now: () => number,
): ObservationEvent[] {
  return lines.map((line) => ({
    kind: "NARRATION" as const,
    timestamp: now(),
    text: line.text,
    presentation: "inline" as const,
  }));
}
