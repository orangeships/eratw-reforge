import type { CommandContext } from "./types.js";
import { BASE_ID } from "../state/settlement.js";

export type HBaseResourceCosts = Readonly<{
  master?: Readonly<Record<number, number>>;
  target?: Readonly<Record<number, number>>;
}>;

export type HBaseResourceCheckResult =
  | { ok: true }
  | { ok: false; reason: { kind: "precondition"; message: string } };

/** Check declared H-action BASE costs before either a menu or a direct commit. */
export function checkHBaseResourceAvailability(
  ctx: CommandContext,
  costs: HBaseResourceCosts,
): HBaseResourceCheckResult {
  const checkSlot = (
    slot: CommandContext["state"]["master"] | undefined,
    slotCosts: Readonly<Record<number, number>> | undefined,
    owner: "主角" | "目标",
  ): HBaseResourceCheckResult | undefined => {
    if (!slot || !slotCosts) return undefined;
    for (const [idText, rawCost] of Object.entries(slotCosts)) {
      const id = Number(idText);
      const cost = Math.max(0, Math.trunc(rawCost));
      if (cost === 0 || (slot.state.BASE[id] ?? 0) >= cost) continue;
      const resource = id === BASE_ID.体力
        ? "体力"
        : id === BASE_ID.気力
          ? "气力"
          : id === BASE_ID.TSP
            ? "时停资源"
            : `BASE ${id}`;
      return {
        ok: false,
        reason: { kind: "precondition", message: `${owner}${resource}不足，需要 ${cost}。` },
      };
    }
    return undefined;
  };

  const target = ctx.target > 0 ? ctx.state.charas[ctx.target] : undefined;
  return (
    checkSlot(ctx.state.master, costs.master, "主角") ??
    checkSlot(target, costs.target, "目标") ??
    { ok: true }
  );
}
