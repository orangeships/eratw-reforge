/**
 * Shared outdoor weather effect used by movement and FREE_ACT gates.
 *
 * This is the portable part of `@天候造成的影響` from
 * `MOVEMENTS/BASE自然変動.ERB`.  The weather selector remains the modern
 * regional selector, so movement and settlement read the same weather.
 */

import type { GameState, CharaSlot } from "../state/game-state.js";
import {
  BASE_ID,
  CFLAG_ID,
  EQUIP_SLOT,
  FLAG_ID,
  TALENT_ID,
  TEQUIP_ID,
} from "../state/settlement.js";
import { hasItem } from "../state/items.js";
import { readTequip } from "../state/tequip.js";
import { currentRegionWeather } from "./region-override.js";
import { WEATHER_ID, WIND_ID } from "./constants.js";
import { ITEM_FOLDING_UMBRELLA } from "./umbrella.js";
import { isNoRainLocation } from "./region-system.js";
import { atPlayerBase, outRoof } from "../world/location-predicates.js";

function charaAt(state: GameState, charaNum: number): CharaSlot | undefined {
  return charaNum === state.master.charaNum ? state.master : state.charas[charaNum];
}

/** Port of `@天候造成的影響(ARG, location)`; negative values are damage. */
export function weatherDamage(state: GameState, location: string, charaNum: number): number {
  const slot = charaAt(state, charaNum);
  if (!slot) return 0;

  const equip = slot.state.EQUIP?.[EQUIP_SLOT.飾品] ?? 0;
  const sharedUmbrella = readTequip(slot, TEQUIP_ID.相合伞) !== 0;
  if (isNoRainLocation(location) || outRoof(state, location) === 0 || equip === 6 || sharedUmbrella) {
    return 0;
  }

  // The upstream custom branch exempts the master while carrying a folding
  // umbrella.  The modern runtime has no nDontUseUmbrella toggle yet.
  if (charaNum === state.master.charaNum && hasItem(state, ITEM_FOLDING_UMBRELLA)) return 0;

  const talent = slot.state.TALENT;
  const vampire = (talent[TALENT_ID.妖怪] ?? 0) === 3;
  const aquatic = (talent[TALENT_ID.水棲] ?? 0) !== 0;
  const iceFairy = (talent[TALENT_ID.氷精] ?? 0) !== 0;
  const weather = currentRegionWeather(state, location).weatherIndex;
  let damage = 0;

  switch (weather) {
    case WEATHER_ID.少云:
      if (state.time.season === 2 && (vampire || aquatic || talent[TALENT_ID.氷精] === 2)) damage = -2;
      break;
    case WEATHER_ID.晴:
      if (state.time.season === 2 && (vampire || aquatic || talent[TALENT_ID.氷精] === 2)) damage = -3;
      break;
    case WEATHER_ID.雨:
    case WEATHER_ID.雾雨:
      damage = aquatic ? 3 : -2;
      break;
    case WEATHER_ID.雪:
    case WEATHER_ID.细雪:
    case WEATHER_ID.雾雪:
    case WEATHER_ID.雨夹雪:
      damage = iceFairy ? 3 : -2;
      break;
    case WEATHER_ID.大雨:
      damage = aquatic ? 3 : -3;
      break;
    case WEATHER_ID.大雪:
    case WEATHER_ID.冰霰:
      damage = iceFairy ? 3 : -3;
      break;
    case WEATHER_ID.暴雨:
      damage = aquatic ? 3 : -6;
      break;
    case WEATHER_ID.冰雹:
      damage = -10;
      break;
    default:
      break;
  }

  const wind = currentRegionWeather(state, location).windIndex;
  if (wind === WIND_ID.强风) damage -= 1;
  else if (wind === WIND_ID.暴风) damage -= 3;
  else if (wind >= WIND_ID.飓风) damage -= 6;

  if (damage < 0 && (vampire || iceFairy || charaNum === state.master.charaNum)) {
    damage *= 2;
  }
  return damage;
}

/**
 * Apply the per-minute stamina effect from `@BASE自然変動` (ERB 267-410).
 * NPCs outside a base are intentionally ignored unless they are the active
 * date partner; the master is always eligible. Weather cannot create 衰弱.
 */
export function applyWeatherExposure(
  state: GameState,
  slot: CharaSlot,
  lapseMinutes: number,
): void {
  if (lapseMinutes <= 0) return;
  const isMaster = slot.charaNum === state.master.charaNum;
  const isDatePartner = (state.flagStore[FLAG_ID.デート相手] ?? 0) === slot.charaNum;
  if (!isMaster && !atPlayerBase(state, slot.charaNum) && !isDatePartner) return;

  const intimateMode = slot.state.CFLAG[CFLAG_ID.诶嘿嘿] ?? 0;
  const body = slot.state.BASE[BASE_ID.体力] ?? 0;
  if (intimateMode === 2 && body <= 500) return;

  const delta = weatherDamage(state, slot.location, slot.charaNum) * lapseMinutes;
  if (delta === 0) return;
  const maxBody = slot.state.MAXBASE[BASE_ID.体力] ?? 0;
  if (maxBody <= 0) return;
  slot.state.BASE[BASE_ID.体力] = Math.min(maxBody, Math.max(0, body + delta));
}
