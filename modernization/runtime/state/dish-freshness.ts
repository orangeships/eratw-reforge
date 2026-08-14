/**
 * Current-dish freshness, faithfully ported from `@DISH_FRESHNESS` in
 * `INFO.ERB`. Kept separate from `dish.ts` so the clock can advance it
 * without introducing a `dish -> settlement -> clock -> dish` cycle.
 */
import type { Dish, GameState } from "./game-state.js";

export type DishFreshnessStatus = "fresh" | "normal" | "stale" | "spoiled" | "unmodeled";

export interface DishFreshnessResult {
  status: DishFreshnessStatus;
  message?: string;
  discarded: boolean;
}

function removeTasteTag(taste: string, tag: string): string {
  return taste.split(`${tag}/`).join("");
}

function tasteCount(taste: string, tag: string): number {
  return taste.split(`${tag}/`).length - 1;
}

/** Zero maxLimit is legacy/test data with no modelled freshness. */
export function dishFreshnessStatus(dish: Dish | null | undefined): DishFreshnessStatus {
  if (!dish || dish.maxLimit <= 0) return "unmodeled";
  if (dish.limit <= 0) return "spoiled";
  if (dish.limit <= dish.maxLimit / 2) return "stale";
  if (dish.limit > dish.maxLimit * 4 / 5) return "fresh";
  return "normal";
}

/** Apply `@DISH_FRESHNESS` threshold changes for an elapsed number of minutes. */
export function advanceDishFreshness(state: GameState, elapsedMinutes: number): DishFreshnessResult {
  const dish = state.dish;
  if (!dish || dish.name === "" || dish.maxLimit <= 0 || elapsedMinutes <= 0) {
    return { status: dishFreshnessStatus(dish), discarded: false };
  }

  dish.limit -= elapsedMinutes;
  if (dish.limit <= dish.maxLimit * 4 / 5) {
    dish.taste = removeTasteTag(dish.taste, "できたて");
  }

  if (dish.limit <= -dish.maxLimit) {
    const name = dish.name;
    state.dish = null;
    return { status: "unmodeled", discarded: true, message: `${name}已经无法下咽，只好倒掉了。` };
  }

  if (dish.limit <= 0) {
    if (tasteCount(dish.taste, "劣化") < 2) {
      dish.taste = removeTasteTag(removeTasteTag(dish.taste, "冷"), "温暖") + "劣化/劣化/";
      return { status: "spoiled", discarded: false, message: `${dish.name}散发出了恶臭…` };
    }
    return { status: "spoiled", discarded: false };
  }

  if (dish.limit <= dish.maxLimit / 2 && tasteCount(dish.taste, "劣化") === 0) {
    if (dish.taste.includes("冰淇淋/")) {
      dish.taste = removeTasteTag(dish.taste, "冷");
      return { status: "stale", discarded: false, message: `${dish.name}融化了…` };
    }
    if (dish.taste.includes("冷/")) {
      dish.taste = removeTasteTag(dish.taste, "冷") + "劣化/";
      return { status: "stale", discarded: false, message: `${dish.name}变得黏糊糊的了。` };
    }
    dish.taste = removeTasteTag(dish.taste, "温暖") + "劣化/";
    return { status: "stale", discarded: false, message: `${dish.name}冷掉了…` };
  }

  return { status: dishFreshnessStatus(dish), discarded: false };
}
