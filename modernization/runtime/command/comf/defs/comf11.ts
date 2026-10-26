/**
 * Phase 7 — `COMF11 乳首吸い(継続)` (suck nipple, equip-toggle) settlement, as a `ComfDef`.
 *
 * Ports `@COM11` (`ERB/コマンド関連/COMF/COMF11 乳首吸い.ERB`), the
 * normal-mode (ELSE) core. The toggle is `TEQUIP:吸乳头 = !TEQUIP:吸乳头`
 * (line 7); the SOURCE portion of @EQUIP_COM11 (ERB 83-126) runs at
 * SOURCE_CHECK while this target's toggle remains active.
 *
 * **H foreplay family (root 0-26) sibling.**
 *
 * **Faithful normal-mode core (ERB 25-78, ELSE branch) — initial @COM11 fire:**
 *   - DOWNBASE: target 体力 5 / 気力 50 (ERB 26-27)
 *   - SOURCE target: 快Ｂ 20, 情愛 30, 露出 20, 不潔 30, 反感 100
 *     (ERB 29-33) — note 反感 100 (heavier than comf10's 30)
 *   - ABL:PLAYER:舌*20 → +快Ｂ (ERB 35)
 *   - ABL:PLAYER:舌*5 → +情愛 (ERB 36)
 *   - 親密 >= 7 → 情愛 += 親密*20 (ERB 38-39) — different threshold (>=7)
 *   - 舌使い ×1.50 on 快Ｂ (ERB 42-43)
 *   - 猫舌 ×0.75 on 快Ｂ (ERB 46-47)
 *   - 鬱屈 +100 if 自己愛<0 || 抵抗 (ERB 52-53)
 *   - EXP 口淫経験 PLAYER++ (ERB 78) — exp.als id 25
 *   - HETEROSEX EXP both += 5 (ERB 65-73) — deferred
 *
 * **DEFERRED (documented):**
 *   - @EQUIP_COM11 continuation SOURCE/BASE/TSP/EXP is in source-check.ts.
 *   - Continuation STAIN (B⇔口) swap is still deferred.
 *   - TCVAR:116 / TCVAR:PLAYER:108 (ERB 13-15) — markers.
 *   - HETEROSEX 同性愛 EXP (ERB 64-73) — gender-pair helper deferred.
 *
 * **No outcome roll** — pinned 通常; timeCost 0.
 */

import type { ExecCheck, HandlerEntry } from "../../types.js";
import { ABL_ID, BASE_ID, CFLAG_ID, EXP_ID, FLAG_ID, SOURCE_ID, TALENT_ID, TEQUIP_ID } from "../../../state/settlement.js";
import { findTouchTarget, TOUCH_PART } from "../../../state/touch-state.js";
import { isEquipped, readTequip } from "../../../state/tequip.js";
import { makeComfHandler } from "../make-comf-handler.js";
import type { ComfDef } from "../comf-def.js";

const block = (message: string) => ({
  ok: false as const,
  reason: { kind: "precondition" as const, message },
});

/** @COM_ABLE11: clothing, incompatible equipment/pose, and mouth ownership. */
const com11Check: ExecCheck = (ctx) => {
  const target = ctx.state.charas[ctx.target];
  if (!target) return block("需要在场的对象。");
  if ((readTequip(target, TEQUIP_ID.上半身着衣状況) & 2) !== 0 &&
      readTequip(target, TEQUIP_ID.上半身裸露状態) === 0) {
    return block("对象的上半身衣着妨碍了动作。");
  }
  if (isEquipped(target, TEQUIP_ID.搾乳機) || isEquipped(target, TEQUIP_ID.乳頭夾) ||
      isEquipped(target, TEQUIP_ID.乳房電極)) {
    return block("对象胸部已有互斥道具。");
  }
  if ([2, 3, 5].includes(readTequip(target, TEQUIP_ID.体位))) {
    return block("当前体位无法持续吸吮乳头。");
  }
  const mouthOwner = findTouchTarget(ctx.state, TOUCH_PART.口);
  if (mouthOwner !== undefined && mouthOwner !== ctx.target) {
    return block("主角的口部正用于其他对象。");
  }
  const room = [ctx.state.master, ...Object.values(ctx.state.charas)]
    .filter((slot) => slot.location === ctx.state.master.location);
  if (room.length > 2 && room.some((slot) =>
    slot.charaNum !== ctx.target && readTequip(slot, TEQUIP_ID.吸乳头) !== 0)) {
    return block("同房间内已有其他持续吸吮对象。");
  }
  return { ok: true };
};
import { STAIN_PART, getStain } from "../../../state/stain.js";

export const comf11Def: ComfDef = {
  commandNo: 11,
  label: "乳首吸い(継続)",
  toggleTequip: TEQUIP_ID.吸乳头,
  toggleOffNarration: "停止吮吸对象的乳头。",
  canExecute: com11Check,
  hModeMenuCheck: com11Check,

  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,
  downbase: (c): Record<number, number> => c.next.flagStore[FLAG_ID.時間停止] === 1 && c.tCflag(CFLAG_ID.時間停止行動) === 0
    ? { [BASE_ID.TSP]: 20 }
    : {},
  targetDownbase: (c): Record<number, number> => c.next.flagStore[FLAG_ID.時間停止] === 1 && c.tCflag(CFLAG_ID.時間停止行動) === 0
    ? {}
    : { [BASE_ID.体力]: 5, [BASE_ID.気力]: 50 },

  buildSources: (c) => {
    if (c.next.flagStore[FLAG_ID.時間停止] === 1 && c.tCflag(CFLAG_ID.時間停止行動) === 0) {
      return { [SOURCE_ID.快Ｂ]: c.mAbl(ABL_ID.舌) * 20 + 20 };
    }
    // ERB 29-33: base — note 反感 100 (heavier than comf10's 30).
    let kaiB = 20;
    let jouai = 30;
    const roshutsu = 20;
    const fuketsu = 30;
    const hankan = 100;

    // ERB 35-36: ABL:PLAYER:舌.
    const shita = c.mAbl(ABL_ID.舌);
    kaiB += shita * 20; // ERB 35: ×20 on 快Ｂ
    jouai += shita * 5; // ERB 36: ×5 on 情愛

    // ERB 38-39: 親密 >= 7 → 情愛 += 親密*20.
    const shinmitsu = c.tAbl(ABL_ID.親密);
    if (shinmitsu >= 7) jouai += shinmitsu * 20;

    // ERB 42-43: 舌使い ×1.50 on 快Ｂ.
    if (c.master.state.TALENT[TALENT_ID.舌使い]) {
      kaiB = Math.trunc(kaiB * 1.5);
    }
    // ERB 46-47: 猫舌 ×0.75 on 快Ｂ.
    if (c.master.state.TALENT[TALENT_ID.猫舌]) {
      kaiB = Math.trunc(kaiB * 0.75);
    }

    // ERB 52-53: 鬱屈 +100 if 自己愛<0 || 抵抗.
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
    // ERB 78: 口淫経験 PLAYER++.
    c.master.state.EXP[EXP_ID.口淫経験] =
      (c.master.state.EXP[EXP_ID.口淫経験] ?? 0) + 1;
    // ERB 76-77: 嗜虐快楽経験 PLAYER++ if 猫舌.
    if (c.master.state.TALENT[TALENT_ID.猫舌]) {
      c.master.state.EXP[EXP_ID.嗜虐快楽経験] =
        (c.master.state.EXP[EXP_ID.嗜虐快楽経験] ?? 0) + 1;
    }
    // ERB 59-60: STAIN swap — target Ｂ ⇔ master 口.
    const tb = getStain(c.t, STAIN_PART.Ｂ);
    const mm = getStain(c.master, STAIN_PART.口);
    c.t.state.STAIN[STAIN_PART.Ｂ] = tb | mm;
    c.master.state.STAIN[STAIN_PART.口] = mm | tb;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 开始吮吸%CALLNAME:TARGET%的乳头；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf11HandlerEntry: HandlerEntry = makeComfHandler(comf11Def);
