/**
 * `@LOOK_AT` → `@ANOTHERTARGET_TALK` / `@情景描写` — the dynamic "current
 * scene" prose layer (Look.ERB:1 → ANOTHER_TALK.ERB:8 / :1009).
 *
 * When the player looks at a scene, eraTW prints a position/state prose line
 * that changes with time, presence and character state. Two sources feed it:
 *   1. `MAP_UNIQUEMESSAGE_{MAIN_MAP}` — per-map position prose (the fallback
 *      arm of `@ANOTHERTARGET_TALK`, ANOTHER_TALK.ERB:56);
 *   2. the low-dependency `MESSAGE_TALK` arms of `@情景描写` (落穴/钱汤/雪雕,
 *      映姬裁判 / 广场有人工作).
 *
 * This stays a *separate* layer from the static `SceneAsset.intro`: intro is
 * the authored "you walk in" text, `ambientProse` is the live "what is
 * happening right now" text. It never fakes behavior — branches whose
 * dependencies are not modeled are skipped, never invented.
 *
 * Deferred (documented): 时停 stationary prose for 寺子屋 (user decision —
 * leave empty); 西行妖 button; 07 山麓
 * P703 玄武之澤 (requires TALENT:形状==4 + weekday 2 + 时段 5-7);
 * 02 北大街 胡渣男 RAND:50 arm; 诶嘿嘿 公然干坏事 arms.
 */
import type { BanquetEventInstance, BanquetPhase, CharaSlot, GameState } from "../state/game-state.js";
import { CFLAG_ID, FLAG_ID } from "../state/settlement.js";
import { bodyFillRate } from "../state/body-fill-rate.js";
import { getWeatherState } from "../state/weather-state.js";
import { skySceneTextFromStateAtLocation, weatherIndexNow } from "../state/weather.js";
import { COMMON_REGION, WEATHER_ID } from "../weather/constants.js";
import { mapIdOfLocation, outRoof } from "./location-predicates.js";
import { roomIdToLocation } from "./room-id-location.js";
import { SHRINE_ADJACENCY } from "./work/shrine-graph.js";
import { pitfallSceneLines, sentoSceneLines, snowSceneLines } from "./free-activity-events.js";

const TERAKOYA = "人間之里:寺子屋";
const KEINE = 67;
const RIN = 160;
const EIKI = 30;
const PARUSEE = 60;

function minuteOfDay(tick: number): number {
  return ((tick % 1440) + 1440) % 1440;
}

function isTimeStopped(state: GameState): boolean {
  return (state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0;
}

function isWorking(slot: CharaSlot): boolean {
  return (slot.state.CFLAG[CFLAG_ID.行动] ?? 0) === 5;
}

function presentCharas(present: readonly CharaSlot[], num: number): CharaSlot | undefined {
  return present.find((s) => s.charaNum === num);
}

type SceneBanquetPhase = Extract<BanquetPhase, "scheduled" | "preparing" | "active" | "cleanup" | "closing">;
type SceneBanquet = Pick<BanquetEventInstance, "venue" | "scheduledStartTick" | "participants" | "initialScale"> & {
  phase: SceneBanquetPhase;
};

function isSceneBanquetPhase(phase: BanquetPhase): phase is SceneBanquetPhase {
  return phase === "scheduled"
    || phase === "preparing"
    || phase === "active"
    || phase === "cleanup"
    || phase === "closing";
}

function placeLabel(location: string): string {
  const separator = location.indexOf(":");
  return separator >= 0 ? location.slice(separator + 1) : location;
}

/**
 * Upstream uses `CAN_MOVE(... ) >= 2` for banquet visibility. Exact venue and
 * the currently modelled shrine adjacency are the available deterministic
 * equivalents; unknown map graphs fail closed instead of showing a global
 * banquet line in every scene.
 */
function banquetIsNear(location: string, venue: string): boolean {
  if (location === venue) return true;
  return (SHRINE_ADJACENCY[location] ?? []).includes(venue)
    || (SHRINE_ADJACENCY[venue] ?? []).includes(location);
}

/** Resolve the authoritative world event, retaining mirror-only save support. */
function sceneBanquet(state: Readonly<GameState>): SceneBanquet | null {
  const tick = state.time.tickValue;
  const event = (state.worldEvents ?? []).find(
    (candidate): candidate is BanquetEventInstance & { phase: SceneBanquetPhase } =>
      candidate.kind === "banquet"
      && isSceneBanquetPhase(candidate.phase)
      && tick >= candidate.scheduledStartTick,
  );
  if (event) {
    return {
      venue: event.venue,
      scheduledStartTick: event.scheduledStartTick,
      phase: event.phase,
      participants: event.participants,
      initialScale: event.initialScale,
    };
  }

  // Older saves may have only the upstream mirror fields. FLAG 30 is the
  // banquet template id, not a boolean; require a real venue before using it.
  const templateId = state.flagStore[FLAG_ID.宴会開催フラグ] ?? 0;
  const venueId = state.flagStore[FLAG_ID.宴会会場] ?? 0;
  const venue = roomIdToLocation(venueId);
  if (!templateId || !venue) return null;
  const scheduledStartTick = (state.flagStore[FLAG_ID.宴会开始日] ?? 0) * 1440
    + (state.flagStore[FLAG_ID.宴会会場開始時刻] ?? 0);
  if (tick < scheduledStartTick) return null;
  return {
    venue,
    scheduledStartTick,
    phase: "active",
    participants: Array.from({ length: Math.max(0, state.flagStore[FLAG_ID.宴会参加者数] ?? 0) }, () => 0),
    initialScale: state.flagStore[FLAG_ID.宴会规模] ?? 0,
  };
}

function banquetLines(state: Readonly<GameState>, location: string): string[] {
  const banquet = sceneBanquet(state);
  if (!banquet || !banquetIsNear(location, banquet.venue)) return [];

  const attendees = banquet.participants.length;
  const venue = placeLabel(banquet.venue);
  if (attendees <= 0) {
    return ["盛席华筵终散场、一枕梦黄粱", `${venue}因为宴会变得一片狼藉……`];
  }

  const lines = [
    banquet.initialScale <= 1500 || attendees <= 3
      ? `大约有${attendees}人正在参加在${venue}举行的小型宴会……`
      : `大约有${attendees}人正在参加在${venue}举行的宴会……`,
  ];
  const elapsed = Math.max(0, state.time.tickValue - banquet.scheduledStartTick);
  if (elapsed >= 240) {
    lines.push(attendees <= 3 ? "看样子已经只剩下某些猛士了……" : "看起来正有零零散散的人离去……");
  } else if (elapsed >= 180) {
    lines.push("看起来喝得酒意正浓的样子……");
  } else if (elapsed >= 60) {
    lines.push("欢声笑语不绝于耳、看起来非常热闹……");
  } else {
    lines.push("看起来相当热闹的样子……");
  }
  return lines;
}

/** 充填率 tiers (>=100/50/25/10; 映姫 also uses >=75/35/20/5). -1 = no tier. */
function fillTier(fill: number | null, thresholds: readonly number[]): number {
  if (fill === null) return -1;
  for (let i = 0; i < thresholds.length; i += 1) {
    if (fill >= thresholds[i]!) return thresholds.length - i;
  }
  return -1;
}

/** 静态位置散文 (MAP_UNIQUEMESSAGE_N — no runtime conditions). */
const STATIC_PROSE: Readonly<Record<string, string>> = {
  "命蓮寺:講堂": "放置着大木鱼",
  "霊廟:客間": "放置着木刻的熊",
  "命蓮寺:走廊": "房檐上挂着萝卜",
  "人間之里:鈴奈庵": "店内排列着很多书架",
  "人間之里:警察署": "有一扇通往地下室的门，上面写着「极度危险的罪犯专用」的牌子…",
  "魔法之森:香霖堂": "杂乱的商品挤满了狭小的空间\n「非卖品」的标签特别多……",
  "魔法之森:岔道": "看见了魔理沙家的后门和水井",
  "人偶的洋馆:人偶洋館・研究室": "书架上摆放着药瓶和人偶",
  "彼岸:彼岸": "三途川的渡船频繁地来往着",
  "是非曲直厅:是非曲直庁大堂": "这里是是非曲直厅的大厅\n建造得很气派，但很有年代感，总感觉像是没钱的样子",
  "旧都:街道": "听到了繁华街的喧闹声　在那对面能看到地灵殿",
  "旧都:橋": "听到了繁华街的喧闹声　在那对面能看到地灵殿",
  "地灵殿": "在道路的一头看见了小小的地藏",
};

/** 寺子屋授课/午休的充填率档句 (MAP_UNIQUEMESSAGE_2 P222, 非时停). */
function terakoyaFillLines(
  slot: CharaSlot | undefined,
  phase: "class" | "lunch",
  role: "讲课" | "诊疗",
): string[] {
  if (!slot) return [];
  const fill = bodyFillRate(slot.state, 3);
  const name = slot.callName ?? `#${slot.charaNum}`;
  const tier = fillTier(fill, [100, 50, 25, 10]);
  if (tier < 0) return [];
  if (phase === "class") {
    switch (tier) {
      case 4:
        return role === "诊疗"
          ? ["一些去过医务室的孩子们发觉今天的医生和平时不太一样", `正被无数精子刺激着的${name}诊疗时的声音娇媚…走路晃晃悠悠…`]
          : ["寺子屋的孩子们发觉今天的老师和平时不太一样，许多孩子正在交头接耳", `正被无数精子刺激着的${name}讲课的声音娇媚…走路晃晃悠悠…`];
      case 3:
        return role === "诊疗"
          ? [`腹内满满都是精液的${name}娇喘着进行着诊疗工作…`, "寺子屋的孩子们似乎察觉到了什么…"]
          : [`腹内满满都是精液的${name}娇喘着讲课…`, "寺子屋的孩子们似乎察觉到了什么…"];
      case 2:
        return role === "诊疗"
          ? [`腹内大量精液晃动着的${name}声音发颤地进行着诊疗工作…`, "寺子屋的孩子们似乎有些不明所以…"]
          : [`腹内大量精液晃动着的${name}声音发颤的讲课…`, "寺子屋的孩子们似乎有些不明所以…"];
      default:
        return role === "诊疗"
          ? [`腹内存了许多精液的${name}像平常一样的在给寺子屋的孩子们诊疗…`]
          : [`腹内存了许多精液的${name}面无表情的在给寺子屋的孩子们讲课…`];
    }
  }
  switch (tier) {
    case 4:
      return [`吃饭时间，平时陪寺子屋的孩子们吃饭的${name}体内正在被无数精子横冲直撞…`, `为了不让孩子们发现异常，${name}只能谎称自己不饿，捂嘴趴在桌上轻声呻吟…`];
    case 3:
      return [`腹内满满都是精液的${name}连拿餐具的手都在颤抖着…`, `孩子们询问老师是否身体不适，被${name}娇喘着否认了…`];
    case 2:
      return [`腹内晃动着大量精液的${name}和寺子屋的孩子们一起吃饭…`, `${name}吃饭的动作明显比平时慢了许多…`];
    default:
      return [`寺子屋的孩子们在和腹内存了许多精液的${name}一起吃饭…`];
  }
}

/** 映姫裁判 (MESSAGE_TALK 15, ANOTHER_TALK.ERB:886-929) — 简化 TEXTR 随机. */
function eikiJudgementLines(slot: CharaSlot): string[] {
  const fill = bodyFillRate(slot.state, 3);
  const name = slot.callName ?? `#${slot.charaNum}`;
  const tier = fillTier(fill, [75, 50, 35, 20, 5]);
  switch (tier) {
    case 5:
      return ["死者的灵魂们发觉面前的阎王和听说的不太一样，许多死者的灵魂交头接耳中", `正被无数精子刺激着的${name}坚持着审判…`];
    case 4:
      return [`腹内满满都是精液的${name}断断续续的审判…`, "死者的灵魂们察觉到了什么…"];
    case 3:
      return [`腹内大量精液晃动着的${name}面颊潮红地主持着审判…`, "死者的灵魂们似乎有些不明所以…"];
    case 2:
      return [`腹内存了许多精液的${name}继续着审判…`];
    case 1:
      return [`${name}的下面里面已经完全湿透了、但审判仍然在继续着…`];
    default:
      return [`${name}审判中…`];
  }
}

/** `@LOOK_AT` 场景散文 — 当前位置/状态的动态叙述, 多行 `\n` 分隔或 null. */
export function lookSceneProse(
  state: Readonly<GameState>,
  present: readonly CharaSlot[],
  location: string,
): string | null {
  const lines: string[] = [];

  // MESSAGE_TALK(17/18/19) is the live activity layer. It must be evaluated
  // before the generic scene fallbacks so a newly-arrived player can actually
  // see the result of the activity they walked into.
  lines.push(...pitfallSceneLines(state, location));
  lines.push(...sentoSceneLines(state, location));
  lines.push(...snowSceneLines(state, location));

  // MESSAGE_TALK(1) has priority over map prose and work-site arms. This is
  // also important for the current banquet's scene identity: do not append a
  // distant/static room description to it.
  const nearbyBanquet = banquetLines(state, location);
  if (nearbyBanquet.length > 0) return [...lines, ...nearbyBanquet].join("\n");

  // -- MAP_UNIQUEMESSAGE: 静态位置散文 --
  const stat = STATIC_PROSE[location];
  if (stat) lines.push(stat);

  // -- 河童索道 (02 北大街 / 08 山頂 索道站): 时段 540-1020 --
  if (location === "人間之里:北大街" || location === "妖怪之山・山顶:索道站") {
    const min = minuteOfDay(state.time.tickValue);
    lines.push(min >= 540 && min <= 1020 ? "能看到充满干劲的河童在接待索道的业务" : "索道站关门了");
  }

  // -- 广场方向嘈杂 (02 P203 南大街 TO P206 西大街, 非时停) --
  if ((location === "人間之里:南大街" || location === "人間之里:西大街") && !isTimeStopped(state)) {
    lines.push("广场的方向很嘈杂");
  }

  // -- 紅魔館 倉庫 (03 P329, 非时停才见猫咪) --
  if (location === "紅魔館:倉庫" && !isTimeStopped(state)) {
    lines.push("这里有猫咪");
  }

  // -- 帕露西在桥上监视 (09 地底, 旧都街道/橋/縦穴 区域) --
  const parusee = presentCharas(present, PARUSEE);
  if (
    (location === "旧都:街道" || location === "旧都:橋" || location === "地灵殿") &&
    parusee &&
    isWorking(parusee)
  ) {
    lines.push("帕露西在桥上监视着通行者");
  }

  // -- 寺子屋 充填率 (02 P222, 非时停; 时停描写 defer 留空) --
  if (location === TERAKOYA && !isTimeStopped(state)) {
    const min = minuteOfDay(state.time.tickValue);
    const inClass = (min >= 480 && min <= 720) || min >= 780;
    const lunch = min >= 720 && min <= 780;
    if (inClass) {
      lines.push("寺子屋的孩子们在上课…");
      lines.push(...terakoyaFillLines(presentCharas(present, KEINE), "class", "讲课"));
      lines.push(...terakoyaFillLines(presentCharas(present, RIN), "class", "诊疗"));
    } else if (lunch) {
      lines.push("现在是寺子屋的午休时间，孩子们在吃饭……");
      lines.push(...terakoyaFillLines(presentCharas(present, KEINE), "lunch", "讲课"));
      lines.push(...terakoyaFillLines(presentCharas(present, RIN), "lunch", "诊疗"));
    }
  }

  // -- 映姫裁判 (MESSAGE_TALK 15): 法廷 中 映姫工作 + 时段 540-719 --
  const eiki = presentCharas(present, EIKI);
  if (eiki && isWorking(eiki) && location.startsWith("是非曲直厅")) {
    const min = minuteOfDay(state.time.tickValue);
    if (min >= 540 && min < 720) lines.push(...eikiJudgementLines(eiki));
  }

  // -- 广场有人工作 (MESSAGE_TALK 7): 中央広場 有人工作 --
  if (location === "人間之里:中央広場") {
    const worker = present.find((s) => s.charaNum !== 0 && isWorking(s));
    if (worker) lines.push(`${worker.callName ?? `#${worker.charaNum}`}的周围站满了人群`);
  }

  // -- 天气 (MESSAGE_TALK 4, ANOTHER_TALK.ERB:60-61): 户外 + 无其他位置散文 +
  //    天气可见（非 少云/多云/阴/细雪）→ 天空/雨雪描写 fallback. --
  if (
    lines.length === 0 &&
    outRoof(state as GameState, location) === 1 &&
    weatherIsVisible(state, location)
  ) {
    lines.push(skySceneTextFromStateAtLocation(state as GameState, location));
  }

  return lines.length > 0 ? lines.join("\n") : null;
}

/** 可见天气 = 非 少云/多云/阴/细雪 (upstream GROUPMATCH filter, ERB 60). */
function weatherIsVisible(state: Readonly<GameState>, location: string): boolean {
  const w = getWeatherState(state as GameState);
  const regionId = mapIdOfLocation(location);
  const weather =
    (regionId !== null ? w.gensokyoWeatherSystem[regionId] : undefined) ??
    w.gensokyoWeatherSystem[COMMON_REGION] ??
    weatherIndexNow(state.time);
  switch (weather) {
    case WEATHER_ID.少云:
    case WEATHER_ID.多云:
    case WEATHER_ID.阴:
    case WEATHER_ID.细雪:
      return false;
    default:
      return true;
  }
}
