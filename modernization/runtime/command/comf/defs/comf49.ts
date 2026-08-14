/**
 * Phase 7 — `COMF49 乳首ロータ` (nipple rotor), as a `ComfDef`.
 *
 * Ports the normal-mode core of `@COM49`
 * (`ERB/コマンド関連/COMF/COMF49 乳首ローター.ERB`).
 *
 * Toys family sibling (道具系 40-49). The breast sibling of COMF40
 * ローター — no TEQUIP toggle (this one is a one-shot toy), higher
 * 快Ｂ value (250 vs 200).
 *
 * **Faithful normal-mode core captured (ERB 23-42, the non-time-stop ELSE):**
 *   - DOWNBASE master 体力 +10 / 気力 +80 (ERB 29-30)
 *   - SOURCE 快Ｂ 250, 露出 20, 逸脱 30, 反感 30 (ERB 32-35)
 *   - +鬱屈 30 if the target has 自己愛<0 or 抵抗 (ERB 40-41)
 *   - EXP:PLAYER 道具使用経験 +1 (ERB 57)
 *
 * **DEFERRED (documented):**
 *   - The **time-stop branch** (`FLAG:70==1 && CFLAG:TARGET:344==0` → TSP
 *     -80, only 快Ｂ 250) — time-stop isn't modeled in the playable slice.
 *   - **HETEROSEX 同性愛 EXP** (`EXP:(50+HETEROSEX(…))`, ERB 47-55) — needs
 *     the gender-pair helper.
 *   - H-scene action markers `TCVAR:116=PLAYER` (行為者),
 *     `TCVAR:PLAYER:108=1` (奉仕快楽フラグ) — mid-scene chaining state.
 *   - The `STR:0 = "乳頭跳蛋"` label write (ERB 10) — output-string
 *     override for the command name; not part of the settlement.
 *   - **ITEM:0 gate** (ERB 73), **TEQUIP:1 & 2 / TEQUIP:3** 上半身着衣
 *     (ERB 76), **TEQUIP:17 搾乳器使用中** (ERB 79),
 *     **TEQUIP:24 乳房電極** (ERB 82) — gated by the COMABLE layer.
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

// COM_ABLE49: TFLAG:100 → target present; ITEM:0 owned; 上半身着衣
// ((TEQUIP:1 & 2) && TEQUIP:3 == 0 — はだけ不可且未露出); TEQUIP:17 搾乳機
// 使用中 blocks. TEQUIP:24 乳房電極 — deferred.
const com49Check: ExecCheck = (ctx) => {
  const target = ctx.state.charas[ctx.target];
  if (!target) return block("需要在场的对象。");
  if (!hasItem(ctx.state, 0)) return block("需要乳首ローター。");
  if (
    (readTequip(target, TEQUIP_ID.上半身着衣状況) & 2) !== 0 &&
    readTequip(target, TEQUIP_ID.上半身裸露状態) === 0
  ) {
    return block("对象的上半身衣着妨碍了动作。");
  }
  if (isEquipped(target, TEQUIP_ID.搾乳機)) {
    return block("搾乳器使用中无法进行。");
  }
  return { ok: true };
};

export const comf49Def: ComfDef = {
  commandNo: 49,
  label: "乳首ロータ",

  // Target-directed (the recipient). No outcome roll → pinned 通常.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  // H-scene actions don't advance the clock.
  timeCost: 0,

  // Slice C: 需要道具 0.
  requiresItem: 0,

  // P1-14: H 命令菜单门控 — 持有 跳蛋(0); 上半身着衣 或 搾乳器使用中 不可.
  hModeMenuCheck: com49Check,

  // ERB 29-30 (normal branch).
  downbase: { [BASE_ID.体力]: 10, [BASE_ID.気力]: 80 },

  buildSources: (c): Record<number, number> => {
    const sources: Record<number, number> = {
      [SOURCE_ID.快Ｂ]: 250, // ERB 32
      [SOURCE_ID.露出]: 20, //  ERB 33
      [SOURCE_ID.逸脱]: 30, //  ERB 34
      [SOURCE_ID.反感]: 30, //  ERB 35
    };
    // ERB 40-41: coercion discomfort for 自己愛<0 / 抵抗 targets.
    if (c.tTalent(TALENT_ID.自己愛) < 0 || c.tTalent(TALENT_ID.抵抗)) {
      sources[SOURCE_ID.鬱屈] = 30;
    }
    return sources;
  },

  body: (c) => {
    // ERB 57: EXP:PLAYER:道具使用経験 ++ (HETEROSEX 同性愛 EXP deferred).
    c.master.state.EXP[EXP_ID.道具使用経験] =
      (c.master.state.EXP[EXP_ID.道具使用経験] ?? 0) + 1;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 对%CALLNAME:TARGET%使用了乳头跳蛋；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf49HandlerEntry: HandlerEntry = makeComfHandler(comf49Def);