/**
 * Phase 7 — `COMF186 羞恥プレイ` (shame play), as a `ComfDef`.
 *
 * Ports the **initial toggle core** of `@COM186`
 * (`ERB/コマンド関連/COMF/COMF186 羞恥プレイ.ERB`).
 *
 * **特殊 family sibling (186 羞恥プレイ).** Equip-toggle command —
 * starts or ends shame/humiliation play (mirror). Initial application:
 * 恐怖/屈従/反感 SOURCE with a 受虐属性-scaled 露出 tail and 鬱屈
 * penalty for 自己愛<0 / 抵抗.
 *
 * **Faithful normal-mode core (ERB 12-92):**
 *   - DOWNBASE: target 体力 0 / 気力 200 (ERB 25-26)
 *   - SOURCE: 恐怖 += 500, 屈従 += 300, 逸脱 += 100, 反感 += 500 (ERB 28-31)
 *   - 鬱屈 += 500 if 自己愛 < 0 || 抵抗 (ERB 38-39)
 *   - 受虐属性 scaling on LOCAL (700 base), then 露出 += LOCAL
 *     (ERB 43-90): same SELECTCASE table as comf184
 *
 * **DEFERRED (documented):**
 *   - 液体/欲情 SOURCE from 受虐属性 scaling (ERB 46-88) — 液体 id not
 *     modeled; 欲情 still modeled but deferred for consistency.
 *   - EQUIP_COM186 continuation (ERB 97-166) — per-tick while equipped;
 *     different magnitudes.
 *   - TCVAR:116 = PLAYER (ERB 20) — display-only.
 *   - TEQUIP:羞恥PLAY toggle (ERB 15) — equip layer.
 *   - COMABLE gates (ERB 171-201) — COMABLE layer.
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
import { isEquipped } from "../../../state/tequip.js";
import { makeComfHandler } from "../make-comf-handler.js";
import type { ComfDef } from "../comf-def.js";

/** @COM_ABLE186 menu gate: present target + 大鏡 (ITEM:21) held/equipped,
 *  従順 >= 2, not during 野外/浴室/新妻PLAY, not time-stopped. NOITEM/
 *  TFLAG:100/GLOBAL_COMABLE deferred. */
const com186Check: ExecCheck = (ctx) => {
  const block = (message: string): { ok: false; reason: { kind: "precondition"; message: string } } => ({
    ok: false,
    reason: { kind: "precondition", message },
  });
  const target = ctx.state.charas[ctx.target];
  if (!target) return block("需要在场的对象。");
  // 解除 arm — 已装备时显示以便取下 (上游 SIF TEQUIP:羞耻PLAY → RETURN 1).
  if (isEquipped(target, TEQUIP_ID.羞耻PLAY)) return { ok: true };
  if (!hasItem(ctx.state, 21)) return block("没有大镜子。");
  // 上游 ABL:従順 <= 1 → RETURN 0 (需 2+).
  if ((target.state.ABL[ABL_ID.従順] ?? 0) <= 1) return block("需要顺从达到 2。");
  if (isEquipped(target, TEQUIP_ID.野外PLAY)) return block("野外PLAY中无法使用。");
  if (isEquipped(target, TEQUIP_ID.浴室PLAY)) return block("浴室PLAY中无法使用。");
  if (isEquipped(target, TEQUIP_ID.新妻PLAY)) return block("新妻PLAY中无法使用。");
  if (
    (ctx.state.flagStore[FLAG_ID.時間停止] ?? 0) === 1 &&
    (target.state.CFLAG[CFLAG_ID.時間停止行動] ?? 0) === 0
  ) return block("时间停止中无法进行。");
  return { ok: true };
};

/** 受虐属性 level → multiplier for LOCAL (露出 adder). ERB COMF186 lines 44-89. */
const MASOCHISM_LOCAL_MUL: Record<number, number> = {
  0: 0.80, 1: 1.00, 2: 1.20, 3: 1.40, 4: 1.50,
  5: 1.70, 6: 1.90, 7: 2.10, 8: 2.30, 9: 2.50,
};
const MASOCHISM_LOCAL_MUL_DEFAULT = 3.00;

function localMul(abl: number): number {
  return MASOCHISM_LOCAL_MUL[abl] ?? MASOCHISM_LOCAL_MUL_DEFAULT;
}

export const comf186Def: ComfDef = {
  commandNo: 186,
  label: "羞恥プレイ",

  // No outcome roll; pinned 通常.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  // Slice D: 需要道具 21 + toggle TEQUIP 槽.
  requiresItem: 21,
  toggleTequip: TEQUIP_ID.羞耻PLAY,

  hModeMenuCheck: com186Check,

  // Target drain lives in body.
  downbase: {},

  buildSources: (c) => {
    // ERB 28-31: base SOURCE values.
    const kyoufu = 500;
    const kujuu = 300;
    const itsudev = 100;
    let hankan = 500;
    let utsuku = 0;

    // ERB 38-39: 鬱屈 if 自己愛<0 or 抵抗.
    const hasJikoai = (c.tTalent(TALENT_ID.自己愛 as number)) < 0;
    const hasTeikou = c.tTalent(TALENT_ID.抵抗) > 0;
    if (hasJikoai || hasTeikou) {
      utsuku = 500;
    }

    // ERB 43-90: LOCAL = 700 * 受虐属性 multiplier, then 露出 += LOCAL.
    const masoAbl = c.tAbl(ABL_ID.受虐属性);
    const roshutsuAdder = Math.trunc(700 * localMul(masoAbl));

    const result: Record<number, number> = {
      [SOURCE_ID.恐怖]: kyoufu,
      [SOURCE_ID.屈従]: kujuu,
      [SOURCE_ID.逸脱]: itsudev,
      [SOURCE_ID.反感]: hankan,
      [SOURCE_ID.露出]: roshutsuAdder,
    };
    if (utsuku > 0) {
      result[SOURCE_ID.鬱屈] = utsuku;
    }
    return result;
  },

  body: (c) => {
    // ERB 25-26: target 体力 0 / 気力 200 drain.
    c.t.state.BASE[BASE_ID.気力] = (c.t.state.BASE[BASE_ID.気力] ?? 0) - 200;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 与%CALLNAME:TARGET%开始了羞耻PLAY — 羞恥プレイ；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf186HandlerEntry: HandlerEntry = makeComfHandler(comf186Def);
