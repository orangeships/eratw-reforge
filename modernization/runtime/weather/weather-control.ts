/**
 * S3 `@CHANGE_WEATHER_SYSTEM` selector from `天候管理拡張.ERB:5-76`.
 *
 * It picks `NOW_WEATHER_CONTROL` from low-pressure / rainband / cumulus state.
 * The actual weather mutation remains S2's `qol_CHANGE_WEATHER_SYSTEM_N`.
 */

import type { GameState } from "../state/game-state.js";
import { ensureWeatherState } from "../state/weather-state.js";
import {
  getLocationCumulus,
  getLocationLinerRainband,
  getLocationLow,
} from "./low-pressure.js";

export function selectWeatherControl(state: GameState): number {
  const w = ensureWeatherState(state);
  const low = getLocationLow(state);
  const rainband = getLocationLinerRainband(state);
  const cumulus = getLocationCumulus(state);
  const season = state.time.season ?? 1;
  const minute = Math.max(0, Math.min(1439, state.time.hourOfDay * 60));

  if (low === "台風接近強風域" || low === "台風通過強風域") return 16;
  if (low === "台風接近暴風域" || low === "台風通過暴風域" || (w.isTyphoon[2] !== 2 && low === "台風最接近")) return 21;
  if (low === "台風最接近") return 17;
  if (rainband === "線状降水帯勢力圏") return 20;
  if (low === "寒冷渦遠方" && season === 4) return 19;
  if (low === "寒冷渦接近" && season === 4) return 13;
  if (low === "寒冷渦接近" && (season === 1 || season === 3) && !w.isRainySeason1[0] && !w.isRainySeason2) return 5;
  if (
    w.isRainySeason1[1] === 1 ||
    (w.isRainySeason2 === 1 && low === "台風勢力圏") ||
    (w.isTyphoon[3] === 1 && low === "台風勢力圏")
  ) {
    return 15;
  }
  if (w.isRainySeason1[0] === 1 || w.isRainySeason2 === 1) return 14;
  if (low === "二つ玉低気圧接近" || low === "日本海低気圧接近") return 10;
  if (low === "二つ玉低気圧通過中" || low === "日本海低気圧通過中") return 11;
  if (low === "疑似好天") return 19;
  if (low === "南岸低気圧接近") return 12;
  if (low === "温暖前線接近") return 2;
  if (low === "暖域") return 3;
  if (low === "寒冷前線通過") return 4;
  if (minute >= 240 && minute <= 600 && w.canStratus === 1) return 18;
  if (season === 1 || season === 3) return 1;
  if (season === 4) return 9;
  if (season === 2 && cumulus === "積乱雲接近") return 7;
  if (season === 2 && cumulus === "積乱雲直下") return 8;
  return 6;
}

export function updateNowWeatherControl(state: GameState): boolean {
  const w = ensureWeatherState(state);
  const next = selectWeatherControl(state);
  if (w.nowWeatherControl === next) return false;
  w.nowWeatherControl = next;
  return true;
}
