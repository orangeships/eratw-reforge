/**
 * Weather S7 — player-visible weather status line.
 *
 * Ports the intent of `qol_INFO_SHOW_WEATHER` / `WEATHERSTAUSSHOW`: expose the
 * current regional weather, wind, rainbow/diamond-dust markers, thunder, and
 * active warnings in one compact display object the UI and commands can share.
 */

import type { GameState } from "../state/game-state.js";
import { formatTemperature, weatherName } from "../state/weather.js";
import { getWeatherState } from "../state/weather-state.js";
import { activeWeatherWarnings } from "./warnings.js";
import { getCurrentTemperature } from "./temperature.js";
import { isNoWeatherSeeAt, regionName } from "./region-system.js";
import { getFrontalThunderstorm, getHeatThunderstorm, getWeatherThunderstorm } from "./thunderstorm.js";
import { currentRegionWeather } from "./region-override.js";

const WEATHER_ICONS: Record<number, string> = {
  0: "☀",
  1: "☀",
  2: "☁",
  3: "☁",
  4: "☂",
  5: "☂",
  6: "☂",
  7: "霧",
  8: "☃",
  9: "☃",
  10: "☃",
  11: "☃",
  12: "☃",
  13: "∵",
  14: "☂",
  15: "◆",
};

const WIND_NAMES: Record<number, string> = {
  0: "无风",
  1: "强风",
  2: "暴风",
  3: "飓风",
};

const RAINBOW_NAMES: Record<number, string> = {
  0: "",
  1: "彩虹",
  2: "钻石尘",
  3: "流星",
  4: "流星群",
};

export interface WeatherDisplayInfo {
  regionId: number;
  regionName: string;
  visible: boolean;
  weatherId: number;
  weatherName: string;
  icon: string;
  windId: number;
  windName: string;
  rainbowId: number;
  rainbowName: string;
  temperature01: number;
  temperatureText: string;
  thunder: boolean;
  warnings: string[];
  summary: string;
}

export function weatherStatusShow(state: GameState): WeatherDisplayInfo {
  // Ensure the weather state exists, then resolve the master's regional
  // weather through the single authoritative selector (`currentRegionWeather`)
  // so this status line always agrees with the status-bar main line — both now
  // read the same simulated + region-derived value rather than diverging
  // (raw-array read here vs derived read there).
  getWeatherState(state);
  const snapshot = currentRegionWeather(state);
  const regionId = snapshot.regionId;
  const regionalWeather = snapshot.weatherIndex;
  const regionalWind = snapshot.windIndex;
  const regionalRainbow = snapshot.rainbowIndex;
  const temperature01 = getCurrentTemperature(state);
  const warnings = activeWeatherWarnings(state);
  const thunder = Boolean(getWeatherThunderstorm(state) && (getHeatThunderstorm(state) || getFrontalThunderstorm(state)));
  const visible = !isNoWeatherSeeAt(state) || warnings.length > 0;
  const info: WeatherDisplayInfo = {
    regionId,
    regionName: regionName(regionId),
    visible,
    weatherId: regionalWeather,
    weatherName: weatherName(regionalWeather),
    icon: WEATHER_ICONS[regionalWeather] ?? "☀",
    windId: regionalWind,
    windName: WIND_NAMES[regionalWind] ?? "无风",
    rainbowId: regionalRainbow,
    rainbowName: RAINBOW_NAMES[regionalRainbow] ?? "",
    temperature01,
    temperatureText: formatTemperature(temperature01),
    thunder,
    warnings,
    summary: "",
  };
  info.summary = formatWeatherSummary(info);
  return info;
}

export function qolInfoShowWeatherLines(state: GameState): string[] {
  const info = weatherStatusShow(state);
  if (!info.visible) return [];
  const bits = [`${info.icon} ${info.regionName}：${info.weatherName}`, info.temperatureText];
  if (info.windId > 0) bits.push(info.windName);
  if (info.thunder) bits.push("雷");
  if (info.rainbowName) bits.push(info.rainbowName);
  if (info.warnings.length > 0) bits.push(`警报：${info.warnings.join("、")}`);
  return bits;
}

function formatWeatherSummary(info: WeatherDisplayInfo): string {
  if (!info.visible) return `${info.regionName}：天候不可知`;
  return qolInfoLine(info);
}

function qolInfoLine(info: WeatherDisplayInfo): string {
  const tail: string[] = [];
  if (info.windId > 0) tail.push(info.windName);
  if (info.thunder) tail.push("雷");
  if (info.rainbowName) tail.push(info.rainbowName);
  if (info.warnings.length > 0) tail.push(info.warnings[0]!);
  const suffix = tail.length > 0 ? `（${tail.join(" / ")}）` : "";
  return `${info.regionName}：${info.icon} ${info.weatherName} ${info.temperatureText}${suffix}`;
}
