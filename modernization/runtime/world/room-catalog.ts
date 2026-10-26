/**
 * Canonical identity registry for every numbered room in the currently built
 * Web/Tauri world.
 *
 * The data is generated from the upstream colored-map room numbers plus the
 * existing map-specific location sources.  This module owns the runtime
 * lookup contract; consumers must not reconstruct `mapId * 100 + roomNo`,
 * scan map bundles, or maintain another location-to-id table.
 *
 * Scope deliberately excludes:
 * - FIELD's 00-11 region cells (they are map regions, not rooms);
 * - mapId 11 魔界, which is not built;
 * - special activity/home strings without an upstream P-number, such as
 *   `神社:自室` and `神社:大别墅`.
 *
 * Numbering details and the generated per-room index are recorded in
 * `modernization/docs/ROOM-CATALOG.md`.
 */

import { ROOM_CATALOG_ENTRIES } from "./room-catalog.generated.js";

export type RoomMapKey =
  | "HAKUREI"
  | "TEMPLE"
  | "SATO"
  | "KOUMAKAN"
  | "TIKURIN"
  | "FOREST"
  | "MEIKAI"
  | "SANROKU"
  | "SUMMIT"
  | "CHIREIDEN"
  | "TUKI";

export interface RoomMapPlacement {
  /** Upstream colored-map page number, not a zero-based array index. */
  page: number;
  row: number;
  col: number;
  /** True when this is an upstream jump marker, not the canonical room cell. */
  jump: boolean;
  /** Zone label emitted by the map's current zone resolver, when available. */
  zone: string | null;
}

export interface RoomCatalogEntry {
  /** Global upstream room id: the numeric suffix of `P<n>`. */
  roomId: number;
  /** Map-local room number, e.g. 1 for P1 or 1 for P101. */
  localNumber: number;
  /** Two-digit map-local spelling used by colored-map cells, e.g. "01". */
  localNumberText: string;
  /** Canonical upstream-style room token, e.g. "P1" or "P101". */
  pId: string;
  /** `roomId = mapId * 100 + localNumber`; retained explicitly for audits. */
  mapId: number;
  mapKey: RoomMapKey;
  /** Canonical full location string used by GameState and runtime rules. */
  location: string;
  /** Location suffix, or the root location for a root room. */
  displayName: string;
  /** The page selected by upstream MAP_AREASELECT for this room. */
  primaryPage: number | null;
  /** Distinct zone labels observed across all map placements. */
  zones: readonly string[];
  /** All drawn placements, including duplicate jump markers. */
  placements: readonly RoomMapPlacement[];
  /** This catalog contains only rooms emitted by a built map source. */
  status: "built";
}

export const ROOM_CATALOG: readonly RoomCatalogEntry[] = ROOM_CATALOG_ENTRIES;

function indexBy(
  entries: readonly RoomCatalogEntry[],
  keyOf: (entry: RoomCatalogEntry) => string,
): Readonly<Record<string, RoomCatalogEntry>> {
  return Object.freeze(
    entries.reduce<Record<string, RoomCatalogEntry>>((out, entry) => {
      out[keyOf(entry)] = entry;
      return out;
    }, {}),
  );
}

const ROOM_BY_ID = indexBy(ROOM_CATALOG, (entry) => String(entry.roomId));
const ROOM_BY_LOCATION = indexBy(ROOM_CATALOG, (entry) => entry.location);

/** Canonical room-id lookup. Unknown/special locations return null. */
export function roomCatalogEntryForId(roomId: number): RoomCatalogEntry | null {
  return ROOM_BY_ID[String(roomId)] ?? null;
}

/** Canonical location lookup. Unknown/special locations return null. */
export function roomCatalogEntryForLocation(location: string): RoomCatalogEntry | null {
  return ROOM_BY_LOCATION[location] ?? null;
}

export function roomCatalogLocationForId(roomId: number): string | null {
  return roomCatalogEntryForId(roomId)?.location ?? null;
}

export function roomCatalogIdForLocation(location: string): number | null {
  return roomCatalogEntryForLocation(location)?.roomId ?? null;
}

/** Read-only indexed views used by bridges and audits. */
export const ROOM_CATALOG_BY_ID: Readonly<Record<number, RoomCatalogEntry>> = ROOM_BY_ID as Readonly<
  Record<number, RoomCatalogEntry>
>;
export const ROOM_CATALOG_BY_LOCATION: Readonly<Record<string, RoomCatalogEntry>> = ROOM_BY_LOCATION;

export const ROOM_CATALOG_COUNT = ROOM_CATALOG.length;
