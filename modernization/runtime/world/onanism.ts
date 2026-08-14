/**
 * `@ONANISM` — the nightly masturbation settlement (slice B of the night
 * flow). Faithful port of `イベント関連/AFTERTRA.ERB:853-1139` (called from
 * `@EVENTEND` line 538-539, gated only by the 魔改 `NO_ONANISM` switch,
 * default off).
 *
 * Per registered chara (skip 出禁):
 *   1. Trigger threshold `自慰発生閾値 = LIMIT(750 − 200·自慰しやすい −
 *      100·快感応答 − 100·自己愛 + 200·自制心, 500, 999) − 300·自慰狂`.
 *   2. オナバレ set → embarrassed no-op line (frustration still accrues,
 *      quartered by the trait chain).
 *   3. 积攒度 > threshold → one of 7 自慰タイプ branches (fantasy 7 /
 *      overheard 2 / 精液中毒 3 / 無知 ladder 4 / lover-longing 5 /
 *      toys 6 / basic 1), then the EVENT-22 kojo, 自慰経験 EXP, the
 *      `@JUEL_UP_SPECIAL` jewel grants, and `积攒度 /= 4`.
 *   4. All non-type-7 charas accrue nightly 欲求不満度 into 积攒度
 *      (base by 欲望 + 中毒 terms, trait chain, diminishing brackets).
 *
 * DEFERRED (honest, not faked): `PrintOnanismImage` (image layer),
 * 诱导逆推 (魔改 mod, switch default 0), the pattern-1 欲望 demand column.
 * The overheard branch's `CFLAG:MASTER:現在位置 == CFLAG:LOCAL:初期位置`
 * check maps to `master.location === slot.homeLocation` (the modern
 * canonical form of 初期位置).
 */

import type { GameState, CharaSlot, CharaSlotState } from "../state/game-state.js";
import type { ObservationEvent } from "../../schemas/types.js";
import type { DialogueRouter } from "../kojo/types.js";
import { resolveEventKojoAndApply } from "../kojo/effects.js";
import type { Rng } from "../command/rng.js";
import {
  ABL_ID,
  CFLAG_ID,
  EX_ID,
  EXP_ID,
  FLAG_ID,
  PALAM_ID,
  TALENT_ID,
  TCVAR_ID,
} from "../state/settlement.js";
import { TFLAG_ID, setTflagBit } from "../state/tflag.js";
import { juelUpSpecial, JUEL_DISPLAY_NAME } from "../state/juel.js";
import { frustrationTraitAdjust } from "../command/source-check.js";

const trunc = Math.trunc;

/** `MAX_积攒度` (`魔改内容/MODDING_VALUE.ERH:43`), non-DLC path. */
const MAX_积攒度 = 1000;
/** `合意_诶嘿嘿 = 1p1` (`DIM.ERH:312`) — bit 1 of CFLAG:既成事實. */
const 合意_诶嘿嘿 = 1 << 1;

export interface OnanismDeps {
  now: () => number;
  rng: Rng;
  router?: DialogueRouter;
}

function talent(st: CharaSlotState, id: number): number {
  return st.TALENT[id] ?? 0;
}
function ablOf(st: CharaSlotState, id: number): number {
  return st.ABL[id] ?? 0;
}
function cflagOf(st: CharaSlotState, id: number): number {
  return st.CFLAG[id] ?? 0;
}

/**
 * `自慰発生閾値` (AFTERTRA.ERB:878-879). The LIMIT(500..999) applies to the
 * four-trait term; the 自慰狂 −300 lands after the clamp.
 */
export function onanismThreshold(st: CharaSlotState): number {
  const base =
    750 -
    200 * talent(st, TALENT_ID.自慰しやすい) -
    100 * talent(st, TALENT_ID.快感応答) -
    100 * talent(st, TALENT_ID.自己愛) +
    200 * talent(st, TALENT_ID.自制心);
  const clamped = Math.max(500, Math.min(base, 999));
  return clamped - 300 * talent(st, TALENT_ID.自慰狂);
}

/** `IS_LOVER(ARG)` (COMMON.ERB:3495) — 恋慕 or 愛欲. */
function isLover(st: CharaSlotState): boolean {
  return talent(st, TALENT_ID.恋慕) !== 0 || talent(st, TALENT_ID.愛欲) !== 0;
}

interface BranchResult {
  type: number;
  part: number;
  addV: boolean;
  addA: boolean;
  addB: boolean;
  lines: string[];
}

/** The 恋慕-tier used by the type-7 fantasy roll (AFTERTRA.ERB:889-902). */
function fantasyTier(st: CharaSlotState): number {
  let tier = 0;
  if (talent(st, TALENT_ID.愛欲) !== 0) tier = 4;
  else if (talent(st, TALENT_ID.恋慕) !== 0) tier = 3;
  else if (talent(st, TALENT_ID.炮友) !== 0) tier = 2; // 愛人もここ
  else if (talent(st, TALENT_ID.思慕) !== 0) tier = 1;
  if (talent(st, TALENT_ID.自制心) !== 0 && tier < 5) tier += 1;
  return tier;
}

/** 無知 ladder (AFTERTRA.ERB:932-956). Returns lines + part; may clear 無知. */
function mujiBranch(
  st: CharaSlotState,
  name: string,
  flags: Record<number, number>,
): { lines: string[]; part: number } {
  const progress = (st.EXP[EXP_ID.自慰経験] ?? 0) - (st.EXP[EXP_ID.調教自慰経験] ?? 0);
  const intimacy = ablOf(st, ABL_ID.親密);
  const rung = (need: number, cap: number): number => need - Math.min(intimacy, cap) * 10;
  if (progress >= rung(120, 6) && (flags[FLAG_ID.無知自動喪失禁止] ?? 0) === 0) {
    st.TALENT[TALENT_ID.無知] = 0;
    return {
      lines: [
        `${name}的自慰行为被监护人发现了……`,
        `监护人认真和${name}交流了……`,
        `${name}失去了无知……`,
      ],
      part: 1,
    };
  }
  if (progress >= rung(80, 4)) {
    return { lines: [`尚不明白自慰是什么的${name}埋头自慰中♡……`], part: 2 };
  }
  if (progress >= rung(50, 3)) {
    return { lines: [`${name}在桌子角扭动腰肢、一边用手刺激秘所♡……`], part: 3 };
  }
  if (progress >= rung(30, 2)) {
    return { lines: [`${name}把书夹在胯间刺激着幼小的秘裂♡……`], part: 4 };
  }
  if (progress >= rung(15, 1)) {
    return { lines: [`${name}在学习的时候把笔贴在了胯下、就这样摩擦起秘缝♡……`], part: 5 };
  }
  return { lines: [`${name}躺在被窝里一边侧躺使大腿互相摩擦一边闷闷♡……`], part: 6 };
}

/** Lover-longing branch (type 5, AFTERTRA.ERB:958-1021). */
function longingBranch(
  st: CharaSlotState,
  name: string,
  masterName: string,
  rng: Rng,
): BranchResult {
  const lines: string[] = [
    `怎么也忍耐不住了的${name}、一边嗅着沾在衣服上的${masterName}的气味一边激烈的自慰着……♡`,
  ];
  let part = 0;
  let addA = false;
  let addB = false;
  const roll = rng.int(5);
  let fragment = "";
  if (roll === 4) {
    fragment =
      talent(st, TALENT_ID.Ｃ感度) === 1 || ablOf(st, ABL_ID.Ｃ感覚) >= 10
        ? "用力揉搓着阴核、潮吹把爱液喷的到处都是"
        : "玩弄着阴核、即使潮吹了还一味地持续着动作";
    part = 1;
  } else if (roll === 3) {
    fragment =
      talent(st, TALENT_ID.Ｖ感度) === 1 || ablOf(st, ABL_ID.Ｖ感覚) >= 10
        ? "用手指高速的在蜜壶之中搅动、潮吹把爱液喷的到处都是"
        : "把手指深深地插入到蜜壶之中持续扣弄着爱液";
    part = 2;
  } else if (roll === 2) {
    fragment =
      talent(st, TALENT_ID.Ａ感度) === 1 || ablOf(st, ABL_ID.Ａ感覚) >= 10
        ? "交替玩弄蜜穴和菊穴，隔着互相刺激另一边"
        : "持续玩弄着蜜穴和菊穴";
    part = 3;
    addA = true;
  } else if (roll === 1) {
    const bust = talent(st, TALENT_ID.胸围);
    const sensitive = talent(st, TALENT_ID.Ｂ感度) === 1 || ablOf(st, ABL_ID.Ｂ感覚) >= 10;
    if (sensitive) {
      fragment =
        bust >= 1
          ? "拉扯着自己那丰满的乳房、轻咬并吮吸着乳头"
          : bust <= -1
            ? "爱抚着贫瘠但敏感的胸部来回揉捏拉扯乳头"
            : "变换各种下流的手法玩弄着敏感的乳房、";
    } else {
      fragment =
        bust >= 1
          ? "吸吮着自己那丰满的乳房、"
          : bust <= -1
            ? "抚摸着贫瘠的胸部来回揉搓着乳头、"
            : "用下流的手法揉弄着柔软的乳房、";
    }
    fragment += "高潮了好几次♡";
    part = 4;
    addB = true;
  } else {
    fragment = `颤抖着身体对${masterName}的渴求丝毫没能减弱……${name}度过了苦闷的时光直到早上……`;
    part = 5;
  }
  const suffix =
    talent(st, TALENT_ID.思慕) !== 0 ||
    talent(st, TALENT_ID.恋慕) !== 0 ||
    talent(st, TALENT_ID.恋人) !== 0
      ? `、对${masterName}的思念平息了……`
      : "、燃烧了身体的热量还没有平息……";
  lines.push(fragment + suffix);
  // AFTERTRA.ERB:1020 — 追加Ｖ自慰 = 1 unconditionally after the roll.
  return { type: 5, part, addV: true, addA, addB, lines };
}

/** Toys branch (type 6, AFTERTRA.ERB:1022-1053). */
function toysBranch(st: CharaSlotState, name: string): BranchResult {
  const chastity = talent(st, TALENT_ID.貞操);
  const virgin = talent(st, TALENT_ID.処女);
  let fragment: string;
  let part: number;
  let addV = false;
  let addA = false;
  if (ablOf(st, ABL_ID.Ａ感覚) >= 5) {
    if (chastity === -1 && virgin === 0) {
      fragment = "尽可能深的插入阴道和肛门的深处";
      addV = true;
    } else if (chastity === -1 && virgin === 1) {
      fragment = "尽可能深的插入肛门的深处隔着刺激仍还保持着处子身的子宫";
      addV = true;
    } else if (chastity === 1) {
      fragment = "抵住私处和肛门";
    } else {
      fragment = "玩弄着私处和尻穴";
    }
    part = 1;
    addA = true;
  } else {
    if (chastity === -1 && virgin === 0) {
      fragment = "插入阴道的深处";
      addV = true;
    } else if (chastity === -1 && virgin === 1) {
      fragment = "丝毫不害怕被弄破的旋转着搅动处女膜";
      addV = true;
    } else if (chastity === 1) {
      fragment = "抵住私处";
    } else {
      fragment = "玩弄着私处";
    }
    part = 2;
  }
  return {
    type: 6,
    part,
    addV,
    addA,
    addB: false,
    lines: [`已经无法用手指满足的${name}、用从河童那买来的玩具${fragment}沉溺于自慰之中…♡`],
  };
}

/** Basic branch (type 1, AFTERTRA.ERB:1054-1068). */
function basicBranch(name: string, rng: Rng): BranchResult {
  const roll = rng.int(5);
  const line =
    roll === 4
      ? `冷静不下来的${name}用手指在私处揉、爱液把手指打湿了…♡`
      : roll === 3
        ? `躁动的${name}温柔的用手指爱抚着私处、爱液缓缓流出…♡`
        : roll === 2
          ? `欲火焚身的${name}自己用手指安慰起了自己。爱液流的哪里都是…♡`
          : roll === 1
            ? `躁动难忍的${name}、用舔湿的手指玩弄着蜜裂…♡`
            : `身体变的躁动难安的${name}、自己用手指玩弄起了私处…♡`;
  return { type: 1, part: 0, addV: false, addA: false, addB: false, lines: [line] };
}

/**
 * Nightly frustration accrual (AFTERTRA.ERB:1104-1138) for one chara.
 * `masturbated` = a nonzero 自慰タイプ this night zeroes the rise.
 */
export function accrueNightlyFrustration(slot: CharaSlot, masturbated: boolean): number {
  const st = slot.state;
  const desire = ablOf(st, ABL_ID.欲望);
  let rise = desire <= 2 ? 10 : desire <= 5 ? 20 : desire <= 10 ? 30 : desire <= 15 ? 50 : 80;
  rise +=
    ablOf(st, ABL_ID.自慰中毒) * 7 +
    (ablOf(st, ABL_ID.膣射中毒) + ablOf(st, ABL_ID.肛射中毒)) * 3;
  rise = frustrationTraitAdjust(slot, rise);
  if (rise > 400) rise = trunc((rise - 400) / 10) + 400;
  else if (rise > 200) rise = trunc((rise - 200) / 4) + 200;
  else if (rise > 100) rise = trunc((rise - 100) / 2) + 100;
  if (masturbated) rise = 0;
  if ((st.TCVAR[TCVAR_ID.今天有否见面] ?? 0) !== 0) rise = trunc(rise / 2);
  if (talent(st, TALENT_ID.妊娠) !== 0) rise = trunc(rise / 5);
  if (talent(st, TALENT_ID.育児中) !== 0) rise = trunc(rise / 2);
  const cur = cflagOf(st, CFLAG_ID.溜まってる度);
  const next = Math.max(0, Math.min(cur + rise, MAX_积攒度));
  st.CFLAG[CFLAG_ID.溜まってる度] = next;
  return rise;
}

/**
 * Run the whole `@ONANISM` pass over every registered chara. Mutates
 * `state` in place; returns the display stream (NARRATION + the EVENT-22
 * kojo DIALOGUE_LINEs).
 */
export function runOnanism(state: GameState, deps: OnanismDeps): ObservationEvent[] {
  const { now, rng, router } = deps;
  const events: ObservationEvent[] = [];
  const masterName = state.master.callName ?? "主人公";
  // `nar` stamps the chara currently being processed so the night screen can
  // group each 自慰 event into that character's settlement block. Updated at
  // the top of every per-chara iteration below.
  let currentChara = 0;
  const nar = (text: string): void => {
    events.push({ kind: "NARRATION", timestamp: now(), charaNum: currentChara, text });
  };

  const charaNums = Object.keys(state.charas)
    .map(Number)
    .sort((a, b) => a - b);
  for (const charaNum of charaNums) {
    currentChara = charaNum;
    const slot = state.charas[charaNum];
    if (!slot) continue;
    const st = slot.state;
    if (cflagOf(st, CFLAG_ID.出禁) !== 0) continue;
    const name = slot.callName ?? `角色${charaNum}`;
    const pentUp = cflagOf(st, CFLAG_ID.溜まってる度);

    let branch: BranchResult | null = null;
    if (cflagOf(st, CFLAG_ID.オナバレ) !== 0) {
      // Caught before — too embarrassed to do anything (AFTERTRA.ERB:880).
      nar(`${name}把脸埋在了枕头里面…`);
    } else if (pentUp > onanismThreshold(st)) {
      // 诱导逆推 (魔改 switch, default 0) + PrintOnanismImage — deferred.
      const tier = fantasyTier(st);
      if (
        (cflagOf(st, CFLAG_ID.既成事實) & 合意_诶嘿嘿) !== 0 &&
        rng.int(Math.max(1, 8 - tier)) === 0
      ) {
        // Type 7 — fantasize-and-sleep (no settlement, no accrual).
        nar(
          `${name}忍耐着身体的蠢动、幻想着明天和${masterName}一起做的场景、吮吸着手指睡着了……`,
        );
        st.CFLAG[CFLAG_ID.溜まってる度] = Math.max(0, Math.min(pentUp + 100, MAX_积攒度));
        if (cflagOf(st, CFLAG_ID.神社在住) === 0) st.CFLAG[CFLAG_ID.翌日来訪] = 1;
        if (router) {
          for (const line of resolveEventKojoAndApply(router, state, charaNum, 22, rng, [7, 0])) {
            events.push({
              kind: "DIALOGUE_LINE",
              timestamp: now(),
              charaNum,
              text: line.text,
              form: line.form,
            });
          }
        }
        continue;
      } else if (
        state.master.location !== "" &&
        slot.homeLocation !== undefined &&
        state.master.location === slot.homeLocation
      ) {
        // Type 2 — the master sleeps in this chara's room and overhears.
        nar(`夜里、${masterName}听到了一些动静而睁开了眼睛`);
        nar(`${masterName}♡……${masterName}♡……`);
        nar(`……${name}一边抓着${masterName}的手一边压抑着呻吟声沉溺于自慰之中……`);
        branch = { type: 2, part: 0, addV: false, addA: false, addB: false, lines: [] };
      } else if (
        ablOf(st, ABL_ID.精液中毒) > 0 &&
        (st.EX[EX_ID.膣内精液] ?? 0) > 0 &&
        rng.int(4) === 0
      ) {
        // Type 3 — semen-addiction masturbation with the residue.
        const level = ablOf(st, ABL_ID.精液中毒);
        if (level > 3) {
          nar("……");
          nar(`躁动难耐的${name}、将膣内残留的${masterName}的精液涂抹在手指上开始了自慰……`);
          nar("吸溜……♡……啵♡……");
        } else if (level > 1) {
          nar(`难忍的${name}、利用膣内残留的${masterName}精液、嗅着味道开始了自慰……`);
          nar("嗅嗅……♡");
        } else {
          nar(`无法忍耐的${name}、伴着膣内残留的${masterName}的精液开始了自慰……`);
        }
        branch = { type: 3, part: 0, addV: false, addA: false, addB: false, lines: [] };
      } else if (talent(st, TALENT_ID.無知) !== 0) {
        const r = mujiBranch(st, name, state.flagStore);
        for (const line of r.lines) nar(line);
        branch = { type: 4, part: r.part, addV: false, addA: false, addB: false, lines: [] };
      } else if (
        ablOf(st, ABL_ID.自慰中毒) >= 3 &&
        (talent(st, TALENT_ID.思慕) !== 0 ||
          isLover(st) ||
          talent(st, TALENT_ID.恋人) !== 0 ||
          talent(st, TALENT_ID.炮友) !== 0) &&
        rng.int(3) === 0
      ) {
        branch = longingBranch(st, name, masterName, rng);
        for (const line of branch.lines) nar(line);
      } else if (ablOf(st, ABL_ID.自慰中毒) >= 3 && rng.int(2) === 0) {
        branch = toysBranch(st, name);
        for (const line of branch.lines) nar(line);
      } else {
        branch = basicBranch(name, rng);
        for (const line of branch.lines) nar(line);
      }

      // 自慰口上 (EVENT 22, args = [自慰タイプ, 部位指定], AFTERTRA.ERB:1069).
      if (router && branch) {
        for (const line of resolveEventKojoAndApply(router, state, charaNum, 22, rng, [
          branch.type,
          branch.part,
        ])) {
          events.push({
            kind: "DIALOGUE_LINE",
            timestamp: now(),
            charaNum,
            text: line.text,
            form: line.form,
          });
        }
      }

      if (branch) {
        // EXP + jewel settlement (AFTERTRA.ERB:1072-1102).
        const addiction = ablOf(st, ABL_ID.自慰中毒);
        const expGain = addiction * 2 + 1;
        st.EXP[EXP_ID.自慰経験] = (st.EXP[EXP_ID.自慰経験] ?? 0) + expGain;
        nar(`自慰经验＋${expGain}（${name}）`);
        // 浓厚精液机制:自慰也消耗,记下「今日射精」(TFLAG:一日一回 bit 8)让
        // 夜间 AFTERTRA 禁欲结算清掉浓厚精液。
        setTflagBit(state, TFLAG_ID.一日一回, 8);
        const multiplier = addiction <= 2 ? 5 : addiction <= 5 ? 3 : 1;
        const grants: Array<[number, number, number]> = [
          [PALAM_ID.快Ｃ, ABL_ID.Ｃ感覚, multiplier],
        ];
        if (branch.addV) grants.push([PALAM_ID.快Ｖ, ABL_ID.Ｖ感覚, multiplier]);
        if (branch.addA) grants.push([PALAM_ID.快Ａ, ABL_ID.Ａ感覚, multiplier]);
        if (branch.addB) grants.push([PALAM_ID.快Ｂ, ABL_ID.Ｂ感覚, multiplier]);
        grants.push([PALAM_ID.恥情, ABL_ID.自慰中毒, multiplier * 2]);
        grants.push([PALAM_ID.欲情, ABL_ID.欲望, multiplier]);
        for (const [juelId, ablId, pct] of grants) {
          const { rise } = juelUpSpecial(st, false, juelId, ablId, pct, state.flagStore);
          nar(`${JUEL_DISPLAY_NAME[juelId] ?? `珠${juelId}`}之珠 ＋${rise}（${name}）`);
        }
        st.CFLAG[CFLAG_ID.溜まってる度] = trunc(cflagOf(st, CFLAG_ID.溜まってる度) / 4);
        if (cflagOf(st, CFLAG_ID.溜まってる度) >= 2000) {
          nar(`${name}的身体不断渴求受孕...`);
          st.CFLAG[CFLAG_ID.子宝補正] = cflagOf(st, CFLAG_ID.子宝補正) + 1;
        }
      }
    }

    accrueNightlyFrustration(slot, branch !== null && branch.type !== 0);
  }
  return events;
}
