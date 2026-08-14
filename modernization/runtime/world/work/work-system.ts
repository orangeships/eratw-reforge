/** Daily work-instance lifecycle for `仕事内容設定` / `CHARA_JOBSTR/JOBEND`. */

import type { ObservationEvent } from "../../../schemas/types.js";
import type { Rng } from "../../command/types.js";
import type { CharaSlot, GameState, WorkRuntimeEntry } from "../../state/game-state.js";
import { addItem } from "../../state/items.js";
import { getYogore } from "../../state/yogore.js";
import {
  ABL_ID,
  BASE_ID,
  CFLAG_ID,
  TALENT_ID,
  TCVAR_ID,
} from "../../state/settlement.js";
import { betweenTime } from "./visit.js";
import { JOB_ID, workEntriesForDay } from "./work-manifest.js";
import { roomIdToLocation } from "../room-id-location.js";

const ACTION_WORKING = 5;

/** Banquet setup/participation/pass-out jobs are owned by the banquet event,
 * not by the ordinary daily-work lifecycle. */
export function isEventManagedWork(jobType: number): boolean {
  return [JOB_ID.宴会準備, JOB_ID.宴会参加, JOB_ID.宴会片づけ, JOB_ID.酔いつぶれる].includes(jobType as never);
}

function fallbackRoll(state: GameState, charaNum: number, max: number): number {
  const n = Math.imul(state.time.dayIndex + 1, 1103515245) ^ Math.imul(charaNum + 17, 2654435761);
  return (n >>> 0) % Math.max(1, max);
}

function roll(state: GameState, rng: Rng | undefined, charaNum: number, max: number): number {
  return rng ? rng.int(max) : fallbackRoll(state, charaNum, max);
}

function shiftDuration(startMin: number, endMin: number): number {
  return endMin >= startMin ? endMin - startMin : endMin + 1440 - startMin;
}

/** Build today's serializable work instances once. Old saves already in a
 * live work action are adopted rather than refilled. */
export function ensureWorkRuntime(state: GameState, rng?: Rng): void {
  if (state.workRuntime?.dayIndex === state.time.dayIndex) return;
  const previous = state.workRuntime;
  const entries: WorkRuntimeEntry[] = [];

  for (const slot of Object.values(state.charas)) {
    for (const entry of workEntriesForDay(state, slot.charaNum)) {
      const max = entry.policy.attendanceMax;
      const komachiForced = slot.charaNum === 76 && (state.time.season ?? 1) === 2 &&
        (state.time.date ?? 1) >= 1 && (state.time.date ?? 1) <= 15;
      if (max && !komachiForced && roll(state, rng, slot.charaNum, max) === 0) continue;
      const giftId = entry.policy.giftChoices?.length
        ? entry.policy.giftChoices[roll(state, rng, slot.charaNum + entry.startMin, entry.policy.giftChoices.length)]!
        : (entry.policy.giftId ?? 0);
      const workload = entry.policy.workload ?? shiftDuration(entry.startMin, entry.endMin) * 10;
      const workRoomId = entry.policy.roomChoices?.length
        ? entry.policy.roomChoices[roll(state, rng, slot.charaNum + entry.endMin, entry.policy.roomChoices.length)]!
        : entry.workRoomId;
      entries.push({
        entryKey: entry.entryKey,
        charaNum: slot.charaNum,
        jobType: entry.jobType,
        startMin: entry.startMin,
        endMin: entry.endMin,
        workRoomId,
        location: roomIdToLocation(workRoomId) ?? entry.location,
        workload,
        wage: entry.policy.wage ?? 0,
        noHelp: entry.policy.noHelp ?? 0,
        giftId,
        status: "ready",
      });
    }
  }

  state.workRuntime = { dayIndex: state.time.dayIndex, entries };
  for (const slot of Object.values(state.charas)) {
    if ((slot.state.CFLAG[CFLAG_ID.行动] ?? 0) === ACTION_WORKING &&
        isEventManagedWork(slot.state.CFLAG[CFLAG_ID.职种] ?? 0)) continue;
    const liveOldSave = !previous && (slot.state.CFLAG[CFLAG_ID.行动] ?? 0) === ACTION_WORKING;
    if (liveOldSave) {
      const current = entries.find((entry) =>
        entry.charaNum === slot.charaNum && entry.jobType === (slot.state.CFLAG[CFLAG_ID.职种] ?? 0));
      if (current) {
        current.status = "active";
        const minute = ((state.time.tickValue % 1440) + 1440) % 1440;
        if ((slot.state.BASE[BASE_ID.仕事量] ?? 0) <= 0 &&
            betweenTime(current.startMin, current.endMin, minute)) {
          slot.state.BASE[BASE_ID.仕事量] = current.workload;
          slot.state.MAXBASE[BASE_ID.仕事量] = current.workload;
        }
        continue;
      }
    }
    slot.state.BASE[BASE_ID.仕事量] = 0;
    slot.state.MAXBASE[BASE_ID.仕事量] = 0;
    slot.state.TCVAR[TCVAR_ID.工资] = 0;
    slot.state.TCVAR[TCVAR_ID.没法帮忙] = 0;
    slot.state.TCVAR[TCVAR_ID.工作礼物] = 0;
    slot.state.TCVAR[TCVAR_ID.工作開始] = -1;
    slot.state.TCVAR[TCVAR_ID.工作結束] = -1;
    slot.state.TCVAR[TCVAR_ID.帮忙工作量_TARGET] = 0;
    if ((slot.state.CFLAG[CFLAG_ID.行动] ?? 0) === ACTION_WORKING) {
      slot.state.CFLAG[CFLAG_ID.行动] = 0;
      slot.state.CFLAG[CFLAG_ID.职场] = 0;
      slot.state.CFLAG[CFLAG_ID.职种] = 0;
    }
  }
}

export function workRuntimeEntryAt(
  state: GameState,
  charaNum: number,
  minute: number,
): WorkRuntimeEntry | null {
  ensureWorkRuntime(state);
  return state.workRuntime!.entries.find((entry) =>
    entry.charaNum === charaNum &&
    entry.status !== "completed" &&
    betweenTime(entry.startMin, entry.endMin, minute)) ?? null;
}

function applyDynamicRules(state: GameState, slot: CharaSlot, entry: WorkRuntimeEntry, minute: number): void {
  if (slot.charaNum === 1) {
    const candidates = [1, 2, 3, 4, 5, 6, 22]
      .filter((roomId) => getYogore(state, roomIdToLocation(roomId) ?? "") > 1000);
    if (candidates.length > 0) {
      entry.workRoomId = candidates.reduce((best, roomId) =>
        getYogore(state, roomIdToLocation(roomId) ?? "") > getYogore(state, roomIdToLocation(best) ?? "")
          ? roomId : best);
      entry.location = roomIdToLocation(entry.workRoomId) ?? entry.location;
    }
  } else if (slot.charaNum === 11) {
    entry.jobType = minute >= 16 * 60 ? JOB_ID.戦闘 : JOB_ID.採集;
    entry.workRoomId = minute >= 16 * 60 ? 11 : 6;
    entry.location = roomIdToLocation(entry.workRoomId) ?? entry.location;
  } else if (slot.charaNum === 28) {
    entry.noHelp = (slot.state.BASE[BASE_ID.仕事量] ?? entry.workload) > 3000 ? 0 : 2;
  } else if (slot.charaNum === 29) {
    const educated = (state.master.state.ABL[ABL_ID.教養] ?? 0) >= 3;
    const trusted = (slot.state.CFLAG[CFLAG_ID.信頼度] ?? 0) >= 500;
    entry.noHelp = educated && trusted ? 0 : 1;
  } else if (slot.charaNum === 30) {
    const trusted = (slot.state.CFLAG[CFLAG_ID.信頼度] ?? 0) >= 300;
    if (minute <= 12 * 60 + 59) {
      entry.noHelp = 1;
      entry.wage = 0;
    } else if (minute >= 17 * 60 && trusted) {
      entry.noHelp = 0;
      entry.wage = 0;
    } else if ((state.master.state.ABL[ABL_ID.教養] ?? 0) >= 4 && trusted) {
      entry.noHelp = 2;
      entry.wage = 1;
    } else {
      entry.noHelp = 1;
      entry.wage = 0;
    }
  } else if (slot.charaNum === 43 && entry.jobType === JOB_ID.料理) {
    entry.workRoomId = minute >= 14 * 60 ? 212 : 218;
    entry.location = roomIdToLocation(entry.workRoomId) ?? entry.location;
  } else if (slot.charaNum === 44 && [15, 30].includes(state.time.date ?? 1)) {
    entry.jobType = (slot.state.TCVAR[354] ?? 0) > 25 ? JOB_ID.採集 : JOB_ID.商売;
  } else if (slot.charaNum === 67 || slot.charaNum === 160) {
    if (minute >= 14 * 60) {
      entry.jobType = JOB_ID.清掃;
      entry.noHelp = 0;
    } else if (minute >= 12 * 60 && minute <= 12 * 60 + 59) {
      entry.noHelp = 1;
    } else {
      const educated = (state.master.state.ABL[ABL_ID.教養] ?? 0) >= 3;
      const trusted = (slot.state.CFLAG[CFLAG_ID.信頼度] ?? 0) >= 50;
      entry.noHelp = educated && trusted ? 2 : 1;
    }
  } else if (slot.charaNum === 10) {
    entry.noHelp = entry.jobType === JOB_ID.戦闘 ? 0 : 1;
  } else if (slot.charaNum === 17) {
    entry.noHelp = entry.jobType === JOB_ID.会話 && minute < 12 * 60 ? 1 : 0;
  } else if (slot.charaNum === 72) {
    entry.noHelp = (state.master.state.TALENT[TALENT_ID.調合知識] ?? 0) !== 0 ? 2 : 1;
  } else if (slot.charaNum === 52 && entry.jobType === JOB_ID.調合) {
    entry.wage = (state.master.state.TALENT[TALENT_ID.調合知識] ?? 0) !== 0 ? 3 : 2;
  }
  if (slot.charaNum === 103) {
    const candidates = Array.from({ length: 12 }, (_, index) => 520 + index)
      .map((roomId) => roomId === 525 ? 528 : roomId);
    entry.workRoomId = candidates.reduce((best, roomId) =>
      getYogore(state, roomIdToLocation(roomId) ?? "") > getYogore(state, roomIdToLocation(best) ?? "")
        ? roomId : best, 520);
    entry.location = roomIdToLocation(entry.workRoomId) ?? entry.location;
  }
}

export function beginOrRefreshWork(
  state: GameState,
  slot: CharaSlot,
  entry: WorkRuntimeEntry,
  minute: number,
): void {
  if (entry.status === "ready") {
    entry.status = "active";
    slot.state.BASE[BASE_ID.仕事量] = entry.workload;
    slot.state.MAXBASE[BASE_ID.仕事量] = entry.workload;
    slot.state.TCVAR[TCVAR_ID.帮忙工作量_TARGET] = 0;
  }
  applyDynamicRules(state, slot, entry, minute);
  slot.state.CFLAG[CFLAG_ID.职场] = entry.workRoomId;
  slot.state.CFLAG[CFLAG_ID.职种] = entry.jobType;
  slot.state.CFLAG[CFLAG_ID.行动] = ACTION_WORKING;
  slot.state.TCVAR[TCVAR_ID.工资] = entry.wage;
  slot.state.TCVAR[TCVAR_ID.没法帮忙] = entry.noHelp;
  slot.state.TCVAR[TCVAR_ID.工作礼物] = entry.giftId;
  slot.state.TCVAR[TCVAR_ID.工作開始] = entry.startMin;
  slot.state.TCVAR[TCVAR_ID.工作結束] = entry.endMin;
}

export interface FinishWorkResult {
  events: ObservationEvent[];
  giftId: number;
}

export function finishWork(
  state: GameState,
  slot: CharaSlot,
  now: () => number,
): FinishWorkResult {
  const entry = state.workRuntime?.entries.find((candidate) =>
    candidate.charaNum === slot.charaNum && candidate.status === "active");
  if (entry) entry.status = "completed";
  const jobType = slot.state.CFLAG[CFLAG_ID.职种] ?? entry?.jobType ?? 0;
  const maxWork = slot.state.MAXBASE[BASE_ID.仕事量] ?? entry?.workload ?? 0;
  const helped = slot.state.TCVAR[TCVAR_ID.帮忙工作量_TARGET] ?? 0;
  const giftId = slot.state.TCVAR[TCVAR_ID.工作礼物] ?? entry?.giftId ?? 0;
  const visible = slot.location === state.master.location;
  const ordinary = jobType !== JOB_ID.遊び && !isEventManagedWork(jobType);
  let awarded = 0;
  const events: ObservationEvent[] = [];
  if (visible && ordinary && giftId > 0 && maxWork < helped * 3) {
    addItem(state, giftId, 1);
    awarded = giftId;
    events.push({ kind: "NARRATION", timestamp: now(), text: `${slot.callName ?? `#${slot.charaNum}`}から仕事のお礼をもらった。`, presentation: "ambient" });
  }
  if ((slot.state.CFLAG[CFLAG_ID.睡眠] ?? 0) === 0) {
    slot.state.TCVAR[TCVAR_ID.疲労度] = (slot.state.TCVAR[TCVAR_ID.疲労度] ?? 0) + Math.trunc(maxWork / 2);
  }
  slot.state.BASE[BASE_ID.仕事量] = 0;
  slot.state.CFLAG[CFLAG_ID.行动] = 0;
  slot.state.CFLAG[CFLAG_ID.职场] = 0;
  slot.state.CFLAG[CFLAG_ID.职种] = 0;
  return { events, giftId: awarded };
}
