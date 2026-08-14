/**
 * Weather S7 — `WEATHERCHECK` foldable-umbrella durability.
 */

import type { GameState } from "../state/game-state.js";
import { cloneGameState } from "../state/game-state.js";
import { BASE_ID, FLAG_ID } from "../state/settlement.js";
import { hasItem, removeItem, addItem } from "../state/items.js";
import { pay } from "../state/money.js";
import { WEATHER_ID } from "./constants.js";

export const ITEM_FOLDING_UMBRELLA = 36;
export const ITEM_BROKEN_UMBRELLA = 140;

export type UmbrellaRepairMode = 0 | 1 | 2 | 3;

export interface WeatherCheckOptions {
  weatherId: number;
  lapse: number;
  hasDivinity?: boolean;
  magicDlc?: boolean;
  timeStopped?: boolean;
  masterSleeping?: boolean;
  masterInH?: boolean;
  automaticRepair?: UmbrellaRepairMode;
}

export interface WeatherCheckResult {
  state: GameState;
  messages: string[];
  damage: number;
  broke: boolean;
}

export function umbrellaDamageForWeather(weatherId: number): number {
  switch (weatherId) {
    case WEATHER_ID.雾雨:
    case WEATHER_ID.雾雪:
    case WEATHER_ID.冰雹:
      return 1;
    case WEATHER_ID.雨夹雪:
      return 5;
    case WEATHER_ID.雨:
    case WEATHER_ID.雪:
    case WEATHER_ID.细雪:
    case WEATHER_ID.暴雨:
      return 2;
    case WEATHER_ID.大雨:
    case WEATHER_ID.大雪:
      return 50;
    default:
      return 0;
  }
}

export function weatherCheckUmbrella(state: GameState, opts: WeatherCheckOptions): WeatherCheckResult {
  const next = cloneGameState(state);
  const messages: string[] = [];
  const lapse = Math.max(0, opts.lapse);
  if (opts.timeStopped || (opts.hasDivinity && opts.magicDlc) || lapse <= 0) {
    return { state: next, messages, damage: 0, broke: false };
  }

  const ownsUmbrella = hasItem(next, ITEM_FOLDING_UMBRELLA);
  if (!ownsUmbrella) {
    if (!opts.masterInH && !opts.masterSleeping) {
      const wet = wetBodyMessage(opts.weatherId);
      if (wet) messages.push(wet);
    }
    return { state: next, messages, damage: 0, broke: false };
  }

  const damage = umbrellaDamageForWeather(opts.weatherId) * lapse;
  if (damage <= 0) return { state: next, messages, damage: 0, broke: false };

  const cur = next.flagStore[FLAG_ID.折畳伞耐久度] ?? 0;
  const durability = cur + damage;
  next.flagStore[FLAG_ID.折畳伞耐久度] = durability;

  if (durability > 10000) {
    const repaired = tryRepairUmbrella(next, opts.automaticRepair ?? 0, messages);
    if (!repaired) {
      removeItem(next, ITEM_FOLDING_UMBRELLA, 1);
      addItem(next, ITEM_BROKEN_UMBRELLA, 1);
      next.flagStore[FLAG_ID.折畳伞耐久度] = 0;
      messages.push("伞坏掉了！");
    }
    return { state: next, messages, damage, broke: !repaired };
  }

  if (durability > 8000 && !opts.masterInH && !opts.masterSleeping) {
    messages.push("伞好像快坏掉了…");
  }
  return { state: next, messages, damage, broke: false };
}

function wetBodyMessage(weatherId: number): string | null {
  switch (weatherId) {
    case WEATHER_ID.雨:
    case WEATHER_ID.雾雨:
    case WEATHER_ID.暴雨:
    case WEATHER_ID.冰雹:
      return "被雨淋得皮肤发寒";
    case WEATHER_ID.大雨:
      return "冰冷的雨刺激着皮肤";
    case WEATHER_ID.雪:
    case WEATHER_ID.细雪:
    case WEATHER_ID.雾雪:
    case WEATHER_ID.雨夹雪:
      return "被雪弄得皮肤发寒";
    case WEATHER_ID.大雪:
      return "暴风雪快把身体冻僵了";
    default:
      return null;
  }
}

function tryRepairUmbrella(state: GameState, mode: UmbrellaRepairMode, messages: string[]): boolean {
  if (mode === 1 && state.money >= 1200) {
    state.flagStore[FLAG_ID.折畳伞耐久度] = 0;
    pay(state, 1200);
    messages.push("伞坏了！花费1200¥从间隙商店重新购买了一把新的。");
    return true;
  }
  const tsp = state.master.state.BASE[BASE_ID.TSP] ?? 0;
  if (mode === 2 && tsp >= 600) {
    state.flagStore[FLAG_ID.折畳伞耐久度] = 0;
    state.master.state.BASE[BASE_ID.TSP] = tsp - 600;
    messages.push("伞坏了！暂停时间将其修好。（TSP -600）");
    return true;
  }
  if (mode === 3) {
    state.flagStore[FLAG_ID.折畳伞耐久度] = 0;
    messages.push("伞坏了！瞬间将其重新修好。");
    return true;
  }
  return false;
}
