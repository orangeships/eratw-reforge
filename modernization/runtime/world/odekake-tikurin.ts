/**
 * ODEKAKE (お出かけ) zone map for 永遠亭 + 迷途竹林 + 夢幻館 (mapId=4).
 *
 * Faithful port of the 原版 (ELSE base) branch of:
 *   - `@ODEKAKEMAP_SETTING_4` (ROOMSETTING_4.ERB:235-293) — the 9 zone
 *     points with their 9×9 grid 座標 + GROUPMATCH attribute flags.
 *
 * 永遠亭+迷途竹林+夢幻館 all share mapId=4 (MAP_ID_BY_PREFIX). The 9 zones
 * are distributed across the three physical areas: 永遠亭 (5), 迷途竹林 (3),
 * 夢幻館 (1).
 *
 * 座標 encoding (upstream): `col*10 + row`, both 1-indexed on a 9×9 grid.
 */

export type TikurinZone =
  | "竹林入口"
  | "迷失的小道"
  | "斜角的竹林"
  | "兎的洞穴"
  | "永遠亭"
  | "無名之丘"
  | "太陽花田"
  | "永遠亭的内院"
  | "夢幻館";

export interface OdekakeZonePoint {
  readonly region: number;
  readonly zone: TikurinZone;
  readonly coord: { readonly col: number; readonly row: number };
  readonly coordValue: number;
  readonly flags: readonly string[];
  readonly memberRooms: readonly string[];
  readonly representativeLocation: string;
  readonly quickMoveCommandNo: number | null;
}

const ei = (name: string): string => `永遠亭:${name}`;
const mei = (name: string): string => `迷途竹林:${name}`;
const mu = (name: string): string => `夢幻館:${name}`;
const ROOT = "迷途竹林";

function decodeCoord(coordValue: number): { col: number; row: number } {
  return { col: Math.floor(coordValue / 10), row: coordValue % 10 };
}

interface RawZone {
  region: number;
  zone: TikurinZone;
  coordValue: number;
  flags: string[];
  memberRooms: string[];
  representativeLocation: string;
  quickMoveCommandNo: number | null;
}

const RAW: RawZone[] = [
  {
    region: 1,
    zone: "竹林入口",
    coordValue: 39,
    flags: [],
    // P401 永遠亭入口 (the entry gate from the bamboo forest into 永遠亭).
    memberRooms: [ei("永遠亭入口")],
    representativeLocation: ei("永遠亭入口"),
    quickMoveCommandNo: null, // reachable via 10706 (move-to-tikurin) only
  },
  {
    region: 2,
    zone: "迷失的小道",
    coordValue: 48,
    flags: [],
    // 迷途竹林:迷失的小道 (the hub connecting all bamboo areas).
    memberRooms: [mei("迷失的小道")],
    representativeLocation: mei("迷失的小道"),
    quickMoveCommandNo: null,
  },
  {
    region: 3,
    zone: "斜角的竹林",
    coordValue: 27,
    flags: [],
    // P433 斜角的竹林 (the always-named angle; modern uses the same name).
    memberRooms: [mei("斜角的竹林")],
    representativeLocation: mei("斜角的竹林"),
    quickMoveCommandNo: 14003, // P401 → P433
  },
  {
    region: 4,
    zone: "兎的洞穴",
    coordValue: 17,
    flags: ["屋根"],
    // P408 兎の洞穴 (the rabbit's burrow — Tewi's home).
    memberRooms: [mei("兎的洞穴")],
    representativeLocation: mei("兎的洞穴"),
    quickMoveCommandNo: null,
  },
  {
    region: 5,
    zone: "永遠亭",
    coordValue: 34,
    flags: ["身体測定", "屋内", "赏月", "休憩", "路人"],
    // P409 永遠亭 (the main mansion body): 廊下 / 診察室 / 配药室 /
    // 待合室 / 来客用廁所 / 厠 / 脱衣所 / 風呂 / 廚房 / 後院 / 庭 /
    // 庫房 / 倉庫 / 居間 / 大廳 / 走廊 / 中廊下 / 二階廊下 / 二階空的部屋 /
    // 空的部屋.
    memberRooms: [
      ei("廊下"),
      ei("診察室"),
      ei("配药室"),
      ei("待合室"),
      ei("来客用廁所"),
      ei("厠"),
      ei("脱衣所"),
      ei("風呂"),
      ei("廚房"),
      ei("後院"),
      ei("庭"),
      ei("庫房"),
      ei("倉庫"),
      ei("居間"),
      ei("大廳"),
      ei("走廊"),
      ei("中廊下"),
      ei("二階廊下"),
      ei("二階空的部屋"),
      ei("空的部屋"),
    ],
    representativeLocation: ei("走廊"),
    quickMoveCommandNo: 14018, // P407 → P409
  },
  {
    region: 6,
    zone: "無名之丘",
    coordValue: 69,
    flags: ["广阔", "お弁当"],
    // P411 無名之丘 (the open picnic area).
    memberRooms: [mei("無名之丘")],
    representativeLocation: mei("無名之丘"),
    quickMoveCommandNo: null,
  },
  {
    region: 7,
    zone: "太陽花田",
    coordValue: 67,
    flags: ["广阔", "お弁当"],
    // P412 太陽花田 (the sunflower field).
    memberRooms: [mei("太陽花田")],
    representativeLocation: mei("太陽花田"),
    quickMoveCommandNo: null,
  },
  {
    region: 8,
    zone: "永遠亭的内院",
    coordValue: 33,
    flags: ["屋内", "赏月"],
    // P420 内院 (Eientei's inner court — connected to the mansion but
    // upstream treats it as a separate zone).
    memberRooms: [ei("内院")],
    representativeLocation: ei("内院"),
    quickMoveCommandNo: null,
  },
  {
    region: 9,
    zone: "夢幻館",
    coordValue: 64,
    flags: ["屋内", "洋室"],
    // P451 夢幻館 (the western-style dream mansion — Mugetsu/Gengetsu's
    // home, plus the 3 PRsisters' rooms). All 屋内 + 洋室.
    memberRooms: [
      mu("玄関"),
      mu("廊下"),
      mu("大堂"),
      mu("庭"),
      mu("生活間"),
      mu("用餐房間"),
      mu("倉庫"),
      mu("空的部屋"),
      mu("廁所"),
      mu("浴室"),
      mu("露台"),
      mu("陽台"),
      mu("幽香私室"),
      mu("夢月私室"),
      mu("幻月私室"),
      mu("艾麗私室"),
      mu("胡桃私室"),
    ],
    representativeLocation: mu("玄関"),
    quickMoveCommandNo: null,
  },
];

export const ODEKAKE_ZONES_TIKURIN: readonly OdekakeZonePoint[] = RAW.map((z) => ({
  region: z.region,
  zone: z.zone,
  coord: decodeCoord(z.coordValue),
  coordValue: z.coordValue,
  flags: z.flags,
  memberRooms: z.memberRooms,
  representativeLocation: z.representativeLocation,
  quickMoveCommandNo: z.quickMoveCommandNo,
}));

const NAMED_ROOM_TO_ZONE = new Map<string, TikurinZone>();
for (const z of ODEKAKE_ZONES_TIKURIN) {
  for (const r of z.memberRooms) NAMED_ROOM_TO_ZONE.set(r, z.zone);
}

/**
 * Port of `@MAP_SEARCH_REPLACEMENT_4` — map a detailed 永遠亭 / 迷途竹林 /
 * 夢幻館 room `location` to its お出かけ zone. Returns `null` for any
 * non-tikurin-prefix location.
 */
export function tikurinZoneOf(location: string): TikurinZone | null {
  if (NAMED_ROOM_TO_ZONE.has(location)) {
    return NAMED_ROOM_TO_ZONE.get(location)!;
  }
  if (location === ROOT) return "迷失的小道";
  return null;
}
