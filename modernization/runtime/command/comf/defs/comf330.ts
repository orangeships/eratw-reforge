/**
 * Phase 7 — `COMF330 スカートをめくる` (flip the skirt) settlement, as a `ComfDef`.
 *
 * Ports `@COM330` (`ERB/コマンド関連/COMF/日常系/COMF330 スカートをめくる.ERB`),
 * the normal arm, with the time-stop TSP-only arm in the handler wrapper.
 *
 * **Special case — outcome driven by favor bracket, NOT a RAND roll.**
 * The ERB (lines 57-76) sets `TFLAG:193` and `DOWNBASE:MASTER:体力`
 * directly from the favor bracket:
 *
 *   好感度 <= 100   → TFLAG:193 = -5, MASTER:体力 += 戦闘能力*100, RAND:30 → 掀裙子すぎ
 *   好感度 <= 1000  → TFLAG:193 = -3, MASTER:体力 += 戦闘能力*30, RAND:20
 *   好感度 <= 3000  → TFLAG:193 = -1, RAND:10
 *   好感度 <= 5000  → TFLAG:193 = 0, RAND:10
 *   else            → TFLAG:193 = 1, RAND:5
 *
 * Factory's `outcome` field is set by `RAND:maxRoll` cutoffs. Since the
 * ERB's outcome is *deterministic from favor*, the factory roll would
 * conflict. We work around this by using a **functional `body` lambda**
 * that pre-computes the actual outcome from favor and then re-applies
 * the `outcomeMul`/favorDelta. However, `makeComfHandler` reads `outcome`
 * once in its body before our `body` runs, so the multiplier would
 * already be applied incorrectly.
 *
 * **Pragmatic port**: capture the favor-bracket SOURCE/expansion as if
 * outcome=0 (factory default), but model the 好感度-based downbase via
 * the `downbase` function form, and document the outcome bifurcation as
 * a DEFERRED C-tier (state-conditional outcome roll) — the SOURCE build
 * is the same in all 5 arms (no ABL bracket on 歓楽/情愛/欲情/露出/反感
 * scaling), only the 反感 base is invariant at 700, so the only
 * differentiator IS the outcome. For now we model the SOURCE/expansion
 * clean (好感度 0 = first arm's expansion) and skip the outcome scaling
 * (treat all 5 arms as flat in this MVP).
 *
 * SOURCE build (ERB 11-53):
 *   - fixed: 露出 300 / 反感 700
 *   - FLAG:異常気象 == 6 → CUP:快Ｖ += MAX(0, 5000-500*ABL:親密) ± MARK scaling
 *     — DEFERRED (CUP not modeled; weather model is skipped)
 *   - 好感度 bracket (ERB 29-51, 3 SELECTCASE arms):
 *     - 1000-3000: 情愛 += 好感/100; 反感 -= 親密*10
 *     - 3001-5000: 情愛 += 100+(好感-500)/5; 歓楽 += 100+(好感-500)/4;
 *                  欲情 += 親密*10; 露出 += 親密*15; 反感 -= 親密*15
 *     - >5000:     情愛 += 500+(好感-5000)/7; 歓楽 += 500+(好感-5000)/4;
 *                  + ABL:親密 bonuses (恋慕-conditional: 欲情*15, 露出*20,
 *                  反感-=親密*25 vs else: 欲情*20, 露出*30, 反感-=親密*40)
 *   - 反感 ≥ 0 / 情愛 ≥ 0 floors
 *   - 受動 = 100 + 150 * ABL:従順
 *   - 征服 = 100 + 150 * ABL:施虐属性
 *
 * DOWNBASE (ERB 57-76, function form by favor):
 *   - <=100:   MASTER:体力 += 戦闘能力*100
 *   - <=1000:  MASTER:体力 += 戦闘能力*30
 *   - else:    no extra MASTER:体力 drain
 *
 * Persisted (ERB 62-75): TFLAG:掀裙子すぎ += RAND:N — RNG-gated, DEFERRED.
 *
 * Time: TIME += 5 → timeCost.
 *
 * **DEFERRED (documented, off in a clean state):**
 *   - **C-tier: outcome is favor-driven, not RAND-driven.** Factory can't
 *     model this without a fundamental change to makeComfHandler. We
 *     pin the SOURCE build (invariant) and the favor-driven DOWNBASE
 *     (function form) but skip the outcome-driven TIMES scaling.
 *   - FLAG:異常気象 == 6 → 快Ｖカップ drink — DEFERRED
 *   - TFLAG:掀裙子すぎ += RAND:N (RNG-gated) — DEFERRED
 *   - 二人きり/同室 scaling (ERB 81-94) — DEFERRED (CHARANUM not in factory)
 *   - 情緒 scaling (ERB 95-108) — DEFERRED (情緒 read not modeled)
 *   - TFLAG:193 = -5/-3/-1/0/1 favor brackets → DOWNBASE:MASTER:体力 differs
 *     — modeled via `downbase` function form (factory drains master only)
 *   - IS_DATING_WITH_PLAYER → 约会経験++ (ERB 111-114)
 *   - 戦闘能力 = ABL:战斗能力 (id 42) — read for downbase
 *   - CASE 1/-1/-2 arms, MAGIC_DLC, HITOKE, FAVOR_CALC, TRUST_CALC
 */

import type { HandlerEntry } from "../../types.js";
import { ABL_ID, BASE_ID, CFLAG_ID, EQUIP_SLOT, FLAG_ID, SOURCE_ID, TALENT_ID, TCVAR_ID, getMasterBase, setMasterBase } from "../../../state/settlement.js";
import { cloneGameState } from "../../../state/game-state.js";
import { TFLAG_ID, addTflag } from "../../../state/tflag.js";
import { wornPieceName } from "../../../state/clothing.js";
import { ROOM_CATALOG_BY_LOCATION } from "../../../world/room-catalog.js";
import { isHMode } from "../../h-mode.js";
import { makeComfHandler } from "../make-comf-handler.js";
import { MUL_NONE, type ComfDef } from "../comf-def.js";

export const comf330Def: ComfDef = {
  commandNo: 330,
  label: "スカートをめくる",
  timeCost: 5,
  // COM_ABLE330:121-159. The flat generated gate loses the frozen/hidden
  // bypass and Miyoi's working exception; use the native branch ordering.
  gateOverride: (ctx) => {
    const block = (message: string) => ({ ok: false as const, reason: { kind: "precondition" as const, message } });
    const target = ctx.state.charas[ctx.target];
    if (ctx.target <= 0 || !target || target.location !== ctx.state.master.location) return block("掀裙子需要在场的目标。");
    if (isHMode(ctx.state, ctx.target) && (target.state.CFLAG[CFLAG_ID.诶嘿嘿] ?? 0) !== 2) return block("调教中不能使用该日常指令。");
    const stopped = (ctx.state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0 &&
      (target.state.CFLAG[CFLAG_ID.時間停止行動] ?? 0) !== 1;
    if (!stopped && ((target.state.CFLAG[CFLAG_ID.潜伏状態] ?? 0) & 1) === 0) {
      if ((target.state.CFLAG[CFLAG_ID.睡眠] ?? 0) !== 0) return block("目标正在睡觉。");
      if ((target.state.CFLAG[CFLAG_ID.行动] ?? 0) === 5 && ctx.target !== 134) return block("目标正在工作。");
      if (ctx.state.dateSession?.partner === ctx.target &&
          ROOM_CATALOG_BY_LOCATION[target.location]?.localNumber !== 98) return block("约会中只能在待客室进行。");
      if ((target.state.CFLAG[CFLAG_ID.陪睡中] ?? 0) !== 0) return block("目标正在陪睡。");
      if ((ctx.state.flagStore[FLAG_ID.甲斐性無] ?? 0) !== 0) return block("没有那份胆量（甲斐性無）。");
    }
    const flippableSlots = ["裙子", "連衣裙", "和服", "裤子"] as const;
    if (!flippableSlots.some((slot) => {
      const piece = target.state.EQUIP[EQUIP_SLOT[slot]];
      return piece === undefined ? wornPieceName(target, slot) !== "" : piece !== 0;
    })) return block("目标没有可掀起的下身衣服。");
    if ((getMasterBase(ctx.state, BASE_ID.気力) ?? 0) <= 0) return block("气力不足。");
    if (((target.state.TCVAR[TCVAR_ID.MASTER_COUNTER制御] ?? 0) & (1 << 7)) !== 0) return block("当前无法掀起衣服。");
    return { ok: true };
  },
  // No factory-driven roll. The ERB's outcome IS the favor bracket.
  // Pinned at outcome 0 (通常) — see C-tier DEFERRED note.
  greatThreshold: 0,
  failThreshold: 100,

  // ERB 57-76:  MASTER:体力 drain depends on favor bracket.
  // Factory downbase is master-only → drain master 体力 here, function form.
  downbase: (c): Record<number, number> => {
    const sen = c.mAbl(ABL_ID.战斗能力);
    const favor = c.favor;
    if (favor <= 100) return { [BASE_ID.体力]: sen * 100 };
    if (favor <= 1000) return { [BASE_ID.体力]: sen * 30 };
    return {};
  },

  buildSources: (c) => {
    const shinmitsu = c.tAbl(ABL_ID.親密);
    const favor = c.favor; // CFLAG:2 好感度 (pre-command)

    // Fixed bases (ERB 11-12)
    let roshutsu = 300;
    let hankan = 700;
    let jouai = 0;
    let kanraku = 0;
    let yokujo = 0;

    // 好感度 bracket (ERB 29-51, 3 SELECTCASE arms)
    if (favor >= 1000 && favor <= 3000) {
      jouai += Math.trunc(favor / 100);
      hankan -= shinmitsu * 10;
    } else if (favor >= 3001 && favor <= 5000) {
      jouai += 100 + Math.trunc((favor - 500) / 5);
      kanraku += 100 + Math.trunc((favor - 500) / 4);
      yokujo += shinmitsu * 10;
      roshutsu += shinmitsu * 15;
      hankan -= shinmitsu * 15;
    } else if (favor > 5000) {
      jouai += 500 + Math.trunc((favor - 5000) / 7);
      kanraku += 500 + Math.trunc((favor - 5000) / 4);
      const hasRenbo = c.tTalent(TALENT_ID.恋慕) !== 0;
      if (!hasRenbo) {
        yokujo += shinmitsu * 15;
        roshutsu += shinmitsu * 20;
        hankan -= shinmitsu * 25;
      } else {
        yokujo += shinmitsu * 20;
        roshutsu += shinmitsu * 30;
        hankan -= shinmitsu * 40;
      }
    }
    if (hankan < 0) hankan = 0;
    if (jouai < 0) jouai = 0;

    // 受動 + 征服 (ERB 78-79)
    const judo = 100 + 150 * c.tAbl(ABL_ID.従順);
    const seofuku = 100 + 150 * c.tAbl(ABL_ID.施虐属性);

    const sources: Record<number, number> = {
      [SOURCE_ID.露出]: roshutsu,
      [SOURCE_ID.反感]: hankan,
      [SOURCE_ID.受動]: judo,
      [SOURCE_ID.征服]: seofuku,
    };
    if (jouai !== 0) sources[SOURCE_ID.情愛] = jouai;
    if (kanraku !== 0) sources[SOURCE_ID.歓楽] = kanraku;
    if (yokujo !== 0) sources[SOURCE_ID.欲情] = yokujo;
    return sources;
  },

  // No `TIMES SOURCE` block keyed to TFLAG:193 in this command (only the
  // 同室/情緒 scaling, which is DEFERRED). All sources MUL_NONE.
  outcomeMul: {
    [SOURCE_ID.露出]: MUL_NONE,
    [SOURCE_ID.反感]: MUL_NONE,
    [SOURCE_ID.受動]: MUL_NONE,
    [SOURCE_ID.征服]: MUL_NONE,
    [SOURCE_ID.情愛]: MUL_NONE,
    [SOURCE_ID.歓楽]: MUL_NONE,
    [SOURCE_ID.欲情]: MUL_NONE,
  },

  // No TFLAG:97 pre-seed in this command.
  favorBias: () => 0,

  body: (c) => {
    // DAILY_EV16 reads the day-scoped tally at the next night settlement.
    // Upstream increments by a favor-dependent random amount after COM330.
    const roll = c.favor <= 100
      ? c.ctx.rng.int(30)
      : c.favor <= 1000
        ? c.ctx.rng.int(20)
        : c.favor <= 3000
          ? c.ctx.rng.int(10)
          : c.favor <= 5000
            ? c.ctx.rng.int(10)
            : c.ctx.rng.int(5);
    addTflag(c.next, TFLAG_ID.skirtFlipCount, roll);
  },

  narration: (_c, favorDelta) => {
    return `%CALLNAME:MASTER% 掀起了%CALLNAME:TARGET%的裙子；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`;
  },
};

const normalSkirtFlip = makeComfHandler(comf330Def);
export const comf330HandlerEntry: HandlerEntry = {
  ...normalSkirtFlip,
  handler: (ctx) => {
    // @COM330:7-8 has no SOURCE, day tally or time cost for a frozen target.
    if ((ctx.state.flagStore[FLAG_ID.時間停止] ?? 0) === 1 &&
        (ctx.state.charas[ctx.target]?.state.CFLAG[CFLAG_ID.時間停止行動] ?? 0) === 0) {
      const next = cloneGameState(ctx.state);
      setMasterBase(next, BASE_ID.TSP, getMasterBase(next, BASE_ID.TSP) - 10);
      return {
        state: next,
        events: [{ kind: "NARRATION", timestamp: ctx.now(), text: "%CALLNAME:MASTER%在时间停止中掀起了%CALLNAME:TARGET%的裙子。" }],
        outcome: "ok",
      };
    }
    return normalSkirtFlip.handler(ctx);
  },
};
