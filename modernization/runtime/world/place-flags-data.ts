/**
 * Phase 7.1a — per-location `ROOMDATA` bitset, transcribed faithfully from
 * eraTW `ROOMSETTING_{mapId}.ERB` (raw bits, BEFORE the `MAP_MANAGE.ERB`
 * auto-derivation). `expandPlaceFlags` is applied at read time.
 *
 * Source of truth:
 *   - hand-audited entries below for the original migration slice
 *   - `generated-place-flags.ts` for maps 5-10, generated from the matching
 *     upstream `ROOMSETTING_<mapId>.ERB` files
 *
 * Each entry's key is the canonical location STRING used by
 * `GameState.master.location` / `CharaSlot.location` and by the scene
 * assets under `modernization/scenes/`. Truly missing locations have NO entry
 * and are treated as raw 0 (no place flags).
 *
 * The master's `自宅` is modeled as a one-room dwelling (full private
 * room bitset), faithful to `MAP_MANAGE.ERB`'s MASTER 初期位置 +
 * ワンルーム treatment of a personal home.
 *
 * No upstream file mutation. No LLM. See `CLAUDE.md`.
 */

import {
  PLACE_BATH,
  PLACE_BODY,
  PLACE_DEPOPULATED,
  PLACE_DRYING,
  PLACE_FUTON,
  PLACE_GARDEN,
  PLACE_INDOOR,
  PLACE_KOTATSU,
  PLACE_KITCHEN,
  PLACE_MEAL,
  PLACE_MOON,
  PLACE_ONEROOM,
  PLACE_PASSAGE,
  PLACE_PRIVATE,
  PLACE_PUBLIC,
  PLACE_REST,
  PLACE_ROOF,
  PLACE_SKY,
  PLACE_SNACK,
  PLACE_STUDY,
  PLACE_TOILET,
  PLACE_TRAINING,
  PLACE_WATER,
  PLACE_WESTERN,
  PLACE_WIDE,
} from "./place-flags.js";
import { GENERATED_LOCATION_PLACE_FLAGS } from "./generated-place-flags.js";

/**
 * Raw (pre-derivation) `ROOMDATA` bits per location string. Read via
 * `placeFlagsOf(location)` in `location-predicates.ts`, which applies
 * `expandPlaceFlags` and returns 0 for unmapped locations.
 */
export const LOCATION_PLACE_FLAGS: Record<string, bigint> = {
  // Maps 5-10 are generated from their upstream ROOMSETTING files.  Keep
  // those entries in the same runtime registry as the older hand-audited
  // maps so location predicates do not silently lose room semantics outside
  // the original 0-4 migration slice.
  ...GENERATED_LOCATION_PLACE_FLAGS,
  // Scene/location aliases whose display spelling differs from ROOMSETTING.
  "迷いの竹林": PLACE_WIDE | PLACE_TRAINING | PLACE_PASSAGE,
  "霧の湖": PLACE_WIDE | PLACE_WATER,
  彼岸: GENERATED_LOCATION_PLACE_FLAGS["彼岸:彼岸"] ?? 0n,
  // Generated ROOMSETTING CASE arms that intentionally carry no flags.
  "魔法之森:菌菇群生地": 0n,
  "魔法之森:古木的大樹": 0n,
  "妖怪之山・山顶:守矢神社鳥居": 0n,
  "妖怪之山・山麓:猫之里": 0n,
  "妖怪之山・山麓:帚木": 0n,
  "圣域:圣域入口": 0n,
  // ── 神社 (ROOMSETTING_0; MAXROOM=71) ──────────────────────────────
  // P1 鳥居 — no flags
  "神社:鳥居": 0n,
  // P5 手水舎 — 打水 (打水可(現在位置) per COMF419 @COM_ABLE419)
  "神社:手水舎": PLACE_WATER,
  // P2 境内 — 广阔|訓練
  "神社:境内": PLACE_WIDE | PLACE_TRAINING,
  // P3 賽銭箱 — 天之声|過疎
  "神社:賽銭箱": PLACE_SKY | PLACE_DEPOPULATED,
  // P4 本堂 — 屋内|過疎
  "神社:本堂": PLACE_INDOOR | PLACE_DEPOPULATED,
  // P6 庫房 — 屋根|過疎
  "神社:庫房": PLACE_ROOF | PLACE_DEPOPULATED,
  // P7 土間 — 屋内|留まらない
  "神社:土間": PLACE_INDOOR | PLACE_PASSAGE,
  // P8 廚房 — 屋内|厨房
  "神社:厨房": PLACE_INDOOR | PLACE_KITCHEN,
  // P9 居間 — 屋内|学习|休憩|飲食|炬燵
  "神社:居間": PLACE_INDOOR | PLACE_STUDY | PLACE_MEAL | PLACE_KOTATSU,
  // P10 走廊 — 屋内|休憩|飲食|赏月|物干し
  "神社:走廊": PLACE_INDOOR | PLACE_MEAL | PLACE_MOON | PLACE_DRYING,
  // P11 庭 — 广阔|訓練|菜園
  "神社:庭": PLACE_WIDE | PLACE_TRAINING | PLACE_GARDEN,
  // P12 脱衣所 — 屋内|身体測定|留まらない|プライベート
  "神社:脱衣所": PLACE_INDOOR | PLACE_BODY | PLACE_PASSAGE | PLACE_PRIVATE,
  // P13 風呂 — 屋内|風呂|プライベート|身体測定
  "神社:風呂": PLACE_INDOOR | PLACE_BATH | PLACE_PRIVATE | PLACE_BODY,
  // P15 霊夢私室 — 屋内|被窝|プライベート
  "神社:霊夢私室": PLACE_INDOOR | PLACE_FUTON | PLACE_PRIVATE,
  // P53 倉庫 — 上游 MASTER 初期位置 (ROOMSETTING_0:257 神社 default =
  // P53倉庫)；与 霊夢私室 同语义 = 屋内|被窝|プライベート.
  // 注：modern runtime 早期把 master 默认 home 命名成"神社:自室"（凭空造的
  // 字符串），与上游 P53 倉庫 偏离；保留两个 location 字符串都可访问到
  // 同语义的 bedroom flag，避免 outRoof/inRoom/bathCheck/inToilet 误判户外。
  "神社:倉庫": PLACE_INDOOR | PLACE_FUTON | PLACE_PRIVATE,
  "神社:自室": PLACE_INDOOR | PLACE_FUTON | PLACE_PRIVATE,
  // P19 大的倉庫 — 屋内|被窝|プライベート (大仓库，偶尔当卧室)
  "神社:大的倉庫": PLACE_INDOOR | PLACE_FUTON | PLACE_PRIVATE,
  // P54 小人的虫籠 — 屋内|被窝|プライベート (針妙丸私室)
  "神社:小人的虫籠": PLACE_INDOOR | PLACE_FUTON | PLACE_PRIVATE,
  // P56 阿吽の棲家 — 屋内|被窝|プライベート
  "神社:阿吽の棲家": PLACE_INDOOR | PLACE_FUTON | PLACE_PRIVATE,
  // P17 小的倉庫 — 屋内|被窝|プライベート (small storage, sleeps here)
  "神社:小的倉庫": PLACE_INDOOR | PLACE_FUTON | PLACE_PRIVATE,
  // P18 壁櫥間 — 屋内|被窝|プライベート (closet room, 卡娜的起始房间)
  "神社:壁櫥間": PLACE_INDOOR | PLACE_FUTON | PLACE_PRIVATE,
  // P52 別屋 — 屋内|被窝|プライベート
  "神社:別屋": PLACE_INDOOR | PLACE_FUTON | PLACE_PRIVATE,
  // P55 和室 — 屋内|被窝|プライベート
  "神社:和室": PLACE_INDOOR | PLACE_FUTON | PLACE_PRIVATE,
  // P69 先代巫女的小屋 — 屋内|被窝|プライベート
  "神社:先代巫女的小屋": PLACE_INDOOR | PLACE_FUTON | PLACE_PRIVATE,
  // P14 廁所 — 屋内|プライベート (bathroom)
  "神社:廁所": PLACE_INDOOR | PLACE_PRIVATE,
  // P16 破舊小屋 — 屋内|厨房|被窝|飲食 (broken-down hut, kitchen+bed)
  "神社:破舊小屋": PLACE_INDOOR | PLACE_KITCHEN | PLACE_FUTON | PLACE_MEAL,
  // P21 守矢神社分社 — 過疎
  "神社:守矢神社分社": PLACE_DEPOPULATED,
  // P23 温泉・脱衣所 — 屋内|身体測定|留まらない
  "神社:温泉・脱衣所": PLACE_INDOOR | PLACE_BODY | PLACE_PASSAGE,
  // P24 温泉 — 風呂|身体測定 (露天)
  "神社:温泉": PLACE_BATH | PLACE_BODY,
  // P25 鎮守之森 — 广阔
  "神社:鎮守之森": PLACE_WIDE,
  // P70 贝子的暂居处 — 屋内|厨房|被窝|プライベート|飲食
  "神社:贝子的暂居处":
    PLACE_INDOOR | PLACE_KITCHEN | PLACE_FUTON | PLACE_PRIVATE | PLACE_MEAL,
  // P27 三妖精之家・大廳 — 洋室|广阔|休憩|飲食|炬燵
  "神社:三妖精之家・大廳": PLACE_WESTERN | PLACE_WIDE | PLACE_REST | PLACE_MEAL | PLACE_KOTATSU,
  // P29 三妖精之家・廚房 — 洋室|厨房
  "神社:三妖精之家・廚房": PLACE_WESTERN | PLACE_KITCHEN,
  // P31 三妖精之家・二階廊下 — 洋室|留まらない
  "神社:三妖精之家・二階廊下": PLACE_WESTERN | PLACE_PASSAGE,
  // P32-P34 私室 — 洋室|被窝|赏月|プライベート
  "神社:桑尼私室": PLACE_WESTERN | PLACE_FUTON | PLACE_MOON | PLACE_PRIVATE,
  "神社:露娜私室": PLACE_WESTERN | PLACE_FUTON | PLACE_MOON | PLACE_PRIVATE,
  "神社:斯塔私室": PLACE_WESTERN | PLACE_FUTON | PLACE_MOON | PLACE_PRIVATE,
  // P35 三妖精之家・地下室 — 洋室|過疎
  "神社:三妖精之家・地下室": PLACE_WESTERN | PLACE_DEPOPULATED,
  // P36 夢幻遺跡前 — 留まらない
  "神社:夢幻遺跡前": PLACE_PASSAGE,
  // P37/P46 通路 — 洋室|留まらない
  "神社:夢幻遺跡・一階通路": PLACE_WESTERN | PLACE_PASSAGE,
  "神社:夢幻遺跡・二階通路": PLACE_WESTERN | PLACE_PASSAGE,
  // P38 洗面所 — 洋室|身体測定
  "神社:夢幻遺跡・洗面所": PLACE_WESTERN | PLACE_BODY,
  // P40 廁所 — 洋室|廁所|プライベート
  "神社:夢幻遺跡・廁所": PLACE_WESTERN | PLACE_TOILET | PLACE_PRIVATE,
  // P41 食堂兼談話室 — 洋室|飲食
  "神社:夢幻遺跡・食堂兼談話室": PLACE_WESTERN | PLACE_MEAL,
  // P42 調理室 — 洋室|厨房
  "神社:夢幻遺跡・調理室": PLACE_WESTERN | PLACE_KITCHEN,
  // P43/P44 私室 — 洋室|被窝|学习|プライベート|炬燵
  "神社:夢美私室": PLACE_WESTERN | PLACE_FUTON | PLACE_STUDY | PLACE_PRIVATE | PLACE_KOTATSU,
  "神社:千百合私室": PLACE_WESTERN | PLACE_FUTON | PLACE_STUDY | PLACE_PRIVATE | PLACE_KOTATSU,
  // P47 艦橋 — explicit empty CASE
  "神社:夢幻遺跡・艦橋": 0n,
  // P51 倉庫 — 洋室|過疎
  "神社:夢幻遺跡・倉庫": PLACE_WESTERN | PLACE_DEPOPULATED,
  // P30 三妖精之家・風呂 — 洋室|風呂|プライベート
  "神社:三妖精之家・風呂": PLACE_WESTERN | PLACE_BATH | PLACE_PRIVATE,
  // P39 夢幻遺跡・浴室 — 洋室|風呂|プライベート
  "神社:夢幻遺跡・浴室": PLACE_WESTERN | PLACE_BATH | PLACE_PRIVATE,
  // P48/P50/P49 夢幻遺跡・第一/第二資料室・研究室 — 洋室|学习
  // (ROOMSETTING_0:202-204; IS_LIBRARY 素通し → COMF436 読書 + COMF412 勉強)
  "神社:夢幻遺跡・第一資料室": PLACE_WESTERN | PLACE_STUDY,
  "神社:夢幻遺跡・第二資料室": PLACE_WESTERN | PLACE_STUDY,
  "神社:夢幻遺跡・研究室": PLACE_WESTERN | PLACE_STUDY,
  // P68 大广场 — 广阔|赏月|打水|訓練|物干し|公共|留まらない
  "神社:大广场": PLACE_WIDE | PLACE_MOON | PLACE_WATER | PLACE_TRAINING | PLACE_DRYING | PLACE_PUBLIC | PLACE_PASSAGE,
  // P22 参道 — 广阔. Bare "神社" hub is the same entrance.
  神社: PLACE_WIDE,
  "神社:参道": PLACE_WIDE,

  // ── 人間の里 (ROOMSETTING_2; MAXROOM=282) ────────────────────────
  // P201 人里的門 — 留まらない|公共の場; bare "人間之里" hub is the same.
  人間之里: PLACE_PASSAGE | PLACE_PUBLIC,
  "人間之里:人里的門": PLACE_PASSAGE | PLACE_PUBLIC,
  // P202 中央広場 — 广阔|訓練|公共の場
  "人間之里:中央広場": PLACE_WIDE | PLACE_TRAINING | PLACE_PUBLIC,
  // P203-206 大街 — 广阔|公共の場|留まらない
  "人間之里:南大街": PLACE_WIDE | PLACE_PUBLIC | PLACE_PASSAGE,
  "人間之里:東大街": PLACE_WIDE | PLACE_PUBLIC | PLACE_PASSAGE,
  "人間之里:北大街": PLACE_WIDE | PLACE_PUBLIC | PLACE_PASSAGE,
  "人間之里:西大街": PLACE_WIDE | PLACE_PUBLIC | PLACE_PASSAGE,
  // P207 龍神像 — 天之声|公共の場
  "人間之里:龍神像": PLACE_SKY | PLACE_PUBLIC,
  // P208-210,224,231-235,241-243 私室 — ワンルーム
  "人間之里:雷鼓的房間": PLACE_ONEROOM,
  "人間之里:八橋的房間": PLACE_ONEROOM,
  "人間之里:弁弁的房間": PLACE_ONEROOM,
  "人間之里:慧音宅": PLACE_ONEROOM,
  "人間之里:蛮奇的房間": PLACE_ONEROOM,
  "人間之里:蓮子的房間": PLACE_ONEROOM,
  "人間之里:梅莉的房間": PLACE_ONEROOM,
  "人間之里:雪的房間": PLACE_ONEROOM,
  "人間之里:舞的房間": PLACE_ONEROOM,
  "人間之里:空的部屋(241)": PLACE_ONEROOM,
  "人間之里:麟的房间": PLACE_ONEROOM,
  "人間之里:空的部屋(243)": PLACE_ONEROOM,
  // P211,212,217,218,238 飲食店 — 屋内|飲食|つまみ食い|公共の場
  "人間之里:酒屋": PLACE_INDOOR | PLACE_MEAL | PLACE_SNACK | PLACE_PUBLIC,
  "人間之里:咖啡館": PLACE_INDOOR | PLACE_MEAL | PLACE_SNACK | PLACE_PUBLIC,
  "人間之里:甜品店": PLACE_INDOOR | PLACE_MEAL | PLACE_SNACK | PLACE_PUBLIC,
  "人間之里:小料理屋": PLACE_INDOOR | PLACE_MEAL | PLACE_SNACK | PLACE_PUBLIC,
  "人間之里:鯢呑亭": PLACE_INDOOR | PLACE_MEAL | PLACE_SNACK | PLACE_PUBLIC,
  // P213,215,216,227 店 — 屋内|公共の場
  "人間之里:鈴奈庵": PLACE_INDOOR | PLACE_PUBLIC,
  "人間之里:花屋": PLACE_INDOOR | PLACE_PUBLIC,
  "人間之里:食料品店": PLACE_INDOOR | PLACE_PUBLIC,
  "人間之里:八百屋": PLACE_INDOOR | PLACE_PUBLIC,
  // P214,220 — 公共の場
  "人間之里:長屋前": PLACE_PUBLIC,
  "人間之里:瞭望樓": PLACE_PUBLIC,
  // P219,222 — 屋内|休憩|学习|身体測定|公共の場
  "人間之里:集会所": PLACE_INDOOR | PLACE_REST | PLACE_STUDY | PLACE_BODY | PLACE_PUBLIC,
  "人間之里:寺子屋": PLACE_INDOOR | PLACE_REST | PLACE_STUDY | PLACE_BODY | PLACE_PUBLIC,
  // P221 稗田邸 — 屋内|休憩|厨房|学习|炬燵
  "人間之里:稗田邸": PLACE_INDOOR | PLACE_REST | PLACE_KITCHEN | PLACE_STUDY | PLACE_KOTATSU,
  // P223 銭湯 — 屋内|身体測定|公共の場 (NOT 場所_風呂; PLACE_SENTO handles it)
  "人間之里:銭湯": PLACE_INDOOR | PLACE_BODY | PLACE_PUBLIC,
  // P225 情人用宿屋 — 屋内|被窝
  "人間之里:情人用宿屋": PLACE_INDOOR | PLACE_FUTON,
  // P226,229 — 屋内|被窝|学习|プライベート
  "人間之里:小鈴私室": PLACE_INDOOR | PLACE_FUTON | PLACE_STUDY | PLACE_PRIVATE,
  "人間之里:阿求私室": PLACE_INDOOR | PLACE_FUTON | PLACE_STUDY | PLACE_PRIVATE,
  // P228 貸切浴場 — 屋内|風呂
  "人間之里:貸切浴場": PLACE_INDOOR | PLACE_BATH,
  // P230 空的部屋 — 屋内|被窝|厨房|学习|休憩|飲食|プライベート
  "人間之里:空的部屋": PLACE_INDOOR | PLACE_FUTON | PLACE_KITCHEN | PLACE_STUDY | PLACE_REST | PLACE_MEAL | PLACE_PRIVATE,
  // P236 公用廁所 — 屋内|廁所
  "人間之里:公用廁所": PLACE_INDOOR | PLACE_TOILET,
  // P237 公用水井 — 打水
  "人間之里:公用水井": PLACE_WATER,
  // P239 美宵的房間 — 屋内|被窝|プライベート
  "人間之里:美宵的房間": PLACE_INDOOR | PLACE_FUTON | PLACE_PRIVATE,
  // P280 警察署 — 屋内|休憩|学习|身体測定|公共の場
  "人間之里:警察署": PLACE_INDOOR | PLACE_REST | PLACE_STUDY | PLACE_BODY | PLACE_PUBLIC,
  // P281 小兎姫私室 — 屋内|被窝|プライベート
  "人間之里:小兎姫私室": PLACE_INDOOR | PLACE_FUTON | PLACE_PRIVATE,

  // ── 命蓮寺 (ROOMSETTING_1; MAXROOM=141) ───────────────────────────
  // P101 山門 (entry gate) — no flags. Its location string is the bare root
  // "命蓮寺" (no room suffix), NOT "命蓮寺:山門", so key it as the root.
  "命蓮寺": 0n,
  // P102 境内 — 广阔|訓練
  "命蓮寺:境内": PLACE_WIDE | PLACE_TRAINING,
  // P103 本堂 — 屋内|天之声
  "命蓮寺:本堂": PLACE_INDOOR | PLACE_SKY,
  // P104 講堂 — 屋内|广阔|学习
  "命蓮寺:講堂": PLACE_INDOOR | PLACE_WIDE | PLACE_STUDY,
  // P105 経蔵 — 屋内|学习|過疎
  "命蓮寺:経蔵": PLACE_INDOOR | PLACE_STUDY | PLACE_DEPOPULATED,
  // P106 後院 — 广阔|訓練|菜園|打水
  "命蓮寺:後院": PLACE_WIDE | PLACE_TRAINING | PLACE_GARDEN | PLACE_WATER,
  // P107 土間 — 屋内|留まらない
  "命蓮寺:土間": PLACE_INDOOR | PLACE_PASSAGE,
  // P108 居間 — 屋内|休憩|飲食|炬燵
  "命蓮寺:居間": PLACE_INDOOR | PLACE_REST | PLACE_MEAL | PLACE_KOTATSU,
  // P109 女苑私室 — 屋内|被窝|プライベート
  "命蓮寺:女苑私室": PLACE_INDOOR | PLACE_FUTON | PLACE_PRIVATE,
  // P110 走廊 — 屋内|休憩|飲食|赏月|物干し
  "命蓮寺:走廊": PLACE_INDOOR | PLACE_REST | PLACE_MEAL | PLACE_MOON | PLACE_DRYING,
  // P111 廚房 — 屋内|厨房  (key MUST use 廚 U+5EDA to match the scene/move
  // location string "命蓮寺:廚房"; the 厨 U+53A8 variant silently misses)
  "命蓮寺:廚房": PLACE_INDOOR | PLACE_KITCHEN,
  // P112 風呂 — 屋内|風呂|身体測定|プライベート
  "命蓮寺:風呂": PLACE_INDOOR | PLACE_BATH | PLACE_BODY | PLACE_PRIVATE,
  // P113 納茲琳私室 — 屋内|被窝|プライベート
  "命蓮寺:納茲琳私室": PLACE_INDOOR | PLACE_FUTON | PLACE_PRIVATE,
  // P114 村紗私室 — 屋内|被窝|プライベート
  "命蓮寺:村紗私室": PLACE_INDOOR | PLACE_FUTON | PLACE_PRIVATE,
  // P115 星私室 — 屋内|被窝|プライベート
  "命蓮寺:星私室": PLACE_INDOOR | PLACE_FUTON | PLACE_PRIVATE,
  // P116 一輪私室 — 屋内|被窝|プライベート
  "命蓮寺:一輪私室": PLACE_INDOOR | PLACE_FUTON | PLACE_PRIVATE,
  // P117 鵺私室 — 屋内|被窝|プライベート
  "命蓮寺:鵺私室": PLACE_INDOOR | PLACE_FUTON | PLACE_PRIVATE,
  // P118 白蓮私室 — 屋内|被窝|学习|プライベート
  "命蓮寺:白蓮私室": PLACE_INDOOR | PLACE_FUTON | PLACE_STUDY | PLACE_PRIVATE,
  // P119 別屋 — 屋内|被窝|プライベート (白蓮家主初始位置)
  "命蓮寺:別屋": PLACE_INDOOR | PLACE_FUTON | PLACE_PRIVATE,
  // P120 庫房 — 屋根|過疎|プライベート
  "命蓮寺:庫房": PLACE_ROOF | PLACE_DEPOPULATED | PLACE_PRIVATE,
  // P121 墓地 — 過疎
  "命蓮寺:墓地": PLACE_DEPOPULATED,
  // P122 梵鐘楼 — 屋根|赏月
  "命蓮寺:梵鐘楼": PLACE_ROOF | PLACE_MOON,
  // P123 霊廟大門 — no flags
  "霊廟:霊廟大門": 0n,
  // P124 霊廟広場 — 广阔|訓練
  "霊廟:霊廟広場": PLACE_WIDE | PLACE_TRAINING,
  // P125 屠自古私室 — 屋内|被窝|プライベート
  "霊廟:屠自古私室": PLACE_INDOOR | PLACE_FUTON | PLACE_PRIVATE,
  // P126 道場 — 屋内|广阔|訓練|学习
  "霊廟:道場": PLACE_INDOOR | PLACE_WIDE | PLACE_TRAINING | PLACE_STUDY,
  // P127 布都私室 — 屋内|被窝|プライベート
  "霊廟:布都私室": PLACE_INDOOR | PLACE_FUTON | PLACE_PRIVATE,
  // P128 神子私室 — 屋内|被窝|プライベート
  "霊廟:神子私室": PLACE_INDOOR | PLACE_FUTON | PLACE_PRIVATE,
  // P129 客間 — 屋内|广阔|休憩|飲食|赏月|炬燵
  "霊廟:客間": PLACE_INDOOR | PLACE_WIDE | PLACE_REST | PLACE_MEAL | PLACE_MOON | PLACE_KOTATSU,
  // P130 廊下 — 屋内|留まらない
  "霊廟:廊下": PLACE_INDOOR | PLACE_PASSAGE,
  // P131 枯山水 — 過疎
  "霊廟:枯山水": PLACE_DEPOPULATED,
  // P132 調薬室 — 屋内|厨房|学习
  "霊廟:調薬室": PLACE_INDOOR | PLACE_KITCHEN | PLACE_STUDY,
  // P133 湯殿 — 屋内|風呂|身体測定|プライベート
  "霊廟:湯殿": PLACE_INDOOR | PLACE_BATH | PLACE_BODY | PLACE_PRIVATE,
  // P134 蔵 — 屋内|過疎
  "霊廟:蔵": PLACE_INDOOR | PLACE_DEPOPULATED,
  // P135 廊下(別館) — 屋内|留まらない
  "命蓮寺:廊下(別館)": PLACE_INDOOR | PLACE_PASSAGE,
  // P136 響子私室 — 屋内|被窝|プライベート
  "命蓮寺:響子私室": PLACE_INDOOR | PLACE_FUTON | PLACE_PRIVATE,
  // P137 猯藏の棲家 — 屋内|被窝|プライベート
  "命蓮寺:猯藏の棲家": PLACE_INDOOR | PLACE_FUTON | PLACE_PRIVATE,
  // P138 鐘楼 — 屋内|過疎
  "霊廟:鐘楼": PLACE_INDOOR | PLACE_DEPOPULATED,
  // P139 邪仙楼 — 屋内|被窝|学习|プライベート
  "霊廟:邪仙楼": PLACE_INDOOR | PLACE_FUTON | PLACE_STUDY | PLACE_PRIVATE,
  // P140 地蔵小路 — 广阔|留まらない
  "命蓮寺:地蔵小路": PLACE_WIDE | PLACE_PASSAGE,

  // ── 自宅 (master's home) — one-room dwelling ────────────────────
  自宅: PLACE_ONEROOM,

  // ── 紅魔館/霧之湖 (ROOMSETTING_3; MAXROOM=349) ──────────────────
  // P301 正門 (ENTRANCE) — 广阔; bare "紅魔館" root is the hub.
  紅魔館: 0n,
  "紅魔館:正門": PLACE_WIDE,
  // P302 庭 — 广阔|訓練
  "紅魔館:庭": PLACE_WIDE | PLACE_TRAINING,
  // P303 守衛小屋 — 洋室|被窝|プライベート
  "紅魔館:守衛小屋": PLACE_WESTERN | PLACE_FUTON | PLACE_PRIVATE,
  // P304 空的小屋 — 洋室|休憩
  "紅魔館:空的小屋": PLACE_WESTERN | PLACE_REST,
  // P305 仓库 — 洋室|過疎
  "紅魔館:仓库": PLACE_WESTERN | PLACE_DEPOPULATED,
  // P306 後院 — 广阔|訓練|菜園
  "紅魔館:後院": PLACE_WIDE | PLACE_TRAINING | PLACE_GARDEN,
  // P307 東陽台 — 屋根|飲食|赏月|物干し
  "紅魔館:東陽台": PLACE_ROOF | PLACE_MEAL | PLACE_MOON | PLACE_DRYING,
  // P308 西陽台 — 屋根|飲食|赏月|物干し
  "紅魔館:西陽台": PLACE_ROOF | PLACE_MEAL | PLACE_MOON | PLACE_DRYING,
  // P309 大廳 — 洋室|广阔
  "紅魔館:大廳": PLACE_WESTERN | PLACE_WIDE,
  // P310 図書館 — 洋室|学习|休憩
  "紅魔館:図書館": PLACE_WESTERN | PLACE_STUDY | PLACE_REST,
  // P311 帕秋莉私室 — 洋室|被窝|プライベート
  "紅魔館:帕秋莉私室": PLACE_WESTERN | PLACE_FUTON | PLACE_PRIVATE,
  // P312 小悪魔私室 — 洋室|被窝|プライベート
  "紅魔館:小悪魔私室": PLACE_WESTERN | PLACE_FUTON | PLACE_PRIVATE,
  // P313 厨房 — 洋室|厨房
  "紅魔館:厨房": PLACE_WESTERN | PLACE_KITCHEN,
  // P314 食堂 — 洋室|飲食
  "紅魔館:食堂": PLACE_WESTERN | PLACE_MEAL,
  // P315 會客廳 — 洋室|休憩
  "紅魔館:會客廳": PLACE_WESTERN | PLACE_REST,
  // P316 一層廁所 — 洋室|廁所|プライベート
  "紅魔館:一層廁所": PLACE_WESTERN | PLACE_TOILET | PLACE_PRIVATE,
  // P319 二階廊下 — 洋室|广阔|留まらない
  "紅魔館:二階廊下": PLACE_WESTERN | PLACE_WIDE | PLACE_PASSAGE,
  // P320 咲夜私室 — 洋室|被窝|プライベート
  "紅魔館:咲夜私室": PLACE_WESTERN | PLACE_FUTON | PLACE_PRIVATE,
  // P321 空的部屋 — 洋室|被窝|プライベート
  "紅魔館:空的部屋": PLACE_WESTERN | PLACE_FUTON | PLACE_PRIVATE,
  // P322 二層廁所 — 洋室|廁所|プライベート
  "紅魔館:二層廁所": PLACE_WESTERN | PLACE_TOILET | PLACE_PRIVATE,
  // P323 妖精女僕的值班室 — 洋室|休憩|過疎|飲食
  "紅魔館:妖精女僕的值班室": PLACE_WESTERN | PLACE_REST | PLACE_DEPOPULATED | PLACE_MEAL,
  // P324 大露台 — 屋根|飲食|赏月
  "紅魔館:大露台": PLACE_ROOF | PLACE_MEAL | PLACE_MOON,
  // P326 蕾米莉亜私室 — 洋室|被窝|プライベート
  "紅魔館:蕾米莉亜私室": PLACE_WESTERN | PLACE_FUTON | PLACE_PRIVATE,
  // P327 小露台 — 屋根|飲食|赏月|プライベート
  "紅魔館:小露台": PLACE_ROOF | PLACE_MEAL | PLACE_MOON | PLACE_PRIVATE,
  // P328 地下走廊 — 洋室|广阔|留まらない
  "紅魔館:地下走廊": PLACE_WESTERN | PLACE_WIDE | PLACE_PASSAGE,
  // P329 倉庫 — 洋室|過疎
  "紅魔館:倉庫": PLACE_WESTERN | PLACE_DEPOPULATED,
  // P330 使用人部屋 — 洋室|被窝|プライベート
  "紅魔館:使用人部屋": PLACE_WESTERN | PLACE_FUTON | PLACE_PRIVATE,
  // P331 地下室 — 洋室|被窝|過疎|プライベート
  "紅魔館:地下室": PLACE_WESTERN | PLACE_FUTON | PLACE_DEPOPULATED | PLACE_PRIVATE,
  // P332 脱衣所 — 洋室|身体測定|留まらない
  "紅魔館:脱衣所": PLACE_WESTERN | PLACE_BODY | PLACE_PASSAGE,
  // P333 大浴場 — 洋室|風呂
  "紅魔館:大浴場": PLACE_WESTERN | PLACE_BATH,
  // P334 廃洋館・入口 — 洋室|留まらない
  "廃洋館:廃洋館・入口": PLACE_WESTERN | PLACE_PASSAGE,
  // P335 廃洋館・大廳 — 洋室|广阔|飲食|炬燵
  "廃洋館:廃洋館・大廳": PLACE_WESTERN | PLACE_WIDE | PLACE_MEAL | PLACE_KOTATSU,
  // P337 廃洋館・廚房 — 洋室|厨房
  "廃洋館:廃洋館・廚房": PLACE_WESTERN | PLACE_KITCHEN,
  // P338 廃洋館・風呂 — 洋室|風呂|身体測定|プライベート
  "廃洋館:廃洋館・風呂": PLACE_WESTERN | PLACE_BATH | PLACE_BODY | PLACE_PRIVATE,
  // P339 廃洋館・二階廊下 — 洋室|留まらない
  "廃洋館:廃洋館・二階廊下": PLACE_WESTERN | PLACE_PASSAGE,
  // P340 露娜薩私室 — 洋室|被窝|プライベート
  "廃洋館:露娜薩私室": PLACE_WESTERN | PLACE_FUTON | PLACE_PRIVATE,
  // P341 梅露蘭私室 — 洋室|被窝|プライベート
  "廃洋館:梅露蘭私室": PLACE_WESTERN | PLACE_FUTON | PLACE_PRIVATE,
  // P342 莉莉卡私室 — 洋室|被窝|プライベート
  "廃洋館:莉莉卡私室": PLACE_WESTERN | PLACE_FUTON | PLACE_PRIVATE,
  // P343 湖畔 — 广阔|訓練
  "霧之湖:湖畔": PLACE_WIDE | PLACE_TRAINING,
  // P344 蕾蒂的冰屋 — ワンルーム
  "霧之湖:蕾蒂的冰屋": PLACE_ONEROOM,
  // P345 琪露諾的冰屋 — ワンルーム
  "霧之湖:琪露諾的冰屋": PLACE_ONEROOM,
  // P346 大妖精の棲家 — ワンルーム
  "霧之湖:大妖精の棲家": PLACE_ONEROOM,
  // P347 霧之湖 — 广阔|打水
  "霧之湖:霧之湖": PLACE_WIDE | PLACE_WATER,
  // P348 霧之湖・湖底 — 屋根|被窝|プライベート|无尘(場所以外無視)
  "霧之湖:霧之湖・湖底": PLACE_ROOF | PLACE_FUTON | PLACE_PRIVATE,

  // ---------------------------------------------------------------------
  // 竹林 (mapId 4) — from ROOMSETTING_4.ERB raw bits. Prefixes 永遠亭 /
  // 夢幻館 / 迷途竹林 (P447 竹林入口 = bare root). Keys copied byte-for-byte
  // from gen-tikurin-scenes.mjs toLocation. Phase 7 map-populate P2.
  // ---------------------------------------------------------------------
  // 永遠亭 (page 1)
  "迷途竹林": PLACE_WIDE | PLACE_TRAINING | PLACE_PASSAGE, // P447 竹林入口 (root)
  "永遠亭:永遠亭入口": PLACE_WIDE | PLACE_TRAINING | PLACE_PUBLIC,
  "永遠亭:待合室": PLACE_INDOOR | PLACE_BODY | PLACE_PUBLIC,
  "永遠亭:診察室": PLACE_INDOOR | PLACE_BODY | PLACE_PUBLIC,
  "永遠亭:配药室": PLACE_INDOOR | PLACE_PRIVATE,
  "永遠亭:来客用廁所": PLACE_INDOOR | PLACE_TOILET,
  "永遠亭:廊下": PLACE_INDOOR | PLACE_PASSAGE,
  "永遠亭:中廊下": PLACE_INDOOR | PLACE_PASSAGE,
  "永遠亭:走廊": PLACE_INDOOR | PLACE_REST | PLACE_MEAL | PLACE_MOON | PLACE_DRYING,
  "永遠亭:帝私室": PLACE_INDOOR | PLACE_FUTON | PLACE_STUDY | PLACE_PRIVATE,
  "永遠亭:鈴仙私室": PLACE_INDOOR | PLACE_FUTON | PLACE_STUDY | PLACE_PRIVATE,
  "永遠亭:空的部屋": PLACE_INDOOR | PLACE_FUTON | PLACE_STUDY | PLACE_MOON | PLACE_PRIVATE,
  "永遠亭:永琳私室": PLACE_INDOOR | PLACE_FUTON | PLACE_STUDY | PLACE_MOON | PLACE_PRIVATE,
  "永遠亭:輝夜私室": PLACE_INDOOR | PLACE_FUTON | PLACE_STUDY | PLACE_MOON | PLACE_PRIVATE,
  "永遠亭:大廳": PLACE_INDOOR | PLACE_WIDE | PLACE_MEAL,
  "永遠亭:居間": PLACE_INDOOR | PLACE_STUDY | PLACE_MEAL | PLACE_KOTATSU,
  "永遠亭:廚房": PLACE_INDOOR | PLACE_KITCHEN,
  "永遠亭:厠": PLACE_INDOOR | PLACE_TOILET,
  "永遠亭:脱衣所": PLACE_INDOOR | PLACE_BODY | PLACE_PASSAGE | PLACE_PRIVATE,
  "永遠亭:風呂": PLACE_INDOOR | PLACE_BATH | PLACE_MOON | PLACE_PRIVATE,
  "永遠亭:庭": PLACE_WIDE | PLACE_TRAINING | PLACE_GARDEN,
  "永遠亭:後院": PLACE_WIDE | PLACE_TRAINING | PLACE_DEPOPULATED,
  "永遠亭:庫房": PLACE_INDOOR | PLACE_DEPOPULATED,
  "永遠亭:二階廊下": PLACE_INDOOR | PLACE_PASSAGE,
  "永遠亭:倉庫": PLACE_INDOOR | PLACE_DEPOPULATED,
  "永遠亭:二階空的部屋": PLACE_INDOOR | PLACE_FUTON | PLACE_STUDY | PLACE_PRIVATE,
  "永遠亭:地下室": PLACE_INDOOR | PLACE_FUTON | PLACE_STUDY | PLACE_DEPOPULATED,
  // 迷途竹林 (page 3)
  "迷途竹林:兎的洞穴": PLACE_ROOF | PLACE_TRAINING | PLACE_MOON,
  "迷途竹林:影狼的家": PLACE_ONEROOM,
  "迷途竹林:斜角的竹林": PLACE_TRAINING,
  "迷途竹林:迷失的小道": PLACE_TRAINING,
  "迷途竹林:井戸": PLACE_WATER,
  "迷途竹林:無名之丘": PLACE_WIDE | PLACE_TRAINING,
  "迷途竹林:梅蒂欣的家": PLACE_ONEROOM | PLACE_WESTERN,
  "迷途竹林:太陽花田": PLACE_WIDE | PLACE_TRAINING,
  "迷途竹林:拉尔瓦的家": PLACE_ONEROOM,
  "迷途竹林:廃屋": PLACE_INDOOR | PLACE_REST | PLACE_MEAL,
  "迷途竹林:温泉": PLACE_BATH,
  "迷途竹林:空的小屋": PLACE_INDOOR | PLACE_KITCHEN | PLACE_REST | PLACE_MEAL,
  "迷途竹林:米斯蒂亜的家": PLACE_ONEROOM,
  "迷途竹林:夜雀的小攤": PLACE_ROOF | PLACE_MOON | PLACE_MEAL,
  "迷途竹林:妹紅的家": PLACE_ONEROOM,
  "迷途竹林:祠": PLACE_WIDE | PLACE_SKY | PLACE_DEPOPULATED,
  // 夢幻館 (page 2)
  "夢幻館:玄関": PLACE_WESTERN | PLACE_PASSAGE,
  "夢幻館:胡桃私室": PLACE_WESTERN | PLACE_FUTON | PLACE_STUDY | PLACE_PRIVATE,
  "夢幻館:艾麗私室": PLACE_WESTERN | PLACE_FUTON | PLACE_STUDY | PLACE_PRIVATE,
  "夢幻館:用餐房間": PLACE_WESTERN | PLACE_KITCHEN,
  "夢幻館:浴室": PLACE_WESTERN | PLACE_BATH | PLACE_BODY | PLACE_PRIVATE,
  "夢幻館:廁所": PLACE_WESTERN | PLACE_TOILET | PLACE_PRIVATE,
  "夢幻館:倉庫": PLACE_WESTERN | PLACE_DEPOPULATED,
  "夢幻館:夢月私室": PLACE_WESTERN | PLACE_FUTON | PLACE_STUDY | PLACE_PRIVATE,
  "夢幻館:廊下": PLACE_WESTERN | PLACE_PASSAGE,
  "夢幻館:幻月私室": PLACE_WESTERN | PLACE_FUTON | PLACE_STUDY | PLACE_PRIVATE,
  "夢幻館:空的部屋": PLACE_INDOOR | PLACE_FUTON,
  "夢幻館:生活間": PLACE_WESTERN | PLACE_REST | PLACE_MEAL | PLACE_KOTATSU,
  "夢幻館:陽台": PLACE_ROOF | PLACE_MEAL | PLACE_MOON | PLACE_DRYING,
  "夢幻館:幽香私室": PLACE_WESTERN | PLACE_FUTON | PLACE_STUDY | PLACE_PRIVATE,
  "夢幻館:露台": PLACE_ROOF | PLACE_MEAL | PLACE_MOON | PLACE_DRYING,
  "夢幻館:大堂": PLACE_WESTERN | PLACE_WIDE | PLACE_MEAL,
  "夢幻館:庭": PLACE_WIDE | PLACE_TRAINING | PLACE_WATER,
};
