/**
 * Phase 7 — `COMF95 疑似挿入` (mock insertion / outercourse), as a `ComfDef`.
 *
 * Ports the **normal-mode (ELSE) core** of `@COM95`
 * (`ERB/コマンド関連/COMF/COMF95 疑似挿入.ERB`).
 *
 * **Oral/hand family.** Mock-insertion command: master performs
 * outercourse on target without penetration. Target takes heavy 苦痛
 * (500, zeroed for non-virgins) plus a 恐怖 penalty for 処女 targets.
 * Master receives 快Ｃ 120.
 *
 * **Faithful normal-mode core (ERB 49-76, ELSE branch):**
 *   - master SOURCE: 快Ｃ = 120 (ERB 29)
 *   - target DOWNBASE: 体力 50 / 気力 60 (ERB 50-51)
 *   - master DOWNBASE: 体力 10 / 気力 20 (ERB 30-31)
 *   - target SOURCE: 快Ｖ 100, 情愛 150, 苦痛 500, 露出 50, 逸脱 20,
 *     反感 100 (ERB 52-65)
 *   - 処女 == 1 || 処女 == -1 → 恐怖 += 500 (ERB 66-68)
 *   - EXP: Ｖ経験 target++ (ERB 72-73)
 *
 * **DEFERRED (documented):**
 *   - Time-stop branch (ERB 23-44) — TSP drain, separate SOURCE values.
 *   - 不潔 SOURCE calculation (ERB 58) — depends on STAIN state.
 *   - STAIN膣内Ｐ挿入 (ERB 60) — STAIN subsystem deferred.
 *   - HETEROSEX EXP writes (ERB 75-76) — gender-pair helper deferred.
 *   - TFLAG:193 for extra 露出 200 (ERB 63-64) — TFLAG state deferred.
 *   - TFLAG:194 for 処女 reaction detail (ERB 57) — TFLAG state deferred.
 *   - TCVAR markers (ERB 10-18) — H-scene chaining deferred.
 *   - COM_ABLE95 success-rate calculation (ERB 84+) — COMABLE layer.
 *
 * **No outcome roll, no TIME** — pinned 通常; timeCost 0.
 */

import type { ExecCheck, HandlerEntry } from "../../types.js";
import {
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
 * @COM_ABLE95 可用性判定（忠实核心）。deferred: 已挿入判定(TCVAR:100==PLAYER &&
 * TARGET==TFLAG:103)、処女+PALAM:潤滑、浴室PLAY 塑料地墊门(TEQUIP:31 && ITEM:20==0
 * && NOITEM==0 — NOITEM 未建模)、体位==5(背面座位)、TFLAG:100/GLOBAL_COMABLE。
 */
const com95Check: ExecCheck = (ctx) => {
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

export const comf95Def: ComfDef = {
  commandNo: 95,
  label: "疑似挿入",

  // No outcome roll; pinned 通常.
  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 0,

  canExecute: com95Check,
  hModeMenuCheck: com95Check,

  // Target/master drain handled in body().
  downbase: {},

  buildSources: (c) => {
    const sources: Record<number, number> = {
      [SOURCE_ID.快Ｖ]: 100,
      [SOURCE_ID.情愛]: 150,
      [SOURCE_ID.苦痛]: 500,
      [SOURCE_ID.露出]: 50,
      [SOURCE_ID.逸脱]: 20,
      [SOURCE_ID.反感]: 100,
    };

    // ERB 66-68: 処女 == 1 || 処女 == -1 → 恐怖 += 500.
    if (
      c.tTalent(TALENT_ID.処女) === 1 ||
      c.tTalent(TALENT_ID.処女) === -1
    ) {
      sources[SOURCE_ID.恐怖] = 500;
    }
    return sources;
  },

  // ERB 29: master SOURCE:PLAYER:快Ｃ = 120.
  buildMasterSources: (_c) => ({
    [SOURCE_ID.快Ｃ]: 120,
  }),

  body: (c) => {
    // ERB 50-51: target 体力 50 / 気力 60 drain.
    c.t.state.BASE[BASE_ID.体力] = (c.t.state.BASE[BASE_ID.体力] ?? 0) - 50;
    c.t.state.BASE[BASE_ID.気力] = (c.t.state.BASE[BASE_ID.気力] ?? 0) - 60;

    // ERB 30-31: master 体力 10 / 気力 20 drain.
    c.master.state.BASE[BASE_ID.体力] =
      (c.master.state.BASE[BASE_ID.体力] ?? 0) - 10;
    c.master.state.BASE[BASE_ID.気力] =
      (c.master.state.BASE[BASE_ID.気力] ?? 0) - 20;

    // ERB 72-73: EXP:Ｖ経験 target++.
    c.t.state.EXP[EXP_ID.Ｖ経験] = (c.t.state.EXP[EXP_ID.Ｖ経験] ?? 0) + 1;

    // ERB 83: CALL STAIN_膣内Ｐ挿入 — V-insertion soil swap (master Ｐ ⇔
    // target Ｖ/膣内, condom-gated + defloration blood). 不潔 SOURCE's Y is
    // a global not computed in this command → 不潔 stays unmodeled (deferred).
    stainSwapInsertV(c.t, c.master);
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 对%CALLNAME:TARGET%进行了假装插入 — 疑似挿入；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf95HandlerEntry: HandlerEntry = makeComfHandler(comf95Def);
