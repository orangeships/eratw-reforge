/**
 * Phase 7 — `COMF42 クリキャップ` (clit cap), as a `ComfDef`.
 *
 * Ports the normal-mode core of `@COM42`
 * (`ERB/コマンド関連/COMF/COMF42 クリキャップ.ERB`).
 *
 * Toys family sibling (道具系 40-49). Differs from COMF40 only in the
 * 快感 value (快Ｃ 200 vs ローター 250) and the 反感/逸脱 ratios.
 *
 * **Faithful normal-mode core captured (ERB 28-49, the non-time-stop ELSE):**
 *   - DOWNBASE master 体力 +10 / 気力 +80 (ERB 34-35)
 *   - SOURCE 快Ｃ 200, 露出 20, 逸脱 30, 反感 30 (ERB 37-40)
 *   - +鬱屈 30 if the target has 自己愛<0 or 抵抗 (ERB 47-48)
 *   - EXP:PLAYER 道具使用経験 +1 (ERB 64)
 *
 * **DEFERRED (documented):**
 *   - The **time-stop branch** (`FLAG:70==1 && CFLAG:TARGET:344==0` → TSP
 *     -80, only 快Ｃ 200) — time-stop isn't modeled in the playable slice.
 *   - **HETEROSEX 同性愛 EXP** (`EXP:(50+HETEROSEX(…))`, ERB 54-62) — needs
 *     the gender-pair helper.
 *   - **TEQUIP:陰蒂夾 toggle** (ERB 14, `TEQUIP:陰蒂夾 = !TEQUIP:陰蒂夾`) —
 *     implemented via the Slice C `toggleTequip` field below (writes
 *     `state.TEQUIP[11]`, per-chara equipment namespace). The equipping/
 *     disequipping DISPLAY label ("＜阴蒂夹装备中＞" / `TRAINNAME:42+"解除"`)
 *     is not modeled at the def level. The @EQUIP_COM42 per-turn sustained
 *     source (快Ｃ +100) is modeled by the `TEQUIP_CONTINUOUS` table in
 *     `source-check.ts`.
 *   - H-scene action markers `TCVAR:116=PLAYER` (行為者),
 *     `TCVAR:PLAYER:108=1` (奉仕快楽フラグ) — mid-scene chaining state.
 *   - **ITEM:2 gate** (ERB 115, 道具を持っているか) — ITEM inventory not
 *     modeled in the runtime yet.
 *   - **HAS_PENIS(TARGET) gate** (ERB 122) and **TEQUIP:32 シャワー中**
 *     (ERB 130) — gated by the COMABLE layer, not the def.
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

// COM_ABLE42: TFLAG:100 → target present; TEQUIP:11 (already equipped)
// → allow to display so it can be unequipped; ITEM:2 owned; TEQUIP:0 > 1
// 下半身着衣; HAS_PENIS (男/扶她) blocks. TALENT:196 毒人形, ASSIPLAY 技巧,
// TEQUIP:32 淋浴中 — deferred.
const com42Check: ExecCheck = (ctx) => {
  const target = ctx.state.charas[ctx.target];
  if (!target) return block("需要在场的对象。");
  if (!hasItem(ctx.state, 2) && !isEquipped(target, TEQUIP_ID.陰蒂夾)) {
    return block("需要クリキャップ。");
  }
  if (readTequip(target, TEQUIP_ID.下半身着衣状況) > 1) {
    return block("对象的下半身衣着妨碍了动作。");
  }
  if ((target.state.TALENT[TALENT_ID.性別] ?? 0) & 2) {
    return block("男性或扶她的身体条件不符。");
  }
  return { ok: true };
};

export const comf42Def: ComfDef = {
  commandNo: 42,
  label: "クリキャップ",

  // Slice C: 需要 阴蒂夹 (ITEM 2) + toggle TEQUIP 陰蒂夾 (11).
  requiresItem: 2,
  toggleTequip: TEQUIP_ID.陰蒂夾,

  // P1-14: H 命令菜单门控 — 持有 阴蒂夹 或 已装备; 下半身着衣>1 或 男/扶她 不可.
  hModeMenuCheck: com42Check,

  // Target-directed (the recipient). No outcome roll → pinned 通常.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  // H-scene actions don't advance the clock.
  timeCost: 0,

  // ERB 34-35 (normal branch).
  downbase: { [BASE_ID.体力]: 10, [BASE_ID.気力]: 80 },

  buildSources: (c): Record<number, number> => {
    const sources: Record<number, number> = {
      [SOURCE_ID.快Ｃ]: 200, // ERB 37
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
    `%CALLNAME:MASTER% 给%CALLNAME:TARGET%戴上了阴蒂帽；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf42HandlerEntry: HandlerEntry = makeComfHandler(comf42Def);