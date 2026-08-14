/**
 * Backward-compatible S2 import surface.
 *
 * S3 replaces the old stubbed helpers with real low-pressure and thunderstorm
 * implementations while keeping this file so older imports continue to work.
 */

export { getLocationLow } from "./low-pressure.js";
export { getFrontalThunderstorm, getHeatThunderstorm, getWeatherThunderstorm } from "./thunderstorm.js";
