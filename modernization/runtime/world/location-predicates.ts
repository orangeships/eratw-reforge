/**
 * Phase 7.1a — place predicates, faithful ports of eraTW's
 * `PLACE_拠点共通.ERB` location-property functions (`BATHCHECK`, `OPENPLACE`,
 * `OUTROOF`, `INROOM`, `IN_HOME`, `AT_HOME`) + `PLACE_SENTO` (`COMF432`).
 *
 * The modern runtime uses string locations (`"神社:風呂"`) instead of
 * numeric room ids; these predicates bridge that by reading the
 * per-location `ROOMDATA` bitset (`place-flags-data.ts`) + a small
 * base-map membership test. Generated ROOMSETTING data for maps 5-10 is
 * authoritative for room properties even though the older `IN_HOME` helper
 * still models the original base-map slice.
 *
 * **Narrowed-scope deferrals** (documented, NOT silent stubs):
 *   - `IS_GAP_GUEST` (紫の隙間 guest state) — CFLAG not modeled → `false`.
 *   - お招き部屋 (`OMANEKIBEYA`) + 泡風呂 `TFLAG` arms of `BATHCHECK` →
 *     skipped (お招き system not modeled).
 *   - `ODEKAKEMAP_SETTING` (odekake/field map property table) → field
 *     maps (迷いの竹林 / 霧の湖) treated as raw-0 (roofless, no bath, not
 *     spacious) unless a base-map entry covers them.
 *   - `INT_NOUMIN` (farm location from `FLAG:地主`) → `null` (地主 CFLAG
 *     not modeled; COMF470 畑仕事 deferred to 7.1b weather + this).
 *   - `ROAD_TO` (inter-map road segments) → not modeled; OPENPLACE/OUTROOF
 *     return their non-road odekake value.
 *   - 旧地獄温泉 (地底 room 934) `PLACE_SENTO` arm → `0` (地底 map out of
 *     narrowed scope).
 *
 * These are the same deferral lines the upstream functions themselves gate
 * on; commands that need a deferred arm block faithfully rather than pass.
 *
 * No upstream file mutation. No LLM. See `CLAUDE.md`.
 */

import type { GameState } from "../state/index.js";
import { LOCATION_PLACE_FLAGS } from "./place-flags-data.js";
import { GENERATED_MAP_ID_BY_PREFIX } from "./generated-map-prefixes.js";
import {
  expandPlaceFlags,
  hasPlace,
  PLACE_BATH,
  PLACE_INDOOR,
  PLACE_ROOF,
  PLACE_TOILET,
  PLACE_WESTERN,
  PLACE_WIDE,
  PLACE_SENTO_NONE,
  PLACE_SENTO_VILLAGE,
} from "./place-flags.js";

/**
 * Base (拠点) map ids — the residence maps the master navigates between via the
 * 10701-1070x move series (神社 0 / 命蓮寺 1 / 人間之里 2 / 紅魔館 3). Faithful to
 * upstream `IN_HOME(ARG) = INRANGE(ARG, MINROOM(), MAXROOM)`: a location is
 * "at home" iff it belongs to one of these base maps. This is a whole-MAP test,
 * so every prefix of the map counts (命蓮寺+霊廟 = 1, 紅魔館+廃洋館+霧之湖 = 3) —
 * unlike the old hand-listed prefix set that silently dropped 紅魔館/霊廟.
 * Field / お出掛け maps (永遠亭 / 迷途竹林 = mapId 4) are NOT home. The "on a
 * date" state is a separate signal (`chkDateNow`), not this classification.
 */
const BASE_MAP_IDS: ReadonlySet<number> = new Set([0, 1, 2, 3]);

/** eraTW `MAIN_MAP` for the current narrowed play slice (Hakurei shrine/base). */
export const MAIN_MAP_ID = 0;

/** String-location prefix → upstream MAPID (`PLACE_ERH.ERH`). */
const MAP_ID_BY_PREFIX: Readonly<Record<string, number>> = Object.freeze({
  神社: MAIN_MAP_ID,
  自宅: MAIN_MAP_ID,
  人間之里: 2,
  命蓮寺: 1,
  霊廟: 1,
  紅魔館: 3,
  廃洋館: 3,
  霧之湖: 3,
  霧の湖: 3,
  永遠亭: 4,
  夢幻館: 4,
  迷途竹林: 4,
  迷いの竹林: 4,
});

/** Split a location string into `[prefix, rest]` (`rest` may be empty). */
function locationPrefix(location: string): string {
  const colon = location.indexOf(":");
  return colon === -1 ? location : location.slice(0, colon);
}

/** Expanded `ROOMDATA` bitset for a location (0 if unmapped). */
export function placeFlagsOf(location: string): bigint {
  const raw = LOCATION_PLACE_FLAGS[location] ?? 0n;
  return expandPlaceFlags(raw);
}

/** Whether upstream ROOMSETTING semantics are registered for this location.
 * This intentionally distinguishes an explicit zero-bit room from a missing
 * location so callers do not resurrect stale name/table classifications. */
export function hasLocationPlaceFlags(location: string): boolean {
  return Object.prototype.hasOwnProperty.call(LOCATION_PLACE_FLAGS, location);
}

/** `IN_HOME(ARG)` — is the location within a base (拠点) map. Per-MAP, matching
 *  upstream `INRANGE(MINROOM(), MAXROOM)` rather than a hand-listed prefix set. */
export function inHome(location: string): boolean {
  const mapId = mapIdOfLocation(location);
  return mapId !== null && BASE_MAP_IDS.has(mapId);
}

/** `GET_MAPID(location)` as a numeric MAPID when the modern prefix is known. */
export function mapIdOfLocation(location: string): number | null {
  const prefix = locationPrefix(location);
  return MAP_ID_BY_PREFIX[prefix] ?? GENERATED_MAP_ID_BY_PREFIX[prefix] ?? null;
}

/**
 * `@CHK_DATENOW(ARG)` (`COMMON2.ERB:7`) — true when `ARG` is not MAIN_MAP.
 * `CFLAG:约会中` stores the ODEKAKE/date destination MAPID, so 0 means
 * "not dating / still at the base map" and non-zero means "on a date map".
 */
export function chkDateNow(mapId: number | null | undefined): boolean {
  return (mapId ?? MAIN_MAP_ID) !== MAIN_MAP_ID;
}

function onResolvedHomeMap(location: string, homeLocation: string): boolean {
  const locationMap = mapIdOfLocation(location);
  const homeMap = mapIdOfLocation(homeLocation);
  if (locationMap !== null && homeMap !== null) return locationMap === homeMap;
  return locationPrefix(location) === locationPrefix(homeLocation);
}

/**
 * Upstream `AT_HOME(ARG)` (`COMMON2.ERB:51`): is the character inside the
 * player's currently selected base map. This is deliberately different from
 * the character being at their own residence.
 */
export function atPlayerBase(state: GameState, charaNum: number): boolean {
  const slot = charaNum === 0 ? state.master : state.charas[charaNum];
  if (!slot) return false;

  const playerHome = state.homeLocation ?? state.master.homeLocation;
  if (playerHome) return onResolvedHomeMap(slot.location, playerHome);

  // Narrow/legacy fixtures may predate GameState.homeLocation. If the master
  // is currently on one of the selectable base maps, use that map as the
  // active MAIN_MAP; while away, fall back to the default shrine base.
  const currentMasterMap = mapIdOfLocation(state.master.location);
  const playerBaseMap = currentMasterMap !== null && BASE_MAP_IDS.has(currentMasterMap)
    ? currentMasterMap
    : MAIN_MAP_ID;
  return mapIdOfLocation(slot.location) === playerBaseMap;
}

/** Is the character on the map containing their own resolved residence? */
export function atOwnHome(state: GameState, charaNum: number): boolean {
  const slot = charaNum === 0 ? state.master : state.charas[charaNum];
  if (!slot) return false;
  const ownHome = charaNum === 0
    ? state.homeLocation ?? slot.homeLocation
    : slot.homeLocation;
  return ownHome ? onResolvedHomeMap(slot.location, ownHome) : false;
}

/** @deprecated Prefer the explicit `atPlayerBase` name. */
export function atHome(state: GameState, charaNum: number): boolean {
  return atPlayerBase(state, charaNum);
}

/**
 * `INROOM(ARG)` (`PLACE_拠点共通.ERB:73`) — indoor-ness: 0 = outdoor,
 * 1 = indoor (和室), 2 = indoor (洋室, shoes-on). `IS_GAP_GUEST` arm
 * deferred → not short-circuited to 1. Modern detailed maps read their
 * imported ROOMSETTING flags directly, equivalent to the upstream GMF
 * dispatch that temporarily selects the destination map.
 */
export function inRoom(_state: Readonly<GameState>, location: string): number {
  const f = placeFlagsOf(location);
  if (hasPlace(f, PLACE_WESTERN)) return 2;
  if (hasPlace(f, PLACE_INDOOR)) return 1;
  if (inHome(location)) return 0;
  // odekake 洋室/屋内 arms (ODEKAKEMAP_SETTING) deferred → 0.
  return 0;
}

/**
 * `IN_TOILET(ARG)` (`PLACE_拠点共通.ERB:307`) — is this location a toilet.
 * Faithful arm: `IN_HOME && 場所_廁所`. お招き部屋 arm → 0 (not modeled).
 */
export function inToilet(location: string): boolean {
  return hasPlace(placeFlagsOf(location), PLACE_TOILET);
}

/**
 * `BATHCHECK(ARG)` (`PLACE_拠点共通.ERB:265`) — is there a bath at this
 * location. Faithful arms modeled: `IN_HOME && 場所_風呂`. Deferred:
 * お招き部屋 + 泡風呂 `TFLAG`, `ODEKAKEMAP_SETTING("風呂")`.
 */
export function bathCheck(_state: GameState, location: string): boolean {
  if (hasPlace(placeFlagsOf(location), PLACE_BATH)) return true;
  // odekake 風呂 arm deferred → false.
  return false;
}

/**
 * `PLACE_SENTO(ARG)` (`COMF432 銭湯.ERB:378`) — 銭湯 place id:
 * 2 = 人里銭湯 (room 223), 9 = 旧地獄温泉 (地底), 0 = none.
 */
export function placeSento(location: string): number {
  if (location === "人間之里:銭湯") return PLACE_SENTO_VILLAGE;
  // 旧地獄温泉 (地底 room 934) deferred — 地底 map out of narrowed scope.
  return PLACE_SENTO_NONE;
}

/**
 * `OPENPLACE(ARG)` (`PLACE_拠点共通.ERB:142`) — spaciousness:
 * 0 = not spacious, 1 = spacious indoor, 2 = spacious outdoor. Faithful
 * arm: `IN_HOME && 場所_广阔 → (INROOM ? 1 : 2)`. Deferred: お招き, ROAD_TO,
 * odekake 広阔.
 */
export function openPlace(state: Readonly<GameState>, location: string): number {
  if (hasPlace(placeFlagsOf(location), PLACE_WIDE)) {
    return inRoom(state, location) > 0 ? 1 : 2;
  }
  if (inHome(location)) return 0;
  // odekake 広阔 / ROAD_TO arms deferred → 0.
  return 0;
}

/**
 * `OUTROOF(ARG)` (`PLACE_拠点共通.ERB:105`) — roofless (野外): 1 = no roof,
 * 0 = roofed/indoor. `IS_GAP_GUEST` arm deferred. Faithful arm:
 * `IN_HOME → (!屋内 && !屋根) ? 1 : 0`. Odekake (non-road) → 1 (roofless).
 */
export function outRoof(_state: GameState, location: string): number {
  // IS_GAP_GUEST arm deferred → not short-circuited to 0.
  const f = placeFlagsOf(location);
  if (hasPlace(f, PLACE_INDOOR)) return 0;
  if (hasPlace(f, PLACE_ROOF)) return 0;
  if (inHome(location)) return 1;
  // Odekake non-road: roofless unless ODEKAKEMAP_SETTING 屋内/屋根 (deferred).
  return 1;
}

/**
 * `IS_GAP_GUEST(ARG)` — 紫の隙間 guest state. **Deferred** (CFLAG not
 * modeled) → always `false`. Commands gating on it block faithfully.
 */
export function isGapGuest(_state: GameState, _charaNum: number): boolean {
  return false;
}

/**
 * `INT_NOUMIN(C_ID, TYPE)` (`NOUMIN.ERB:53`) — farmer-subsystem lookup
 * (e.g. `"場所ID"` returns the farm room id for `FLAG:地主`). **Deferred**
 * — `FLAG:地主` (farmer-landlord) not modeled; returns `null`.
 * COMF470 畑仕事 blocks on this until 地主 + weather (7.1b) land.
 */
export function intNoumin(
  _state: GameState,
  _cId: number,
  _type: string,
): number | null {
  return null;
}

/**
 * `GET_MAPID(ARG)`-equivalent — the map id a location belongs to
 * (upstream `ARG / 100`: 神社=0, 人間の里=2). Used by commands that gate
 * on `GET_MAPID(loc) == MAIN_MAP` (same-map checks, e.g. 436/443/444/464).
 * Returns the prefix string for direct same-map comparison via
 * `sameMap(a, b)`; bare ids are avoided since the modern runtime is
 * string-based.
 */
export function mapKeyOf(location: string): string {
  return locationPrefix(location);
}

/** `GET_MAPID(a) == GET_MAPID(b)` — are two locations on the same map. */
export function sameMap(a: string, b: string): boolean {
  return mapKeyOf(a) === mapKeyOf(b);
}
