/**
 * Phase 7 (Wave 4i) — COMF233 五重绝顶魔法 (five-fold orgasm magic).
 *
 * A DLC-gated magic command. `@COM_ABLE233` gates on the global
 * `Five_Orgasm_Magic != 0` (DLC toggle: 1 正常 / 2 EX / 3 EX-PANI), so a
 * non-DLC trial never reaches it — execCheck faithfully blocks when the
 * toggle is 0 (the sentinel `FLAG_ID.五重绝顶魔法` in `flagStore`).
 *
 * Faithful core (`@COM233` body):
 *   - 接吻 gate: a complex STAIN/MASTER_POSE/既成事實&合意_接吻 ladder → 接吻=0/1.
 *     In a clean trial (no キス経験 on either side) 接吻=0; the kiss arms are
 *     modeled as a no-op branch (deferred: STAIN/MASTER_POSE/合意_接吻).
 *   - TFLAG:破瓜抑制=1; TCVAR:116=PLAYER 行為者; TCVAR:PLAYER:108=1 奉仕フラグ;
 *     TCVAR:TARGET:2=3 (手淫); TCVAR:TARGET:4=1500.
 *   - Time-stop branch (FLAG:70 && CFLAG:344==0): TSP-20; SOURCE:快Ｃ=40+指*4,
 *     快Ｂ=40+指*4, 器用な指 ×1.50; 接吻 arm (deferred); 猫舌→嗜虐快楽経験+1;
 *     EXP:手淫経験++.
 *   - Normal branch: DOWNBASE 体力10/気力40 (bare=TARGET) + DOWNBASE:MASTER
 *     体力20/気力20; SOURCE:快Ｃ=40+指*4, 快Ｂ=40+指*4, 情愛50/性行動60/露出20/
 *     不潔30/逸脱20/反感20; 器用な指×1.50 (快Ｃ/快Ｂ); 舌使い×1.50 (情愛);
 *     鬱屈+20 if 自己愛<0||抵抗; 接吻 arms (deferred → 不潔=0, 情愛/=4, 液体/=2);
 *     猫舌→嗜虐快楽経験+1; EXP:手淫経験++.
 *   - **The magic override** (the point of the command): after the above,
 *     `SOURCE:快Ｃ/快Ｂ/快Ｍ/快Ａ/快Ｖ = MAX(FLAG:魔法强度, 1000)`; if
 *     `Five_Orgasm_Magic == 3` (and MARK:苦痛刻印 != 3) → `SOURCE:苦痛 =
 *     MAX(FLAG:魔法强度, 1000)`; if `FLAG:魔法印记开关` → `SOURCE:魔力印记 = 1`.
 *   - RETURN 1.
 *
 * **DEFERRED** (faithfully recorded): the 接吻 ladder (STAIN/MASTER_POSE/
 * 合意_接吻); HETEROSEX EXP (`EXP:(50+HETEROSEX)` += 5); ADD_EXP_LESNIAN(5);
 * STAIN transfer; MARK:苦痛刻印 (not modeled → the 苦痛 arm fires whenever
 * Five_Orgasm_Magic==3, treating MARK as 0 != 3); the full @COM_ABLE gate
 * stack (TFLAG:100/GLOBAL_COMABLE/!TARGET) beyond the DLC-toggle gate;
 * the MAGIC_OPTION FLAT seeding of FLAG:魔法强度.
 */

import type { GameState, CharaSlot } from "../../state/game-state.js";
import type { CommandContext, HandlerEntry } from "../types.js";
import { cloneGameState } from "../../state/game-state.js";
import { applySourceCheck, settleSourcePalam } from "../source-check.js";
import {
  ABL_ID,
  BASE_ID,
  EXP_ID,
  FLAG_ID,
  SOURCE_ID,
  TALENT_ID,
  TCVAR_ID,
  getMasterBase,
  setMasterBase,
  times,
} from "../../state/settlement.js";
import { TFLAG_ID, setTflag } from "../../state/tflag.js";

const PLAYER = 0;

function abl(slot: CharaSlot, id: number): number {
  return slot.state.ABL[id] ?? 0;
}
function talent(slot: CharaSlot, id: number): number {
  return slot.state.TALENT[id] ?? 0;
}

export const comf233HandlerEntry: HandlerEntry = {
  commandNo: 233,
  execCheck: (ctx: CommandContext) => {
    // DLC toggle gate: Five_Orgasm_Magic == 0 → not executable.
    const magic = ctx.state.flagStore[FLAG_ID.五重绝顶魔法] ?? 0;
    if (magic === 0) {
      return { ok: false, reason: { kind: "precondition", message: "五重绝顶魔法 DLC 未开启" } };
    }
    if (!ctx.state.charas[ctx.target]) {
      return { ok: false, reason: { kind: "precondition", message: "no target" } };
    }
    return { ok: true };
  },
  handler: (ctx: CommandContext) => {
    const next: GameState = cloneGameState(ctx.state);
    const target = next.charas[ctx.target]!;
    const master = next.master;
    const magic = next.flagStore[FLAG_ID.五重绝顶魔法] ?? 0;
    const magicPower = next.flagStore[FLAG_ID.魔法强度] ?? 0;
    const floor = Math.max(magicPower, 1000);

    // 接吻 gate — clean trial (no キス経験 either side) → 0. Defer the full ladder.
    // const kiss = 0; (deferred — kiss arms below are the no-op branch)

    // COM別FLAG.
    setTflag(next, TFLAG_ID.破瓜抑制FLAG, 1);
    target.state.TCVAR[TCVAR_ID.行為者] = PLAYER;
    master.state.TCVAR[TCVAR_ID.奉仕フラグ] = 1;
    target.state.TCVAR[TCVAR_ID.射精箇所] = 3; // 手淫
    target.state.TCVAR[TCVAR_ID.射精快感強度] = 1500;

    const timeStop = (next.flagStore[FLAG_ID.時間停止] ?? 0) !== 0;
    const finger = abl(master, ABL_ID.指);
    const deftFingers = talent(master, TALENT_ID.器用な指) !== 0;
    const catTongue = talent(master, TALENT_ID.猫舌) !== 0;

    // Master 快Ｃ/快Ｂ SOURCE (settleSourcePalam master-as-target).
    let masterPleasure: Record<number, number> = {};

    // Target SOURCE set.
    let sources: Record<number, number> = {};

    if (timeStop) {
      setMasterBase(next, BASE_ID.TSP, (getMasterBase(next, BASE_ID.TSP) ?? 0) - 20);
      sources[SOURCE_ID.快Ｃ] = 40 + finger * 4;
      sources[SOURCE_ID.快Ｂ] = 40 + finger * 4;
      if (deftFingers) {
        sources[SOURCE_ID.快Ｃ] = times(sources[SOURCE_ID.快Ｃ]!, 1.5);
        sources[SOURCE_ID.快Ｂ] = times(sources[SOURCE_ID.快Ｂ]!, 1.5);
      }
      // 接吻 arm deferred (kiss=0).
      if (catTongue) {
        master.state.EXP[EXP_ID.嗜虐快楽経験] = (master.state.EXP[EXP_ID.嗜虐快楽経験] ?? 0) + 1;
      }
      master.state.EXP[EXP_ID.手淫経験] = (master.state.EXP[EXP_ID.手淫経験] ?? 0) + 1;
    } else {
      // DOWNBASE: bare (TARGET) 体力10/気力40 + MASTER 体力20/気力20.
      target.state.BASE[BASE_ID.体力] = (target.state.BASE[BASE_ID.体力] ?? 0) - 10;
      target.state.BASE[BASE_ID.気力] = (target.state.BASE[BASE_ID.気力] ?? 0) - 40;
      setMasterBase(next, BASE_ID.体力, (getMasterBase(next, BASE_ID.体力) ?? 0) - 20);
      setMasterBase(next, BASE_ID.気力, (getMasterBase(next, BASE_ID.気力) ?? 0) - 20);

      sources[SOURCE_ID.快Ｃ] = 40 + finger * 4;
      sources[SOURCE_ID.快Ｂ] = 40 + finger * 4;
      sources[SOURCE_ID.情愛] = 50;
      sources[SOURCE_ID.性行動] = 60;
      sources[SOURCE_ID.露出] = 20;
      sources[SOURCE_ID.不潔] = 30;
      sources[SOURCE_ID.逸脱] = 20;
      sources[SOURCE_ID.反感] = 20;

      if (deftFingers) {
        sources[SOURCE_ID.快Ｃ] = times(sources[SOURCE_ID.快Ｃ]!, 1.5);
        sources[SOURCE_ID.快Ｂ] = times(sources[SOURCE_ID.快Ｂ]!, 1.5);
      }
      if (talent(master, TALENT_ID.舌使い) !== 0) {
        sources[SOURCE_ID.情愛] = times(sources[SOURCE_ID.情愛]!, 1.5);
      }
      if (talent(target, TALENT_ID.自己愛) < 0 || talent(target, TALENT_ID.抵抗) !== 0) {
        sources[SOURCE_ID.鬱屈] = (sources[SOURCE_ID.鬱屈] ?? 0) + 20;
      }
      // !接吻 branch: 不潔=0, 情愛/=4, 液体/=2 (deferred 液体=0 → stays 0).
      sources[SOURCE_ID.不潔] = 0;
      sources[SOURCE_ID.情愛] = Math.trunc(sources[SOURCE_ID.情愛]! / 4);
      // ADD_EXP_LESNIAN(5) deferred.
      if (catTongue) {
        master.state.EXP[EXP_ID.嗜虐快楽経験] = (master.state.EXP[EXP_ID.嗜虐快楽経験] ?? 0) + 1;
      }
      master.state.EXP[EXP_ID.手淫経験] = (master.state.EXP[EXP_ID.手淫経験] ?? 0) + 1;
    }

    // ----- The magic override (the point of the command) -----
    sources[SOURCE_ID.快Ｃ] = floor;
    sources[SOURCE_ID.快Ｂ] = floor;
    sources[SOURCE_ID.快Ｍ] = floor;
    sources[SOURCE_ID.快Ａ] = floor;
    sources[SOURCE_ID.快Ｖ] = floor;
    // EX-PANI mode (Five_Orgasm_Magic==3): add 苦痛 (MARK:苦痛刻印 != 3; MARK
    // not modeled → treat as 0 != 3 → fires).
    if (magic === 3) {
      sources[SOURCE_ID.苦痛] = floor;
    }
    // 魔力印记.
    if ((next.flagStore[FLAG_ID.魔法印记开关] ?? 0) !== 0) {
      sources[SOURCE_ID.魔力印记] = 1;
    }

    // No TIME advance in @COM233 (it PRINTs + WAIT; no TIME +=). RETURN 1.
    settleSourcePalam(next, master, master, masterPleasure);
    const settled = applySourceCheck(next, ctx.target, sources, 0);

    return {
      state: next,
      events: [
        { kind: "NARRATION" as const, timestamp: ctx.now(),
          text: `对 %CALLNAME:TARGET% 施加了五重绝顶魔法，全身都被快感淹没，无法反抗……好感度 ${settled.favorDelta >= 0 ? "+" : ""}${settled.favorDelta}。` },
        ...settled.events,
      ],
      outcome: "ok" as const,
    };
  },
};
