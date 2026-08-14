/**
 * 外出 (COM405 → @OTHERREGIONS) — the global world-map hub.
 *
 * P2-c: renders the upstream `@COLOREDFIELD` ASCII overview (幻想郷 global
 * terrain + 12 region numbered cells 00-11) instead of a flat button list.
 * Clicking a built region's numbered cell issues its cross-map move
 * commandNo (10701/10702); unbuilt regions render but are disabled. A text
 * button list below mirrors upstream OTHERREGION.ERB:58-83 (`[MAPID] - 名`)
 * as an accessible double entry. The current region is disabled.
 *
 * 自宅 is NOT a peer region here — it is a room inside the home region
 * (P1-1), reached via the map page's 「返回自宅」 button (COM 10703).
 */

import { type FC, useState, useRef, useLayoutEffect } from "react";
import coloredMaps from "./colored-maps.bundle.json";
import { resolvePageColors } from "./map-palettes.js";
import {
  REGIONS,
  regionByMapId,
  currentMapIdForLocation,
} from "./regions.js";

interface MapPage {
  name: string;
  page: number;
  mapId: number;
  chars: string[][];
  colors: string[][];
  colorNames?: string[][];
  rooms: Array<{ num: string; locationId: number; row: number; col: number }>;
}
const MAPS = coloredMaps as Record<string, MapPage[]>;

interface Props {
  currentLocation: string;
  onTravel: (commandNo: number) => void;
  onClose: () => void;
  /** P2-b: current season (1..4) to recolor the field terrain. Default spring. */
  season?: number;
}

const WorldMapView: FC<Props> = ({ currentLocation, onTravel, onClose, season = 1 }) => {
  const currentMapId = currentMapIdForLocation(currentLocation);
  const fieldPages = MAPS.FIELD;
  const fieldPage = fieldPages?.[0];

  // Adapt the glyph size to the container width so the 32-col field map fits.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [cellPx, setCellPx] = useState(14);
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el || !fieldPage) return;
    const cols = fieldPage.chars[0]?.length ?? 32;
    const update = (): void => {
      const w = el.clientWidth - 16;
      setCellPx(Math.max(6, Math.min(22, Math.floor(w / cols))));
    };
    update();
    if (typeof ResizeObserver === "undefined") return; // jsdom guard
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fieldPage]);

  // region cell lookup: "row,col" → region MAPID.
  const regionCellByPos = new Map<string, number>();
  if (fieldPage) {
    for (const room of fieldPage.rooms) {
      regionCellByPos.set(`${room.row},${room.col}`, room.locationId);
      regionCellByPos.set(`${room.row},${room.col + 1}`, room.locationId);
    }
  }
  const resolvedColors =
    fieldPage && fieldPage.colorNames
      ? resolvePageColors(fieldPage.colorNames, season)
      : fieldPage?.colors ?? [];

  return (
    <section className="world-map" data-testid="world-map" ref={wrapRef}>
      <header className="world-map__header">
        <h2>幻想郷 地图</h2>
        <button
          type="button"
          className="world-map__close"
          data-testid="world-map-close"
          onClick={onClose}
        >
          [返回场景]
        </button>
      </header>

      {fieldPage ? (
        <div
          className="colored-map__grid world-map__field"
          data-testid="world-map-field"
          style={{ fontSize: `${cellPx}px` }}
        >
          {fieldPage.chars.map((rowChars, r) => (
            <div className="colored-map__row" key={r}>
              {rowChars.map((glyph, c) => {
                const mapId = regionCellByPos.get(`${r},${c}`);
                const isRegionCell = mapId !== undefined;
                const region = isRegionCell ? regionByMapId(mapId!) : undefined;
                const isCurrent = region != null && region.mapId === currentMapId;
                const clickable =
                  !!region && region.built && !isCurrent;
                const ch = glyph === "" || glyph === " " ? "　" : glyph;
                // Region cells use a readable highlight (like ColoredMapView's
                // room cells); terrain keeps the seasonal color.
                const color = isRegionCell
                  ? isCurrent
                    ? "#ffe680"
                    : clickable
                      ? "#9be8a8"
                      : "#e6edf3"
                  : (resolvedColors[r]?.[c] ?? "#888");
                return (
                  <span
                    key={c}
                    className={
                      "colored-map__cell" +
                      (isRegionCell ? " colored-map__cell--room" : "") +
                      (isCurrent ? " colored-map__cell--current" : "") +
                      (clickable ? " colored-map__cell--clickable" : "")
                    }
                    data-region={isRegionCell ? String(mapId) : undefined}
                    data-testid={isRegionCell ? "world-map-region" : undefined}
                    style={{
                      color,
                      cursor: clickable ? "pointer" : undefined,
                    }}
                    title={
                      isRegionCell && region
                        ? region.built
                          ? isCurrent
                            ? `${region.label}（当前）`
                            : `前往${region.label}`
                          : `${region.label}（未实装）`
                        : undefined
                    }
                    onClick={
                      clickable && region?.commandNo != null
                        ? () => onTravel(region.commandNo!)
                        : undefined
                    }
                  >
                    {ch}
                  </span>
                );
              })}
            </div>
          ))}
        </div>
      ) : (
        <p className="world-map__hint">全局地图资产未生成。</p>
      )}

      <p className="world-map__hint">选择要前往的区域。</p>
      <div className="world-map__regions" aria-label="可前往的区域">
        {REGIONS.map((r) => {
          const isCurrent = r.mapId === currentMapId;
          const disabled = isCurrent || !r.built;
          return (
            <button
              key={r.mapId}
              type="button"
              className={
                "world-map__region" +
                (isCurrent ? " world-map__region--current" : "")
              }
              data-testid="world-map-region-list"
              data-region={r.mapId}
              disabled={disabled}
              title={r.built ? (isCurrent ? "当前区域" : `前往${r.label}`) : "未实装"}
              onClick={() => r.commandNo != null && onTravel(r.commandNo)}
            >
              <strong>[{String(r.mapId).padStart(2, "0")}] {r.label}</strong>
              <span>
                {isCurrent ? "（当前）" : r.built ? "前往" : "（未实装）"}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
};

export default WorldMapView;
