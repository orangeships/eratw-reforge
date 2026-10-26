/**
 * Phase 7 (Wave 4g) — three foreplay commands: COMF19 キス（継続）,
 * COMF23 ピロートーク, COMF25 二穴愛撫. None fits a clean ComfDef (toggle
 * state machine / dynamic-roll + recovery / dual-orifice with 処女 branches),
 * so each is a bespoke handler here.
 *
 * - **COMF19 キス（継続）** (`COMF19 キス（継続）.ERB`): toggle 継続接吻
 *   (TEQUIP:45). If already on → clear + RETURN -1 (canceled). Else: set
 *   継続接吻=1; TCVAR:116=PLAYER 行為者; TCVAR:PLAYER:108 + TCVAR:108=1
 *   (奉仕フラグ both). Time-stop branch: TSP-20, SOURCE:快Ｍ=ABL:PLAYER:舌*3+10.
 *   Normal: DOWNBASE 気力 30 (bare=TARGET); SOURCE:快Ｍ=舌*3+10 (target) +
 *   SOURCE:PLAYER:快Ｍ=ABL:舌*3+10 (master); 情愛=100+GET_REVISION(愛情経験,200,100)
 *   + 好感度 bracket; 性行動=50+GET_REVISION(愛情経験,50,100); 屈従10/逸脱10/
 *   反感10/不潔30; 恋慕 && !time-stop && !恶作剧 → EXP:愛情経験++; TCVAR:ＦＫ喪失=1.
 *   RETURN 1. **DEFER**: KISS_CANCEL/KISS_TALENTEFFECT/KISS_EXP helpers; STAIN;
 *   the EQUIP_COM19 per-turn continuation (separate @EQUIP_COM19 call).
 *
 * - **COMF23 ピロートーク** (`COMF23 ピロートーク.ERB`): fatigue early-return
 *   if TCVAR:会話不能 (302) truthy (TIME+10, DOWNBASE 気力 100 both, RETURN 1).
 *   The gate (302) is SEPARATE from the 会話累計値 (301) accumulator the body
 *   grows — upstream the scheduler raises 302 once 301 > 100. That 301→302
 *   conversion is deferred to the Phase-8 WorldScheduler (settlement.ts注).
 *   Else: SOURCE 歓楽=200 + ABL:親密 tier bracket + CFLAG:好感度 bracket;
 *   受動=100+100*従順; 征服=100+100*施虐属性. Dynamic success roll
 *   `LOCAL = RAND:(200 - !(!恋慕)*100 - 思慕*50)` (range 100 if 恋慕, else 200);
 *   LOCAL<=20 → 大成功 (TFLAG:193=1, TFLAG:信頼度管理=2, EXP:PLAYER:会話経験++);
 *   LOCAL>=95 or TFLAG:192==-1 → 失敗 (TFLAG:193=-1, TFLAG:好感度减少=2). TIMES
 *   multipliers by tier (0.10/1.00/2.00) + 話術技能 CASE (0.20..1.50).
 *   TCVAR:会話累計 += 1200/(10+話術技能). RECOVER_PERMIL both 体力 50;
 *   気力/精力 by tier (大成功 100/150/150, 失敗 -100/-100/50, normal 100/100/100).
 *   TIME+30. RETURN 1. **DEFER**: TFLAG:192 kojo override (only the ==-1 fail
 *   arm consumed); full RECOVER_PERMIL MAXBASE seeding for target.
 *
 * - **COMF25 二穴愛撫** (`COMF25 二穴愛撫.ERB`): TCVAR:116=PLAYER; TCVAR:PLAYER:108=1
 *   (奉仕フラグ); TFLAG:破瓜抑制=1; TCVAR:TARGET:2=12 (Ａ責め); TCVAR:TARGET:4=800.
 *   Time-stop branch (FLAG:70==1): TSP-200; 快Ｖ(処女?50:100)/苦痛60/快Ａ80 +
 *   器用な指+15 + 指*5; EXP Ｖ経験++/手淫経験++. Normal: DOWNBASE 体力120/気力250
 *   (bare=TARGET); 快Ｖ(処女?60:100)/苦痛(処女?120:100)/快Ａ80/屈従100/露出20/
 *   逸脱(処女?120:100)/反感(処女?120:100) + 器用な指+15 + 指*5; 鬱屈+20 if
 *   自己愛<0||抵抗 (+10 if 処女); EXP Ｖ経験++/手淫経験++. RETURN 1. **DEFER**:
 *   PAIN_CHECK_V; HETEROSEX EXP; STAIN; @COM_ABLE gates (TFLAG:100/GLOBAL_COMABLE/
 *   毒人形/性別/指<3/挿入中/ビーズ/浣腸/バルーン/電極/ASSI 潤滑/着衣).
 */

import type { GameState, CharaSlot } from "../../state/game-state.js";
import type { CommandContext, HandlerEntry } from "../types.js";
import { cloneGameState } from "../../state/game-state.js";
import { applySourceCheck, settleSourcePalam } from "../source-check.js";
import {
  ABL_ID,
  BASE_ID,
  CFLAG_ID,
  EXP_ID,
  FLAG_ID,
  SOURCE_ID,
  TALENT_ID,
  TCVAR_ID,
  TEQUIP_ID,
  advanceTimeTicks,
  getMasterBase,
  getRevision,
  recoverPermil,
  setMasterBase,
  times,
} from "../../state/settlement.js";
import { TFLAG_ID, getTflag, setTflag } from "../../state/tflag.js";
import { readTequip, writeTequip } from "../../state/tequip.js";
import { roomProps } from "../comable/room-props.js";
import { checkHBaseResourceAvailability } from "../h-base-resources.js";

const PLAYER = 0;
/** TEQUIP:継続接吻 (Tequip.csv id=45). Master TEQUIP slot. */
const TEQUIP_CONT_KISS = TEQUIP_ID.継続接吻;

function abl(slot: CharaSlot, id: number): number {
  return slot.state.ABL[id] ?? 0;
}
function talent(slot: CharaSlot, id: number): number {
  return slot.state.TALENT[id] ?? 0;
}

// ---------------------------------------------------------------------------
// COMF19 — キス（継続） (continuous-kiss toggle)
// ---------------------------------------------------------------------------

export const comf19HandlerEntry: HandlerEntry = {
  commandNo: 19,
  handler: (ctx: CommandContext) => {
    const next: GameState = cloneGameState(ctx.state);
    const target = next.charas[ctx.target]!;
    const master = next.master;

    // Toggle: if already 継続接吻 → clear + RETURN -1 (canceled).
    if (readTequip(master, TEQUIP_CONT_KISS) !== 0) {
      writeTequip(master, TEQUIP_CONT_KISS, 0);
      return {
        state: next,
        events: [
          { kind: "NARRATION" as const, timestamp: ctx.now(),
            text: `%CALLNAME:MASTER% 结束了与 %CALLNAME:TARGET% 的接吻。` },
        ],
        outcome: "noop" as const,
      };
    }

    // KISS_CANCEL (deferred — assume proceeds).
    writeTequip(master, TEQUIP_CONT_KISS, 1);
    target.state.TCVAR[TCVAR_ID.行為者] = PLAYER;
    master.state.TCVAR[TCVAR_ID.奉仕フラグ] = 1;
    target.state.TCVAR[TCVAR_ID.奉仕フラグ] = 1;

    const timeStop = (next.flagStore[FLAG_ID.時間停止] ?? 0) !== 0;

    if (timeStop) {
      // Time-stop branch: TSP-20, SOURCE:快Ｍ=舌*3+10.
      setMasterBase(next, BASE_ID.TSP, (getMasterBase(next, BASE_ID.TSP) ?? 0) - 20);
      const targetSources: Record<number, number> = {
        [SOURCE_ID.快Ｍ]: abl(master, ABL_ID.舌) * 3 + 10,
      };
      applySourceCheck(next, ctx.target, targetSources, 0);
      return {
        state: next,
        events: [
          { kind: "NARRATION" as const, timestamp: ctx.now(),
            text: `%CALLNAME:MASTER% 在时间停止中亲吻了 %CALLNAME:TARGET%。（TSP -20）` },
        ],
        outcome: "ok" as const,
      };
    }

    // Normal branch. DOWNBASE 気力 30 (bare = TARGET).
    target.state.BASE[BASE_ID.気力] = (target.state.BASE[BASE_ID.気力] ?? 0) - 30;

    const loveExp = target.state.EXP[EXP_ID.愛情経験] ?? 0;
    const favor = target.state.CFLAG[CFLAG_ID.好感度] ?? 0;

    // Master 快Ｍ SOURCE.
    const masterSources: Record<number, number> = {
      [SOURCE_ID.快Ｍ]: abl(target, ABL_ID.舌) * 3 + 10,
    };

    // Target SOURCE set.
    let targetSources: Record<number, number> = {
      [SOURCE_ID.快Ｍ]: abl(master, ABL_ID.舌) * 3 + 10,
      [SOURCE_ID.情愛]: 100 + getRevision(loveExp, 200, 100),
      [SOURCE_ID.性行動]: 50 + getRevision(loveExp, 50, 100),
      [SOURCE_ID.屈従]: 10,
      [SOURCE_ID.逸脱]: 10,
      [SOURCE_ID.反感]: 10,
      [SOURCE_ID.不潔]: 30,
    };
    // 好感度 bracket → 情愛.
    let loveBonus = 0;
    if (favor <= 500) loveBonus = favor;
    else if (favor <= 5000) loveBonus = 300 + Math.trunc((favor - 500) / 6);
    else loveBonus = 1000 + Math.trunc((favor - 5000) / 8);
    targetSources[SOURCE_ID.情愛] = (targetSources[SOURCE_ID.情愛] ?? 0) + loveBonus;
    if (targetSources[SOURCE_ID.情愛]! < 0) targetSources[SOURCE_ID.情愛] = 0;

    // KISS_TALENTEFFECT deferred.

    // EXP: 恋慕 && !time-stop && !恶作剧 → EXP:愛情経験++.
    if (talent(target, TALENT_ID.恋慕) !== 0 && (target.state.CFLAG[CFLAG_ID.恶作剧] ?? 0) === 0) {
      target.state.EXP[EXP_ID.愛情経験] = (target.state.EXP[EXP_ID.愛情経験] ?? 0) + 1;
    }
    // TCVAR:ＦＫ喪失 = 1.
    target.state.TCVAR[TCVAR_ID.ＦＫ喪失] = 1;

    settleSourcePalam(next, master, master, masterSources);
    const settled = applySourceCheck(next, ctx.target, targetSources, 0);

    return {
      state: next,
      events: [
        { kind: "NARRATION" as const, timestamp: ctx.now(),
          text: `%CALLNAME:MASTER% 与 %CALLNAME:TARGET% 开始了持续的接吻。好感度 ${settled.favorDelta >= 0 ? "+" : ""}${settled.favorDelta}。` },
        ...settled.events,
      ],
      outcome: "ok" as const,
    };
  },
};

// ---------------------------------------------------------------------------
// COMF23 — ピロートーク (pillow talk)
// ---------------------------------------------------------------------------

/**
 * @COM_ABLE23 (P1-14) — the pillow-talk menu/exec gate. Modeled arms:
 *   both 体力 > MAXBASE/2 → block (someone must be tired); TEQUIP 11-24 any →
 *   block; 継続接吻 (45) → block; CFLAG:恶作剧>1 → block; !BEDROOM → block
 *   (≈ roomProps.private). During 時止め, CFLAG:344 must be set; the 発情/
 *   幼稚 master-tired-only arms remain deferred.
 */
function pillowTalkGate(ctx: CommandContext) {
  const targetHasActed = ctx.state.charas[ctx.target]?.state.CFLAG[CFLAG_ID.時間停止行動] ?? 0;
  if ((ctx.state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0 && targetHasActed === 0) {
    return {
      ok: false as const,
      reason: { kind: "precondition" as const, message: "对方还没有在时间停止中行动。" },
    };
  }
  const t = ctx.state.charas[ctx.target];
  if (!t) return { ok: false as const, reason: { kind: "precondition" as const, message: "需要在场的对象。" } };
  const masterMax = ctx.state.master.state.MAXBASE[BASE_ID.体力] ?? 0;
  const targetMax = t.state.MAXBASE[BASE_ID.体力] ?? 0;
  const masterFresh = masterMax > 0 && (ctx.state.master.state.BASE[BASE_ID.体力] ?? 0) > masterMax / 2;
  const targetFresh = targetMax > 0 && (t.state.BASE[BASE_ID.体力] ?? 0) > targetMax / 2;
  if (masterFresh && targetFresh) {
    return { ok: false as const, reason: { kind: "precondition" as const, message: "现在两人都还有精神，不需要枕边话。" } };
  }
  const bag = t.state.TEQUIP;
  if (bag && typeof bag === "object") {
    for (let id = 11; id < 25; id++) if (bag[id]) {
      return { ok: false as const, reason: { kind: "precondition" as const, message: "装备着道具，无法进行枕边话。" } };
    }
  }
  if (readTequip(t, TEQUIP_ID.継続接吻)) {
    return { ok: false as const, reason: { kind: "precondition" as const, message: "正在接吻中，无法搭话。" } };
  }
  if ((t.state.CFLAG[CFLAG_ID.恶作剧] ?? 0) > 1) {
    return { ok: false as const, reason: { kind: "precondition" as const, message: "睡眠侵犯中无法进行。" } };
  }
  if (!roomProps(ctx.state.master.location).private) {
    return { ok: false as const, reason: { kind: "precondition" as const, message: "需要躺在床铺上才行。" } };
  }
  return { ok: true as const };
}

function pillowTalkResourceGate(ctx: CommandContext) {
  const gate = pillowTalkGate(ctx);
  if (!gate.ok) return gate;
  const target = ctx.state.charas[ctx.target]!;
  if ((target.state.TCVAR[TCVAR_ID.会話不能] ?? 0) === 0) return gate;
  return checkHBaseResourceAvailability(ctx, {
    master: { [BASE_ID.気力]: 100 },
    target: { [BASE_ID.気力]: 100 },
  });
}

export const comf23HandlerEntry: HandlerEntry = {
  commandNo: 23,
  execCheck: pillowTalkResourceGate,
  hModeMenuCheck: pillowTalkResourceGate,
  handler: (ctx: CommandContext) => {
    const next: GameState = cloneGameState(ctx.state);
    const target = next.charas[ctx.target]!;
    const master = next.master;

    // Fatigue early-return: TCVAR:会話不能 (302) truthy. NOTE this is a
    // SEPARATE var from the 会話累計値 (301) accumulator below — the scheduler
    // raises 302 once 301 > 100 (deferred Phase-8 tick; see settlement.ts).
    // Reading 302 (not 301) means a single ピロートーク doesn't self-trip the
    // gate on the next turn.
    if ((target.state.TCVAR[TCVAR_ID.会話不能] ?? 0) !== 0) {
      target.state.BASE[BASE_ID.気力] = (target.state.BASE[BASE_ID.気力] ?? 0) - 100;
      setMasterBase(next, BASE_ID.気力, (getMasterBase(next, BASE_ID.気力) ?? 0) - 100);
      advanceTimeTicks(next, 10);
      return {
        state: next,
        events: [
          { kind: "NARRATION" as const, timestamp: ctx.now(),
            text: `想向 %CALLNAME:TARGET% 搭话却不知该说些什么，四周弥漫着尴尬的气氛…` },
        ],
        outcome: "ok" as const,
      };
    }

    // SOURCE 歓楽 = 200 + ABL:親密 tier + 好感度 bracket.
    const shinmitsu = abl(target, ABL_ID.親密);
    const juujun = abl(target, ABL_ID.従順);
    const sado = abl(target, ABL_ID.施虐属性);
    const favor = target.state.CFLAG[CFLAG_ID.好感度] ?? 0;

    let sources: Record<number, number> = { [SOURCE_ID.歓楽]: 200 };
    if (shinmitsu <= 1) sources[SOURCE_ID.歓楽]! += juujun * 40;
    else if (shinmitsu <= 3) sources[SOURCE_ID.歓楽]! += 200 + juujun * 40;
    else if (shinmitsu <= 5) sources[SOURCE_ID.歓楽]! += 500 + juujun * 40;
    else if (shinmitsu <= 8) sources[SOURCE_ID.歓楽]! += 750 + juujun * 60;
    else if (shinmitsu <= 10) sources[SOURCE_ID.歓楽]! += 1000 + juujun * 60;
    else sources[SOURCE_ID.歓楽]! += 1600 + juujun * 30;

    if (favor <= 1000) sources[SOURCE_ID.歓楽]! += favor;
    else if (favor <= 5000) sources[SOURCE_ID.歓楽]! += 500 + Math.trunc((favor - 1000) / 3);
    else sources[SOURCE_ID.歓楽]! += 2000 + Math.trunc((favor - 5000) / 5);
    if (sources[SOURCE_ID.歓楽]! < 0) sources[SOURCE_ID.歓楽] = 0;

    sources[SOURCE_ID.受動] = 100 + 100 * juujun;
    sources[SOURCE_ID.征服] = 100 + 100 * sado;

    // Dynamic success roll: LOCAL = RAND:(200 - !(!恋慕)*100 - 思慕*50).
    const renbo = talent(target, TALENT_ID.恋慕) !== 0 ? 1 : 0;
    const shibo = talent(target, TALENT_ID.思慕);
    const rollRange = 200 - (renbo ? 100 : 0) - shibo * 50;
    const local = ctx.rng.int(Math.max(1, rollRange)); // RAND:N → 0..N-1.

    const kojo192 = getTflag(next, TFLAG_ID.口上によるCOM成否判定);
    let tier = 0; // TFLAG:193: -1 fail / 0 normal / 1 大成功.
    if (kojo192 > 0) {
      // kojo forces success path — SUCCESS function decides; leave tier 0.
    } else if (kojo192 === -2) {
      // 指令中止 → RETURN 0.
      return { state: next, events: [], outcome: "noop" as const };
    } else if (local <= 20) {
      tier = 1;
      setTflag(next, TFLAG_ID.信頼度管理, 2);
      master.state.EXP[EXP_ID.会話経験] = (master.state.EXP[EXP_ID.会話経験] ?? 0) + 1;
    } else if (local >= 95 || kojo192 === -1) {
      tier = -1;
      setTflag(next, TFLAG_ID.好感度减少, 2);
    }
    setTflag(next, TFLAG_ID.SELECTCOM的分岐, tier);

    // TIMES multipliers by tier.
    const tierMul = tier === -1 ? 0.1 : tier === 0 ? 1.0 : 2.0;
    sources[SOURCE_ID.歓楽] = times(sources[SOURCE_ID.歓楽]!, tierMul);
    sources[SOURCE_ID.征服] = times(sources[SOURCE_ID.征服]!, tierMul);
    sources[SOURCE_ID.受動] = times(sources[SOURCE_ID.受動]!, tierMul);

    // 話術技能 CASE multiplier.
    const wa = abl(master, ABL_ID.話術技能);
    const waMul = wa === 0 ? 0.2 : wa === 1 ? 0.4 : wa === 2 ? 0.7 : wa === 3 ? 1.0 : wa === 4 ? 1.2 : 1.5;
    sources[SOURCE_ID.歓楽] = times(sources[SOURCE_ID.歓楽]!, waMul);
    sources[SOURCE_ID.征服] = times(sources[SOURCE_ID.征服]!, waMul);
    sources[SOURCE_ID.受動] = times(sources[SOURCE_ID.受動]!, waMul);

    // 会話累計 += 1200/(10+話術技能).
    const talkGain = Math.trunc(1200 / (10 + wa));
    target.state.TCVAR[TCVAR_ID.会話累計] = (target.state.TCVAR[TCVAR_ID.会話累計] ?? 0) + talkGain;

    // RECOVER_PERMIL both 体力 50.
    recoverPermil(master, BASE_ID.体力, 50);
    recoverPermil(target, BASE_ID.体力, 50);
    // 気力/精力 by tier.
    if (tier === 1) {
      recoverPermil(master, BASE_ID.気力, 100);
      recoverPermil(target, BASE_ID.気力, 150);
      recoverPermil(master, BASE_ID.精力, 150);
    } else if (tier === -1) {
      recoverPermil(master, BASE_ID.気力, -100);
      recoverPermil(target, BASE_ID.気力, -100);
      recoverPermil(master, BASE_ID.精力, 50);
    } else {
      recoverPermil(master, BASE_ID.気力, 100);
      recoverPermil(target, BASE_ID.気力, 100);
      recoverPermil(master, BASE_ID.精力, 100);
    }

    advanceTimeTicks(next, 30);

    const settled = applySourceCheck(next, ctx.target, sources, 0);
    const tierWord = tier === 1 ? "相谈甚欢，" : tier === -1 ? "运气不佳，" : "";
    return {
      state: next,
      events: [
        { kind: "NARRATION" as const, timestamp: ctx.now(),
          text: `%CALLNAME:MASTER% 与 %CALLNAME:TARGET% 说起了枕边话。${tierWord}好感度 ${settled.favorDelta >= 0 ? "+" : ""}${settled.favorDelta}。` },
        ...settled.events,
      ],
      outcome: "ok" as const,
    };
  },
};

// ---------------------------------------------------------------------------
// COMF25 — 二穴愛撫 (dual V/A fingering)
// ---------------------------------------------------------------------------

export const comf25HandlerEntry: HandlerEntry = {
  commandNo: 25,
  handler: (ctx: CommandContext) => {
    const next: GameState = cloneGameState(ctx.state);
    const target = next.charas[ctx.target]!;
    const master = next.master;

    // COM別FLAG: 行為者 + 奉仕フラグ + 破瓜抑制 + 射精箇所/強度.
    target.state.TCVAR[TCVAR_ID.行為者] = PLAYER;
    master.state.TCVAR[TCVAR_ID.奉仕フラグ] = 1;
    setTflag(next, TFLAG_ID.破瓜抑制FLAG, 1);
    target.state.TCVAR[TCVAR_ID.射精箇所] = 12; // Ａ責め
    target.state.TCVAR[TCVAR_ID.射精快感強度] = 800;

    const timeStop = (next.flagStore[FLAG_ID.時間停止] ?? 0) !== 0;
    const isVirgin = talent(target, TALENT_ID.処女) !== 0 && talent(target, TALENT_ID.処女) !== -1;
    const finger = abl(master, ABL_ID.指);
    const deftFingers = talent(master, TALENT_ID.器用な指) !== 0;

    if (timeStop) {
      // Time-stop branch (FLAG:70==1; CFLAG:344 not modeled).
      setMasterBase(next, BASE_ID.TSP, (getMasterBase(next, BASE_ID.TSP) ?? 0) - 200);
      let sources: Record<number, number> = {
        [SOURCE_ID.快Ｖ]: isVirgin ? 50 : 100,
        [SOURCE_ID.苦痛]: 60,
        [SOURCE_ID.快Ａ]: 80,
      };
      if (deftFingers) {
        sources[SOURCE_ID.快Ｖ]! += 15;
        sources[SOURCE_ID.快Ａ]! += 15;
      }
      sources[SOURCE_ID.快Ｖ]! += finger * 5;
      sources[SOURCE_ID.快Ａ]! += finger * 5;
      target.state.EXP[EXP_ID.Ｖ経験] = (target.state.EXP[EXP_ID.Ｖ経験] ?? 0) + 1;
      master.state.EXP[EXP_ID.手淫経験] = (master.state.EXP[EXP_ID.手淫経験] ?? 0) + 1;
      const settled = applySourceCheck(next, ctx.target, sources, 0);
      return {
        state: next,
        events: [
          { kind: "NARRATION" as const, timestamp: ctx.now(),
            text: `%CALLNAME:MASTER% 在时间停止中爱抚了 %CALLNAME:TARGET% 的双穴。（TSP -200）` },
          ...settled.events,
        ],
        outcome: "ok" as const,
      };
    }

    // Normal branch. DOWNBASE 体力 120 / 気力 250 (bare = TARGET).
    target.state.BASE[BASE_ID.体力] = (target.state.BASE[BASE_ID.体力] ?? 0) - 120;
    target.state.BASE[BASE_ID.気力] = (target.state.BASE[BASE_ID.気力] ?? 0) - 250;

    let sources: Record<number, number> = {
      [SOURCE_ID.快Ｖ]: isVirgin ? 60 : 100,
      [SOURCE_ID.苦痛]: isVirgin ? 120 : 100,
      [SOURCE_ID.快Ａ]: 80,
      [SOURCE_ID.屈従]: 100,
      [SOURCE_ID.露出]: 20,
      [SOURCE_ID.逸脱]: isVirgin ? 120 : 100,
      [SOURCE_ID.反感]: isVirgin ? 120 : 100,
    };
    if (deftFingers) {
      sources[SOURCE_ID.快Ｖ]! += 15;
      sources[SOURCE_ID.快Ａ]! += 15;
    }
    sources[SOURCE_ID.快Ｖ]! += finger * 5;
    sources[SOURCE_ID.快Ａ]! += finger * 5;
    // 鬱屈 +20 if 自己愛<0 || 抵抗; +10 if 処女.
    if (talent(target, TALENT_ID.自己愛) < 0 || talent(target, TALENT_ID.抵抗) !== 0) {
      sources[SOURCE_ID.鬱屈] = (sources[SOURCE_ID.鬱屈] ?? 0) + 20;
      if (isVirgin) sources[SOURCE_ID.鬱屈]! += 10;
    }

    target.state.EXP[EXP_ID.Ｖ経験] = (target.state.EXP[EXP_ID.Ｖ経験] ?? 0) + 1;
    master.state.EXP[EXP_ID.手淫経験] = (master.state.EXP[EXP_ID.手淫経験] ?? 0) + 1;

    const settled = applySourceCheck(next, ctx.target, sources, 0);
    return {
      state: next,
      events: [
        { kind: "NARRATION" as const, timestamp: ctx.now(),
          text: `%CALLNAME:MASTER% 爱抚了 %CALLNAME:TARGET% 的双穴。好感度 ${settled.favorDelta >= 0 ? "+" : ""}${settled.favorDelta}。` },
        ...settled.events,
      ],
      outcome: "ok" as const,
    };
  },
};
