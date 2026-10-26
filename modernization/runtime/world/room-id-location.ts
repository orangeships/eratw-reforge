/**
 * Single source of truth for the room-id ↔ location-string bridge.
 *
 * THE BUG THIS FIXES (2026-06-23, "角色行为/地图/UI 对不上号"): the modern
 * runtime carried TWO disconnected representations of where a character is:
 *   - `slot.location` — a string ("神社:境内") the scheduler, the UI, and most
 *     location-gated commands read/write.
 *   - `CFLAG[300]現在位置` — the numeric room id eraTW treats as authoritative
 *     (and the only position the oracle dump records).
 * Every real move/scheduler writer (room-move / move-to-shrine / scheduler /
 * companion-follow) only ever wrote the STRING, leaving `CFLAG[300]` stale.
 * So the UI (reads string) and the gates/oracle (read CFLAG[300]) disagreed,
 * and the oracle's CFLAG[300] divergence was written off as a "known mock".
 *
 * The fix: one bridge here, and `setSlotLocation` as the ONLY way to move a
 * character — it writes the string AND keeps `CFLAG[300]` in sync.
 *
 * SOURCE OF TRUTH for built numbered rooms is the generated `ROOM_CATALOG`
 * (`modernization/runtime/world/room-catalog.generated.ts`), which is derived
 * from the upstream colored-map cells and the map-specific room sources. Its
 * identity is the full location plus the global P number; consumers must not
 * reconstruct another room table. The upstream numeric source remains
 * eraTW's `CSV/Str.csv` id segment (1=鳥居, 2=境内, 13=風呂, 22=参道, …).
 * The runtime keeps the following older tables only as compatibility fallbacks:
 *   - `SHRINE_ROOM_PROPS` (shrine-rooms.ts): pNum "P13" → "神社:風呂" — the
 *     public shrine rooms our handlers gate on. The pNum number IS the Str.csv id.
 *   - `CONFIGURED_ROOM_LOCATIONS` (configured-room-locations.ts): id → location
 *     for character home rooms (私室) across shrine / 人間之里.
 * The catalog is queried first in BOTH directions. A canonical catalog entry
 * therefore wins over a stale or differently-spelled legacy mapping.
 *
 * COVERAGE: all 547 built numbered rooms in maps 0-10. Special activity/home
 * strings without a P number, FIELD region cells, and unbuilt map 11 resolve
 * to null; callers leave the other side untouched rather than inventing ids.
 */

import { SHRINE_ROOM_PROPS } from "../command/comable/shrine-rooms.js";
import {
  resolveConfiguredRoomLocation,
  CONFIGURED_ROOM_LOCATIONS_REVERSE,
} from "./configured-room-locations.js";
import { ROOM_CATALOG_BY_ID, ROOM_CATALOG_BY_LOCATION } from "./room-catalog.js";
import { CFLAG_ID } from "../state/settlement.js";
import type { CharaSlot } from "../state/game-state.js";

/** pNum-number → location, built once from SHRINE_ROOM_PROPS (P13 → 神社:風呂). */
const SHRINE_ID_TO_LOCATION: Readonly<Record<number, string>> = Object.freeze(
  Object.values(SHRINE_ROOM_PROPS).reduce<Record<number, string>>((acc, room) => {
    const n = Number(room.pNum.replace(/^P/, ""));
    if (Number.isInteger(n)) acc[n] = room.location;
    return acc;
  }, {}),
);

/** location → pNum-number, the inverse of SHRINE_ID_TO_LOCATION. */
const SHRINE_LOCATION_TO_ID: Readonly<Record<string, number>> = Object.freeze(
  Object.values(SHRINE_ROOM_PROPS).reduce<Record<string, number>>((acc, room) => {
    const n = Number(room.pNum.replace(/^P/, ""));
    if (Number.isInteger(n)) acc[room.location] = n;
    return acc;
  }, {}),
);

/**
 * Legacy aliases outside the canonical catalog. These remain only so older
 * callers using a historical spelling can still resolve; new code must use
 * the catalog's canonical location strings.
 */
const PUBLIC_WORK_ROOM_ID_TO_LOCATION: Readonly<Record<number, string>> = Object.freeze({
  218: "人間の里:小料理屋",
  // 命蓮寺 / 霊廟
  102: "命蓮寺:境内",
  103: "命蓮寺:本堂",
  104: "命蓮寺:講堂",
  121: "命蓮寺:墓地",
  126: "霊廟:道場",
  140: "命蓮寺:地蔵小路",

  // 人間之里
  202: "人間之里:中央広場",
  211: "人間之里:酒屋",
  212: "人間之里:咖啡館",
  213: "人間之里:鈴奈庵",
  216: "人間之里:食料品店",
  217: "人間之里:甜品店",
  221: "人間之里:稗田邸",
  222: "人間之里:寺子屋",
  238: "人間之里:鯢呑亭",

  // 紅魔館 / 霧之湖
  301: "紅魔館",
  309: "紅魔館:大廳",
  310: "紅魔館:図書館",
  313: "紅魔館:厨房",
  327: "紅魔館:小露台",
  329: "紅魔館:倉庫",
  343: "霧之湖:湖畔",

  // 永遠亭 / 迷途竹林
  401: "永遠亭:永遠亭入口",
  404: "永遠亭:診察室",
  405: "永遠亭:配药室",
  421: "永遠亭:庭",
  436: "迷途竹林:無名之丘",
  438: "迷途竹林:太陽花田",
  444: "迷途竹林:夜雀的小攤",
});

const PUBLIC_WORK_LOCATION_TO_ID: Readonly<Record<string, number>> = Object.freeze(
  Object.entries(PUBLIC_WORK_ROOM_ID_TO_LOCATION).reduce<Record<string, number>>(
    (acc, [id, location]) => {
      acc[location] = Number(id);
      return acc;
    },
    {},
  ),
);

/**
 * Resolve a `CFLAG:現在位置` numeric id to a modern location string, or null
 * when no modern room exists for it. The canonical catalog is queried first;
 * shrine/work/generated/configured tables are legacy compatibility fallbacks.
 */
export function roomIdToLocation(roomId: number): string | null {
  if (roomId <= 0) return null;
  return (
    ROOM_CATALOG_BY_ID[roomId]?.location ??
    SHRINE_ID_TO_LOCATION[roomId] ??
    PUBLIC_WORK_ROOM_ID_TO_LOCATION[roomId] ??
    resolveConfiguredRoomLocation(roomId) ??
    null
  );
}

/**
 * Resolve a modern location string back to its `CFLAG:現在位置` numeric id, or
 * null when the location has no eraTW room id (scheduler activity rooms,
 * special rooms, or unbuilt maps). The fallback order mirrors
 * `roomIdToLocation` after the canonical catalog lookup.
 */
export function locationToRoomId(location: string): number | null {
  if (!location) return null;
  return (
    ROOM_CATALOG_BY_LOCATION[location]?.roomId ??
    SHRINE_LOCATION_TO_ID[location] ??
    PUBLIC_WORK_LOCATION_TO_ID[location] ??
    CONFIGURED_ROOM_LOCATIONS_REVERSE[location] ??
    null
  );
}

/**
 * Move a character: set `slot.location` AND keep `CFLAG[300]現在位置` in sync.
 * This is the ONLY sanctioned way to relocate a slot — it prevents the two-
 * track drift that made UI/gates/oracle disagree.
 *
 * When the location has no numeric id (`locationToRoomId` → null), the string
 * is still set but `CFLAG[300]` is left UNCHANGED (we never invent an id). That
 * matches the pre-bridge behavior for unmapped rooms — no regression — and is
 * honest: we genuinely don't know eraTW's id for that room yet.
 */
export function setSlotLocation(slot: CharaSlot, location: string): void {
  slot.location = location;
  const id = locationToRoomId(location);
  if (id !== null) slot.state.CFLAG[CFLAG_ID.現在位置] = id;
}
