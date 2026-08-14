/**
 * UI review (2026-06-20) — unified room properties for command gating.
 *
 * `@COM_ABLE` gates frequently key off the current room's nature: indoor
 * (`INROOM`), bath (`BATHROOM`/`BATHCHECK`), private/rest room (休憩可),
 * training-capable (戦闘訓練可). The shrine's 13 rooms already had a prop
 * table (`shrine-rooms.ts`); this adds the 人間之里 44 rooms and exposes a
 * single `roomProps(location)` the factory's compiled gate uses.
 *
 * The village props are classified from the room name (faithful enough for
 * gating): 房間/私室/宅/宿屋 → indoor+private; 銭湯/浴場 → bath; 廁所 → indoor
 * (not private); 寺子屋/集会所/瞭望樓 → indoor (training for 寺子屋); shops →
 * indoor public; 街/広場/門/井 → outdoor public. Unknown rooms default to a
 * permissive "outdoor public" so a missing classification never *hides* a
 * command incorrectly (conservative: unknown ⇒ unrestricted, per the agreed
 * "village rooms tentatively unknown" stance, but with name-based best-effort).
 */

import { SHRINE_ROOM_PROPS, type ShrineRoomProps } from "./shrine-rooms.js";
import {
  hasLocationPlaceFlags,
  placeFlagsOf,
} from "../../world/location-predicates.js";
import {
  hasPlace,
  PLACE_BATH,
  PLACE_INDOOR,
  PLACE_PRIVATE,
  PLACE_REST,
  PLACE_TRAINING,
  PLACE_WESTERN,
} from "../../world/place-flags.js";

/** Minimal room-property shape the gate reads. Superset-compatible with
 *  `ShrineRoomProps` (which carries extra fields we ignore here). */
export interface RoomProps {
  indoor: boolean;
  bath: boolean;
  /** Private / rest room (自室・宿屋・私室) — 休憩/昼寝/膝枕 gating. */
  private: boolean;
  /** Training-capable place (神社境内/庭・寺子屋) — 戦闘訓練 gating. */
  training: boolean;
}

/** Classify a 人間之里 room by its name. Best-effort, faithful to the room's
 *  obvious nature. */
function classifyVillage(name: string): RoomProps {
  const has = (s: string) => name.includes(s);
  // P202 is explicitly marked 訓練 in ROOMSETTING_2 / PLACE flags. It is
  // outdoors, but still permits command 480's 弾幕勝負.
  if (name === "中央広場") {
    return { indoor: false, bath: false, private: false, training: true };
  }
  // Bath.
  if (has("銭湯") || has("浴場") || has("風呂")) {
    return { indoor: true, bath: true, private: has("貸切"), training: false };
  }
  // Private living spaces (rooms / residences / love hotel).
  if (has("房間") || has("私室") || has("宅") || has("宿屋") || has("邸")) {
    return { indoor: true, bath: false, private: true, training: false };
  }
  // Training / study.
  if (has("寺子屋")) {
    return { indoor: true, bath: false, private: false, training: true };
  }
  // Indoor public venues (shops / halls / toilet).
  if (
    has("店") || has("屋") || has("庵") || has("亭") || has("館") ||
    has("集会所") || has("瞭望樓") || has("警察署") || has("廁所")
  ) {
    return { indoor: true, bath: false, private: false, training: false };
  }
  // Streets / plaza / gate / well / shrine statue → outdoor public.
  return { indoor: false, bath: false, private: false, training: false };
}

/**
 * Classify a 命蓮寺 room by its name + P-number. Best-effort but faithful to
 * `ROOMSETTING_1.ERB`. Mapping:
 *   境内/後院/霊廟広場/道場 → training
 *   本堂/講堂/経蔵/土間/居間/走廊/廚房/風呂/私室群/庫房/墓地/梵鐘楼/
 *   霊廟大門/霊廟広場/廊下/枯山水/調薬室/湯殿/蔵/鐘楼/邪仙楼/
 *   別屋/地蔵小路 → other flags
 *   山門/地蔵小路 → outdoor
 */
const TEMPLE_ROOMS: Record<string, Partial<RoomProps>> = {
  "命蓮寺":       { indoor: false, training: false },
  "命蓮寺:境内":  { indoor: false, training: true },
  "命蓮寺:本堂":  { indoor: true },
  "命蓮寺:講堂":  { indoor: true },
  "命蓮寺:経蔵":  { indoor: true },
  "命蓮寺:後院":  { indoor: false, training: true },
  "命蓮寺:土間":  { indoor: true },
  "命蓮寺:居間":  { indoor: true, private: true },
  "命蓮寺:走廊":  { indoor: true, private: true },
  "命蓮寺:廚房":  { indoor: true },
  "命蓮寺:風呂":  { indoor: true, bath: true, private: true },
  "命蓮寺:梵鐘楼":{ indoor: false },
  "命蓮寺:墓地":  { indoor: false },
  "命蓮寺:庫房":  { indoor: true, private: true },
  "命蓮寺:別屋":  { indoor: true, private: true },
  "命蓮寺:女苑私室": { indoor: true, private: true },
  "命蓮寺:納茲琳私室": { indoor: true, private: true },
  "命蓮寺:村紗私室": { indoor: true, private: true },
  "命蓮寺:星私室": { indoor: true, private: true },
  "命蓮寺:一輪私室": { indoor: true, private: true },
  "命蓮寺:鵺私室": { indoor: true, private: true },
  "命蓮寺:白蓮私室": { indoor: true, private: true },
  "命蓮寺:響子私室": { indoor: true, private: true },
  "命蓮寺:山門":  { indoor: false },
  "命蓮寺:地蔵小路": { indoor: false },
  "命蓮寺:廊下(別館)": { indoor: true, private: true },
  "霊廟:霊廟大門": { indoor: false },
  "霊廟:霊廟広場": { indoor: false, training: true },
  "霊廟:道場":    { indoor: true, training: true },
  "霊廟:湯殿":    { indoor: true, bath: true },
  "霊廟:調薬室":  { indoor: true },
  "霊廟:枯山水":  { indoor: false },
  "霊廟:客間":    { indoor: true, private: true },
  "霊廟:神子私室": { indoor: true, private: true },
  "霊廟:布都私室": { indoor: true, private: true },
  "霊廟:屠自古私室": { indoor: true, private: true },
  "霊廟:蔵":      { indoor: true },
  "霊廟:邪仙楼":  { indoor: true },
  "霊廟:鐘楼":    { indoor: true },
  "霊廟:廊下":    { indoor: true },
};

/**
 * Classify a 命蓮寺 / 霊廟 room from its FULL location string. The explicit
 * TEMPLE_ROOMS table is authoritative; a name-based heuristic is the fallback
 * for rooms not in the table (e.g. rooms drawn on the map but not yet mapped).
 */
function classifyTemple(location: string): RoomProps {
  // Check explicit table first. TEMPLE_ROOMS is keyed by the FULL location
  // string ("命蓮寺:境内"), so it MUST be looked up with the full location —
  // passing only the room-name suffix ("境内") makes every entry dead code.
  const exact = TEMPLE_ROOMS[location];
  if (exact) {
    return {
      indoor: !!exact.indoor,
      bath: !!exact.bath,
      private: !!exact.private,
      training: !!exact.training,
    };
  }
  // Name heuristics (fallback for rooms not in the table above).
  const name = location.includes(":")
    ? location.slice(location.indexOf(":") + 1)
    : location;
  const has = (s: string) => name.includes(s);
  if (has("私室") || has("別屋")) {
    return { indoor: true, bath: false, private: true, training: false };
  }
  if (has("風呂") || has("湯殿")) {
    return { indoor: true, bath: true, private: true, training: false };
  }
  if (has("道場") || has("広場") || has("境内") || has("後院")) {
    return { indoor: has("道場"), bath: false, private: false, training: true };
  }
  if (has("境内")) {
    return { indoor: false, bath: false, private: false, training: true };
  }
  // Indoor rooms.
  if (
    has("室") || has("間") || has("堂") || has("蔵") || has("薬") ||
    has("楼") || has("寮") || has("厨房") || has("廚房") || has("台所")
  ) {
    return { indoor: true, bath: false, private: false, training: false };
  }
  // Outdoor public.
  return { indoor: false, bath: false, private: false, training: false };
}

/**
 * Classify a 紅魔館 / 廃洋館 / 霧之湖 room. Uses a combination of explicit
 * per-location props and name-based heuristics (faithful to ROOMSETTING_3.ERB):
 *   私室/被窝 → private
 *   風呂/大浴場 → bath
 *   庭/後院/湖畔 → training (outdoor)
 *   厨房/廚房 → indoor (kitchen for tea brewing)
 *   洋室/屋内 rooms → indoor
 */
const KOUMAKAN_EXPLICIT: Record<string, Partial<RoomProps>> = {
  // 紅魔館一階
  "紅魔館":       { indoor: false, training: false },
  "紅魔館:正門":   { indoor: false, training: false },
  "紅魔館:庭":     { indoor: false, training: true },
  "紅魔館:守衛小屋": { indoor: true, private: true },
  "紅魔館:空的小屋": { indoor: true, private: true },
  "紅魔館:仓库":   { indoor: true },
  "紅魔館:後院":   { indoor: false, training: true },
  "紅魔館:東陽台": { indoor: false },
  "紅魔館:西陽台": { indoor: false },
  "紅魔館:大廳":   { indoor: true },
  "紅魔館:図書館": { indoor: true },
  "紅魔館:帕秋莉私室": { indoor: true, private: true },
  "紅魔館:小悪魔私室": { indoor: true, private: true },
  "紅魔館:厨房":   { indoor: true },
  "紅魔館:食堂":   { indoor: true },
  "紅魔館:會客廳": { indoor: true },
  "紅魔館:一層廁所": { indoor: true, bath: false },
  // 地下
  "紅魔館:地下走廊": { indoor: true },
  "紅魔館:倉庫":   { indoor: true },
  "紅魔館:使用人部屋": { indoor: true, private: true },
  "紅魔館:地下室": { indoor: true, private: true },
  "紅魔館:脱衣所": { indoor: true, bath: true },
  "紅魔館:大浴場": { indoor: true, bath: true, private: true },
  // 紅魔館二階＆三階
  "紅魔館:二階廊下": { indoor: true },
  "紅魔館:咲夜私室": { indoor: true, private: true },
  "紅魔館:空的部屋": { indoor: true, private: true },
  "紅魔館:二層廁所": { indoor: true },
  "紅魔館:妖精女僕的值班室": { indoor: true },
  "紅魔館:大露台": { indoor: false },
  "紅魔館:蕾米莉亜私室": { indoor: true, private: true },
  "紅魔館:小露台": { indoor: false, private: true },
  // 廃洋館
  "廃洋館:廃洋館・入口": { indoor: false },
  "廃洋館:廃洋館・大廳": { indoor: true },
  "廃洋館:廃洋館・廚房": { indoor: true },
  "廃洋館:廃洋館・風呂": { indoor: true, bath: true, private: true },
  "廃洋館:廃洋館・二階廊下": { indoor: true },
  "廃洋館:露娜薩私室": { indoor: true, private: true },
  "廃洋館:梅露蘭私室": { indoor: true, private: true },
  "廃洋館:莉莉卡私室": { indoor: true, private: true },
  // 霧之湖
  "霧之湖:湖畔":   { indoor: false, training: true },
  "霧之湖:蕾蒂的冰屋": { indoor: true, private: true },
  "霧之湖:琪露諾的冰屋": { indoor: true, private: true },
  "霧之湖:大妖精の棲家": { indoor: true, private: true },
  "霧之湖:霧之湖": { indoor: false },
  "霧之湖:霧之湖・湖底": { indoor: false, private: true },
};

/**
 * Classify a 紅魔館 / 廃洋館 / 霧之湖 room from its FULL location string.
 * The explicit KOUMAKAN_EXPLICIT table is authoritative.
 */
function classifyKoumakan(location: string): RoomProps {
  const exact = KOUMAKAN_EXPLICIT[location];
  if (exact) {
    return {
      indoor: !!exact.indoor,
      bath: !!exact.bath,
      private: !!exact.private,
      training: !!exact.training,
    };
  }
  // Fallback: name heuristics.
  const name = location.includes(":")
    ? location.slice(location.indexOf(":") + 1)
    : location;
  const has = (s: string) => name.includes(s);
  if (has("私室") || has("冰屋")) {
    return { indoor: true, bath: false, private: true, training: false };
  }
  if (has("風呂") || has("浴場")) {
    return { indoor: true, bath: true, private: true, training: false };
  }
  if (has("庭") || has("後院") || has("湖畔")) {
    return { indoor: false, bath: false, private: false, training: true };
  }
  if (has("室") || has("間") || has("廊") || has("廳") || has("庫") || has("房")) {
    return { indoor: true, bath: false, private: false, training: false };
  }
  return { indoor: false, bath: false, private: false, training: false };
}

/** Resolve room props for any location string. Registered ROOMSETTING flags
 * are authoritative (including explicit zero-bit rooms); legacy tables and
 * name classifiers are used only for genuinely unmapped locations. */
export function roomProps(location: string): RoomProps {
  // The complete map bundle (including generated maps 5-10) carries the
  // upstream ROOMSETTING bitset. Prefer it over the legacy tables/heuristics:
  // a futon expands to PLACE_REST, which is exactly the `休憩可` semantic used
  // by COM403, while bath/training/indoor remain explicit room properties.
  const flags = placeFlagsOf(location);
  if (hasLocationPlaceFlags(location)) {
    return {
      indoor: hasPlace(flags, PLACE_INDOOR) || hasPlace(flags, PLACE_WESTERN),
      bath: hasPlace(flags, PLACE_BATH),
      private: hasPlace(flags, PLACE_PRIVATE) || hasPlace(flags, PLACE_REST),
      training: hasPlace(flags, PLACE_TRAINING),
    };
  }
  const shrine = SHRINE_ROOM_PROPS[location] as ShrineRoomProps | undefined;
  if (shrine) {
    return {
      indoor: shrine.indoor,
      bath: shrine.bath,
      private: shrine.private,
      training: shrine.training,
    };
  }
  if (location === "人間之里" || location.startsWith("人間之里:")) {
    // Strip the "人間之里:" / "人間之里" prefix to the room name.
    const name = location.includes(":") ? location.slice(location.indexOf(":") + 1) : "人里的門";
    return classifyVillage(name);
  }
  if (location === "自宅" || location.startsWith("自宅")) {
    return { indoor: true, bath: false, private: true, training: false };
  }
  // 命蓮寺 / 霊廟. classifyTemple keys its explicit table by the FULL
  // location string, so pass the whole location (not the suffix).
  if (location === "命蓮寺" || location.startsWith("命蓮寺:") || location.startsWith("霊廟:")) {
    return classifyTemple(location);
  }
  // 紅魔館 / 廃洋館 / 霧之湖. classifyKoumakan keys by FULL location.
  if (location === "紅魔館" || location.startsWith("紅魔館:") || location.startsWith("廃洋館:") || location.startsWith("霧之湖:")) {
    return classifyKoumakan(location);
  }
  // Truly unknown → permissive outdoor public.
  return { indoor: false, bath: false, private: false, training: false };
}
