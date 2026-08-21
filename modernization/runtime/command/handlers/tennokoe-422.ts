/**
 * COMF422 天の声を聞く — listen to the voice of heaven (御仏の声 at a temple).
 * A Lv1 daily QoL/info command, faithful to
 * `ERB/コマンド関連/COMF/日常系/COMF422 天の声を聞く.ERB`.
 *
 * Upstream @COM422 is a superset of 420 る～こと's menu:
 *   [0 想找人 / 1 想做扫除 / 2 想找住在外面的人(广域) / 3 排行榜 / 4 追踪对象 /
 *    10 能力显示 / 11 采集列表 / 12 钓鱼列表 / 13 出现场所 / 100 返回].
 * V1 ports the three info-locator branches (同图找人 / 房间清洁度 / 广域找人),
 * reusing rukoto-420's shared helpers. Deferred (documented): 排行榜(RANKING) /
 * 追踪(STALKER) / 采集·钓鱼·能力·出现列表 — those either need unmodeled systems
 * or overlap the existing character-info / map / gathering UI panels.
 *
 * Faithful gate (@COM_ABLE422 + @天之声可): !FLAG:70, 诶嘿嘿!=2, and either a
 * room carrying 場所_天之声 (PLACE_SKY) or the player's own room after the
 * panty BONUS2 altar reward. Info branches consume no turn (upstream RETURN -1
 * for the locators).
 */
import type { HandlerEntry } from "../types.js";
import type { GameState } from "../../state/game-state.js";
import { cloneGameState } from "../../state/game-state.js";
import { CFLAG_ID, FLAG_ID } from "../../state/settlement.js";
import { pickOne, requirePickOne, type PromptSpec } from "../prompt.js";
import { canHearHeaven, mapKeyOf } from "../../world/location-predicates.js";
import { findPeopleLines, cleanlinessLines } from "./rukoto-420.js";

function menuPrompt(): PromptSpec {
  return pickOne("你静下心来，倾听天之声…", [
    { id: 0, label: "想找人", detail: "此地都有谁、在哪个房间" },
    { id: 1, label: "想做扫除", detail: "各房间的清洁度" },
    { id: 2, label: "想找住在外面的人", detail: "广域探查：其它据点都有谁" },
    { id: 100, label: "结束倾听" },
  ]);
}

/** BROAD_HITOSAGASI (essence): everyone grouped by their current base map,
 *  excluding the master's own map (that's the local 找人 branch). */
function broadFindLines(state: GameState): string[] {
  const masterMap = mapKeyOf(state.master.location);
  const byMap = new Map<string, string[]>();
  for (const slot of Object.values(state.charas)) {
    if (!slot.location) continue;
    const map = mapKeyOf(slot.location);
    if (map === masterMap) continue;
    const name = slot.callName ?? `#${slot.charaNum}`;
    if (!byMap.has(map)) byMap.set(map, []);
    byMap.get(map)!.push(`${name}：${slot.location}`);
  }
  if (byMap.size === 0) return ["其它地方没有找到人。"];
  const lines: string[] = [];
  for (const map of [...byMap.keys()].sort()) {
    lines.push(`【${map}】`);
    for (const l of byMap.get(map)!.sort()) lines.push(`  ${l}`);
  }
  return lines;
}

export const tennokoe422HandlerEntry: HandlerEntry = {
  commandNo: 422,
  prompt: () => menuPrompt(),
  execCheck: (ctx) => {
    if ((ctx.state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0)
      return { ok: false, reason: { kind: "precondition", message: "时间停止中，听不到天之声。" } };
    if ((ctx.state.master.state.CFLAG[CFLAG_ID.诶嘿嘿] ?? 0) === 2)
      return { ok: false, reason: { kind: "precondition", message: "现在没有心思倾听。" } };
    if (!canHearHeaven(ctx.state))
      return {
        ok: false,
        reason: { kind: "precondition", message: "这里听不到天之声（需在能通天的地方，或拥有祭坛时回到自室）。" },
      };
    return { ok: true };
  },
  handler: (ctx) => {
    const next = cloneGameState(ctx.state);
    const picked = requirePickOne(menuPrompt(), ctx.promptAnswer);
    let lines: string[];
    switch (picked) {
      case 0:
        lines = ["天之声告知了此地各人的所在：", ...findPeopleLines(next)];
        break;
      case 1:
        lines = ["天之声道出了各处的清洁情况：", ...cleanlinessLines(next)];
        break;
      case 2:
        lines = ["天之声传来了远方各据点的动静：", ...broadFindLines(next)];
        break;
      default:
        lines = ["你停止了倾听。"];
    }
    return {
      state: next,
      events: lines.map((text) => ({ kind: "NARRATION" as const, timestamp: ctx.now(), text })),
      outcome: "noop" as const,
    };
  },
};
