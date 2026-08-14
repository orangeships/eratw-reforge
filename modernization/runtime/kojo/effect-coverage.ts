import type { KojoNode } from "./types.js";

export type KojoEffectUnsupportedReason =
  | "unsupported-assignment"
  | "unsupported-bit-operation";

export type KojoEffectUnsupportedCategory =
  | "display-command-text"
  | "helper-call"
  | "selector-structure"
  | "condition-fragment"
  | "loop-control"
  | "loop-header"
  | "bit-operation"
  | "local-variable"
  | "string-state"
  | "result-state"
  | "dynamic-target"
  | "compound-assignment"
  | "unmodeled-namespace"
  | "state-assignment-expression"
  | "return-expression"
  | "other";

export type KojoEffectUnsupportedScope = "syntax" | "deferred-call" | "direct-effect-gap";

export interface KojoEffectUnsupportedCategoryEntry {
  category: KojoEffectUnsupportedCategory;
  count: number;
  scope: KojoEffectUnsupportedScope;
  description: string;
  nextStep: string;
  samples: { raw: string; reason: string }[];
}

export interface KojoEffectCoverage {
  trees: number;
  supportedEffects: number;
  unsupportedEffects: number;
  coverageRatio: number;
  byOperation: Record<
    | "set"
    | "add"
    | "or"
    | "and"
    | "multiply"
    | "divide"
    | "mod"
    | "set-bit"
    | "clear-bit"
    | "display-name"
    | "fish-ledger"
    | "string-set",
    number
  >;
  unsupportedByReason: Record<KojoEffectUnsupportedReason, number>;
  unsupportedByCategory: KojoEffectUnsupportedCategoryEntry[];
  nonDirectEffectCount: number;
  deferredCallCount: number;
  topUnsupported: { raw: string; reason: string; count: number }[];
}

interface BundleVariant {
  byCommand?: Record<string, KojoNode>;
  byEventArm?: Record<string, KojoNode>;
  bySpEvent?: Record<string, KojoNode>;
  byEncounter?: KojoNode;
  byDiaryExist?: KojoNode;
  byDiaryText?: Record<string, KojoNode>;
  byDiaryBeforeCheck?: KojoNode;
  byDiaryAfterCheck?: KojoNode;
  byDiaryHappens?: Record<string, KojoNode>;
}

interface BundleLike {
  byChara?: Record<string, { variants?: Record<string, BundleVariant> }>;
}

function roots(bundle: BundleLike): KojoNode[] {
  const out: KojoNode[] = [];
  for (const chara of Object.values(bundle.byChara ?? {})) {
    for (const variant of Object.values(chara.variants ?? {})) {
      for (const group of [
        variant.byCommand,
        variant.byEventArm,
        variant.bySpEvent,
        variant.byDiaryText,
        variant.byDiaryHappens,
      ]) {
        if (group) out.push(...Object.values(group));
      }
      for (const node of [
        variant.byEncounter,
        variant.byDiaryExist,
        variant.byDiaryBeforeCheck,
        variant.byDiaryAfterCheck,
      ]) {
        if (node) out.push(node);
      }
    }
  }
  return out;
}

const CATEGORY_META: Readonly<Record<KojoEffectUnsupportedCategory, Omit<KojoEffectUnsupportedCategoryEntry, "category" | "count" | "samples">>> = {
  "display-command-text": {
    scope: "syntax",
    description: "PRINT/HTML_PRINT text mistaken for assignment because the text contains '='.",
    nextStep: "Fix assignment detection to parse display commands before assignment fallback.",
  },
  "helper-call": {
    scope: "deferred-call",
    description: "CALL/TRYCALL helper invocation; it may emit text or mutate state outside direct-effect IR.",
    nextStep: "Port individually with a source-backed host handler; do not add generic recursive CALL execution.",
  },
  "selector-structure": {
    scope: "syntax",
    description: "SELECTCASE/CASE IS structure rejected while building the static control-flow tree.",
    nextStep: "Add selector expressions and relational CASE arms to the importer.",
  },
  "condition-fragment": {
    scope: "syntax",
    description: "A comparison/boolean fragment was routed through the assignment fallback.",
    nextStep: "Recognize condition fragments before assignment parsing.",
  },
  "loop-control": {
    scope: "syntax",
    description: "BREAK/CONTINUE landed outside the parser's recognized loop frame.",
    nextStep: "Preserve the surrounding loop/CALL structure before changing runtime semantics.",
  },
  "loop-header": {
    scope: "syntax",
    description: "FOR/REPEAT header uses a bound or expression the importer cannot evaluate.",
    nextStep: "Add bounded dynamic loop headers with explicit limits.",
  },
  "bit-operation": {
    scope: "direct-effect-gap",
    description: "SETBIT/CLEARBIT has a dynamic target or unsupported value expression.",
    nextStep: "Resolve the target namespace/index, then reuse the existing bit-effect commit path.",
  },
  "local-variable": {
    scope: "direct-effect-gap",
    description: "LOCAL/LOCALS or named #DIM/#DIMS storage has an unsupported expression or index.",
    nextStep: "Expand local expression/index parsing without treating local storage as persistent state.",
  },
  "string-state": {
    scope: "direct-effect-gap",
    description: "String state such as CSTR, MASTERNAME, CALLNAME, or resource-name buffers is not modeled.",
    nextStep: "Add an explicit string-state owner and transactional write contract.",
  },
  "result-state": {
    scope: "direct-effect-gap",
    description: "RESULT/RESULTS assignment needs a supported expression or continuation value.",
    nextStep: "Complete result-slot expression evaluation before committing the route.",
  },
  "dynamic-target": {
    scope: "direct-effect-gap",
    description: "Target character/index comes from ARG, TARGET, LOCAL, or [[...]] indirection.",
    nextStep: "Resolve dynamic targets through canonical state helpers and reject ambiguous targets.",
  },
  "compound-assignment": {
    scope: "direct-effect-gap",
    description: "Compound arithmetic/bit assignment is outside the currently approved effect IR.",
    nextStep: "Lower each operator to a checked read-modify-write effect.",
  },
  "unmodeled-namespace": {
    scope: "direct-effect-gap",
    description: "The target namespace has no modern state owner in the Kojo effect layer.",
    nextStep: "Assign an authoritative runtime owner before adding an importer mapping.",
  },
  "state-assignment-expression": {
    scope: "direct-effect-gap",
    description: "A state assignment has an expression or target not covered by the approved numeric subset.",
    nextStep: "Extend expression evaluation only for a named namespace with regression coverage.",
  },
  "return-expression": {
    scope: "direct-effect-gap",
    description: "RETURN expression could not be lowered to a typed value.",
    nextStep: "Add the missing value helper or preserve the function as explicitly unsupported.",
  },
  other: {
    scope: "direct-effect-gap",
    description: "Unsupported node not matched by a more specific audit category.",
    nextStep: "Inspect the raw source and add a narrow category before implementing it.",
  },
};

const CATEGORY_ORDER: readonly KojoEffectUnsupportedCategory[] = [
  "display-command-text",
  "helper-call",
  "selector-structure",
  "condition-fragment",
  "loop-control",
  "loop-header",
  "bit-operation",
  "local-variable",
  "string-state",
  "result-state",
  "dynamic-target",
  "compound-assignment",
  "unmodeled-namespace",
  "state-assignment-expression",
  "return-expression",
  "other",
];

const DISPLAY_COMMAND_RE = /^(?:HTML_PRINT|PRINT(?:FORM(?:W|D|DL|L)?|W|D|DL|L)?|PRINTBUTTON)\b/i;
const DYNAMIC_TARGET_RE = /(?:^|:)ARG\b|(?:^|:)TARGET\b|(?:^|:)LOCAL\b|\[\[|\]\]|\(TARGET\)/i;
const COMPOUND_ASSIGNMENT_RE = /(?:\+=|-=|\*=|\/=|\|=|&=|=\+|=-|=\*|=\/)/;
const UNMODELED_NAMESPACE_RE = /^(?:DOWNBASE|MAXBASE|PALAM|JUEL|EQUIP|TEQUIP|STAIN|ITEM|MONEY|WEATHER|DIARY|MAX_DIARY_PAGE|PANTS_TEMP|SELECTCCOM|SOURCE|TIME)\b/i;

function isConditionFragment(raw: string): boolean {
  if (/^(?:&&|\|\||!RAND\b)/.test(raw)) return true;
  if (!/(?:==|!=|>=|<=|>|<)/.test(raw)) return false;
  // A comparison before any standalone assignment is a predicate fragment,
  // not a state write. This catches multiline IF/CASE tails that otherwise
  // trip the parser's intentionally conservative assignment fallback.
  const comparison = raw.search(/(?:==|!=|>=|<=|>|<)/);
  const assignment = raw.search(/(^|[^=!<>])=(?!=)/);
  return assignment < 0 || comparison < assignment;
}

export function classifyUnsupportedEffect(raw: string, reason: string): KojoEffectUnsupportedCategory {
  if (DISPLAY_COMMAND_RE.test(raw)) return "display-command-text";
  if (/^(?:CALL|TRYCALL)\b/i.test(raw)) return "helper-call";
  if (/^(?:SETBIT|CLEARBIT)\b/i.test(raw)) return "bit-operation";
  if (/^(?:SELECTCASE|CASE)\b/i.test(raw)) return "selector-structure";
  if (/^(?:BREAK|CONTINUE)\b/i.test(raw) || /loop control/i.test(reason)) return "loop-control";
  if (/^(?:FOR|REPEAT)\b/i.test(raw) || /unsupported (?:FOR|REPEAT) /i.test(reason)) return "loop-header";
  if (isConditionFragment(raw)) return "condition-fragment";
  if (/^unsupported (?:LOCAL|LOCALS|#DIM|#DIMS)/i.test(reason) || /^(?:LOCAL|LOCALS)\b/i.test(raw)) return "local-variable";
  if (/^(?:RESULT|RESULTS)\b/i.test(raw) || /^unsupported RESULT assignment/i.test(reason)) return "result-state";
  if (/^(?:CSTR|MASTERNAME|CALLNAME|picResource|NICKNAME)\s*:/i.test(raw)) return "string-state";
  if (DYNAMIC_TARGET_RE.test(raw)) return "dynamic-target";
  if (COMPOUND_ASSIGNMENT_RE.test(raw)) return "compound-assignment";
  if (/^unsupported RETURN/i.test(reason) || /^RETURN\b/i.test(raw)) return "return-expression";
  if (UNMODELED_NAMESPACE_RE.test(raw)) return "unmodeled-namespace";
  if (/=/u.test(raw)) return "state-assignment-expression";
  return "other";
}

export function analyzeKojoEffectCoverage(bundle: BundleLike): KojoEffectCoverage {
  const supported: KojoEffectCoverage["byOperation"] = {
    set: 0,
    add: 0,
    or: 0,
    and: 0,
    multiply: 0,
    divide: 0,
    mod: 0,
    "set-bit": 0,
    "clear-bit": 0,
    "display-name": 0,
    "fish-ledger": 0,
    "string-set": 0,
  };
  const unsupported: KojoEffectCoverage["unsupportedByReason"] = {
    "unsupported-assignment": 0,
    "unsupported-bit-operation": 0,
  };
  const raw = new Map<string, { reason: string; count: number }>();
  const categories = new Map<KojoEffectUnsupportedCategory, { count: number; samples: { raw: string; reason: string }[] }>();
  const visit = (node: KojoNode): void => {
    switch (node.type) {
      case "lines":
      case "local-set":
      case "result-set":
      case "return":
      case "effect":
        if (node.type === "effect") supported[node.effect.kind]++;
        return;
      case "unsupported-effect": {
        const reason: KojoEffectUnsupportedReason =
          node.raw.startsWith("SETBIT") || node.raw.startsWith("CLEARBIT")
            ? "unsupported-bit-operation"
            : "unsupported-assignment";
        unsupported[reason]++;
        const current = raw.get(node.raw);
        raw.set(node.raw, { reason: node.reason, count: (current?.count ?? 0) + 1 });
        const category = classifyUnsupportedEffect(node.raw, node.reason);
        const categoryEntry = categories.get(category) ?? { count: 0, samples: [] };
        categoryEntry.count++;
        if (categoryEntry.samples.length < 5) categoryEntry.samples.push({ raw: node.raw, reason: node.reason });
        categories.set(category, categoryEntry);
        return;
      }
      case "seq":
        node.children.forEach(visit);
        return;
      case "if":
        node.arms.forEach((arm) => visit(arm.body));
        return;
      case "rand":
        node.cases.forEach(visit);
        return;
      case "for":
        visit(node.body);
        return;
      case "repeat":
        visit(node.body);
        return;
      case "while":
        visit(node.body);
        return;
      case "break":
      case "continue":
        return;
      case "select":
        node.cases.forEach((candidate) => visit(candidate.body));
        if (node.defaultCase) visit(node.defaultCase);
        return;
      case "choice":
        node.options.forEach((option) => visit(option.body));
        return;
      case "input":
        node.options.forEach((option) => visit(option.body));
        return;
    }
  };

  const allRoots = roots(bundle);
  allRoots.forEach(visit);
  const supportedCount = Object.values(supported).reduce((sum, value) => sum + value, 0);
  const unsupportedCount = Object.values(unsupported).reduce((sum, value) => sum + value, 0);
  const unsupportedByCategory = CATEGORY_ORDER.flatMap((category) => {
    const entry = categories.get(category);
    if (!entry) return [];
    return [{
      category,
      count: entry.count,
      ...CATEGORY_META[category],
      samples: entry.samples,
    }];
  });
  return {
    trees: allRoots.length,
    supportedEffects: supportedCount,
    unsupportedEffects: unsupportedCount,
    coverageRatio: supportedCount + unsupportedCount === 0
      ? 1
      : supportedCount / (supportedCount + unsupportedCount),
    byOperation: supported,
    unsupportedByReason: unsupported,
    unsupportedByCategory,
    nonDirectEffectCount: unsupportedByCategory
      .filter((entry) => entry.scope === "syntax")
      .reduce((sum, entry) => sum + entry.count, 0),
    deferredCallCount: unsupportedByCategory
      .filter((entry) => entry.scope === "deferred-call")
      .reduce((sum, entry) => sum + entry.count, 0),
    topUnsupported: [...raw.entries()]
      .map(([rawEffect, value]) => ({ raw: rawEffect, ...value }))
      .sort((a, b) => b.count - a.count || a.raw.localeCompare(b.raw))
      .slice(0, 100),
  };
}
