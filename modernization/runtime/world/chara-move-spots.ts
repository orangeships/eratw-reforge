/**
 * `CHARAMOVE_DATA_NN(7, P_ID)` 出現場所 whitelist — the modern equivalent of
 * upstream's per-chara encode of "what ODEKAKE spots can this chara spawn at".
 *
 * Upstream `@遭遇フラグ決定` (`ERB/イベント関連/遭遇判定.ERB:73`) calls
 *   `CALLFORM CHARAMOVE_DATA_{NO:CHARA}(7, P_ID)`
 * inside its slot-filter loop, and `RESULT == 1` means "this chara can spawn
 * here". Without that gate every chara sees every spot — the bug that lets
 * 心 land in 竹林 4% of mornings despite upstream's data forbidding it.
 *
 * The whitelist table is parsed at build time from `ERB/キャラデータ/Chara_data_NN.ERB`
 * (`modernization/scripts/build-chara-move-spots.ts`) → `web/app/game/chara-move-spots.bundle.json`.
 * Runtime injection seam mirrors `liveCatalog` etc.
 *
 * Lookup semantics (faithful to upstream):
 *   - Chara without an entry (CASE 7 not declared) → `null` (no whitelist, the
 *     global ODEKAKE spot table decides — matches upstream's pre-existing
 *     behavior for chara without CHARAMOVE_DATA_7 override).
 *   - Chara with explicit P_ID list and no CASEELSE → `false` for spots NOT in
 *     the list, `true` for spots in the list.
 *   - Chara with CASEELSE (= wildcard) → `true` for every spot (the upstream
 *     "let me spawn anywhere" override).
 *
 * The seam stays module-local; the bundle is fetched lazily on first
 * `canAppearAtSpot` call to keep tests cheap.
 */
import type { EncounterSpotId } from "./encounter.js";

interface CharaMoveSpotsBundle {
  generatedAt: string;
  spotNames: { name: string; pId: number }[];
  byChara: Record<
    string,
    { pIds: number[]; wildcard: boolean } | { wildcard: true } | undefined
  >;
  blockedRoomsByChara?: Record<string, { roomIds: number[]; all: boolean }>;
  qolAreaDestinations?: Record<
    string,
    { roomId: number; weight: number | "cleanliness" }[]
  >;
}

export interface QolVisitorRoomCandidate {
  roomId: number;
  weight: number | "cleanliness";
}

let table: CharaMoveSpotsBundle | null = null;

/** Inject the bundle at app init (App.tsx) or in tests. */
export function setCharaMoveSpotTable(bundle: CharaMoveSpotsBundle | null): void {
  table = bundle;
}

export function getCharaMoveSpotTable(): CharaMoveSpotsBundle | null {
  return table;
}

/**
 * Upstream-faithful clone of `CHARAMOVE_DATA_<charaNum>(7, P_ID)`:
 *   - returns `null` when the chara has no CASE 7 entry (= no whitelist —
 *     caller falls back to "let the global table decide")
 *   - returns `boolean` when the chara does declare CASE 7 (true = can spawn,
 *     false = cannot)
 */
export function canAppearAtSpot(
  charaNum: number,
  spotId: EncounterSpotId | number,
): boolean | null {
  if (table === null) return null;
  const entry = table.byChara[String(charaNum)];
  if (!entry) return null;
  if ("wildcard" in entry && entry.wildcard === true) return true;
  if ("pIds" in entry) {
    return entry.pIds.includes(Number(spotId));
  }
  return null;
}

/** QOL `QOL_VISITOR_ADD_LOCATION`'s `CHARAMOVE_DATA_NN(4, room) < 0` gate. */
export function canMoveToQolRoom(
  charaNum: number,
  roomId: number,
): boolean | null {
  if (table === null) return null;
  const entry = table.blockedRoomsByChara?.[String(charaNum)];
  if (!entry) return true;
  return !entry.all && !entry.roomIds.includes(roomId);
}

/** Exact room weights extracted from upstream QOL_VISITOR_CHECK_AREA. */
export function qolVisitorRoomsForArea(
  areaId: number,
): readonly QolVisitorRoomCandidate[] {
  return table?.qolAreaDestinations?.[String(areaId)] ?? [];
}
