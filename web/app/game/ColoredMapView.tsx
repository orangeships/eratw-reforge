/**
 * Phase 8 (Slice 8) — ColoredMapView.
 *
 * Renders the upstream COLOR ASCII map (faithful full-width glyph grid +
 * per-cell RGB) from `colored-maps.bundle.json` (built by
 * `scripts/build-colored-maps.ts`). Room-number cells whose location is an
 * available move (adjacent, from `moveCommands`) are clickable → walk there.
 * The player's current room is highlighted. Multi-page maps get tab arrows.
 *
 * Faithful to the original `DRAW_COLOREDMAP`: the glyph carries no location
 * semantics (a green 火 glyph = forest), the COLOR carries the terrain — we
 * resolve the seasonal palette at runtime from `time.season` (P2-b MVP;
 * animation / snow / 気配 / 汚れ overlays are runtime-state effects, deferred).
 * Moves are per-edge (no warp), so only rooms adjacent to the current
 * location are clickable — same as walking.
 *
 * P2-a: the map font is `map-gothic` (a subset of upstream MS Gothic — the
 * font COLOREDMAP renders with, DRAW_COLOREDMAP.ERB:28). The glyphs are
 * standard Unicode CJK (森/林/田/全角空格 …), NOT PUA; MS Gothic covers them
 * all at a uniform 1em advance so the grid never misaligns. The old
 * Saitamaar @font-face over-declared CJK ranges and rendered .notdef boxes.
 */

import { type FC, useState, useRef, useLayoutEffect, useEffect } from "react";
import coloredMaps from "./colored-maps.bundle.json";
import { resolvePageColors } from "./map-palettes.js";
import { cellEmWidth } from "./map-cell-width.js";
import { isPlaceLabelGlyph, LABEL_TEXT_COLOR } from "./map-terrain.js";
import { findPath } from "./pathfind.js";
import { currentMapIdForLocation } from "./regions.js";
import {
  detectionOverlay,
  nextDetectionMode,
  canSensePresence,
  canSenseDirt,
  DETECTION_OFF,
  DETECTION_PRESENCE,
  DETECTION_DIRT,
  type DetectionMode,
  type DetectionCell,
} from "../../../modernization/runtime/world/detection.js";
import type { GameState } from "../../../modernization/runtime/state/game-state.js";

interface RoomCell {
  num: string;
  locationId: number;
  location: string | null;
  row: number;
  col: number;
  /** Arrow-marked jump symbol to the same spot on another page (see builder). */
  jump?: boolean;
  /** Authoritative area page (from MAP_AREASELECT); see builder. */
  areaPage?: number;
  /** P1-#4 Slice B — the per-cell zone hint (P1-#4 Slice A's
   *  `*_ZoneOf` result, or `null` for unbuilt maps / unmapped rooms).
   *  Used by `ColoredMapView` to highlight the player's current zone
   *  cluster. `null` when the location has no zone descriptor. */
  zone?: string | null;
}
interface MapPage {
  name: string;
  page: number;
  mapId: number;
  chars: string[][];
  colors: string[][];
  /** P2-b: raw MAPROW_COLORS tokens per cell (terrain name / hex / "" = inherit),
   *  resolved at runtime by `resolvePageColors` against the seasonal palette.
   *  Optional (older bundles lack it → fall back to `colors`). */
  colorNames?: string[][];
  rooms: RoomCell[];
}
const MAPS = coloredMaps as Record<string, MapPage[]>;
const MAP_KEY_BY_ID = new Map<number, string>([
  [0, "HAKUREI"],
  [1, "TEMPLE"],
  [2, "SATO"],
  [3, "KOUMAKAN"],
  [4, "TIKURIN"],
  [5, "FOREST"],
  [6, "MEIKAI"],
  [7, "SANROKU"],
  [8, "SUMMIT"],
  [9, "CHIREIDEN"],
  [10, "TUKI"],
]);

const MAP_TITLE_BY_KEY = new Map<string, string>([
  ["HAKUREI", "博麗神社"],
  ["TEMPLE", "命蓮寺"],
  ["SATO", "人間之里"],
  ["KOUMAKAN", "紅魔館"],
  ["TIKURIN", "迷途竹林"],
  ["FOREST", "魔法之森"],
  ["MEIKAI", "三途之川～冥界"],
  ["SANROKU", "妖怪之山(山麓)"],
  ["SUMMIT", "妖怪之山(山頂)"],
  ["CHIREIDEN", "地底"],
  ["TUKI", "夢之世界～月"],
]);

/** Which bundled map a location string belongs to. */
function mapNameForLocation(loc: string): string | null {
  const mapId = currentMapIdForLocation(loc);
  return mapId === null ? null : (MAP_KEY_BY_ID.get(mapId) ?? null);
}

/**
 * Readable short room name for the overlay legend (P-12). Even with the
 * map-gothic font (P2-a), the terrain glyphs are pictographs (森/▲/≡) and
 * don't name the place, so we surface the location string's room part —
 * the part after the colon ("人間之里:寺子屋" → "寺子屋"), or the whole
 * string for a map root ("人間之里"). No font needed.
 */
function shortRoomName(loc: string): string {
  const i = loc.indexOf(":");
  return i >= 0 ? loc.slice(i + 1) : loc;
}

interface Props {
  currentLocation: string;
  onMove: (commandNo: number) => void;
  /** commandNo → toLocation for the moves available from here (scene exits). */
  moveCommands: Array<{ commandNo: number; toLocation: string }>;
  /** Walk a whole path (multi-hop) to a clicked room. When provided, ANY
   *  reachable room is clickable (not just adjacent ones) — the original
   *  map's "click a spot and go there" pathfinding. The argument is the
   *  ordered room list `[first hop … destination]` (Phase D #9 SKIP_MOVE: the
   *  walk engine narrates pass-through encounters per room). Falls back to
   *  single-hop `onMove` when absent. */
  onMovePath?: (rooms: string[]) => void;
  /** Open the global world map (COM604[99] 移動至其他地域). Lets the player
   *  leave this region for another from inside the map page. Optional: when
   *  absent the button isn't rendered (keeps map-only test renders green). */
  onOpenWorldMap?: () => void;
  onClose?: () => void;
  /** P1-1 (实玩反馈 #10): 「返回自宅」 — issue COM 10703 (move-to-home) to
   *  deposit the master at `homeLocation`. Mirrors upstream COM400 移動's
   *  `[0] 返回私室`. Optional; when absent the button isn't rendered. */
  onReturnHome?: () => void;
  /** Whether 返回自宅 is actionable (false when already at home). */
  canReturnHome?: boolean;
  /** P2-b: the current season (1=spring…4=winter) to recolor terrain. When
   *  omitted, falls back to the bundle's baked spring `colors` (legacy). */
  season?: number;
  /** Phase C (实玩反馈 #3) — the live game state, for the 察知 (sensing) map
   *  overlays (presence / dirt coloring, @GETMAP/DRAW_MAP.ERB). Optional: when
   *  absent the 察知 toggle isn't rendered (keeps map-only test renders green). */
  gameState?: GameState;
}

const DETECTION_LABEL: Record<DetectionMode, string> = {
  [DETECTION_OFF]: "察知:关",
  [DETECTION_PRESENCE]: "察知:气配",
  [DETECTION_DIRT]: "察知:污秽",
};

const ColoredMapView: FC<Props> = ({ currentLocation, onMove, moveCommands, onMovePath, onOpenWorldMap, onClose, onReturnHome, canReturnHome, season, gameState }) => {
  const mapName = mapNameForLocation(currentLocation);
  const pages = mapName ? MAPS[mapName] : undefined;

  /**
   * The canonical page to view a location from. The upstream artist splits a
   * map by AREA, not by glyph: shrine 参道(22) is area-page 6 (神社周辺), but a
   * 22 glyph is also drawn on pages 1/3/4 as a jump symbol. So the FIRST page
   * that draws the glyph is NOT the right page — `MAP_AREASELECT` is. Each
   * room cell carries its authoritative `areaPage`; we resolve to that page
   * (its index in `pages`), with fallbacks:
   *   1. areaPage (if that page is actually drawn),
   *   2. the first page where the location appears as a REAL (non-jump) room,
   *   3. the first page that draws it at all,
   *   4. null (stay put).
   * Fallback 1 covers undrawn area pages (e.g. shrine 大別墅 area-page 5 has
   * no COLOREDMAP art; 大广场(68) falls through to page 6 which draws it).
   */
  function realPageForLocation(loc: string): number | null {
    if (!pages) return null;
    // Collect this location's areaPage (rooms share it) + every page that
    // draws it, tracking whether any drawing is a real (non-jump) room.
    let areaPage: number | undefined;
    let firstReal = -1;
    let firstAny = -1;
    for (let i = 0; i < pages.length; i++) {
      const rooms = pages[i]!.rooms;
      const match = rooms.find((r) => r.location === loc);
      if (!match) continue;
      if (areaPage === undefined) areaPage = match.areaPage;
      if (firstAny < 0) firstAny = i;
      if (firstReal < 0 && !match.jump) firstReal = i;
    }
    if (areaPage !== undefined) {
      const idx = pages.findIndex((p) => p.page === areaPage);
      if (idx >= 0) return idx;
    }
    if (firstReal >= 0) return firstReal;
    return firstAny >= 0 ? firstAny : null;
  }

  // Default to the canonical page for the current room; fall back to page 0.
  const initialIdx = (() => {
    if (!pages) return 0;
    return realPageForLocation(currentLocation) ?? 0;
  })();
  const [pageIdx, setPageIdx] = useState(initialIdx);

  // 察知模式 (FLAG:察知模式) overlay selector. Current-map presence is always
  // available; the optional dirt overlay still needs its dedicated talent.
  const [detectMode, setDetectMode] = useState<DetectionMode>(DETECTION_OFF);
  const canSense =
    !!gameState && (canSensePresence(gameState) || canSenseDirt(gameState));

  // When the player navigates (currentLocation changes), follow them to the
  // canonical page for the new location. Does not override manual ◀/▶
  // browsing between moves (the effect only fires on a real location change).
  useEffect(() => {
    const i = realPageForLocation(currentLocation);
    if (i !== null) setPageIdx(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentLocation]);

  // Scale the glyph grid to fit the container width (the player asked for the
  // map to follow the window size). The grid is `cols` full-width cells wide,
  // so a cell of `containerWidth / cols` px makes the map exactly fill the
  // width; we clamp to a sane [6, 22]px range and track resizes.
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [cellPx, setCellPx] = useState(15);
  // The grid's true width in em = the widest row's summed cell advances (NOT
  // the array length — a row of half-width digits is narrower than its cell
  // count). cellPx is px-per-em, so `containerWidth / gridEmWidth` makes the
  // widest row exactly fill the width.
  const gridEmWidth =
    pages && pages.length > 0
      ? Math.max(
          1,
          ...pages[pageIdx % pages.length]!.chars.map((row) =>
            row.reduce((s, g) => s + cellEmWidth(g), 0),
          ),
        )
      : 1;
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const fit = () => {
      const w = el.clientWidth - 8; // minus padding
      if (w > 0) setCellPx(Math.max(6, Math.min(22, Math.floor(w / gridEmWidth))));
    };
    fit();
    // ResizeObserver may be absent (jsdom / very old browsers); the one-shot
    // fit() above still scales to the initial width, so degrade gracefully.
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [gridEmWidth]);

  if (!pages || pages.length === 0) {
    return (
      <div className="colored-map" data-testid="colored-map">
        <div className="colored-map__empty">（此地图暂无彩图数据）</div>
      </div>
    );
  }
  const page = pages[pageIdx % pages.length]!;

  // P1-#4 Slice B — collect the player-zone's member-rooms for the
  // highlight pass. The bundle stamps every cell with a `zone` field
  // (P1-#4 Slice A's per-map *_ZoneOf result, or null). We invert it
  // here so the JSX can do a single Set lookup per cell.
  const playerZone = (() => {
    if (!gameState) return null;
    const here = gameState.master?.location;
    if (!here) return null;
    for (const rm of page.rooms) {
      if (rm.location === here) return rm.zone ?? null;
    }
    return null;
  })();
  const inZoneRoomSet = (() => {
    if (!playerZone) return new Set<string>();
    const out = new Set<string>();
    for (const rm of page.rooms) {
      if (rm.zone === playerZone) out.add(rm.location!);
    }
    return out;
  })();

  // P2-b: resolve the per-cell RGB grid from the raw `colorNames` + the
  // current season. Falls back to the baked spring `colors` when season is
  // unknown or the page has no colorNames (older bundles).
  const resolvedColors =
    season != null && page.colorNames
      ? resolvePageColors(page.colorNames, season)
      : page.colors;

  // Phase C: resolve the 察知 overlay (color + title) for every room on this
  // page once, when a sensing mode is active and the talent gate passes.
  const overlayByLoc = new Map<string, DetectionCell>();
  if (detectMode !== DETECTION_OFF && gameState) {
    for (const rm of page.rooms) {
      if (!rm.location || overlayByLoc.has(rm.location)) continue;
      const ov = detectionOverlay(gameState, rm.location, detectMode);
      if (ov) overlayByLoc.set(rm.location, ov);
    }
  }

  // location → single-hop move commandNo (adjacent scene exits).
  const moveByLoc = new Map(moveCommands.map((m) => [m.toLocation, m.commandNo]));

  // Pathfinding: precompute the full path to each room on THIS page once, so
  // every reachable room is clickable (not just neighbours) — the original
  // "click a spot and walk there". `onMovePath` issues the whole hop sequence.
  // Falls back to the adjacent-only `moveByLoc` when no path handler is wired.
  // Phase D (#9): store the ROOM sequence (toLocations) per reachable room, so
  // the click hands the walk engine the path rooms (not commandNos) — it walks
  // + narrates pass-through encounters. pathLen = hop count = rooms.length.
  const pathByLoc = new Map<string, string[]>();
  if (onMovePath) {
    for (const r of page.rooms) {
      if (!r.location || r.location === currentLocation) continue;
      const path = findPath(currentLocation, r.location);
      if (path && path.length > 0) pathByLoc.set(r.location, path.map((s) => s.toLocation));
    }
  }
  const pathLenByLoc = new Map<string, number>();
  for (const [loc, rooms] of pathByLoc) pathLenByLoc.set(loc, rooms.length);

  /** Resolve the click action for a room: walk the full path if we have one,
   *  else the single adjacent hop, else nothing. For a jump-symbol room (an
   *  arrow-marked cell that points to the same spot on another page), also
   *  switch the view to that destination page — the symbol is a page link,
   *  not a real location on this page, so even when no walk path exists the
   *  click should carry the player to the adjacent area's view. */
  function moveToRoom(room: RoomCell): void {
    const loc = room.location;
    if (!loc) return;
    if (room.jump) {
      const dest = realPageForLocation(loc);
      if (dest !== null) setPageIdx(dest);
    }
    const path = pathByLoc.get(loc);
    if (path && onMovePath) { onMovePath(path); return; }
    const hop = moveByLoc.get(loc);
    if (hop !== undefined) onMove(hop);
  }
  function isClickable(loc: string | null, isCurrent: boolean, jump = false): boolean {
    if (!loc || isCurrent) return false;
    // A jump symbol is always clickable — it at least switches the view to
    // the destination page, even when no walk path is wired.
    if (jump) return true;
    return pathByLoc.has(loc) || moveByLoc.has(loc);
  }

  // Index room cells by "row,col" of BOTH digit cells so the grid renderer
  // can mark them. Maps each digit cell to its room.
  const roomByCell = new Map<string, RoomCell>();
  for (const r of page.rooms) {
    roomByCell.set(`${r.row},${r.col}`, r);
    roomByCell.set(`${r.row},${r.col + 1}`, r);
  }

  return (
    <div className="colored-map" data-testid="colored-map" ref={wrapRef}>
      <div className="colored-map__header">
        {onClose && (
          <button type="button" data-testid="map-close" onClick={onClose}>
            [返回场景]
          </button>
        )}
        <button
          onClick={() => setPageIdx((i) => (i - 1 + pages.length) % pages.length)}
          disabled={pages.length <= 1}
          aria-label="上一页"
        >
          ◀
        </button>
        <h3>
          {MAP_TITLE_BY_KEY.get(mapName ?? "") ?? "地圖"} 地图 {pageIdx + 1}
          {pages.length > 1 ? ` / ${pages.length}页` : ""}
        </h3>
        <button
          onClick={() => setPageIdx((i) => (i + 1) % pages.length)}
          disabled={pages.length <= 1}
          aria-label="下一页"
        >
          ▶
        </button>
        {onOpenWorldMap && (
          <button
            type="button"
            className="colored-map__open-world"
            data-testid="map-open-world-map"
            onClick={onOpenWorldMap}
          >
            [移动到其他地点]
          </button>
        )}
        {onReturnHome && (
          <button
            type="button"
            className="colored-map__open-world"
            data-testid="map-return-home"
            disabled={!canReturnHome}
            title={canReturnHome ? "回到自宅（自室）" : "已在自宅"}
            onClick={onReturnHome}
          >
            [返回自宅]
          </button>
        )}
        {gameState && (
          <button
            type="button"
            className="colored-map__detect"
            data-testid="map-detect-toggle"
            data-mode={detectMode}
            disabled={!canSense}
            title={
              canSense
                ? "切换察知模式（关→气配→污秽）"
                : "需要 居場所察知 / 汚部屋察知 素质（由好感度奖励解锁）"
            }
            onClick={() => setDetectMode((m) => nextDetectionMode(m))}
          >
            [{DETECTION_LABEL[detectMode]}]
          </button>
        )}
      </div>

      <div
        className="colored-map__grid"
        data-testid="colored-map-grid"
        style={{ fontSize: `${cellPx}px` }}
      >
        {page.chars.map((rowChars, r) => (
          <div className="colored-map__row" key={r}>
            {rowChars.map((glyph, c) => {
              const room = roomByCell.get(`${r},${c}`);
              const isCurrent = room?.location === currentLocation;
              const loc = room?.location ?? null;
              const clickable = isClickable(loc, isCurrent, room?.jump);
              const hops = loc ? pathLenByLoc.get(loc) : undefined;
              // Parity QA P-19 — room-number cells ship `#000000` in the
              // bundle (pure black on a black map = invisible, the "编号还是黑的"
              // bug). Force a readable color for room cells: gold=current,
              // green=clickable, white=other. Non-room terrain keeps its
              // bundle color.
              // Phase C: an active 察知 overlay recolors the room cell
              // (presence/dirt) ahead of the current/clickable scheme.
              const ov = loc ? overlayByLoc.get(loc) : undefined;
              const color = room
                ? ov && ov.color
                  ? ov.color
                  : isCurrent
                    ? "#ffe680"
                    : clickable
                      ? "#9be8a8"
                      : "#e6edf3"
                : isPlaceLabelGlyph(glyph)
                  ? // Place-name label text drawn into the art (小兔姬/警察署…):
                    // force readable, ignoring the art's dark palette color, so
                    // location names are never invisible. Terrain keeps its color.
                    LABEL_TEXT_COLOR
                  : (resolvedColors[r]?.[c] ?? "#888");
              // Render full-width space as a non-breaking full-width blank.
              const ch = glyph === "" || glyph === " " ? "　" : glyph;
              // Enforce the upstream grid width per cell (see cellEmWidth):
              // the box, not the font advance, decides the column — immune to
              // font-fallback for glyphs the map-gothic subset lacks.
              const emW = cellEmWidth(glyph);
              return (
                <span
                  key={c}
                  className={
                    "colored-map__cell" +
                    (room ? " colored-map__cell--room" : "") +
                    (isCurrent ? " colored-map__cell--current" : "") +
                    (clickable ? " colored-map__cell--clickable" : "") +
                    // P1-#4 Slice B — highlight every member room of the
                    // player's current zone. The bundle's `zone` field
                    // carries the per-cell zone hint; we collect
                    // master.location's zone member-rooms here so the
                    // outer map can dim non-zone cells visually. The
                    // current cell is upgraded to --in-zone-current for
                    // a brighter ring.
                    (inZoneRoomSet.has(loc ?? "")
                      ? isCurrent
                        ? " colored-map__cell--in-zone-current"
                        : " colored-map__cell--in-zone"
                      : "")
                  }
                  data-room={room?.location ?? undefined}
                  data-testid={room ? "colored-map-room" : undefined}
                  style={{
                    color,
                    width: `${emW}em`,
                    cursor: clickable ? "pointer" : undefined,
                  }}
                  title={
                    loc
                      ? loc +
                        (room?.jump
                          ? "（跳转至该地点详图）"
                          : isCurrent
                            ? "（当前）"
                            : clickable
                              ? hops && hops > 1
                                ? `（点击前往·${hops}步）`
                                : "（点击前往）"
                              : "") +
                        (ov ? "\n" + ov.title : "")
                      : undefined
                  }
                  onClick={clickable && loc && room ? () => moveToRoom(room) : undefined}
                >
                  {ch}
                </span>
              );
            })}
          </div>
        ))}
      </div>
      {/* P-12: readable room-name overlay. The PUA terrain font isn't bundled
          (cells show as boxes), so list every numbered room on this page by its
          Chinese name. Current room is highlighted; reachable rooms are
          clickable (same walk/pathfind logic as the grid cells). */}
      <div className="colored-map__rooms" data-testid="colored-map-roomlist">
        {page.rooms
          .filter((r) => r.location)
          .map((r) => {
            const loc = r.location!;
            const isCurrent = loc === currentLocation;
            const clickable = isClickable(loc, isCurrent, r.jump);
            const hops = pathLenByLoc.get(loc);
            const ov2 = overlayByLoc.get(loc);
            return (
              <button
                key={`${r.row},${r.col}`}
                type="button"
                className={
                  "colored-map__roombtn" +
                  (isCurrent ? " colored-map__roombtn--current" : "") +
                  (clickable ? " colored-map__roombtn--clickable" : "") +
                  (r.jump ? " colored-map__roombtn--jump" : "")
                }
                data-room={loc}
                data-testid="colored-map-roomlabel"
                disabled={!clickable}
                style={ov2?.color ? { color: ov2.color } : undefined}
                title={
                  (r.jump
                    ? `跳转至「${shortRoomName(loc)}」详图`
                    : isCurrent
                      ? "当前所在"
                      : clickable
                        ? hops && hops > 1
                          ? `点击前往（${hops}步）`
                          : "点击前往"
                        : "当前无法直接前往") + (ov2 ? "\n" + ov2.title : "")
                }
                onClick={clickable ? () => moveToRoom(r) : undefined}
              >
                {r.jump ? "↦ " : ""}
                {shortRoomName(loc)}
                {isCurrent ? "（当前）" : ""}
              </button>
            );
          })}
      </div>

      <div className="colored-map__legend">
        {detectMode === DETECTION_PRESENCE
          ? "察知·气配：橙=工作　蓝=睡眠　粉=在场　绿=自己　（悬停看谁在）"
          : detectMode === DETECTION_DIRT
            ? "察知·污秽：绿=干净 → 黄 → 品红 → 红=最脏　（悬停看清洁度）"
            : "绿=树林/草　棕=建筑　白=房间号　点击下方房间名即可自动寻路前往"}
      </div>
    </div>
  );
};

export default ColoredMapView;
