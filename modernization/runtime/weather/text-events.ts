/**
 * Weather S7 — weather-change prose + player diary event labels.
 *
 * Original entry points:
 *   - `qol_CHANGE_WEATHER_SYSTEM_INFO_PRINT`
 *   - `qol_CHANGE_WEATHER_SYSTEM_WIND_PRINT`
 *   - `qol_WEATHER_FORECAST_DIARY_PRINT`
 *   - `qol_WEATHER_CHANGE_DIARY_PRINT`
 *
 * `ASK_DIARY` writes to MASTER's diary after asking the player; it is not the
 * per-character `DIARY_K*_EXIST` system. Modern runtime surfaces it as a
 * visible player-diary candidate event label without assigning it to NPCs.
 */

import type { GameState } from "../state/game-state.js";
import { WEATHER_ID, WIND_ID } from "./constants.js";
import { isNoRainAt, isNoWeatherChangeLocation, isNoWindChangeLocation } from "./region-system.js";

const NIGHT_BANDS = new Set([6, 7, 8, 1]);
const CLEAR = new Set([WEATHER_ID.少云, WEATHER_ID.晴]);
const CLOUD = new Set([WEATHER_ID.多云, WEATHER_ID.阴]);
const RAIN = new Set([WEATHER_ID.雨, WEATHER_ID.大雨, WEATHER_ID.雾雨, WEATHER_ID.冰霰, WEATHER_ID.暴雨, WEATHER_ID.冰雹]);
const SNOW = new Set([WEATHER_ID.雪, WEATHER_ID.大雪, WEATHER_ID.细雪, WEATHER_ID.雾雪, WEATHER_ID.雨夹雪]);

export type WeatherDiaryKind = "入梅" | "长梅" | "出梅" | "春风" | "暴风雪" | "台风";

const DIARY_LABELS: Record<WeatherDiaryKind, string> = {
  入梅: "入梅了",
  长梅: "漫长梅雨",
  出梅: "出梅了",
  春风: "第一缕春风",
  暴风雪: "晴天急转暴风雪",
  台风: "台风来袭了",
};

export interface WeatherDiaryEvent {
  kind: WeatherDiaryKind;
  label: string;
  lines: string[];
}

export function weatherChangeText(
  state: GameState,
  previousWeather: number,
  currentWeather: number,
  timeband: number,
): string | null {
  if (isNoWeatherChangeLocation(state.master.location)) return null;
  const night = NIGHT_BANDS.has(timeband);
  if (currentWeather === previousWeather) return null;

  switch (currentWeather) {
    case WEATHER_ID.少云:
      if (previousWeather === WEATHER_ID.晴) return "少量的云出来了";
      if (CLOUD.has(previousWeather) || previousWeather === WEATHER_ID.雾雨 || previousWeather === WEATHER_ID.雾)
        return night ? "可以看见星星了" : "太阳出来了";
      if (RAIN.has(previousWeather)) return night ? "突然星空变得晴朗了！说不定能看到月虹呢" : "突然太阳出来了！说不定能看到彩虹呢";
      if (SNOW.has(previousWeather)) return night ? "突然星空变得晴朗了！说不定能看到钻石尘呢" : "突然太阳出来了！说不定能看到钻石尘呢";
      return "少量的云出来了";
    case WEATHER_ID.晴:
      if (previousWeather === WEATHER_ID.少云) return "天空放晴了！！";
      if (CLOUD.has(previousWeather) || previousWeather === WEATHER_ID.雾雨 || previousWeather === WEATHER_ID.雾)
        return night ? "天空放晴了！可以看见星星了" : "天空放晴了！太阳出来了";
      if (RAIN.has(previousWeather)) return night ? "突然星空变得晴朗了！这下应该能看到月虹了" : "突然太阳出来了！这下应该能看到彩虹了";
      if (SNOW.has(previousWeather)) return night ? "突然星空变得晴朗了！这下应该能看到钻石尘了" : "突然太阳出来了！这下应该能看到钻石尘了";
      return "天空放晴了！！";
    case WEATHER_ID.多云:
      if (previousWeather === WEATHER_ID.阴) return "云变薄了";
      if (previousWeather !== WEATHER_ID.多云) return "变成多云天气了";
      return null;
    case WEATHER_ID.阴:
      if (previousWeather === WEATHER_ID.多云) return "云变厚了";
      if (RAIN.has(previousWeather)) return "雨好像停了的样子";
      if (SNOW.has(previousWeather)) return "雪好像停了的样子";
      return previousWeather === WEATHER_ID.阴 ? null : "天空被云层完全覆盖了";
    case WEATHER_ID.雨:
      if (previousWeather === WEATHER_ID.雨) return null;
      if (previousWeather === WEATHER_ID.大雨 || previousWeather === WEATHER_ID.冰霰 || previousWeather === WEATHER_ID.暴雨 || previousWeather === WEATHER_ID.冰雹) return "雨变小了";
      if (SNOW.has(previousWeather)) return "雪天好像变成了雨天的样子";
      return "下雨了！";
    case WEATHER_ID.大雨:
      if (previousWeather === WEATHER_ID.暴雨) return "雨稍微小了一些";
      return previousWeather === WEATHER_ID.大雨 ? null : "变成了瓢泼大雨！";
    case WEATHER_ID.雾雨:
      if (previousWeather === WEATHER_ID.雨) return "雨点变小了";
      return previousWeather === WEATHER_ID.雾雨 ? null : "变成雾雨了";
    case WEATHER_ID.雾:
      if (previousWeather === WEATHER_ID.雾雨) return "雨停了";
      if (previousWeather === WEATHER_ID.细雪) return "雪停了";
      return previousWeather === WEATHER_ID.雾 ? null : "起雾了";
    case WEATHER_ID.雪:
      if (previousWeather === WEATHER_ID.大雪) return "雪好像变弱了";
      return previousWeather === WEATHER_ID.雪 ? null : "下雪了！";
    case WEATHER_ID.大雪:
      if (previousWeather === WEATHER_ID.雨) return "雨变成雪了！";
      if (previousWeather === WEATHER_ID.雪 || previousWeather === WEATHER_ID.冰霰) return "雪越来越大了！";
      return previousWeather === WEATHER_ID.大雪 ? null : "下大雪了！";
    case WEATHER_ID.细雪:
      if (previousWeather === WEATHER_ID.雾) return "变成细雪了";
      if (previousWeather === WEATHER_ID.雪) return "雪花变小了";
      if (previousWeather === WEATHER_ID.雾雪 || previousWeather === WEATHER_ID.大雪) return "雪好像变弱了";
      return previousWeather === WEATHER_ID.细雪 ? null : "下雪了！";
    case WEATHER_ID.雾雪:
      if (previousWeather === WEATHER_ID.雾) return "变成雾雪了";
      if (previousWeather === WEATHER_ID.雪) return "雪花变小了";
      if (previousWeather === WEATHER_ID.大雪) return "雪好像变弱了";
      return previousWeather === WEATHER_ID.雾雪 ? null : "下雪了！";
    case WEATHER_ID.雨夹雪:
      if (previousWeather === WEATHER_ID.雨) return "雨夹雪降下来了！";
      if (previousWeather === WEATHER_ID.雪) return "雪中掺了一些雨点";
      return previousWeather === WEATHER_ID.雨夹雪 ? null : "雨夹雪降下来了！";
    case WEATHER_ID.冰霰:
      return "落小冰雹了！";
    case WEATHER_ID.暴雨:
      return "下起了暴雨！";
    case WEATHER_ID.冰雹:
      return "下起了大块的冰雹！";
    default:
      if (CLEAR.has(currentWeather) && CLEAR.has(previousWeather)) return null;
      return null;
  }
}

export function weatherWindChangeText(state: GameState, previousWind: number, currentWind: number): string | null {
  if (isNoWindChangeLocation(state.master.location) || currentWind === previousWind) return null;
  switch (currentWind) {
    case WIND_ID.无风:
      return previousWind ? "风停了" : null;
    case WIND_ID.强风:
      if (previousWind === WIND_ID.无风) return "风变强了";
      if (previousWind >= WIND_ID.暴风) return "风比刚才变弱了";
      return null;
    case WIND_ID.暴风:
      if (previousWind === WIND_ID.无风) return "风突然就变强了！";
      if (previousWind === WIND_ID.强风) return "风越来越强了！";
      if (previousWind >= WIND_ID.飓风) return "风比刚才变弱了";
      return null;
    case WIND_ID.飓风:
      if (previousWind === WIND_ID.无风) return "骤然间刮起了猛烈的风！";
      if (previousWind === WIND_ID.强风 || previousWind === WIND_ID.暴风) return "刮起了猛烈的风！";
      return null;
    default:
      return null;
  }
}

export function weatherForecastDiaryEvent(state: GameState, kind: Extract<WeatherDiaryKind, "入梅" | "长梅" | "出梅">): WeatherDiaryEvent {
  const local = !isNoRainAt(state);
  const line =
    kind === "入梅" ? (local ? "阴沉的天空…好像进入梅雨季节了" : "听说幻想乡好像进入梅雨季节了") :
    kind === "长梅" ? (local ? "不知不觉间夏天的闷热已经过去了，梅雨好像还没有结束" : "听说幻想乡梅雨好像还没有结束") :
    (local ? "清爽的夏日模样！好像梅雨季节结束了" : "听说幻想乡好像梅雨季节结束了");
  return { kind, label: DIARY_LABELS[kind], lines: [line, `日记候选：${DIARY_LABELS[kind]}`] };
}

export function weatherChangeDiaryEvent(state: GameState, kind: Extract<WeatherDiaryKind, "春风" | "暴风雪" | "台风">): WeatherDiaryEvent {
  const windVisible = !isNoWindChangeLocation(state.master.location);
  const line =
    kind === "春风" ? (windVisible ? "风变强了，春天来了！" : "听说幻想乡好像进入春季了") :
    kind === "暴风雪" ? (windVisible ? "突然下起了暴风雪！" : "听说幻想乡好像突然遭遇了暴风雪") :
    (windVisible ? "台风好像袭来了" : "听说幻想乡好像遭遇了台风");
  return { kind, label: DIARY_LABELS[kind], lines: [line, `日记候选：${DIARY_LABELS[kind]}`] };
}
