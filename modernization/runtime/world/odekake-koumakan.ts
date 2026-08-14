/**
 * ODEKAKE (お出かけ) zone map for 紅魔館 + 霧之湖 + 廃洋館 (mapId=3).
 *
 * Faithful port of the 原版 (ELSE base) branch of:
 *   - `@ODEKAKEMAP_SETTING_3` (ROOMSETTING_3.ERB:180-232) — the 8 zone
 *     points with their 9×9 grid 座標 + GROUPMATCH attribute flags.
 *
 * 紅魔館+霧之湖+廃洋館 all share mapId=3 (MAP_ID_BY_PREFIX). The 8 zones
 * are distributed across the three physical areas: 霧之湖 (1), 廃洋館 (1),
 * 紅魔館 proper (6).
 *
 * 座標 encoding (upstream): `col*10 + row`, both 1-indexed on a 9×9 grid.
 */

export type KoumakanZone =
  | "霧之湖"
  | "冰造的小雪屋"
  | "廃洋館"
  | "正門"
  | "大廳"
  | "食堂"
  | "大図書館"
  | "地下室";

export interface OdekakeZonePoint {
  readonly region: number;
  readonly zone: KoumakanZone;
  readonly coord: { readonly col: number; readonly row: number };
  readonly coordValue: number;
  readonly flags: readonly string[];
  readonly memberRooms: readonly string[];
  readonly representativeLocation: string;
  readonly quickMoveCommandNo: number | null;
}

const kou = (name: string): string => `紅魔館:${name}`;
const kiri = (name: string): string => `霧之湖:${name}`;
const hai = (name: string): string => `廃洋館:${name}`;
const ROOT = "紅魔館";

function decodeCoord(coordValue: number): { col: number; row: number } {
  return { col: Math.floor(coordValue / 10), row: coordValue % 10 };
}

interface RawZone {
  region: number;
  zone: KoumakanZone;
  coordValue: number;
  flags: string[];
  memberRooms: string[];
  representativeLocation: string;
  quickMoveCommandNo: number | null;
}

const RAW: RawZone[] = [
  {
    region: 1,
    zone: "霧之湖",
    coordValue: 49,
    flags: ["广阔", "訓練", "打水", "お弁当"],
    // P343 湖畔 + P344 霧之湖 + P345 琪露諾的冰屋 / 蕾蒂的冰屋 / 大妖精の棲家 +
    // P348 霧之湖・湖底. Outdoor training + お弁当 + 打水 spots.
    memberRooms: [
      kiri("湖畔"),
      kiri("霧之湖"),
      kiri("霧之湖・湖底"),
      kiri("琪露諾的冰屋"),
      kiri("蕾蒂的冰屋"),
      kiri("大妖精の棲家"),
    ],
    representativeLocation: kiri("湖畔"),
    quickMoveCommandNo: 13004, // P301 → P343
  },
  {
    region: 2,
    zone: "冰造的小雪屋",
    coordValue: 69,
    flags: ["屋内", "洋室"],
    // P345 琪露諾的冰屋 area. 琪露诺 + 蕾蒂 are the two main ices; the
    // upstream CASE pin is on P345 (琪露诺), but both share the
    // "冰造的小雪屋" zone descriptor.
    memberRooms: [kiri("琪露諾的冰屋"), kiri("蕾蒂的冰屋")],
    representativeLocation: kiri("琪露諾的冰屋"),
    quickMoveCommandNo: null, // 343 → 345 is in-room, no synthetic edge
  },
  {
    region: 3,
    zone: "廃洋館",
    coordValue: 28,
    flags: ["屋内", "洋室"],
    // P334 廃洋館・入口 / P335 大廳 / P337 廚房 / P338 風呂 /
    // P339-P341 露娜薩/梅露蘭/莉莉卡私室 / P342 二階廊下.
    memberRooms: [
      hai("廃洋館・入口"),
      hai("廃洋館・大廳"),
      hai("廃洋館・廚房"),
      hai("廃洋館・風呂"),
      hai("廃洋館・二階廊下"),
      hai("露娜薩私室"),
      hai("梅露蘭私室"),
      hai("莉莉卡私室"),
    ],
    representativeLocation: hai("廃洋館・入口"),
    quickMoveCommandNo: null,
  },
  {
    region: 4,
    zone: "正門",
    coordValue: 47,
    flags: [],
    // P301 正門 + P303 守衛小屋 (gate-front guard room, attached to 正門).
    memberRooms: [ROOT, kou("守衛小屋")],
    representativeLocation: ROOT,
    quickMoveCommandNo: 13005, // P302 庭 → P301
  },
  {
    region: 5,
    zone: "大廳",
    coordValue: 46,
    flags: ["屋内", "洋室", "赏月", "广阔", "路人"],
    // P309 大廳 + 連接通路: P307/P308 陽台 + P315 會客廳 + P316 廁所 +
    // P319 二階廊下 + P320 咲夜私室 + P321 空的部屋 + P325 蕾米莉亜私室 +
    // P326 空的部屋 + P327 二層廁所 + P340 露娜薩私室 (mirror) + P341 +
    // P342 梅露蘭/莉莉卡 (mirror) — all 屋内/洋室 around the 紅魔館 2F.
    // P328 地下走廊 is the central spine of the 地下室 zone.
    memberRooms: [
      kou("大廳"),
      kou("東陽台"),
      kou("西陽台"),
      kou("會客廳"),
      kou("一層廁所"),
      kou("二階廊下"),
      kou("咲夜私室"),
      kou("蕾米莉亜私室"),
      kou("空的部屋"),
      kou("二層廁所"),
    ],
    representativeLocation: kou("大廳"),
    quickMoveCommandNo: 13013, // P302 → P309
  },
  {
    region: 6,
    zone: "食堂",
    coordValue: 35,
    flags: ["屋内", "洋室", "赏月", "厨房", "广阔", "休憩", "路人"],
    // P310 食堂 + P311 厨房 + P312 図書館 + P313 廚房 + P314 食堂 (kitchen
    // 廚房 is the prep side; upstream CASE pin is on P310). The 厨房 /
    // 図書館 cluster is the domestic-services wing of the mansion.
    memberRooms: [
      kou("食堂"),
      kou("厨房"),
      kou("図書館"),
    ],
    representativeLocation: kou("食堂"),
    quickMoveCommandNo: 13032, // P309 → P314
  },
  {
    region: 7,
    zone: "大図書館",
    coordValue: 56,
    flags: ["屋内", "洋室", "休憩", "勉強"],
    // P312 大図書館 + P323 帕秋莉私室 (the librarian's room, attached).
    memberRooms: [kou("図書館"), kou("帕秋莉私室")],
    representativeLocation: kou("図書館"),
    quickMoveCommandNo: 13027, // P307 → P310
  },
  {
    region: 8,
    zone: "地下室",
    coordValue: 75,
    flags: ["屋内", "洋室"],
    // P328 地下走廊 / P329 倉庫 / P330 地下室 / P331 使用人部屋 / P332 倉庫
    // / P333 大浴場. The 地下室 wing.
    memberRooms: [
      kou("地下走廊"),
      kou("倉庫"),
      kou("地下室"),
      kou("使用人部屋"),
      kou("小悪魔私室"),
      kou("大浴場"),
      kou("脱衣所"),
    ],
    representativeLocation: kou("地下走廊"),
    quickMoveCommandNo: 13040, // P309 → P328
  },
];

export const ODEKAKE_ZONES_KOUMAKAN: readonly OdekakeZonePoint[] = RAW.map((z) => ({
  region: z.region,
  zone: z.zone,
  coord: decodeCoord(z.coordValue),
  coordValue: z.coordValue,
  flags: z.flags,
  memberRooms: z.memberRooms,
  representativeLocation: z.representativeLocation,
  quickMoveCommandNo: z.quickMoveCommandNo,
}));

const NAMED_ROOM_TO_ZONE = new Map<string, KoumakanZone>();
for (const z of ODEKAKE_ZONES_KOUMAKAN) {
  for (const r of z.memberRooms) NAMED_ROOM_TO_ZONE.set(r, z.zone);
}

/**
 * Port of `@MAP_SEARCH_REPLACEMENT_3` — map a detailed 紅魔館 / 霧之湖 /
 * 廃洋館 room `location` to its お出かけ zone. Returns `null` for any
 * non-koumakan-prefix location.
 */
export function koumakanZoneOf(location: string): KoumakanZone | null {
  if (NAMED_ROOM_TO_ZONE.has(location)) {
    return NAMED_ROOM_TO_ZONE.get(location)!;
  }
  if (location === ROOT) return "正門";
  return null;
}
