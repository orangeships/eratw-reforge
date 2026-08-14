/**
 * ODEKAKE (お出かけ) zone map for 博麗神社 (mapId=0).
 *
 * Faithful port of the 原版 (ELSE base) branch of:
 *   - `@ODEKAKEMAP_SETTING_0` (ROOMSETTING_0.ERB:265-313) — the 7 zone
 *     points with their 9×9 grid 座標 + GROUPMATCH attribute flags.
 *
 * 座標 encoding (upstream): `col*10 + row`, both 1-indexed on a 9×9 grid.
 * Region number (1-7) = the SELECTCASE order, which also matches the
 * embedded `01`-`07` labels on `@COLOREDODEKAKEMAP_0`'s ASCII thumbnail.
 *
 * The member-room `location` strings are the exact strings emitted by
 * `room-move.ts` and the shrine scene bundle, so `shrineZoneOf` keys line
 * up with live `master.location` values.
 *
 * The 大别墅 zone (region 7) covers DLC rooms (P57-P67) that are not in
 * the modern build; memberRooms is therefore an empty list. Callers should
 * treat it as a "no-op zone" rather than dropping it (preserves parity
 * with upstream, so the 7-region order stays stable for future DLC work).
 */

export type ShrineZone =
  | "桜花道的鳥居"
  | "神社境内"
  | "神社本堂"
  | "神社走廊"
  | "妖精的大樹"
  | "夢幻遺跡"
  | "大别墅";

export interface OdekakeZonePoint {
  /** SELECTCASE order = thumbnail label 01-07. */
  readonly region: number;
  readonly zone: ShrineZone;
  /** 1-indexed grid position decoded from upstream 座標 (col*10+row). */
  readonly coord: { readonly col: number; readonly row: number };
  /** Raw upstream 座標 value (col*10+row), kept for traceability. */
  readonly coordValue: number;
  /** GROUPMATCH attribute flags from `@ODEKAKEMAP_SETTING_0`. */
  readonly flags: readonly string[];
  /** The detailed-room `location` strings that merge into this zone. */
  readonly memberRooms: readonly string[];
  /** Iconic room the quick-travel button lands on. */
  readonly representativeLocation: string;
  /**
   * A registered directional edge in `room-move.ts` whose `toLocation`
   * IS `representativeLocation`. Firing it from a designated source room
   * teleports the player to this zone. Falsy when no such edge exists
   * (DLC zones, e.g. 大别墅).
   */
  readonly quickMoveCommandNo: number | null;
}

const PREFIX = "神社";
const room = (name: string): string => `${PREFIX}:${name}`;

function decodeCoord(coordValue: number): { col: number; row: number } {
  return { col: Math.floor(coordValue / 10), row: coordValue % 10 };
}

interface RawZone {
  region: number;
  zone: ShrineZone;
  coordValue: number;
  flags: string[];
  memberRooms: string[];
  representativeLocation: string;
  quickMoveCommandNo: number | null;
}

const RAW: RawZone[] = [
  {
    region: 1,
    zone: "桜花道的鳥居",
    coordValue: 49,
    flags: ["お弁当"],
    // Upstream CASE 桜花道的鳥居 — the approach path: P1鳥居 + P22参道 +
    // P25鎮守之森. These are the entry / outdoor / お弁当 spots; the
    // torii itself is the quick-move target.
    memberRooms: [
      room("鳥居"),
      room("参道"),
      room("鎮守之森"),
    ],
    representativeLocation: room("鳥居"),
    quickMoveCommandNo: 10711, // P5 root shrine → P22 参道 ... 10711 is the entry edge
  },
  {
    region: 2,
    zone: "神社境内",
    coordValue: 48,
    flags: ["广阔", "訓練"],
    // 广阔 / 訓練 outdoor: P2 境内 / P11 庭 / P68 大广场 / P3 賽銭箱.
    // P68 is a P3 area attached to the great plaza outside; treat it as
    // part of the 境内 zone (training spot) rather than 別墅 (DLC).
    memberRooms: [
      room("境内"),
      room("庭"),
      room("賽銭箱"),
      room("大广场"),
    ],
    representativeLocation: room("境内"),
    quickMoveCommandNo: 10738, // 参道 → 境内
  },
  {
    region: 3,
    zone: "神社本堂",
    coordValue: 47,
    flags: ["屋内"],
    // Upstream 屋内 group: P4 本堂 + P5 手水舎 (打水屋外) — but P3 賽銭箱
    // also listed here in spirit. Modern maps it to 屋内 rooms around the
    // hondou: 本堂 + 庫房 (P6).
    memberRooms: [
      room("本堂"),
      room("庫房"),
    ],
    representativeLocation: room("本堂"),
    quickMoveCommandNo: 10740, // 賽銭箱 → 本堂
  },
  {
    region: 4,
    zone: "神社走廊",
    coordValue: 45,
    flags: ["屋内", "赏月", "休憩"],
    // 屋内 + 赏月 + 休憩: P10 走廊 (赏月/物干し) + P9 居間 (休憩/学习/
    // 饮食/炬燵) + P7 土間 (屋内) + P12 脱衣所. The 走廊 is the connector
    // and the iconic representative.
    memberRooms: [
      room("走廊"),
      room("居間"),
      room("土間"),
      room("脱衣所"),
      room("更衣室"),
    ],
    representativeLocation: room("走廊"),
    quickMoveCommandNo: 10724, // 居間 → 走廊
  },
  {
    region: 5,
    zone: "妖精的大樹",
    coordValue: 16,
    flags: ["屋内", "洋室", "赏月"],
    // P27 大廳 / P29 廚房 / P30 風呂 / P31 二階廊下 / P32-P34 三妖精
    // 私室 / P35 地下室. All 洋室 (western) + 屋内 + 赏月 (三階 sleeps).
    memberRooms: [
      room("三妖精之家・大廳"),
      room("三妖精之家・廚房"),
      room("三妖精之家・風呂"),
      room("三妖精之家・二階廊下"),
      room("桑尼私室"),
      room("露娜私室"),
      room("斯塔私室"),
      room("三妖精之家・地下室"),
    ],
    representativeLocation: room("三妖精之家・大廳"),
    quickMoveCommandNo: 10774, // 鎮守之森 → 三妖精之家・大廳
  },
  {
    region: 6,
    zone: "夢幻遺跡",
    coordValue: 88,
    flags: ["屋内", "洋室", "勉強"],
    // P36 夢幻遺跡前 / P37-P46 一階通路 / 二階通路 / 洗面所 / 浴室 /
    // 廁所 / 食堂 / 調理室 / 艦橋 / 第一資料室 / 第二資料室 / 研究室 /
    // 倉庫 / P43 夢美私室 / P44 千百合私室. All 洋室.
    memberRooms: [
      room("夢幻遺跡前"),
      room("夢幻遺跡・一階通路"),
      room("夢幻遺跡・二階通路"),
      room("夢幻遺跡・洗面所"),
      room("夢幻遺跡・浴室"),
      room("夢幻遺跡・廁所"),
      room("夢幻遺跡・食堂兼談話室"),
      room("夢幻遺跡・調理室"),
      room("夢幻遺跡・艦橋"),
      room("夢幻遺跡・第一資料室"),
      room("夢幻遺跡・第二資料室"),
      room("夢幻遺跡・研究室"),
      room("夢幻遺跡・倉庫"),
      room("夢美私室"),
      room("千百合私室"),
    ],
    representativeLocation: room("夢幻遺跡前"),
    quickMoveCommandNo: 10784, // 鎮守之森 → 夢幻遺跡前
  },
  {
    region: 7,
    zone: "大别墅",
    coordValue: 99,
    flags: ["屋内", "勉強", "休憩"],
    // P57-P67 DLC 大别墅 area: 大温泉 / 大主卧 / 大厨房 / 大客厅 /
    // 地の間-暗の間 / 宴会厅. None of these rooms are in the modern
    // build (DLC content, gated via @MAP_CANNOT_WORD_0 reason 3). The
    // representativeLocation is the upstream 「大别墅」 generic string
    // (no modern scene equivalent). quickMoveCommandNo is null.
    memberRooms: [],
    representativeLocation: "神社:大别墅",
    quickMoveCommandNo: null,
  },
];

export const ODEKAKE_ZONES_SHRINE: readonly OdekakeZonePoint[] = RAW.map((z) => ({
  region: z.region,
  zone: z.zone,
  coord: decodeCoord(z.coordValue),
  coordValue: z.coordValue,
  flags: z.flags,
  memberRooms: z.memberRooms,
  representativeLocation: z.representativeLocation,
  quickMoveCommandNo: z.quickMoveCommandNo,
}));

const NAMED_ROOM_TO_ZONE = new Map<string, ShrineZone>();
for (const z of ODEKAKE_ZONES_SHRINE) {
  for (const r of z.memberRooms) NAMED_ROOM_TO_ZONE.set(r, z.zone);
}

/**
 * Port of `@MAP_SEARCH_REPLACEMENT_0` — map a detailed shrine room
 * `location` to its お出かけ zone. Returns `null` for any non-shrine
 * location (mirrors the upstream contract). The 大别墅 zone has no
 * built member rooms, so it is never returned from this lookup.
 */
export function shrineZoneOf(location: string): ShrineZone | null {
  return NAMED_ROOM_TO_ZONE.get(location) ?? null;
}
