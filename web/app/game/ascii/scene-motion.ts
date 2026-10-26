import gardenMotion from "../../../../modernization/assets/scenes/shrine-niwa/background.motion.json";
import corridorMotion from "../../../../modernization/assets/scenes/shrine-roka/background.motion.json";
import onsenMotion from "../../../../modernization/assets/scenes/shrine-onsen/background.motion.json";
import type { GameState } from "../../../../modernization/runtime/state/game-state.js";
import { currentRegionWeather } from "../../../../modernization/runtime/weather/region-override.js";
import { WEATHER_ID } from "../../../../modernization/runtime/weather/constants.js";
import { ABNORMAL_WEATHER, currentAbnormal } from "../../../../modernization/runtime/weather/abnormal-weather.js";
import { hasLocationPlaceFlags, outRoof } from "../../../../modernization/runtime/world/location-predicates.js";

export type Precipitation = "rain" | "snow" | "hail" | "underwear";
export interface SceneWeather {
  effects: readonly { kind: Precipitation; intensity: number }[];
  wind: number;
  exposed: boolean;
}
export const CLEAR_SCENE_WEATHER: SceneWeather = { effects: [], wind: 0, exposed: false };

export const WEATHER_PREVIEWS = [
  ["game", "跟随游戏"], ["clear", "晴天"], ["drizzle", "小雨"], ["rain", "雨"],
  ["heavy-rain", "大雨"], ["storm", "暴雨"], ["snow", "雪"], ["heavy-snow", "大雪"],
  ["sleet", "雨夹雪"], ["hail", "冰雹"], ["underwear", "胖次雨"],
] as const;
export type WeatherPreview = typeof WEATHER_PREVIEWS[number][0];

/** Disposable UI override; it cannot initialize or mutate runtime weather. */
export function previewSceneWeather(actual: SceneWeather, mode: WeatherPreview): SceneWeather {
  if (mode === "game") return actual;
  const effects: SceneWeather["effects"] = mode === "clear" ? []
    : mode === "sleet" ? [{ kind: "rain", intensity: 0.35 }, { kind: "snow", intensity: 0.35 }]
    : mode === "underwear" ? [{ kind: "underwear", intensity: 0.5 }]
    : mode === "hail" ? [{ kind: "hail", intensity: 0.65 }]
    : mode === "snow" || mode === "heavy-snow" ? [{ kind: "snow", intensity: mode === "snow" ? 0.5 : 0.9 }]
    : [{ kind: "rain", intensity: mode === "drizzle" ? 0.2 : mode === "rain" ? 0.5 : mode === "heavy-rain" ? 0.8 : 1 }];
  return { ...actual, effects, wind: mode === "storm" ? 2 : 0 };
}

/** Read the same regional simulation as the HUD, never the time-based approximation. */
export function sceneWeather(state: GameState | undefined, location: string): SceneWeather {
  if (!state) return CLEAR_SCENE_WEATHER;
  const regional = currentRegionWeather(state, location);
  const effects: { kind: Precipitation; intensity: number }[] = [];
  const add = (kind: Precipitation, intensity: number) => effects.push({ kind, intensity });
  if (regional.weatherVisible) {
    switch (regional.weatherIndex) {
      case WEATHER_ID.雨: add("rain", 0.5); break;
      case WEATHER_ID.大雨: add("rain", 0.8); break;
      case WEATHER_ID.暴雨: add("rain", 1); break;
      case WEATHER_ID.雾雨: add("rain", 0.2); break;
      case WEATHER_ID.雪: add("snow", 0.5); break;
      case WEATHER_ID.大雪: add("snow", 0.9); break;
      case WEATHER_ID.细雪: case WEATHER_ID.雾雪: add("snow", 0.2); break;
      case WEATHER_ID.雨夹雪: add("rain", 0.35); add("snow", 0.35); break;
      case WEATHER_ID.冰霰: add("hail", 0.35); break;
      case WEATHER_ID.冰雹: add("hail", 0.65); break;
    }
    // These are additional upstream weather overlays, not a replacement for regional weather.
    if (currentAbnormal(state) === ABNORMAL_WEATHER.PANTSU) add("underwear", 0.25);
  }
  return {
    effects,
    wind: regional.windVisible ? Math.min(3, Math.max(0, regional.windIndex)) : 0,
    // Unknown locations fail closed instead of treating every missing room as roofless.
    exposed: hasLocationPlaceFlags(location) && outRoof(state, location) === 1,
  };
}

type Rect = readonly [number, number, number, number];
export interface MotionProfile {
  cols: number; rows: number; aspect: number;
  rainWindows?: readonly Rect[];
  shelters?: readonly Rect[];
  ambient: "tea" | "leaves" | "onsen" | "dust";
}

/** Row masks follow the sloping paper-screen edges in the approved P4 sketch.
 * Insets keep precipitation off the surrounding wooden frames.
 */
function slopedWindow(x0: number, x1: number, top0: number, top1: number, bottom0: number, bottom1: number): Rect[] {
  const rows: Rect[] = [];
  for (let y = Math.ceil(Math.min(top0, top1)) + 1; y < Math.max(bottom0, bottom1) - 1; y++) {
    const columns: number[] = [];
    for (let x = x0 + 1; x < x1; x++) {
      const t = (x - x0) / (x1 - x0);
      if (y > top0 + (top1 - top0) * t + 1 && y < bottom0 + (bottom1 - bottom0) * t - 1) columns.push(x);
    }
    if (columns.length) rows.push([columns[0]!, y, columns[columns.length - 1]!, y]);
  }
  return rows;
}
const STOREHOUSE_WINDOWS: readonly Rect[] = [[183, 32, 212, 40]];
const MAIN_HALL_WINDOWS: readonly Rect[] = [
  ...slopedWindow(17, 59, 31, 37, 81, 66),
  ...slopedWindow(240, 283, 37, 31, 66, 81),
];

/** Coordinates match the authored character grids. Weather never paints across walls. */
export function motionProfile(sceneId: string, exposed: boolean): MotionProfile {
  switch (sceneId) {
    case "tikurin-eientei-gate": return { cols: 200, rows: 72, aspect: 5 / 3, rainWindows: [[0, 0, 199, 71]], ambient: "leaves" };
    case "shrine-niwa": return { cols: 300, rows: 108, aspect: 5 / 3, rainWindows: gardenMotion.weatherWindows as unknown as readonly Rect[], ambient: "leaves" };
    case "shrine-forest": return { cols: 200, rows: 72, aspect: 5 / 3, ambient: "leaves" };
    case "shrine-reimu-room": return { cols: 200, rows: 72, aspect: 5 / 3, rainWindows: [], ambient: "dust" };
    case "shrine-roka": return { cols: 300, rows: 108, aspect: 5 / 3, rainWindows: corridorMotion.weatherWindows as unknown as readonly Rect[], ambient: "dust" };
    case "shrine-storehouse": return { cols: 300, rows: 108, aspect: 5 / 3, rainWindows: STOREHOUSE_WINDOWS, ambient: "dust" };
    case "shrine-hondou": return { cols: 300, rows: 108, aspect: 5 / 3, rainWindows: MAIN_HALL_WINDOWS, ambient: "dust" };
    case "shrine-ima": return { cols: 300, rows: 108, aspect: 5 / 3, rainWindows: [[221, 22, 293, 55]], ambient: "tea" };
    case "shrine-sando": return { cols: 200, rows: 72, aspect: 5 / 3, shelters: [[57, 36, 120, 50]], ambient: "leaves" };
    case "shrine-onsen": return { cols: 200, rows: 72, aspect: 5 / 3, rainWindows: onsenMotion.weatherWindows as unknown as readonly Rect[], ambient: "onsen" };
    default: return { cols: 100, rows: 50, aspect: 0, ambient: exposed ? "leaves" : "dust" };
  }
}

export interface MotionGlyph { x: number; y: number; text: string; color: string; alpha: number; native?: boolean }
const within = (x: number, y: number, r: Rect) => x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3];
export function precipitationAllowed(profile: MotionProfile, exposed: boolean, x: number, y: number): boolean {
  if (profile.rainWindows) return profile.rainWindows.some((r) => within(x, y, r));
  return exposed && !profile.shelters?.some((r) => within(x, y, r));
}
const fraction = (n: number) => n - Math.floor(n);
const hash = (n: number, seed: number) => fraction(Math.sin(n * 127.1 + seed * 311.7) * 43758.5453);

/** Merge adjacent row masks into window bounds for local particle generation. */
function windowBounds(windows: readonly Rect[]): Rect[] {
  const bounds: Rect[] = [];
  for (const r of windows) {
    const i = bounds.findIndex(b => r[0] <= b[2] + 1 && r[2] >= b[0] - 1 && r[1] <= b[3] + 1 && r[3] >= b[1] - 1);
    if (i < 0) bounds.push(r);
    else {
      const b = bounds[i]!;
      bounds[i] = [Math.min(r[0], b[0]), Math.min(r[1], b[1]), Math.max(r[2], b[2]), Math.max(r[3], b[3])];
    }
  }
  return bounds;
}
export function sceneMotionSeed(sceneId: string): number {
  return Array.from(sceneId).reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) >>> 0, 7);
}

/** A reproducible visual frame. Uses no game RNG, clocks, or state writes. */
export function motionGlyphs(profile: MotionProfile, weather: SceneWeather, seed: number, seconds: number, ambient = true): MotionGlyph[] {
  const glyphs: MotionGlyph[] = [];
  const put = (x: number, y: number, text: string, color: string, alpha: number) => {
    if (x >= 0 && y >= 0 && x < profile.cols && y < profile.rows) glyphs.push({ x: Math.floor(x), y: Math.floor(y), text, color, alpha });
  };
  weather.effects.forEach((effect, layer) => {
    const density = effect.kind === "underwear" ? 18 : 220;
    const regions: readonly Rect[] = profile.rainWindows ? windowBounds(profile.rainWindows) : [[0, 0, profile.cols - 1, profile.rows - 1]];
    const speed = effect.kind === "snow" ? 3 : effect.kind === "underwear" ? 5 : 28;
    regions.forEach(([x0, y0, x1, y1], region) => {
      const width = x1 - x0 + 1, height = y1 - y0 + 1;
      const localDensity = density * width * height / (profile.cols * profile.rows);
      const count = Math.round((profile.rainWindows ? Math.max(effect.kind === "underwear" ? 4 : 16, localDensity) : density) * effect.intensity);
      for (let i = 0; i < count; i++) {
        const k = i + layer * 331 + region * 997;
        const y = y0 + Math.floor(fraction(hash(k + 10, seed) + seconds * speed / height) * height);
        const x = x0 + Math.floor(fraction(hash(k, seed) + seconds * (0.8 + weather.wind * 3) / width) * width);
        const text = effect.kind === "rain" ? (weather.wind ? "/" : "|") : effect.kind === "snow" ? (i % 3 ? "." : "*") : effect.kind === "hail" ? "o" : "\\_/";
        const stamp = effect.kind === "underwear" ? [text, " V "] : [text];
        // Check the entire multi-cell stamp against walls, roof masks and image bounds.
        if (!stamp.every((line, dy) => Array.from(line).every((_, dx) =>
          x + dx < profile.cols && y + dy < profile.rows && precipitationAllowed(profile, weather.exposed, x + dx, y + dy)))) continue;
        stamp.forEach((line, dy) => put(x, y + dy, line, effect.kind === "rain" ? "#a9d4e5" : "#e4edf0", profile.rainWindows ? 0.9 : 0.55));
      }
    });
  });
  if (!ambient) return glyphs;
  if (profile.ambient === "tea" || profile.ambient === "onsen") {
    const sources = profile.ambient === "tea" ? [[156, 55, 9], [176, 61, 6]] : [[74, 46, 13], [103, 48, 15], [133, 45, 12]];
    for (const [sx, sy, height] of sources) for (let i = 0; i < 14; i++) {
      const phase = fraction(i / 14 + seconds / 5);
      put(sx + Math.sin(phase * 5 + seconds * 0.5 + sx) * (1 + phase * 3), sy - phase * height, i % 3 ? "." : "'", "#cfcebc", (1 - phase) * 0.5);
    }
    if (profile.ambient === "onsen") for (let i = 0; i < 16; i++) {
      const x = 62 + hash(i, seed) * 80, y = 44 + hash(i + 80, seed) * 9;
      put(x, y, seconds % 3 < 1.5 ? "~" : "-", "#6ba5aa", 0.2 + 0.2 * Math.sin(seconds + i) ** 2);
    }
  } else {
    for (let i = 0; i < (profile.ambient === "leaves" ? 14 : 8); i++) {
      const x = fraction(hash(i, seed) + seconds / 70) * profile.cols;
      const y = fraction(hash(i + 30, seed) + seconds / 40) * profile.rows;
      if (profile.ambient === "leaves" && !precipitationAllowed(profile, weather.exposed, x, y)) continue;
      put(x, y, profile.ambient === "leaves" ? ["'", ",", "`", "."][i % 4] : ".", profile.ambient === "leaves" ? "#b8a083" : "#a79b87", 0.35);
    }
  }
  return glyphs;
}

export function fitMotionViewport(width: number, height: number, aspect: number) {
  const w = aspect > 0 ? Math.min(width, height * aspect) : width;
  const h = aspect > 0 ? w / aspect : height;
  return { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h };
}
