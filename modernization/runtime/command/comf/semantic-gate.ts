import type { CommandContext } from "../types.js";
import { CFLAG_ID, getMasterBase } from "../../state/settlement.js";

export type SemanticGateAtom =
  | "target-sleeping"
  | "target-co-sleeping"
  | "target-pranking"
  | "target-working"
  | "master-stamina";

export type SemanticGateCompareOp = "==" | "!=" | ">=" | "<=" | ">" | "<";

export type SemanticGateExpression =
  | { readonly kind: "atom"; readonly atom: SemanticGateAtom }
  | {
      readonly kind: "compare";
      readonly atom: SemanticGateAtom;
      readonly op: SemanticGateCompareOp;
      readonly value: number;
    }
  | { readonly kind: "not"; readonly expression: SemanticGateExpression }
  | {
      readonly kind: "and" | "or";
      readonly expressions: readonly SemanticGateExpression[];
    };

function atomValue(atom: SemanticGateAtom, ctx: CommandContext): number {
  const target = ctx.state.charas[ctx.target];
  switch (atom) {
    case "target-sleeping":
      return target?.state.CFLAG[CFLAG_ID.睡眠] ?? 0;
    case "target-co-sleeping":
      return target?.state.CFLAG[CFLAG_ID.陪睡中] ?? 0;
    case "target-pranking":
      return target?.state.CFLAG[CFLAG_ID.恶作剧] ?? 0;
    case "target-working":
      return target?.state.CFLAG[CFLAG_ID.行动] ?? 0;
    case "master-stamina":
      return getMasterBase(ctx.state, 1) ?? 0;
  }
}

export function evaluateSemanticGateExpression(
  expression: SemanticGateExpression,
  ctx: CommandContext,
): boolean {
  switch (expression.kind) {
    case "atom":
      return atomValue(expression.atom, ctx) !== 0;
    case "not":
      return !evaluateSemanticGateExpression(expression.expression, ctx);
    case "and":
      return expression.expressions.every((part) =>
        evaluateSemanticGateExpression(part, ctx)
      );
    case "or":
      return expression.expressions.some((part) =>
        evaluateSemanticGateExpression(part, ctx)
      );
    case "compare": {
      const left = atomValue(expression.atom, ctx);
      switch (expression.op) {
        case "==": return left === expression.value;
        case "!=": return left !== expression.value;
        case ">=": return left >= expression.value;
        case "<=": return left <= expression.value;
        case ">": return left > expression.value;
        case "<": return left < expression.value;
      }
    }
  }
}
