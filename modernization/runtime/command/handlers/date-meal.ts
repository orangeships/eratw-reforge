/**
 * Phase 7 (Wave 2c) — `COMF610 食事（デート）` + `COMF615 お弁当を食べる`.
 * Date-meal settlements. Faithful to
 * `ERB/コマンド関連/COMF/外出系/COMF610 食事（デート）.ERB` and
 * `…/COMF615 お弁当を食べる.ERB`.
 *
 * **Both are deterministic** (no B9 picker) — a `RAND` success-tier check
 * + SOURCE brackets + `RECOVER_PERMIL_BOTH` + `満腹度上昇`. They do NOT
 * touch the DISH subsystem (the dish is the restaurant's / the bento's,
 * not the player's cooked `state.dish`); hunger-clock + recovery reuse
 * `dish.ts` (`riseFullness` = `@満腹度上昇`) and `recoverPermil`.
 *
 * **Reachability** gates on a dating subsystem (Wave 3): `@COM_ABLE610/615`
 * requires `CHK_DATENOW(CFLAG:12)` (target is on a date) + a date-eat
 * location (`DATE_PARTY` / `OBENTO`). The modern string rooms are projected
 * through the same ODEKAKE zone groups before these gates are evaluated.
 *
 * **COMF610 ported faithfully (`@COM610`, ERB 2-137):**
 *   - success tier: `RAND:100` vs `LOCAL:2=9` (大成功) / `LOCAL:1=90+SR/5`
 *     cap 99 (失敗); `SR = GET_SUCCESS_RATE(target)` (non-DLC branch —
 *     親密/恭順/心情; the TALENT subtractions defer, clean chara → 0).
 *   - 大成功 → `EXP:MASTER:会話経験++ 約會経験++`, `EXP:TARGET:約會経験++`.
 *   - `DOWNBASE:気力 += 10` — bare = TARGET (char-completion ON), so the
 *     **target** loses 気力 (not the master). See bareCharDrain note.
 *   - SOURCE 歓楽=800 / 情愛=300 + 欲望 ladder (歓楽) + 奉仕精神 ladder
 *     (情愛) + 好感度 ladder (歓楽, floor 0) + 受動=200+100*従順 +
 *     征服=200+100*施虐属性.
 *   - `TIMES` by tier (-1: 歓楽/情愛×0.10 征服/受動×0.50; 0: ×1.00;
 *     +1: 歓楽/征服/受動×2.00 情愛×1.50). `TALENT:大胃王` → 歓楽 ×1.50.
 *   - `RECOVER_PERMIL_BOTH(TARGET, 150/300/100, 体力/気力/精力)` — recovers
 *     target **and** master (BOTH).
 *   - `TIME += 60`; `EXP:MASTER/TARGET:約會経験++`; `満腹度上昇` 主食 (both);
 *     `MONEY -= 3000`; `TFLAG:授乳コマンド = 1`.
 *
 * **COMF615 ported faithfully (`@COM615`, ERB 1-116):**
 *   - success tier: `LOCAL=RAND:3`, `LOCAL:1=RAND:10`; `LOCAL > 料理技能`
 *     → 失敗 (-1); `LOCAL:1 <= 料理技能-2` → 大成功 (+1); else 成功 (0).
 *     大成功 → master 会話経験/約會経験++ + target 約會経験++.
 *   - `DOWNBASE:気力 += 50` — bare = TARGET (char-completion ON).
 *   - SOURCE 歓楽=300 / 情愛=300 / 露出=100 / 反感=50 + (親密+奉仕精神)
 *     ladder → 歓楽/達成/情愛 adds + `LOCAL:2` (1/2/3/5).
 *   - `EXP:料理経験 += LOCAL:2`; `TALENT:恋慕` → `EXP:愛情経験 += LOCAL:2`.
 *   - `RECOVER_PERMIL_BOTH` by 料理技能 tier (<2: 200/300/100; <4:
 *     250/350/150; else: 300/400/200).
 *   - `TIMES` by tier (-1/0/+1: 歓楽/達成/情愛 ×0.50/1.00/2.00).
 *   - `TIME += 60`; master/target 約會経験++; `満腹度上昇` 主食 (both);
 *     `SETBIT TFLAG:一日一回,1`; `TFLAG:授乳コマンド = 1`.
 *
 * **DEFERRED:**
 *   - `GET_SUCCESS_RATE` TALENT subtractions (態度/胆量/自尊心/目立ちたがり/
 *     自己愛/抵抗/容易高潮/OTOKOGIRAI/魅惑/RELATION) — ids not all imported;
 *     clean chara → 0, matches. `MAGIC_DLC_大成功相关` branch defer.
 *   - `TFLAG:信頼度管理` writes — no consumer (Phase 8 trust); skipped.
 *   - `addDateActionsDone` / `MOREDATE` group-date custom code — defer.
 *   - `MAGIC_DLC_大成功相关` (M_TFLAG:成功, LOCAL:2 boost) — defer.
 *   - `CFLAG:行動 == 5` (610) gate — modeled (working target blocked).
 *   - 大胃王 ×1.5 / ×0.7 — TALENT not imported → no-op for clean chara
 *     (structural hook left).
 */

import type { GameState } from "../../state/game-state.js";
import type { CharaSlot } from "../../state/game-state.js";
import type { HandlerEntry } from "../types.js";
import { cloneGameState } from "../../state/game-state.js";
import { applySourceCheck } from "../source-check.js";
import { riseFullness } from "../../state/dish.js";
import { canAfford, pay } from "../../state/money.js";
import {
  ABL_ID,
  BASE_ID,
  CFLAG_ID,
  EXP_ID,
  FLAG_ID,
  PALAM_ID,
  SOURCE_ID,
  TALENT_ID,
  TCVAR_ID,
  advanceTimeTicks,
  palamLevel,
  recoverPermil,
  times,
} from "../../state/settlement.js";
import { chkDateNow } from "../../world/location-predicates.js";
import { activeDatePartner, advanceDateTravel, syncDateMirrors } from "../../world/date-session.js";
import { locationToRoomId } from "../../world/room-id-location.js";
import { shrineZoneOf } from "../../world/odekake-shrine.js";
import { myourenZoneOf } from "../../world/odekake-myouren.js";
import { villageZoneOf } from "../../world/odekake-village.js";
import { koumakanZoneOf } from "../../world/odekake-koumakan.js";
import { tikurinZoneOf } from "../../world/odekake-tikurin.js";
import {
  TFLAG_ID,
  addTflag,
  getTflag,
  setTflag,
  setTflagBit,
} from "../../state/tflag.js";

// ---------------------------------------------------------------------------
// shared helpers
// ---------------------------------------------------------------------------

/**
 * `RECOVER_PERMIL_BOTH(chara, ‰, stat)` (COMMON.ERB:656) — recover `charaNum`,
 * and if `charaNum != MASTER` also recover master. Mirrors the ERA "BOTH".
 */
function recoverPermilBoth(
  state: GameState,
  charaNum: number,
  statId: number,
  permille: number,
): void {
  const slot = charaNum === 0 ? state.master : state.charas[charaNum];
  if (slot) recoverPermil(slot, statId, permille);
  if (charaNum !== 0) recoverPermil(state.master, statId, permille);
}

/**
 * `GET_SUCCESS_RATE(chara)` non-DLC branch (COMMON_J.ERB). Faithful for the
 * enums we have (親密, 恭順 PALAM, 心情); the TALENT subtractions and PLAYER
 * 魅惑/RELATION arms defer (clean chara → 0). Used by 610's 失敗 threshold.
 */
function getSuccessRate(slot: CharaSlot): number {
  let r = 0;
  r += Math.min(slot.state.ABL[ABL_ID.親密] ?? 0, 10) * 5;
  r += palamLevel(slot.state.PALAM[PALAM_ID.恭順] ?? 0, 5) * 3;
  // TALENT 態度/胆量/自尊心/目立ちたがり/自己愛/抵抗/容易高潮/OTOKOGIRAI defer.
  r += (slot.state.TALENT[TALENT_ID.心情] ?? 0) * 15;
  // PLAYER 魅惑/謎之魅力/魅力 + RELATION defer.
  return r;
}

/** `@満腹度上昇(chara, "主食")` — 主食 manpuku 360 (大胃王 ×0.7 defer). */
function riseMainMeal(state: GameState, charaNum: number): void {
  riseFullness(state, charaNum, "主食", 360);
}

/** Read TARGET's 約會経郷 and bump by 1. */
function bumpDateExp(slot: CharaSlot | undefined): void {
  if (!slot) return;
  slot.state.EXP[EXP_ID.約會経験] = (slot.state.EXP[EXP_ID.約會経験] ?? 0) + 1;
}

/**
 * Dating gate — `CHK_DATENOW(CFLAG:12)` (COMMON2.ERB:7) returns 1 when
 * `CFLAG:12` (约会中, the date MAPID) is not the home map (MAIN_MAP=0).
 * `@COM_ABLE610/615` checks the TARGET's `CFLAG:12` (bare CFLAG → TARGET).
 */
function isOnDate(state: GameState, target: number): boolean {
  if (activeDatePartner(state) === target) return state.dateSession?.phase === "active";
  const slot = target === 0 ? state.master : state.charas[target];
  if (!slot) return false;
  return chkDateNow(slot.state.CFLAG[CFLAG_ID.约会中] ?? 0);
}

/** `TIME_PROGRESS(TCVAR:312)` — hungry when `tickValue >= 空腹時刻`. */
function isHungry(state: GameState, charaNum: number): boolean {
  const slot = charaNum === 0 ? state.master : state.charas[charaNum];
  if (!slot) return false;
  return state.time.tickValue >= (slot.state.TCVAR[TCVAR_ID.空腹時刻] ?? 0);
}

/**
 * `DATE_PARTY(location)` from COMF610. The upstream predicate evaluates the
 * ODEKAKE zone id, not merely the map id. Modern play keeps detailed room
 * strings, so built maps are folded back into the same four eligible zones.
 */
export function datePartyAt(location: string): boolean {
  if (villageZoneOf(location) === "商家町") return true;

  // P218 小料理屋 and P933 酒場 are upstream's two otherwise-dead IN_HOME arms.
  if (location === "人間之里:小料理屋" || location === "人間の里:小料理屋") return true;

  // MAP_SEARCH_REPLACEMENT_4 CASEELSE → 竹林入口 (built live rooms).
  if (["迷途竹林", "迷途竹林:夜雀的小攤", "迷途竹林:祠"].includes(location)) return true;

  const roomId = locationToRoomId(location);
  // P601 中有之道; P931..P939 → 旧地獄街道.
  return roomId === 601 || (roomId !== null && roomId >= 931 && roomId <= 939);
}

/**
 * `OBENTO(location)` from COMF615. This is the exact set of ODEKAKE zones
 * whose ROOMSETTING declares `"お弁当"`, projected to modern detailed rooms.
 * Home/base rooms and the unmodeled invited room therefore remain closed.
 */
export function bentoAt(location: string): boolean {
  const shrineZone = shrineZoneOf(location);
  if (shrineZone === "桜花道的鳥居") return true;
  const myourenZone = myourenZoneOf(location);
  if (myourenZone === "地蔵小路" || myourenZone === "倒垂的柳樹下") return true;
  if (koumakanZoneOf(location) === "霧之湖") return true;
  const tikurinZone = tikurinZoneOf(location);
  if (tikurinZone === "無名之丘" || tikurinZone === "太陽花田") return true;

  const roomId = locationToRoomId(location);
  if (roomId !== null) {
    if (roomId >= 540 && roomId <= 545) return true; // 古木的大樹
    if (roomId === 604 || (roomId >= 610 && roomId <= 618)) return true; // 彼岸
    if ([703, 704, 708, 735].includes(roomId) || (roomId >= 741 && roomId <= 748)) return true;
    if (roomId === 805 || roomId === 814 || (roomId >= 830 && roomId <= 842)
      || (roomId >= 851 && roomId <= 854) || (roomId >= 860 && roomId <= 874)) return true;
    if (roomId === 1014 || roomId === 1015) return true; // 桃林～砂浜
    if ((roomId >= 1101 && roomId <= 1152) || roomId === 1185 || roomId === 1186) return true;
  }

  // Abstract ODEKAKE locations are retained for legacy/date fixtures and for
  // map 11, whose detailed modern scene table has not been generated yet.
  return new Set([
    "古木的大樹", "絶景之丘", "山之湖", "天界", "桃林～砂浜",
    "玄武之澤", "大蛤蟆之池", "圣域", "魔界都市",
  ]).has(location) || location.startsWith("魔界都市:");
}

// ---------------------------------------------------------------------------
// COMF610 — 食事（デート）
// ---------------------------------------------------------------------------

/** 610's success tier (-1 失敗 / 0 成功 / 1 大成功). Pure; RNG via `rng`. */
export function compute610Tier(rng: { int(max: number): number }, sr: number): number {
  const roll = rng.int(100); // LOCAL = RAND:100
  const failThreshold = Math.min(90 + Math.trunc(sr / 5), 99); // LOCAL:1, cap 99
  const greatThreshold = 9; // LOCAL:2 (MAGIC_DLC boost defer)
  if (roll <= greatThreshold) return 1;
  if (roll >= failThreshold) return -1;
  return 0;
}

/** 610 SOURCE assembly (歓楽/情愛/受動/征服) pre-tier-TIMES. Pure. */
export function compute610Sources(slot: CharaSlot): Record<number, number> {
  const yokubo = slot.state.ABL[ABL_ID.欲望] ?? 0;
  const houshi = slot.state.ABL[ABL_ID.奉仕精神] ?? 0;
  const favor = slot.state.CFLAG[CFLAG_ID.好感度] ?? 0;
  const juujun = slot.state.ABL[ABL_ID.従順] ?? 0;
  const sadism = slot.state.ABL[ABL_ID.施虐属性] ?? 0;

  const sources: Record<number, number> = {};
  let kanyaku = 800; // SOURCE:歓楽 base
  let jouai = 300; // SOURCE:情愛 base

  // ABL:欲望 ladder (歓楽)
  if (yokubo <= 1) kanyaku += yokubo * 60;
  else if (yokubo <= 3) kanyaku += 300 + yokubo * 60;
  else if (yokubo <= 5) kanyaku += 600 + yokubo * 60;
  else if (yokubo <= 8) kanyaku += 900 + yokubo * 75;
  else if (yokubo <= 11) kanyaku += 1500 + yokubo * 75;
  else kanyaku += 2500 + yokubo * 30;

  // ABL:奉仕精神 ladder (情愛)
  if (houshi <= 1) jouai += houshi * 30;
  else if (houshi <= 3) jouai += 200 + houshi * 30;
  else if (houshi <= 5) jouai += 500 + houshi * 30;
  else if (houshi <= 8) jouai += 700 + houshi * 45;
  else if (houshi <= 11) jouai += 1200 + houshi * 45;
  else jouai += 1800 + houshi * 20;

  // 好感度 ladder (歓楽)
  if (favor <= 500) kanyaku += favor;
  else if (favor <= 5000) kanyaku += 750 + Math.trunc((favor - 500) / 3);
  else kanyaku += 2000 + Math.trunc((favor - 5000) / 4);

  if (kanyaku < 0) kanyaku = 0;

  sources[SOURCE_ID.歓楽] = kanyaku;
  sources[SOURCE_ID.情愛] = jouai;
  sources[SOURCE_ID.受動] = 200 + 100 * juujun;
  sources[SOURCE_ID.征服] = 200 + 100 * sadism;
  return sources;
}

/** Apply the tier `TIMES` multipliers (+ 大胃王) to 610's sources. Mutates. */
function apply610Tier(sources: Record<number, number>, tier: number): void {
  const k = (id: number, f: number) => {
    sources[id] = times(sources[id] ?? 0, f);
  };
  if (tier === -1) {
    k(SOURCE_ID.歓楽, 0.1);
    k(SOURCE_ID.情愛, 0.1);
    k(SOURCE_ID.征服, 0.5);
    k(SOURCE_ID.受動, 0.5);
  } else if (tier === 0) {
    k(SOURCE_ID.歓楽, 1.0);
    k(SOURCE_ID.情愛, 1.0);
    k(SOURCE_ID.征服, 1.0);
    k(SOURCE_ID.受動, 1.0);
  } else {
    k(SOURCE_ID.歓楽, 2.0);
    k(SOURCE_ID.情愛, 1.5);
    k(SOURCE_ID.征服, 2.0);
    k(SOURCE_ID.受動, 2.0);
  }
  // SIF TALENT:大胃王 → 歓楽 ×1.5 (TALENT not imported → no-op for clean chara).
  // (When wired: if (talent(slot, 大胃王)) k(SOURCE_ID.歓楽, 1.5);)
}

function check610Eligible(
  state: GameState,
  target: number,
): { ok: true } | { ok: false; reason: { kind: "precondition"; message: string } } {
  if ((state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "时间停止中不能吃饭。" } };
  }
  if (target < 1) {
    return { ok: false, reason: { kind: "precondition", message: "没有一起吃饭的对象。" } };
  }
  const tSlot = state.charas[target];
  if (!tSlot) {
    return { ok: false, reason: { kind: "precondition", message: "没有一起吃饭的对象。" } };
  }
  if (!isOnDate(state, target)) {
    return { ok: false, reason: { kind: "precondition", message: "不在约会中。" } };
  }
  if (!datePartyAt(state.master.location)) {
    return { ok: false, reason: { kind: "precondition", message: "这里没有适合约会用餐的店。" } };
  }
  if ((tSlot.state.CFLAG[CFLAG_ID.行动] ?? 0) === 5) {
    return { ok: false, reason: { kind: "precondition", message: "对方正在工作。" } };
  }
  if (!isHungry(state, target)) {
    return { ok: false, reason: { kind: "precondition", message: "对方刚吃过，还不饿。" } };
  }
  if (!canAfford(state, 3000)) {
    return { ok: false, reason: { kind: "precondition", message: "钱不够。" } };
  }
  if ((tSlot.state.CFLAG[CFLAG_ID.睡眠] ?? 0) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "对方睡着了。" } };
  }
  return { ok: true };
}

export const dateMeal610HandlerEntry: HandlerEntry = {
  commandNo: 610,
  execCheck: (ctx) => {
    const r = check610Eligible(ctx.state, ctx.target);
    return r.ok ? { ok: true } : { ok: false, reason: r.reason };
  },
  handler: (ctx) => {
    const next: GameState = cloneGameState(ctx.state);
    const target = ctx.target;
    const tSlot = next.charas[target];
    if (!tSlot) {
      return {
        state: next,
        events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text: "没有一起吃饭的对象。" }],
        outcome: "noop" as const,
      };
    }

    const sr = getSuccessRate(tSlot);
    const tier = compute610Tier(ctx.rng, sr);

    // 大成功 EXP (ERB 29-31): master 会話+1, master 約會+1, target 約會+1.
    if (tier === 1) {
      next.master.state.EXP[EXP_ID.会話経験] = (next.master.state.EXP[EXP_ID.会話経験] ?? 0) + 1;
      bumpDateExp(next.master);
      bumpDateExp(tSlot);
    }

    // DOWNBASE:気力 += 10 (ERB 46) — bare = TARGET (char-completion ON).
    tSlot.state.BASE[BASE_ID.気力] = (tSlot.state.BASE[BASE_ID.気力] ?? 0) - 10;

    // SOURCE + tier TIMES + 大胃王 (ERB 48-114).
    const sources = compute610Sources(tSlot);
    apply610Tier(sources, tier);

    // RECOVER_PERMIL_BOTH (ERB 117-119).
    recoverPermilBoth(next, target, BASE_ID.体力, 150);
    recoverPermilBoth(next, target, BASE_ID.気力, 300);
    recoverPermilBoth(next, target, BASE_ID.精力, 100);

    // TIME += 60 (ERB 121).
    advanceTimeTicks(next, 60);

    // EXP:MASTER/TARGET:約會経験++ (ERB 122-123) + 満腹度上昇 (ERB 124-125).
    bumpDateExp(next.master);
    bumpDateExp(tSlot);
    riseMainMeal(next, target);
    riseMainMeal(next, 0);

    // MONEY -= 3000 (ERB 126).
    pay(next, 3000);

    // TFLAG:授乳コマンド = 1 (ERB 136).
    setTflag(next, TFLAG_ID.授乳コマンド, 1);

    // Settle SOURCE → PALAM → 好感度 (no favorBias — 610 has no TFLAG:97).
    const settled = applySourceCheck(next, target, sources, 0);

    const tierWord = tier === 1 ? "非常满足的一餐。" : tier === -1 ? "不太成功的一餐。" : "";
    const text = `和对方一起吃了饭。${tierWord}好感度 ${settled.favorDelta >= 0 ? "+" : ""}${settled.favorDelta}。`;
    return {
      state: next,
      events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text }, ...settled.events],
      outcome: "ok" as const,
    };
  },
};

// ---------------------------------------------------------------------------
// COMF615 — お弁当を食べる
// ---------------------------------------------------------------------------

/** 615's success tier (-1 失敗 / 0 成功 / 1 大成功). Pure; RNG via `rng`. */
export function compute615Tier(
  rng: { int(max: number): number },
  cookingSkill: number,
): number {
  const local = rng.int(3); // LOCAL = RAND:3
  const local1 = rng.int(10); // LOCAL:1 = RAND:10
  if (local > cookingSkill) return -1; // 料理下手 → 失敗
  if (local1 <= cookingSkill - 2) return 1; // 料理上手 → 大成功
  return 0; // 成功
}

/** 615 (親密+奉仕精神) ladder → LOCAL:2 (1/2/3/5). Pure. */
export function compute615Ladder(shinmitsu: number, houshi: number): number {
  const sum = shinmitsu + houshi;
  if (sum < 10) return 1;
  if (sum < 15) return 2;
  if (sum < 25) return 3;
  return 5;
}

/** 615 SOURCE assembly (歓楽/達成/情愛 + base 露出/反感) pre-tier-TIMES. Pure. */
export function compute615Sources(
  slot: CharaSlot,
  ladder: number,
): Record<number, number> {
  const shinmitsu = slot.state.ABL[ABL_ID.親密] ?? 0;
  const sources: Record<number, number> = {};
  let kanyaku = 300; // 歓楽 base
  let tassei = 0; // 達成
  let jouai = 300; // 情愛 base

  if (ladder === 1) {
    kanyaku += 1000 + shinmitsu * 100;
    tassei += 500 + shinmitsu * 50;
    jouai += shinmitsu * 30;
  } else if (ladder === 2) {
    kanyaku += 2000 + shinmitsu * 150;
    tassei += 1500 + shinmitsu * 80;
    jouai += 400 + shinmitsu * 30;
  } else if (ladder === 3) {
    kanyaku += 3000 + shinmitsu * 200;
    tassei += 2000 + shinmitsu * 100;
    jouai += 600 + shinmitsu * 40;
  } else {
    kanyaku += 5000 + shinmitsu * 250;
    tassei += 3000 + shinmitsu * 150;
    jouai += 1800 + shinmitsu * 30;
  }

  sources[SOURCE_ID.歓楽] = kanyaku;
  sources[SOURCE_ID.達成] = tassei;
  sources[SOURCE_ID.情愛] = jouai;
  sources[SOURCE_ID.露出] = 100;
  sources[SOURCE_ID.反感] = 50;
  return sources;
}

/** Apply the tier `TIMES` to 615's 歓楽/達成/情愛 (露出/反感 untouched). */
function apply615Tier(sources: Record<number, number>, tier: number): void {
  const f = tier === -1 ? 0.5 : tier === 0 ? 1.0 : 2.0;
  for (const id of [SOURCE_ID.歓楽, SOURCE_ID.達成, SOURCE_ID.情愛]) {
    sources[id] = times(sources[id] ?? 0, f);
  }
}

function check615Eligible(
  state: GameState,
  target: number,
): { ok: true } | { ok: false; reason: { kind: "precondition"; message: string } } {
  if ((state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "时间停止中不能吃饭。" } };
  }
  if (target < 1) {
    return { ok: false, reason: { kind: "precondition", message: "没有一起吃饭的对象。" } };
  }
  const tSlot = state.charas[target];
  if (!tSlot) {
    return { ok: false, reason: { kind: "precondition", message: "没有一起吃饭的对象。" } };
  }
  if (!isOnDate(state, target)) {
    return { ok: false, reason: { kind: "precondition", message: "不在约会中。" } };
  }
  if (getTflag(state, TFLAG_ID.约会道中) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "约会赶路途中不能吃便当。" } };
  }
  if (!bentoAt(state.master.location)) {
    return { ok: false, reason: { kind: "precondition", message: "这里不适合吃便当。" } };
  }
  if (!isHungry(state, target)) {
    return { ok: false, reason: { kind: "precondition", message: "对方刚吃过，还不饿。" } };
  }
  if ((getTflag(state, TFLAG_ID.一日一回) >> 1) & 1) {
    return { ok: false, reason: { kind: "precondition", message: "今天已经吃过便当了。" } };
  }
  if ((tSlot.state.CFLAG[CFLAG_ID.睡眠] ?? 0) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "对方睡着了。" } };
  }
  return { ok: true };
}

export const bento615HandlerEntry: HandlerEntry = {
  commandNo: 615,
  execCheck: (ctx) => {
    const r = check615Eligible(ctx.state, ctx.target);
    return r.ok ? { ok: true } : { ok: false, reason: r.reason };
  },
  handler: (ctx) => {
    const next: GameState = cloneGameState(ctx.state);
    const target = ctx.target;
    const tSlot = next.charas[target];
    if (!tSlot) {
      return {
        state: next,
        events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text: "没有一起吃饭的对象。" }],
        outcome: "noop" as const,
      };
    }

    const cookingSkill = tSlot.state.ABL[ABL_ID.料理技能] ?? 0;
    const tier = compute615Tier(ctx.rng, cookingSkill);
    const ladder = compute615Ladder(
      tSlot.state.ABL[ABL_ID.親密] ?? 0,
      tSlot.state.ABL[ABL_ID.奉仕精神] ?? 0,
    );

    // 大成功 EXP (ERB 27-29): master 会話+1, master 約會+1, target 約會+1.
    if (tier === 1) {
      next.master.state.EXP[EXP_ID.会話経験] = (next.master.state.EXP[EXP_ID.会話経験] ?? 0) + 1;
      bumpDateExp(next.master);
      bumpDateExp(tSlot);
    }

    // DOWNBASE:気力 += 50 (ERB 38) — bare = TARGET (char-completion ON).
    tSlot.state.BASE[BASE_ID.気力] = (tSlot.state.BASE[BASE_ID.気力] ?? 0) - 50;

    // SOURCE (ERB 40-67) + tier TIMES (ERB 86-98).
    const sources = compute615Sources(tSlot, ladder);
    apply615Tier(sources, tier);

    // EXP:料理経験 += LOCAL:2 (ERB 69); 恋慕 → 愛情経験 += LOCAL:2 (ERB 70-71).
    tSlot.state.EXP[EXP_ID.料理経験] = (tSlot.state.EXP[EXP_ID.料理経験] ?? 0) + ladder;
    if ((tSlot.state.TALENT[TALENT_ID.恋慕] ?? 0) !== 0) {
      tSlot.state.EXP[EXP_ID.愛情経験] = (tSlot.state.EXP[EXP_ID.愛情経験] ?? 0) + ladder;
    }

    // RECOVER_PERMIL_BOTH by 料理技能 tier (ERB 73-85).
    let stamina: number, will: number, energy: number;
    if (cookingSkill < 2) {
      stamina = 200; will = 300; energy = 100;
    } else if (cookingSkill < 4) {
      stamina = 250; will = 350; energy = 150;
    } else {
      stamina = 300; will = 400; energy = 200;
    }
    recoverPermilBoth(next, target, BASE_ID.体力, stamina);
    recoverPermilBoth(next, target, BASE_ID.気力, will);
    recoverPermilBoth(next, target, BASE_ID.精力, energy);

    // TIME += 60 (ERB 99).
    advanceTimeTicks(next, 60);

    // EXP:MASTER/TARGET:約會経験++ (ERB 100-101) + 満腹度上昇 (ERB 102-103).
    bumpDateExp(next.master);
    bumpDateExp(tSlot);
    riseMainMeal(next, target);
    riseMainMeal(next, 0);

    // SETBIT TFLAG:一日一回,1 (ERB 105).
    setTflagBit(next, TFLAG_ID.一日一回, 1);
    // TFLAG:授乳コマンド = 1 (ERB 115).
    setTflag(next, TFLAG_ID.授乳コマンド, 1);

    // Settle SOURCE → PALAM → 好感度 (no favorBias).
    const settled = applySourceCheck(next, target, sources, 0);

    const tierWord = tier === 1 ? "手艺大受好评！" : tier === -1 ? "手艺失败了……" : "";
    const text = `和对方一起吃了便当。${tierWord}好感度 ${settled.favorDelta >= 0 ? "+" : ""}${settled.favorDelta}。`;
    return {
      state: next,
      events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text }, ...settled.events],
      outcome: "ok" as const,
    };
  },
};

// ===========================================================================
// COMF603 — 手を繋ぐ (hold hands) — Wave 3
// ===========================================================================
//
// Deterministic date-stroll command (no B9). Faithful to
// `COMF603 手を繋ぐ.ERB`. Gated on `TFLAG:约会道中` (mid-date stroll). Unlike
// 605/610, 603 rolls `RAND:110` (fail threshold +20 headroom) and assembles
// 歓楽/情愛/恭順/反感/受動/欲情/屈従 with a 親密/従順/好感 ladder + a
// `TFLAG:97` (favorBias) penalty for low 親密/従順/好感. 情緒BONUS set but
// unconsumed (情緒 BASE block deferred). bare DOWNBASE 気力 = TARGET.

/** 603 success tier (-1/0/1). RAND:110, fail @ min(90+SR/5,109), great @9. */
export function compute603Tier(rng: { int(max: number): number }, sr: number): number {
  const roll = rng.int(110); // LOCAL = RAND:110
  const failThreshold = Math.min(90 + Math.trunc(sr / 5), 109);
  if (roll <= 9) return 1;
  if (roll >= failThreshold) return -1;
  return 0;
}

/** 603 favorBias (`TFLAG:97 += LOCAL`) — low 親密/従順/好感 penalty. Pure. */
export function compute603FavorBias(slot: CharaSlot): number {
  const shinmitsu = slot.state.ABL[ABL_ID.親密] ?? 0;
  const juujun = slot.state.ABL[ABL_ID.従順] ?? 0;
  const favor = slot.state.CFLAG[CFLAG_ID.好感度] ?? 0;
  let bias = 0;
  if (shinmitsu === 0) bias -= 3;
  else if (shinmitsu === 1) bias -= 2;
  else if (shinmitsu === 2) bias -= 1;
  if (juujun === 0) bias -= 5;
  else if (juujun === 1) bias -= 3;
  else if (juujun === 2) bias -= 1;
  if (favor <= 50) bias -= 3;
  else if (favor <= 100) bias -= 2;
  else if (favor <= 250) bias -= 1;
  return bias;
}

/** 603 SOURCE assembly (pre-tier-TIMES). Pure. */
export function compute603Sources(slot: CharaSlot): Record<number, number> {
  const shinmitsu = slot.state.ABL[ABL_ID.親密] ?? 0;
  const juujun = slot.state.ABL[ABL_ID.従順] ?? 0;
  const yokubo = slot.state.ABL[ABL_ID.欲望] ?? 0;
  const maso = slot.state.ABL[ABL_ID.受虐属性] ?? 0;
  const favor = slot.state.CFLAG[CFLAG_ID.好感度] ?? 0;

  let kanyaku = 150; // 歓楽
  let jouai = 150; // 情愛
  let kyoujun = 100; // 恭順
  const hankan = 100; // 反感 (fixed base)
  let judou = 100; // 受動

  // ABL:親密 ladder (歓楽/情愛)
  if (shinmitsu <= 3) {
    kanyaku += 150 + shinmitsu * 50;
    jouai += 180 + shinmitsu * 40;
  } else if (shinmitsu <= 5) {
    kanyaku += 500 + shinmitsu * 50;
    jouai += 450 + shinmitsu * 30;
  } else if (shinmitsu <= 8) {
    kanyaku += 800 + shinmitsu * 50;
    jouai += 700 + shinmitsu * 50;
  } else if (shinmitsu <= 11) {
    kanyaku += 1000 + shinmitsu * 90;
    jouai += 900 + shinmitsu * 50;
  } else {
    kanyaku += 1800 + shinmitsu * 40;
    jouai += 2000 + shinmitsu * 20;
  }

  // ABL:従順 ladder (恭順/受動)
  if (juujun <= 3) {
    kyoujun += 100 + juujun * 50;
    judou += 170 + juujun * 40;
  } else if (juujun <= 5) {
    kyoujun += 300 + juujun * 50;
    judou += 350 + juujun * 30;
  } else if (juujun <= 8) {
    kyoujun += 500 + juujun * 50;
    judou += 600 + juujun * 50;
  } else if (juujun <= 11) {
    kyoujun += 800 + juujun * 90;
    judou += 700 + juujun * 50;
  } else {
    kyoujun += 1500 + juujun * 40;
    judou += 1000 + juujun * 20;
  }

  // 好感度 ladder (情愛)
  if (favor <= 500) jouai += favor;
  else if (favor <= 5000) jouai += 200 + Math.trunc((favor - 500) / 3);
  else jouai += 1000 + Math.trunc((favor - 5000) / 5);

  if (kanyaku < 0) kanyaku = 0;

  const sources: Record<number, number> = {};
  sources[SOURCE_ID.歓楽] = kanyaku;
  sources[SOURCE_ID.情愛] = jouai;
  sources[SOURCE_ID.恭順] = kyoujun;
  sources[SOURCE_ID.反感] = hankan;
  sources[SOURCE_ID.受動] = judou;
  sources[SOURCE_ID.欲情] = 50 + 150 * yokubo;
  sources[SOURCE_ID.屈従] = 100 + 200 * maso;
  return sources;
}

/** Apply 603's tier TIMES (歓楽/情愛/恭順/受動/欲情/反感). Mutates. */
function apply603Tier(sources: Record<number, number>, tier: number): void {
  const k = (id: number, f: number) => {
    sources[id] = times(sources[id] ?? 0, f);
  };
  if (tier === -1) {
    k(SOURCE_ID.歓楽, 0.1);
    k(SOURCE_ID.情愛, 0.5);
    k(SOURCE_ID.恭順, 0.5);
    k(SOURCE_ID.受動, 1.5);
    k(SOURCE_ID.欲情, 0.5);
    k(SOURCE_ID.反感, 1.5);
  } else if (tier === 0) {
    // ×1.00 across — no-op (情緒BONUS = 50 handled by caller).
  } else {
    k(SOURCE_ID.歓楽, 2.0);
    k(SOURCE_ID.情愛, 2.0);
    k(SOURCE_ID.恭順, 1.5);
    k(SOURCE_ID.受動, 2.0);
    k(SOURCE_ID.欲情, 2.0);
    k(SOURCE_ID.反感, 0.75);
  }
}

function check603Eligible(
  state: GameState,
  target: number,
): { ok: true } | { ok: false; reason: { kind: "precondition"; message: string } } {
  if ((state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "时间停止中。" } };
  }
  if (target < 1 || !state.charas[target]) {
    return { ok: false, reason: { kind: "precondition", message: "没有牵手的对象。" } };
  }
  // ERB: 约会道中以外 → block (mid-date stroll only).
  if (state.dateSession
    ? state.dateSession.partner !== target || (state.dateSession.phase !== "traveling" && state.dateSession.phase !== "returning")
    : getTflag(state, TFLAG_ID.约会道中) === 0) {
    return { ok: false, reason: { kind: "precondition", message: "不在约会途中。" } };
  }
  const tSlot = state.charas[target]!;
  if ((tSlot.state.CFLAG[CFLAG_ID.睡眠] ?? 0) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "对方睡着了。" } };
  }
  return { ok: true };
}

export const holdHands603HandlerEntry: HandlerEntry = {
  commandNo: 603,
  execCheck: (ctx) => {
    const r = check603Eligible(ctx.state, ctx.target);
    return r.ok ? { ok: true } : { ok: false, reason: r.reason };
  },
  handler: (ctx) => {
    const next: GameState = cloneGameState(ctx.state);
    const target = ctx.target;
    const tSlot = next.charas[target];
    if (!tSlot) {
      return {
        state: next,
        events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text: "没有牵手的对象。" }],
        outcome: "noop" as const,
      };
    }

    const sr = getSuccessRate(tSlot);
    const tier = compute603Tier(ctx.rng, sr);

    // 大成功 → master/target 約會経験++ (ERB 18-20).
    if (tier === 1) {
      bumpDateExp(next.master);
      bumpDateExp(tSlot);
    }

    // DOWNBASE:気力 += 50 (TARGET, bare) + DOWNBASE:MASTER:気力 += 50 (ERB 32-33).
    tSlot.state.BASE[BASE_ID.気力] = (tSlot.state.BASE[BASE_ID.気力] ?? 0) - 50;
    next.master.state.BASE[BASE_ID.気力] = (next.master.state.BASE[BASE_ID.気力] ?? 0) - 50;

    // SOURCE + tier TIMES (ERB 35-152).
    const sources = compute603Sources(tSlot);
    apply603Tier(sources, tier);
    const favorBias = compute603FavorBias(tSlot);

    // 情緒BONUS (ERB tier arms; write-only, consumer deferred).
    setTflag(next, TFLAG_ID.情緒BONUS, tier === 1 ? 100 : tier === 0 ? 50 : 0);

    // TIME += 10 + 約會経験++ (ERB 154-156).
    advanceTimeTicks(next, 10);
    // Besides the ten minutes that pass naturally, successful hand-holding
    // makes the route feel shorter by another ten minutes.
    advanceDateTravel(next, 10);
    bumpDateExp(next.master);
    bumpDateExp(tSlot);

    const settled = applySourceCheck(next, target, sources, favorBias);
    const tierWord = tier === 1 ? "十指相扣，很幸福。" : tier === -1 ? "被甩开了手。" : "";
    const text = `牵起了对方的手。${tierWord}好感度 ${settled.favorDelta >= 0 ? "+" : ""}${settled.favorDelta}。`;
    return {
      state: next,
      events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text }, ...settled.events],
      outcome: "ok" as const,
    };
  },
};

// ===========================================================================
// COMF605 — 寄り道する (detour) — Wave 3
// ===========================================================================
//
// Deterministic date detour (no B9). Faithful to `COMF605 寄り道する.ERB`.
// Gated on `CHK_DATENOW` + `TFLAG:约会道中` + a 30-min cooldown
// (`TIME_PROGRESS(TCVAR:309) < 30`). Same RAND:100 success-tier shape as 610.
// bare DOWNBASE 気力/体力 = TARGET; explicit MASTER drains the master.

/** 605 success tier (-1/0/1). Same as 610 (RAND:100, fail @min(90+SR/5,99)). */
export function compute605Tier(rng: { int(max: number): number }, sr: number): number {
  return compute610Tier(rng, sr); // identical formula
}

/** 605 SOURCE assembly (歓楽/情愛/受動/征服) pre-tier-TIMES. Pure. */
export function compute605Sources(slot: CharaSlot): Record<number, number> {
  const juujun = slot.state.ABL[ABL_ID.従順] ?? 0;
  const shinmitsu = slot.state.ABL[ABL_ID.親密] ?? 0;
  const sadism = slot.state.ABL[ABL_ID.施虐属性] ?? 0;
  const favor = slot.state.CFLAG[CFLAG_ID.好感度] ?? 0;

  let kanyaku = 500; // 歓楽
  let jouai = 300; // 情愛

  // ABL:従順 ladder (歓楽 by 従順, 情愛 by 親密)
  if (juujun <= 1) {
    kanyaku += juujun * 60;
    jouai += shinmitsu * 30;
  } else if (juujun <= 3) {
    kanyaku += 200 + juujun * 60;
    jouai += 200 + shinmitsu * 30;
  } else if (juujun <= 5) {
    kanyaku += 500 + juujun * 60;
    jouai += 500 + shinmitsu * 30;
  } else if (juujun <= 8) {
    kanyaku += 750 + juujun * 75;
    jouai += 750 + shinmitsu * 45;
  } else if (juujun <= 11) {
    kanyaku += 1000 + juujun * 75;
    jouai += 1000 + shinmitsu * 50;
  } else {
    kanyaku += 2000 + juujun * 30;
    jouai += 2000 + shinmitsu * 20;
  }

  // 好感度 ladder (歓楽/情愛)
  if (favor <= 500) {
    kanyaku += favor;
    jouai += favor;
  } else if (favor <= 5000) {
    kanyaku += 500 + Math.trunc((favor - 500) / 3);
    jouai += 300 + Math.trunc((favor - 300) / 3);
  } else {
    kanyaku += 2000 + Math.trunc((favor - 5000) / 5);
    jouai += 1000 + Math.trunc((favor - 1000) / 5);
  }

  if (kanyaku < 0) kanyaku = 0;
  if (jouai < 0) jouai = 0;

  const sources: Record<number, number> = {};
  sources[SOURCE_ID.歓楽] = kanyaku;
  sources[SOURCE_ID.情愛] = jouai;
  sources[SOURCE_ID.受動] = 200 + 100 * juujun;
  sources[SOURCE_ID.征服] = 200 + 100 * sadism;
  return sources;
}

/** Apply 605's tier TIMES (歓楽/征服/受動 — same as 610). Mutates. */
function apply605Tier(sources: Record<number, number>, tier: number): void {
  const k = (id: number, f: number) => {
    sources[id] = times(sources[id] ?? 0, f);
  };
  if (tier === -1) {
    k(SOURCE_ID.歓楽, 0.1);
    k(SOURCE_ID.征服, 0.5);
    k(SOURCE_ID.受動, 0.5);
  } else if (tier === 0) {
    // ×1.00 — no-op.
  } else {
    k(SOURCE_ID.歓楽, 2.0);
    k(SOURCE_ID.征服, 2.0);
    k(SOURCE_ID.受動, 2.0);
  }
}

function check605Eligible(
  state: GameState,
  target: number,
): { ok: true } | { ok: false; reason: { kind: "precondition"; message: string } } {
  if ((state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "时间停止中。" } };
  }
  if (target < 1 || !state.charas[target]) {
    return { ok: false, reason: { kind: "precondition", message: "没有约会的对象。" } };
  }
  if (!isOnDate(state, target)) {
    return { ok: false, reason: { kind: "precondition", message: "不在约会中。" } };
  }
  if (state.dateSession
    ? state.dateSession.partner !== target || (state.dateSession.phase !== "traveling" && state.dateSession.phase !== "returning")
    : getTflag(state, TFLAG_ID.约会道中) === 0) {
    return { ok: false, reason: { kind: "precondition", message: "不在约会途中。" } };
  }
  // 30-min cooldown: TIME_PROGRESS(TCVAR:309) < 30 → block.
  const last = state.master.state.TCVAR[TCVAR_ID.寄り道日時] ?? 0;
  if (last > 0 && state.time.tickValue - last < 30) {
    return { ok: false, reason: { kind: "precondition", message: "刚绕过路，再等等。" } };
  }
  const tSlot = state.charas[target]!;
  if ((tSlot.state.CFLAG[CFLAG_ID.睡眠] ?? 0) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "对方睡着了。" } };
  }
  return { ok: true };
}

export const detour605HandlerEntry: HandlerEntry = {
  commandNo: 605,
  execCheck: (ctx) => {
    const r = check605Eligible(ctx.state, ctx.target);
    return r.ok ? { ok: true } : { ok: false, reason: r.reason };
  },
  handler: (ctx) => {
    const next: GameState = cloneGameState(ctx.state);
    const target = ctx.target;
    const tSlot = next.charas[target];
    if (!tSlot) {
      return {
        state: next,
        events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text: "没有约会的对象。" }],
        outcome: "noop" as const,
      };
    }

    const sr = getSuccessRate(tSlot);
    const tier = compute605Tier(ctx.rng, sr);

    // 大成功 → master 会話経験++ + master/target 約會経験++ (ERB 11-13).
    if (tier === 1) {
      next.master.state.EXP[EXP_ID.会話経験] = (next.master.state.EXP[EXP_ID.会話経験] ?? 0) + 1;
      bumpDateExp(next.master);
      bumpDateExp(tSlot);
    }

    // DOWNBASE: MASTER 気力 -50/体力 -30; TARGET (bare) 気力 -30/体力 -20.
    next.master.state.BASE[BASE_ID.気力] = (next.master.state.BASE[BASE_ID.気力] ?? 0) - 50;
    next.master.state.BASE[BASE_ID.体力] = (next.master.state.BASE[BASE_ID.体力] ?? 0) - 30;
    tSlot.state.BASE[BASE_ID.気力] = (tSlot.state.BASE[BASE_ID.気力] ?? 0) - 30;
    tSlot.state.BASE[BASE_ID.体力] = (tSlot.state.BASE[BASE_ID.体力] ?? 0) - 20;

    // SOURCE + tier TIMES (ERB 30-100).
    const sources = compute605Sources(tSlot);
    apply605Tier(sources, tier);

    // 寄り道日時 = now (ERB cooldown stamp) + TIME += 10 + 约会道中 += 10.
    next.master.state.TCVAR[TCVAR_ID.寄り道日時] = next.time.tickValue;
    advanceTimeTicks(next, 10);
    if (next.dateSession) {
      next.dateSession.travelRemainingMinutes = (next.dateSession.travelRemainingMinutes ?? 0) + 20;
      syncDateMirrors(next);
    } else {
      addTflag(next, TFLAG_ID.约会道中, 10);
    }
    bumpDateExp(next.master);
    bumpDateExp(tSlot);

    const settled = applySourceCheck(next, target, sources, 0);
    const tierWord = tier === 1 ? "绕了段开心的路。" : tier === -1 ? "绕路没什么意思。" : "";
    const text = `和对方绕了段路。${tierWord}好感度 ${settled.favorDelta >= 0 ? "+" : ""}${settled.favorDelta}。`;
    return {
      state: next,
      events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text }, ...settled.events],
      outcome: "ok" as const,
    };
  },
};
