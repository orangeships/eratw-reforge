/**
 * Phase 7 — `COMF10 乳首吸い` (Nipple Sucking) settlement, as a `ComfDef`.
 *
 * Ports `@COM10` (`ERB/コマンド関連/COMF/COMF10 乳首吸い.ERB`), the
 * normal-mode (ELSE) core.
 *
 * **H foreplay family (root 0-26) sibling.** Note: COMF10 is the
 * one-shot (non-toggle) nipple suck. COMF11 is the toggle/equip
 * variant — separate file.
 *
 * **Faithful normal-mode core (ERB 23-77, ELSE branch):**
 *   - DOWNBASE: target 体力 5 / 気力 50 (ERB 25-26)
 *   - SOURCE target: 快Ｂ 20, 情愛 30, 露出 20, 不潔 30, 反感 30
 *     (ERB 28-32)
 *   - ABL:PLAYER:舌*5 → +快Ｂ (ERB 34) and +情愛 (ERB 35)
 *   - ABL:親密 >= 10 → 情愛 += 親密*20 (ERB 37-38); reads TARGET's ABL
 *   - 舌使い (master) ×1.50 on 快Ｂ (ERB 41-42)
 *   - 猫舌 (master) ×0.75 on 快Ｂ + 嗜虐快楽経験 PLAYER++ (ERB 45-46, 74-76)
 *   - 鬱屈 +100 if 自己愛<0 || 抵抗 (ERB 51-52) — heavier than most
 *     foreplay commands
 *   - EXP 口淫経験 PLAYER++ (ERB 77)
 *
 * **DEFERRED (documented):**
 *   - Time-stop branch (ERB 19-22) — TSP drain + reduced sources.
 *   - STAIN (B⇔口) swap (ERB 58-59) — STAIN subsystem deferred.
 *   - TCVAR:116 / TCVAR:PLAYER:108 (ERB 12-13) — markers.
 *   - HETEROSEX 同性愛 EXP (ERB 63-72) — gender-pair helper deferred.
 *   - CAN_COM / COM_ABLE execution conditions — not ported.
 *
 * **No outcome roll** — pinned 通常; timeCost 0.
 * **No buildMasterSources** — single-participant foreplay.
 */

import type { ExecCheck, HandlerEntry } from "../../types.js";
import {
  ABL_ID,
  BASE_ID,
  EXP_ID,
  SOURCE_ID,
  TALENT_ID,
  TEQUIP_ID,
} from "../../../state/settlement.js";
import { makeComfHandler } from "../make-comf-handler.js";
import type { ComfDef } from "../comf-def.js";
import { STAIN_PART, getStain } from "../../../state/stain.js";
import { isEquipped, readTequip } from "../../../state/tequip.js";

const block = (message: string): { ok: false; reason: { kind: "precondition"; message: string } } => ({
  ok: false,
  reason: { kind: "precondition", message },
});

/** @COM_ABLE10 可用性判定（忠实核心；体位/乳房電極门 deferred）. */
const com10Check: ExecCheck = (ctx) => {
  const target = ctx.state.charas[ctx.target];
  if (!target) return block("需要在场的对象。");
  // 上半身着衣覆盖：TEQUIP:1 & 2（はだけ不可）且未脱上衣（TEQUIP:3==0）→ 乳首不可及.
  if (
    (readTequip(target, TEQUIP_ID.上半身着衣状況) & 2) !== 0 &&
    readTequip(target, TEQUIP_ID.上半身裸露状態) === 0
  ) {
    return block("对象的上半身衣着妨碍了动作。");
  }
  if (isEquipped(target, TEQUIP_ID.搾乳機)) {
    return block("搾乳機使用中无法进行。");
  }
  if (isEquipped(target, TEQUIP_ID.乳頭夾)) {
    return block("乳頭夾使用中无法进行。");
  }
  return { ok: true };
};

export const comf10Def: ComfDef = {
  commandNo: 10,
  label: "乳首吸い",

  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  canExecute: com10Check,
  hModeMenuCheck: com10Check,

  buildSources: (c) => {
    // ERB 28-32: base SOURCE values.
    let kaiB = 20;       // 快Ｂ
    let jouai = 30;      // 情愛
    const roshutsu = 20; // 露出
    const fuketsu = 30;  // 不潔
    const hankan = 30;   // 反感

    // ERB 34-35: ABL:PLAYER:舌*5 → +快Ｂ / +情愛.
    const shita = c.mAbl(ABL_ID.舌);
    kaiB += shita * 5;
    jouai += shita * 5;

    // ERB 37-38: ABL:親密 >= 10 → 情愛 += 親密*20 (reads TARGET's 親密).
    const shinmitsu = c.tAbl(ABL_ID.親密);
    if (shinmitsu >= 10) jouai += shinmitsu * 20;

    // ERB 41-42: 舌使い (master) ×1.50 on 快Ｂ.
    if (c.master.state.TALENT[TALENT_ID.舌使い]) {
      kaiB = Math.trunc(kaiB * 1.5);
    }
    // ERB 45-46: 猫舌 (master) ×0.75 on 快Ｂ.
    if (c.master.state.TALENT[TALENT_ID.猫舌]) {
      kaiB = Math.trunc(kaiB * 0.75);
    }

    // ERB 51-52: 鬱屈 +100 if 自己愛<0 || 抵抗.
    const utsukotsu =
      c.tTalent(TALENT_ID.自己愛) < 0 || c.tTalent(TALENT_ID.抵抗) ? 100 : 0;

    const sources: Record<number, number> = {
      [SOURCE_ID.快Ｂ]: kaiB,
      [SOURCE_ID.情愛]: jouai,
      [SOURCE_ID.露出]: roshutsu,
      [SOURCE_ID.不潔]: fuketsu,
      [SOURCE_ID.反感]: hankan,
    };
    if (utsukotsu) sources[SOURCE_ID.鬱屈] = utsukotsu;
    return sources;
  },

  body: (c) => {
    // ERB 25-26: DOWNBASE target 体力 5 / 気力 50.
    c.t.state.BASE[BASE_ID.体力] = (c.t.state.BASE[BASE_ID.体力] ?? 0) - 5;
    c.t.state.BASE[BASE_ID.気力] = (c.t.state.BASE[BASE_ID.気力] ?? 0) - 50;

    // ERB 77: 口淫経験 PLAYER++.
    c.master.state.EXP[EXP_ID.口淫経験] =
      (c.master.state.EXP[EXP_ID.口淫経験] ?? 0) + 1;

    // ERB 74-76: 嗜虐快楽経験 PLAYER++ if master 猫舌.
    if (c.master.state.TALENT[TALENT_ID.猫舌]) {
      c.master.state.EXP[EXP_ID.嗜虐快楽経験] =
        (c.master.state.EXP[EXP_ID.嗜虐快楽経験] ?? 0) + 1;
    }

    // ERB 58-59: STAIN swap — target Ｂ ⇔ master 口.
    const tb = getStain(c.t, STAIN_PART.Ｂ);
    const mm = getStain(c.master, STAIN_PART.口);
    c.t.state.STAIN[STAIN_PART.Ｂ] = tb | mm;
    c.master.state.STAIN[STAIN_PART.口] = mm | tb;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 吮吸了%CALLNAME:TARGET%的乳头；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf10HandlerEntry: HandlerEntry = makeComfHandler(comf10Def);
