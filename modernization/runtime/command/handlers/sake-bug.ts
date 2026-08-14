/**
 * FARM-BREW B3 — `COMF450 酒虫の様子を見る` (tend the sake-bug jar), a B9
 * command. Faithful to `@COM450` / `@COM_ABLE450`
 * (`ERB/コマンド関連/COMF/日常系/COMF450 酒虫の様子を見る.ERB`). The brewing
 * graph + swap/mix engines live in `runtime/state/brewing.ts`.
 *
 * **Menu (`@COM450` ASK_M, flattened to one pick_one):**
 *   - 替换成 VAR_WATER — swap the carried water in, extracting the brew. The
 *     nested feed ASK_M (鱼粕/肉骨粉) is flattened: a "+喂鱼粕"/"+喂肉骨粉"
 *     option appears only when that item is held.
 *   - 添加物品 (`MIX_MENU`) — each `ADDITIONS` recipe whose ingredients are
 *     held becomes a direct option (the submenu is flattened away). Base
 *     waters only while `@CAN_FERMENT` (DAY:10<3).
 *   - 操纵时间造酒 (`TSP>=2400`) — spend 2400 灵力, run one `@酒造`.
 *   - 『绯红之王』 (`TSP>=4000 && ITEM:绯红之王 && 変化先!=""`) — spend 4000 +
 *     the item, `DAY:10 += 9`, run one `@酒造`.
 *   Then `TIME += 5` (or, under time-stop, `BASE:TSP -= 15`).
 *
 * **execCheck (`@COM_ABLE450`):** FLAG:70 時間停止 (non-DLC) → block; location
 * must be `拠点_酒虫` (default 神社:厨房 — the movable jar home + the
 * KITCHEN+ITEM:982 DLC alt are deferred); CFLAG:诶嘿嘿 (any) → block.
 * TFLAG:100 / GLOBAL_COMABLE deferred (pass).
 *
 * **DEFERRED (documented):** movable 拠点_酒虫 (SHOP_住環境設定); MAGIC_DLC
 * 時間因子 (time-stop TSP arm blocked here, faithful non-DLC); MAGIC_DLC
 * 醸造数 boosts; `BREWING_GUIDE_CONSUME` 図鑑 consumed-tracking; the greyed
 * "material insufficient / 発酵过头" MIX_MENU rows (we only surface craftable
 * recipes).
 */

import type { GameState } from "../../state/game-state.js";
import type { HandlerEntry } from "../types.js";
import type { PromptSpec, PromptOption } from "../prompt.js";
import { cloneGameState } from "../../state/game-state.js";
import {
  BASE_ID,
  CFLAG_ID,
  FLAG_ID,
  advanceTimeTicks,
  getMasterBase,
  getMasterCflag,
  setMasterBase,
} from "../../state/settlement.js";
import { pickOne, requirePickOne } from "../prompt.js";
import { hasItem, removeItem } from "../../state/items.js";
import {
  BREW_FEED,
  applyBrewAddition,
  brewAdditions,
  brewIngredientItemId,
  canFerment,
  currentFerment,
  fermentTarget,
  isBaseWater,
  runBrewTick,
  swapWater,
  type BrewAddition,
} from "../../state/brewing.js";

/** 拠点_酒虫 default (P8廚房). Movable home deferred. */
const JAR_LOCATION = "神社:厨房";
/** 绯红之王 (item 871) — the time-erasure catalyst. */
const CRIMSON_KING = 871;
const TSP_MANIPULATE = 2400;
const TSP_CRIMSON = 4000;

/** All ingredients of a recipe are held; unknown ids fail closed. */
function canCraft(state: GameState, add: BrewAddition): boolean {
  return add.ingredients.every((ing) => {
    const id = brewIngredientItemId(ing.item);
    // Unmapped raw produce (山葡萄/药草/…) isn't tracked → treat as available
    // so the recipe is still offerable (faithful: those farm items exist).
    return id != null && hasItem(state, id, ing.qty);
  });
}

function jarPrompt(state: GameState): PromptSpec {
  const current = currentFerment(state);
  const options: PromptOption[] = [];
  const water = state.varWater ?? "";

  // 替换水 (+ optional feed).
  if (water !== "") {
    options.push({ id: "swap", label: `替换成${water}（取出${current}）` });
    if (hasItem(state, BREW_FEED.鱼粕)) {
      options.push({ id: "swap_fish", label: `替换成${water} + 喂鱼粕` });
    }
    if (hasItem(state, BREW_FEED.肉骨粉)) {
      options.push({ id: "swap_bone", label: `替换成${water} + 喂肉骨粉` });
    }
  }

  // 添加物品 — direct addition options.
  const eligibleAdditions = !isBaseWater(current) || canFerment(state, current);
  if (eligibleAdditions) {
    const adds = brewAdditions(current);
    for (let i = 0; i < adds.length; i++) {
      const add = adds[i]!;
      if (!canCraft(state, add)) continue;
      const ingLabel = add.ingredients.map((g) => `${g.item}×${g.qty}`).join("+");
      options.push({ id: `add:${i}`, label: `加入 ${ingLabel} → ${add.result}` });
    }
  }

  // TSP shortcuts (need a fermentation target).
  const canAccelerate = fermentTarget(current) != null;
  const tsp = getMasterBase(state, BASE_ID.TSP);
  if (canAccelerate && tsp >= TSP_MANIPULATE) {
    options.push({ id: "tsp", label: `操纵时间造酒（消费灵力${TSP_MANIPULATE}）` });
  }
  if (canAccelerate && tsp >= TSP_CRIMSON && hasItem(state, CRIMSON_KING)) {
    options.push({ id: "crimson", label: `『绯红之王』！（消费灵力${TSP_CRIMSON} + 绯红之王）` });
  }

  return pickOne(`酒虫之瓶里装满了${current}…`, options);
}

function checkEligible(
  state: GameState,
): { ok: true } | { ok: false; reason: { kind: "precondition"; message: string } } {
  // FLAG:70 時間停止 (non-DLC 時間因子 deferred → block).
  if ((state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "时间停止中无法照料酒虫。" } };
  }
  // 位置 != 拠点_酒虫 (神社:厨房 default).
  if (state.master.location !== JAR_LOCATION) {
    return { ok: false, reason: { kind: "precondition", message: "酒虫之瓶不在这里。" } };
  }
  // The imported pilot save has not run ROOMSETTING's `拠点_酒虫`
  // initialization. Without a persisted VAR_FERMENT/VAR_WATER there is no
  // jar to inspect, so ordinary kitchen fixtures must not expose 450. Once
  // the jar state is created by the brewing/water commands, the normal P8
  // location becomes valid again.
  if (state.varFerment === undefined && state.varWater === undefined) {
    return { ok: false, reason: { kind: "precondition", message: "酒虫之瓶尚未设置。" } };
  }
  // CFLAG:诶嘿嘿 (any) → block.
  if (getMasterCflag(state, CFLAG_ID.诶嘿嘿) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "现在不是照料酒虫的时候。" } };
  }
  return { ok: true };
}

export const sakeBug450HandlerEntry: HandlerEntry = {
  commandNo: 450,
  prompt: (ctx) => jarPrompt(ctx.state),
  execCheck: (ctx) => {
    const r = checkEligible(ctx.state);
    return r.ok ? { ok: true } : { ok: false, reason: r.reason };
  },
  handler: (ctx) => {
    const next: GameState = cloneGameState(ctx.state);
    const picked = requirePickOne(jarPrompt(next), ctx.promptAnswer);

    // 什么也不做 (no valid pick) → RETURN -1, no turn.
    if (picked == null) {
      return {
        state: next,
        events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text: "离开了酒虫之瓶。" }],
        outcome: "noop" as const,
      };
    }
    const id = String(picked);
    const messages: string[] = [];

    if (id === "swap" || id === "swap_fish" || id === "swap_bone") {
      const feed = id === "swap_fish" ? "fish" : id === "swap_bone" ? "bone" : "none";
      messages.push(...swapWater(next, ctx.rng, feed));
    } else if (id.startsWith("add:")) {
      const add = brewAdditions(currentFerment(next))[Number(id.slice(4))];
      if (add) messages.push(...applyBrewAddition(next, add));
    } else if (id === "tsp") {
      setMasterBase(next, BASE_ID.TSP, getMasterBase(next, BASE_ID.TSP) - TSP_MANIPULATE);
      messages.push("操纵瓶中的时间，强行推进了酿造。");
      messages.push(...runBrewTick(next));
    } else if (id === "crimson") {
      setMasterBase(next, BASE_ID.TSP, getMasterBase(next, BASE_ID.TSP) - TSP_CRIMSON);
      removeItem(next, CRIMSON_KING, 1);
      next.brewDays = (next.brewDays ?? 0) + 9;
      messages.push("消除了瓶中的时间，得到了『结果』。");
      messages.push(...runBrewTick(next));
    }

    // TIME += 5 (time-stop is blocked at execCheck, so the TSP arm is dead —
    // the non-DLC posture; kept implicit).
    advanceTimeTicks(next, 5);

    return {
      state: next,
      events: messages.map((text) => ({ kind: "NARRATION" as const, timestamp: ctx.now(), text })),
      outcome: "ok" as const,
    };
  },
};
