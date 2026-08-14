/**
 * Phase L1 — Room-to-room movement for the shrine area.
 *
 * SINGLE SOURCE OF TRUTH: `MOVEMENT_CAN_MOVE_00.ERB` (shrine connectivity
 * matrix). Every connection below corresponds to a type-1 or type-3
 * edge in the original ERB. No shortcuts, no simplifications.
 *
 * Command numbers 10710-10793 use the 10000 SYNTHETIC offset
 * reserved for shrine room movement. The offset keeps these navigation ids
 * OUT of the real COMF id space (700-749 = 自慰系 self-pleasure commands),
 * so both register live. See namespace-debt note in phase-7-family-map.md.
 * 10701/10702/10703 (= 701/702/703 + 10000) for major-area transitions.
 */

import type { HandlerEntry } from "../types.js";
import { cloneGameState } from "../../state/game-state.js";
import { advanceTimeTicks } from "../../state/settlement.js";
import { followCompanions } from "../../state/companion-follow.js";
import { setSlotLocation } from "../../world/room-id-location.js";
import { mapCanMove } from "../../world/map-can-move.js";
import { lockedRoomOwner, lockedRoomMessage } from "../../world/room-lock.js";
import { pitfallArrivalEvents } from "../../world/free-activity-events.js";

interface RoomMove {
  commandNo: number;
  toLocation: string;
  /** In-game minutes. Default 1 (adjacent rooms), 2 for outdoor
   *  transitions (鳥居↔参道), 5 for major-area exits. */
  timeCost?: number;
}

/**
 * Shrine room connectivity — faithfully ported from `MOVEMENT_CAN_MOVE_00.ERB`.
 *
 * Format: `fromLocation → toLocation (CAN_MOVE type)`.
 *
 * Original ERB reference (our 12 rooms + P12 脱衣所 added for bath routing):
 *
 *   # 前院 (sub-map 1)
 *   P22 参道  → P1 鳥居 (3)
 *   P1 鳥居   → P22 参道 (3), P2 境内 (3)
 *   P2 境内   → P1 鳥居 (3), P3 賽銭箱 (3), P11 庭 (1)
 *   P3 賽銭箱 → P2 境内 (3), P4 本堂 (1)
 *   P4 本堂   → P3 賽銭箱 (1), P7 土間 (1)
 *
 *   # 内部/後院 (sub-map 2)
 *   P7 土間   → P4 本堂 (1), P8 厨房 (1), P9 居間 (1)
 *   P8 厨房   → P7 土間 (1), P9 居間 (1), P10 走廊 (1)
 *   P9 居間   → P7 土間 (1), P8 厨房 (1), P10 走廊 (3), P15 霊夢私室 (1)
 *   P10 走廊  → P8 厨房 (1), P9 居間 (3), P11 庭 (3), P12 脱衣所 (1)
 *   P11 庭    → P10 走廊 (3), P2 境内 (1)
 *   P12 脱衣所 → P10 走廊 (1), P13 風呂 (1)
 *   P13 風呂   → P12 脱衣所 (1)
 *   P15 霊夢私室 → P9 居間 (1)
 */
const SHRINE_MOVES: readonly RoomMove[] = [
  // ---- 前院 (sub-map 1) ----
  // P22 参道 ↔ P1 鳥居 (type 3 — direct via)
  { commandNo: 10711, toLocation: "神社:鳥居", timeCost: 2 },
  // P1 鳥居 ↔ P22 参道
  { commandNo: 10713, toLocation: "神社:参道", timeCost: 2 },
  // P1 鳥居 ↔ P2 境内 (type 3)
  { commandNo: 10738, toLocation: "神社:境内", timeCost: 2 },
  // P2 境内 ↔ P1 鳥居 (type 3)
  { commandNo: 10739, toLocation: "神社:鳥居", timeCost: 2 },
  // P2 境内 ↔ P3 賽銭箱 (type 3)
  { commandNo: 10714, toLocation: "神社:賽銭箱", timeCost: 1 },
  // P3 賽銭箱 ↔ P2 境内
  { commandNo: 10716, toLocation: "神社:境内", timeCost: 1 },
  // P3 賽銭箱 ↔ P4 本堂 (type 1)
  { commandNo: 10740, toLocation: "神社:本堂", timeCost: 1 },
  // P4 本堂 ↔ P3 賽銭箱 (type 1)
  { commandNo: 10717, toLocation: "神社:賽銭箱", timeCost: 1 },
  // P4 本堂 ↔ P7 土間 (type 1)
  { commandNo: 10737, toLocation: "神社:土間", timeCost: 1 },
  // P2 境内 ↔ P11 庭 (type 1 — direct outdoor path)
  { commandNo: 10741, toLocation: "神社:庭", timeCost: 1 },

  // ---- 内部/後院 (sub-map 2) ----
  // P7 土間 ↔ P4 本堂 (type 1)
  { commandNo: 10742, toLocation: "神社:本堂", timeCost: 1 },
  // P7 土間 ↔ P8 厨房 (type 1)
  { commandNo: 10721, toLocation: "神社:厨房", timeCost: 1 },
  // P7 土間 ↔ P9 居間 (type 1)
  { commandNo: 10722, toLocation: "神社:居間", timeCost: 1 },
  // P8 厨房 ↔ P7 土間
  { commandNo: 10723, toLocation: "神社:土間", timeCost: 1 },
  // P8 厨房 ↔ P9 居間 (type 1)
  { commandNo: 10725, toLocation: "神社:居間", timeCost: 1 },
  // P8 厨房 ↔ P10 走廊 (type 1)
  { commandNo: 10724, toLocation: "神社:走廊", timeCost: 1 },
  // P9 居間 ↔ P7 土間
  { commandNo: 10726, toLocation: "神社:土間", timeCost: 1 },
  // P9 居間 ↔ P8 厨房
  { commandNo: 10727, toLocation: "神社:厨房", timeCost: 1 },
  // P9 居間 ↔ P10 走廊 (type 3 — direct via)
  { commandNo: 10728, toLocation: "神社:走廊", timeCost: 1 },
  // P9 居間 ↔ P15 霊夢私室 (type 1)
  { commandNo: 10743, toLocation: "神社:霊夢私室", timeCost: 1 },
  // P10 走廊 ↔ P8 厨房
  { commandNo: 10729, toLocation: "神社:厨房", timeCost: 1 },
  // P10 走廊 ↔ P9 居間
  { commandNo: 10730, toLocation: "神社:居間", timeCost: 1 },
  // P10 走廊 ↔ P11 庭 (type 3)
  { commandNo: 10731, toLocation: "神社:庭", timeCost: 1 },
  // P10 走廊 ↔ P12 脱衣所 (type 1)
  { commandNo: 10744, toLocation: "神社:脱衣所", timeCost: 1 },
  // P11 庭 ↔ P10 走廊
  { commandNo: 10734, toLocation: "神社:走廊", timeCost: 1 },
  // P11 庭 ↔ P2 境内 (type 1)
  { commandNo: 10745, toLocation: "神社:境内", timeCost: 1 },
  // P12 脱衣所 ↔ P10 走廊
  { commandNo: 10746, toLocation: "神社:走廊", timeCost: 1 },
  // P12 脱衣所 ↔ P13 風呂 (type 1)
  { commandNo: 10747, toLocation: "神社:風呂", timeCost: 1 },
  // P13 風呂 ↔ P12 脱衣所
  { commandNo: 10748, toLocation: "神社:脱衣所", timeCost: 1 },
  // P15 霊夢私室 ↔ P9 居間
  { commandNo: 10749, toLocation: "神社:居間", timeCost: 1 },
  // Modern player room (CFLAG:MASTER:初期位置) off the living room.
  { commandNo: 10750, toLocation: "神社:自室", timeCost: 1 },
  { commandNo: 10751, toLocation: "神社:居間", timeCost: 1 },
  // Source-pinned shrine rooms omitted by the original narrow scene slice.
  // P10 走廊 ↔ P19 大的倉庫.
  { commandNo: 10752, toLocation: "神社:大的倉庫", timeCost: 1 },
  { commandNo: 10753, toLocation: "神社:走廊", timeCost: 1 },
  // P9 居間 / P10 走廊 ↔ P54 小人的虫籠.
  { commandNo: 10754, toLocation: "神社:小人的虫籠", timeCost: 1 },
  { commandNo: 10755, toLocation: "神社:居間", timeCost: 1 },
  { commandNo: 10756, toLocation: "神社:走廊", timeCost: 1 },
  // P2 境内 ↔ P56 阿吽の棲家.
  { commandNo: 10758, toLocation: "神社:阿吽の棲家", timeCost: 1 },
  { commandNo: 10759, toLocation: "神社:境内", timeCost: 1 },
  { commandNo: 10760, toLocation: "神社:庫房", timeCost: 1 },
  { commandNo: 10761, toLocation: "神社:境内", timeCost: 1 },
  { commandNo: 10762, toLocation: "神社:壁櫥間", timeCost: 1 },
  { commandNo: 10763, toLocation: "神社:霊夢私室", timeCost: 1 },
  { commandNo: 10764, toLocation: "神社:別屋", timeCost: 1 },
  { commandNo: 10765, toLocation: "神社:庭", timeCost: 1 },
  { commandNo: 10766, toLocation: "神社:和室", timeCost: 1 },
  { commandNo: 10767, toLocation: "神社:居間", timeCost: 1 },
  { commandNo: 10768, toLocation: "神社:先代巫女的小屋", timeCost: 2 },
  { commandNo: 10769, toLocation: "神社:庭", timeCost: 2 },
  { commandNo: 10770, toLocation: "神社:守矢神社分社", timeCost: 2 },
  { commandNo: 10771, toLocation: "神社:境内", timeCost: 2 },
  { commandNo: 10772, toLocation: "神社:鎮守之森", timeCost: 2 },
  { commandNo: 10773, toLocation: "神社:参道", timeCost: 2 },
  { commandNo: 10774, toLocation: "神社:三妖精之家・大廳", timeCost: 1 },
  { commandNo: 10775, toLocation: "神社:鎮守之森", timeCost: 1 },
  { commandNo: 10776, toLocation: "神社:三妖精之家・二階廊下", timeCost: 1 },
  { commandNo: 10777, toLocation: "神社:三妖精之家・大廳", timeCost: 1 },
  { commandNo: 10778, toLocation: "神社:桑尼私室", timeCost: 1 },
  { commandNo: 10779, toLocation: "神社:三妖精之家・二階廊下", timeCost: 1 },
  { commandNo: 10780, toLocation: "神社:露娜私室", timeCost: 1 },
  { commandNo: 10781, toLocation: "神社:三妖精之家・二階廊下", timeCost: 1 },
  { commandNo: 10782, toLocation: "神社:斯塔私室", timeCost: 1 },
  { commandNo: 10783, toLocation: "神社:三妖精之家・二階廊下", timeCost: 1 },
  { commandNo: 10784, toLocation: "神社:夢幻遺跡前", timeCost: 2 },
  { commandNo: 10785, toLocation: "神社:参道", timeCost: 2 },
  { commandNo: 10786, toLocation: "神社:夢幻遺跡・一階通路", timeCost: 1 },
  { commandNo: 10787, toLocation: "神社:夢幻遺跡前", timeCost: 1 },
  { commandNo: 10788, toLocation: "神社:夢美私室", timeCost: 1 },
  { commandNo: 10789, toLocation: "神社:夢幻遺跡・一階通路", timeCost: 1 },
  { commandNo: 10790, toLocation: "神社:千百合私室", timeCost: 1 },
  { commandNo: 10791, toLocation: "神社:夢幻遺跡・一階通路", timeCost: 1 },
  // P10 走廊 ↔ P17 小的倉庫.
  { commandNo: 10792, toLocation: "神社:小的倉庫", timeCost: 1 },
  { commandNo: 10793, toLocation: "神社:走廊", timeCost: 1 },

  // ── Parity QA 地图解锁：22 个此前未接线房间的边（忠实 CAN_MOVE_0）。
  // 排除 type2（能看不能走）；排除连到未画大别墅房（P57/60/67）的边——
  // 那些房间不在 HAKUREI 彩图里，本轮「只解锁已画房间」不建。
  // 双向边各占一个 commandNo：A 的 scene 列去 B 的，B 的 scene 列去 A 的。
  // 神社本区 ─
  // P5 手水舎 ↔ P2 境内 (type3)
  { commandNo: 10794, toLocation: "神社:境内", timeCost: 2 },
  { commandNo: 10795, toLocation: "神社:手水舎", timeCost: 2 },
  // P14 廁所 ↔ P10 走廊 (type1)
  { commandNo: 10796, toLocation: "神社:走廊", timeCost: 1 },
  { commandNo: 10797, toLocation: "神社:廁所", timeCost: 1 },
  // P16 破舊小屋 ↔ P2 境内 (type1)
  { commandNo: 10798, toLocation: "神社:境内", timeCost: 2 },
  { commandNo: 10799, toLocation: "神社:破舊小屋", timeCost: 2 },
  // P23 温泉・脱衣所 ↔ P22 参道 (type1)
  { commandNo: 10800, toLocation: "神社:参道", timeCost: 2 },
  { commandNo: 10801, toLocation: "神社:温泉・脱衣所", timeCost: 2 },
  // P23 温泉・脱衣所 ↔ P24 温泉 (type1)
  { commandNo: 10802, toLocation: "神社:温泉", timeCost: 1 },
  { commandNo: 10803, toLocation: "神社:温泉・脱衣所", timeCost: 1 },
  // P23 温泉・脱衣所 ↔ P25 鎮守之森 (type1)
  { commandNo: 10804, toLocation: "神社:鎮守之森", timeCost: 2 },
  { commandNo: 10805, toLocation: "神社:温泉・脱衣所", timeCost: 2 },
  // P53 倉庫 ↔ P10 走廊 (type1)
  { commandNo: 10834, toLocation: "神社:走廊", timeCost: 1 },
  { commandNo: 10835, toLocation: "神社:倉庫", timeCost: 1 },
  // P68 大广场 ↔ P22 参道 (type3)（P68→P57/60/67 大别墅未画，本轮 defer）
  { commandNo: 10836, toLocation: "神社:参道", timeCost: 2 },
  { commandNo: 10837, toLocation: "神社:大广场", timeCost: 2 },
  // P70 贝子的暂居处 ↔ P10 走廊 (type1)
  { commandNo: 10838, toLocation: "神社:走廊", timeCost: 1 },
  { commandNo: 10839, toLocation: "神社:贝子的暂居处", timeCost: 1 },
  // 三妖精之家（经 P27 大廳） ─
  // P29 廚房 ↔ P27 大廳 (type3)
  { commandNo: 10806, toLocation: "神社:三妖精之家・大廳", timeCost: 1 },
  { commandNo: 10807, toLocation: "神社:三妖精之家・廚房", timeCost: 1 },
  // P30 風呂 ↔ P27 大廳 (type1)
  { commandNo: 10808, toLocation: "神社:三妖精之家・大廳", timeCost: 1 },
  { commandNo: 10809, toLocation: "神社:三妖精之家・風呂", timeCost: 1 },
  // P35 地下室 ↔ P27 大廳 (type1)
  { commandNo: 10810, toLocation: "神社:三妖精之家・大廳", timeCost: 1 },
  { commandNo: 10811, toLocation: "神社:三妖精之家・地下室", timeCost: 1 },
  // 夢幻遺跡（经 P37 一階通路） ─
  // P38 洗面所 ↔ P37 一階通路 (type1)
  { commandNo: 10812, toLocation: "神社:夢幻遺跡・一階通路", timeCost: 1 },
  { commandNo: 10813, toLocation: "神社:夢幻遺跡・洗面所", timeCost: 1 },
  // P38 洗面所 ↔ P39 浴室 (type1)
  { commandNo: 10814, toLocation: "神社:夢幻遺跡・浴室", timeCost: 1 },
  { commandNo: 10815, toLocation: "神社:夢幻遺跡・洗面所", timeCost: 1 },
  // P38 洗面所 ↔ P40 廁所 (type1)
  { commandNo: 10816, toLocation: "神社:夢幻遺跡・廁所", timeCost: 1 },
  { commandNo: 10817, toLocation: "神社:夢幻遺跡・洗面所", timeCost: 1 },
  // P41 食堂 ↔ P37 一階通路 (type1)
  { commandNo: 10818, toLocation: "神社:夢幻遺跡・一階通路", timeCost: 1 },
  { commandNo: 10819, toLocation: "神社:夢幻遺跡・食堂兼談話室", timeCost: 1 },
  // P41 食堂 ↔ P42 調理室 (type3)
  { commandNo: 10820, toLocation: "神社:夢幻遺跡・調理室", timeCost: 1 },
  { commandNo: 10821, toLocation: "神社:夢幻遺跡・食堂兼談話室", timeCost: 1 },
  // P46 二階通路 ↔ P37 一階通路 (type1)
  { commandNo: 10822, toLocation: "神社:夢幻遺跡・一階通路", timeCost: 1 },
  { commandNo: 10823, toLocation: "神社:夢幻遺跡・二階通路", timeCost: 1 },
  // P46 二階通路 ↔ P47 艦橋 (type1)
  { commandNo: 10824, toLocation: "神社:夢幻遺跡・艦橋", timeCost: 1 },
  { commandNo: 10825, toLocation: "神社:夢幻遺跡・二階通路", timeCost: 1 },
  // P46 二階通路 ↔ P48 第一資料室 (type1)
  { commandNo: 10826, toLocation: "神社:夢幻遺跡・第一資料室", timeCost: 1 },
  { commandNo: 10827, toLocation: "神社:夢幻遺跡・二階通路", timeCost: 1 },
  // P46 二階通路 ↔ P49 研究室 (type1)
  { commandNo: 10828, toLocation: "神社:夢幻遺跡・研究室", timeCost: 1 },
  { commandNo: 10829, toLocation: "神社:夢幻遺跡・二階通路", timeCost: 1 },
  // P46 二階通路 ↔ P50 第二資料室 (type1)
  { commandNo: 10830, toLocation: "神社:夢幻遺跡・第二資料室", timeCost: 1 },
  { commandNo: 10831, toLocation: "神社:夢幻遺跡・二階通路", timeCost: 1 },
  // P46 二階通路 ↔ P51 倉庫 (type1)
  { commandNo: 10832, toLocation: "神社:夢幻遺跡・倉庫", timeCost: 1 },
  { commandNo: 10833, toLocation: "神社:夢幻遺跡・二階通路", timeCost: 1 },
] as const;

export function makeShrineRoomMoveHandlers(): HandlerEntry[] {
  return SHRINE_MOVES.map((m) => ({
    commandNo: m.commandNo,
    // `@MAP_CAN_MOVE_0` entry gate — ports the ERB room-entry permission
    // check (`MAP_COMM_00.ERB:114-167`). Faithfully blocks the master from
    // moving into rooms barred to them: e.g. 小人の虫籠 (needs 小人体型),
    // 三妖精之家 (needs 妖精 / 恋慕 / 教養≥1), 夢幻遺跡 (master exempt, but
    // the gate is master-aware). The fail message mirrors `@MAP_CANNOT_WORD_0`.
    execCheck: (ctx) => {
      const r = mapCanMove(ctx.state, m.toLocation, ctx.state.master);
      if (!r.can) {
        const message =
          r.message ??
          (r.reason === 2
            ? "无论如何也进不去" // 虫籠 — 小人 only
            : r.reason === 1
              ? "没有找到路" // 三妖精之家
              : "进不去"); // reason 3 (大別墅 DLC) / fallback
        return { ok: false, reason: { kind: "precondition", message } };
      }
      // 私室施錠 — a sleeping resident's locked 私室 turns the master away
      // (COMF400.ERB:586-605; the 潜入 sneak-in branch is deferred, see
      // room-lock.ts). Mirrors the colored-map walk gate in skip-move.ts.
      const sleeper = lockedRoomOwner(ctx.state, m.toLocation);
      if (sleeper) {
        return { ok: false, reason: { kind: "precondition", message: lockedRoomMessage(sleeper) } };
      }
      return { ok: true };
    },
    handler: (ctx) => {
      const next = cloneGameState(ctx.state);
      // setSlotLocation keeps CFLAG[300]現在位置 in sync with the location
      // string — the single-source-of-truth bridge (2026-06-23 two-track fix).
      setSlotLocation(next.master, m.toLocation);
      const minutes = m.timeCost ?? 1;
      advanceTimeTicks(next, minutes);
      // Parity QA P-6b: brought-along (CFLAG:同行) companions follow the
      // master step-by-step (location sync + 体力 drain), faithful to the
      // upstream move subsystem's companion loop.
      followCompanions(next, minutes);
      const activityEvents = pitfallArrivalEvents(next, m.toLocation, ctx.now());
      return {
        state: next,
        events: [
          ...activityEvents,
          {
            kind: "NARRATION" as const,
            timestamp: ctx.now(),
            text: `%CALLNAME:MASTER% 移动到 ${m.toLocation}。`,
          },
        ],
        outcome: "ok" as const,
      };
    },
  }));
}
