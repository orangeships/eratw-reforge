/**
 * Phase 7 — `COMF45 アナルバイブ` (anal vibrator), as a `ComfDef`.
 *
 * Ports the normal-mode core of `@COM45`
 * (`ERB/コマンド関連/COMF/COMF45 アナルバイブ.ERB`).
 *
 * Toys family sibling (道具系 40-49). Most aggressive of the toy inserts:
 * high 苦痛 + 反感 baseline (the only toy with explicit 屈従 source on
 * the initial press).
 *
 * **Faithful normal-mode core captured (ERB 34-56, the non-time-stop ELSE):**
 *   - DOWNBASE master 体力 +60 / 気力 +150 (ERB 41-42)
 *   - SOURCE 快Ａ 250, 苦痛 250, 露出 50, 屈従 50, 逸脱 50, 反感 200
 *     (ERB 44-49)
 *   - +鬱屈 70 if the target has 自己愛<0 or 抵抗 (ERB 54-55)
 *   - EXP:Ａ経験 +1 (ERB 69)
 *   - EXP:PLAYER 道具使用経験 +1 (ERB 81)
 *
 * **DEFERRED (documented):**
 *   - The **time-stop branch** (`FLAG:70==1 && CFLAG:TARGET:344==0` → TSP
 *     -150, 快Ａ 250, 苦痛 130) — time-stop isn't modeled in the playable
 *     slice.
 *   - **PAIN_CHECK_A(TARGET)** (ERB 58) — pre-settlement ABL/PALAM pain
 *     gating from `SOURCE_CHECK.ERB` is not yet modeled at the def level.
 *   - **STAIN:7 |= STAIN:4 / STAIN:4 |= STAIN:7** (ERB 63-64) — body-fluid
 *     stain propagation is not modeled.
 *   - **HETEROSEX 同性愛 EXP** (ERB 70-79) — needs the gender-pair helper.
 *   - **TEQUIP:肛用振動棒 toggle** (ERB 14) and the equipping DISPLAY label
 *     — persistent equipment state is not modeled at the def level.
 *   - H-scene action markers `TCVAR:TARGET:2=12` (Ａ責め),
 *     `TCVAR:TARGET:4=900` (強度), `TCVAR:116=PLAYER` (行為者),
 *     `TCVAR:Ａ喪失発生=1`, and the 扶她 `CSTR` append — mid-scene
 *     chaining state.
 *   - **ITEM:5 gate** (ERB 186) and TEQUIP conflict gates (浣腸 TEQUIP:21,
 *     後庭拉珠 TEQUIP:15, バルーン TEQUIP:22, 電極 TEQUIP:23) — gated by
 *     the COMABLE layer.
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

// COM_ABLE45: TFLAG:100 → target present; TEQUIP:14 (already equipped)
// → allow to display so it can be unequipped; ITEM:5 owned; TEQUIP:0 & 4
// 下半身着衣; TEQUIP:15 後庭拉珠使用中 conflicts. TALENT:196 毒人形,
// ASSIPLAY 潤滑, TEQUIP:21 浣腸 / 22 バルーン / 23 電極 — deferred.
const com45Check: ExecCheck = (ctx) => {
  const target = ctx.state.charas[ctx.target];
  if (!target) return block("需要在场的对象。");
  if (!hasItem(ctx.state, 5) && !isEquipped(target, TEQUIP_ID.肛用振動棒)) {
    return block("需要アナルバイブ。");
  }
  if (readTequip(target, TEQUIP_ID.下半身着衣状況) & 4) {
    return block("对象的下半身衣着妨碍了动作。");
  }
  if (isEquipped(target, TEQUIP_ID.後庭拉珠)) {
    return block("后庭拉珠使用中无法进行。");
  }
  return { ok: true };
};

export const comf45Def: ComfDef = {
  commandNo: 45,
  label: "アナルバイブ",

  // Target-directed (the recipient). No outcome roll → pinned 通常.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  // H-scene actions don't advance the clock.
  timeCost: 0,

  // Slice C: 需要道具 5 + toggle TEQUIP 槽.
  requiresItem: 5,
  toggleTequip: TEQUIP_ID.肛用振動棒,

  // P1-14: H 命令菜单门控 — 持有 肛用振動棒 或 已装备; 下半身着衣&4 或
  // 後庭拉珠使用中 不可.
  hModeMenuCheck: com45Check,

  // ERB 41-42 (normal branch).
  downbase: { [BASE_ID.体力]: 60, [BASE_ID.気力]: 150 },

  buildSources: (c): Record<number, number> => {
    const sources: Record<number, number> = {
      [SOURCE_ID.快Ａ]: 250, // ERB 44
      [SOURCE_ID.苦痛]: 250, // ERB 45
      [SOURCE_ID.露出]: 50, //  ERB 46
      [SOURCE_ID.屈従]: 50, //  ERB 47
      [SOURCE_ID.逸脱]: 50, //  ERB 48
      [SOURCE_ID.反感]: 200, // ERB 49
    };
    // ERB 54-55: coercion discomfort for 自己愛<0 / 抵抗 targets.
    if (c.tTalent(TALENT_ID.自己愛) < 0 || c.tTalent(TALENT_ID.抵抗)) {
      sources[SOURCE_ID.鬱屈] = 70;
    }
    return sources;
  },

  body: (c) => {
    // ERB 69: EXP:Ａ経験 ++ (HETEROSEX 同性愛 EXP deferred).
    c.t.state.EXP[EXP_ID.Ａ経験] = (c.t.state.EXP[EXP_ID.Ａ経験] ?? 0) + 1;
    // ERB 81: EXP:PLAYER:道具使用経験 ++
    c.master.state.EXP[EXP_ID.道具使用経験] =
      (c.master.state.EXP[EXP_ID.道具使用経験] ?? 0) + 1;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 对%CALLNAME:TARGET%使用了肛门振动棒；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf45HandlerEntry: HandlerEntry = makeComfHandler(comf45Def);