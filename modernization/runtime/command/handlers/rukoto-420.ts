/**
 * COMF420 る～ことと話す — talk with the base's helper fairy (留琴 / 女仆妖精 /
 * 丧尸妖精 by map). A Lv1 daily QoL/info command, faithful to
 * `ERB/コマンド関連/COMF/日常系/COMF420 る～ことと話す.ERB`.
 *
 * Upstream @COM420 opens a menu: [0 想找人 / 1 想做扫除 / 2 git flavor / 100 返回].
 *   - 想找人 → HITOSAGASI: locate the people in this base (who is in which room).
 *   - 想做扫除 → OHEYA_CHECK: each room's cleanliness overview.
 * Both are pure info reads over existing state (chara locations + YOGORE).
 *
 * Modern V1: a single-shot B9 `pick_one` (the upstream nested INPUT loops can't
 * nest in the one-shot prompt model — see farm.ts), each choice emits an info
 * NARRATION. The nested "navigate to that person/room" (UI_EXECUTE_MOVE) is
 * deferred — the map UI already navigates. Faithful gate (@COM_ABLE420):
 * AT_HOME(MASTER) && !FLAG:70. Info branches consume no turn (upstream RETURN -1).
 */
import type { HandlerEntry } from "../types.js";
import type { GameState } from "../../state/game-state.js";
import { cloneGameState } from "../../state/game-state.js";
import { FLAG_ID, CFLAG_ID } from "../../state/settlement.js";
import { pickOne, requirePickOne, type PromptSpec } from "../prompt.js";
import { atPlayerBase, mapKeyOf, mapIdOfLocation } from "../../world/location-predicates.js";
import { getCleanlinessLabel } from "../../state/yogore.js";
import { LOCATION_PLACE_FLAGS } from "../../world/place-flags-data.js";

/** @COM420_DISPLAY — the helper's name varies by map (神社0 / 紅魔館3 / 地底9).
 *  Other base maps default to 留琴 (rather than upstream's nameless fallback). */
function helperName(state: GameState): string {
  switch (mapIdOfLocation(state.master.location)) {
    case 3:
      return "女仆妖精";
    case 9:
      return "丧尸妖精";
    default:
      return "留琴";
  }
}

function menuPrompt(state: GameState): PromptSpec {
  const who = helperName(state);
  return pickOne(`和${who}说话：「你有什么事吗？」`, [
    { id: 0, label: "想找人", detail: "看看谁在这个据点、都在哪个房间" },
    { id: 1, label: "想做扫除", detail: "查看各房间的清洁度" },
    { id: 2, label: "关于 git 控制系统", detail: `${who}的碎碎念` },
    { id: 100, label: "什么也不做" },
  ]);
}

/** HITOSAGASI (essence): who is in the master's current base map, and where.
 *  Shared with COMF422 天の声を聞く (the superset info command). */
export function findPeopleLines(state: GameState): string[] {
  const masterMap = mapKeyOf(state.master.location);
  const lines: string[] = [];
  for (const slot of Object.values(state.charas)) {
    if (!slot.location || mapKeyOf(slot.location) !== masterMap) continue;
    lines.push(`${slot.callName ?? `#${slot.charaNum}`}：${slot.location}`);
  }
  lines.sort();
  return lines.length > 0 ? lines : ["现在这里没有其他人。"];
}

/** OHEYA_CHECK (essence): each room in the current map + its cleanliness.
 *  Shared with COMF422 天の声を聞く. */
export function cleanlinessLines(state: GameState): string[] {
  const masterMap = mapKeyOf(state.master.location);
  const lines: string[] = [];
  for (const location of Object.keys(LOCATION_PLACE_FLAGS)) {
    if (mapKeyOf(location) !== masterMap) continue;
    lines.push(`${location}：清洁度 ${getCleanlinessLabel(state, location)}`);
  }
  return lines.length > 0 ? lines : ["这里没有可查看的房间。"];
}

/** @COM420 CASE 2 — the author's git flavor gag (verbatim-faithful). */
const GIT_FLAVOR = [
  "「使用 git 控制系统的话，可以把补丁一次性整合起来哦」",
  "「有 git 控制系统就能很简单地把握变更的地方」",
  "「过去的代码也能很好地得到保存」",
  "好像很厉害的样子。",
];

export const rukoto420HandlerEntry: HandlerEntry = {
  commandNo: 420,
  prompt: (ctx) => menuPrompt(ctx.state),
  execCheck: (ctx) => {
    // @COM_ABLE420 (COMF420:462-493): 时停中不可 / 非据点不可 / 且必须与「助手」
    // 同房间才显示 —— 上游按 MAIN_MAP 分支判定助手在场.
    if ((ctx.state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0)
      return { ok: false, reason: { kind: "precondition", message: "时间停止中无法交谈。" } };
    if (!atPlayerBase(ctx.state, 0))
      return { ok: false, reason: { kind: "precondition", message: "只有在据点里才能找到帮手。" } };
    // 助手在场判定，逐 MAIN_MAP 忠实：
    //   CASE 0 (神社): 留琴 = Chara #2 —— 睡眠中不可 (ERB:480)，且必须与主角
    //                  同房间 (ERB:483 `CFLAG:MASTER:現在位置 != CFLAG:2:現在位置`).
    //   CASE 3/9 (紅魔館/地底): 特定房间 (323/923) 的 女仆妖精/丧尸妖精 —— 那两间
    //                  房间在现代地图中尚未建，忠实 block (未建=助手不在场).
    //   CASEELSE: 不可 (ERB:491-492).
    const mapId = mapIdOfLocation(ctx.state.master.location);
    if (mapId === 0) {
      const rukoto = ctx.state.charas[2];
      if (!rukoto || (rukoto.state.CFLAG[CFLAG_ID.睡眠] ?? 0) !== 0)
        return { ok: false, reason: { kind: "precondition", message: "留琴现在不在，或正在休息。" } };
      if (rukoto.location !== ctx.state.master.location)
        return { ok: false, reason: { kind: "precondition", message: "这里没有留琴。" } };
    } else {
      // 紅魔館(3)/地底(9) 的助手房间未建 + 其余地图 CASEELSE → 助手不在场.
      return { ok: false, reason: { kind: "precondition", message: "这里没有可以搭话的帮手。" } };
    }
    return { ok: true };
  },
  handler: (ctx) => {
    const next = cloneGameState(ctx.state);
    const picked = requirePickOne(menuPrompt(next), ctx.promptAnswer);
    const who = helperName(next);
    let lines: string[];
    switch (picked) {
      case 0:
        lines = [`${who}告诉了你现在各人的所在：`, ...findPeopleLines(next)];
        break;
      case 1:
        lines = [`${who}说起了各处的清洁情况：`, ...cleanlinessLines(next)];
        break;
      case 2:
        lines = GIT_FLAVOR;
        break;
      default:
        lines = ["「没什么事的话，我就先忙了。」"];
    }
    return {
      state: next,
      events: lines.map((text) => ({ kind: "NARRATION" as const, timestamp: ctx.now(), text })),
      outcome: "noop" as const,
    };
  },
};
