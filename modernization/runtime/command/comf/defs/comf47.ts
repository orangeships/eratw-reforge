/**
 * Phase 7 — `COMF47 ニプルキャップ` (nipple cap), as a `ComfDef`.
 *
 * Ports the normal-mode core of `@COM47`
 * (`ERB/コマンド関連/COMF/COMF47 ニプルキャップ.ERB`).
 *
 * Toys family sibling (道具系 40-49). The nipple sibling of COMF42
 * クリキャップ — same downbase + same SOURCE structure, just 快Ｂ 200
 * instead of 快Ｃ 200.
 *
 * **Faithful normal-mode core captured (ERB 28-49, the non-time-stop ELSE):**
 *   - DOWNBASE master 体力 +10 / 気力 +80 (ERB 34-35)
 *   - SOURCE 快Ｂ 200, 露出 20, 逸脱 30, 反感 30 (ERB 37-40)
 *   - +鬱屈 30 if the target has 自己愛<0 or 抵抗 (ERB 47-48)
 *   - EXP:PLAYER 道具使用経験 +1 (ERB 64)
 *
 * **DEFERRED (documented):**
 *   - The **time-stop branch** (`FLAG:70==1 && CFLAG:TARGET:344==0` → TSP
 *     -80, only 快Ｂ 200) — time-stop isn't modeled in the playable slice.
 *   - **HETEROSEX 同性愛 EXP** (`EXP:(50+HETEROSEX(…))`, ERB 54-62) — needs
 *     the gender-pair helper.
 *   - **TEQUIP:乳頭夾 toggle** (ERB 14) and the equipping DISPLAY label
 *     — persistent equipment state is not modeled at the def level.
 *   - H-scene action markers `TCVAR:116=PLAYER` (行為者),
 *     `TCVAR:PLAYER:108=1` (奉仕快楽フラグ) — mid-scene chaining state.
 *   - **ITEM:10 gate** (ERB 108), **TEQUIP:1 / TEQUIP:3** 上半身着衣
 *     (ERB 111), **TEQUIP:17 搾乳器使用中** (ERB 114),
 *     **TEQUIP:24 乳房電極** (ERB 117), and **TEQUIP:32 シャワー中**
 *     (ERB 125) — gated by the COMABLE layer.
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

// COM_ABLE47: TFLAG:100 → target present; TEQUIP:16 (already equipped)
// → allow to display so it can be unequipped; ITEM:10 owned; 上半身着衣
// (TEQUIP:1 > 1 && TEQUIP:3 == 0); TEQUIP:17 搾乳機使用中 blocks.
// TEQUIP:24 乳房電極, ASSIPLAY 技巧, TEQUIP:32 淋浴中 — deferred.
const com47Check: ExecCheck = (ctx) => {
  const target = ctx.state.charas[ctx.target];
  if (!target) return block("需要在场的对象。");
  if (!hasItem(ctx.state, 10) && !isEquipped(target, TEQUIP_ID.乳頭夾)) {
    return block("需要ニプルキャップ。");
  }
  if (
    readTequip(target, TEQUIP_ID.上半身着衣状況) > 1 &&
    readTequip(target, TEQUIP_ID.上半身裸露状態) === 0
  ) {
    return block("对象的上半身衣着妨碍了动作。");
  }
  if (isEquipped(target, TEQUIP_ID.搾乳機)) {
    return block("搾乳器使用中无法进行。");
  }
  return { ok: true };
};

export const comf47Def: ComfDef = {
  commandNo: 47,
  label: "ニプルキャップ",

  // Target-directed (the recipient). No outcome roll → pinned 通常.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  // H-scene actions don't advance the clock.
  timeCost: 0,

  // Slice C: 需要道具 10 + toggle TEQUIP 槽.
  requiresItem: 10,
  toggleTequip: TEQUIP_ID.乳頭夾,

  // P1-14: H 命令菜单门控 — 持有 乳頭夾 或 已装备; 上半身着衣 或 搾乳器使用中 不可.
  hModeMenuCheck: com47Check,

  // ERB 34-35 (normal branch).
  downbase: { [BASE_ID.体力]: 10, [BASE_ID.気力]: 80 },

  buildSources: (c): Record<number, number> => {
    const sources: Record<number, number> = {
      [SOURCE_ID.快Ｂ]: 200, // ERB 37
      [SOURCE_ID.露出]: 20, //  ERB 38
      [SOURCE_ID.逸脱]: 30, //  ERB 39
      [SOURCE_ID.反感]: 30, //  ERB 40
    };
    // ERB 47-48: coercion discomfort for 自己愛<0 / 抵抗 targets.
    if (c.tTalent(TALENT_ID.自己愛) < 0 || c.tTalent(TALENT_ID.抵抗)) {
      sources[SOURCE_ID.鬱屈] = 30;
    }
    return sources;
  },

  body: (c) => {
    // ERB 64: EXP:PLAYER:道具使用経験 ++ (HETEROSEX 同性愛 EXP deferred).
    c.master.state.EXP[EXP_ID.道具使用経験] =
      (c.master.state.EXP[EXP_ID.道具使用経験] ?? 0) + 1;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 给%CALLNAME:TARGET%戴上了乳头夹；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf47HandlerEntry: HandlerEntry = makeComfHandler(comf47Def);