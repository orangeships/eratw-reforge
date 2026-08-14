/**
 * Phase L2 — Shrine room properties for COMABLE command gating.
 *
 * Derived from `ROOMSETTING_0.ERB` in the original game. Each room
 * has boolean flags used by `execCheck` to gate commands (e.g. 就寝
 * only in rooms with 被窝, お茶 only in rooms with 厨房).
 */

export interface ShrineRoomProps {
  location: string;
  displayName: string;
  /** P-number from the original ERB (e.g. "P22"). */
  pNum: string;
  /** 屋内 — indoors (vs outdoor). */
  indoor: boolean;
  /** 厨房 — kitchen. */
  kitchen: boolean;
  /** 風呂 — bath. */
  bath: boolean;
  /** 被窝 — bedding/sleeping area. */
  bed: boolean;
  /** プライベート — private room. */
  private: boolean;
  /** 公共の場 — public space (no intimacy commands). */
  public: boolean;
  /** 训练 — training area. */
  training: boolean;
  /** 饮食 — eating/drinking allowed. */
  dining: boolean;
  /** 広阔 — spacious/open area. */
  spacious: boolean;
}

function room(
  location: string,
  displayName: string,
  pNum: string,
  flags: Partial<Omit<ShrineRoomProps, "location" | "displayName" | "pNum">> = {},
): ShrineRoomProps {
  return {
    location, displayName, pNum,
    indoor: false, kitchen: false, bath: false, bed: false,
    private: false, public: false, training: false, dining: false, spacious: false,
    ...flags,
  };
}

/** All shrine rooms with their properties. Indexed by `location` string. */
export const SHRINE_ROOM_PROPS: Record<string, ShrineRoomProps> = {
  "神社:参道": {
    location: "神社:参道", displayName: "参道", pNum: "P22",
    indoor: false, kitchen: false, bath: false, bed: false,
    private: false, public: true, training: false, dining: false, spacious: true,
  },
  "神社:鳥居": {
    location: "神社:鳥居", displayName: "鳥居", pNum: "P1",
    indoor: false, kitchen: false, bath: false, bed: false,
    private: false, public: true, training: false, dining: false, spacious: false,
  },
  "神社:境内": {
    location: "神社:境内", displayName: "境内", pNum: "P2",
    indoor: false, kitchen: false, bath: false, bed: false,
    private: false, public: true, training: true, dining: false, spacious: true,
  },
  "神社:本堂": {
    location: "神社:本堂", displayName: "本堂", pNum: "P4",
    indoor: true, kitchen: false, bath: false, bed: false,
    private: false, public: true, training: false, dining: false, spacious: false,
  },
  "神社:賽銭箱": {
    location: "神社:賽銭箱", displayName: "賽銭箱", pNum: "P3",
    indoor: false, kitchen: false, bath: false, bed: false,
    private: false, public: true, training: false, dining: false, spacious: false,
  },
  "神社:土間": {
    location: "神社:土間", displayName: "土間", pNum: "P7",
    indoor: true, kitchen: false, bath: false, bed: false,
    private: false, public: false, training: false, dining: false, spacious: false,
  },
  "神社:厨房": {
    location: "神社:厨房", displayName: "厨房", pNum: "P8",
    indoor: true, kitchen: true, bath: false, bed: false,
    private: false, public: false, training: false, dining: true, spacious: false,
  },
  "神社:居間": {
    location: "神社:居間", displayName: "居間", pNum: "P9",
    indoor: true, kitchen: false, bath: false, bed: false,
    private: false, public: false, training: false, dining: true, spacious: false,
  },
  "神社:走廊": {
    location: "神社:走廊", displayName: "走廊", pNum: "P10",
    indoor: true, kitchen: false, bath: false, bed: false,
    private: false, public: false, training: false, dining: true, spacious: false,
  },
  "神社:庭": {
    location: "神社:庭", displayName: "庭", pNum: "P11",
    indoor: false, kitchen: false, bath: false, bed: false,
    private: false, public: false, training: true, dining: false, spacious: true,
  },
  "神社:脱衣所": {
    location: "神社:脱衣所", displayName: "脱衣所", pNum: "P12",
    indoor: true, kitchen: false, bath: false, bed: false,
    private: true, public: false, training: false, dining: false, spacious: false,
  },
  "神社:風呂": {
    location: "神社:風呂", displayName: "風呂", pNum: "P13",
    indoor: true, kitchen: false, bath: true, bed: false,
    private: true, public: false, training: false, dining: false, spacious: false,
  },
  "神社:霊夢私室": {
    location: "神社:霊夢私室", displayName: "霊夢私室", pNum: "P15",
    indoor: true, kitchen: false, bath: false, bed: true,
    private: true, public: false, training: false, dining: false, spacious: false,
  },
  "神社:大的倉庫": {
    location: "神社:大的倉庫", displayName: "大的倉庫", pNum: "P19",
    indoor: true, kitchen: false, bath: false, bed: true,
    private: true, public: false, training: false, dining: false, spacious: false,
  },
  "神社:小人的虫籠": {
    location: "神社:小人的虫籠", displayName: "小人的虫籠", pNum: "P54",
    indoor: true, kitchen: false, bath: false, bed: true,
    private: true, public: false, training: false, dining: false, spacious: false,
  },
  "神社:阿吽の棲家": {
    location: "神社:阿吽の棲家", displayName: "阿吽の棲家", pNum: "P56",
    indoor: true, kitchen: false, bath: false, bed: true,
    private: true, public: false, training: false, dining: false, spacious: false,
  },
  "神社:庫房": room("神社:庫房", "庫房", "P6"),
  "神社:小的倉庫": room("神社:小的倉庫", "小的倉庫", "P17", { indoor: true, bed: true, private: true }),
  "神社:壁櫥間": room("神社:壁櫥間", "壁櫥間", "P18", { indoor: true, bed: true, private: true }),
  "神社:別屋": room("神社:別屋", "別屋", "P52", { indoor: true, bed: true, private: true }),
  "神社:和室": room("神社:和室", "和室", "P55", { indoor: true, bed: true, private: true }),
  "神社:先代巫女的小屋": room("神社:先代巫女的小屋", "先代巫女的小屋", "P69", { indoor: true, bed: true, private: true }),
  "神社:守矢神社分社": room("神社:守矢神社分社", "守矢神社分社", "P21", { public: true }),
  "神社:鎮守之森": room("神社:鎮守之森", "鎮守之森", "P25", { public: true, spacious: true }),
  "神社:三妖精之家・大廳": room("神社:三妖精之家・大廳", "三妖精之家・大廳", "P27", { indoor: true, dining: true, spacious: true }),
  "神社:三妖精之家・二階廊下": room("神社:三妖精之家・二階廊下", "三妖精之家・二階廊下", "P31", { indoor: true }),
  "神社:桑尼私室": room("神社:桑尼私室", "桑尼私室", "P32", { indoor: true, bed: true, private: true }),
  "神社:露娜私室": room("神社:露娜私室", "露娜私室", "P33", { indoor: true, bed: true, private: true }),
  "神社:斯塔私室": room("神社:斯塔私室", "斯塔私室", "P34", { indoor: true, bed: true, private: true }),
  "神社:夢幻遺跡前": room("神社:夢幻遺跡前", "夢幻遺跡前", "P36", { public: true }),
  "神社:夢幻遺跡・一階通路": room("神社:夢幻遺跡・一階通路", "夢幻遺跡・一階通路", "P37", { indoor: true }),
  "神社:夢美私室": room("神社:夢美私室", "夢美私室", "P43", { indoor: true, bed: true, private: true }),
  "神社:千百合私室": room("神社:千百合私室", "千百合私室", "P44", { indoor: true, bed: true, private: true }),

  // ── Parity QA 地图解锁：22 个 HAKUREI 彩图里画了但此前未接线的房间
  // （location=null → ColoredMapView 不可点 → 图内相邻移动断）。
  // flags 忠实 ROOMSETTING_0.ERB（洋室→屋内 auto；ワンルーム→被窝/屋内/厨房/飲食/私室 auto）。
  // 补这一处，build-colored-maps 的 locationMap 与 oracle/room-id-to-location 自动跟上。
  // 神社本区 ─
  "神社:手水舎": room("神社:手水舎", "手水舎", "P5"),
  "神社:廁所": room("神社:廁所", "廁所", "P14", { indoor: true, private: true }),
  "神社:破舊小屋": room("神社:破舊小屋", "破舊小屋", "P16", { indoor: true, bed: true, kitchen: true, dining: true }),
  "神社:温泉・脱衣所": room("神社:温泉・脱衣所", "温泉・脱衣所", "P23", { indoor: true }),
  "神社:温泉": room("神社:温泉", "温泉", "P24", { bath: true }),
  "神社:倉庫": room("神社:倉庫", "倉庫", "P53", { indoor: true, bed: true, private: true }),
  "神社:大广场": room("神社:大广场", "大广场", "P68", { spacious: true, training: true, public: true }),
  "神社:贝子的暂居处": room("神社:贝子的暂居处", "贝子的暂居处", "P70", { indoor: true, bed: true, kitchen: true, dining: true, private: true }),
  // 三妖精之家（经 P27 大廳 入） ─
  "神社:三妖精之家・廚房": room("神社:三妖精之家・廚房", "三妖精之家・廚房", "P29", { indoor: true, kitchen: true }),
  "神社:三妖精之家・風呂": room("神社:三妖精之家・風呂", "三妖精之家・風呂", "P30", { indoor: true, bath: true, private: true }),
  "神社:三妖精之家・地下室": room("神社:三妖精之家・地下室", "三妖精之家・地下室", "P35", { indoor: true }),
  // 夢幻遺跡（经 P36 前 / P37 一階通路 入） ─
  "神社:夢幻遺跡・洗面所": room("神社:夢幻遺跡・洗面所", "夢幻遺跡・洗面所", "P38", { indoor: true }),
  "神社:夢幻遺跡・浴室": room("神社:夢幻遺跡・浴室", "夢幻遺跡・浴室", "P39", { indoor: true, bath: true, private: true }),
  "神社:夢幻遺跡・廁所": room("神社:夢幻遺跡・廁所", "夢幻遺跡・廁所", "P40", { indoor: true, private: true }),
  "神社:夢幻遺跡・食堂兼談話室": room("神社:夢幻遺跡・食堂兼談話室", "夢幻遺跡・食堂兼談話室", "P41", { indoor: true, dining: true }),
  "神社:夢幻遺跡・調理室": room("神社:夢幻遺跡・調理室", "夢幻遺跡・調理室", "P42", { indoor: true, kitchen: true }),
  "神社:夢幻遺跡・二階通路": room("神社:夢幻遺跡・二階通路", "夢幻遺跡・二階通路", "P46", { indoor: true }),
  "神社:夢幻遺跡・艦橋": room("神社:夢幻遺跡・艦橋", "夢幻遺跡・艦橋", "P47"),
  "神社:夢幻遺跡・第一資料室": room("神社:夢幻遺跡・第一資料室", "夢幻遺跡・第一資料室", "P48", { indoor: true }),
  "神社:夢幻遺跡・研究室": room("神社:夢幻遺跡・研究室", "夢幻遺跡・研究室", "P49", { indoor: true }),
  "神社:夢幻遺跡・第二資料室": room("神社:夢幻遺跡・第二資料室", "夢幻遺跡・第二資料室", "P50", { indoor: true }),
  "神社:夢幻遺跡・倉庫": room("神社:夢幻遺跡・倉庫", "夢幻遺跡・倉庫", "P51", { indoor: true }),
} as const;

/** Get room properties for the master's current location, or null if
 *  not a known shrine room (e.g. major area like "人間之里"). */
export function getCurrentRoomProps(location: string): ShrineRoomProps | null {
  return SHRINE_ROOM_PROPS[location] ?? null;
}
