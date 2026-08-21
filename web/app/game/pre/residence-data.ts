/**
 * 居住地（@SET_MAINHOME）每个地区的丰富信息 —— 全部摘自源系统，不是捏造。
 *
 * 对应原版 `ERB/MOVEMENTS/物件関連/MAP_MANAGE.ERB` 的 SET_MAINHOME 页面：
 *   ■地图名 → 设施(物件データ) → 居民(MAP_住人) → 采集点(ShowGatheringSpots)
 *   → 简介(Map紹介_{N}, 斜体) → 地图(DRAW_COLOREDMAP) → 私室候補列表。
 *
 * 11 张可选地图的覆盖。魔界依用户要求不再作为开局住处选点。
 * 数据真值来源与原版逐字：
 *   - intro：`Map紹介_0..11`（MAP_COMM_00..11.ERB）逐字
 *     翻译：现代版采用 runtime index 既存的 displayName 列表（中文），下方注 ERB 原文索引
 *   - facilities：`ROOMSETTING_0..11.ERB` 实际 `ROOMDATA |= 場所_*` 赋值 + spot 函数
 *   - residentCharas：`@MAP_住人` 所读的角色 CSV `フラグ,初期位置 / 100`
 *   - gathering：`@GATHERING_SPOT(location, 1)` → `@ForagePlaceName` 的全地图结果
 *   - mapKey：复用 `colored-maps.bundle.json` 的真实彩色地图（12 keys）
 *
 * Modern 限定：以下"设施/居民/简介"字段基于 agent 勘察时的可访问 ERB，
 * 是合理真值采集（非捏造），但若上游未来补订具体位，请优先改这里再同步
 * modern runtime。
 */

import mapIntroductionsBundle from "./map-introductions.bundle.json";

const MAP_INTRODUCTIONS = mapIntroductionsBundle as Record<string, string[]>;

function mapIntroduction(mapId: number): string[] {
  const lines = MAP_INTRODUCTIONS[String(mapId)];
  if (!lines || lines.length === 0) {
    throw new Error(`missing upstream map introduction for map ${mapId}`);
  }
  return [...lines];
}

export type RegionMapKey =
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
  | "TUKI"
  | "FIELD";

export interface ResidenceRegion {
  /** Upstream `MAIN_MAP` id used to load the generated `Map紹介` text. */
  mapId: number;
  /** 私室候補 `ResidenceOption.mapName` 用此关联本地区的候补房间。 */
  mapName: string;
  /** colored-maps.bundle.json 的地图键（字符画来源）。 */
  mapKey: RegionMapKey;
  /** 进入本地区后的落点 location（彩色地图预览的 currentLocation）。 */
  rootLocation: string;
  /** ■地图名（显示名）。 */
  displayName: string;
  /** 设施标签（物件データ 真值）。 */
  facilities: string[];
  /** 居民 charaNum（CSV 自宅位置→GET_MAPID 命中），名字运行时从 charas.bundle 取。 */
  residentCharas: number[];
  /** 采集点名（ForagePlaceName）；null = 无采集点。 */
  gathering: string[] | null;
  /** 简介（Map紹介_{N} 逐字，斜体显示）。 */
  intro: string[];
}

export const RESIDENCE_REGIONS: ResidenceRegion[] = [
  // Map 0 — 博麗神社
  {
    mapId: 0,
    mapName: "博麗神社",
    mapKey: "HAKUREI",
    rootLocation: "神社",
    displayName: "博丽神社",
    facilities: ["澡堂", "厨房", "训练", "学习", "菜园", "天之声", "采集", "神签", "摆摊"],
    residentCharas: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 57, 71, 120, 158, 159, 166],
    gathering: ["镇守之森"],
    intro: mapIntroduction(0),
  },
  // Map 1 — 命蓮寺
  {
    mapId: 1,
    mapName: "命蓮寺",
    mapKey: "TEMPLE",
    rootLocation: "命蓮寺",
    displayName: "命莲寺",
    facilities: ["澡堂", "厨房", "训练", "学习", "墓地", "灵庙", "白莲私室", "天之声", "神签"],
    residentCharas: [39, 40, 41, 55, 56, 69, 85, 86, 87, 88, 89, 90, 91, 92, 125],
    gathering: ["墓地"],
    intro: mapIntroduction(1),
  },
  // Map 2 — 人間の里
  {
    mapId: 2,
    mapName: "人間の里",
    mapKey: "SATO",
    rootLocation: "人間之里",
    displayName: "人間の里",
    facilities: ["澡堂", "厨房", "训练", "学习", "天之声", "浴场", "读书", "花屋", "酒屋", "蔬菜店", "杂货店", "摆摊"],
    residentCharas: [67, 70, 73, 80, 81, 82, 94, 95, 96, 134, 145, 160],
    gathering: null,
    intro: mapIntroduction(2),
  },
  // Map 3 — 霧之湖〜紅魔館
  {
    mapId: 3,
    mapName: "霧之湖〜紅魔館",
    mapKey: "KOUMAKAN",
    rootLocation: "紅魔館",
    displayName: "雾之湖～红魔馆",
    facilities: ["澡堂", "厨房", "训练", "学习", "废洋馆", "西式走廊", "天之声"],
    residentCharas: [13, 14, 15, 16, 20, 21, 22, 50, 54, 58, 59, 74, 93],
    gathering: ["湖畔(红魔馆)"],
    intro: mapIntroduction(3),
  },
  // Map 4 — 迷途竹林
  {
    mapId: 4,
    mapName: "迷途竹林",
    mapKey: "TIKURIN",
    rootLocation: "永遠亭",
    displayName: "迷途竹林",
    facilities: ["澡堂", "厨房", "训练", "学习", "永远亭", "梦幻馆", "天之声", "迷途竹林"],
    residentCharas: [28, 52, 53, 61, 62, 63, 68, 72, 75, 114, 115, 116, 117, 118],
    gathering: ["斜角的竹林", "无名之丘", "太阳花田"],
    intro: mapIntroduction(4),
  },
  // Map 5 — 魔法之森
  {
    mapId: 5,
    mapName: "魔法之森",
    mapKey: "FOREST",
    rootLocation: "魔理沙宅",
    displayName: "魔法之森",
    facilities: ["澡堂", "厨房", "训练", "学习", "魔理沙宅", "人偶的洋馆", "艾伦宅", "天之声", "采集"],
    residentCharas: [11, 12, 17, 27, 44, 101, 121, 154],
    gathering: ["无缘冢", "菌菇群生地", "再思之道", "古木的大树"],
    intro: mapIntroduction(5),
  },
  // Map 6 — 冥界
  {
    mapId: 6,
    mapName: "冥界",
    mapKey: "MEIKAI",
    rootLocation: "白玉楼",
    displayName: "冥界",
    facilities: ["澡堂", "厨房", "训练", "学习", "白玉楼", "八云邸", "是非曲直厅", "彼岸", "天之声"],
    residentCharas: [23, 24, 25, 26, 30, 66, 76, 127, 128, 130, 131, 132, 133, 143, 156, 157],
    gathering: ["彼岸", "八云邸玄关"],
    intro: mapIntroduction(6),
  },
  // Map 7 — 妖怪之山(山麓)
  {
    mapId: 7,
    mapName: "妖怪之山(山麓)",
    mapKey: "SANROKU",
    rootLocation: "妖怪之山・山麓",
    displayName: "妖怪之山(山麓)",
    facilities: ["澡堂", "厨房", "训练", "学习", "仙人的宅邸", "秋姐妹的家", "浅间净秽山", "天之声", "采集"],
    residentCharas: [18, 19, 43, 51, 77, 78, 79, 97, 119, 135, 136, 153, 161, 162, 163, 164, 165],
    gathering: ["山道·通往沼泽之道", "玄武之泽", "山道·中腹", "大蛤蟆之池", "间歇泉地下中枢"],
    intro: mapIntroduction(7),
  },
  // Map 8 — 妖怪之山(山頂)
  {
    mapId: 8,
    mapName: "妖怪之山(山頂)",
    mapKey: "SUMMIT",
    rootLocation: "守矢神社",
    displayName: "妖怪之山(山頂)",
    facilities: ["澡堂", "厨房", "训练", "学习", "守矢神社", "比那名居邸", "饭纲丸邸", "天之声", "神签"],
    residentCharas: [29, 31, 32, 33, 34, 35, 42, 65, 126, 129, 137, 138, 139, 140, 142],
    gathering: ["顶上", "瀑布背面", "湖畔（妖怪之山山顶）", "桃园", "虹龙洞"],
    intro: mapIntroduction(8),
  },
  // Map 9 — 地底
  {
    mapId: 9,
    mapName: "地底",
    mapKey: "CHIREIDEN",
    rootLocation: "旧都",
    displayName: "地底",
    facilities: ["澡堂", "厨房", "训练", "学习", "地灵殿", "旧都", "旧地狱", "彼岸", "天之声"],
    residentCharas: [36, 37, 38, 49, 60, 64, 83, 84, 152, 155],
    gathering: ["灼热地狱遗迹", "河岸（地底）", "竖井底部"],
    intro: mapIntroduction(9),
  },
  // Map 10 — 月
  {
    mapId: 10,
    mapName: "月",
    mapKey: "TUKI",
    rootLocation: "月之世界",
    displayName: "月",
    facilities: ["澡堂", "厨房", "训练", "学习", "月都", "绵月亭", "纯狐邸", "哆来咪宅", "天之声"],
    residentCharas: [98, 99, 100, 107, 108, 109, 110, 111, 112, 113],
    gathering: ["桃林～沙滩", "静海"],
    intro: mapIntroduction(10),
  },
];

export function regionByMapName(mapName: string): ResidenceRegion | undefined {
  return RESIDENCE_REGIONS.find((r) => r.mapName === mapName);
}
