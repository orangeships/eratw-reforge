/**
 * eraTW work schedule manifest, transcribed from
 * `ERB/MOVEMENTS/JOB_仕事内容.ERB`.
 *
 * Upstream work setup assigns `工作開始`, `工作結束`, `職場` and `職種`.
 * The scheduler consumes this table to move NPCs to the same room during the
 * same window. Conditions that depend on currently unmodeled flags such as
 * storm forecasts, pregnancy self-awareness, or one-off random skips keep the
 * normal branch only; entries still use original time, room and job type.
 */

import type { GameState } from "../../state/game-state.js";
import { ITEM_ID } from "../../state/items.js";
import { CFLAG_ID, FLAG_ID, TALENT_ID } from "../../state/settlement.js";
import { getTflag, TFLAG_ID } from "../../state/tflag.js";
import { getYogore } from "../../state/yogore.js";
import {
  dateOf,
  festivalNow,
  isWeekday,
  isWeekend,
  seasonOf,
  youbiMatch,
} from "../calendar.js";
import { mapIdOfLocation } from "../location-predicates.js";
import { roomIdToLocation } from "../room-id-location.js";
import { betweenTime } from "./visit.js";

/** Per-entry evaluation context. `dayIndex` from `state.time.dayIndex`. */
export interface WorkCtx {
  state: GameState;
  dayIndex: number;
}

type WorkCond = (ctx: WorkCtx) => boolean;
type WorkValue = number | ((ctx: WorkCtx) => number);
type ClockSpec = readonly [number, number] | WorkValue;

/** `CLOCK_TO_TIME(h, m)` — minutes-of-day. Faithful to the ERB macro. */
function clock(h: number, m: number): number {
  return h * 60 + m;
}

/** Canonical eraTW `職種` ids used by both scheduling and work presentation. */
export const JOB_ID = {
  清掃: 40,
  会話: 41,
  戦闘: 42,
  教養: 43,
  料理: 44,
  音楽: 45,
  遊び: 46,
  商売: 47,
  宴会準備: 48,
  宴会参加: 49,
  宴会片づけ: 50,
  酔いつぶれる: 51,
  お酒: 52,
  家事: 53,
  採集: 54,
  釣り: 55,
  調合: 56,
} as const;

const JOB = JOB_ID;

/** eraTW `職種` (CFLAG:350) labels for narration. */
export const JOB_LABEL: Readonly<Record<number, string>> = {
  [JOB.清掃]: "清掃",
  [JOB.会話]: "会話",
  [JOB.戦闘]: "戦闘",
  [JOB.教養]: "教養",
  [JOB.料理]: "料理",
  [JOB.音楽]: "音楽",
  [JOB.遊び]: "遊び",
  [JOB.商売]: "商売",
  [JOB.宴会準備]: "宴会準備",
  [JOB.宴会参加]: "宴会参加",
  [JOB.宴会片づけ]: "宴会の片づけ",
  [JOB.酔いつぶれる]: "酔いつぶれる",
  [JOB.お酒]: "お酒",
  [JOB.家事]: "家事",
  [JOB.採集]: "採集",
  [JOB.釣り]: "釣り",
  [JOB.調合]: "調合",
};

export interface WorkEntry {
  charaNum: number;
  /** `職種` id (40=清掃 …). */
  jobType: number;
  startMin: WorkValue;
  endMin: WorkValue;
  /** `職場` — eraTW room id (the Pnnn number, e.g. 222 = P222寺子屋). */
  workRoomId: WorkValue;
  /** Day-condition (weekday/calendar/dirt/money/festival). */
  cond: WorkCond;
}

/** Per-shift values written by upstream `仕事内容設定`. Missing values are
 * raw zero; ordinary workload defaults to shift minutes × 10, matching the
 * upstream `600 * hours` convention. */
export interface WorkPolicy {
  workload?: number;
  wage?: number;
  noHelp?: 0 | 1 | 2;
  giftId?: number;
  giftChoices?: readonly number[];
  roomChoices?: readonly number[];
  /** Upstream `RAND:max != 0` attendance check. */
  attendanceMax?: number;
}

const ALWAYS: WorkCond = () => true;
const WEEKDAY: WorkCond = ({ dayIndex }) => isWeekday(dayIndex);
const WEEKEND: WorkCond = ({ dayIndex }) => isWeekend(dayIndex);
const NO_FESTIVAL: WorkCond = ({ state }) => festivalNow(state.time) === "";

function eraDay({ dayIndex }: WorkCtx): number {
  return dayIndex + 1;
}

function onYoubi(youbi: string): WorkCond {
  return ({ dayIndex }) => youbiMatch(dayIndex, youbi);
}

function all(...conds: readonly WorkCond[]): WorkCond {
  return (ctx) => conds.every((cond) => cond(ctx));
}

function not(cond: WorkCond): WorkCond {
  return (ctx) => !cond(ctx);
}

function eraDayMod(divisor: number, remainder: number): WorkCond {
  return (ctx) => eraDay(ctx) % divisor === remainder;
}

function dateIs(...dates: readonly number[]): WorkCond {
  return ({ state }) => dates.includes(dateOf(state.time));
}

function dateIn(start: number, end: number): WorkCond {
  return ({ state }) => {
    const date = dateOf(state.time);
    return date >= start && date <= end;
  };
}

function dateMod(divisor: number, remainder: number): WorkCond {
  return ({ state }) => dateOf(state.time) % divisor === remainder;
}

function seasonIs(season: number): WorkCond {
  return ({ state }) => seasonOf(state.time) === season;
}

function seasonBefore(season: number): WorkCond {
  return ({ state }) => seasonOf(state.time) < season;
}

function festivalIs(name: string): WorkCond {
  return ({ state }) => festivalNow(state.time) === name;
}

function work(
  charaNum: number,
  jobType: number,
  start: ClockSpec,
  end: ClockSpec,
  roomId: WorkValue,
  cond: WorkCond = ALWAYS,
): WorkEntry {
  return {
    charaNum,
    jobType,
    startMin: toWorkValue(start),
    endMin: toWorkValue(end),
    workRoomId: roomId,
    cond,
  };
}

function sharedWork(
  charaNums: readonly number[],
  jobType: number,
  start: ClockSpec,
  end: ClockSpec,
  roomId: WorkValue,
  cond: WorkCond = ALWAYS,
): WorkEntry[] {
  return charaNums.map((charaNum) => work(charaNum, jobType, start, end, roomId, cond));
}

function toWorkValue(spec: ClockSpec): WorkValue {
  return isClockSpecTuple(spec) ? clock(spec[0], spec[1]) : spec;
}

function resolveValue(value: WorkValue, ctx: WorkCtx): number {
  return typeof value === "function" ? value(ctx) : value;
}

function isClockSpecTuple(spec: ClockSpec): spec is readonly [number, number] {
  return Array.isArray(spec);
}

const SHRINE_CLEANING_IDS = [1, 2, 3, 4, 5, 6] as const;

function yogoreForRoomId(state: GameState, roomId: number): number {
  const location = roomIdToLocation(roomId);
  return location ? getYogore(state, location) : 0;
}

function reimuCleaningRoomId(ctx: WorkCtx): number {
  if (yogoreForRoomId(ctx.state, 22) > 1000) return 22;
  let bestId = 0;
  let bestYogore = 0;
  for (const roomId of SHRINE_CLEANING_IDS) {
    const yogore = yogoreForRoomId(ctx.state, roomId);
    if (yogore > bestYogore) {
      bestId = roomId;
      bestYogore = yogore;
    }
  }
  return bestId;
}

function hasReimuCleaningTarget(ctx: WorkCtx): boolean {
  const roomId = reimuCleaningRoomId(ctx);
  return roomId > 0 && yogoreForRoomId(ctx.state, roomId) > 1000;
}

function fairyPlayRoomId(ctx: WorkCtx): number {
  switch (eraDay(ctx) % 4) {
    case 0:
      return 32; // 桑尼私室
    case 1:
      return 25; // 鎮守之森
    case 2:
      return 2; // 境内
    default:
      return 27; // 三妖精之家・大廳
  }
}

function kogasaWorkRoomId(ctx: WorkCtx): number {
  return youbiMatch(ctx.dayIndex, "火") ? 104 : 222;
}

function patchouliEndMin(ctx: WorkCtx): number {
  const favorLike = ctx.state.charas[54]?.state.CFLAG[2] ?? 0;
  if (favorLike < 100) return clock(23, 0);
  if (favorLike < 500) return clock(20, 0);
  if (favorLike < 1000) return clock(14, 0);
  if (favorLike < 3000) return clock(12, 0);
  return clock(10, 0);
}

function patchouliWorks(ctx: WorkCtx): boolean {
  const love = ctx.state.charas[54]?.state.TALENT[TALENT_ID.恋慕] ?? 0;
  return love === 0 || youbiMatch(ctx.dayIndex, "土");
}

function shrineDirtAbove(roomId: number, threshold: number): WorkCond {
  return ({ state }) => yogoreForRoomId(state, roomId) > threshold;
}

function weatherIs(weatherId: number): WorkCond {
  return ({ state }) => (state.weather?.gensokyoWeatherSystem?.[0] ?? 0) === weatherId;
}

const WEATHER_BELOW_2: WorkCond = ({ state }) =>
  (state.weather?.gensokyoWeatherSystem?.[0] ?? 0) < 2;

function hinaWorkRoomId({ state }: WorkCtx): number {
  const candidates = [701, 702, 705, 707, 710, 711, 731, 732, 738, 739];
  return candidates.reduce((room, candidate) =>
    yogoreForRoomId(state, candidate) > 1000 ? candidate : room, 701);
}

const NOT_WEEKEND: WorkCond = not(WEEKEND);
const CALM: WorkCond = ({ state }) => getTflag(state, TFLAG_ID.大荒れ予報の日) === 0;
const NOT_PREGNANT_AWARE = (charaNum: number): WorkCond => ({ state }) =>
  (state.charas[charaNum]?.state.CFLAG[CFLAG_ID.妊娠自覚状態] ?? 0) === 0;

/** Source: first `SELECTCASE ARG` in `JOB_仕事内容.ERB`. */
export const WORK_MANIFEST: ReadonlyArray<WorkEntry> = [
  // Shrine-root jobs.
  work(1, JOB.清掃, [6, 0], [8, 0], reimuCleaningRoomId, all(hasReimuCleaningTarget, CALM)),
  work(159, JOB.清掃, [6, 0], [11, 0], 22, shrineDirtAbove(22, 1000)),
  work(2, JOB.料理, [18, 0], [21, 0], 8, WEEKDAY),
  work(4, JOB.戦闘, [16, 0], [19, 0], 11, all(onYoubi("月水"), CALM)),
  ...sharedWork([5, 6, 7, 13, 14], JOB.遊び, [10, 0], [17, 0], fairyPlayRoomId, WEEKEND),
  work(8, JOB.教養, [6, 0], [12, 0], 49, WEEKDAY),
  work(9, JOB.教養, [11, 0], [17, 0], 49, WEEKDAY),
  work(10, JOB.お酒, [16, 0], [21, 0], 10, all(onYoubi("月"), NOT_PREGNANT_AWARE(10))),
  work(10, JOB.戦闘, [16, 0], [19, 0], 11, all(onYoubi("水"), CALM)),
  work(11, JOB.採集, [13, 0], [19, 0], 6, all(onYoubi("月"), CALM)),
  work(26, JOB.教養, [13, 0], [24, 0], 4, all(seasonIs(4), dateIs(30))),
  work(33, JOB.料理, [11, 0], [13, 0], 8, ({ state }) => state.money < 500),
  work(34, JOB.会話, [10, 0], [10, 10], 3, onYoubi("土")),
  work(57, JOB.音楽, [10, 0], [13, 0], 2, all(festivalIs("例大祭"), CALM)),
  work(57, JOB.音楽, [10, 0], [13, 0], 11, all(onYoubi("日"), CALM)),

  // Shared girls' gathering helper: Sunday, second week, 18-21 at P211.
  ...sharedWork([4, 26, 32, 55, 66, 72, 102, 124], JOB.お酒, [18, 0], [21, 0], 211, all(onYoubi("日"), dateIn(8, 14), CALM)),

  // Human village jobs.
  work(145, JOB.戦闘, [6, 0], [10, 0], 202),
  work(14, JOB.遊び, [6, 0], [7, 0], 343, all(NOT_WEEKEND, weatherIs(8))),
  work(14, JOB.商売, [10, 0], [15, 0], 202, all(NOT_WEEKEND, WEATHER_BELOW_2, seasonIs(2), CALM)),
  work(17, JOB.会話, [10, 0], [13, 0], 202, all(eraDayMod(14, 0), CALM)),
  work(17, JOB.料理, [10, 0], [12, 0], ({ state }) =>
    (state.flagStore[FLAG_ID.住宿人物] ?? 0) === 17 &&
    mapIdOfLocation(state.homeLocation ?? state.master.homeLocation ?? state.master.location) === 0 ? 8 : 525,
  dateIs(7, 16, 17, 27)),
  work(103, JOB.清掃, [7, 0], [11, 0], 520, onYoubi("月木")),
  ...sharedWork([20, 21, 22], JOB.音楽, [13, 0], [19, 0], 202, all(eraDayMod(28, 21), CALM)),
  work(23, JOB.家事, [13, 0], [16, 0], 216, all(onYoubi("水"), CALM)),
  work(25, JOB.教養, [10, 0], [16, 0], 4, dateIs(5, 20)),
  work(29, JOB.教養, [13, 0], [19, 0], 808, onYoubi("金")),
  work(30, JOB.教養, [9, 0], [19, 0], 612, eraDayMod(2, 0)),
  work(31, JOB.会話, [12, 0], [16, 0], 202, all(onYoubi("火金"), CALM)),
  work(32, JOB.教養, [9, 0], [12, 0], 222, all(seasonIs(2), dateIs(5), CALM)),
  work(36, JOB.戦闘, [7, 0], [12, 0], 928, WEEKDAY),
  work(37, JOB.戦闘, [10, 0], [13, 0], 929, WEEKDAY),
  work(35, JOB.会話, [20, 0], [21, 0], 830, onYoubi("火")),
  work(40, JOB.家事, [20, 0], [24, 0], kogasaWorkRoomId, all(onYoubi("火金"), CALM)),
  work(42, JOB.教養, [17, 0], ({ state }) =>
    (state.charas[42]?.state.CFLAG[CFLAG_ID.妊娠自覚状態] ?? 0) === 1 ? clock(20, 0) : clock(22, 0),
  212, all(onYoubi("土"), CALM)),
  work(43, JOB.料理, [11, 0], [16, 0], 217, all(onYoubi("土"), CALM)),
  work(43, JOB.戦闘, [7, 0], [9, 0], 722, not(all(onYoubi("土"), CALM))),
  work(44, JOB.商売, [14, 0], [19, 0], 202, all(dateIs(15, 30), CALM)),
  work(
    44,
    JOB.採集,
    [7, 0],
    [12, 0],
    ({ state, dayIndex }) => ((state.flagStore[FLAG_ID.每日变更事件] ?? 0) + dayIndex) % 2 === 0 ? 540 : 507,
    ({ state }) =>
      (state.weather?.gensokyoWeatherSystem?.[0] ?? 0) <= 3 &&
      (state.flagStore[FLAG_ID.每日变更事件] ?? 0) < 50 &&
      mapIdOfLocation(state.homeLocation ?? state.master.homeLocation ?? state.master.location) === 5 &&
      getTflag(state, TFLAG_ID.大荒れ予報の日) === 0 &&
      ![15, 30].includes(dateOf(state.time)),
  ),
  work(52, JOB.商売, [10, 0], [15, 0], 202, all(onYoubi("火"), CALM)),
  work(55, JOB.会話, [12, 0], [16, 0], 202, all(onYoubi("月木"), CALM)),
  work(67, JOB.教養, [8, 0], [14, 30], 222, all(WEEKDAY, NO_FESTIVAL, CALM)),
  work(160, JOB.教養, [8, 0], [14, 30], 222, all(WEEKDAY, NO_FESTIVAL)),
  work(70, JOB.商売, [9, 0], [17, 0], 213, onYoubi("水木")),
  work(70, JOB.清掃, [18, 0], [20, 0], 213, onYoubi("月火金")),
  work(80, JOB.教養, [10, 0], [13, 0], 221, dateIn(15, 20)),
  ...sharedWork([81, 82], JOB.教養, [19, 0], [21, 0], 232, dateIn(25, 28)),
  work(92, JOB.会話, [12, 0], [16, 0], 202, all(onYoubi("水土"), CALM)),
  ...sharedWork([94, 95], JOB.音楽, [15, 0], [21, 0], 202, all(eraDayMod(28, 7), CALM)),
  work(96, JOB.音楽, [15, 0], [21, 0], 202, all(eraDayMod(28, 7), CALM)),
  work(96, JOB.会話, [20, 0], [21, 0], 830, onYoubi("火")),
  work(91, JOB.会話, [20, 0], [21, 0], 830, onYoubi("火")),
  work(134, JOB.料理, [18, 0], [24, 0], 238, onYoubi("水木金土日")),

  // 命蓮寺 / 霊廟 jobs.
  work(12, JOB.戦闘, [22, 0], [24, 0], 140, onYoubi("火")),
  work(56, JOB.戦闘, [13, 0], [16, 0], 126, onYoubi("月水金")),
  work(85, JOB.清掃, [7, 0], [12, 0], 102, all(onYoubi("火木"), CALM)),
  work(87, JOB.会話, [13, 0], [14, 0], 103, onYoubi("金")),
  work(87, JOB.教養, [10, 0], [14, 0], 103, all(WEEKDAY, not(onYoubi("金")))),
  work(89, JOB.清掃, [8, 0], [23, 0], 121, all(dateIs(4), CALM)),
  work(90, JOB.清掃, [8, 0], [23, 0], 121, all(dateIs(4), CALM)),

  // 紅魔館 / 霧之湖 jobs.
  work(15, JOB.清掃, [8, 0], [12, 0], 309, onYoubi("月水金")),
  work(15, JOB.料理, [17, 0], [19, 0], 313, onYoubi("月水金")),
  work(16, JOB.教養, [18, 30], [19, 0], 327, all(onYoubi("日"), CALM)),
  work(41, JOB.料理, [22, 0], [23, 0], 313, dateIs(6)),
  work(50, JOB.遊び, [20, 0], [21, 0], 329, eraDayMod(2, 1)),
  work(54, JOB.教養, [8, 0], patchouliEndMin, 310, patchouliWorks),
  work(58, JOB.戦闘, [6, 0], [12, 0], 301, WEEKDAY),
  work(59, JOB.料理, [22, 0], [23, 0], 313, dateIs(6)),
  work(60, JOB.戦闘, [13, 0], [18, 0], 946, WEEKDAY),
  work(97, JOB.会話, [20, 0], [24, 0], 301, all(onYoubi("月水"), CALM)),

  // 永遠亭 / 迷途竹林 jobs.
  work(28, JOB.料理, [16, 0], [24, 0], 444, all(eraDayMod(3, 0), CALM)),
  work(52, JOB.調合, [10, 0], [18, 0], 405, onYoubi("木")),
  work(62, JOB.教養, [13, 0], [19, 0], 401, all(seasonIs(3), dateIs(14))),
  work(62, JOB.清掃, [13, 0], [14, 0], 421, all(not(all(seasonIs(3), dateIs(14))), ({ state }) => (state.charas[62]?.state.CFLAG[CFLAG_ID.诶嘿嘿] ?? 0) === 0, CALM)),
  work(64, JOB.お酒, [16, 0], [21, 0], 10, onYoubi("木")),
  work(65, JOB.戦闘, [7, 0], [14, 0], 802, onYoubi("月火")),
  work(65, JOB.戦闘, [14, 0], [21, 0], 805, onYoubi("金土")),
  work(68, JOB.家事, [6, 0], [10, 0], 438, all(seasonBefore(4), dateMod(4, 2))),
  work(72, JOB.教養, [10, 0], [18, 0], 404, onYoubi("月火金")),
  work(75, JOB.採集, [7, 0], [13, 0], 436, all(eraDayMod(7, 3), CALM)),
  work(76, JOB.戦闘, [10, 0], [16, 0], 602, onYoubi("月水金")),
  work(79, JOB.清掃, [7, 0], [20, 0], hinaWorkRoomId, all(festivalIs("女兒節"), CALM)),
  work(79, JOB.清掃, [12, 0], [17, 0], hinaWorkRoomId, all(onYoubi("土"), not(festivalIs("女兒節")), CALM)),
  work(143, JOB.戦闘, [11, 0], [18, 0], 930, onYoubi("月水金")),
  work(129, JOB.戦闘, [9, 0], [15, 0], 640, WEEKDAY),
];

/**
 * Where should `charaNum` be right now for work? Returns the resolved work-room
 * location string if the character has a job whose day-condition holds and
 * `tickMin` is inside its `[startMin, endMin)` window.
 */
export function activeWorkRoom(
  state: GameState,
  charaNum: number,
  tickMin: number,
): string | null {
  return activeWorkEntry(state, charaNum, tickMin)?.location ?? null;
}

/**
 * Resolve every work branch enabled for this character on the current day.
 * Unlike `activeWorkEntry`, this deliberately does not filter by clock time;
 * information UIs use it to show today's complete schedule rather than a
 * partial, hand-authored CSTR summary.
 */
export function workEntriesForDay(
  state: GameState,
  charaNum: number,
  dayIndex: number = state.time.dayIndex,
): ActiveWorkEntry[] {
  if (!canHaveOrdinaryWork(state, charaNum)) return [];
  const ctx: WorkCtx = { state, dayIndex };
  return WORK_MANIFEST.flatMap((entry) => {
    if (entry.charaNum !== charaNum || !entry.cond(ctx)) return [];
    const resolved = resolveWorkEntry(entry, ctx);
    return resolved ? [resolved] : [];
  });
}

export interface ActiveWorkEntry extends Omit<WorkEntry, "startMin" | "endMin" | "workRoomId"> {
  startMin: number;
  endMin: number;
  workRoomId: number;
  /** Resolved modern location for `workRoomId`. */
  location: string;
  /** Stable within a manifest revision and persisted by the work lifecycle. */
  entryKey: string;
  policy: WorkPolicy;
}

function policyKey(charaNum: number, jobType: number, startMin: number): string {
  return `${charaNum}:${jobType}:${startMin}`;
}

const P = (wage = 0, noHelp: 0 | 1 | 2 = 0, giftId = 0, extra: WorkPolicy = {}): WorkPolicy => ({
  wage,
  noHelp,
  ...(giftId ? { giftId } : {}),
  ...extra,
});

/** Literal values from `JOB_仕事内容.ERB`. Only non-default policies need an
 * entry; unlisted shifts use workload=(end-start)*10, wage/noHelp/gift=0. */
const WORK_POLICY: Readonly<Record<string, WorkPolicy>> = {
  "159:40:360": P(0, 0, ITEM_ID.糖, { workload: 2400 }),
  "2:44:1080": P(2),
  "4:42:960": P(5, 0, ITEM_ID.糖),
  "8:43:360": P(3), "9:43:660": P(3),
  "10:42:960": P(1), "11:54:780": P(1),
  "26:43:780": P(5, 0, 0, { workload: 8400 }),
  "33:44:660": P(5), "34:41:600": P(0, 1),
  "57:45:600": P(0, 1),
  "4:52:1080": P(0, 1), "26:52:1080": P(0, 1), "32:52:1080": P(0, 1),
  "55:52:1080": P(0, 1), "66:52:1080": P(0, 1), "72:52:1080": P(0, 1),
  "102:52:1080": P(0, 1), "124:52:1080": P(0, 1),
  "145:42:360": P(3, 2, 0, { attendanceMax: 4 }),
  "14:46:360": P(),
  "5:46:600": P(0, 1), "6:46:600": P(0, 1), "7:46:600": P(0, 1),
  "13:46:600": P(0, 1), "14:46:600": P(0, 1),
  "14:47:600": P(0, 0, ITEM_ID.冰淇淋),
  "17:41:600": P(5, 1, ITEM_ID.糖),
  "17:44:600": P(0, 0, ITEM_ID.糖),
  "103:40:420": P(3, 0, ITEM_ID.紅茶),
  "20:45:780": P(5, 1), "21:45:780": P(5, 1), "22:45:780": P(5, 1),
  "23:53:780": P(3), "31:41:720": P(3),
  "25:43:600": P(5),
  "29:43:780": P(4, 0, 0, { workload: 2400 }), "30:43:540": P(0, 1),
  "32:43:540": P(0, 0, ITEM_ID.槲葉糕),
  "40:53:1200": P(1), "42:43:1020": P(1),
  "43:44:660": P(0, 2), "43:42:420": P(0, 2),
  "44:47:840": P(3), "44:54:420": P(3, 2, 0, { roomChoices: [540, 507] }),
  "36:42:420": P(3, 2, 0, { workload: 5000 }), "37:42:600": P(2, 2),
  "35:41:1200": P(5),
  "52:47:600": P(3), "52:56:600": P(2),
  "55:41:720": P(3, 0, ITEM_ID.糖),
  "67:43:480": P(3), "160:43:480": P(3),
  "70:47:540": P(2, 2), "70:40:1080": P(3),
  "80:43:600": P(5), "81:43:1140": P(3), "82:43:1140": P(3),
  "92:41:720": P(3),
  "94:45:900": P(5, 1), "95:45:900": P(5, 1), "96:45:900": P(5, 1),
  "96:41:1200": P(5), "134:44:1080": P(2, 2),
  "91:41:1200": P(5),
  "12:42:1320": P(0, 0, ITEM_ID.來歷不明的肉),
  "56:42:780": P(1), "85:40:420": P(4),
  "87:41:780": P(0, 2), "89:40:480": P(0, 0, 0, { workload: 9600 }),
  "90:40:480": P(5, 2, 0, { workload: 9600 }),
  "15:40:480": P(5, 0, ITEM_ID.紅茶), "15:44:1020": P(5, 0, ITEM_ID.紅茶),
  "16:43:1110": P(5), "41:44:1320": P(5, 2),
  "54:43:480": P(0, 1), "58:42:360": P(2, 2),
  "59:44:1320": P(5), "97:41:1200": P(1),
  "28:44:960": P(2, 0, ITEM_ID.八目鰻烤串),
  "62:43:780": P(5, 2, 0, { giftChoices: [ITEM_ID.仙香玉兎, ITEM_ID.賢者の石, ITEM_ID.万能药, ITEM_ID.绯红之王] }),
  "62:40:780": P(0, 0, 0, { workload: 600 }),
  "68:53:360": P(2), "72:43:600": P(5, 2, ITEM_ID.大回復薬),
  "75:54:420": P(1),
  "76:42:600": P(2, 0, 0, { attendanceMax: 2 }),
  "79:40:420": P(2, 0, 0, { workload: 6000 }), "79:40:720": P(1),
  "60:42:780": P(2, 0, 0, { workload: 600 }),
  "64:52:960": P(0, 1), "65:42:420": P(2, 2), "65:42:840": P(2, 2),
  "143:42:660": P(2, 2),
  "129:42:540": P(3, 2),
};

function canHaveOrdinaryWork(state: GameState, charaNum: number): boolean {
  const slot = state.charas[charaNum];
  if (slot && (slot.state.CFLAG[CFLAG_ID.産休中] ?? 0) !== 0) return false;
  return !((state.flagStore[FLAG_ID.宴会開催FLAG] ?? 0) > 0 &&
    (slot?.state.CFLAG[CFLAG_ID.宴会参加] ?? 0) > 0);
}

/** Resolve dynamic time/room fields for a manifest entry on a specific day. */
export function resolveWorkEntry(entry: WorkEntry, ctx: WorkCtx): ActiveWorkEntry | null {
  const startMin = resolveValue(entry.startMin, ctx);
  const endMin = resolveValue(entry.endMin, ctx);
  const workRoomId = resolveValue(entry.workRoomId, ctx);
  const loc = roomIdToLocation(workRoomId);
  if (!loc) return null;
  const entryKey = `${entry.charaNum}:${startMin}:${endMin}`;
  const policy = WORK_POLICY[policyKey(entry.charaNum, entry.jobType, startMin)] ?? {};
  return { ...entry, startMin, endMin, workRoomId, location: loc, entryKey, policy };
}

/** Same lookup as `activeWorkRoom`, but preserves 職種/room metadata for the
 * scheduler's CHARA_JOBSTR/CHARA_JOBEND state hooks. */
export function activeWorkEntry(
  state: GameState,
  charaNum: number,
  tickMin: number,
): ActiveWorkEntry | null {
  if (!canHaveOrdinaryWork(state, charaNum)) return null;
  const ctx: WorkCtx = { state, dayIndex: state.time.dayIndex };
  for (const entry of WORK_MANIFEST) {
    if (entry.charaNum !== charaNum) continue;
    if (!entry.cond(ctx)) continue;
    const resolved = resolveWorkEntry(entry, ctx);
    if (!resolved) return null;
    if (!betweenTime(resolved.startMin, resolved.endMin, tickMin)) continue;
    return resolved;
  }
  return null;
}
