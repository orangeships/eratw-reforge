/**
 * eraTW 天气系统 — 完整状态 shape（S1）。
 *
 * 来源：`eratw-sub-modding-main/ERB/天候システム.ERH` + `天候予測システム.ERB` 的
 * 全部 SAVEDATA 变量 + `魔改内容/qol/qol_weather.ERB` 的 10 区域系统。
 *
 * 这是「形状」文件，不含逻辑。所有 50+ 字段都来自上游 ERB；命名对齐原文便于
 * 审计。`regionXxxSystem[10]` 用 10 元素数组对齐 `天系_通用(0) .. 天系_魔界(9)`。
 *
 * 所有字段都是可选 — 老存档/早期 fixture 没有这字段时按「未初始化」处理，
 * helpers（如 `getWeatherState(state)`）会自动填入默认值。初始化由 S3 的
 * `WEATHER_FORECAST_1YEAR` 在第一次跨季节时完成（lazily）。
 *
 * 序列化安全：纯 number/数组/嵌套对象，无 Date/Function/Map。
 */

import type { GameState } from "./game-state.js";

/* -------------------------------------------------------------- *
 * 区域 ID（`天候システム.ERH:891-900`）                            *
 * -------------------------------------------------------------- */

export const REGION_ID = {
  通用: 0,
  三途: 1,
  彼岸: 2,
  冥界: 3,
  地狱: 4,
  旧狱: 5,
  天界: 6,
  梦境: 7,
  月都: 8,
  魔界: 9,
} as const;

/** 区域总数 — 0..9 共 10 个。 */
export const REGION_COUNT = 10;

/** ERA weather timestamp triple: `[season, date, minuteOfDay]`. */
export type WeatherDateTime = [number, number, number];

/* -------------------------------------------------------------- *
 * WeatherState — 完整 ERA SAVEDATA 镜像（S1 阶段先建 shape）      *
 * -------------------------------------------------------------- */

/**
 * 全部 eraTW 天气相关 SAVEDATA 字段。
 *
 * 字段分组：
 * 1. 时间相关：`weatherTimezone` (8 时段 WEATHER_TIMEZOME)
 * 2. 风向/降水累积：`windVelocity / continuousRainfall / continuousSnowfall / snowCoverage / possibilityAvalanche`
 * 3. 当前天气控制：`nowWeatherControl` (1-21)
 * 4. 当前期数 + 气流强度：`nowTerm / powerColdAir / powerWarmAir`
 * 5. 年度控制：`yearWeatherControl` (1-4)
 * 6. 低气压标志：`isColdLow / isSojLow / isSouthernLow / isTyphoon[4] / isLinerRainband[2]`
 * 7. 1 日预报：`canStratus / canCumulus[3] / atmosphericInstability / forbiddenChangeWeather`
 * 8. 农业：`amountColdCropDamage / isColdCropDamage / isStormCropDamage / isFloodCropDamage`
 * 9. 10 区域：`gensokyoWeatherSystem[10] / gensokyoWindVeSystem[10] / gensokyoRainbowSystem[10]`
 */
export interface WeatherState {
  /* 1. 时间相关 */
  /** `WEATHER_TIMEZOME` — 8 时段时间带（1-8），当前 weather-system 用。 */
  weatherTimezone: number;

  /* 2. 风向/降水累积 */
  /** `WIND_VELOCITY` — 风力 (0=无风/1=强风/2=暴风/3=飓风)。 */
  windVelocity: number;
  /** `CONTINUOUS_RAINFALL` — 连续降水计数器（连续 N 天 TIME:5 ∈ [4,5,14]）。 */
  continuousRainfall: number;
  /** `CONTINUOUS_SNOWFALL` — 连续降雪计数器。 */
  continuousSnowfall: number;
  /** `SNOW_COVERAGE` — 积雪量。 */
  snowCoverage: number;
  /** `POSSIBLITY_AVALANCHE` — 雪崩可能性 (0=无/1=表层/2=全层)。 */
  possibilityAvalanche: number;

  /* 3. 当前天气控制 (1-21) */
  /** `NOW_WEATHER_CONTROL` — 当前 qol 天气倾向编号（派发到 21 个 qol_CHANGE_WEATHER_SYSTEM_N）。 */
  nowWeatherControl: number;

  /* 4. 当前期数 + 气流强度 */
  /** `NOW_TERM` — 当前ターム数 (1-6)。 */
  nowTerm: number;
  /** `POWER_COLD_AIR` — 寒气强度 (1-5)。 */
  powerColdAir: number;
  /** `POWER_WARM_AIR` — 暖气强度 (1-5)。 */
  powerWarmAir: number;

  /* 5. 年度控制 */
  /** `YEAR_WEATHER_CONTROL` — 年控制 (1=正常/2=厄尔尼诺/3=拉尼娜/4=未设定)。 */
  yearWeatherControl: number;

  /** `IS_RAINY_SEASON1[2]` — 梅雨 (0=入梅中, 1=出梅待ち)。 */
  isRainySeason1: [number, number];
  /** `IS_RAINY_SEASON2` — 秋雨。 */
  isRainySeason2: number;

  /* 6. 低气压标志 */
  /** `IS_COLD_LOW` — 寒冷涡发生？ */
  isColdLow: number;
  /** `IS_SoJ_LOW` — 日本海低气压 (1=单/2=二つ玉)。 */
  isSojLow: number;
  /** `IS_SOUTHERN_LOW` — 南岸低气压？ */
  isSouthernLow: number;
  /** `IS_TYPHOON[4]` — 台风 (0=発生/1=勢力/2=通過位置/3=先駆降雨帯)。 */
  isTyphoon: [number, number, number, number];
  /** `IS_LINER_RAINBAND[2]` — 线状降水带 (0=発生/1=勢力 1-2)。 */
  isLinerRainband: [number, number];

  /** `TIME_ENTER_TERRITORY_COLD_LOW[3]` — 寒冷涡势力圈进入时刻。 */
  timeEnterTerritoryColdLow: WeatherDateTime;
  /** `TIME_PASSAGE_TERRITORY_COLD_LOW[3]` — 寒冷涡势力圈通过时刻。 */
  timePassageTerritoryColdLow: WeatherDateTime;

  /** `TIME_ENTER_TERRITORY_SoJ_LOW[3]` — 日本海低气压势力圈进入时刻。 */
  timeEnterTerritorySojLow: WeatherDateTime;
  /** `TIME_CLOSEST_SoJ_LOW[3]` — 日本海低气压最接近时刻。 */
  timeClosestSojLow: WeatherDateTime;
  /** `TIME_PASSAGE_FAKE_FINE[3]` — 二つ玉低气压疑似好天区通过时刻。 */
  timePassageFakeFine: WeatherDateTime;
  /** `TIME_PASSAGE_SoJ_LOW[3]` — 日本海低气压通过时刻。 */
  timePassageSojLow: WeatherDateTime;

  /** `TIME_ENTER_TERRITORY_SOUTHERN_LOW[3]` — 南岸低气压势力圈进入时刻。 */
  timeEnterTerritorySouthernLow: WeatherDateTime;
  /** `TIME_PASSAGE_SOUTHERN_LOW[3]` — 南岸低气压通过时刻。 */
  timePassageSouthernLow: WeatherDateTime;

  /** `TIME_ENTER_TERRITORY_TYPHOON[3]` — 台风势力圈进入时刻。 */
  timeEnterTerritoryTyphoon: WeatherDateTime;
  /** `TIME_ENTER_WIND_ZONE_TYPHOON[3]` — 台风强风域进入时刻。 */
  timeEnterWindZoneTyphoon: WeatherDateTime;
  /** `TIME_CLOSEST_TYPHOON[3]` — 台风最接近时刻。 */
  timeClosestTyphoon: WeatherDateTime;
  /** `TIME_PASSAGE_EYE_TYPHOON[3]` — 台风眼通过时刻。 */
  timePassageEyeTyphoon: WeatherDateTime;
  /** `TIME_PASSAGE_WIND_ZONE_TYPHOON[3]` — 台风强风域通过时刻。 */
  timePassageWindZoneTyphoon: WeatherDateTime;
  /** `TIME_ENTER_STORM_AREA_TYPHOON[3]` — 台风暴风域进入时刻。 */
  timeEnterStormAreaTyphoon: WeatherDateTime;
  /** `TIME_PASSAGE_STORM_AREA_TYPHOON[3]` — 台风暴风域通过时刻。 */
  timePassageStormAreaTyphoon: WeatherDateTime;

  /** `TIME_ENTER_TERRITORY_LINER_RAINBAND[3]` — 线状降水带进入时刻。 */
  timeEnterTerritoryLinerRainband: WeatherDateTime;
  /** `TIME_PASSAGE_LINER_RAINBAND[3]` — 线状降水带通过时刻。 */
  timePassageLinerRainband: WeatherDateTime;

  /** `TIME_ENTER_TERRITORY_EXTRATROPICAL_LOW[3]` — 春秋温带低气压进入时刻。 */
  timeEnterTerritoryExtratropicalLow: WeatherDateTime;
  /** `TIME_PASSAGE_WARM_FRONT[3]` — 温暖前线通过时刻。 */
  timePassageWarmFront: WeatherDateTime;
  /** `TIME_PASSAGE_COLD_FRONT[3]` — 寒冷前线通过时刻。 */
  timePassageColdFront: WeatherDateTime;
  /** `TIME_PASSAGE_EXTRATROPICAL_LOW[3]` — 温带低气压通过时刻。 */
  timePassageExtratropicalLow: WeatherDateTime;

  /* 7. 1 日预报 */
  /** `CAN_STRATUS` — 雾能否发生。 */
  canStratus: number;
  /** `CAN_CUMULUS[3]` — 积云/积乱云 (0=発達度 0-5/1=直撃？/2=風の強さ)。 */
  canCumulus: [number, number, number];
  /** `ATMOSPHERIC_INSTABILITY` — 大气不稳定度（小=不稳定→热雷易发生）。 */
  atmosphericInstability: number;
  /** `FORBIDDEN_CHANGE_WEATHER` — 天子天气操作锁。 */
  forbiddenChangeWeather: number;
  /** `TIME_ENTER_TERRITORY_CUMULUS` — 积雨云势力圈进入分钟。 */
  timeEnterTerritoryCumulus: number;
  /** `TIME_CLOSEST_CUMULUS` — 积雨云最接近分钟。 */
  timeClosestCumulus: number;
  /** `TIME_PASSAGE_CUMULUS` — 积雨云通过分钟。 */
  timePassageCumulus: number;

  /* 8. 农业 */
  /** `AMOUNT_COLD_CROP_DAMAGE` — 寒气农作物伤害量。 */
  amountColdCropDamage: number;
  /** `IS_COLD_CROP_DAMAGE` — 冷害发生？ */
  isColdCropDamage: number;
  /** `IS_STORM_CROP_DAMAGE` — 风害发生？ */
  isStormCropDamage: number;
  /** `IS_FLOOD_CROP_DAMAGE` — 水害发生？ */
  isFloodCropDamage: number;

  /* 9. 10 区域系统（每个区域独立天气/风向/彩虹） */
  /** `GENSOKYO_WEATHER_SYSTEM[10]` — 10 区域天气索引（与 TIME:5 同表）。 */
  gensokyoWeatherSystem: number[];
  /** `GENSOKYO_WIND_VE_SYSTEM[10]` — 10 区域风力。 */
  gensokyoWindVeSystem: number[];
  /** `GENSOKYO_RAINBOW_SYSTEM[10]` — 10 区域彩虹标记。 */
  gensokyoRainbowSystem: number[];
}

/* -------------------------------------------------------------- *
 * 默认值（`天候予測システム.ERB` 各变量 0/0n 初始）               *
 * -------------------------------------------------------------- */

/** 全字段默认 0 / 空数组。S1 阶段玩家从未触发预报时使用。 */
export function defaultWeatherState(): WeatherState {
  const dt = (): WeatherDateTime => [0, 0, 0];
  return {
    weatherTimezone: 0,
    windVelocity: 0,
    continuousRainfall: 0,
    continuousSnowfall: 0,
    snowCoverage: 0,
    possibilityAvalanche: 0,
    nowWeatherControl: 0,
    nowTerm: 0,
    powerColdAir: 0,
    powerWarmAir: 0,
    yearWeatherControl: 0,
    isRainySeason1: [0, 0],
    isRainySeason2: 0,
    isColdLow: 0,
    isSojLow: 0,
    isSouthernLow: 0,
    isTyphoon: [0, 0, 0, 0],
    isLinerRainband: [0, 0],
    timeEnterTerritoryColdLow: dt(),
    timePassageTerritoryColdLow: dt(),
    timeEnterTerritorySojLow: dt(),
    timeClosestSojLow: dt(),
    timePassageFakeFine: dt(),
    timePassageSojLow: dt(),
    timeEnterTerritorySouthernLow: dt(),
    timePassageSouthernLow: dt(),
    timeEnterTerritoryTyphoon: dt(),
    timeEnterWindZoneTyphoon: dt(),
    timeClosestTyphoon: dt(),
    timePassageEyeTyphoon: dt(),
    timePassageWindZoneTyphoon: dt(),
    timeEnterStormAreaTyphoon: dt(),
    timePassageStormAreaTyphoon: dt(),
    timeEnterTerritoryLinerRainband: dt(),
    timePassageLinerRainband: dt(),
    timeEnterTerritoryExtratropicalLow: dt(),
    timePassageWarmFront: dt(),
    timePassageColdFront: dt(),
    timePassageExtratropicalLow: dt(),
    canStratus: 0,
    canCumulus: [0, 0, 0],
    atmosphericInstability: 0,
    forbiddenChangeWeather: 0,
    timeEnterTerritoryCumulus: 0,
    timeClosestCumulus: 0,
    timePassageCumulus: 0,
    amountColdCropDamage: 0,
    isColdCropDamage: 0,
    isStormCropDamage: 0,
    isFloodCropDamage: 0,
    gensokyoWeatherSystem: new Array(REGION_COUNT).fill(0),
    gensokyoWindVeSystem: new Array(REGION_COUNT).fill(0),
    gensokyoRainbowSystem: new Array(REGION_COUNT).fill(0),
  };
}

/* -------------------------------------------------------------- *
 * 访问器 — 永远返回非空（lazily 初始化）                          *
 * -------------------------------------------------------------- */

/** 取 state.weather，没有就塞默认。 */
export function getWeatherState(state: GameState): WeatherState {
  if (!state.weather) {
    state.weather = defaultWeatherState();
  }
  return normalizeWeatherState(state.weather);
}

/** 强制初始化为默认（NEWGAME 路径用）。 */
export function ensureWeatherState(state: GameState): WeatherState {
  if (!state.weather) {
    state.weather = defaultWeatherState();
  }
  return normalizeWeatherState(state.weather);
}

function normalizeWeatherState(weather: WeatherState): WeatherState {
  const defaults = defaultWeatherState();
  const w = weather as WeatherState & Record<string, unknown>;
  for (const key of Object.keys(defaults) as Array<keyof WeatherState>) {
    if (w[key] === undefined) {
      w[key as string] = defaults[key];
    }
  }
  return weather;
}
