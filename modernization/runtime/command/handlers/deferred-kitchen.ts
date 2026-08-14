/** COM425 下药 — choose and consume a supported additive for drugged tea. */

import type { CommandContext, HandlerEntry } from "../types.js";
import { cloneGameState } from "../../state/game-state.js";
import {
  BASE_ID,
  CFLAG_ID,
  FLAG_ID,
  advanceTimeTicks,
  getMasterBase,
  setMasterBase,
} from "../../state/settlement.js";
import { getTflag, setTflag, TFLAG_ID } from "../../state/tflag.js";
import { itemCount, removeItem } from "../../state/items.js";
import { roomProps } from "../comable/room-props.js";
import { hasPlace, PLACE_KITCHEN } from "../../world/place-flags.js";
import { placeFlagsOf } from "../../world/location-predicates.js";
import { pickOne, requirePickOne, type PromptSpec } from "../prompt.js";

const DRUG_ITEMS = [
  { id: 41, name: "媚药" },
  { id: 42, name: "利尿剂" },
  { id: 47, name: "新鲜精液" },
  { id: 250, name: "催情药" },
  { id: 252, name: "睡眠药" },
] as const;

function drugPrompt(state: Readonly<CommandContext["state"]>): PromptSpec | null {
  const options = DRUG_ITEMS
    .filter((item) => itemCount(state as CommandContext["state"], item.id) > 0)
    .map((item) => ({
      id: item.id,
      label: `${item.name} ×${itemCount(state as CommandContext["state"], item.id)}`,
    }));
  return options.length > 0 ? pickOne("要在茶里加入什么？", options) : null;
}

function kitchen(state: CommandContext["state"]): boolean {
  return roomProps(state.master.location).indoor &&
    hasPlace(placeFlagsOf(state.master.location), PLACE_KITCHEN);
}

function check425(ctx: CommandContext) {
  const state = ctx.state;
  // Witnesses prevent drugging unless time is stopped.
  if (ctx.target > 0 && (state.flagStore[FLAG_ID.時間停止] ?? 0) === 0)
    return { ok: false as const, reason: { kind: "precondition" as const, message: "有人在场，不能偷偷下药。" } };
  if (!kitchen(state))
    return { ok: false as const, reason: { kind: "precondition" as const, message: "需要在厨房下药。" } };
  if ((state.master.state.BASE[BASE_ID.気力] ?? 0) <= 0)
    return { ok: false as const, reason: { kind: "precondition" as const, message: "气力不足。" } };
  if ((state.master.state.CFLAG[CFLAG_ID.诶嘿嘿] ?? 0) === 2)
    return { ok: false as const, reason: { kind: "precondition" as const, message: "当前状态不能下药。" } };
  if (getTflag(state, TFLAG_ID.下药选择) !== 0)
    return { ok: false as const, reason: { kind: "precondition" as const, message: "当前已有药品选择。" } };
  if (!drugPrompt(state))
    return { ok: false as const, reason: { kind: "precondition" as const, message: "没有可用于下药的道具。" } };
  return { ok: true as const };
}

export const comf425HandlerEntry: HandlerEntry = {
  commandNo: 425,
  execCheck: check425,
  prompt: (ctx) => drugPrompt(ctx.state),
  handler: (ctx) => {
    const next = cloneGameState(ctx.state);
    const spec = drugPrompt(next);
    const selected = spec ? requirePickOne(spec, ctx.promptAnswer) : null;
    const item = DRUG_ITEMS.find((candidate) => candidate.id === selected);
    if (!item || itemCount(next, item.id) <= 0) {
      return {
        state: next,
        events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text: "没有选择要加入茶中的药。" }],
        outcome: "noop" as const,
      };
    }
    removeItem(next, item.id, 1);
    setTflag(next, TFLAG_ID.下药选择, item.id);
    if ((next.flagStore[FLAG_ID.時間停止] ?? 0) !== 0) {
      setMasterBase(next, BASE_ID.TSP, getMasterBase(next, BASE_ID.TSP) - 30);
    } else {
      advanceTimeTicks(next, 10);
    }
    return {
      state: next,
      events: [{
        kind: "NARRATION" as const,
        timestamp: ctx.now(),
        text: `准备好了加入${item.name}的茶。`,
      }],
      outcome: "ok" as const,
    };
  },
};
