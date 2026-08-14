/**
 * Numeric eraTW room ids used by the currently bundled characters' CSV
 * `CFLAG:初期位置`, adapted to the modern runtime's string room keys.
 *
 * This table translates identifiers only. It does not assign activities or
 * infer routes. Missing ids deliberately resolve to null so an unimplemented
 * map remains off-schedule instead of receiving a fabricated destination.
 */
import { CFLAG_ID } from "../state/settlement.js";
import { buildCharaSlot, type CharaStatsLike } from "../state/load-chara.js";
import type { GameState } from "../state/game-state.js";
import { GENERATED_ROOM_ID_TO_LOCATION } from "./generated-room-locations.js";

const CONFIGURED_ROOM_LOCATIONS: Readonly<Record<number, string>> = {
  // mapId 0 - 博丽神社区域
  6: "神社:庫房",
  15: "神社:霊夢私室",
  17: "神社:小的倉庫",
  18: "神社:壁櫥間",
  19: "神社:大的倉庫",
  32: "神社:桑尼私室",
  33: "神社:露娜私室",
  34: "神社:斯塔私室",
  43: "神社:夢美私室",
  44: "神社:千百合私室",
  52: "神社:別屋",
  54: "神社:小人的虫籠",
  55: "神社:和室",
  56: "神社:阿吽の棲家",
  69: "神社:先代巫女的小屋",

  // mapId 1 - 命蓮寺（含霊廟前缀）— Phase 7 map-populate batch
  109: "命蓮寺:女苑私室",
  113: "命蓮寺:納茲琳私室",
  114: "命蓮寺:村紗私室",
  115: "命蓮寺:星私室",
  116: "命蓮寺:一輪私室",
  117: "命蓮寺:鵺私室",
  118: "命蓮寺:白蓮私室",
  120: "命蓮寺:庫房",
  125: "霊廟:屠自古私室",
  127: "霊廟:布都私室",
  128: "霊廟:神子私室",
  136: "命蓮寺:響子私室",
  137: "命蓮寺:猯藏の棲家",
  139: "霊廟:邪仙楼",

  // mapId 3 - 霧之湖～紅魔館（含霧之湖/廃洋館前缀）— Phase 7 map-populate batch
  303: "紅魔館:守衛小屋",
  311: "紅魔館:帕秋莉私室",
  312: "紅魔館:小悪魔私室",
  320: "紅魔館:咲夜私室",
  326: "紅魔館:蕾米莉亜私室",
  331: "紅魔館:地下室",
  340: "廃洋館:露娜薩私室",
  341: "廃洋館:梅露蘭私室",
  342: "廃洋館:莉莉卡私室",
  344: "霧之湖:蕾蒂的冰屋",
  345: "霧之湖:琪露諾的冰屋",
  346: "霧之湖:大妖精の棲家",
  348: "霧之湖:霧之湖・湖底",

  // mapId 2 - 人间之里
  208: "人間之里:雷鼓的房間",
  209: "人間之里:八橋的房間",
  210: "人間之里:弁弁的房間",
  224: "人間之里:慧音宅",
  226: "人間之里:小鈴私室",
  229: "人間之里:阿求私室",
  231: "人間之里:蛮奇的房間",
  232: "人間之里:蓮子的房間",
  233: "人間之里:梅莉的房間",
  239: "人間之里:美宵的房間",
  242: "人間之里:麟的房间",
  281: "人間之里:小兎姫私室",

  // mapId 4 - 竹林（永遠亭/夢幻館/迷途竹林 前缀）— Phase 7 map-populate P2
  410: "永遠亭:帝私室",
  411: "永遠亭:鈴仙私室",
  413: "永遠亭:永琳私室",
  414: "永遠亭:輝夜私室",
  432: "迷途竹林:影狼的家",
  437: "迷途竹林:梅蒂欣的家",
  439: "迷途竹林:拉尔瓦的家",
  443: "迷途竹林:米斯蒂亜的家",
  445: "迷途竹林:妹紅的家",
  451: "夢幻館:胡桃私室",
  452: "夢幻館:艾麗私室",
  457: "夢幻館:夢月私室",
  459: "夢幻館:幻月私室",
  463: "夢幻館:幽香私室",

  // Bundled off-map characters. Their maps are not playable yet; retaining
  // the configured home key keeps sleep/wake state truthful and invisible.
  633: "迷家:紫私室",
  817: "守矢神社:神奈子私室",
  818: "守矢神社:諏訪子私室",
  820: "守矢神社:早苗私室",
};

export function resolveConfiguredRoomLocation(roomId: number): string | null {
  return GENERATED_ROOM_ID_TO_LOCATION[roomId] ?? CONFIGURED_ROOM_LOCATIONS[roomId] ?? null;
}

/** location → id, the inverse of CONFIGURED_ROOM_LOCATIONS. Used by the
 *  room-id-location bridge so `setSlotLocation` can keep CFLAG[300] in sync
 *  when a chara moves into a configured home room. */
export const CONFIGURED_ROOM_LOCATIONS_REVERSE: Readonly<Record<string, number>> =
  Object.freeze(
    Object.entries(CONFIGURED_ROOM_LOCATIONS).reduce<Record<string, number>>(
      (acc, [id, loc]) => {
        acc[loc] = Number(id);
        return acc;
      },
      {},
    ),
  );

export function resolveConfiguredHomeLocation(
  cflag: Readonly<Record<number, number>>,
): string | null {
  const roomId = cflag[CFLAG_ID.初期位置];
  return typeof roomId === "number"
    ? resolveConfiguredRoomLocation(roomId)
    : null;
}

/** Browser-safe adapter: consume imported source stats inside runtime and
 * expose a fully positioned slot to the UI layer. */
export function buildConfiguredCharaSlot(stats: CharaStatsLike) {
  const home = resolveConfiguredHomeLocation(stats.CFLAG);
  if (!home) {
    throw new Error(`No runtime room mapping for chara ${stats.id}'s configured initial position`);
  }
  return buildCharaSlot(stats, home, home);
}

/** Backfill the resolved home key on saves written before it was persisted. */
export function hydrateConfiguredCharaHomes(state: GameState): void {
  for (const slot of Object.values(state.charas)) {
    if (slot.homeLocation) continue;
    const home = resolveConfiguredHomeLocation(slot.state.CFLAG);
    if (home) slot.homeLocation = home;
  }
}

export const CONFIGURED_ROOM_IDS = Object.freeze(
  Object.keys(CONFIGURED_ROOM_LOCATIONS).map(Number),
);
