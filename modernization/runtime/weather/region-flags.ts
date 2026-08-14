/**
 * Compatibility exports for S1 callers. The complete S6 implementation lives
 * in `region-system.ts`; keep this module so older imports do not fork rules.
 */

export { REGION_ID } from "../state/weather-state.js";
export {
  isAsamajouezan,
  isHigan,
  isJigoku,
  isKyuujigoku,
  isMakai,
  isMeikai,
  isNoRain,
  isNoRainAt,
  isNoRainLocation,
  isNoRainbow,
  isNoRainbowLocation,
  isNoSeasonChange,
  isNoSeasonChangeLocation,
  isNoSun,
  isNoSunLocation,
  isNoTimeSee,
  isNoTimeSeeAt,
  isNoTimeSeeLocation,
  isNoWeatherChange,
  isNoWeatherChangeLocation,
  isNoWeatherSee,
  isNoWeatherSeeAt,
  isNoWeatherSeeLocation,
  isNoWindChange,
  isNoWindChangeLocation,
  isNoWindVelocity,
  isNoWindVelocityLocation,
  isSanzukawa,
  isSenkai,
  isTsukimiyako,
  isYumesekai,
  masterRegionId,
  regionIdOfLocation,
  regionName,
  REGION_NAMES,
} from "./region-system.js";
