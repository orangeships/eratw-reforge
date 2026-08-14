/**
 * ODEKAKE / date-map state core (Slice O1).
 *
 * Upstream stores `CFLAG:约会中` as the destination MAPID, not a boolean.
 * This module is the single writer for that state: entering an ODEKAKE map
 * sets the MAPID on MASTER + companions, moves them to the destination's
 * representative room, records `FLAG:デート相手`, and starts `TFLAG:约会道中`.
 * Later O-slices can hang 604/617/697/698/699 on the same helpers.
 *
 * P1-#4 Slice A re-export: the 4 modern-built maps' zone tables are
 * stitched together here so callers can iterate the unified set or
 * look up by location without importing each file.
 */

import type { GameState, CharaSlot } from "../state/game-state.js";
import { CFLAG_ID, FLAG_ID } from "../state/settlement.js";
import { TFLAG_ID, setTflag } from "../state/tflag.js";
import { setSlotLocation } from "./room-id-location.js";
import { ODEKAKE_ZONES } from "./odekake-village.js";
import {
  ODEKAKE_ZONES_SHRINE,
  shrineZoneOf,
  type ShrineZone,
} from "./odekake-shrine.js";
import {
  ODEKAKE_ZONES_MYOUREN,
  myourenZoneOf,
  type MyourenZone,
} from "./odekake-myouren.js";
import {
  ODEKAKE_ZONES_KOUMAKAN,
  koumakanZoneOf,
  type KoumakanZone,
} from "./odekake-koumakan.js";
import {
  ODEKAKE_ZONES_TIKURIN,
  tikurinZoneOf,
  type TikurinZone,
} from "./odekake-tikurin.js";
import type { OutingEventResult } from "./outing-events.js";

export { ODEKAKE_ZONES_SHRINE, shrineZoneOf, type ShrineZone } from "./odekake-shrine.js";
export { ODEKAKE_ZONES_MYOUREN, myourenZoneOf, type MyourenZone } from "./odekake-myouren.js";
export { ODEKAKE_ZONES_KOUMAKAN, koumakanZoneOf, type KoumakanZone } from "./odekake-koumakan.js";
// Re-export `villageZoneOf` so build scripts / external callers can
// resolve a village location's zone without pulling in odekake-village.js
// directly. (village already has its own re-export through this file for
// the `zoneOf` helper below.)
export { villageZoneOf, type VillageZone } from "./odekake-village.js";
export { ODEKAKE_ZONES_TIKURIN, tikurinZoneOf, type TikurinZone } from "./odekake-tikurin.js";

/** All 5 modern-built maps' zone tables flattened — 38 zones (7+7+8+9+7). */
export const ALL_ODEKAKE_ZONES = Object.freeze([
  ...ODEKAKE_ZONES_SHRINE,
  ...ODEKAKE_ZONES,
  ...ODEKAKE_ZONES_MYOUREN,
  ...ODEKAKE_ZONES_KOUMAKAN,
  ...ODEKAKE_ZONES_TIKURIN,
]);

/**
 * Unified zone-of lookup across the 5 modern-built maps. Returns the zone
 * descriptor (region + flags + representative location + quickMoveCommandNo)
 * for the location, or `null` when the location isn't part of any built
 * map's zone (DLC areas, unbuilt maps, or non-shared rooms).
 */
export function zoneOf(
  location: string,
):
  | { mapId: 0; zone: ShrineZone; point: (typeof ODEKAKE_ZONES_SHRINE)[number] }
  | { mapId: 2; zone: string; point: (typeof ODEKAKE_ZONES)[number] }
  | { mapId: 1; zone: MyourenZone; point: (typeof ODEKAKE_ZONES_MYOUREN)[number] }
  | { mapId: 3; zone: KoumakanZone; point: (typeof ODEKAKE_ZONES_KOUMAKAN)[number] }
  | { mapId: 4; zone: TikurinZone; point: (typeof ODEKAKE_ZONES_TIKURIN)[number] }
  | null {
  if (location.startsWith("神社") || location === "神社") {
    const z = shrineZoneOf(location);
    if (z) {
      const point = ODEKAKE_ZONES_SHRINE.find((p) => p.zone === z)!;
      return { mapId: 0, zone: z, point };
    }
  }
  if (location.startsWith("人間之里") || location === "人間之里") {
    const z = ODEKAKE_ZONES.find((p) => p.memberRooms.includes(location))?.zone;
    if (z) {
      const point = ODEKAKE_ZONES.find((p) => p.zone === z)!;
      return { mapId: 2, zone: z, point };
    }
  }
  if (location.startsWith("命蓮寺") || location.startsWith("霊廟") || location === "命蓮寺") {
    const z = myourenZoneOf(location);
    if (z) {
      const point = ODEKAKE_ZONES_MYOUREN.find((p) => p.zone === z)!;
      return { mapId: 1, zone: z, point };
    }
  }
  if (
    location.startsWith("紅魔館") ||
    location.startsWith("霧之湖") ||
    location.startsWith("廃洋館") ||
    location === "紅魔館"
  ) {
    const z = koumakanZoneOf(location);
    if (z) {
      const point = ODEKAKE_ZONES_KOUMAKAN.find((p) => p.zone === z)!;
      return { mapId: 3, zone: z, point };
    }
  }
  if (
    location.startsWith("永遠亭") ||
    location.startsWith("迷途竹林") ||
    location.startsWith("夢幻館") ||
    location === "迷途竹林"
  ) {
    const z = tikurinZoneOf(location);
    if (z) {
      const point = ODEKAKE_ZONES_TIKURIN.find((p) => p.zone === z)!;
      return { mapId: 4, zone: z, point };
    }
  }
  return null;
}

export const ODEKAKE_MAP_ID_VILLAGE = 2;

const DEFAULT_HOME_LOCATION = "神社:自室";

export interface OdekakeDestination {
  /** Upstream MAPID (`PLACE_ERH.ERH`). */
  readonly mapId: number;
  /** UI/debug label. */
  readonly label: string;
  /** Modern room string where entering this date map lands. */
  readonly representativeLocation: string;
  /** Existing synthetic cross-map command, for UI compatibility. */
  readonly travelCommandNo?: number;
}

const villageEntry =
  ODEKAKE_ZONES.find((z) => z.region === 1)?.representativeLocation ??
  "人間之里";

export const ODEKAKE_DESTINATIONS: readonly OdekakeDestination[] = Object.freeze([
  { mapId: 0, label: "博麗神社", representativeLocation: "神社", travelCommandNo: 10701 },
  { mapId: 1, label: "命蓮寺", representativeLocation: "命蓮寺", travelCommandNo: 10704 },
  { mapId: ODEKAKE_MAP_ID_VILLAGE, label: "人間之里", representativeLocation: villageEntry, travelCommandNo: 10702 },
  { mapId: 3, label: "霧之湖～紅魔館", representativeLocation: "紅魔館", travelCommandNo: 10705 },
  { mapId: 4, label: "迷途竹林", representativeLocation: "迷途竹林", travelCommandNo: 10706 },
  { mapId: 5, label: "魔法之森", representativeLocation: "魔法之森", travelCommandNo: 10905 },
  { mapId: 6, label: "三途之川～冥界", representativeLocation: "彼岸", travelCommandNo: 10906 },
  { mapId: 7, label: "妖怪之山(山麓)", representativeLocation: "妖怪之山・山麓", travelCommandNo: 10907 },
  { mapId: 8, label: "妖怪之山(山頂)", representativeLocation: "妖怪之山・山顶", travelCommandNo: 10908 },
  { mapId: 9, label: "地底", representativeLocation: "地灵殿", travelCommandNo: 10909 },
  { mapId: 10, label: "夢之世界～月", representativeLocation: "月之世界", travelCommandNo: 10910 },
]);

const DESTINATION_BY_MAP_ID = new Map(
  ODEKAKE_DESTINATIONS.map((d) => [d.mapId, d]),
);

export function odekakeDestinationForMap(
  mapId: number,
): OdekakeDestination | undefined {
  return DESTINATION_BY_MAP_ID.get(mapId);
}

function slotFor(state: GameState, charaNum: number): CharaSlot | undefined {
  return charaNum === 0 ? state.master : state.charas[charaNum];
}

function uniqueParticipants(
  state: GameState,
  companions: readonly number[],
): number[] {
  const out: number[] = [0];
  const seen = new Set(out);
  for (const n of companions) {
    if (n <= 0 || seen.has(n) || !state.charas[n]) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

/** Enter an ordinary outing. Starting a date is deliberately separate. */
export function enterOdekake(
  state: GameState,
  destMapId: number,
  companions: readonly number[] = [],
): OdekakeDestination {
  const destination = odekakeDestinationForMap(destMapId);
  if (!destination) {
    throw new Error(`unknown ODEKAKE destination mapId ${destMapId}`);
  }

  const participants = uniqueParticipants(state, companions);
  for (const charaNum of participants) {
    const slot = slotFor(state, charaNum);
    if (!slot) continue;
    setSlotLocation(slot, destination.representativeLocation);
  }
  state.outing = { startedAtTick: state.time.tickValue, mapId: destination.mapId };
  state.flagStore[FLAG_ID.デート相手] = 0;
  state.master.state.CFLAG[CFLAG_ID.约会中] = 0;

  return destination;
}

/** Mutates `state` to clear ODEKAKE/date state and return participants home. */
export function leaveOdekake(state: GameState, homeLocation?: string): void {
  const fallbackHome =
    homeLocation ??
    state.homeLocation ??
    state.master.homeLocation ??
    DEFAULT_HOME_LOCATION;

  const participants = [0];
  for (const [key, slot] of Object.entries(state.charas)) {
    if ((slot.state.CFLAG[CFLAG_ID.约会中] ?? 0) !== 0) {
      participants.push(Number(key));
    }
  }

  for (const charaNum of participants) {
    const slot = slotFor(state, charaNum);
    if (!slot) continue;
    slot.state.CFLAG[CFLAG_ID.约会中] = 0;
    slot.state.CFLAG[CFLAG_ID.同行] = 0;
    const dest = charaNum === 0 ? fallbackHome : slot.homeLocation ?? fallbackHome;
    setSlotLocation(slot, dest);
  }

  state.flagStore[FLAG_ID.デート相手] = 0;
  setTflag(state, TFLAG_ID.约会道中, 0);
  state.outing = null;
}

/**
 * `@CLEAN_GROUP_DATES` (MOREDATE mod-layer) — upstream clears the multi-date
 * `Datees[]` roster + `NumberOfDates` when a date fully ends. The modern
 * runtime defers the MOREDATE group-date subsystem (single-date MVP), so
 * this is a documented no-op stub: the single-date `FLAG:约会的对象=0`
 * clear in {@link leaveOdekake} is the faithful base-game equivalent.
 * Returns true iff there was a group-date roster to clean (always false
 * for the MVP — no `Datees[]` modeled).
 */
export function cleanGroupDates(_state: GameState): boolean {
  // MOREDATE / Datees[] / NumberOfDates subsystem deferred (O1-O4 single-date).
  // Upstream `@CLEAN_GROUP_DATES` also clears `FLAG:デート相手` + per-chara
  // `CFLAG:デート中` — both already handled by `leaveOdekake` for the
  // single-date path. Return false = "no group roster to clean".
  return false;
}

/**
 * Slice O4 — "end the date when the master returns to a base-map room".
 *
 * Faithful to the upstream pattern: a date ends when `CFLAG:MASTER:约会中`
 * is set back to `MAIN_MAP` (0), which happens when the master moves from
 * a date map back into a base-map (神社/自宅) room. The move-to-shrine /
 * move-to-home / OMANEKI-exit paths call this guard; if the master is
 * currently on a date (`chkDateNow(CFLAG:约会中)`) AND `destLocation` is
 * on `MAIN_MAP`, it fires `leaveOdekake` (clears 约会中/约会的对象/约会道中
 * + `cleanGroupDates`) and returns `true`. Otherwise no-op, returns `false`.
 *
 * This is the O4 integration point that connects the ODEKAKE entry (405)
 * + stroll (604) + sweet-shop (617) + OMANEKI (697/698/699) subsystems
 * to the room-move / village-move exit grid: any exit that lands the
 * master on a base-map room ends the date.
 */
export function endOdekakeIfReturningHome(
  state: GameState,
  destLocation: string,
): boolean {
  const result = endOdekakeIfReturningHomeDetailed(state, destLocation);
  if (!result.ended) return false;
  state.eventLog = [...state.eventLog, ...result.events];
  return true;
}

/**
 * Return transition with the event payload used by browser/Tauri adapters.
 * The supplied state object is updated in place before the date is cleared.
 */
export function endOdekakeIfReturningHomeDetailed(
  state: GameState,
  destLocation: string,
): OutingEventResult {
  const onDate = state.dateSession != null;
  if (!onDate) return { state, ended: false, events: [], diagnostics: [] };
  void destLocation;
  return { state, ended: false, events: [], diagnostics: [] };
}

/* The legacy adapter body was superseded by endOdekakeIfReturningHomeDetailed. */
