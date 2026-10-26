/**
 * Phase 7 — `COMF184 野外プレイ` (outdoor play), as a `ComfDef`.
 *
 * Ports the **initial toggle core** of `@COM184`
 * (`ERB/コマンド関連/COMF/COMF184 野外プレイ.ERB`).
 *
 * **特殊 family sibling (184 野外プレイ).** Equip-toggle command —
 * starts or ends outdoor exposure play. Initial application: strong
 * 露出-dominant SOURCE (1300 base) with 恐怖/逸脱/反感 tail, plus
 * 受虐属性 level-dependent scaling on 露出 magnitude and 鬱屈
 * penalty for 自己愛<0 / 抵抗. The EQUIP_COM184 continuation is deferred.
 *
 * **Faithful normal-mode core (ERB 8-82, initial apply):**
 *   - DOWNBASE: target 体力 0 / 気力 150 (ERB 19-20)
 *   - SOURCE: 恐怖 800, 露出 1300 (base, then scaled by 受虐属性),
 *     逸脱 300, 反感 600 (ERB 22-25)
 *   - 鬱屈 += 600 if 自己愛 < 0 || 抵抗 (ERB 31-32)
 *   - 受虐属性 scaling on 露出: ×0.8(0) → ×1.0(1) → ×1.2(2) →
 *     ×1.4(3) → ×1.5(4) → ×1.7(5) → ×1.9(6) → ×2.1(7) →
 *     ×2.3(8) → ×2.5(9) → ×3.0(10+) (ERB 36-81)
 *
 * **DEFERRED (documented):**
 *   - 液体/欲情 SOURCE from 受虐属性 scaling (ERB 39-80) — 液体 id not
 *     modeled; 欲情 still modeled but kept separate.
 *   - EQUIP_COM184 continuation (ERB 88-170) — per-tick while equipped;
 *     different SOURCE magnitudes based on TEQUIP:野外PLAY state.
 *   - TCVAR:116 = PLAYER (ERB 13) — display-only.
 *   - COMABLE gates (ERB 176-211) — COMABLE layer (浴室/新妻 conflict etc).
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

/** @COM_ABLE184 menu gate: present target + 项圈 (ITEM:22) held/equipped,
 *  従順/受虐属性 at least one >= 3, not during 浴室/新妻PLAY, not time-stopped.
 *  IS_VAMPIRE昼间 / NOITEM / TFLAG:100 / GLOBAL_COMABLE deferred. */
const com184Check: ExecCheck = (ctx) => {
  const block = (message: string): { ok: false; reason: { kind: "precondition"; message: string } } => ({
    ok: false,
    reason: { kind: "precondition", message },
  });
  const target = ctx.state.charas[ctx.target];
  if (!target) return block("需要在场的对象。");
  // 解除 arm — 已装备时显示以便取下 (上游 SIF TEQUIP:野外PLAY → RETURN 1).
  if (isEquipped(target, TEQUIP_ID.野外PLAY)) return { ok: true };
  if (!hasItem(ctx.state, 22)) return block("没有项圈。");
  // 上游 ABL:従順 <= 2 && ABL:受虐属性 <= 2 → RETURN 0 (需其一 >= 3).
  if ((target.state.ABL[ABL_ID.従順] ?? 0) <= 2 && (target.state.ABL[ABL_ID.受虐属性] ?? 0) <= 2) {
    return block("需要顺从或受虐属性达到 3。");
  }
  if (isEquipped(target, TEQUIP_ID.浴室PLAY)) return block("浴室PLAY中无法使用。");
  if (isEquipped(target, TEQUIP_ID.新妻PLAY)) return block("新妻PLAY中无法使用。");
  if (
    (ctx.state.flagStore[FLAG_ID.時間停止] ?? 0) === 1 &&
    (target.state.CFLAG[CFLAG_ID.時間停止行動] ?? 0) === 0
  ) return block("时间停止中无法进行。");
  return { ok: true };
};

/** 受虐属性 level → 露出 multiplier. ERB COMF184 lines 36-81 SELECTCASE. */
const MASOCHISM_EXPOSE_MUL: Record<number, number> = {
  0: 0.80, 1: 1.00, 2: 1.20, 3: 1.40, 4: 1.50,
  5: 1.70, 6: 1.90, 7: 2.10, 8: 2.30, 9: 2.50,
};
const MASOCHISM_EXPOSE_MUL_DEFAULT = 3.00;

function masochismExposeMul(abl: number): number {
  return MASOCHISM_EXPOSE_MUL[abl] ?? MASOCHISM_EXPOSE_MUL_DEFAULT;
}

export const comf184Def: ComfDef = {
  commandNo: 184,
  label: "野外プレイ",

  // Equip-toggle core (COMF184.ERB:8 `TEQUIP:野外PLAY = !TEQUIP:野外PLAY`).
  // Requires 项圈 (ITEM:22, COMF184.ERB:189 `SIF ITEM:22 == 0 → RETURN 0`).
  // The 浴室/新妻 PLAY conflict gate (TEQUIP:31/33) and 従順/受虐 ABL gate stay
  // on the COMABLE layer (deferred, matching the other PLAY defs).
  toggleTequip: TEQUIP_ID.野外PLAY,
  requiresItem: 22,

  hModeMenuCheck: com184Check,

  // No outcome roll; pinned 通常.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  // ERB 19-20: target drain is shared with the resource preflight.
  downbase: {},
  targetDownbase: { [BASE_ID.気力]: 150 },

  buildSources: (c) => {
    // ERB 22-25: base values.
    const kyoufu = 800;
    let roshutsu = 1300;
    const itsudev = 300;
    let hankan = 600;
    let utsuku = 0;

    // ERB 31-32: 鬱屈 if 自己愛<0 or 抵抗.
    const hasJikoai = (c.tTalent(TALENT_ID.自己愛 as number)) < 0;
    const hasTeikou = c.tTalent(TALENT_ID.抵抗) > 0;
    if (hasJikoai || hasTeikou) {
      utsuku = 600;
    }

    // ERB 36-81: 受虐属性 scaling on 露出.
    const masoAbl = c.tAbl(ABL_ID.受虐属性);
    roshutsu = Math.trunc(roshutsu * masochismExposeMul(masoAbl));

    // ERB 39-80: 液体/欲情 tail from 受虐属性 — deferred (液体 id not modeled).
    // We ship the 露出 scaling faithfully; 欲情 requires 液体 id context.

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

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 把%CALLNAME:TARGET%带到了户外 — 野外プレイ；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf184HandlerEntry: HandlerEntry = makeComfHandler(comf184Def);
