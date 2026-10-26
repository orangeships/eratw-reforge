/**
 * Phase 7 (Wave 4h) — the last Wave 4 H-mode remainder: COMF144 放尿 (full
 * faithful port) + COMF71 二穴挿し / COMF122 助手を犯させる / COMF185 助手を
 * 犯す / COMF511 二本フェラ (faithful BLOCKED) / COMF26 抜く (bounded
 * deterministic withdrawal core).
 *
 * Why the four remain blocked: the modern runtime has no `ASSI` (助手) concept
 * (deferred to the COMABLE/equipment layer — see comf100..148 def headers).
 * COMF26 now owns the modeled insertion-state withdrawal path. COMF71 has a
 * bounded single-target 双槍 route; ordinary multi-participant reachability
 * and the other three commands still depend on the missing assistant graph:
 *
 *   - **COMF71 二穴挿し** — `@COM_ABLE71` resolves `MASTER_POSE(SET_V/A,SET_P)`
 *     (who the player is currently inserted into) and gates on
 *     `TEQUIP:Ｖセックス/Ａセックス` insertion state + 体格/処女/潤滑 ladders.
 *     The modern route now validates one existing insertion, adds the second
 *     channel, settles both V/A pain/source arms once, and preserves both
 *     links for COM26/session cleanup. Ordinary ASSI/multi-target selection
 *     remains fail-closed.
 *   - **COMF122 助手を犯させる** — `@COM_ABLE122` gates `PLAYER != ASSI` (the
 *     player char IS the assistant) + `TALENT:ASSI:2 & 1` (female assistant).
 *     No ASSI slot → never executable. (Body is also a COM_ORDER reasonwall.)
 *   - **COMF185 助手を犯す** — `@COM_ABLE185` gates `ASSI < 1 → RETURN 0`.
 *     Same ASSI gap.
 *   - **COMF511 二本フェラ** — needs both 主人Ｐ and 助手Ｐ (`SETBIT
 *     TCVAR:MASTER/ASSI:0`). ASSI gap.
 *   - **COMF26 抜く** — `@COM_ABLE26` gates `TEQUIP:Ｖセックス != PLAYER &&
 *     TEQUIP:Ａセックス != PLAYER → RETURN 0` (must be inserted to withdraw).
 *     The modern path validates the modeled insertion links, offers the
 *     deterministic inside/outside/none choice, settles residue/experience,
 *     and always clears the insertion state.
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
import { applySourceCheck, settleSourcePalam } from "../source-check.js";
import {
  applyHSourceCheck,
  applyHInsertionPain,
  recordHChannelHistory,
  settleHEjaculation,
} from "../h-v-a-settlement.js";
import {
  activeHInsertionSite,
  activeHInsertionSites,
  clearHInsertionState,
  settleHInsertionHistory,
  syncHInsertionChannel,
} from "../training-session.js";
import {
  ABL_ID,
  BASE_ID,
  CFLAG_ID,
  EXP_ID,
  FLAG_ID,
  SOURCE_ID,
  TALENT_ID,
  TCVAR_ID,
  TEQUIP_ID,
  advanceTimeTicks,
  getMasterBase,
  expLv,
  setMasterBase,
  times,
} from "../../state/settlement.js";
import { isEquipped, readTequip, setEquipped } from "../../state/tequip.js";
import { bodyFillRate } from "../../state/body-fill-rate.js";
import { checkHBaseResourceAvailability } from "../h-base-resources.js";

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
      return { ok: false, reason: { kind: "precondition", message: "失禁选项尚未开启。" } };
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
// COMF71 二穴挿し — bounded single-target dual-insertion route
// ===========================================================================

const COM71_BLOCKED_EQUIPMENT = [
  TEQUIP_ID.振動棒,
  TEQUIP_ID.肛用振動棒,
  TEQUIP_ID.後庭拉珠,
  TEQUIP_ID.浣腸,
  TEQUIP_ID.拡張氣球,
  TEQUIP_ID.肛門電極,
] as const;

function comf71Gate(ctx: CommandContext) {
  const target = ctx.state.charas[ctx.target];
  if (!target) {
    return { ok: false as const, reason: { kind: "precondition" as const, message: "双穴插入需要在场的目标角色。" } };
  }
  if (ctx.actor !== PLAYER) {
    return { ok: false as const, reason: { kind: "precondition" as const, message: "双穴插入的有界路线只接受主人作为行为者。" } };
  }

  // The modern state has one selected target and no ASSI identity graph. The
  // only route we can settle without guessing a second character is the
  // upstream 双槍 self route: both holes belong to this already selected
  // futanari target, and exactly one channel is currently occupied.
  if ((ctx.state.master.state.TALENT[TALENT_ID.双槍] ?? 0) !== 1) {
    return { ok: false as const, reason: { kind: "precondition" as const, message: "普通双穴路线仍需要第二参与者（ASSI）身份。" } };
  }
  if ((ctx.state.master.state.BASE[BASE_ID.勃起] ?? 0) < 1000) {
    return { ok: false as const, reason: { kind: "precondition" as const, message: "双槍插入需要主人勃起度达到 1000。" } };
  }

  const activeSites = activeHInsertionSites(ctx.state, ctx.target);
  if (activeSites.length !== 1) {
    return { ok: false as const, reason: { kind: "precondition" as const, message: "双穴插入需要目标已有且仅有一个 V／A 插入状态。" } };
  }

  const sex = target.state.TALENT[TALENT_ID.性別] ?? 0;
  if ((sex & 1) === 0 || (sex & 2) === 0) {
    return { ok: false as const, reason: { kind: "precondition" as const, message: "有界双槍路线只接受同时具备 V 与 P 的目标。" } };
  }
  if (COM71_BLOCKED_EQUIPMENT.some((id) => readTequip(ctx.state.master, id) !== 0 || readTequip(target, id) !== 0)) {
    return { ok: false as const, reason: { kind: "precondition" as const, message: "当前插入道具会阻止双穴插入。" } };
  }
  if (readTequip(ctx.state.master, TEQUIP_ID.新妻PLAY) !== 0 || readTequip(target, TEQUIP_ID.新妻PLAY) !== 0) {
    return { ok: false as const, reason: { kind: "precondition" as const, message: "新妻 PLAY 中不能进行双穴插入。" } };
  }
  if (readTequip(target, TEQUIP_ID.下半身着衣状況) > 1) {
    return { ok: false as const, reason: { kind: "precondition" as const, message: "目标下半身衣着尚未解除。" } };
  }

  const timeStop = (ctx.state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0;
  if (!timeStop && (target.state.EXP[EXP_ID.Ａ経験] ?? 0) < expLv(3)) {
    return { ok: false as const, reason: { kind: "precondition" as const, message: "清醒状态下需要足够的 A 经验才能双穴插入。" } };
  }
  return checkHBaseResourceAvailability(ctx, timeStop
    ? { master: { [BASE_ID.TSP]: 220 } }
    : {
        master: { [BASE_ID.体力]: 40, [BASE_ID.気力]: 220 },
        target: { [BASE_ID.体力]: 160, [BASE_ID.気力]: 350 },
      });
}

export const comf71HandlerEntry: HandlerEntry = {
  commandNo: 71,
  hModeMenuCheck: comf71Gate,
  execCheck: comf71Gate,
  handler: (ctx: CommandContext) => {
    const gate = comf71Gate(ctx);
    if (!gate.ok) {
      return {
        state: cloneGameState(ctx.state),
        events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text: `（双穴插入：${gate.reason.message}）` }],
        outcome: "blocked" as const,
        failReason: gate.reason,
      };
    }

    const next = cloneGameState(ctx.state);
    const target = next.charas[ctx.target]!;
    const master = next.master;
    const existingSite = activeHInsertionSite(next, ctx.target)!;
    const secondSite = existingSite === "v" ? "a" : "v";
    syncHInsertionChannel(next, ctx.target, secondSite, PLAYER);

    master.state.TCVAR[TCVAR_ID.行為者] = PLAYER;
    target.state.TCVAR[TCVAR_ID.行為者] = PLAYER;
    master.state.TCVAR[TCVAR_ID.射精箇所] = existingSite === "v" ? 2 : 1;
    master.state.TCVAR[TCVAR_ID.射精快感強度] = existingSite === "v" ? 2500 : 1500;
    target.state.TCVAR[TCVAR_ID.射精箇所] = existingSite === "v" ? 1 : 2;
    target.state.TCVAR[TCVAR_ID.射精快感強度] = existingSite === "v" ? 1500 : 2500;

    const timeStop = (next.flagStore[FLAG_ID.時間停止] ?? 0) !== 0;
    const masterSources: Record<number, number> = {
      [SOURCE_ID.快Ｃ]: 400,
    };
    const targetSources: Record<number, number> = {
      [SOURCE_ID.快Ｃ]: 400,
      [SOURCE_ID.快Ｖ]: 400,
      [SOURCE_ID.快Ａ]: 400,
    };

    if (timeStop) {
      setMasterBase(next, BASE_ID.TSP, (getMasterBase(next, BASE_ID.TSP) ?? 0) - 220);
      targetSources[SOURCE_ID.苦痛] = 650;
      const virgin = target.state.TALENT[TALENT_ID.処女] ?? 0;
      if (virgin === 1) targetSources[SOURCE_ID.苦痛] += 2750;
      else if (virgin === 2) targetSources[SOURCE_ID.苦痛] += 1750;
      addExp(master, EXP_ID.時姦経験);
    } else {
      setMasterBase(next, BASE_ID.体力, (getMasterBase(next, BASE_ID.体力) ?? 0) - 40);
      setMasterBase(next, BASE_ID.気力, (getMasterBase(next, BASE_ID.気力) ?? 0) - 220);
      target.state.BASE[BASE_ID.体力] = (target.state.BASE[BASE_ID.体力] ?? 0) - 160;
      target.state.BASE[BASE_ID.気力] = (target.state.BASE[BASE_ID.気力] ?? 0) - 350;
      Object.assign(targetSources, {
        [SOURCE_ID.性行動]: 500,
        [SOURCE_ID.屈従]: 1000,
        [SOURCE_ID.逸脱]: 500,
        [SOURCE_ID.反感]: 500,
        [SOURCE_ID.情愛]: 300,
        [SOURCE_ID.苦痛]: 1300,
      });
      if ((target.state.TALENT[TALENT_ID.自己愛] ?? 0) < 0 || (target.state.TALENT[TALENT_ID.抵抗] ?? 0) !== 0) {
        // The unqualified TARGET and LOCAL arms collapse to the same selected
        // slot in this bounded single-target route, so both +500 additions
        // are retained instead of silently losing one source arm.
        targetSources[SOURCE_ID.鬱屈] = (targetSources[SOURCE_ID.鬱屈] ?? 0) + 1000;
      }
      if ((target.state.TALENT[TALENT_ID.貞操] ?? 0) !== 0 && (target.state.TALENT[TALENT_ID.恋慕] ?? 0) === 0) {
        targetSources[SOURCE_ID.反感] = (targetSources[SOURCE_ID.反感] ?? 0) + 1000;
      }
      const virgin = target.state.TALENT[TALENT_ID.処女] ?? 0;
      if (virgin === 1) {
        targetSources[SOURCE_ID.苦痛] += 5500;
        targetSources[SOURCE_ID.反感] += 3000;
      } else if (virgin === 2) {
        targetSources[SOURCE_ID.苦痛] += 3500;
        targetSources[SOURCE_ID.反感] += 1000;
      }
    }

    // COM71 calls both PAIN_CHECK_V and PAIN_CHECK_A before SOURCE_CHECK.
    // Apply both ladders to one source map so ORGASM_ADD/CUP flush runs once.
    const withVainPain = applyHInsertionPain(targetSources, target, "v");
    const settledSources = applyHInsertionPain(withVainPain, target, "a");
    settleSourcePalam(next, master, master, masterSources);
    const settled = applySourceCheck(next, ctx.target, settledSources, 0);

    addExp(master, EXP_ID.挿入経験);
    addExp(target, EXP_ID.挿入経験);
    addExp(target, EXP_ID.Ｖ性交経験);
    addExp(target, EXP_ID.Ａ性交経験);

    const virgin = target.state.TALENT[TALENT_ID.処女] ?? 0;
    if (virgin === 1 || virgin === 2) {
      const anomalyBit = 1 << 9;
      if (((target.state.CFLAG[CFLAG_ID.異常経験] ?? 0) & anomalyBit) === 0) {
        addExp(target, EXP_ID.異常経験, 2);
        target.state.CFLAG[CFLAG_ID.異常経験] = (target.state.CFLAG[CFLAG_ID.異常経験] ?? 0) | anomalyBit;
      }
    }
    const history = [
      ...recordHChannelHistory(next, ctx.target, "v"),
      ...recordHChannelHistory(next, ctx.target, "a"),
    ];

    return {
      state: next,
      events: [
        {
          kind: "NARRATION" as const,
          timestamp: ctx.now(),
          text: `%CALLNAME:MASTER% 进行了双穴插入。好感度 ${settled.favorDelta >= 0 ? "+" : ""}${settled.favorDelta}。`,
        },
        ...settled.events,
        ...history.map((text) => ({ kind: "NARRATION" as const, timestamp: ctx.now(), text })),
      ],
      outcome: "ok" as const,
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
    return { ok: false, reason: { kind: "precondition", message: "让助手侵犯需要助手（ASSI）子系统。" } };
  },
  handler: (ctx: CommandContext) => {
    // Body is a COM_ORDER reasonwall (欲望/奉仕精神/快楽刻印/欲情/羞恥心/献身
    // /淫乱 + 助手処女 -15, 実行値≥40) then 射精部位=1/強度2000 + TEQUIP:ASSI:50
    // + SOURCE + 助手処女喪失 (屈従×5/逸脱×3/異常経験/従順=2) + EXP:ASSI:Ｖ経験.
    // Needs ASSI + COM_ORDER + 体格 + TEQUIP. Blocked — no shell.
    return {
      state: cloneGameState(ctx.state),
      events: [{ kind: "NARRATION", timestamp: ctx.now(), text: "（让助手侵犯：ASSI 子系统与 COM_ORDER 判定尚未建模。）" }],
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
    return { ok: false, reason: { kind: "precondition", message: "侵犯助手需要助手（ASSI）在场。" } };
  },
  handler: (ctx: CommandContext) => {
    // Body is a COM_ORDER reasonwall (欲望/快楽刻印/欲情/助手露出癖/助手恋慕·親愛
    // + 助手処女 -50, 実行値≥40) then 射精部位=1/強度1500 + TEQUIP:ASSI:50 +
    // SOURCE + 助手処女喪失 (逸脱×20/屈従×3) + EXP:ASSI:Ｖ経験/百合経験.
    // Needs ASSI + COM_ORDER + TEQUIP. Blocked — no shell.
    return {
      state: cloneGameState(ctx.state),
      events: [{ kind: "NARRATION", timestamp: ctx.now(), text: "（侵犯助手：ASSI 子系统与 COM_ORDER 判定尚未建模。）" }],
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
    return { ok: false, reason: { kind: "precondition", message: "双人侍奉需要助手（ASSI）在场。" } };
  },
  handler: (ctx: CommandContext) => {
    // Body: 射精部位=4 口淫 on MASTER(強度750) + ASSI(強度750); DOWNBASE 80/250;
    // SOURCE 情愛150/性行動400/達成300/屈従1000/逸脱500/反感500; 鬱屈+700 if
    // 自己愛<0||抵抗; STAIN 口↔主人Ｐ/助手Ｐ; EXP:口淫経験+2; HETEROSEX;
    // 猫舌→嗜虐快楽経験; TCVAR:TARGET:ＦＫ喪失=2. Needs ASSI + STAIN + HETEROSEX.
    // Blocked — no shell.
    return {
      state: cloneGameState(ctx.state),
      events: [{ kind: "NARRATION", timestamp: ctx.now(), text: "（双人侍奉：ASSI 子系统尚未建模。）" }],
      outcome: "blocked",
      failReason: { kind: "precondition", message: "ASSI subsystem (主人Ｐ+助手Ｐ) deferred" },
    };
  },
};

function addExp(slot: { state: { EXP: Record<number, number> } }, id: number, amount = 1): void {
  slot.state.EXP[id] = (slot.state.EXP[id] ?? 0) + amount;
}

export const comf26HandlerEntry: HandlerEntry = {
  commandNo: 26,
  // COMABLE26 is still marked incomplete because its original gate is
  // expressed through TEQUIP pose links.  COM26 itself now owns the
  // canonical V/A-link check below, so expose exactly that bounded gate to
  // the H menu and to resolveCommand instead of failing closed before the
  // handler can settle the modeled withdrawal path.
  hModeMenuCheck: (ctx: CommandContext) => {
    if (!ctx.state.charas[ctx.target]) {
      return { ok: false, reason: { kind: "precondition", message: "拔出需要在场的目标角色。" } };
    }
    return activeHInsertionSite(ctx.state, ctx.target)
      ? { ok: true }
      : { ok: false, reason: { kind: "precondition", message: "当前没有可解除的 V／A 插入状态。" } };
  },
  execCheck: (ctx: CommandContext) => {
    if (!ctx.state.charas[ctx.target]) {
      return { ok: false, reason: { kind: "precondition", message: "拔出需要在场的目标角色。" } };
    }
    const site = activeHInsertionSite(ctx.state, ctx.target);
    return site
      ? { ok: true }
      : { ok: false, reason: { kind: "precondition", message: "当前没有可解除的 V／A 插入状态。" } };
  },
  handler: (ctx: CommandContext) => {
    const next = cloneGameState(ctx.state);
    const activeSites = activeHInsertionSites(next, ctx.target);
    // COMF26 records both VAGINAL and ANAL when both insertion links exist;
    // its source branch selects ANAL whenever that marker is present. COM71
    // makes this a valid dual state, so withdrawal must use the same priority.
    const site = activeSites.includes("a") ? "a" : activeHInsertionSite(next, ctx.target);
    if (!site) {
      return {
        state: next,
        events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text: "当前没有可解除的插入状态。" }],
        outcome: "blocked" as const,
        failReason: { kind: "precondition" as const, message: "当前没有可解除的 V／A 插入状态。" },
      };
    }
    const target = next.charas[ctx.target]!;
    const master = next.master;
    const insideSite: 1 | 2 = site === "v" ? 1 : 2;
    const intercourseExp = site === "v" ? EXP_ID.Ｖ性交経験 : EXP_ID.Ａ性交経験;
    const pleasureSource = site === "v" ? SOURCE_ID.快Ｖ : SOURCE_ID.快Ａ;
    const orificeAbl = site === "v" ? ABL_ID.膣 : ABL_ID.肛門;
    const wearingCondom = isEquipped(master, TEQUIP_ID.避孕套);
    const critical = (master.state.TCVAR[TCVAR_ID.要去了] ?? 0) !== 0;
    const source: Record<number, number> = {};

    target.state.TCVAR[TCVAR_ID.行為者] = PLAYER;
    master.state.TCVAR[TCVAR_ID.行為者] = PLAYER;
    let outcome: "withdraw" | "outside" | "inside" | "condom" = "withdraw";
    let failureReason: "burst" | "held" | null = null;
    if (critical) {
      if (wearingCondom) {
        outcome = "condom";
      } else {
        const overstimulated = (master.state.BASE[BASE_ID.射精] ?? 0) >= 15000;
        const developed = (target.state.ABL[orificeAbl] ?? 0) >= 4;
        const burst = overstimulated && (developed || ctx.rng.int(3) <= 1);
        const addiction = target.state.ABL[site === "v" ? ABL_ID.膣射中毒 : ABL_ID.肛射中毒] ?? 0;
        const pregnancyWish = (target.state.TALENT[TALENT_ID.妊娠願望] ?? 0) !== 0;
        const fill = bodyFillRate(target.state, site === "v" ? 1 : 2, true) ?? 0;
        // The target's wish/addiction can stop a withdrawal, but a pregnancy
        // wish is only one upstream arm, not an unconditional override.
        const wantsInside = addiction > 3 || (pregnancyWish && fill < 50);
        const held = !burst && wantsInside && ctx.rng.int(2) !== 0;
        if (burst || held) {
          outcome = "inside";
          failureReason = burst ? "burst" : "held";
        } else {
          outcome = "outside";
        }
      }
    }

    if (outcome === "inside") {
      master.state.TCVAR[TCVAR_ID.射精箇所] = insideSite;
      master.state.TCVAR[TCVAR_ID.射精快感強度] = 750 + (master.state.ABL[orificeAbl] ?? 0) * 80;
      target.state.TCVAR[TCVAR_ID.射精快感強度] = 500 +
        100 * (target.state.ABL[site === "v" ? ABL_ID.Ｖ感覚 : ABL_ID.Ａ感覚] ?? 0);
      settleHEjaculation(next, {
        sender: PLAYER,
        receiver: ctx.target,
        channel: site,
        inside: true,
        amount: undefined,
        pulloutFailed: failureReason !== null,
      });
      addExp(target, intercourseExp);
      source[pleasureSource] = 150;
    } else if (outcome === "outside" || outcome === "condom") {
      master.state.TCVAR[TCVAR_ID.射精箇所] = outcome === "condom" ? insideSite : 8;
      master.state.TCVAR[TCVAR_ID.射精快感強度] = 350 + (master.state.ABL[orificeAbl] ?? 0) * 50;
      settleHEjaculation(next, {
        sender: PLAYER,
        receiver: ctx.target,
        channel: site,
        inside: false,
        site: outcome === "condom" ? insideSite : 8,
        condom: outcome === "condom",
        amount: undefined,
      });
      source[pleasureSource] = 60;
      if (outcome === "condom") setEquipped(master, TEQUIP_ID.避孕套, false);
    } else {
      master.state.TCVAR[TCVAR_ID.射精箇所] = 0;
      master.state.TCVAR[TCVAR_ID.射精快感強度] = 0;
    }

    const settled = Object.keys(source).length > 0
      ? applyHSourceCheck(next, ctx.target, source, site, 0)
      : { events: [], favorDelta: 0 };
    const history = activeSites.flatMap((activeSite) =>
      settleHInsertionHistory(next, ctx.target, activeSite));
    const channelHistory = activeSites.flatMap((activeSite) =>
      recordHChannelHistory(next, ctx.target, activeSite));
    clearHInsertionState(next, ctx.target);
    const clockEvents = advanceTimeTicks(next, 1).map((event) => ({ ...event, timestamp: ctx.now() }));
    const choiceText = outcome === "inside"
      ? failureReason === "held"
        ? `本想拔出，却被对方阻止，只能在${site === "v" ? "膣内" : "肛门内"}射精了。`
        : `没能忍住，在${site === "v" ? "膣内" : "肛门内"}暴发后才拔出。`
      : outcome === "outside"
        ? "赶在临界前拔出，在体外射精了。"
        : outcome === "condom"
          ? "拔出后在避孕套内射精，并取下了避孕套。"
          : `从${site === "v" ? "膣" : "肛门"}中拔出，解除了插入状态。`;
    return {
      state: next,
      events: [
        { kind: "NARRATION" as const, timestamp: ctx.now(), text: choiceText },
        ...history.map((text) => ({ kind: "NARRATION" as const, timestamp: ctx.now(), text })),
        ...channelHistory.map((text) => ({ kind: "NARRATION" as const, timestamp: ctx.now(), text })),
        ...clockEvents,
        ...settled.events,
      ],
      outcome: "ok" as const,
    };
  },
};
