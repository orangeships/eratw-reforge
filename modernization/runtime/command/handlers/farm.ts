/**
 * FARM-BREW Part A3 — `COMF418 家庭菜園` (kitchen garden), a B9 command.
 *
 * Faithful port of `@COM418` / `@COM_ABLE418`
 * (`ERB/コマンド関連/COMF/日常系/COMF418 家庭菜園.ERB`). The engine
 * (plot state, actions, yields) lives in `runtime/state/farm.ts`; this
 * handler is the command shell: the exec gate, the flattened per-plot
 * action menu, and the `TIME += 行動コスト` settlement.
 *
 * **Menu model (`@SHOW_PLANT` buttons flattened to one pick_one):** the
 * ERB draws a per-plot button grid whose ids encode `plot*100 + 行動番号`,
 * then `@FARMING(RESULT/100, RESULT%100)`. Two of those buttons open a
 * nested picker (種苗 → `@INPLANT` seedling list; 抜出 of a live plant →
 * `ASK_YN`). The synchronous single-shot prompt can't nest, so we flatten:
 *   - 種苗 expands to one option per **owned distinct 苗** ("在畑N种X苗").
 *   - 抜出 of a live pre-ripe plant carries its confirmation in the label
 *     ("拔掉畑N（放弃未成熟的X）") — selecting it IS the ASK_YN 是.
 * Every other action (洒水 / 收获 / 全部收获 / 施肥) is a direct option.
 * Option ids are structured strings decoded in the handler.
 *
 * **execCheck (`@COM_ABLE418`):**
 *   - `!TFLAG:100` (command-screen flag, deferred → treated set).
 *   - `GLOBAL_COMABLE(418)` (batch gate, deferred → pass).
 *   - `!家庭菜園可(現在位置) && !IS_GAP_GUEST` → the location must carry
 *     ROOMDATA `場所_菜園` (modern `PLACE_GARDEN`). 隙間guest deferred.
 *   - `!ITEM:150` 園芸用品一式 → must own the garden kit.
 *   - `BASE:MASTER:気力 <= 0` → out of energy.
 *   - `CFLAG:诶嘿嘿 == 2` → partner-led H hold.
 *   NOTE: `@COM_ABLE418` has **no** time-stop block (the `SIF FLAG:70`
 *   line is commented out upstream); time-stop is handled in the body
 *   (TSP cost instead of TIME), so we do NOT block on it here.
 *
 * **Body time cost (`@COM418`):** `IF FLAG:70 == 0 → TIME += cost` else
 * `BASE:MASTER:TSP -= cost*3` (the time-stop arm). Both modeled.
 *
 * **DEFERRED (documented, faithful-not-fabricated):**
 *   - 自动洒水 (action 4): needs ITEM:簡易泳池 38 + FLAG:泳池 bit2 — the
 *     pool subsystem is unbuilt, so the option never appears.
 *   - IS_GAP_GUEST / GMF 幻想乡大地图 arms of `@家庭菜園可`.
 *   - 三粒の天滴 (402) arms are in the engine but the item is not yet
 *     obtainable (諏訪子 gift event unbuilt) → dormant.
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
import { weatherIndexNow } from "../../state/weather.js";
import { hasPlace, PLACE_GARDEN } from "../../world/place-flags.js";
import { placeFlagsOf } from "../../world/location-predicates.js";
import {
  FARM_ITEM,
  SEEDLINGS,
  canHarvest,
  fertilizePlot,
  getFarm,
  growthStage,
  harvestAll,
  harvestPlot,
  plantSeedling,
  plotCount,
  uprootNeedsConfirm,
  uprootPlot,
  waterPlot,
  type FarmActionResult,
  type FarmRng,
} from "../../state/farm.js";
import { hasItem } from "../../state/items.js";

/**
 * Build the flattened action menu. Only the usable-plot prefix
 * (`plotCount`) is shown, mirroring `@COM418`'s `FOR LOCAL,0,GETUNELENGTH418`.
 */
function farmPrompt(state: GameState): PromptSpec {
  const farm = getFarm(state);
  const count = plotCount(state);
  const options: PromptOption[] = [];
  const hasWater = Boolean(state.varWater);
  const hasFertilizer = hasItem(state, FARM_ITEM.肥料);
  // COMF470 weather gate: plant / water / fertilize blocked in severe weather
  // (snow/storm/extreme; weatherIndex NOT in {0,1,2,3,4,6,7}). Harvest and
  // uproot are always allowed — you can salvage crops in any weather.
  const badWeather = ![0, 1, 2, 3, 4, 6, 7].includes(weatherIndexNow(state.time));
  // Distinct owned 苗 (for the 種苗 expansion), stable Item.csv order.
  const ownedSeedlings = SEEDLINGS.filter((e) => hasItem(state, e.seedlingId));
  let harvestable = 0;

  for (let n = 0; n < count; n++) {
    const plot = farm[n];
    if (!plot) continue;
    if (plot.type <= 0) {
      // Empty plot → one 種苗 option per owned seedling.
      for (const e of ownedSeedlings) {
        options.push({
          id: `plant:${n}:${e.seedlingId}`,
          label: `畑${n}：种${e.seedlingName}`,
          detail: badWeather ? "恶劣天气无法种植" : "空闲",
          disabled: badWeather,
        });
      }
      continue;
    }
    const stage = growthStage(plot);
    const tag = `畑${n}（${plot.name} · ${stage}）`;
    // 洒水 — only when the plot is dry.
    if (plot.dry > 0) {
      options.push({
        id: `water:${n}`,
        label: `${tag}：浇水`,
        detail: badWeather ? "恶劣天气无法浇水" : hasWater ? undefined : "还没有打水",
        disabled: badWeather || !hasWater,
      });
    }
    // 收获 — when harvestable.
    if (canHarvest(plot)) {
      harvestable++;
      options.push({ id: `harvest:${n}`, label: `${tag}：收获` });
    }
    // 抜出 — always available; confirmation folded into the label for a
    // live pre-ripe plant (the ASK_YN 是 arm).
    options.push({
      id: `uproot:${n}`,
      label: uprootNeedsConfirm(plot)
        ? `${tag}：拔掉（放弃未成熟的${plot.name}）`
        : `${tag}：拔掉`,
    });
    // 施肥 — needs 肥料 and not yet fertilized.
    if (hasFertilizer && plot.food === 0) {
      options.push({
        id: `fertilize:${n}`,
        label: `${tag}：施肥`,
        detail: badWeather ? "恶劣天气无法施肥" : undefined,
        disabled: badWeather,
      });
    }
  }

  // 全部收获 — offered when at least one plot is harvestable.
  if (harvestable > 0) {
    options.push({ id: "harvestall", label: "全部收获" });
  }

  return pickOne("家庭菜園：", options);
}

function checkEligible(
  state: GameState,
): { ok: true } | { ok: false; reason: { kind: "precondition"; message: string } } {
  // 場所_菜園 (PLACE_GARDEN). IS_GAP_GUEST deferred.
  if (!hasPlace(placeFlagsOf(state.master.location), PLACE_GARDEN)) {
    return { ok: false, reason: { kind: "precondition", message: "这里没有可以耕种的菜园。" } };
  }
  // ITEM:150 園芸用品一式.
  if (!hasItem(state, FARM_ITEM.園芸用品一式)) {
    return { ok: false, reason: { kind: "precondition", message: "没有园艺用品一式。" } };
  }
  // BASE:MASTER:気力 <= 0.
  if (getMasterBase(state, BASE_ID.気力) <= 0) {
    return { ok: false, reason: { kind: "precondition", message: "没有干活的气力了。" } };
  }
  // CFLAG:诶嘿嘿 == 2.
  if (getMasterCflag(state, CFLAG_ID.诶嘿嘿) === 2) {
    return { ok: false, reason: { kind: "precondition", message: "现在不是耕种的时候。" } };
  }
  return { ok: true };
}

/** Decode a structured option id → the engine action + result. */
function runAction(state: GameState, id: string, rng: FarmRng): FarmActionResult {
  const parts = id.split(":");
  switch (parts[0]) {
    case "plant":
      return plantSeedling(state, Number(parts[1]), Number(parts[2]));
    case "water":
      return waterPlot(state, Number(parts[1]));
    case "harvest":
      return harvestPlot(state, Number(parts[1]), rng);
    case "harvestall":
      return harvestAll(state, rng);
    case "uproot":
      return uprootPlot(state, Number(parts[1]));
    case "fertilize":
      return fertilizePlot(state, Number(parts[1]));
    default:
      return { cost: 0, messages: [] };
  }
}

export const farm418HandlerEntry: HandlerEntry = {
  commandNo: 418,
  prompt: (ctx) => farmPrompt(ctx.state),
  execCheck: (ctx) => {
    const r = checkEligible(ctx.state);
    return r.ok ? { ok: true } : { ok: false, reason: r.reason };
  },
  handler: (ctx) => {
    const next: GameState = cloneGameState(ctx.state);
    const picked = requirePickOne(farmPrompt(next), ctx.promptAnswer);

    // [999] 算了 (no valid pick) → RETURN -1, no turn consumed.
    if (picked == null) {
      return {
        state: next,
        events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text: "算了。" }],
        outcome: "noop" as const,
      };
    }

    const result = runAction(next, String(picked), ctx.rng);

    // `@COM418`: apply the time cost. FLAG:70 (time-stop) → TSP -= cost*3;
    // else TIME += cost. A refusal (cost 0) still returns to the menu with
    // its message and consumes no turn.
    if (result.cost > 0) {
      if ((next.flagStore[FLAG_ID.時間停止] ?? 0) !== 0) {
        setMasterBase(next, BASE_ID.TSP, getMasterBase(next, BASE_ID.TSP) - result.cost * 3);
      } else {
        advanceTimeTicks(next, result.cost);
      }
    }

    const events = result.messages.map((text) => ({
      kind: "NARRATION" as const,
      timestamp: ctx.now(),
      text,
    }));

    return {
      state: next,
      events,
      outcome: result.cost > 0 ? ("ok" as const) : ("noop" as const),
    };
  },
};
