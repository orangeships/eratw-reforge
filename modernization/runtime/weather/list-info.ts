/**
 * Weather S7 — `CHECKWEATHERLISTINFO` style forecast/broadcast text.
 */

import type { GameState } from "../state/game-state.js";
import { weatherName } from "../state/weather.js";
import { getWeatherState } from "../state/weather-state.js";
import { activeWeatherWarnings } from "./warnings.js";
import { getLocationLow, getLocationLinerRainband, getLocationCumulus } from "./low-pressure.js";
import { weatherStatusShow } from "./display.js";

export interface WeatherListInfo {
  headline: string;
  lines: string[];
  warnings: string[];
}

export function checkWeatherListInfo(state: GameState): WeatherListInfo {
  const w = getWeatherState(state);
  const display = weatherStatusShow(state);
  const warnings = activeWeatherWarnings(state);
  const lines: string[] = [];

  lines.push(display.visible ? `现在${display.regionName}的天气是${display.weatherName}。` : `${display.regionName}的天候无法直接观测。`);
  lines.push(display.temperatureText);
  if (display.windId > 0) lines.push(`风力：${display.windName}。`);
  if (display.rainbowName) lines.push(`天空现象：${display.rainbowName}。`);
  if (warnings.length > 0) {
    lines.push(`当前发布：${warnings.join("、")}。`);
  } else {
    lines.push("当前没有发布气象警报。");
  }

  const low = getLocationLow(state);
  const rainband = getLocationLinerRainband(state);
  const cumulus = getLocationCumulus(state);
  if (!low.endsWith("未発生") && !low.endsWith("通過")) lines.push(`低气压情报：${low}。`);
  if (!rainband.endsWith("未発生") && rainband !== "線状降水帯通過") lines.push(`线状降水带情报：${rainband}。`);
  if (!cumulus.endsWith("未発生") && cumulus !== "積乱雲通過") lines.push(`积雨云情报：${cumulus}。`);
  if (w.isTyphoon[0]) lines.push(`台风情报：势力${w.isTyphoon[1]}，路径${w.isTyphoon[2]}。`);
  if (w.nowWeatherControl > 0) lines.push(`天候倾向：${w.nowWeatherControl}。`);

  return {
    headline: `${display.regionName} ${weatherName(display.weatherId)}${warnings.length ? ` / ${warnings[0]}` : ""}`,
    lines,
    warnings,
  };
}
