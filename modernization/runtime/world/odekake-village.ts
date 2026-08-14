/**
 * ODEKAKE (お出かけ) zone map for the 人間の里 (mapId=2).
 *
 * Faithful port of the 原版 (ELSE / base-game) branch of:
 *   - `@ODEKAKEMAP_SETTING_2`   (ROOMSETTING_2.ERB:200-247) — the 7 zone
 *     points with their 9×9 grid 座標 + attribute flags.
 *   - `@MAP_SEARCH_REPLACEMENT_2` (MAP_COMM_02.ERB:430-447) — the 44
 *     detailed-room → 7 zone-point merge table (the reverse lookup).
 *
 * The `人里地图优化` GMF mod-layer branch (different 座標 + 甜品店 in
 * 呑屋小道) is deferred, like the other GMF QOL mods.
 *
 * 座標 encoding (upstream): `col*10 + row`, both 1-indexed on a 9×9 grid.
 * Region number (1-7) = the SELECTCASE order, which also matches the
 * embedded `01`-`07` labels on `@COLOREDODEKAKEMAP_2`'s ASCII thumbnail.
 *
 * IMPORTANT (oracle correction): the merge table case
 * `P201人里的門 TO P207龍神像` is a RANGE, so P206 西大街 merges into
 * **広場**, NOT 長屋街. (An earlier hand-scout in DEBUG-BOARD mis-read
 * this; the ERB range is authoritative.)
 *
 * The member-room location strings are the exact strings emitted by
 * `gen-village-scenes.mjs` (root P201 = "人間之里"; the rest =
 * "人間之里:<name>"), so `villageZoneOf` keys line up with live
 * `master.location` values and the scene/handler tables.
 */

export type VillageZone =
  | "広場"
  | "商家町"
  | "呑屋小道"
  | "寺子屋"
  | "大衆浴場"
  | "情人用宿屋"
  | "長屋街";

export interface OdekakeZonePoint {
  /** SELECTCASE order = thumbnail label 01-07. */
  readonly region: number;
  readonly zone: VillageZone;
  /** 1-indexed grid position decoded from upstream 座標 (col*10+row). */
  readonly coord: { readonly col: number; readonly row: number };
  /** Raw upstream 座標 value (col*10+row), kept for traceability. */
  readonly coordValue: number;
  /** GROUPMATCH attribute flags from `@ODEKAKEMAP_SETTING_2`. */
  readonly flags: readonly string[];
  /**
   * The detailed-room `location` strings that merge into this zone, per
   * `@MAP_SEARCH_REPLACEMENT_2`. 長屋街 is the CASEELSE bucket.
   */
  readonly memberRooms: readonly string[];
  /** Iconic room the quick-travel button lands on. */
  readonly representativeLocation: string;
  /**
   * A registered directional edge in `village-move.ts` whose `toLocation`
   * IS `representativeLocation`. Firing it from the gate teleports the
   * player to this zone's representative room (the handler does not gate on
   * the source room). MVP quick-travel; faithful walk-the-path is #9 (defer).
   */
  readonly quickMoveCommandNo: number;
}

const PREFIX = "人間之里";
const room = (name: string): string => `${PREFIX}:${name}`;
const GATE = PREFIX; // P201 人里的門 root room (no colon suffix)

/** decode upstream 座標 (col*10+row) → {col,row}. */
function decodeCoord(coordValue: number): { col: number; row: number } {
  return { col: Math.floor(coordValue / 10), row: coordValue % 10 };
}

interface RawZone {
  region: number;
  zone: VillageZone;
  coordValue: number;
  flags: string[];
  memberRooms: string[];
  representativeLocation: string;
  quickMoveCommandNo: number;
}

const RAW: RawZone[] = [
  {
    region: 1,
    zone: "広場",
    coordValue: 55,
    flags: ["广阔", "路人"],
    // P201人里的門 TO P207龍神像 (range), P217甜品店, P219集会所, P220瞭望樓, P280警察署, P281小兎姫私室
    memberRooms: [
      GATE,
      room("中央広場"),
      room("南大街"),
      room("東大街"),
      room("北大街"),
      room("西大街"),
      room("龍神像"),
      room("甜品店"),
      room("集会所"),
      room("瞭望樓"),
      room("警察署"),
      room("小兎姫私室"),
    ],
    representativeLocation: room("中央広場"),
    quickMoveCommandNo: 12004, // P203 → P202 中央広場
  },
  {
    region: 2,
    zone: "商家町",
    coordValue: 75,
    flags: ["屋根", "赏月", "路人"],
    memberRooms: [
      room("鈴奈庵"),
      room("花屋"),
      room("食料品店"),
      room("小鈴私室"),
      room("八百屋"),
    ],
    representativeLocation: room("鈴奈庵"),
    quickMoveCommandNo: 12037, // P204 → P213 鈴奈庵
  },
  {
    region: 3,
    zone: "呑屋小道",
    coordValue: 57,
    flags: ["屋根", "赏月", "路人"],
    memberRooms: [
      room("酒屋"),
      room("咖啡館"),
      room("小料理屋"),
      room("鯢呑亭"),
      room("美宵的房間"),
    ],
    representativeLocation: room("酒屋"),
    quickMoveCommandNo: 12025, // P203 → P211 酒屋
  },
  {
    region: 4,
    zone: "寺子屋",
    coordValue: 73,
    flags: ["屋内", "赏月", "休憩", "勉強", "路人"],
    memberRooms: [room("寺子屋"), room("慧音宅")],
    representativeLocation: room("寺子屋"),
    quickMoveCommandNo: 12043, // P204 → P222 寺子屋
  },
  {
    region: 5,
    zone: "大衆浴場",
    coordValue: 77,
    flags: ["屋内", "風呂", "身体測定", "路人"],
    memberRooms: [room("銭湯"), room("貸切浴場")],
    representativeLocation: room("銭湯"),
    quickMoveCommandNo: 12045, // P204 → P223 銭湯
  },
  {
    region: 6,
    zone: "情人用宿屋",
    coordValue: 24,
    flags: ["被窝", "屋内", "休憩"],
    memberRooms: [room("情人用宿屋")],
    representativeLocation: room("情人用宿屋"),
    quickMoveCommandNo: 12075, // P206 → P225 情人用宿屋
  },
  {
    region: 7,
    zone: "長屋街",
    coordValue: 37,
    flags: ["屋内", "赏月", "厨房", "路人"],
    // CASEELSE — every other village room (residential long-house cluster +
    // 稗田邸/阿求私室). Listed explicitly for the merge table / UI; the
    // reverse lookup treats it as the fall-through bucket.
    memberRooms: [
      room("雷鼓的房間"),
      room("八橋的房間"),
      room("弁弁的房間"),
      room("長屋前"),
      room("稗田邸"),
      room("阿求私室"),
      room("空的部屋"),
      room("蛮奇的房間"),
      room("蓮子的房間"),
      room("梅莉的房間"),
      room("雪的房間"),
      room("舞的房間"),
      room("公用廁所"),
      room("公用水井"),
      room("空的部屋(241)"),
      room("麟的房间"),
      room("空的部屋(243)"),
    ],
    representativeLocation: room("長屋前"),
    quickMoveCommandNo: 12029, // P203 → P214 長屋前
  },
];

export const ODEKAKE_ZONES: readonly OdekakeZonePoint[] = RAW.map((z) => ({
  region: z.region,
  zone: z.zone,
  coord: decodeCoord(z.coordValue),
  coordValue: z.coordValue,
  flags: z.flags,
  memberRooms: z.memberRooms,
  representativeLocation: z.representativeLocation,
  quickMoveCommandNo: z.quickMoveCommandNo,
}));

/** zone → 6 explicitly-named zones (everything else is the 長屋街 bucket). */
const NAMED_ROOM_TO_ZONE = new Map<string, VillageZone>();
for (const z of ODEKAKE_ZONES) {
  if (z.zone === "長屋街") continue; // CASEELSE — resolved by fall-through
  for (const r of z.memberRooms) NAMED_ROOM_TO_ZONE.set(r, z.zone);
}

/**
 * Port of `@MAP_SEARCH_REPLACEMENT_2` (ELSE base branch): map a detailed
 * village room `location` to its お出かけ zone point. Returns `null` for
 * any location that is NOT a 人間の里 room (the upstream function is only
 * ever called with a village room ID, so a non-village location is "no
 * zone" rather than the 長屋街 fall-through).
 */
export function villageZoneOf(location: string): VillageZone | null {
  const named = NAMED_ROOM_TO_ZONE.get(location);
  if (named) return named;
  if (location === GATE || location.startsWith(`${PREFIX}:`)) return "長屋街";
  return null;
}
