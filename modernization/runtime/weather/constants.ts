/**
 * Weather-system constants from `天候システム.ERH:842-882`.
 *
 * Keep these numeric values aligned with the upstream ERA constants and
 * `runtime/state/weather.ts::WEATHER_NAMES`.
 */

export const WEATHER_ID = {
  少云: 0,
  晴: 1,
  多云: 2,
  阴: 3,
  雨: 4,
  大雨: 5,
  雾雨: 6,
  雾: 7,
  雪: 8,
  大雪: 9,
  细雪: 10,
  雾雪: 11,
  雨夹雪: 12,
  冰霰: 13,
  暴雨: 14,
  冰雹: 15,
} as const;

export const RAINBOW_ID = {
  无虹: 0,
  彩虹: 1,
  钻石尘: 2,
  流星: 3,
  流星群: 4,
} as const;

export const WIND_ID = {
  无风: 0,
  强风: 1,
  暴风: 2,
  飓风: 3,
} as const;

export const COMMON_REGION = 0;

