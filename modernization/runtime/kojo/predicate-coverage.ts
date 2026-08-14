import { parsePredicate } from "../../importer/kojo/parser.js";
import type { KojoNode, KojoPredicate, KojoValue } from "./types.js";
import { isFunctionCallPredicateSupported, isFunctionCallValueSupported } from "./static-router.js";

export type KojoUnsupportedReason =
  | "unsupported-runtime-namespace"
  | "unsupported-function"
  | "unknown-symbol"
  | "unsupported-expression";

export interface KojoPredicateCoverage {
  trees: number;
  nodes: number;
  predicates: number;
  supportedPredicates: number;
  unsupportedPredicates: number;
  sourceUnknownPredicates: number;
  coverageRatio: number;
  unsupportedByReason: Record<KojoUnsupportedReason, number>;
  unsupported: { raw: string; count: number; reason: KojoUnsupportedReason }[];
  topUnsupported: { raw: string; count: number; reason: KojoUnsupportedReason }[];
}

interface KojoBundleVariant {
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

interface KojoBundleLike {
  byChara?: Record<string, { variants?: Record<string, KojoBundleVariant> }>;
}

function collectVariantRoots(variant: KojoBundleVariant): KojoNode[] {
  const roots: KojoNode[] = [];
  for (const group of [
    variant.byCommand,
    variant.byEventArm,
    variant.bySpEvent,
    variant.byDiaryText,
    variant.byDiaryHappens,
  ]) {
    if (group) roots.push(...Object.values(group));
  }
  for (const node of [
    variant.byEncounter,
    variant.byDiaryExist,
    variant.byDiaryBeforeCheck,
    variant.byDiaryAfterCheck,
  ]) {
    if (node) roots.push(node);
  }
  return roots;
}

export function collectKojoBundleRoots(bundle: KojoBundleLike): KojoNode[] {
  const roots: KojoNode[] = [];
  for (const chara of Object.values(bundle.byChara ?? {})) {
    for (const variant of Object.values(chara.variants ?? {})) {
      roots.push(...collectVariantRoots(variant));
    }
  }
  return roots;
}

interface MutableCoverage extends Omit<KojoPredicateCoverage, "coverageRatio" | "unsupported" | "topUnsupported"> {
  unsupportedRaw: Map<string, { count: number; reason: KojoUnsupportedReason }>;
}

function valueSupported(value: KojoValue): boolean {
  switch (value.kind) {
    case "var":
      return true;
    case "dynamic_var":
      return valueSupported(value.id);
    case "room_data":
      return valueSupported(value.room);
    case "weekday_test":
      return valueSupported(value.day);
    case "add":
      return value.parts.every(valueSupported);
    case "binary":
      return valueSupported(value.left) && valueSupported(value.right);
    case "get_bit":
      return valueSupported(value.value) && valueSupported(value.bit);
    case "map_id":
      return valueSupported(value.value);
    case "get_charahome":
      return valueSupported(value.subject);
    case "yogore":
      return valueSupported(value.room);
    case "cannot_danmaku":
      return true;
    case "estrus_cycle":
      return valueSupported(value.subject);
    case "is_drunk":
      return valueSupported(value.subject);
    case "alcohol_taste":
      return valueSupported(value.item);
    case "shirahu":
      return valueSupported(value.subject);
    case "has_penis":
      return valueSupported(value.subject);
    case "gender_test":
      return valueSupported(value.subject);
    case "same_sex":
      return valueSupported(value.left) && valueSupported(value.right);
    case "virgin_test":
      return valueSupported(value.subject);
    case "fallen":
      return valueSupported(value.subject);
    case "angry":
      return valueSupported(value.subject);
    case "in_heat":
      return valueSupported(value.subject);
    case "is_lover":
      return valueSupported(value.subject);
    case "is_dating_with_player":
      return valueSupported(value.subject);
    case "is_sexing":
      return valueSupported(value.subject);
    case "is_master":
      return value.subjects.every(valueSupported);
    case "weather_test":
      return true;
    case "is_nonhuman":
      return valueSupported(value.subject);
    case "is_library":
      return valueSupported(value.place) && valueSupported(value.permission);
    case "is_standing_sex":
      return valueSupported(value.command);
    case "erect":
      return valueSupported(value.subject);
    case "is_here":
      return value.subjects.every(valueSupported);
    case "group_match":
      return valueSupported(value.value) && value.candidates.every(valueSupported);
    case "k60_attitude":
      return value.argument === undefined || valueSupported(value.argument);
    case "k49_relationship":
      return value.subject === undefined || valueSupported(value.subject);
    case "find_around":
    case "find_lover":
    case "be_seen":
    case "form_k113":
    case "nemuke":
    case "lover_count":
      return true;
    case "get_month":
      return value.season === undefined || valueSupported(value.season);
    case "moon_watch":
      return valueSupported(value.date) && (value.ignoreLocation === undefined || valueSupported(value.ignoreLocation));
    case "name_moon":
      return valueSupported(value.date);
    case "date_name":
      return value.untranslated === undefined || valueSupported(value.untranslated);
    case "cmatch":
      return valueSupported(value.expected);
    case "taste_reaction":
    case "k17_master_alice_child":
    case "k60_has_fucked_parsee":
      return true;
    case "k70_helper":
      return value.subjects.every(valueSupported);
    case "k83_helper":
      return valueSupported(value.subject);
    case "authored_state_helper":
      return value.args.every(valueSupported);
    case "where_about":
      return true;
    case "k15_helper":
      return value.argument === undefined || valueSupported(value.argument);
    case "function-call-stub":
      // Task #3: predicates like `FUNC() == 3` wrap a stub inside
      // `truthy { value: function-call-stub }`. Value-side stub is
      // still valid — runtime delegates to `evaluateValue` (numeric) /
      // `evaluateFunctionCallPredicate` (boolean). Counted as supported.
      return isFunctionCallValueSupported(value.name);
    default:
      return true;
  }
}

function classifyUnknown(raw: string): KojoUnsupportedReason {
  if (/\bNOWEX:/.test(raw)) return "unsupported-runtime-namespace";
  if (/[A-Za-z_\u3040-\u30ff\u3400-\u9fff][\w\u3040-\u30ff\u3400-\u9fff]*\s*\(/u.test(raw)) {
    return "unsupported-function";
  }
  if (
    /\b(?:TALENT|CFLAG|FLAG|ITEM|TFLAG|TCVAR|ABL|BASE|MAXBASE|EXP|PALAM|SOURCE|TEQUIP|MARK|EX|NOWEX):/u.test(
      raw,
    )
  ) {
    return "unknown-symbol";
  }
  return "unsupported-expression";
}

function recordUnsupported(
  coverage: MutableCoverage,
  raw: string,
  reason: KojoUnsupportedReason,
): void {
  coverage.unsupportedPredicates++;
  coverage.unsupportedByReason[reason]++;
  const current = coverage.unsupportedRaw.get(raw);
  if (current) current.count++;
  else coverage.unsupportedRaw.set(raw, { count: 1, reason });
}

function inspectPredicate(predicate: KojoPredicate, coverage: MutableCoverage): void {
  coverage.predicates++;
  switch (predicate.kind) {
    case "unknown_var_nonzero":
      recordUnsupported(
        coverage,
        `${predicate.ns}:${predicate.scope}:${predicate.id}`,
        "unknown-symbol",
      );
      return;
    case "function-call":
      // Task #3: predicate-side `NAME(args...)` shape. Runtime consults
      // the function-call registry first; a registered handler returns a
      // real value; an unregistered one returns false with a non-fatal
      // `unknown-function:<name>` diagnostic. Either way the predicate
      // is structurally recognised and counts as supported.
      if (!isFunctionCallPredicateSupported(predicate.name)) {
        recordUnsupported(
          coverage,
          `${predicate.name}(${predicate.args.join(", ")})`,
          "unsupported-function",
        );
      }
      return;
    case "system_var_compare":
      // Task #4: bare-identifier comparison (`MODE == "指令"`,
      // `iRT >= K17C_恋慕`, `LOCALS == ""`, …). Both sides are kept as
      // strings; runtime consults `systemVarAccessor` for each side.
      // When a side has no binding the whole comparison returns false
      // (no diagnostic). The route stays supported.
      recordUnsupported(
        coverage,
        `${predicate.left} ${predicate.op} ${predicate.right}`,
        "unsupported-expression",
      );
      return;
    case "unknown": {
      coverage.sourceUnknownPredicates++;
      const promoted = parsePredicate(predicate.raw);
      if (promoted.kind !== "unknown") {
        inspectPredicate(promoted, coverage);
        return;
      }
      recordUnsupported(coverage, predicate.raw, classifyUnknown(predicate.raw));
      return;
    }
    case "not":
      inspectPredicate(predicate.inner, coverage);
      return;
    case "and":
    case "or":
      for (const part of predicate.parts) inspectPredicate(part, coverage);
      return;
    case "truthy":
      if (valueSupported(predicate.value)) coverage.supportedPredicates++;
      else recordUnsupported(coverage, JSON.stringify(predicate.value), "unsupported-runtime-namespace");
      return;
    case "compare":
      if (valueSupported(predicate.left) && valueSupported(predicate.right)) {
        coverage.supportedPredicates++;
      } else {
        recordUnsupported(coverage, JSON.stringify(predicate), "unsupported-runtime-namespace");
      }
      return;
    case "alcohol_face_compare":
      if (valueSupported(predicate.subject)) coverage.supportedPredicates++;
      else recordUnsupported(coverage, JSON.stringify(predicate), "unsupported-runtime-namespace");
      return;
    default:
      coverage.supportedPredicates++;
  }
}

function inspectNode(node: KojoNode, coverage: MutableCoverage): void {
  coverage.nodes++;
  switch (node.type) {
    case "lines":
    case "local-set":
    case "result-set":
    case "return":
    case "effect":
    case "unsupported-effect":
      return;
    case "seq":
      for (const child of node.children) inspectNode(child, coverage);
      return;
    case "if":
      for (const arm of node.arms) {
        inspectPredicate(arm.predicate, coverage);
        inspectNode(arm.body, coverage);
      }
      return;
    case "rand":
      for (const child of node.cases) inspectNode(child, coverage);
      return;
    case "for":
      inspectNode(node.body, coverage);
      return;
    case "repeat":
      inspectNode(node.body, coverage);
      return;
    case "while":
      inspectPredicate(node.predicate, coverage);
      inspectNode(node.body, coverage);
      return;
    case "break":
    case "continue":
      return;
    case "select":
      if (!valueSupported(node.selector)) {
        recordUnsupported(coverage, JSON.stringify(node.selector), "unsupported-runtime-namespace");
      }
      for (const candidate of node.cases) inspectNode(candidate.body, coverage);
      if (node.defaultCase) inspectNode(node.defaultCase, coverage);
      return;
    case "choice":
      for (const option of node.options) inspectNode(option.body, coverage);
      return;
    case "input":
      for (const option of node.options) inspectNode(option.body, coverage);
      return;
  }
}

export function analyzeKojoPredicateCoverage(
  roots: readonly KojoNode[],
): KojoPredicateCoverage {
  const coverage: MutableCoverage = {
    trees: roots.length,
    nodes: 0,
    predicates: 0,
    supportedPredicates: 0,
    unsupportedPredicates: 0,
    sourceUnknownPredicates: 0,
    unsupportedByReason: {
      "unsupported-runtime-namespace": 0,
      "unsupported-function": 0,
      "unknown-symbol": 0,
      "unsupported-expression": 0,
    },
    unsupportedRaw: new Map(),
  };

  for (const root of roots) inspectNode(root, coverage);

  const denominator = coverage.supportedPredicates + coverage.unsupportedPredicates;
  const unsupported = [...coverage.unsupportedRaw.entries()]
    .map(([raw, value]) => ({ raw, ...value }))
    .sort((a, b) => b.count - a.count || a.raw.localeCompare(b.raw));
  return {
    trees: coverage.trees,
    nodes: coverage.nodes,
    predicates: coverage.predicates,
    supportedPredicates: coverage.supportedPredicates,
    unsupportedPredicates: coverage.unsupportedPredicates,
    sourceUnknownPredicates: coverage.sourceUnknownPredicates,
    coverageRatio: denominator === 0 ? 1 : coverage.supportedPredicates / denominator,
    unsupportedByReason: coverage.unsupportedByReason,
    unsupported,
    // Keep the complete inventory in JSON. The Markdown renderer applies its
    // own presentation cap, while audits need every unique predicate rather
    // than an arbitrary top-100 truncation.
    topUnsupported: unsupported,
  };
}
