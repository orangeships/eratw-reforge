/**
 * Read-only colored-map preview (字符画) for the residence selection page.
 *
 * Renders the real `colored-maps.bundle.json` page (the same data the in-game
 * `ColoredMapView` / upstream `DRAW_COLOREDMAP` use) as a static grid of
 * colored glyphs — no interactivity. This is the faithful 字符画 the original
 * SET_MAINHOME page draws above the candidate list; we reuse the shipped map
 * art instead of inventing ASCII.
 */

import coloredMaps from "../colored-maps.bundle.json";
import { cellEmWidth } from "../map-cell-width.js";
import { isPlaceLabelGlyph, LABEL_TEXT_COLOR } from "../map-terrain.js";

interface MapPage {
  name: string;
  page: number;
  mapId: number;
  chars: string[][];
  colors: string[][];
  colorNames?: string[][];
}
const MAPS = coloredMaps as unknown as Record<string, MapPage[]>;

export interface ColoredMapPreviewProps {
  /** colored-maps key: "HAKUREI" | "SATO" | … */
  mapKey: string;
  testId?: string;
}

export default function ColoredMapPreview({ mapKey, testId }: ColoredMapPreviewProps) {
  const pages = MAPS[mapKey];
  const page = pages?.[0];
  if (!page) {
    return (
      <div className="residence-mappreview residence-mappreview--missing" data-testid={testId}>
        （此地区暂无地图预览）
      </div>
    );
  }
  return (
    <div className="residence-mappreview" data-testid={testId} aria-label={`${mapKey} 地图`}>
      <pre className="residence-mappreview__grid" aria-hidden="true">
        {page.chars.map((row, y) => (
          <div key={y} className="residence-mappreview__row">
            {row.map((glyph, x) => (
              <span
                key={x}
                className="residence-mappreview__cell"
                style={{
                  // Place-name labels forced readable (see map-terrain); terrain
                  // keeps its baked color.
                  color: isPlaceLabelGlyph(glyph)
                    ? LABEL_TEXT_COLOR
                    : (page.colors?.[y]?.[x] ?? "#789"),
                  width: `${cellEmWidth(glyph)}em`,
                }}
              >
                {glyph === " " || glyph === "" ? "　" : glyph}
              </span>
            ))}
          </div>
        ))}
      </pre>
    </div>
  );
}
