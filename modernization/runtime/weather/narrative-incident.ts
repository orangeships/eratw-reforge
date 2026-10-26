import type { ObservationEvent } from "../../schemas/types.js";
import type { GameState, ScheduledWeatherIncidentV1 } from "../state/game-state.js";
import { ensureWeatherState } from "../state/weather-state.js";

export interface WeatherIncidentOptionV1 {
  version: 1;
  id: string;
  label: string;
  description: string;
  startTick: number;
  endTick: number;
  weatherId: number;
  windId: number;
  idempotencyKey: string;
}

const WEATHER = {
  clear: 1,
  rain: 4,
  heavyRain: 5,
  snow: 8,
  heavySnow: 9,
  storm: 14,
} as const;

function option(
  state: Readonly<GameState>,
  kind: string,
  label: string,
  description: string,
  weatherId: number,
  windId: number,
  duration: number,
): WeatherIncidentOptionV1 {
  const startTick = state.time.tickValue;
  return {
    version: 1,
    id: `weather:${state.time.dayIndex}:${kind}:${startTick}`,
    label,
    description,
    startTick,
    endTick: startTick + duration,
    weatherId,
    windId,
    idempotencyKey: `weather-incident:${state.time.dayIndex}:${kind}:${startTick}`,
  };
}

/** Runtime-owned weather choices exposed to L3. The model selects an opaque
 * id; it never supplies WeatherState fields or numeric weather values. */
export function compileWeatherIncidentOptions(state: Readonly<GameState>): WeatherIncidentOptionV1[] {
  const season = state.time.season ?? 1;
  const result = [
    option(state, "clearing", "短暂放晴", "云层在数小时内散开。", WEATHER.clear, 0, 180),
    option(state, "rain", "持续降雨", "数小时的降雨，并进入现有降雨与警报规则。", WEATHER.rain, 1, 240),
    option(state, "storm", "强对流暴雨", "短时强降雨和大风，并进入现有警报与暴露规则。", WEATHER.storm, 2, 180),
  ];
  if (season === 4) {
    result.push(option(state, "snow", "持续降雪", "数小时的降雪，并进入积雪与低温规则。", WEATHER.heavySnow, 1, 240));
  } else if (season === 1) {
    result.push(option(state, "late-snow", "反常雨夹雪", "短时反常降雪，作为春季事件征兆。", WEATHER.snow, 1, 120));
  } else {
    result.push(option(state, "heavy-rain", "异常连续暴雨", "持续暴雨，提高连续降雨并触发相应警报。", WEATHER.heavyRain, 2, 240));
  }
  return result;
}

function isLegalOption(state: Readonly<GameState>, value: WeatherIncidentOptionV1): boolean {
  return value.version === 1
    && typeof value.id === "string" && value.id.length > 0 && value.id.length <= 160
    && Number.isSafeInteger(value.startTick) && value.startTick >= state.time.tickValue
    && value.startTick <= state.time.tickValue + 1440
    && Number.isSafeInteger(value.endTick) && value.endTick > value.startTick
    && value.endTick - value.startTick <= 360
    && Number.isSafeInteger(value.weatherId) && value.weatherId >= 0 && value.weatherId <= 15
    && Number.isSafeInteger(value.windId) && value.windId >= 0 && value.windId <= 3
    && typeof value.idempotencyKey === "string" && value.idempotencyKey.length > 0;
}

export function scheduleWeatherIncident(
  state: GameState,
  selected: WeatherIncidentOptionV1,
  sourceEventId?: string,
): { accepted: boolean; incident?: ScheduledWeatherIncidentV1; diagnostics: string[] } {
  if (!isLegalOption(state, selected)) return { accepted: false, diagnostics: ["weather incident option is invalid or stale"] };
  state.scheduledWeatherIncidents ??= [];
  const existing = state.scheduledWeatherIncidents.find((entry) => entry.idempotencyKey === selected.idempotencyKey);
  if (existing) return { accepted: true, incident: existing, diagnostics: [] };
  const overlaps = state.scheduledWeatherIncidents.some((entry) =>
    entry.status !== "completed" && entry.status !== "cancelled"
      && selected.startTick < entry.endTick && selected.endTick > entry.startTick);
  if (overlaps) return { accepted: false, diagnostics: ["weather incident overlaps another accepted intervention"] };
  const incident: ScheduledWeatherIncidentV1 = {
    version: 1,
    id: selected.id,
    optionId: selected.id,
    label: selected.label,
    startTick: selected.startTick,
    endTick: selected.endTick,
    weatherId: selected.weatherId,
    windId: selected.windId,
    status: selected.startTick <= state.time.tickValue ? "active" : "scheduled",
    ...(sourceEventId ? { sourceEventId } : {}),
    idempotencyKey: selected.idempotencyKey,
  };
  state.scheduledWeatherIncidents.push(incident);
  state.scheduledWeatherIncidents = state.scheduledWeatherIncidents.slice(-16);
  applyScheduledWeatherIncidents(state, () => state.time.tickValue);
  return { accepted: true, incident, diagnostics: [] };
}

/** Apply accepted incidents after the normal weather state machine. This is
 * deliberately inside the weather authority so narrative code never writes
 * WeatherState. */
export function applyScheduledWeatherIncidents(
  state: GameState,
  now: () => number,
): ObservationEvent[] {
  const events: ObservationEvent[] = [];
  const tick = state.time.tickValue;
  for (const incident of state.scheduledWeatherIncidents ?? []) {
    if (incident.status === "scheduled" && tick >= incident.startTick && tick < incident.endTick) {
      incident.status = "active";
      events.push({ kind: "NARRATION", timestamp: now(), text: `天气事件开始：${incident.label}。` });
    }
    if (incident.status === "active" && tick >= incident.endTick) {
      incident.status = "completed";
      events.push({ kind: "NARRATION", timestamp: now(), text: `天气事件结束：${incident.label}。` });
      continue;
    }
    if (incident.status !== "active") continue;
    const weather = ensureWeatherState(state);
    weather.gensokyoWeatherSystem = Array.from({ length: 10 }, () => incident.weatherId);
    weather.gensokyoWindVeSystem = Array.from({ length: 10 }, () => incident.windId);
    weather.windVelocity = incident.windId;
    if (incident.weatherId === WEATHER.heavyRain || incident.weatherId === WEATHER.storm) {
      weather.continuousRainfall = Math.max(weather.continuousRainfall, 8);
    }
    if (incident.weatherId === WEATHER.snow || incident.weatherId === WEATHER.heavySnow) {
      weather.continuousSnowfall = Math.max(weather.continuousSnowfall, 4);
      weather.snowCoverage = Math.max(weather.snowCoverage, 2);
    }
  }
  return events;
}

export function activeScheduledWeatherIncident(state: Readonly<GameState>): ScheduledWeatherIncidentV1 | null {
  return (state.scheduledWeatherIncidents ?? []).find((entry) => entry.status === "active") ?? null;
}
