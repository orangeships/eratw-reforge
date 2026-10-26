/**
 * One-shot new-game level reconciliation.
 *
 * Upstream `@INIT_STARTINGLV` runs after the opening options and before the
 * first `BEGIN SHOP`.  It first makes imported life-skill EXP consistent with
 * each character's starting ABL, runs the ordinary `@SOURCE_ABLUP` skill
 * derivation, repairs the never-kissed talent, then executes the same jewel
 * driven `@SHOW_ABLUP_SELECT` used at night.
 *
 * The modern runtime has no MAGIC_DLC MP_GRADE/法力 layer, so the combat-level
 * MP side effect stays fail-closed.  The deterministic ABL/EXP/TALENT writes
 * supported by the current state schema are preserved here.
 */

import type { ObservationEvent } from "../../schemas/types.js";
import type { CharaSlot, CharaSlotState, GameState } from "../state/game-state.js";
import { ABL_ID, CFLAG_ID, EXP_ID, TALENT_ID } from "../state/settlement.js";
import { runAblupAutoSelect } from "./ablup.js";

const EXPLV = [0, 1, 4, 20, 50, 200, 500, 1000, 2000, 3000, 4000, 5000, 6000] as const;

interface SkillRule {
  kind: "abl" | "talent";
  levelId: number;
  expIds: readonly number[];
  label: string;
  cap: number;
  thresholdMultiplier?: number;
  zeroLevelFloor?: number;
}

const SOURCE_SKILLS: readonly SkillRule[] = [
  { kind: "abl", levelId: ABL_ID.战斗能力, expIds: [EXP_ID.戦闘経験], label: "战斗能力", cap: 6, zeroLevelFloor: 5 },
  { kind: "abl", levelId: ABL_ID.話術技能, expIds: [EXP_ID.会話経験], label: "话术技能", cap: 6 },
  { kind: "abl", levelId: ABL_ID.清扫技能, expIds: [EXP_ID.清掃経験], label: "清扫技能", cap: 6 },
  { kind: "abl", levelId: ABL_ID.教養, expIds: [EXP_ID.学習経験], label: "教养", cap: 6, zeroLevelFloor: 5 },
  { kind: "abl", levelId: ABL_ID.料理技能, expIds: [EXP_ID.料理経験], label: "料理技能", cap: 6, zeroLevelFloor: 5 },
  { kind: "talent", levelId: TALENT_ID.採集Lv, expIds: [EXP_ID.採集経験], label: "采集Lv", cap: 6, zeroLevelFloor: 5 },
  { kind: "abl", levelId: ABL_ID.音楽技能, expIds: [EXP_ID.演奏経験, EXP_ID.歌唱経験, EXP_ID.舞踏経験], label: "音乐技能", cap: 6, thresholdMultiplier: 2, zeroLevelFloor: 20 },
  { kind: "talent", levelId: TALENT_ID.釣りLv, expIds: [EXP_ID.釣り経験], label: "钓鱼技能", cap: 6, zeroLevelFloor: 5 },
  { kind: "talent", levelId: TALENT_ID.調合Lv, expIds: [EXP_ID.調合経験], label: "调合技能", cap: 6, zeroLevelFloor: 5 },
  { kind: "talent", levelId: TALENT_ID.伐採Lv, expIds: [EXP_ID.伐採経験], label: "采伐技能", cap: 6, zeroLevelFloor: 5 },
] as const;

const MINIMUM_EXP_RULES = [
  { ablId: ABL_ID.清扫技能, expId: EXP_ID.清掃経験, offset: 2 },
  { ablId: ABL_ID.話術技能, expId: EXP_ID.会話経験, offset: 2 },
  { ablId: ABL_ID.战斗能力, expId: EXP_ID.戦闘経験, offset: 2 },
  { ablId: ABL_ID.教養, expId: EXP_ID.学習経験, offset: 2 },
  { ablId: ABL_ID.料理技能, expId: EXP_ID.料理経験, offset: 2 },
] as const;

function expLevel(index: number): number {
  if (index <= 0) return 0;
  if (index < EXPLV.length) return EXPLV[index]!;
  return EXPLV[EXPLV.length - 1]!;
}

function levelOf(state: CharaSlotState, rule: SkillRule): number {
  return rule.kind === "abl"
    ? state.ABL[rule.levelId] ?? 0
    : state.TALENT[rule.levelId] ?? 0;
}

function setLevel(state: CharaSlotState, rule: SkillRule, value: number): void {
  if (rule.kind === "abl") state.ABL[rule.levelId] = value;
  else state.TALENT[rule.levelId] = value;
}

/** `@SET_MINIMUM_EXP_ALL(ARG=1)` for the currently modeled life-skill rows. */
export function setMinimumStartingExperience(slot: CharaSlot): void {
  const st = slot.state;
  for (const rule of MINIMUM_EXP_RULES) {
    const level = st.ABL[rule.ablId] ?? 0;
    if (level <= 0) continue;
    st.EXP[rule.expId] = Math.max(st.EXP[rule.expId] ?? 0, expLevel(level + rule.offset));
  }

  const musicLevel = st.ABL[ABL_ID.音楽技能] ?? 0;
  if (musicLevel > 0) {
    const knowledge = st.TALENT[TALENT_ID.音楽知識] ?? 0;
    const expId = knowledge === 1
      ? EXP_ID.演奏経験
      : knowledge === 3
        ? EXP_ID.舞踏経験
        : EXP_ID.歌唱経験;
    st.EXP[expId] = Math.max(st.EXP[expId] ?? 0, expLevel(musicLevel + 3));
  }
}

/** Current-schema portion of upstream `@SOURCE_ABLUP`; one pass raises each
 * eligible skill by at most one level, exactly like the ERB function. */
export function runSourceAblup(
  state: GameState,
  deps: { now: () => number },
): ObservationEvent[] {
  const events: ObservationEvent[] = [];
  const slots = [state.master, ...Object.values(state.charas).sort((a, b) => a.charaNum - b.charaNum)];
  for (const slot of slots) {
    if ((slot.state.CFLAG[CFLAG_ID.出禁] ?? 0) !== 0) continue;
    const st = slot.state;
    for (const rule of SOURCE_SKILLS) {
      const level = levelOf(st, rule);
      if (level >= rule.cap) continue;
      const observedExp = Math.max(...rule.expIds.map((id) => st.EXP[id] ?? 0));
      const required = expLevel(level + 3) * (rule.thresholdMultiplier ?? 1);
      if (!(observedExp > required || (level === 0 && rule.zeroLevelFloor !== undefined && observedExp > rule.zeroLevelFloor))) continue;
      const nextLevel = level + 1;
      setLevel(st, rule, nextLevel);
      events.push({
        kind: "NARRATION",
        timestamp: deps.now(),
        charaNum: slot.charaNum,
        text: `${slot.callName ?? `角色${slot.charaNum}`}的${rule.label}变成了LV${nextLevel}`,
      });
      if (slot.charaNum === 0 && rule.levelId === ABL_ID.料理技能 && nextLevel >= 3 && !(st.TALENT[TALENT_ID.大胃王] ?? 0)) {
        st.TALENT[TALENT_ID.大胃王] = 1;
        events.push({ kind: "NARRATION", timestamp: deps.now(), charaNum: 0, text: `${slot.callName ?? "主人公"}获得了【大胃王】` });
      }
    }
    if (!(st.TALENT[TALENT_ID.調合知識] ?? 0) && (st.TALENT[TALENT_ID.調合Lv] ?? 0) >= 3 && (st.ABL[ABL_ID.教養] ?? 0) >= 3) {
      st.TALENT[TALENT_ID.調合知識] = 1;
      events.push({ kind: "NARRATION", timestamp: deps.now(), charaNum: slot.charaNum, text: `${slot.callName ?? `角色${slot.charaNum}`}得到了【调合知识】` });
    }
  }
  return events;
}
/** Full one-shot bridge called by a fresh `buildInitialState`, never by save
 * migration/load. Returned events are diagnostic output for a dedicated setup
 * surface; callers must not append them to the playable-world history. */
export function runNewGameInitialLevelSync(
  state: GameState,
  deps: { now: () => number },
): ObservationEvent[] {
  const events: ObservationEvent[] = [{ kind: "NARRATION", timestamp: deps.now(), text: "正在匹配经验与能力等级……" }];
  const slots = [state.master, ...Object.values(state.charas).sort((a, b) => a.charaNum - b.charaNum)];
  for (const slot of slots) {
    if ((slot.state.CFLAG[CFLAG_ID.出禁] ?? 0) !== 0) continue;
    setMinimumStartingExperience(slot);
  }
  events.push(...runSourceAblup(state, deps));
  for (const slot of slots) {
    const st = slot.state;
    if ((st.CFLAG[CFLAG_ID.出禁] ?? 0) !== 0) continue;
    if ((st.EXP[EXP_ID.キス経験] ?? 0) === 0 && (st.TALENT[TALENT_ID.キス未経験] ?? 0) === 0 && (st.CFLAG[CFLAG_ID.初吻喪失対象] ?? 0) !== 1) {
      st.TALENT[TALENT_ID.キス未経験] = 1;
    }
  }
  events.push(...runAblupAutoSelect(state, { ...deps, includeMaster: true, includeMobs: true }));
  return events;
}
