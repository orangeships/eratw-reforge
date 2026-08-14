/**
 * Phase 7 (Wave 4h) — the last Wave 4 H-mode remainder: COMF144 放尿 (full
 * faithful port) + COMF71 二穴挿し / COMF122 助手を犯させる / COMF185 助手を
 * 犯す / COMF511 二本フェラ / COMF26 抜く (faithful BLOCKED — their @COM_ABLE
 * gates ride on subsystems we don't model).
 *
 * Why one full + five blocked: the modern runtime has NO `TEQUIP` equipment
 * namespace and NO `ASSI` (助手) concept (both systematically deferred to the
 * COMABLE/equipment layer — see comf100..148 def headers). Five of these six
 * commands' reachability depends on exactly those:
 *
 *   - **COMF71 二穴挿し** — `@COM_ABLE71` resolves `MASTER_POSE(SET_V/A,SET_P)`
 *     (who the player is currently inserted into) and gates on
 *     `TEQUIP:Ｖセックス/Ａセックス` insertion state + 体格/処女/潤滑 ladders.
 *     Without the insertion-pose tracker the gate never opens.
 *   - **COMF122 助手を犯させる** — `@COM_ABLE122` gates `PLAYER != ASSI` (the
 *     player char IS the assistant) + `TALENT:ASSI:2 & 1` (female assistant).
 *     No ASSI slot → never executable. (Body is also a COM_ORDER reasonwall.)
 *   - **COMF185 助手を犯す** — `@COM_ABLE185` gates `ASSI < 1 → RETURN 0`.
 *     Same ASSI gap.
 *   - **COMF511 二本フェラ** — needs both 主人Ｐ and 助手Ｐ (`SETBIT
 *     TCVAR:MASTER/ASSI:0`). ASSI gap.
 *   - **COMF26 抜く** — `@COM_ABLE26` gates `TEQUIP:Ｖセックス != PLAYER &&
 *     TEQUIP:Ａセックス != PLAYER → RETURN 0` (must be inserted to withdraw).
 *     Insertion-pose gap. The 868-line body is the climax/withdrawal state
 *     machine (`TFLAG:SELECTCOMの分岐` success/prevent/accident + condom
 *     economy + 充填率 + 童貞/処女 arms) — faithfully deferred as blocked,
 *     not an empty shell.
 *
 * **COMF144 放尿** is the one we CAN port fully — its gates ride on
 * `FLAG:おもらし有効` (option toggle, off by default), `TCVAR:利尿剤`
 * (set by COMF182, modeled) / `TALENT:漏尿癖`, and `ABL:従順`, all of which
 * we model. The body is a clean SOURCE/DOWNBASE + EXP grant.
 *
 * === COMF144 放尿 — faithful core (`@COM144`, normal awake branch) ===
 *   - 行為者 `TCVAR:116 = PLAYER`.
 *   - Time-stop branch (`FLAG:70 && CFLAG:TARGET:344==0`, 344 not modeled →
 *     fires whenever time stopped): `BASE:MASTER:TSP -= 200`; no SOURCE,
 *     no DOWNBASE. EXP:放尿経験 += 2. `TCVAR:利尿剤 = 0`. RETURN 1.
 *   - Awake branch: `DOWNBASE:体力 += 10 / 気力 += 200` (bare = TARGET).
 *     SOURCE:恐怖=200 / 露出=800 / 屈従=500 / 逸脱=700 / 反感=700.
 *     鬱屈 += 700 if `TALENT:自己愛 < 0 || TALENT:抵抗`.
 *     TEQUIP play-mode (野外×2.50 / 羞恥×1.50 / 浴室×0.50) ×逸脱 multiplier —
 *     deferred (TEQUIP). EXP:放尿経験 += 2. HETEROSEX EXP += 2 — deferred.
 *     野外放尿 異常経験+1 (TEQUIP野外 + GETBIT CFLAG:3,6) — deferred (TEQUIP).
 *     `TCVAR:利尿剤 = 0`. RETURN 1.
 *
 * `@COM_ABLE144` gates (modeled where we can):
 *   - `FLAG:おもらし有効 == 0 → RETURN 0` ✓
 *   - `TCVAR:利尿剤 == 0 && TALENT:漏尿癖 == 0 → RETURN 0` ✓
 *   - if not 時停: `!BATHROOM() && ABL:従順 <= 2 → RETURN 0` — BATHROOM()
 *     (TEQUIP:浴室PLAY) deferred → treat as non-bathroom, so 従順<=2 blocks.
 *     (A trial-clean chara with 従順<=2 + 利尿剤 active still can't → faithful;
 *     the bathroom-override arm is the only thing we lose, and only with TEQUIP.)
 *   - `TEQUIP:0 > 1` (下半身着衣) → RETURN 0 — TEQUIP, deferred.
 *   - TFLAG:100 / GLOBAL_COMABLE — global COMABLE layer, deferred.
 *
 * **DEFERRED (cluster-common, faithfully recorded):** TEQUIP play-mode ×逸脱
 * multiplier; BATHROOM() override; HETEROSEX same-sex EXP; 野外放尿 異常経験
 * arm (needs TEQUIP野外 + CFLAG:3 bit6); the full @COM_ABLE TFLAG:100 /
 * GLOBAL_COMABLE / 下半身着衣 gates. STAIN (放尿 has none in body). MARK.
 */

import type { CommandContext, HandlerEntry } from "../types.js";
import { cloneGameState } from "../../state/game-state.js";
import { applySourceCheck } from "../source-check.js";
import {
  ABL_ID,
  BASE_ID,
  EXP_ID,
  FLAG_ID,
  SOURCE_ID,
  TALENT_ID,
  TCVAR_ID,
  TEQUIP_ID,
  getMasterBase,
  setMasterBase,
  times,
} from "../../state/settlement.js";
import { readTequip } from "../../state/tequip.js";

const PLAYER = 0;

// ===========================================================================
// COMF144 放尿 (full faithful port)
// ===========================================================================

export const comf144HandlerEntry: HandlerEntry = {
  commandNo: 144,
  execCheck: (ctx: CommandContext) => {
    const target = ctx.state.charas[ctx.target];
    if (!target) {
      return { ok: false, reason: { kind: "precondition", message: "放尿需要目标角色在场。" } };
    }
    // @COM_ABLE144: FLAG:おもらし有効 == 0 → RETURN 0.
    if ((ctx.state.flagStore[FLAG_ID.おもらし有効] ?? 0) === 0) {
      return { ok: false, reason: { kind: "precondition", message: "おもらし选项未开启。" } };
    }
    // TCVAR:利尿剤 == 0 && TALENT:漏尿癖 == 0 → RETURN 0.
    const diuretic = target.state.TCVAR[TCVAR_ID.利尿剤] ?? 0;
    const incontinence = target.state.TALENT[TALENT_ID.漏尿癖] ?? 0;
    if (diuretic === 0 && incontinence === 0) {
      return { ok: false, reason: { kind: "precondition", message: "未服用利尿剤且无漏尿癖。" } };
    }
    // Not 時停: !BATHROOM() && ABL:従順 <= 2 → RETURN 0. BATHROOM() (TEQUIP)
    // deferred → treat as non-bathroom.
    const timeStop = (ctx.state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0;
    if (!timeStop) {
      const obedience = target.state.ABL[ABL_ID.従順] ?? 0;
      if (obedience <= 2) {
        return { ok: false, reason: { kind: "precondition", message: "従順不足（需3以上，浴室除外）。" } };
      }
    }
    // TEQUIP:0 > 1 (下半身着衣) / TFLAG:100 / GLOBAL_COMABLE — deferred.
    return { ok: true };
  },
  handler: (ctx: CommandContext) => {
    const next = cloneGameState(ctx.state);
    const target = next.charas[ctx.target]!;
    // 行為者.
    target.state.TCVAR[TCVAR_ID.行為者] = PLAYER;

    const timeStop = (next.flagStore[FLAG_ID.時間停止] ?? 0) !== 0;

    if (timeStop) {
      // Time-stop branch: BASE:MASTER:TSP -= 200; no SOURCE/DOWNBASE.
      setMasterBase(next, BASE_ID.TSP, (getMasterBase(next, BASE_ID.TSP) ?? 0) - 200);
    } else {
      // Awake branch: DOWNBASE:体力 += 10 / 気力 += 200 (bare = TARGET).
      target.state.BASE[BASE_ID.体力] = (target.state.BASE[BASE_ID.体力] ?? 0) - 10;
      target.state.BASE[BASE_ID.気力] = (target.state.BASE[BASE_ID.気力] ?? 0) - 200;

      const sources: Record<number, number> = {
        [SOURCE_ID.恐怖]: 200,
        [SOURCE_ID.露出]: 800,
        [SOURCE_ID.屈従]: 500,
        [SOURCE_ID.逸脱]: 700,
        [SOURCE_ID.反感]: 700,
      };
      // 鬱屈 += 700 if 自己愛<0 || 抵抗.
      if ((target.state.TALENT[TALENT_ID.自己愛] ?? 0) < 0 || (target.state.TALENT[TALENT_ID.抵抗] ?? 0) !== 0) {
        sources[SOURCE_ID.鬱屈] = (sources[SOURCE_ID.鬱屈] ?? 0) + 700;
      }
      // TEQUIP play-mode ×逸脱 multiplier (野外×2.50/羞恥×1.50/浴室×0.50).
      // The three PLAY slots (29/30/31) are mutually exclusive; apply in order.
      // PLAY state lives in `state.TEQUIP` (per-chara equipment, see
      // `state/tequip.ts`) — never EQUIP (slots 11-22 are clothing).
      if (readTequip(target, TEQUIP_ID.野外PLAY) !== 0) {
        sources[SOURCE_ID.逸脱] = times(sources[SOURCE_ID.逸脱] ?? 0, 2.5);
      } else if (readTequip(target, TEQUIP_ID.羞耻PLAY) !== 0) {
        sources[SOURCE_ID.逸脱] = times(sources[SOURCE_ID.逸脱] ?? 0, 1.5);
      } else if (readTequip(target, TEQUIP_ID.浴室PLAY) !== 0) {
        sources[SOURCE_ID.逸脱] = times(sources[SOURCE_ID.逸脱] ?? 0, 0.5);
      }
      const settled = applySourceCheck(next, ctx.target, sources, 0);
      // EXP:放尿経験 += 2 (always, both branches).
      target.state.EXP[EXP_ID.放尿経験] = (target.state.EXP[EXP_ID.放尿経験] ?? 0) + 2;
      // TCVAR:利尿剤 = 0.
      target.state.TCVAR[TCVAR_ID.利尿剤] = 0;
      return {
        state: next,
        events: [
          { kind: "NARRATION" as const, timestamp: ctx.now(),
            text: `%CALLNAME:TARGET% 失禁了。好感度 ${settled.favorDelta >= 0 ? "+" : ""}${settled.favorDelta}。` },
          ...settled.events,
        ],
        outcome: "ok" as const,
      };
    }

    // Time-stop arm fallthrough: EXP + 利尿剤 clear.
    target.state.EXP[EXP_ID.放尿経験] = (target.state.EXP[EXP_ID.放尿経験] ?? 0) + 2;
    target.state.TCVAR[TCVAR_ID.利尿剤] = 0;
    return {
      state: next,
      events: [
        { kind: "NARRATION" as const, timestamp: ctx.now(),
          text: `%CALLNAME:TARGET% 在时间停止中失禁了。（TSP -200）` },
      ],
      outcome: "ok" as const, // RETURN 1
    };
  },
};

// ===========================================================================
// COMF71 二穴挿し — faithful BLOCKED (insertion-pose / TEQUIP gap)
// ===========================================================================

export const comf71HandlerEntry: HandlerEntry = {
  commandNo: 71,
  execCheck: (_ctx: CommandContext) => {
    // @COM_ABLE71 resolves MASTER_POSE(SET_V/A,SET_P) — who PLAYER is inserted
    // into — and gates on TEQUIP:Ｖセックス/Ａセックス insertion state. The
    // insertion-pose tracker (TEQUIP namespace) is unmodeled → no partner is
    // ever "inserted" → LOCAL:2 == 0 → RETURN 0. Faithful: not executable.
    return { ok: false, reason: { kind: "precondition", message: "二穴挿し需要已挿入状态（挿入ポーズ / TEQUIP 未建模）。" } };
  },
  handler: (ctx: CommandContext) => {
    return {
      state: cloneGameState(ctx.state),
      events: [{ kind: "NARRATION", timestamp: ctx.now(), text: "（二穴挿し：挿入ポーズ状態机未建模。）" }],
      outcome: "blocked",
      failReason: { kind: "precondition", message: "MASTER_POSE / TEQUIP:Ｖ·Ａセックス insertion-state subsystem deferred" },
    };
  },
};

// ===========================================================================
// COMF122 助手を犯させる — faithful BLOCKED (ASSI subsystem gap)
// ===========================================================================

export const comf122HandlerEntry: HandlerEntry = {
  commandNo: 122,
  execCheck: (_ctx: CommandContext) => {
    // @COM_ABLE122: `PLAYER != ASSI → RETURN 0` (player must BE the assistant)
    // + `!(TALENT:ASSI:2 & 1) → RETURN 0` (female assistant). No ASSI slot
    // modeled → never executable. Faithful.
    return { ok: false, reason: { kind: "precondition", message: "助手を犯させる需要助手（ASSI）子系统。" } };
  },
  handler: (ctx: CommandContext) => {
    // Body is a COM_ORDER reasonwall (欲望/奉仕精神/快楽刻印/欲情/羞恥心/献身
    // /淫乱 + 助手処女 -15, 実行値≥40) then 射精部位=1/強度2000 + TEQUIP:ASSI:50
    // + SOURCE + 助手処女喪失 (屈従×5/逸脱×3/異常経験/従順=2) + EXP:ASSI:Ｖ経験.
    // Needs ASSI + COM_ORDER + 体格 + TEQUIP. Blocked — no shell.
    return {
      state: cloneGameState(ctx.state),
      events: [{ kind: "NARRATION", timestamp: ctx.now(), text: "（助手を犯させる：ASSI 子系统 + COM_ORDER reasonwall 未建模。）" }],
      outcome: "blocked",
      failReason: { kind: "precondition", message: "ASSI subsystem + COM_ORDER reasonwall deferred" },
    };
  },
};

// ===========================================================================
// COMF185 助手を犯す — faithful BLOCKED (ASSI subsystem gap)
// ===========================================================================

export const comf185HandlerEntry: HandlerEntry = {
  commandNo: 185,
  execCheck: (_ctx: CommandContext) => {
    // @COM_ABLE185: `ASSI < 1 → RETURN 0` (no assistant). No ASSI slot → never
    // executable. Faithful.
    return { ok: false, reason: { kind: "precondition", message: "助手を犯す需要助手（ASSI）在场。" } };
  },
  handler: (ctx: CommandContext) => {
    // Body is a COM_ORDER reasonwall (欲望/快楽刻印/欲情/助手露出癖/助手恋慕·親愛
    // + 助手処女 -50, 実行値≥40) then 射精部位=1/強度1500 + TEQUIP:ASSI:50 +
    // SOURCE + 助手処女喪失 (逸脱×20/屈従×3) + EXP:ASSI:Ｖ経験/百合経験.
    // Needs ASSI + COM_ORDER + TEQUIP. Blocked — no shell.
    return {
      state: cloneGameState(ctx.state),
      events: [{ kind: "NARRATION", timestamp: ctx.now(), text: "（助手を犯す：ASSI 子系统 + COM_ORDER reasonwall 未建模。）" }],
      outcome: "blocked",
      failReason: { kind: "precondition", message: "ASSI subsystem + COM_ORDER reasonwall deferred" },
    };
  },
};

// ===========================================================================
// COMF511 二本フェラ — faithful BLOCKED (ASSI subsystem gap)
// ===========================================================================

export const comf511HandlerEntry: HandlerEntry = {
  commandNo: 511,
  execCheck: (_ctx: CommandContext) => {
    // @COM511 calls CAN_COM511 (a COM_ORDER reasonwall, 実行値≥32) and the body
    // sets 射精部位 on BOTH MASTER and ASSI (`SETBIT TCVAR:MASTER/ASSI:0`,
    // `TCVAR:MASTER/ASSI:2 = 4`). Needs a 助手Ｐ. No ASSI slot → never
    // executable. Faithful.
    return { ok: false, reason: { kind: "precondition", message: "二本フェラ需要助手（ASSI）在场。" } };
  },
  handler: (ctx: CommandContext) => {
    // Body: 射精部位=4 口淫 on MASTER(強度750) + ASSI(強度750); DOWNBASE 80/250;
    // SOURCE 情愛150/性行動400/達成300/屈従1000/逸脱500/反感500; 鬱屈+700 if
    // 自己愛<0||抵抗; STAIN 口↔主人Ｐ/助手Ｐ; EXP:口淫経験+2; HETEROSEX;
    // 猫舌→嗜虐快楽経験; TCVAR:TARGET:ＦＫ喪失=2. Needs ASSI + STAIN + HETEROSEX.
    // Blocked — no shell.
    return {
      state: cloneGameState(ctx.state),
      events: [{ kind: "NARRATION", timestamp: ctx.now(), text: "（二本フェラ：ASSI 子系统未建模。）" }],
      outcome: "blocked",
      failReason: { kind: "precondition", message: "ASSI subsystem (主人Ｐ+助手Ｐ) deferred" },
    };
  },
};

// ===========================================================================
// COMF26 抜く — faithful BLOCKED (insertion-pose / TEQUIP gap)
// ===========================================================================

export const comf26HandlerEntry: HandlerEntry = {
  commandNo: 26,
  execCheck: (_ctx: CommandContext) => {
    // @COM_ABLE26: `TEQUIP:Ｖセックス != PLAYER && TEQUIP:Ａセックス != PLAYER
    // → RETURN 0` (must be inserted to withdraw). Insertion-pose tracker
    // (TEQUIP namespace) unmodeled → never inserted → RETURN 0. Faithful.
    return { ok: false, reason: { kind: "precondition", message: "抜く需要已挿入状态（Ｖ·Ａセックス / TEQUIP 未建模）。" } };
  },
  handler: (ctx: CommandContext) => {
    // The 868-line body is the climax/withdrawal state machine:
    //   - TCVAR:PLAYER:イきそう branch: 外出し成功 (TFLAG:SELECTCOMの分岐>=0,
    //     射精箇所=8, 強度=350+ABL*50, SOURCE:快Ｖ/快Ａ+60, condom 摘除) vs
    //     膣内暴発 (分岐<0, 射精箇所=1/2, 強度=750+ABL*80, SOURCE+150).
    //   - 抜く branch: condom economy (ゴム使用済み → 换新/取下, TFLAG:ゴム内).
    //   - COM26_TOUCH: VAGINAL/ANAL flag + 暴発/だいしゅきホールド prevent arms
    //     (ABL:膣/アナル>=4 → 100% fail; 妊娠願望/膣射中毒 → 50% prevent;
    //     RAND-based) + TOUCH_SET(SET_FROM_V/A,0) 挿入解除.
    //   - TIME += 1; RETURN 1.
    // Needs TEQUIP:Ｖ·Ａセックス + TCVAR:イきそう + BASE:射精/EJAC_ENDURANCE_LIMIT
    // + 充填率 + TFLAG:SELECTCOMの分岐 + condom economy. Blocked — no shell.
    return {
      state: cloneGameState(ctx.state),
      events: [{ kind: "NARRATION", timestamp: ctx.now(), text: "（抜く：挿入ポーズ状态机 + 射精/避孕套经济未建模。）" }],
      outcome: "blocked",
      failReason: { kind: "precondition", message: "TEQUIP:Ｖ·Ａセックス insertion-state + climax/condom economy deferred" },
    };
  },
};
