/**
 * Phase 7 — `COMF12 胸揉み` (fondle breasts, equip-toggle) settlement, as a `ComfDef`.
 *
 * Ports `@COM12` (`ERB/コマンド関連/COMF/COMF12 胸揉み.ERB`), the
 * normal-mode (ELSE) core. Toggle: `TEQUIP:揉胸 = !TEQUIP:揉胸`
 * (line 7) — equip follow-up fires via @EQUIP_COM12 every turn.
 *
 * **H foreplay family (root 0-26) sibling.**
 *
 * **Faithful normal-mode core (ERB 25-64, ELSE branch) — initial @COM12 fire:**
 *   - DOWNBASE: target 体力 10 / 気力 50 (ERB 26-27)
 *   - SOURCE target: 情愛 15, 露出 20, 逸脱 30, 反感 50 (ERB 29-32)
 *   - 快Ｂ = ABL:PLAYER:指*20 + 30 (ERB 34) — no other base
 *   - 親密 >= 7 → 情愛 += 親密*10 (ERB 36-37)
 *   - 器用な指 ×1.50 on 快Ｂ (ERB 39-40)
 *   - 鬱屈 +100 if 自己愛<0 || 抵抗 (ERB 46-47)
 *   - HETEROSEX EXP both += 5 (ERB 55-62) — deferred
 *
 * **DEFERRED (documented):**
 *   - @EQUIP_COM12 continuation SOURCE/BASE/TSP/EXP is in source-check.ts
 *     and runs while TEQUIP:揉胸 is active.
 *   - TCVAR:116 / TCVAR:PLAYER:108 (ERB 13-15) — markers.
 *   - HETEROSEX 同性愛 EXP (ERB 54-62) — gender-pair helper deferred.
 *
 * **No outcome roll** — pinned 通常; timeCost 0.
 */

import type { ExecCheck, HandlerEntry } from "../../types.js";
import { ABL_ID, BASE_ID, CFLAG_ID, FLAG_ID, SOURCE_ID, TALENT_ID, TEQUIP_ID } from "../../../state/settlement.js";
import { isEquipped } from "../../../state/tequip.js";
import { makeComfHandler } from "../make-comf-handler.js";
import type { ComfDef } from "../comf-def.js";

const com12Check: ExecCheck = (ctx) => {
  const target = ctx.state.charas[ctx.target];
  if (!target) return { ok: false, reason: { kind: "precondition", message: "需要在场的对象。" } };
  if (isEquipped(target, TEQUIP_ID.乳房電極)) {
    return { ok: false, reason: { kind: "precondition", message: "对象装备乳房电极时不能揉胸。" } };
  }
  if (target.state.TALENT[TALENT_ID.胸围] === -2) {
    return { ok: false, reason: { kind: "precondition", message: "对象的身体条件不适合这一动作。" } };
  }
  return { ok: true };
};

export const comf12Def: ComfDef = {
  commandNo: 12,
  label: "胸揉み",
  toggleTequip: TEQUIP_ID.揉胸,
  toggleOffNarration: "停止揉弄对象的胸部。",
  canExecute: com12Check,
  hModeMenuCheck: com12Check,

  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,
  downbase: (c): Record<number, number> => c.next.flagStore[FLAG_ID.時間停止] === 1 && c.tCflag(CFLAG_ID.時間停止行動) === 0
    ? { [BASE_ID.TSP]: 20 }
    : {},
  targetDownbase: (c): Record<number, number> => c.next.flagStore[FLAG_ID.時間停止] === 1 && c.tCflag(CFLAG_ID.時間停止行動) === 0
    ? {}
    : { [BASE_ID.体力]: 10, [BASE_ID.気力]: 50 },

  buildSources: (c) => {
    if (c.next.flagStore[FLAG_ID.時間停止] === 1 && c.tCflag(CFLAG_ID.時間停止行動) === 0) {
      return { [SOURCE_ID.快Ｂ]: c.mAbl(ABL_ID.指) * 20 + 30 };
    }
    // ERB 29-32: base (no base 快Ｂ — derived entirely from ABL:PLAYER:指).
    let kaiB = 0;
    let jouai = 15;
    const roshutsu = 20;
    const itsudev = 30;
    const hankan = 50;

    // ERB 34: 快Ｂ = ABL:PLAYER:指*20 + 30.
    kaiB = c.mAbl(ABL_ID.指) * 20 + 30;

    // ERB 36-37: 親密 >= 7 → 情愛 += 親密*10.
    const shinmitsu = c.tAbl(ABL_ID.親密);
    if (shinmitsu >= 7) jouai += shinmitsu * 10;

    // ERB 39-40: 器用な指 ×1.50 on 快Ｂ.
    if (c.master.state.TALENT[TALENT_ID.器用な指]) {
      kaiB = Math.trunc(kaiB * 1.5);
    }

    // ERB 46-47: 鬱屈 +100 if 自己愛<0 || 抵抗.
    const utsukotsu =
      c.tTalent(TALENT_ID.自己愛) < 0 || c.tTalent(TALENT_ID.抵抗) ? 100 : 0;

    const sources: Record<number, number> = {
      [SOURCE_ID.快Ｂ]: kaiB,
      [SOURCE_ID.情愛]: jouai,
      [SOURCE_ID.露出]: roshutsu,
      [SOURCE_ID.逸脱]: itsudev,
      [SOURCE_ID.反感]: hankan,
    };
    if (utsukotsu) sources[SOURCE_ID.鬱屈] = utsukotsu;
    return sources;
  },

  // No body EXP writes for the initial @COM12 arm in the ERB's
  // ELSE branch (手淫経験 is on the @EQUIP_COM12 follow-up, deferred).

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 开始揉弄%CALLNAME:TARGET%的胸部；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf12HandlerEntry: HandlerEntry = makeComfHandler(comf12Def);
