/**
 * Colored-map terrain-vs-label classifier.
 *
 * Some map cells are place-name TEXT drawn into the art (小兔姬 / 警察署 /
 * 花屋 …). The upstream art colours a few of them with dark palette values
 * (0x513D29 / 0x292929 …) that vanish on our dark map — the "地点文字变黑" bug.
 * Room-number cells are already forced readable in ColoredMapView; this lets
 * both map renderers force place-name LABEL text readable too, WITHOUT
 * touching terrain (森/林/合/仝 hatching that is meant to keep its colour).
 *
 * The reliable signal is frequency: terrain glyphs are map TEXTURE repeated
 * hundreds of times; place-name characters are rare. Measured on the shipped
 * bundle there is a clean gap — terrain ≥ 17 (合134/二17/森1123…), labels ≤ 6
 * (屋6/姬1/警1…). We treat a rare CJK glyph as a label and a frequent (or
 * seasonally-animated) one as terrain. `TERRAIN_FREQ_MIN` sits in the gap.
 */

import coloredMaps from "./colored-maps.bundle.json";

interface MapPageLite {
  chars: string[][];
  colorNames?: string[][];
}
const MAPS = coloredMaps as unknown as Record<string, MapPageLite[]>;

/** Seasonal / animation terrain colour tokens (map-palettes TERRAIN_OFFSET +
 *  FIXED_NAMED animation names). A glyph ever drawn with one of these is
 *  terrain even if it's rare (e.g. 炎/竹). */
const TERRAIN_TYPE_NAMES = new Set([
  "bambood", "bambool", "bamboon", "bamboos",
  "florad", "floral", "floran", "floras",
  "sakurad", "sakural", "sakuran", "sakuras",
  "ground", "paving", "water", "still", "tides",
  "flower", "flowers", "flame", "spray", "fall",
]);

/** Frequency at/above which a CJK glyph is map texture, not a place name.
 *  Sits in the measured gap between labels (≤6) and terrain (≥17). */
const TERRAIN_FREQ_MIN = 12;

function isCjkIdeograph(ch: string): boolean {
  if (ch.length !== 1) return false;
  const cp = ch.codePointAt(0)!;
  return cp >= 0x4e00 && cp <= 0x9fff;
}

const freq = new Map<string, number>();
const seasonalTerrain = new Set<string>();
for (const pages of Object.values(MAPS)) {
  for (const pg of pages) {
    const cn = pg.colorNames;
    for (let y = 0; y < pg.chars.length; y++) {
      const row = pg.chars[y]!;
      for (let x = 0; x < row.length; x++) {
        const g = row[x]!;
        if (!isCjkIdeograph(g)) continue;
        freq.set(g, (freq.get(g) ?? 0) + 1);
        const tok = cn?.[y]?.[x];
        if (tok && TERRAIN_TYPE_NAMES.has(tok)) seasonalTerrain.add(g);
      }
    }
  }
}

/**
 * Is this cell glyph a place-name LABEL (as opposed to terrain texture)?
 * A rare, non-animated CJK ideograph. Callers force these to a readable
 * colour so location names never render as invisible dark text.
 */
export function isPlaceLabelGlyph(glyph: string): boolean {
  if (!isCjkIdeograph(glyph)) return false;
  if (seasonalTerrain.has(glyph)) return false;
  return (freq.get(glyph) ?? 0) < TERRAIN_FREQ_MIN;
}

/** The readable colour for place-name label text (matches the room-number
 *  “other” colour + the RESETCOLOR default). */
export const LABEL_TEXT_COLOR = "#e6edf3";
