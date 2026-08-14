/**
 * ODEKAKE (お出かけ) zone map for 命蓮寺 + 神霊廟 (mapId=1).
 *
 * Faithful port of the 原版 (ELSE base) branch of:
 *   - `@ODEKAKEMAP_SETTING_1` (ROOMSETTING_1.ERB:175-222) — the 7 zone
 *     points with their 9×9 grid 座標 + GROUPMATCH attribute flags.
 *
 * 命蓮寺 has two physical areas (P101-P122+P135-P137+P140 = "命蓮寺" prefix;
 * P123-P134+P138-P139 = "霊廟" prefix), both sharing mapId=1. The member
 * rooms of every zone are picked from one or the other prefix as the
 * upstream CASE pin dictates (e.g. 神霊廟広場 only contains 霊廟:* rooms).
 *
 * 座標 encoding (upstream): `col*10 + row`, both 1-indexed on a 9×9 grid.
 */

export type MyourenZone =
  | "地蔵小路"
  | "倒垂的柳樹下"
  | "命蓮寺境内"
  | "命蓮寺方丈"
  | "墓地"
  | "神霊廟広場"
  | "神霊廟道場";

export interface OdekakeZonePoint {
  readonly region: number;
  readonly zone: MyourenZone;
  readonly coord: { readonly col: number; readonly row: number };
  readonly coordValue: number;
  readonly flags: readonly string[];
  readonly memberRooms: readonly string[];
  readonly representativeLocation: string;
  readonly quickMoveCommandNo: number | null;
}

const reiten = (name: string): string => `命蓮寺:${name}`;
const reibou = (name: string): string => `霊廟:${name}`;
const ROOT = "命蓮寺";

function decodeCoord(coordValue: number): { col: number; row: number } {
  return { col: Math.floor(coordValue / 10), row: coordValue % 10 };
}

interface RawZone {
  region: number;
  zone: MyourenZone;
  coordValue: number;
  flags: string[];
  memberRooms: string[];
  representativeLocation: string;
  quickMoveCommandNo: number | null;
}

const RAW: RawZone[] = [
  {
    region: 1,
    zone: "地蔵小路",
    coordValue: 59,
    flags: ["广阔", "お弁当", "路人"],
    // Upstream P140 地蔵小路 + 參道 entry. P140 is also the boundary room
    // connecting to outside. The 参道 is shared with shrine (location
    // "神社:参道"), but the upstream CASE pin is on 命蓮寺's side, so we
    // include the entry / parking area.
    memberRooms: [reiten("地蔵小路")],
    representativeLocation: reiten("地蔵小路"),
    quickMoveCommandNo: 11003, // P101 山門 → P140 地蔵小路
  },
  {
    region: 2,
    zone: "倒垂的柳樹下",
    coordValue: 58,
    flags: ["お弁当", "路人"],
    // P139 邪仙楼 area — 邪仙楼 + its surrounding grounds.
    memberRooms: [reibou("邪仙楼")],
    representativeLocation: reibou("邪仙楼"),
    quickMoveCommandNo: 11081, // P124 霊廟広場 → P139 邪仙楼
  },
  {
    region: 3,
    zone: "命蓮寺境内",
    coordValue: 27,
    flags: ["广阔", "訓練", "路人"],
    // P102 境内 + P105 経蔵 + P104 講堂 + P107 土間 + P110 走廊 + P122 梵鐘楼
    // + P140 地蔵小路 (also overlaps with region 1 as the connecting path).
    // Training-grounded (境内) plus 講堂/経蔵/走廊/梵鐘楼.
    memberRooms: [
      ROOT,
      reiten("境内"),
      reiten("経蔵"),
      reiten("講堂"),
      reiten("土間"),
      reiten("走廊"),
      reiten("梵鐘楼"),
    ],
    representativeLocation: reiten("境内"),
    quickMoveCommandNo: 11001, // P101 山門 → P102 境内
  },
  {
    region: 4,
    zone: "命蓮寺方丈",
    coordValue: 36,
    flags: ["屋内", "赏月"],
    // P103 本堂 (方丈 is the main-hall reading).
    memberRooms: [reiten("本堂")],
    representativeLocation: reiten("本堂"),
    quickMoveCommandNo: 11019, // P103 本堂 → P104 講堂 (or reverse)
  },
  {
    region: 5,
    zone: "墓地",
    coordValue: 16,
    flags: [],
    // P121 墓地.
    memberRooms: [reiten("墓地")],
    representativeLocation: reiten("墓地"),
    quickMoveCommandNo: 11013, // P102 境内 → P121 墓地
  },
  {
    region: 6,
    zone: "神霊廟広場",
    coordValue: 87,
    flags: ["广阔", "訓練", "路人"],
    // P123 霊廟大門 / P124 霊廟広場 / P130 廊下 / P131 枯山水 / P134 蔵 /
    // P125 屠自古私室 / P127 布都私室 / P128 神子私室 / P138 鐘楼.
    memberRooms: [
      reibou("霊廟大門"),
      reibou("霊廟広場"),
      reibou("廊下"),
      reibou("枯山水"),
      reibou("蔵"),
      reibou("屠自古私室"),
      reibou("布都私室"),
      reibou("神子私室"),
      reibou("鐘楼"),
    ],
    representativeLocation: reibou("霊廟広場"),
    quickMoveCommandNo: 11069, // P123 霊廟大門 → P124 霊廟広場
  },
  {
    region: 7,
    zone: "神霊廟道場",
    coordValue: 85,
    flags: ["屋内", "赏月"],
    // P126 道場 + P129 客間 (道場 area indoor).
    memberRooms: [reibou("道場"), reibou("客間")],
    representativeLocation: reibou("道場"),
    quickMoveCommandNo: 11073, // P124 霊廟広場 → P126 道場
  },
];

export const ODEKAKE_ZONES_MYOUREN: readonly OdekakeZonePoint[] = RAW.map((z) => ({
  region: z.region,
  zone: z.zone,
  coord: decodeCoord(z.coordValue),
  coordValue: z.coordValue,
  flags: z.flags,
  memberRooms: z.memberRooms,
  representativeLocation: z.representativeLocation,
  quickMoveCommandNo: z.quickMoveCommandNo,
}));

const NAMED_ROOM_TO_ZONE = new Map<string, MyourenZone>();
for (const z of ODEKAKE_ZONES_MYOUREN) {
  for (const r of z.memberRooms) NAMED_ROOM_TO_ZONE.set(r, z.zone);
}

/**
 * Port of `@MAP_SEARCH_REPLACEMENT_1` — map a detailed 命蓮寺/霊廟 room
 * `location` to its お出かけ zone. Returns `null` for any non-myouren
 * location.
 */
export function myourenZoneOf(location: string): MyourenZone | null {
  if (NAMED_ROOM_TO_ZONE.has(location)) {
    return NAMED_ROOM_TO_ZONE.get(location)!;
  }
  if (location === ROOT) return "命蓮寺境内";
  return null;
}
