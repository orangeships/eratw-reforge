/**
 * Phase 7 (Wave 4c) — `COMF79 小人オナホ` (dwarf onahole), as a `ComfDef`.
 *
 * Ports the **normal-mode (ELSE) core** of `@COM79`
 * (`ERB/コマンド関連/COMF/COMF79 小人オナホ.ERB`). A 小人体型 target used as a
 * masturbation sleeve: master gets 快Ｃ, target gets 快Ｖ + heavy
 * 苦痛/恐怖/屈従, amplified for virgins and inexperienced anatomy.
 *
 * **Faithful normal-mode core (ERB ELSE branch, pinned 通常 → TFLAG:193 = 0):**
 *   - DOWNBASE master 体力 20 / 気力 40 (PLAYER); target 体力 250 / 気力 200.
 *   - SOURCE:PLAYER:快Ｃ = 50 (+ experience bump below).
 *   - SOURCE target: 快Ｖ 50, 情愛 100, 苦痛 1200, 露出 50 (TFLAG:193 → 300,
 *     deferred to 0 → 50), 性行動 250, 反感 900, 逸脱 900, 屈従 1800, 恐怖 1600,
 *     不潔 = Y×10 + 60 (Y STAIN deferred → 60).
 *   - 拡張/受虐 bump: Ｖ拡張経験 > 50 && 受虐属性 > 3 → 快Ｖ +600, PLAYER:快Ｃ
 *     +500; elif Ｖ拡張経験 > 25 && 受虐属性 > 1 → 快Ｖ +300, PLAYER:快Ｃ +250.
 *   - 処女 arm: 処女==1 → 苦痛 +2000, 反感 +3000; 処女==2 → 苦痛 +1000,
 *     反感 +2000 (反感 add gated on !time-stop → applies in normal mode).
 *   - EXP: PLAYER 挿入経験 ++; target Ｖ性交経験 ++, Ｖ拡張経験 ++.
 *
 * **DEFERRED:** time-stop branch; 恶作剧/睡眠姦/時姦 EXP arms; STAIN (Y → 60);
 * HETEROSEX EXP; TFLAG:193 outcome 露出 bump (pinned 通常 → 50); COMABLE gate.
 *
 * **No outcome roll, no TIME** — pinned 通常; timeCost 0.
 */

import type { ExecCheck, HandlerEntry } from "../../types.js";
import {
  ABL_ID,
  BASE_ID,
  EXP_ID,
  SOURCE_ID,
  TALENT_ID,
  TEQUIP_ID,
} from "../../../state/settlement.js";
import { makeComfHandler } from "../make-comf-handler.js";
import type { ComfDef } from "../comf-def.js";
import { stainSwapInsertV } from "../../../state/stain.js";
import { isEquipped, readTequip } from "../../../state/tequip.js";

const block = (message: string): { ok: false; reason: { kind: "precondition"; message: string } } => ({
  ok: false,
  reason: { kind: "precondition", message },
});

/**
 * @COM_ABLE79 可用性判定（忠实核心）。deferred: 禁断的知識(TALENT:144) master 需求门、
 * 挿入不可(TARGET)!=3、処女+PALAM:潤滑、ASSIPLAY、时停跳过(TFLAG:100/GLOBAL_COMABLE)。
 */
const com79Check: ExecCheck = (ctx) => {
  const target = ctx.state.charas[ctx.target];
  if (!target) return block("需要在场的对象。");
  // 调教者为男/扶她（性別&2）时要求勃起 >= 1000.
  if (
    ((ctx.state.master.state.TALENT[TALENT_ID.性別] ?? 0) & 2) !== 0 &&
    (ctx.state.master.state.BASE[BASE_ID.勃起] ?? 0) < 1000
  ) {
    return block("勃起不足，无法进行。");
  }
  if (isEquipped(target, TEQUIP_ID.振動棒)) {
    return block("振动棒使用中无法进行。");
  }
  // 目标必须为女性（性別&1）.
  if (((target.state.TALENT[TALENT_ID.性別] ?? 0) & 1) === 0) {
    return block("对方的身体条件不符。");
  }
  // 非男/扶她主控：上游需 ITEM:PBAND 穿戴式假陰茎 —— PBAND 未建模 → 忠实 block.
  if (((ctx.state.master.state.TALENT[TALENT_ID.性別] ?? 0) & 2) === 0) {
    return block("PBAND 未建模，女性主控暂不可用体位。");
  }
  // 下半身着衣覆盖：TEQUIP:0 & 4（ずらし不可）.
  if ((readTequip(target, TEQUIP_ID.下半身着衣状況) & 4) !== 0) {
    return block("对象的下半身衣着妨碍了动作。");
  }
  return { ok: true };
};

export const comf79Def: ComfDef = {
  commandNo: 79,
  label: "小人オナホ",

  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,
  timeCost: 0,

  canExecute: com79Check,
  hModeMenuCheck: com79Check,

  buildSources: (c) => {
    let kaiV = 50;
    let kutsuu = 1200;
    let hankan = 900;

    // 拡張/受虐 pleasure bump (快Ｖ side; 快Ｃ handled in buildMasterSources).
    const vkakucho = c.t.state.EXP[EXP_ID.Ｖ拡張経験] ?? 0;
    const maso = c.tAbl(ABL_ID.受虐属性);
    if (vkakucho > 50 && maso > 3) kaiV += 600;
    else if (vkakucho > 25 && maso > 1) kaiV += 300;

    // 処女 arm (苦痛/反感 amplified; 反感 add applies in normal mode).
    const virgin = c.tTalent(TALENT_ID.処女);
    if (virgin === 1) {
      kutsuu += 2000;
      hankan += 3000;
    } else if (virgin === 2) {
      kutsuu += 1000;
      hankan += 2000;
    }

    return {
      [SOURCE_ID.快Ｖ]: kaiV,
      [SOURCE_ID.情愛]: 100,
      [SOURCE_ID.苦痛]: kutsuu,
      [SOURCE_ID.露出]: 50, // TFLAG:193 → 300 deferred (pinned 通常)
      [SOURCE_ID.性行動]: 250,
      [SOURCE_ID.反感]: hankan,
      [SOURCE_ID.逸脱]: 900,
      [SOURCE_ID.屈従]: 1800,
      [SOURCE_ID.恐怖]: 1600,
      // 不潔 = Y×10 + 60; Y (STAIN) deferred → 60.
      [SOURCE_ID.不潔]: 60,
    };
  },

  // SOURCE:PLAYER:快Ｃ = 50 (+ 拡張/受虐 bump).
  buildMasterSources: (c): Record<number, number> => {
    let kaiC = 50;
    const vkakucho = c.t.state.EXP[EXP_ID.Ｖ拡張経験] ?? 0;
    const maso = c.tAbl(ABL_ID.受虐属性);
    if (vkakucho > 50 && maso > 3) kaiC += 500;
    else if (vkakucho > 25 && maso > 1) kaiC += 250;
    return { [SOURCE_ID.快Ｃ]: kaiC };
  },

  body: (c) => {
    // DOWNBASE master 体力 20 / 気力 40.
    c.master.state.BASE[BASE_ID.体力] = (c.master.state.BASE[BASE_ID.体力] ?? 0) - 20;
    c.master.state.BASE[BASE_ID.気力] = (c.master.state.BASE[BASE_ID.気力] ?? 0) - 40;
    // DOWNBASE target 体力 250 / 気力 200.
    c.t.state.BASE[BASE_ID.体力] = (c.t.state.BASE[BASE_ID.体力] ?? 0) - 250;
    c.t.state.BASE[BASE_ID.気力] = (c.t.state.BASE[BASE_ID.気力] ?? 0) - 200;

    // EXP: PLAYER 挿入経験 ++; target Ｖ性交経験 ++, Ｖ拡張経験 ++.
    c.master.state.EXP[EXP_ID.挿入経験] = (c.master.state.EXP[EXP_ID.挿入経験] ?? 0) + 1;
    c.t.state.EXP[EXP_ID.Ｖ性交経験] = (c.t.state.EXP[EXP_ID.Ｖ性交経験] ?? 0) + 1;
    c.t.state.EXP[EXP_ID.Ｖ拡張経験] = (c.t.state.EXP[EXP_ID.Ｖ拡張経験] ?? 0) + 1;

    // ERB 86: CALL STAIN_膣内Ｐ挿入 — V-insertion soil swap.
    stainSwapInsertV(c.t, c.master);
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 把%CALLNAME:TARGET%当作了飞机杯 — 小人オナホ；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf79HandlerEntry: HandlerEntry = makeComfHandler(comf79Def);
