/**
 * Phase 7 — `COMF43 オナホール` (onahole), as a `ComfDef`.
 *
 * Ports the normal-mode core of `@COM43`
 * (`ERB/コマンド関連/COMF/COMF43 オナホール.ERB`).
 *
 * Toys family sibling (道具系 40-49). Note: COMF43 is the male-target
 * variant of the toys family — it is gated by `HAS_PENIS(TARGET)` in
 * `COM_ABLE43`. The 快感 type stays 快Ｃ (the ERB writes to SOURCE:快Ｃ
 * even though the target's penis receives the stimulation; this is
 * eraTW's existing labeling and we faithfully reproduce it).
 *
 * **Faithful normal-mode core captured (ERB 35-56, the non-time-stop ELSE):**
 *   - DOWNBASE master 体力 +10 / 気力 +80 (ERB 41-42)
 *   - SOURCE 快Ｃ 200, 露出 20, 逸脱 30, 反感 30 (ERB 44-47)
 *   - +鬱屈 30 if the target has 自己愛<0 or 抵抗 (ERB 54-55)
 *   - EXP:PLAYER 道具使用経験 +1 (ERB 71)
 *
 * **DEFERRED (documented):**
 *   - The **time-stop branch** (`FLAG:70==1 && CFLAG:TARGET:344==0` → TSP
 *     -80, only 快Ｃ 200) — time-stop isn't modeled in the playable slice.
 *   - **HETEROSEX 同性愛 EXP** (`EXP:(50+HETEROSEX(…))`, ERB 61-69) — needs
 *     the gender-pair helper.
 *   - **TEQUIP:飛機杯 toggle** (ERB 14, `TEQUIP:飛機杯 = !TEQUIP:飛機杯`)
 *     and the equipping/disequipping DISPLAY label — persistent equipment
 *     state is not modeled at the def level (see EQUIP_COM43 below).
 *   - H-scene action markers `TCVAR:TARGET:2=10` (射精部位=道具),
 *     `TCVAR:TARGET:4=1000` (強度), `TCVAR:116=PLAYER` (行為者), and the
 *     扶她 `CSTR` append — mid-scene chaining state.
 *   - **ITEM:3 gate** (ERB 127, 道具を持っているか) — ITEM inventory not
 *     modeled in the runtime yet.
 *   - **HAS_PENIS(TARGET) gate** (ERB 130) and **TEQUIP:33 新妻PLAY**
 *     (ERB 142) — gated by the COMABLE layer, not the def.
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

// COM_ABLE43: TFLAG:100 → target present; TEQUIP:12 (already equipped)
// → allow to display so it can be unequipped; ITEM:3 owned; target must
// have a penis (男/扶她); TEQUIP:0 > 1 下半身着衣; TEQUIP:33 新妻PLAY
// blocks. ASSIPLAY 技巧 — deferred.
const com43Check: ExecCheck = (ctx) => {
  const target = ctx.state.charas[ctx.target];
  if (!target) return block("需要在场的对象。");
  if (!hasItem(ctx.state, 3) && !isEquipped(target, TEQUIP_ID.飛機杯)) {
    return block("需要オナホール。");
  }
  if (((target.state.TALENT[TALENT_ID.性別] ?? 0) & 2) === 0) {
    return block("对象没有男性性征。");
  }
  if (readTequip(target, TEQUIP_ID.下半身着衣状況) > 1) {
    return block("对象的下半身衣着妨碍了动作。");
  }
  if (isEquipped(target, TEQUIP_ID.新妻PLAY)) {
    return block("新妻PLAY中无法进行。");
  }
  return { ok: true };
};

export const comf43Def: ComfDef = {
  commandNo: 43,
  label: "オナホール",

  // Target-directed (the recipient). No outcome roll → pinned 通常.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  // H-scene actions don't advance the clock.
  timeCost: 0,

  // Slice C: 需要道具 3 + toggle TEQUIP 槽.
  requiresItem: 3,
  toggleTequip: TEQUIP_ID.飛機杯,

  // P1-14: H 命令菜单门控 — 持有 飛機杯 或 已装备; 需男性性征; 下半身着衣>1 或
  // 新妻PLAY 不可.
  hModeMenuCheck: com43Check,

  // ERB 41-42 (normal branch).
  downbase: { [BASE_ID.体力]: 10, [BASE_ID.気力]: 80 },

  buildSources: (c): Record<number, number> => {
    const sources: Record<number, number> = {
      [SOURCE_ID.快Ｃ]: 200, // ERB 44
      [SOURCE_ID.露出]: 20, //  ERB 45
      [SOURCE_ID.逸脱]: 30, //  ERB 46
      [SOURCE_ID.反感]: 30, //  ERB 47
    };
    // ERB 54-55: coercion discomfort for 自己愛<0 / 抵抗 targets.
    if (c.tTalent(TALENT_ID.自己愛) < 0 || c.tTalent(TALENT_ID.抵抗)) {
      sources[SOURCE_ID.鬱屈] = 30;
    }
    return sources;
  },

  body: (c) => {
    // ERB 71: EXP:PLAYER:道具使用経験 ++ (HETEROSEX 同性愛 EXP deferred).
    c.master.state.EXP[EXP_ID.道具使用経験] =
      (c.master.state.EXP[EXP_ID.道具使用経験] ?? 0) + 1;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 对%CALLNAME:TARGET%使用了飞机杯；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf43HandlerEntry: HandlerEntry = makeComfHandler(comf43Def);