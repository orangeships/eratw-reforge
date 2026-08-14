/**
 * Phase 7 — `COMF48 搾乳機` (milking machine), as a `ComfDef`.
 *
 * Ports the normal-mode core of `@COM48`
 * (`ERB/コマンド関連/COMF/COMF48 搾乳器.ERB`).
 *
 * Toys family sibling (道具系 40-49). Heaviest of the chest toys —
 * higher DOWNBASE + adds 苦痛 and large 屈従 / 反感. The only breast toy
 * with both 苦痛 and 屈従 in the source set on the initial press.
 *
 * **Faithful normal-mode core captured (ERB 28-51, the non-time-stop ELSE):**
 *   - DOWNBASE master 体力 +50 / 気力 +100 (ERB 35-36)
 *   - SOURCE 快Ｂ 200, 苦痛 100, 露出 30, 屈従 100, 逸脱 100, 反感 100
 *     (ERB 38-43)
 *   - +鬱屈 100 if the target has 自己愛<0 or 抵抗 (ERB 49-50)
 *   - EXP:PLAYER 道具使用経験 +1 (ERB 66)
 *
 * **DEFERRED (documented):**
 *   - The **time-stop branch** (`FLAG:70==1 && CFLAG:TARGET:344==0` → TSP
 *     -100, 快Ｂ 200, 苦痛 50) — time-stop isn't modeled in the playable
 *     slice.
 *   - **HETEROSEX 同性愛 EXP** (`EXP:(50+HETEROSEX(…))`, ERB 56-64) — needs
 *     the gender-pair helper.
 *   - **TEQUIP:搾乳機 toggle** (ERB 14) and the equipping DISPLAY label
 *     — persistent equipment state is not modeled at the def level.
 *   - H-scene action markers `TCVAR:116=PLAYER` (行為者),
 *     `TCVAR:PLAYER:108=1` (奉仕快楽フラグ) — mid-scene chaining state.
 *   - **ITEM:11 gate** (ERB 112), **TALENT:母乳体質==0** (ERB 115-116,
 *     milking requires lactation), **TEQUIP:16 乳頭夾使用中** (ERB 121),
 *     **TEQUIP:24 乳房電極** (ERB 124), **ABL:Ｂ感覚<=2 gate** (ERB 129),
 *     **TALENT:2 & 1 (女性)** (ERB 133), **TEQUIP:33 新妻PLAY** (ERB 144),
 *     and 室内 only (ERB 147) — gated by the COMABLE layer.
 *
 * **No outcome roll, no TIME** — factory pinned to 通常; timeCost 0.
 */
import type { ExecCheck, HandlerEntry } from "../../types.js";
import {
  ABL_ID,
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

// COM_ABLE48: TFLAG:100 → target present; TEQUIP:17 (already equipped)
// → allow to display so it can be unequipped; ITEM:11 owned; 母乳体質 == 0
// blocks; 上半身着衣 (TEQUIP:1 > 1 && TEQUIP:3 == 0); TEQUIP:16 乳頭夾使用中;
// ABL:Ｂ感覚 <= 2 blocks (non-time-stop); !(TALENT:2 & 1) 男性 blocks;
// TEQUIP:33 新妻PLAY blocks. TEQUIP:24 乳房電極, ASSIPLAY 技巧, TEQUIP:32
// 淋浴中, 室内限定 (INROOM) — deferred.
const com48Check: ExecCheck = (ctx) => {
  const target = ctx.state.charas[ctx.target];
  if (!target) return block("需要在场的对象。");
  if (!hasItem(ctx.state, 11) && !isEquipped(target, TEQUIP_ID.搾乳機)) {
    return block("需要搾乳器。");
  }
  if ((target.state.TALENT[TALENT_ID.母乳体質] ?? 0) === 0) {
    return block("对象没有母乳体质。");
  }
  if (
    readTequip(target, TEQUIP_ID.上半身着衣状況) > 1 &&
    readTequip(target, TEQUIP_ID.上半身裸露状態) === 0
  ) {
    return block("对象的上半身衣着妨碍了动作。");
  }
  if (isEquipped(target, TEQUIP_ID.乳頭夾)) {
    return block("乳頭夾使用中无法进行。");
  }
  if ((target.state.ABL[ABL_ID.Ｂ感覚] ?? 0) <= 2) {
    return block("对象的Ｂ感覚过低。");
  }
  if (((target.state.TALENT[TALENT_ID.性別] ?? 0) & 1) === 0) {
    return block("男性对象的身体条件不符。");
  }
  if (isEquipped(target, TEQUIP_ID.新妻PLAY)) {
    return block("新妻PLAY中无法进行。");
  }
  return { ok: true };
};

export const comf48Def: ComfDef = {
  commandNo: 48,
  label: "搾乳機",

  // Target-directed (the recipient). No outcome roll → pinned 通常.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  // H-scene actions don't advance the clock.
  timeCost: 0,

  // Slice C: 需要道具 11 + toggle TEQUIP 槽.
  requiresItem: 11,
  toggleTequip: TEQUIP_ID.搾乳機,

  // P1-14: H 命令菜单门控 — 持有 搾乳器 或 已装备; 需母乳体質+女性+Ｂ感覚>2;
  // 上半身着衣/乳頭夾/新妻PLAY 使用中 不可.
  hModeMenuCheck: com48Check,

  // ERB 35-36 (normal branch).
  downbase: { [BASE_ID.体力]: 50, [BASE_ID.気力]: 100 },

  buildSources: (c): Record<number, number> => {
    const sources: Record<number, number> = {
      [SOURCE_ID.快Ｂ]: 200, // ERB 38
      [SOURCE_ID.苦痛]: 100, // ERB 39
      [SOURCE_ID.露出]: 30, //  ERB 40
      [SOURCE_ID.屈従]: 100, // ERB 41
      [SOURCE_ID.逸脱]: 100, // ERB 42
      [SOURCE_ID.反感]: 100, // ERB 43
    };
    // ERB 49-50: coercion discomfort for 自己愛<0 / 抵抗 targets.
    if (c.tTalent(TALENT_ID.自己愛) < 0 || c.tTalent(TALENT_ID.抵抗)) {
      sources[SOURCE_ID.鬱屈] = 100;
    }
    return sources;
  },

  body: (c) => {
    // ERB 66: EXP:PLAYER:道具使用経験 ++ (HETEROSEX 同性愛 EXP deferred).
    c.master.state.EXP[EXP_ID.道具使用経験] =
      (c.master.state.EXP[EXP_ID.道具使用経験] ?? 0) + 1;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 对%CALLNAME:TARGET%使用了榨乳机；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf48HandlerEntry: HandlerEntry = makeComfHandler(comf48Def);