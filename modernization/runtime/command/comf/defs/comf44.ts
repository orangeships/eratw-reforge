/**
 * Phase 7 — `COMF44 バイブ` (vaginal vibrator), as a `ComfDef`.
 *
 * Ports the normal-mode core of `@COM44`
 * (`ERB/コマンド関連/COMF/COMF44 バイブ.ERB`).
 *
 * Toys family sibling (道具系 40-49). First insertion-style toy: it adds
 * 苦痛 SOURCE and (when TARGET is 処女 / 再生処女) significantly more.
 * It also grants EXP:Ｖ経験.
 *
 * **Faithful normal-mode core captured (ERB 35-83, the non-time-stop ELSE):**
 *   - DOWNBASE master 体力 +30 / 気力 +100 (ERB 52-53)
 *   - SOURCE 快Ｖ 250, 苦痛 50, 露出 20, 逸脱 40, 反感 40 (ERB 55-59)
 *   - +鬱屈 40 if the target has 自己愛<0 or 抵抗 (ERB 66-67)
 *   - EXP:Ｖ経験 +1 (ERB 88)
 *   - EXP:PLAYER 道具使用経験 +1 (ERB 106)
 *
 * **DEFERRED (documented):**
 *   - Time-stop branch (ERB 18-19) — TSP drain only.
 *   - The **処女 spike branches** (ERB 70-79):
 *       - 処女 == 1: SOURCE:苦痛 += 2000, SOURCE:反感 += 3000
 *       - 処女 == 2: SOURCE:苦痛 += 500, SOURCE:反感 += 1000
 *     These spikes are deferred because their magnitude warrants a
 *     separate handler path; current factory pipeline cannot cleanly
 *     express the +2000/+3000 spike without colliding with baseline
 *     values. Numbers pinned here for the next port pass.
 *   - **PAIN_CHECK_V(TARGET)** (ERB 82) — pre-settlement ABL/PALAM pain
 *     gating from `SOURCE_CHECK.ERB` is not yet modeled at the def level.
 *   - **HETEROSEX 同性愛 EXP** (ERB 89-104, live-deferred) and
 *     **異常経験** (ERB 95-98, live-deferred) — gender-pair helper +
 *     異常経験 flag bookkeeping deferred.
 *   - **TEQUIP:振動棒 toggle** (ERB 14, `TEQUIP:振動棒 = !TEQUIP:振動棒`,
 *     Tequip.csv slot 13) and the equipping/disequipping DISPLAY label
 *     (ERB 5-10) — persistent equipment state is not modeled at the
 *     def level (see EQUIP_COM44 below).
 *   - **H-scene action markers** (ERB 19-29, mid-scene chaining state):
 *     TCVAR:116 = PLAYER (行為者), TCVAR:PLAYER:108 = 1 (奉仕快楽 flag),
 *     CSTR:TARGET:10 += @{PLAYER}/, TCVAR:TARGET:2 = 13 (Ｖ責め marker),
 *     TCVAR:TARGET:4 = 900 (強度).
 *   - **ITEM:4 gate** (ERB 210), **TEQUIP:0 & 4** 下半身着衣 (ERB 214),
 *     and the ASSIPLAY 従順/百合属性 gates (ERB 217-225) — gated by the
 *     COMABLE layer, not the def.
 *   - **@EQUIP_COM44** (ERB 113-186) — per-tick continuation while
 *     equipped. NOTE: this is deferred family-wide for the 道具 40-49
 *     sibling set, not unique to 44.
 *
 * **No outcome roll, no TIME** — factory pinned to 通常; timeCost 0.
 */
import type { ExecCheck, HandlerEntry } from "../../types.js";
import {
  BASE_ID,
  SOURCE_ID,
  TALENT_ID,
  EXP_ID,
  TEQUIP_ID,
} from "../../../state/settlement.js";
import { makeComfHandler } from "../make-comf-handler.js";
import type { ComfDef } from "../comf-def.js";
import { hasItem } from "../../../state/items.js";
import { isEquipped, readTequip } from "../../../state/tequip.js";

const block = (message: string): { ok: false; reason: { kind: "precondition"; message: string } } => ({
  ok: false,
  reason: { kind: "precondition", message },
});

// COM_ABLE44: TFLAG:100 → target present; TEQUIP:13 (already equipped)
// → allow to display so it can be unequipped; !(TALENT:2 & 1) 男人→block;
// ITEM:4 owned; TEQUIP:0 & 4 下半身着衣. TALENT:196 毒人形, ASSIPLAY
// 処女/潤滑 従順/百合属性 gates — deferred.
const com44Check: ExecCheck = (ctx) => {
  const target = ctx.state.charas[ctx.target];
  if (!target) return block("需要在场的对象。");
  if (!hasItem(ctx.state, 4) && !isEquipped(target, TEQUIP_ID.振動棒)) {
    return block("需要バイブ。");
  }
  if (((target.state.TALENT[TALENT_ID.性別] ?? 0) & 1) === 0) {
    return block("男性对象的身体条件不符。");
  }
  if (readTequip(target, TEQUIP_ID.下半身着衣状況) & 4) {
    return block("对象的下半身衣着妨碍了动作。");
  }
  return { ok: true };
};

export const comf44Def: ComfDef = {
  commandNo: 44,
  label: "バイブ",

  // Target-directed (the recipient). No outcome roll → pinned 通常.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  // H-scene actions don't advance the clock.
  timeCost: 0,

  // Slice C: 需要道具 4 + toggle TEQUIP 槽.
  requiresItem: 4,
  toggleTequip: TEQUIP_ID.振動棒,

  // P1-14: H 命令菜单门控 — 持有 バイブ 或 已装备; 需女性; 下半身着衣&4 不可.
  hModeMenuCheck: com44Check,

  // ERB 52-53 (normal branch).
  downbase: { [BASE_ID.体力]: 30, [BASE_ID.気力]: 100 },

  buildSources: (c): Record<number, number> => {
    const sources: Record<number, number> = {
      [SOURCE_ID.快Ｖ]: 250, // ERB 55
      [SOURCE_ID.苦痛]: 50, //  ERB 56
      [SOURCE_ID.露出]: 20, //  ERB 57
      [SOURCE_ID.逸脱]: 40, //  ERB 58
      [SOURCE_ID.反感]: 40, //  ERB 59
    };
    // ERB 66-67: coercion discomfort for 自己愛<0 / 抵抗 targets.
    if (c.tTalent(TALENT_ID.自己愛) < 0 || c.tTalent(TALENT_ID.抵抗)) {
      sources[SOURCE_ID.鬱屈] = 40;
    }
    return sources;
  },

  body: (c) => {
    // ERB 88: EXP:Ｖ経験 ++ (always; HETEROSEX 同性愛 EXP / 異常経験 deferred).
    c.t.state.EXP[EXP_ID.Ｖ経験] = (c.t.state.EXP[EXP_ID.Ｖ経験] ?? 0) + 1;
    // ERB 106: EXP:PLAYER:道具使用経験 ++
    c.master.state.EXP[EXP_ID.道具使用経験] =
      (c.master.state.EXP[EXP_ID.道具使用経験] ?? 0) + 1;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 对%CALLNAME:TARGET%使用了振动棒；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf44HandlerEntry: HandlerEntry = makeComfHandler(comf44Def);