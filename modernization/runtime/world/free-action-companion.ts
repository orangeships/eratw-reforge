/**
 * Phase 7.5+ — `COMF368 自由行動に付き合う` companion-settle, faithful to
 * `ERB/コマンド関連/COMF/日常系/COMF368 自由行動に付き合う.ERB` +
 * the matching `ERB/MOVEMENTS/自由行動/FREE_ACT_*.ERB` `CASE "ソース"` arms.
 *
 * The 368 handler dispatches here by `freeAction.type`. Each arm reproduces
 * the upstream SOURCE / DOWNBASE / RECOVER / EXP / YOGORE deltas in the
 * same shape (per-target `Record<SOURCE_ID, number>` for the SOURCE set,
 * then `applySourceCheck`). Trust seeds preserve the original
 * `TFLAG:信頼度管理` values where an arm sets them.
 *
 * **Authoritative inputs:**
 *   - `state.freeActions[target]?.type`            → which arm runs
 *   - `state.freeActions[target]?.remainingMinutes` → Activity_Duration;
 *     `FreeAct_Time` chooses the exact interval credited by this command
 *   - `timeCoef = max(elapsedMinutes / 10, 1)`     → source multiplier
 *
 * **What this port handles:**
 *   0 思考 / 1 玩耍 / 2 吃饭 / 3 零食 / 4 扫除 / 5 运动训练 / 6 读书 /
 *   7 做饭 / 8 音乐 / 9 采集 / 10 钓鱼 / 12 放松 / 13 喝酒 / 14 购物 /
 *   16 落穴 / 17 堆雪 / 18 被炉. Types 11/15/19 stay fail-closed until
 *   alchemy, sermon-chain, and nesting settlement become authoritative.
 *
 * **DEFERRED (within each arm):**
 *   - 充填率 / 蜂蜜 / 時間補正 tier branches in PRINTFORMW prose (no display).
 *   - 完了 arm text (no display).
 *   - KOJO_MESSAGE_SEND ("SUCCESS" / TFLAG:192) eval — no kojo.
 *   - UNIQUE_FA_* per-character override (TRYCCALLFORM first arm) — most
 *     charas don't have one; falls through to the base arm.
 *   - TFLAG:信頼度管理 2 vs 1 distinction survives via the tier word
 *     ("up" vs "good") but the per-target trust ladder (TRUST_CALC) is
 *     gated by `applySourceCheck`'s `trustSeed` arg — wired in handler.
 */

import type { CharaSlot, GameState } from "../state/game-state.js";
import { applySourceCheck } from "../command/source-check.js";
import { usableInstruments } from "../command/handlers/perform-music.js";
import { presentNpcs } from "../scene/presence.js";
import { drunken } from "../state/alcohol.js";
import {
  ABL_ID,
  BASE_ID,
  CFLAG_ID,
  EX_ID,
  EXP_ID,
  SOURCE_ID,
  TALENT_ID,
  TCVAR_ID,
  recoverPermil,
} from "../state/settlement.js";

// `favorCoeff` is private to dish.ts (ERB `好感度係数` 207-221). Mirror it
// here so the companion settle has no transitive dep on the dish module.
function favorCoeff(favor: number): number {
  if (favor < 100) return 0;
  if (favor < 500) return 1;
  if (favor < 1000) return 2;
  if (favor < 5000) return 4;
  if (favor < 10000) return 6;
  if (favor < 30000) return 8;
  return 10;
}

// ---------------------------------------------------------------------------
// 経過時間 (elapsed minutes) + 時間係数 (time multiplier)
// ---------------------------------------------------------------------------

/**
 * `FreeAct_Time` analogue. A zero result falls back to
 * `MIN(Activity_Duration, 30)` in COM368, while a few actions override it:
 * thought/meal/snack consume the whole remainder, reading consumes ten
 * minutes until its final 30, and cooking advances to (or through) its final
 * meal phase.
 */
export function companionElapsedMinutes(
  state: GameState,
  target: number,
): number {
  const action = state.freeActions?.[target];
  const remaining = Math.max(0, action?.remainingMinutes ?? 0);
  switch (action?.type) {
    case 0:
    case 2:
    case 3:
      return remaining;
    case 6:
      return remaining > 30 ? Math.min(10, remaining) : remaining;
    case 7:
      return remaining > 30 ? remaining - 30 : remaining;
    case 16:
      return 10;
    default:
      return Math.min(remaining, 30);
  }
}

/** `時間係数 = MAX(経過時間 / 10, 1)`. */
export function companionTimeCoef(elapsed: number): number {
  return Math.max(Math.trunc(elapsed / 10), 1);
}

// ---------------------------------------------------------------------------
// DOWNBASE helpers (ERB convention: positive = drain, 1000 = MAXBASE cap)
// ---------------------------------------------------------------------------

function drainMasterBase(
  next: GameState,
  key: keyof typeof BASE_ID,
  amount: number,
): void {
  const cur = next.master.state.BASE[BASE_ID[key]] ?? 0;
  next.master.state.BASE[BASE_ID[key]] = Math.max(0, cur - amount);
}

function drainTargetBase(
  next: GameState,
  target: number,
  key: keyof typeof BASE_ID,
  amount: number,
): void {
  const t = next.charas[target];
  if (!t) return;
  const cur = t.state.BASE[BASE_ID[key]] ?? 0;
  t.state.BASE[BASE_ID[key]] = Math.max(0, cur - amount);
}

// ---------------------------------------------------------------------------
// 7 settled arms
// ---------------------------------------------------------------------------

/**
 * `FREE_ACT_0` 思考 — "一起思考". SOURCE is conditional on 信頼度 < 275 - 親密*25
 * (failure branch: 気力 × 40 / 歓楽 base 50 / 受動 30 / 会話経験 +1).
 * We don't model 信頼度 directly (deferred CFLAG tier), so the failure
 * branch becomes "歓楽/受動 base 50/30" + 会話経験 +1 (always). The
 * faithful gating is deferred to the trust CFLAG slot landing later.
 */
function settleThink(
  next: GameState,
  target: number,
  co: number,
): { trustSeed: number; outcome: "understood" | "failed" } {
  const t = next.charas[target];
  if (!t) return { trustSeed: 0, outcome: "failed" };
  const ablChin = t.state.ABL[ABL_ID.親密] ?? 0;
  const ablJuujun = t.state.ABL[ABL_ID.従順] ?? 0;
  const ablMasterSpeech = next.master.state.ABL[ABL_ID.話術技能] ?? 0;
  const failed = (t.state.CFLAG[CFLAG_ID.信頼度] ?? 0) < 275 - ablChin * 25;
  const trustSeed = failed ? 0 : 1;
  drainMasterBase(next, "気力", (failed ? 40 : 20) * co);
  drainTargetBase(next, target, "気力", (failed ? 40 : 20) * co);
  applySourceCheck(next, target, failed ? {
    [SOURCE_ID.歓楽]: (50 + (ablChin + ablMasterSpeech) * 25) * co,
    [SOURCE_ID.受動]: (30 + (ablJuujun + ablMasterSpeech) * 15) * co,
  } : {
    [SOURCE_ID.歓楽]: (100 + (ablChin + ablMasterSpeech) * 50) * co,
    [SOURCE_ID.受動]: (60 + (ablJuujun + ablMasterSpeech) * 30) * co,
  }, 0, trustSeed);
  next.master.state.EXP[EXP_ID.会話経験] = (next.master.state.EXP[EXP_ID.会話経験] ?? 0) + 1;
  return { trustSeed, outcome: failed ? "failed" : "understood" };
}

/**
 * `FREE_ACT_1` 玩耍 — "一起玩耍". RAND:10 outcome (10% 大成功 / 10% 失败 / rest 成功)
 * mirrors ERB 10% brackets. SOURCE:歓楽/受動/征服; DOWNBASE 体力気力 on both.
 * "大成功" → trustSeed 2; "成功" → 1; "失敗" → 0.
 */
function settlePlay(
  next: GameState,
  target: number,
  co: number,
  rng: { int(max: number): number },
): { trustSeed: number; outcome: "big" | "ok" | "miss" } {
  const t = next.charas[target];
  if (!t) return { trustSeed: 0, outcome: "ok" };
  drainMasterBase(next, "体力", 40 * co);
  drainMasterBase(next, "気力", 40 * co);
  drainTargetBase(next, target, "体力", 20 * co);
  drainTargetBase(next, target, "気力", 20 * co);
  const favor = favorCoeff(t.state.CFLAG[CFLAG_ID.好感度] ?? 0);
  const ablChin = t.state.ABL[ABL_ID.親密] ?? 0;
  const ablJuujun = t.state.ABL[ABL_ID.従順] ?? 0;
  const ablSadism = t.state.ABL[ABL_ID.施虐属性] ?? 0;
  const r = rng.int(10);
  let outcome: "big" | "ok" | "miss";
  let trustSeed: number;
  let source: Record<number, number>;
  if (r === 1) {
    outcome = "big";
    trustSeed = 2;
    source = {
      [SOURCE_ID.歓楽]: (200 + (ablChin + favor) * 80) * co,
      [SOURCE_ID.受動]: (120 + (ablJuujun + favor) * 80) * co,
      [SOURCE_ID.征服]: (120 + ablSadism * 120) * co,
    };
  } else if (r === 2) {
    outcome = "miss";
    trustSeed = 0;
    source = {
      [SOURCE_ID.歓楽]: (100 + (ablChin + favor) * 30) * co,
      [SOURCE_ID.受動]: (50 + (ablJuujun + favor) * 20) * co,
      [SOURCE_ID.征服]: (50 + ablSadism * 50) * co,
    };
  } else {
    outcome = "ok";
    trustSeed = 1;
    source = {
      [SOURCE_ID.歓楽]: (150 + (ablChin + favor) * 50) * co,
      [SOURCE_ID.受動]: (100 + (ablJuujun + favor) * 50) * co,
      [SOURCE_ID.征服]: (100 + ablSadism * 100) * co,
    };
  }
  applySourceCheck(next, target, source, 0, trustSeed);
  return { trustSeed, outcome };
}

/**
 * `FREE_ACT_2` 吃饭 — "一起吃饭". Branches on master 空腹: full effect when
 * hungry, half when not. RECOVER master 体力/気力 proportional to elapsed
 * minutes (3*elapsed when hungry, 1*elapsed when not). Pushes master 空腹時刻.
 * TFLAG:信頼度管理 2 vs 1.
 */
function settleMeal(
  next: GameState,
  target: number,
  elapsed: number,
  co: number,
): { trustSeed: number; outcome: "ate" | "snack" } {
  const t = next.charas[target];
  if (!t) return { trustSeed: 0, outcome: "ate" };
  const favor = favorCoeff(t.state.CFLAG[CFLAG_ID.好感度] ?? 0);
  const ablChin = t.state.ABL[ABL_ID.親密] ?? 0;
  const ablJuujun = t.state.ABL[ABL_ID.従順] ?? 0;
  const ablSadism = t.state.ABL[ABL_ID.施虐属性] ?? 0;
  const masterHungry = (next.master.state.TCVAR[TCVAR_ID.空腹時刻] ?? 0) <= next.time.tickValue;
  let source: Record<number, number>;
  let trustSeed: number;
  let outcome: "ate" | "snack";
  let recovMult: number;
  if (masterHungry) {
    outcome = "ate";
    trustSeed = 2;
    recovMult = 3;
    source = {
      [SOURCE_ID.歓楽]: (100 + (ablChin + favor) * 50) * co,
      [SOURCE_ID.受動]: (60 + (ablJuujun + favor) * 30) * co,
      [SOURCE_ID.征服]: (60 + ablSadism * 10) * co,
    };
  } else {
    outcome = "snack";
    trustSeed = 1;
    recovMult = 1;
    source = {
      [SOURCE_ID.歓楽]: (50 + (ablChin + favor) * 25) * co,
      [SOURCE_ID.受動]: (30 + (ablJuujun + favor) * 15) * co,
      [SOURCE_ID.征服]: (30 + ablSadism * 10) * co,
    };
  }
  // Push master 空腹時刻 to now + 120 (the upstream sets it to
  // 1440*DAY+TIME+120; in our tickValue convention that's just
  // tickValue+120, matching free-action.ts:195).
  const newHungryAt = next.time.tickValue + 120;
  if (masterHungry) {
    next.master.state.TCVAR[TCVAR_ID.空腹時刻] = newHungryAt;
  } else {
    next.master.state.TCVAR[TCVAR_ID.空腹時刻] = Math.max(newHungryAt, next.master.state.TCVAR[TCVAR_ID.空腹時刻] ?? 0);
  }
  // RECOVER 体力/気力 — ERB uses RECOVER(MASTER, 3*経過時間, "体力"/"気力")
  // where the second arg is an additive permil-style value. Faithful: scale
  // by elapsed minutes.
  const recovValue = recovMult * elapsed;
  next.master.state.BASE[BASE_ID.体力] = Math.min(
    next.master.state.MAXBASE[BASE_ID.体力] ?? next.master.state.BASE[BASE_ID.体力] ?? 0,
    (next.master.state.BASE[BASE_ID.体力] ?? 0) + recovValue,
  );
  next.master.state.BASE[BASE_ID.気力] = Math.min(
    next.master.state.MAXBASE[BASE_ID.気力] ?? next.master.state.BASE[BASE_ID.気力] ?? 0,
    (next.master.state.BASE[BASE_ID.気力] ?? 0) + recovValue,
  );
  applySourceCheck(next, target, source, 0, trustSeed);
  return { trustSeed, outcome };
}

/**
 * `FREE_ACT_4` 扫除 — "帮忙扫除". YOGORE reduction proportional to elapsed
 * minutes; per-room `EX:MASTER:今日的掃除回数` accumulator; SOURCE:歓楽;
 * DOWNBASE 体力気力 on both; 清掃経験 +1 on both master & target.
 * GMF 大地图 accumulator deferred.
 */
function settleClean(
  next: GameState,
  target: number,
  elapsed: number,
  co: number,
): { trustSeed: number } {
  const t = next.charas[target];
  if (!t) return { trustSeed: 0 };
  drainMasterBase(next, "体力", 20 * co);
  drainMasterBase(next, "気力", 40 * co);
  drainTargetBase(next, target, "体力", 10 * co);
  drainTargetBase(next, target, "気力", 20 * co);
  const ablJuujun = t.state.ABL[ABL_ID.従順] ?? 0;
  const ablClean = next.master.state.ABL[ABL_ID.清扫技能] ?? 0;
  // YOGORE reduction: ERB `YOGORE = MAX(YOGORE - 100*経過時間/5, 0)`.
  const loc = next.master.location;
  const yOld = next.yogore?.[loc] ?? 0;
  const yNew = Math.max(0, yOld - Math.trunc((100 * elapsed) / 5));
  const reduced = yOld - yNew;
  next.yogore ??= {};
  next.yogore[loc] = yNew;
  // Per-day sweep counter (EX id 16). Note this lives in `state.EX` (the
  // EX namespace) not `state.EXP`.
  next.master.state.EX[EX_ID.今日的掃除回数] =
    (next.master.state.EX[EX_ID.今日的掃除回数] ?? 0) + reduced;
  const source: Record<number, number> = {
    [SOURCE_ID.歓楽]: (100 + (ablJuujun + ablClean) * 50) * co,
  };
  applySourceCheck(next, target, source, 0, 2);
  next.master.state.EXP[EXP_ID.清掃経験] = (next.master.state.EXP[EXP_ID.清掃経験] ?? 0) + 1;
  t.state.EXP[EXP_ID.清掃経験] = (t.state.EXP[EXP_ID.清掃経験] ?? 0) + 1;
  return { trustSeed: 2 };
}

/**
 * `FREE_ACT_5` 运动/战斗训练 — "一起训练". DOWNBASE both, SOURCE:歓楽/受動/征服,
 * master 戦闘経験 +1.
 */
function settleTrain(
  next: GameState,
  target: number,
  co: number,
): { trustSeed: number } {
  const t = next.charas[target];
  if (!t) return { trustSeed: 0 };
  drainMasterBase(next, "体力", 40 * co);
  drainMasterBase(next, "気力", 40 * co);
  drainTargetBase(next, target, "体力", 20 * co);
  drainTargetBase(next, target, "気力", 20 * co);
  const ablChin = t.state.ABL[ABL_ID.親密] ?? 0;
  const ablJuujun = t.state.ABL[ABL_ID.従順] ?? 0;
  const ablSadism = t.state.ABL[ABL_ID.施虐属性] ?? 0;
  const ablBattleT = t.state.ABL[ABL_ID.战斗能力] ?? 0;
  const ablBattleM = next.master.state.ABL[ABL_ID.战斗能力] ?? 0;
  const source: Record<number, number> = {
    [SOURCE_ID.歓楽]: (150 + (ablChin + ablBattleM) * 50) * co,
    [SOURCE_ID.受動]: (100 + (ablJuujun + ablBattleM) * 50) * co,
    [SOURCE_ID.征服]: (100 + (ablSadism + ablBattleT) * 100) * co,
  };
  applySourceCheck(next, target, source, 0, 2);
  next.master.state.EXP[EXP_ID.戦闘経験] = (next.master.state.EXP[EXP_ID.戦闘経験] ?? 0) + 1;
  return { trustSeed: 2 };
}

/**
 * `FREE_ACT_6` 读书 — "一起读书". ERB branches on `Activity_Duration > 30`
 * (the "haven't finished reading yet" failure arm). The faithful
 * translation: if `remainingMinutes > 30` (i.e. the chara is still early
 * in a long-read session), the failure arm fires (SOURCE:反感 + 気力 drain).
 * Success arm → SOURCE:歓楽/受動 + 会話/学習経験 +1.
 */
function settleRead(
  next: GameState,
  target: number,
  co: number,
): { trustSeed: number; outcome: "read" | "tooEarly" } {
  const t = next.charas[target];
  if (!t) return { trustSeed: 0, outcome: "read" };
  const remaining = next.freeActions?.[target]?.remainingMinutes ?? 0;
  // ERB equivalent: `Activity_Duration:CHARA > 30` — "CHARA is more than
  // 30 minutes into the future" (still mid-read). We store to-go minutes,
  // so "> 30 remaining" = "still mid-read" = failure.
  const tooEarly = remaining > 30;
  if (tooEarly) {
    drainMasterBase(next, "気力", 40 * co);
    const source: Record<number, number> = { [SOURCE_ID.反感]: 50 };
    applySourceCheck(next, target, source, 0, 0);
    return { trustSeed: 0, outcome: "tooEarly" };
  }
  drainMasterBase(next, "気力", 20 * co);
  drainTargetBase(next, target, "気力", 20 * co);
  const ablChin = t.state.ABL[ABL_ID.親密] ?? 0;
  const ablJuujun = t.state.ABL[ABL_ID.従順] ?? 0;
  const ablEdu = next.master.state.ABL[ABL_ID.教養] ?? 0;
  const source: Record<number, number> = {
    [SOURCE_ID.歓楽]: (100 + (ablChin + ablEdu) * 50) * co,
    [SOURCE_ID.受動]: (100 + (ablJuujun + ablEdu) * 50) * co,
  };
  applySourceCheck(next, target, source, 0, 1);
  next.master.state.EXP[EXP_ID.会話経験] = (next.master.state.EXP[EXP_ID.会話経験] ?? 0) + 1;
  next.master.state.EXP[EXP_ID.学習経験] = (next.master.state.EXP[EXP_ID.学習経験] ?? 0) + 1;
  return { trustSeed: 1, outcome: "read" };
}

/**
 * `FREE_ACT_9` 采集 — "一起采集". DOWNBASE both, SOURCE:歓楽/受動,
 * master 採集経験 +1. The master 採集Lv talent gates the SOURCE scale.
 */
function settleGather(
  next: GameState,
  target: number,
  co: number,
): { trustSeed: number } {
  const t = next.charas[target];
  if (!t) return { trustSeed: 0 };
  drainMasterBase(next, "体力", 20 * co);
  drainMasterBase(next, "気力", 40 * co);
  drainTargetBase(next, target, "体力", 10 * co);
  drainTargetBase(next, target, "気力", 20 * co);
  const ablChin = t.state.ABL[ABL_ID.親密] ?? 0;
  const ablJuujun = t.state.ABL[ABL_ID.従順] ?? 0;
  // 採集Lv is a master talent, not an ABL. We read it as a 0/1 boolean
  // (TALENT 採集Lv = 48) to scale the SOURCE the same way ERB does.
  const gatherTalent = next.master.state.TALENT[TALENT_ID.採集Lv] ?? 0;
  const source: Record<number, number> = {
    [SOURCE_ID.歓楽]: (150 + (ablChin + gatherTalent) * 50) * co,
    [SOURCE_ID.受動]: (100 + (ablJuujun + gatherTalent) * 50) * co,
  };
  applySourceCheck(next, target, source, 0, 1);
  next.master.state.EXP[EXP_ID.採集経験] = (next.master.state.EXP[EXP_ID.採集経験] ?? 0) + 1;
  return { trustSeed: 1 };
}

function settleMusic(
  next: GameState,
  target: number,
  co: number,
  rng: { int(max: number): number },
): { trustSeed: number; outcome: "listen" | "miss" | "ok" | "big" } {
  const t = next.charas[target];
  if (!t) return { trustSeed: 0, outcome: "listen" };
  const musicSkill = next.master.state.ABL[ABL_ID.音楽技能] ?? 0;
  const intimacy = t.state.ABL[ABL_ID.親密] ?? 0;
  if (usableInstruments(next).length === 0) {
    drainMasterBase(next, "気力", 20 * co);
    drainTargetBase(next, target, "体力", 10 * co);
    drainTargetBase(next, target, "気力", 20 * co);
    applySourceCheck(next, target, {
      [SOURCE_ID.歓楽]: (50 + (intimacy + musicSkill) * 10) * co,
    });
    return { trustSeed: 0, outcome: "listen" };
  }

  drainMasterBase(next, "体力", 40 * co);
  drainMasterBase(next, "気力", 40 * co);
  drainTargetBase(next, target, "体力", 20 * co);
  drainTargetBase(next, target, "気力", 20 * co);
  const roll = rng.int(10 + musicSkill);
  const outcome = roll === 0 ? "miss" : roll <= 9 ? "ok" : "big";
  const outcomeValue = outcome === "miss" ? -1 : outcome === "big" ? 1 : 0;
  const trustSeed = outcome === "miss" ? 0 : outcome === "big" ? 2 : 1;
  applySourceCheck(next, target, {
    [SOURCE_ID.歓楽]: ((150 + 50 * outcomeValue) + (intimacy + musicSkill) * (50 + 30 * outcomeValue)) * co,
  }, 0, trustSeed);

  // FREE_ACT_8 gives the same music SOURCE to every other responsive NPC
  // at the room. `SHIRAHU` is represented by the modern awake/sober/healthy
  // state fields used by free-action scheduling.
  for (const listener of presentNpcs(next, next.master.location)) {
    if (listener.charaNum === target) continue;
    if ((listener.state.CFLAG[CFLAG_ID.睡眠] ?? 0) !== 0) continue;
    if ((listener.state.CFLAG[CFLAG_ID.衰弱] ?? 0) !== 0) continue;
    if ((listener.state.TCVAR[TCVAR_ID.泥酔] ?? 0) !== 0) continue;
    const listenerIntimacy = listener.state.ABL[ABL_ID.親密] ?? 0;
    applySourceCheck(next, listener.charaNum, {
      [SOURCE_ID.歓楽]: ((150 + 50 * outcomeValue) + (listenerIntimacy + musicSkill) * (50 + 30 * outcomeValue)) * co,
    }, 0, trustSeed);
  }
  next.master.state.EXP[EXP_ID.演奏経験] = (next.master.state.EXP[EXP_ID.演奏経験] ?? 0) + 1;
  return { trustSeed, outcome };
}

function settleFishing(next: GameState, target: number, co: number): { trustSeed: number; hasRod: boolean } {
  const t = next.charas[target];
  if (!t) return { trustSeed: 0, hasRod: false };
  const fishingLevel = next.master.state.TALENT[TALENT_ID.釣りLv] ?? 0;
  const hasRod = (next.items?.[37] ?? 0) > 0;
  if (!hasRod) {
    drainMasterBase(next, "気力", 50 * co);
    drainTargetBase(next, target, "体力", 10 * co);
    drainTargetBase(next, target, "気力", 20 * co);
    applySourceCheck(next, target, {
      [SOURCE_ID.歓楽]: (50 + ((t.state.ABL[ABL_ID.親密] ?? 0) + fishingLevel) * 25) * co,
    });
    return { trustSeed: 0, hasRod };
  }
  drainMasterBase(next, "体力", 20 * co);
  drainMasterBase(next, "気力", 40 * co);
  drainTargetBase(next, target, "体力", 10 * co);
  drainTargetBase(next, target, "気力", 20 * co);
  applySourceCheck(next, target, {
    [SOURCE_ID.歓楽]: (150 + ((t.state.ABL[ABL_ID.親密] ?? 0) + fishingLevel) * 50) * co,
    [SOURCE_ID.受動]: (100 + ((t.state.ABL[ABL_ID.従順] ?? 0) + fishingLevel) * 50) * co,
  }, 0, 1);
  next.master.state.EXP[EXP_ID.釣り経験] = (next.master.state.EXP[EXP_ID.釣り経験] ?? 0) + 1;
  return { trustSeed: 1, hasRod };
}

function settleDrink(
  next: GameState,
  target: number,
  co: number,
  rng: { int(max: number): number },
): { trustSeed: number } {
  const t = next.charas[target];
  if (!t) return { trustSeed: 0 };
  const tolerance = t.state.TALENT[TALENT_ID.酒耐性] ?? 0;
  drainMasterBase(next, "体力", 20 * co);
  drainMasterBase(next, "気力", 10 * co);
  drunken(next, 0, Math.max(50 + tolerance, 51), rng);
  applySourceCheck(next, target, {
    [SOURCE_ID.歓楽]: (150 + ((t.state.ABL[ABL_ID.親密] ?? 0) + tolerance) * 50) * co,
    [SOURCE_ID.受動]: (100 + ((t.state.ABL[ABL_ID.従順] ?? 0) + tolerance) * 50) * co,
    [SOURCE_ID.征服]: (100 + ((t.state.ABL[ABL_ID.施虐属性] ?? 0) + tolerance) * 50) * co,
  }, 0, 1);
  return { trustSeed: 1 };
}

const PITFALL_PRANKSTERS = new Set([5, 6, 7, 14, 53, 111]);

export function companionActionAvailable(state: GameState, target: number): boolean {
  const action = state.freeActions?.[target];
  const slot = state.charas[target];
  if (!action || !slot || !companionActionName(action.type, action.remainingMinutes, slot)) return false;
  if (action.type !== 16) return true;
  const pitfall = state.freeActionMeta?.pitfall;
  return !!pitfall && pitfall.dayIndex === state.time.dayIndex && pitfall.location === slot.location && pitfall.records?.[target] !== undefined;
}

function settlePitfall(next: GameState, target: number, co: number): { trustSeed: number; victim: boolean } | null {
  const t = next.charas[target];
  const pitfall = next.freeActionMeta?.pitfall;
  if (!t || !pitfall || pitfall.dayIndex !== next.time.dayIndex || pitfall.location !== t.location || pitfall.records?.[target] === undefined) return null;
  const victim = pitfall.victim === target;
  if (victim) {
    const rank = pitfall.rank ?? 0;
    applySourceCheck(next, target, {
      [SOURCE_ID.鬱屈]: 50 + rank * 50,
      [SOURCE_ID.苦痛]: 350 - rank * 50,
    });
  } else {
    applySourceCheck(next, target, {
      [SOURCE_ID.歓楽]: 20 + (t.state.ABL[ABL_ID.親密] ?? 0) * 15 * co,
      [SOURCE_ID.受動]: 10 + (t.state.ABL[ABL_ID.従順] ?? 0) * 10 * co,
    });
  }
  return { trustSeed: 0, victim };
}

function settleCook(
  next: GameState,
  target: number,
  remaining: number,
  co: number,
): { trustSeed: number; outcome: "helped" | "ate" | "snack" } {
  const t = next.charas[target];
  if (!t) return { trustSeed: 0, outcome: "helped" };
  if (remaining <= 30) return settleMeal(next, target, remaining, co);
  drainMasterBase(next, "体力", 20 * co);
  drainMasterBase(next, "気力", 20 * co);
  drainTargetBase(next, target, "体力", 10 * co);
  drainTargetBase(next, target, "気力", 10 * co);
  const source = {
    [SOURCE_ID.歓楽]: (100 + ((t.state.ABL[ABL_ID.従順] ?? 0) + (next.master.state.ABL[ABL_ID.料理技能] ?? 0)) * 50) * co,
  };
  applySourceCheck(next, target, source, 0, 1);
  next.master.state.EXP[EXP_ID.料理経験] = (next.master.state.EXP[EXP_ID.料理経験] ?? 0) + 1;
  return { trustSeed: 1, outcome: "helped" };
}

function settleRelax(next: GameState, target: number, co: number): { trustSeed: number } {
  const t = next.charas[target];
  if (!t) return { trustSeed: 0 };
  recoverPermil(next.master, BASE_ID.体力, 30);
  recoverPermil(next.master, BASE_ID.気力, 80);
  recoverPermil(t, BASE_ID.体力, 50);
  recoverPermil(t, BASE_ID.気力, 100);
  const favor = favorCoeff(t.state.CFLAG[CFLAG_ID.好感度] ?? 0);
  applySourceCheck(next, target, {
    [SOURCE_ID.歓楽]: (100 + ((t.state.ABL[ABL_ID.親密] ?? 0) + favor) * 10) * co,
    [SOURCE_ID.受動]: (50 + ((t.state.ABL[ABL_ID.従順] ?? 0) + favor) * 5) * co,
  });
  return { trustSeed: 0 };
}

function settleShop(next: GameState, target: number, co: number): { trustSeed: number } {
  const t = next.charas[target];
  if (!t) return { trustSeed: 0 };
  drainMasterBase(next, "体力", 20 * co);
  drainMasterBase(next, "気力", 20 * co);
  drainTargetBase(next, target, "体力", 10 * co);
  drainTargetBase(next, target, "気力", 10 * co);
  const favor = favorCoeff(t.state.CFLAG[CFLAG_ID.好感度] ?? 0);
  applySourceCheck(next, target, {
    [SOURCE_ID.歓楽]: (200 + ((t.state.ABL[ABL_ID.従順] ?? 0) + favor) * 50) * co,
  }, 0, 1);
  return { trustSeed: 1 };
}

function settleSnow(next: GameState, target: number, co: number): { trustSeed: number } {
  const t = next.charas[target];
  if (!t) return { trustSeed: 0 };
  drainMasterBase(next, "体力", 40 * co);
  drainMasterBase(next, "気力", 40 * co);
  drainTargetBase(next, target, "体力", 20 * co);
  drainTargetBase(next, target, "気力", 20 * co);
  const favor = favorCoeff(t.state.CFLAG[CFLAG_ID.好感度] ?? 0);
  applySourceCheck(next, target, {
    [SOURCE_ID.歓楽]: (150 + ((t.state.ABL[ABL_ID.親密] ?? 0) + favor) * 50) * co,
    [SOURCE_ID.受動]: (100 + ((t.state.ABL[ABL_ID.従順] ?? 0) + favor) * 50) * co,
    [SOURCE_ID.征服]: (100 + (t.state.ABL[ABL_ID.施虐属性] ?? 0) * 100) * co,
  }, 0, 1);
  return { trustSeed: 1 };
}

// ---------------------------------------------------------------------------
// Public dispatch — `runCompanionSettle` (called from COMF368 handler)
// ---------------------------------------------------------------------------

export interface CompanionOutcome {
  /** Narrative line to push into the NARRATION event log. */
  text: string;
  /** True iff the click was effective (some free action the player actually joined). */
  ok: boolean;
  /** True iff this click also credits a completion of the action. */
  completed: boolean;
  /** Projected remainder after WorldScheduler consumes `elapsedMinutes`. */
  remainingAfter: number;
  /** Minutes COM368 adds to TIME; WorldScheduler alone consumes the action. */
  elapsedMinutes: number;
  /** `FreeAct_Name` for the current free action (e.g. "在思考什么"),
   *  or `null` for unknown/deferred types. Mirrors `COMF368_DISPLAY`. */
  actionName: string | null;
}

/**
 * Run the companion settle for one click of 368. Mutates `next` in place.
 * `rng` is required (used by the play/遊び outcome roll).
 */
export function runCompanionSettle(
  next: GameState,
  target: number,
  rng: { int(max: number): number },
): CompanionOutcome {
  const t = next.charas[target];
  if (!t) {
    return { text: "没有目标角色。", ok: false, completed: false, remainingAfter: 0, elapsedMinutes: 0, actionName: null };
  }
  const fa = next.freeActions?.[target];
  if (!fa) {
    return { text: "目标没有进行中的自由行动。", ok: false, completed: false, remainingAfter: 0, elapsedMinutes: 0, actionName: null };
  }
  // Faithful to ERB `MIN(Activity_Duration, 30)` — `state.freeActions`
  // stores `remainingMinutes` = "action to-go minutes" (free-action.ts:242
  // seeds it with the full duration and decrements per tick). The 30 cap
  // means 368 credits at most 30 in-game minutes per click, regardless of
  // the action's original total.
  const elapsed = companionElapsedMinutes(next, target);
  const co = companionTimeCoef(elapsed);

  let text: string;
  let trustSeed: number;
  let ok = true;
  switch (fa.type) {
    case 0: {
      const r = settleThink(next, target, co);
      trustSeed = r.trustSeed;
      text = r.outcome === "understood" ? "一起度过了安静思考的时光。" : "没能跟上对方的思路。";
      break;
    }
    case 1: {
      const r = settlePlay(next, target, co, rng);
      trustSeed = r.trustSeed;
      text =
        r.outcome === "big"
          ? "两人玩得非常尽兴！"
          : r.outcome === "miss"
            ? "今天有点不太在状态。"
            : "一起玩了一会儿，挺开心。";
      break;
    }
    case 2: {
      const r = settleMeal(next, target, fa.remainingMinutes, co);
      trustSeed = r.trustSeed;
      text =
        r.outcome === "ate"
          ? "一起享用了可口的饭菜。"
          : "虽不饿也陪着吃了一些。";
      break;
    }
    case 3: {
      const r = settleMeal(next, target, fa.remainingMinutes, co);
      trustSeed = r.trustSeed;
      text = r.outcome === "ate" ? "一起享用了小零食。" : "虽不饿也陪着吃了些零食。";
      break;
    }
    case 4: {
      const r = settleClean(next, target, elapsed, co);
      trustSeed = r.trustSeed;
      text = "一起把房间打扫干净了。";
      break;
    }
    case 5: {
      const r = settleTrain(next, target, co);
      trustSeed = r.trustSeed;
      text = "一起进行了战斗训练。";
      break;
    }
    case 6: {
      const r = settleRead(next, target, co);
      trustSeed = r.trustSeed;
      text =
        r.outcome === "read"
          ? "一起读完了书。"
          : "她还在看书，等一会儿再一起吧。";
      break;
    }
    case 7: {
      const r = settleCook(next, target, fa.remainingMinutes, co);
      trustSeed = r.trustSeed;
      text = r.outcome === "helped" ? "一起帮忙把饭菜做好了。" : "一起分享了做好的饭菜。";
      break;
    }
    case 8: {
      const r = settleMusic(next, target, co, rng);
      trustSeed = r.trustSeed;
      text = r.outcome === "listen"
        ? "没有可用乐器，只能在一旁欣赏。"
        : r.outcome === "big"
          ? "两人的合奏格外精彩。"
          : r.outcome === "miss"
            ? "合奏时显得有些紧张。"
            : "一起完成了一段稳定的合奏。";
      break;
    }
    case 9: {
      const r = settleGather(next, target, co);
      trustSeed = r.trustSeed;
      text = "一起采集了一些东西。";
      break;
    }
    case 10: {
      const r = settleFishing(next, target, co);
      trustSeed = r.trustSeed;
      text = r.hasRod ? "在旁边一起钓起了鱼。" : "没有鱼竿，只好在旁边看着对方钓鱼。";
      break;
    }
    case 12:
    case 18: {
      const r = settleRelax(next, target, co);
      trustSeed = r.trustSeed;
      text = fa.type === 18 ? "一起在被炉里暖和地放松了。" : "一起悠闲地休息了。";
      break;
    }
    case 14: {
      const r = settleShop(next, target, co);
      trustSeed = r.trustSeed;
      text = "一起逛了逛店铺。";
      break;
    }
    case 13: {
      const r = settleDrink(next, target, co, rng);
      trustSeed = r.trustSeed;
      text = "陪着对方喝酒碰杯。";
      break;
    }
    case 16: {
      const r = settlePitfall(next, target, co);
      if (!r) {
        return { text: "当前落穴恶作剧状态不完整。", ok: false, completed: false, remainingAfter: fa.remainingMinutes, elapsedMinutes: 0, actionName: null };
      }
      trustSeed = r.trustSeed;
      text = r.victim ? "查看了对方掉入的落穴。" : "一起把落穴布置得更加隐蔽。";
      break;
    }
    case 17: {
      const r = settleSnow(next, target, co);
      trustSeed = r.trustSeed;
      text = "一起完成了雪雕。";
      break;
    }
    default:
      ok = false;
      trustSeed = 0;
      text = "这种自由行动暂未实现陪同行。";
      return {
        text,
        ok,
        completed: false,
        remainingAfter: fa.remainingMinutes,
        elapsedMinutes: 0,
        actionName: null,
      };
  }

  // Do not mutate Activity_Duration here. COM368 advances TIME, then the
  // authoritative WorldScheduler consumes this exact interval once and
  // applies the action's ordinary progress/completion effects.
  const remainingAfter = Math.max(0, fa.remainingMinutes - elapsed);
  const completed = remainingAfter === 0;
  // Suppress unused-var warnings for trustSeed (applySourceCheck already
  // accepted it per-arm; we keep the field for future TRUST_CALC hook).
  void trustSeed;
  // NARRATION text uses the faithful `FreeAct_Name` (e.g. "在思考什么")
  // — the player clicked the command labelled that way, so the reply
  // should reference the same name. The per-type `text` we built above
  // stays as a richer detail line for the same event.
  const actionName = companionActionName(fa.type, fa.remainingMinutes, t);
  const label = actionName ?? "这种自由行动";
  return {
    text: `陪${t.callName ?? "目标"}${label}。${text}`,
    ok,
    completed,
    remainingAfter,
    elapsedMinutes: elapsed,
    actionName,
  };
}

// ---------------------------------------------------------------------------
// Action name — `COMF368_DISPLAY = FreeAct_Name(TARGET)` faithful mirror
// ---------------------------------------------------------------------------
//
// Each FREE_ACT_*.ERB has `@FFreeActN(... O_DATA, V_NAME) CASE "名前"
// RETURNF "<name>"`. The name is what the 368 command renders as its label
// in the game UI. We surface the same string both on the backend (NARRATION
// text after a click) and the frontend (dynamic button label on the
// command grid) by reading from this single map.
//
// **Source: matching `FREE_ACT_*.ERB` `CASE "名前"` arms. Type 7 changes
//   its label when cooking reaches the final meal-sharing phase.**

const COMPANION_ACTION_NAMES: Readonly<Record<number, string>> = {
  0: "在思考什么",
  1: "一起玩",
  2: "一起吃饭",
  3: "一起吃小零食",
  4: "帮忙扫除",
  5: "一起训练",
  6: "一起读书",
  7: "帮忙做饭",
  8: "进行伴奏",
  9: "一起采集",
  10: "一起钓鱼",
  12: "一起放松",
  13: "陪同喝酒",
  14: "一起购物",
  16: "去看看情况",
  17: "一起堆雪",
  18: "在被炉里放松",
};

/**
 * Faithful mirror of `FreeAct_Name(target)` for supported free-action types.
 * Returns `null` for unknown/deferred types so callers fail closed.
 */
export function companionActionName(
  type: number,
  remainingMinutes?: number,
  target?: Pick<CharaSlot, "charaNum" | "state">,
): string | null {
  if (type === 7 && remainingMinutes !== undefined && remainingMinutes <= 30) {
    return "求分点饭菜";
  }
  if (type === 8 && (target?.state.TALENT[TALENT_ID.音楽知識] ?? 0) === 1) {
    return "协同合奏";
  }
  if (type === 16 && PITFALL_PRANKSTERS.has(target?.charaNum ?? -1)) {
    return "一起恶作剧";
  }
  return COMPANION_ACTION_NAMES[type] ?? null;
}
