/**
 * eraTW 天气系统主调度器 — `runWeatherSystemTick`。
 *
 * 上游调度链（`日時天候管理.ERB:97-182`）：
 *   1. `@CHANGE_TIMEZONE` 8 时段切换判定
 *   2. `@CHANGE_WEATHER_SYSTEM` → `@qol_CHANGE_WEATHER_SYSTEM_<NOW_WEATHER_CONTROL>`
 *      （21 个 qol 函数之一）
 *   3. `@CHANGE_WEATHER` → 异常气象副作用 + qol_FORCESET_REGION_*
 *   4. `@SET_MAP_WEATHER_BGCOLOR`（UI 端）
 *
 * 现代侧 S1 阶段只实现**调度器骨架**：
 *   - `runWeatherSystemTick(state, now)` 主入口
 *   - 检测时段跨变（hour-band 切换）
 *   - 调用异常气象副作用 helper（`abnormal-weather.ts::applyAbnormalWeather`）
 *   - 返回带 weather_state 的 events（用于 narration）
 *
 * S2 阶段会接 21 个 qol_* 转移函数。
 * S3 阶段会接 WEATHER_FORECAST_* 三层预报。
 * S4 阶段会接气温补正。
 *
 * 钩子点（`clock.ts::advanceClock`）：跨 hour-band 时调 `runWeatherSystemTick`。
 * 阶段 S1 在 clock.ts 加 hourBand 跟踪 + 跨段检测。
 */

import type { GameState, CharaSlot } from "../state/game-state.js";
import type { ObservationEvent } from "../../schemas/types.js";
import { ensureWeatherState } from "../state/weather-state.js";
import { currentTimezone } from "../state/weather.js";
import { createRng } from "../command/rng.js";
import { applyAbnormalWeather } from "./abnormal-weather.js";
import { runQolChangeWeatherSystem } from "./change-weather.js";
import { qolSetRegionWeather } from "./region-override.js";
import { updateNowWeatherControl } from "./weather-control.js";
import { applyScheduledWeatherIncidents } from "./narrative-incident.js";

/* -------------------------------------------------------------- *
 * 主入口                                                          *
 * -------------------------------------------------------------- */

/**
 * 天气系统 tick — 每次时钟推进调用。
 *
 * 责任：
 *   1. 记录当前 `WEATHER_TIMEZOME`（写入 state.weather）
 *   2. 刷新 `NOW_WEATHER_CONTROL` 并派发 S2 状态机
 *   3. 对在场所有角色施加异常气象副作用
 *   4. 返回 narration events（当前恒为空——S0 删除了 S1 的
 *      `[weather-system] hour-band` 调试消息；副作用全部保留。
 *      未来阶段若需要发天气旁白，push 进 `events` 即可）
 *
 * @param state   GameState（in-place mutation）
 * @param _now    timestamp 函数（保留供未来天气旁白使用；当前无 events）
 * @param prevHourOfDay  时钟推进**前**的 hour-of-day（用于跨段检测）
 * @returns observation events（narration；当前恒为空）
 */
export function runWeatherSystemTick(
  state: GameState,
  _now: () => number,
  prevHourOfDay: number,
): ObservationEvent[] {
  const w = ensureWeatherState(state);
  const curHour = state.time.hourOfDay;
  const curBand = currentTimezone(curHour);
  const hadActiveIncident = (state.scheduledWeatherIncidents ?? []).some((entry) => entry.status === "active");
  const incidentEvents = applyScheduledWeatherIncidents(state, _now);
  const incidentEnded = hadActiveIncident && !(state.scheduledWeatherIncidents ?? []).some((entry) => entry.status === "active");

  /* 时段未跨变 → 不做事（与上游 SIF WEATHER_TIMEZOME != 現在時間帯 一致） */
  const prevBand = currentTimezone(prevHourOfDay);
  if (curBand === prevBand && !incidentEnded) {
    return incidentEvents;
  }

  /* 记录新时段（`日時天候管理.ERB:177-179`） */
  w.weatherTimezone = curBand;

  const events: ObservationEvent[] = [];
  events.push(...incidentEvents);

  /* S3: refresh NOW_WEATHER_CONTROL from forecast state, then dispatch S2. */
  updateNowWeatherControl(state);
  const rng = createRng((state.time.tickValue + state.time.hourOfDay * 60) % 10000);
  runQolChangeWeatherSystem(state, false, rng);
  qolSetRegionWeather(state);
  // A validated narrative incident is an input to the weather authority, not
  // a competing state writer. Re-apply it after the natural transition so it
  // remains visible and mechanically effective for its accepted duration.
  events.push(...applyScheduledWeatherIncidents(state, _now));

  /* 异常气象副作用 — 对在场所有角色（含 master） */
  for (const chara of iteratePresentCharacters(state)) {
    applyAbnormalWeather(state, chara, chara.location ?? state.master.location);
  }

  /* S3+ 会在这里调 WEATHER_FORECAST_1DAY */

  return events;
}

/* -------------------------------------------------------------- *
 * 在场角色迭代                                                    *
 * -------------------------------------------------------------- */

/**
 * 迭代在场（同一 location 或 master location）的所有角色。
 *
 * 上游 `CHARAMOVE_DATA` + `CHK_DATENOW` 复杂逻辑 → 现代侧用 location 字符串匹配。
 * S1 阶段：master + 任何 chara.masterLocation==masterLocation 的角色。
 */
function* iteratePresentCharacters(state: GameState): Generator<CharaSlot> {
  // Master 自己
  yield state.master;

  // NPCs
  if (!state.charas) return;
  const masterLoc = state.master.location;
  for (const charaNumStr of Object.keys(state.charas)) {
    const charaNum = Number(charaNumStr);
    if (!Number.isInteger(charaNum) || charaNum <= 0) continue;
    const c = state.charas[charaNum];
    if (!c) continue;
    // 同行/同房判定（简化：同 location 字符串即在场）
    if (c.location && masterLoc && c.location === masterLoc) {
      yield c;
    }
  }
}
