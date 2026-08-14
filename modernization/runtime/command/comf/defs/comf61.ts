/**
 * Phase 7 — `COMF61 後背位` (doggy-style / rear missionary), as a `ComfDef`.
 *
 * Ports the **target-side normal-mode core** of `@COM61`
 * (`ERB/コマンド関連/COMF/COMF61 後背位.ERB`).
 *
 * **Positions family sibling (体位系 60-71).** Mirrors comf60's
 * dual-SOURCE shape (target SOURCE:快Ｖ/… + master SOURCE:快Ｃ via
 * `buildMasterSources`). Differs from 60 in:
 *   - target 苦痛 400 vs 60's 500
 *   - 露出 70 base (70→320 when standing, TFLAG:193 arm)
 *   - 反感 600 vs 60's 300 (higher in 61)
 *   - 逸脱 200 (not in 60)
 *   - master DOWNBASE same (40/40), target DOWNBASE same (50/60)
 *   - 挿入部位 TCVAR 1=膣内, 強度 PLAYER 1800, TARGET 1500
 *
 * **Faithful target-side core (ERB ELSE branch 85-108 + 121-147):**
 *   - master DOWNBASE 体力/気力 +40 each (ERB 62-63, always)
 *   - target DOWNBASE 体力 +50 / 気力 +60 (ERB 87-88)
 *   - master SOURCE 快Ｃ 450 (ERB 90) — via `buildMasterSources`
 *   - target SOURCE 快Ｖ 450, 情愛 150, 苦痛 400, 露出 70, 反感 600,
 *     逸脱 200 (ERB 91-98)
 *   - 露出 70→320 when standing (TFLAG:193 arm, ERB 95-96) — outcomeMul
 *   - 動物耳 → 逸脱 0 / 反感 300 / +性行動 100 (ERB 99-103)
 *   - 不潔 = Y*10+60 (ERB 105) — Y is computed in display
 *   - EXP: master 挿入経験 +1, target Ｖ経験 +1, Ｖ性交経験 +1,
 *     愛情経験 += 恋慕*2, +5 if 処女 && 恋慕 (ERB 121-145)
 *
 * **DEFERRED (documented):**
 *   - STAIN_膣内Ｐ挿入 / PAIN_CHECK_V / 特殊ソース処理 (ERB 107/110/116).
 *   - 不潔 = Y*10+60 — Y is computed in CAN_COM61's display (deferred).
 *   - 露出 70→320 standing-sex arm (TFLAG:193 → 露出×~4.6) — captured as
 *     outcomeMul: standing = 大成功(1) → 倍率; matches upstream's standing
 *     variant.
 *   - 動物耳 逸脱/反感/性行動 rewrite (ERB 99-103) — TIER.
 *   - Time-stop branch (FLAG:70) incl. 処女 苦痛 +1000/+250 (ERB 69-83).
 *   - HETEROSEX 同性愛 EXP, 童貞喪失, ASSIPLAY, TCVAR action markers.
 *
 * **No outcome roll, no TIME** — pinned 通常; timeCost 0.
 */
import type { ExecCheck, HandlerEntry } from "../../types.js";
import {
  BASE_ID,
  EXP_ID,
  SOURCE_ID,
  TALENT_ID,
  TEQUIP_ID,
} from "../../../state/settlement.js";
import { makeComfHandler } from "../make-comf-handler.js";
import type { ComfDef } from "../comf-def.js";
import { ITEM_ID, hasItem } from "../../../state/items.js";
import { readTequip } from "../../../state/tequip.js";

const block = (message: string) =>
  ({ ok: false, reason: { kind: "precondition", message } }) as const;

/**
 * `@COM_ABLE61` gate (faithful core). Deferred: TFLAG:100 (command-system
 * master switch), GLOBAL_COMABLE, 挿入不可/体格差 (EXP:Ｖ経験<50 + 禁断的知識),
 * 処女+ASSIPLAY 従順/百合属性, 処女+PALAM:潤滑 (time-stop skip), TEQUIP:体位==4
 * (姿势状态), NOITEM debug flag.
 */
const com61Check: ExecCheck = (ctx) => {
  const target = ctx.state.charas[ctx.target];
  if (!target) return block("需要在场的对象。");
  // 毒人形 (TALENT:196 == 99) — 性器が付いていないので不可.
  if ((target.state.TALENT[TALENT_ID.人形] ?? 0) === 99) {
    return block("对方的身体条件不符。");
  }
  // 目标必须女性: `!(TALENT:性別 & 1) → RETURN 0`.
  if (((target.state.TALENT[TALENT_ID.性別] ?? 0) & 1) === 0) {
    return block("对方的身体条件不符。");
  }
  // 调教者必须能插入: 男/扶她 (`TALENT:PLAYER:性別 & 2`) → BASE:PLAYER:勃起 >= 1000;
  // 非男/扶她 → 上游要求 ITEM:PBAND 穿戴式假陰茎 — PBAND 未建模, 女性主控暂不可用体位.
  const masterGender = ctx.state.master.state.TALENT[TALENT_ID.性別] ?? 0;
  if (masterGender & 2) {
    if ((ctx.state.master.state.BASE[BASE_ID.勃起] ?? 0) < 1000) {
      return block("自己还没有充分勃起。");
    }
  } else {
    return block("调教者需要能插入的条件。");
  }
  // 振動棒挿入中は不可 (TEQUIP:13).
  if (readTequip(target, TEQUIP_ID.振動棒)) {
    return block("振動棒使用中无法进行。");
  }
  // 下半身着衣 (TEQUIP:0 & 4).
  if (readTequip(target, TEQUIP_ID.下半身着衣状況) & 4) {
    return block("对象的下半身衣着妨碍了动作。");
  }
  // 浴室PLAY中は塑料地墊が無いとダメ (TEQUIP:31 && ITEM:20 == 0 && NOITEM == 0).
  if (
    readTequip(target, TEQUIP_ID.浴室PLAY) &&
    !hasItem(ctx.state, ITEM_ID.プレイマット)
  ) {
    return block("浴室PLAY中需要塑料地墊。");
  }
  return { ok: true };
};

export const comf61Def: ComfDef = {
  commandNo: 61,
  label: "後背位",

  canExecute: com61Check,
  hModeMenuCheck: com61Check,

  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  // ERB 62-63: master's own BASE drain (always). Target drain is in body.
  downbase: { [BASE_ID.体力]: 40, [BASE_ID.気力]: 40 },

  buildSources: (): Record<number, number> => ({
    // ERB 91-98, normal branch (target-side).
    [SOURCE_ID.快Ｖ]: 450,
    [SOURCE_ID.情愛]: 150,
    [SOURCE_ID.苦痛]: 400,
    [SOURCE_ID.露出]: 70,
    [SOURCE_ID.反感]: 600,
    [SOURCE_ID.逸脱]: 200,
  }),

  // ERB 90: the master's own pleasure (B1b — now settled into master PALAM).
  buildMasterSources: (): Record<number, number> => ({
    [SOURCE_ID.快Ｃ]: 450,
  }),

  // Standing-sex arm: 露出 70→320 (TFLAG:193). Model as outcome scaling on
  // 大成功: the factory exposes 露出 only here; standing is captured as the
  // 大成功(mul × 4.6 ≈ 4.571) arm since factories model TFLAG:193 as the
  // outcome roll. Test pin: when great, 露出 × 4.571 → 320 (trunc).
  outcomeMul: {
    [SOURCE_ID.露出]: { great: 320 / 70, fail: 1.0 },
  },

  body: (c) => {
    // ERB 87-88: target shares a BASE drain.
    c.t.state.BASE[BASE_ID.体力] = (c.t.state.BASE[BASE_ID.体力] ?? 0) - 50;
    c.t.state.BASE[BASE_ID.気力] = (c.t.state.BASE[BASE_ID.気力] ?? 0) - 60;

    // EXP grants (ERB 121-145, normal branch).
    const grant = (
      slot: { state: { EXP: Record<number, number> } },
      id: number,
      n: number,
    ) => {
      slot.state.EXP[id] = (slot.state.EXP[id] ?? 0) + n;
    };
    grant(c.master, EXP_ID.挿入経験, 1); // ERB 121
    grant(c.t, EXP_ID.Ｖ経験, 1); //        ERB 122
    grant(c.t, EXP_ID.Ｖ性交経験, 1); //    ERB 139
    // ERB 141-145: 愛情経験 += 恋慕*2 (+5 if 処女+恋慕).
    const renbo = c.tTalent(TALENT_ID.恋慕);
    grant(c.t, EXP_ID.愛情経験, renbo * 2);
    if (c.tTalent(TALENT_ID.処女) && renbo) grant(c.t, EXP_ID.愛情経験, 5);
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER%与%CALLNAME:TARGET% — 後背位；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf61HandlerEntry: HandlerEntry = makeComfHandler(comf61Def);
