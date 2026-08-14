/**
 * Phase 7 — `COMF187 お風呂場プレイ` (bathroom play), as a `ComfDef`.
 *
 * Ports the **initial toggle core** of `@COM187`
 * (`ERB/コマンド関連/COMF/COMF187 お風呂場プレイ.ERB`).
 *
 * **特殊 family sibling (187 お風呂場プレイ).** Equip-toggle command —
 * starts or ends bathroom play. Initial application: light 恐怖/露出/
 * 逸脱/反感 SOURCE (magnitudes much lower than 野外/羞恥) + 鬱屈
 * penalty for 自己愛<0 / 抵抗 + STAIN reset (deferred).
 *
 * **Faithful normal-mode core (ERB 6-50):**
 *   - DOWNBASE: target 体力 0 / 気力 30 (ERB 24-25)
 *   - SOURCE: 恐怖 100, 露出 200, 逸脱 50, 反感 100 (ERB 27-30)
 *   - 鬱屈 += 50 if 自己愛 < 0 || 抵抗 (ERB 37-38)
 *   - STAIN reset (ERB 43-48): target soil reset to bathed baseline
 *     (口/手/Ｂ=0, Ｐ=2, Ｖ=1, Ａ=8).
 *
 * **DEFERRED (documented):**
 *   - EQUIP_COM187 continuation (ERB 54-68) — per-tick 体力/気力 + 恭順/反感.
 *   - TEQUIP:浴室PLAY + TEQUIP:淋浴 toggle (ERB 7-14) — equip layer.
 *   - TCVAR:116 = PLAYER (ERB 19) — display-only.
 *   - COMABLE gates (ERB 74-123) — COMABLE layer.
 *
 * **No outcome roll, no TIME** — pinned 通常; timeCost 0.
 */

import type { ExecCheck, HandlerEntry } from "../../types.js";
import {
  ABL_ID,
  BASE_ID,
  CFLAG_ID,
  FLAG_ID,
  SOURCE_ID,
  TALENT_ID,
  TEQUIP_ID,
} from "../../../state/settlement.js";
import { hasItem } from "../../../state/items.js";
import { isEquipped, readTequip } from "../../../state/tequip.js";
import { makeComfHandler } from "../make-comf-handler.js";
import type { ComfDef } from "../comf-def.js";
import { STAIN_PART } from "../../../state/stain.js";

/** @COM_ABLE187 menu gate: present target + 浴室PLAY toggle (解除 arm), 従順
 *  >= 2, 簡易泳池 (ITEM:38) held, fully nude (TEQUIP:0/1 clear), not during
 *  野外/羞恥/新妻PLAY, not time-stopped. 動物耳 / 泳池位置 / 温泉设施 /
 *  ASSI / NOITEM / TFLAG:100 / GLOBAL_COMABLE deferred. */
const com187Check: ExecCheck = (ctx) => {
  const block = (message: string): { ok: false; reason: { kind: "precondition"; message: string } } => ({
    ok: false,
    reason: { kind: "precondition", message },
  });
  const target = ctx.state.charas[ctx.target];
  if (!target) return block("需要在场的对象。");
  // 解除 arm — 已装备时显示以便取下 (上游 SIF TEQUIP:浴室PLAY → RETURN 1).
  if (isEquipped(target, TEQUIP_ID.浴室PLAY)) return { ok: true };
  // 上游 ABL:従順 <= 1 → RETURN 0 (需 2+).
  if ((target.state.ABL[ABL_ID.従順] ?? 0) <= 1) return block("需要顺从达到 2。");
  // 上游 ITEM:簡易泳池 (id 38) 必须持有.
  if (!hasItem(ctx.state, 38)) return block("没有简易泳池。");
  // 上游 TEQUIP:0 || TEQUIP:1 → RETURN 0 (全裸必须).
  if (
    readTequip(target, TEQUIP_ID.下半身着衣状況) !== 0 ||
    readTequip(target, TEQUIP_ID.上半身着衣状況) !== 0
  ) return block("需要全裸状态。");
  if (isEquipped(target, TEQUIP_ID.野外PLAY)) return block("野外PLAY中无法使用。");
  if (isEquipped(target, TEQUIP_ID.羞耻PLAY)) return block("羞耻PLAY中无法使用。");
  if (isEquipped(target, TEQUIP_ID.新妻PLAY)) return block("新妻PLAY中无法使用。");
  if (
    (ctx.state.flagStore[FLAG_ID.時間停止] ?? 0) === 1 &&
    (target.state.CFLAG[CFLAG_ID.時間停止行動] ?? 0) === 0
  ) return block("时间停止中无法进行。");
  return { ok: true };
};

export const comf187Def: ComfDef = {
  commandNo: 187,
  label: "お風呂場プレイ",

  // No outcome roll; pinned 通常.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  // 浴室PLAY toggle (原版 @COM187 TEQUIP:浴室PLAY = !...).
  toggleTequip: TEQUIP_ID.浴室PLAY,

  hModeMenuCheck: com187Check,

  // Target drain lives in body.
  downbase: {},

  buildSources: (c) => {
    // ERB 27-30: 恐怖 100, 露出 200, 逸脱 50, 反感 100.
    const kyoufu = 100;
    const roshutsu = 200;
    const itsudev = 50;
    let hankan = 100;
    let utsuku = 0;

    // ERB 37-38: 鬱屈 += 50 if 自己愛<0 or 抵抗.
    const hasJikoai = (c.tTalent(TALENT_ID.自己愛 as number)) < 0;
    const hasTeikou = c.tTalent(TALENT_ID.抵抗) > 0;
    if (hasJikoai || hasTeikou) {
      utsuku = 50;
    }

    const result: Record<number, number> = {
      [SOURCE_ID.恐怖]: kyoufu,
      [SOURCE_ID.露出]: roshutsu,
      [SOURCE_ID.逸脱]: itsudev,
      [SOURCE_ID.反感]: hankan,
    };
    if (utsuku > 0) {
      result[SOURCE_ID.鬱屈] = utsuku;
    }
    return result;
  },

  body: (c) => {
    // ERB 24-25: target 体力 0 / 気力 30 drain.
    c.t.state.BASE[BASE_ID.気力] = (c.t.state.BASE[BASE_ID.気力] ?? 0) - 30;

    // ERB 43-48: 汚れリセット — entering the bath resets the target's soil to
    // the "bathed clean" baseline (口/手/Ｂ cleared; Ｐ=陰茎, Ｖ=愛液, Ａ=肛門
    // left as the parts' resting state). Direct assignment, not OR.
    c.t.state.STAIN[STAIN_PART.口] = 0;
    c.t.state.STAIN[STAIN_PART.手] = 0;
    c.t.state.STAIN[STAIN_PART.Ｐ] = 2;
    c.t.state.STAIN[STAIN_PART.Ｖ] = 1;
    c.t.state.STAIN[STAIN_PART.Ａ] = 8;
    c.t.state.STAIN[STAIN_PART.Ｂ] = 0;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 与%CALLNAME:TARGET%开始了浴室PLAY — お風呂場プレイ；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf187HandlerEntry: HandlerEntry = makeComfHandler(comf187Def);
