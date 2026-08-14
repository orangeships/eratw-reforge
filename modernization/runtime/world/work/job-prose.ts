/**
 * `@仕事情景描写` (仕事・宴会描写.ERB:1-59) — per-job/per-character work prose,
 * plus the 工作量三档 progress lines from `@CHARA_JOBSTR`
 * (JOB_仕事開始終了処理.ERB:59-101).
 *
 * The scheduler calls `jobSceneProse` for a working NPC visible to the player
 * mid-work (upstream `CALL 仕事情景描写(ARG)` inside `@CHARA_JOBSTR` branch B),
 * then `workloadRemainingProse` for the remaining-workload bucket. Per-chara
 * SELECTCASE arms mirror upstream; the CASEELSE keeps the modern free-action
 * prose (richer than the upstream generic 「心情不错的X着」, matching the
 * existing display-only choice for 萃香 in scheduler.ts).
 *
 * Faithful to upstream:
 *   - the 恋慕 inline ternary `\@ TALENT ? A # B \@` → `loveBranch`;
 *   - 52 女子会 has no CASEELSE → non-members fall through to the CASEELSE
 *     (which keeps the existing 萃香 display-only drinking-prose correction);
 *   - 48/50/51 職種 branches are defensive — `isEventManagedWork` (banquet
 *     hosting) keeps them off the ordinary scheduler work path.
 */
import type { CharaSlot, GameState } from "../../state/game-state.js";
import { JOB_ID, JOB_LABEL } from "./work-manifest.js";
import { TALENT_ID } from "../../state/settlement.js";
import { freeActionText } from "../free-action.js";

/** Per-chara SELECTCASE ids (charas.bundle.json, work-manifest cross-checked). */
const CHARA = {
  映姫: 30,
  パチュリー: 54,
  こころ: 57,
  慧音: 67,
  小鈴: 70,
  麟: 160,
} as const;

/** 女子会 (52 お酒) members — upstream SELECTCASE lists exactly these 8. */
const JOSHIKAI: readonly number[] = [4, 26, 32, 55, 66, 72, 102, 124];

/** Display name for a chara slot (callName, falling back to #charaNum). */
function charaName(slot: { charaNum: number; callName?: string }): string {
  return slot.callName ?? `#${slot.charaNum}`;
}

function minuteOfDay(tick: number): number {
  return ((tick % 1440) + 1440) % 1440;
}

/** `GET_JOBNAME(ARG)` equivalent — the 職種 label for narration. */
export function getJobName(jobType: number): string {
  return JOB_LABEL[jobType] ?? "仕事";
}

/** The upstream inline ternary `\@ TALENT:恋慕 ? yes # no \@`. */
function loveBranch(slot: CharaSlot, yes: string, no: string): string {
  return (slot.state.TALENT[TALENT_ID.恋慕] ?? 0) !== 0 ? yes : no;
}

/** `@仕事情景描写` — the work scene prose for a working, visible NPC. */
export function jobSceneProse(
  state: GameState,
  slot: CharaSlot,
  jobType: number,
): string | null {
  const name = charaName(slot);
  const master = state.master.callName ?? "主人公";
  const job = getJobName(jobType);

  // 職種特化 arms (defensive: 48/50/51 never reach the ordinary work path).
  if (jobType === JOB_ID.宴会準備) {
    return `${name}${loveBranch(slot, `一边牵挂着${master}一边`, "忙碌的")}做宴会的准备。`;
  }
  if (jobType === JOB_ID.宴会片づけ) {
    return `${name}${loveBranch(slot, `一边牵挂着${master}一边`, "默默地")}做宴会的善后工作。`;
  }
  if (jobType === JOB_ID.遊び) {
    return `${name}${loveBranch(slot, `一边时不时把视线投向${master}一边`, "")}玩耍着。`;
  }

  // 女子会 (JOB_お酒): only the 8 members have prose upstream (no CASEELSE).
  // Non-members fall through to the CASEELSE — this keeps the existing
  // display-only correction for 萃香's Monday JOB_お酒 (ordinary drinking
  // prose), which the old scheduler intentionally routed that way.
  if (jobType === JOB_ID.お酒 && JOSHIKAI.includes(slot.charaNum)) {
    return `${name}${loveBranch(slot, `和${master}相视而笑然后继续`, "")}和她们一起谈笑着。`;
  }

  // Per-chara SELECTCASE.
  const min = minuteOfDay(state.time.tickValue);
  const dayMod = (state.time.dayIndex + 1) % 7; // upstream DAY is 1-based
  switch (slot.charaNum) {
    case CHARA.映姫:
      if (min >= 540 && min < 720) return `${name}安静地进行着${job}。`;
      if (min >= 720 && min < 780) return `${name}正在进行${job}。`;
      return `${name}冷漠地进行着${job}。`;
    case CHARA.パチュリー:
      return `${name}头也不抬的看着书…`;
    case CHARA.こころ:
      return `${name}在悠哉地做${job}。`;
    case CHARA.慧音:
    case CHARA.麟:
      if (min >= 720 && min <= 780) {
        return `${name}${loveBranch(slot, `一边牵挂着${master}一边`, "")}陪孩子们${job}。`;
      }
      return `${name}${loveBranch(slot, `一边牵挂着${master}一边`, "")}做着${job}。`;
    case CHARA.小鈴:
      return dayMod === 3 || dayMod === 4
        ? `${name}一边读书一边${job}。`
        : `${name}一边仔细的确认着内容一边${job}。`;
  }

  // CASEELSE: keep the modern free-action prose (the previous scheduler
  // `workProgressText`) instead of the upstream generic 「心情不错的X着」.
  return freeActionFallback(slot, jobType);
}

/** The previous scheduler `workProgressText` fallback, kept as the CASEELSE. */
function freeActionFallback(slot: CharaSlot, jobType: number): string | null {
  const freeActionType: Partial<Record<number, number>> = {
    [JOB_ID.清掃]: 4,
    [JOB_ID.戦闘]: 5,
    [JOB_ID.教養]: 6,
    [JOB_ID.料理]: 7,
    [JOB_ID.音楽]: 8,
    [JOB_ID.遊び]: 1,
    [JOB_ID.お酒]: 13,
    [JOB_ID.採集]: 9,
    [JOB_ID.釣り]: 10,
    [JOB_ID.調合]: 11,
  };
  const type = freeActionType[jobType];
  if (type !== undefined) return freeActionText(slot, type, "progress");

  const name = charaName(slot);
  switch (jobType) {
    case JOB_ID.会話:
      return `${name}正在与人交谈。`;
    case JOB_ID.商売:
      return `${name}正在忙着做生意。`;
    case JOB_ID.宴会準備:
      return `${name}忙碌地做着宴会的准备。`;
    case JOB_ID.宴会参加:
      return `${name}正在享受宴会。`;
    case JOB_ID.宴会片づけ:
      return `${name}默默地做着宴会的善后工作。`;
    case JOB_ID.家事:
      return `${name}正在做家务。`;
    default:
      return null;
  }
}

/** 工作量三档 progress prose (`@CHARA_JOBSTR`, JOB_仕事開始終了処理.ERB:59-101).
 *  `bucket` is the 3/2/1 tier from `workProgressBucket`; 0 → null (no work). */
export function workloadRemainingProse(
  jobType: number,
  bucket: number,
): string | null {
  if (bucket <= 0) return null;
  const job = getJobName(jobType);
  const nap = job.includes("午睡"); // STRFIND(GET_JOBNAME,"午睡"); no modern job has it.
  if (bucket === 3) {
    if (jobType === JOB_ID.宴会準備) return "宴会的准备工作还剩很多没完成的样子…";
    if (jobType === JOB_ID.宴会片づけ) return "宴会的善后工作还剩很多没完成的样子…";
    if (jobType === JOB_ID.遊び) return "埋头于玩耍之中…";
    if (nap) return "看起来暂时不要打扰对方会比较好的样子…";
    return `${job}还剩很多没完成的样子…`;
  }
  if (bucket === 2) {
    if (jobType === JOB_ID.宴会準備) return "距离宴会的准备工作完成还需要一段时间…";
    if (jobType === JOB_ID.宴会片づけ) return "距离宴会的善后工作完成还需要一段时间…";
    if (jobType === JOB_ID.遊び) return "好像还没玩够的样子…";
    return `距离${job}完成还需要一段时间…`;
  }
  if (jobType === JOB_ID.宴会準備) return "宴会的准备工作还差一点就可以完成了…";
  if (jobType === JOB_ID.宴会片づけ) return "宴会的善后工作还差一点就可以完成了…";
  if (jobType === JOB_ID.遊び) return "玩累了的样子…";
  return `${job}还差一点就可以完成了…`;
}
