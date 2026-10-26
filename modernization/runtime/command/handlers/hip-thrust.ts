/**
 * Phase 7 (Wave 4f) — H-mode thrust commands COMF317 腰を動かす (V) +
 * COMF318 腰を動かす（Ａ）. The two are byte-mirrors (318 swaps 膣→肛門 /
 * 快Ｖ→快Ａ / Ｖ性交経験→Ａ性交経験 / PAIN_CHECK_V→A / STAIN 3·6→4·7), so
 * they share one parametric core.
 *
 * Faithful core (`@COM317`/`@COM318` body, the awake normal branch):
 *   - 行為者: `TCVAR:116 = PLAYER` (=0 master).
 *   - 射精箇所: `TCVAR:PLAYER:2 = 1`(膣内)/`2`(肛門); `TCVAR:TARGET:2 = 13`(Ｖ責め)/`12`(Ａ責め).
 *   - 強度: `TCVAR:PLAYER:4 = 500 + ABL:腰*50 + ABL:膣(or肛門)*50`; `TCVAR:TARGET:4 = 1500`.
 *   - DOWNBASE master: 体力 50, 気力 80 (`DOWNBASE:PLAYER:…` is explicitly master).
 *   - SOURCE:MASTER:快Ｃ = 40 + ABL:腰*50 + ABL:膣(肛門)*50.
 *   - SOURCE (target): 快Ｖ(快Ａ) = 50 + ABL:PLAYER:腰*20; 情愛200/苦痛250/欲情250/露出150/逸脱150/反感100.
 *   - 鬱屈 += 20 if `TALENT:自己愛 < 0 || TALENT:抵抗`.
 *   - EXP: PLAYER:挿入経験++; target Ｖ(Ａ)性交経験++.
 *   - Ｖ(Ａ)コンボ rhythm (`TFLAG:193` == 2 / == 3) amplifies 快Ｖ(快Ａ)+欲情+屈従+情愛
 *     and bumps 強度; `TFLAG:193==3` adds `好感度BONUS=100` + 快Ｃ+30 if `ABL:Ｖ(Ａ)感覚>=5`.
 *   - TIME += 5; RETURN 1.
 *
 * Time-stop bypass branch is reachable only after the menu's
 * `FLAG:70 && CFLAG:TARGET:時間停止行動 != 0` gate: `BASE:MASTER:TSP -= 80`;
 * `SOURCE:MASTER:快Ｃ = 40 + ABL:膣(肛門)*50`;
 * `SOURCE:快Ｖ(快Ａ) = 40 + ABL:PLAYER:腰*30`; PLAYER:挿入経験++; target Ｖ(Ａ)性交経験++;
 * no DOWNBASE, no TIME advance (the ERB branch has no `TIME += 5` — only the awake ELSE
 * branch advances time). RETURN 1.
 *
 * **DEFERRED** (faithfully recorded, not silently dropped):
 *   - `@COM_ABLE` full gate stack — TFLAG:100 / GLOBAL_COMABLE / 亲熱>=2 / 着衣 /
 *     睡眠+恶作剧 / 行動==5 / 约会 / TCVAR:TARGET:100(101)==PLAYER /
 *     GETBIT(TCVAR:26,8), plus remaining command-specific state. The bounded
 *     modern gate also requires the channel's existing master-P insertion
 *     (the upstream ADD_CHARA_POSE check), along with 诶嘿嘿==2, 気力>0, and
 *     not 陪睡中.
 *   - The `ABL:MASTER:腰 >= 3` Ｖ(Ａ)コンボ picker — `COM_ALTER_317/318` (an
 *     `ASK_M` B9 sub-menu 激烈打夯/紧贴顶弄/扭腰碾弄) + `EFFECTIVE_PATTERN_V/A` +
 *     `TEQUIP:Ｖ(Ａ)コンボ` state machine. The `TFLAG:193` *amplification* (the
 *     downstream effect of a picked combo) IS modeled, but the combo *selection*
 *     upstream is deferred → `TFLAG:193` stays 0 in trial.
 *   - `HETEROSEX` EXP — `EXP:(50+HETEROSEX)` += 4 (same-sex exp).
 *   - `CSTR:PLAYER:10` / `CSTR:TARGET:10` intercourse log appends.
 *
 * Shared V/A settlement now owns PAIN_CHECK, orgasm-before-CUP-flush, V/A
 * history, and repeated-insertion STAIN transfer; EVENTCOMEND2 owns the
 * cross-turn residue/erection bookkeeping.
 */

import type { GameState, CharaSlot } from "../../state/game-state.js";
import type { CommandContext, HandlerEntry } from "../types.js";
import { cloneGameState } from "../../state/game-state.js";
import {
  applyOneMinuteHCommandTimeCorrection,
  settleSourcePalam,
} from "../source-check.js";
import {
  applyHSourceCheck,
  applyHInsertionPoseEffects,
  recordHChannelHistory,
  syncHChannelStain,
  type HChannel,
} from "../h-v-a-settlement.js";
import { hasCurrentHInsertion } from "../h-interaction.js";
import {
  checkHBaseResourceAvailability,
  type HBaseResourceCheckResult,
} from "../h-base-resources.js";
import {
  ABL_ID,
  BASE_ID,
  CFLAG_ID,
  EXP_ID,
  FLAG_ID,
  SOURCE_ID,
  TALENT_ID,
  TCVAR_ID,
  advanceTimeTicks,
  getMasterBase,
  setMasterBase,
} from "../../state/settlement.js";
import { TFLAG_ID, getTflag, setTflag } from "../../state/tflag.js";
import { readCurrentTouchPose } from "../../state/touch-state.js";

/** PLAYER index = master (0). */
const PLAYER = 0;

interface ThrustVariant {
  commandNo: number;
  /** Target's stimulation-site 射精箇所 (Ｖ責め=13 / Ａ責め=12). */
  targetSite: number;
  /** Master's ejaculation-site 射精箇所 (膣内=1 / 肛門=2). */
  playerSite: 1 | 2;
  /** ABL used in the master 快Ｃ + 強度 formula (膣=54 / アナル=55). */
  orificeAbl: number;
  /** ABL used in the target 快Ｖ/快Ａ formula (Ｖ感覚 unused; reads master 腰). */
  pleasureSource: number; // SOURCE_ID.快Ｖ (1) or 快Ａ (2)
  /** EXP id for the target's intercourse experience (Ｖ性交経験=20 / Ａ性交経験=21). */
  intercourseExp: number;
  /** EXP id for the target's body-channel experience (Ｖ経験=1 / Ａ経験=2). */
  channelExp: number;
  /** EXP id granted by the upstream pose-6 expansion arm. */
  expansionExp: number;
  channel: HChannel;
  /** ABL:Ｖ感覚(1) / Ａ感覚(2) for the combo-3 快Ｃ+30 arm. */
  senseAbl: number;
  word: string;
}

const V_VARIANT: ThrustVariant = {
  commandNo: 317,
  targetSite: 13,
  playerSite: 1,
  orificeAbl: ABL_ID.膣,
  pleasureSource: SOURCE_ID.快Ｖ,
  intercourseExp: EXP_ID.Ｖ性交経験,
  channelExp: EXP_ID.Ｖ経験,
  expansionExp: EXP_ID.Ｖ拡張経験,
  channel: "v",
  senseAbl: ABL_ID.Ｖ感覚,
  word: "Ｖ",
};

const A_VARIANT: ThrustVariant = {
  commandNo: 318,
  targetSite: 12,
  playerSite: 2,
  orificeAbl: ABL_ID.肛門,
  pleasureSource: SOURCE_ID.快Ａ,
  intercourseExp: EXP_ID.Ａ性交経験,
  channelExp: EXP_ID.Ａ経験,
  expansionExp: EXP_ID.Ａ拡張経験,
  channel: "a",
  senseAbl: ABL_ID.Ａ感覚,
  word: "Ａ",
};

function abl(slot: CharaSlot, id: number): number {
  return slot.state.ABL[id] ?? 0;
}

function buildThrustHandler(variant: ThrustVariant): HandlerEntry {
  // P1-14 逆推: 317/318 腰を動かす are partner-led (诶嘿嘿==2) acts. The same
  // check doubles as the menu gate so they surface in the H menu (and are
  // hidden on the everyday page via requiresHMode).
  const partnerLedCheck = (ctx: CommandContext): HBaseResourceCheckResult => {
    const target = ctx.state.charas[ctx.target];
    if (!target) return { ok: false, reason: { kind: "precondition", message: "no target" } };
    // Core reachability gates we model; the rest of @COM_ABLE deferred (header).
    if ((target.state.CFLAG[CFLAG_ID.诶嘿嘿] ?? 0) !== 2) {
      return { ok: false, reason: { kind: "precondition", message: "not in partner-led H mode" } };
    }
    if ((ctx.state.master.state.BASE[BASE_ID.気力] ?? 0) <= 0) {
      return { ok: false, reason: { kind: "precondition", message: "master 気力 exhausted" } };
    }
    if ((target.state.CFLAG[CFLAG_ID.陪睡中] ?? 0) !== 0) {
      return { ok: false, reason: { kind: "precondition", message: "陪睡中" } };
    }
    const timeStop = (ctx.state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0;
    if (timeStop && (target.state.CFLAG[CFLAG_ID.時間停止行動] ?? 0) === 0) {
      return {
        ok: false,
        reason: { kind: "precondition", message: "目标尚未在时停中行动" },
      };
    }
    if (!hasCurrentHInsertion(ctx.state, ctx.target, variant.channel)) {
      return {
        ok: false,
        reason: {
          kind: "precondition",
          message: `${variant.word}插入状态尚未建立`,
        },
      };
    }
    return checkHBaseResourceAvailability(
      ctx,
      timeStop
        ? { master: { [BASE_ID.TSP]: 80 } }
        : { master: { [BASE_ID.体力]: 50, [BASE_ID.気力]: 80 } },
    );
  };
  return {
    commandNo: variant.commandNo,
    execCheck: partnerLedCheck,
    hModeMenuCheck: partnerLedCheck,
    handler: (ctx: CommandContext) => {
      const gate = partnerLedCheck(ctx);
      if (!gate.ok) {
        return {
          state: cloneGameState(ctx.state),
          events: [{
            kind: "STATUS_MESSAGE" as const,
            timestamp: ctx.now(),
            source: "system" as const,
            text: gate.reason.message,
          }],
          outcome: "blocked" as const,
          failReason: gate.reason,
        };
      }
      const next: GameState = cloneGameState(ctx.state);
      const target = next.charas[ctx.target]!;
      const master = next.master;

      // ----- COM別FLAG: 行為者 + 射精箇所 + 強度 (ERB COM-FLAG block) -----
      target.state.TCVAR[TCVAR_ID.行為者] = PLAYER;
      master.state.TCVAR[TCVAR_ID.射精箇所] = variant.playerSite;
      master.state.TCVAR[TCVAR_ID.射精快感強度] = 500 + abl(master, ABL_ID.腰) * 50 + abl(master, variant.orificeAbl) * 50;
      target.state.TCVAR[TCVAR_ID.射精箇所] = variant.targetSite;
      target.state.TCVAR[TCVAR_ID.射精快感強度] = 1500;
      const history = recordHChannelHistory(next, ctx.target, variant.channel);
      syncHChannelStain(target, master, variant.channel);

      const timeStop = (next.flagStore[FLAG_ID.時間停止] ?? 0) !== 0;

      if (timeStop) {
        // ----- Time-stop bypass branch (ERB IF arm) -----
        setMasterBase(next, BASE_ID.TSP, (getMasterBase(next, BASE_ID.TSP) ?? 0) - 80);
        const masterSources: Record<number, number> = {
          [SOURCE_ID.快Ｃ]: 40 + abl(master, variant.orificeAbl) * 50,
        };
        const targetSources: Record<number, number> = {
          [variant.pleasureSource]: 40 + abl(master, ABL_ID.腰) * 30,
        };
        master.state.EXP[EXP_ID.挿入経験] = (master.state.EXP[EXP_ID.挿入経験] ?? 0) + 1;
        target.state.EXP[variant.intercourseExp] = (target.state.EXP[variant.intercourseExp] ?? 0) + 1;
        settleSourcePalam(next, master, master, masterSources);
        applyHSourceCheck(next, ctx.target, targetSources, variant.channel, 0);
        target.state.EXP[variant.channelExp] = (target.state.EXP[variant.channelExp] ?? 0) + 1;
        return {
          state: next,
          events: [
            {
              kind: "NARRATION" as const,
              timestamp: ctx.now(),
              text: `%CALLNAME:MASTER% 在时间停止中摆动腰身（${variant.word}）。（TSP -80）`,
            },
            ...history.map((text) => ({
              kind: "NARRATION" as const,
              timestamp: ctx.now(),
              text,
            })),
          ],
          outcome: "ok" as const,
        };
      }

      // ----- Awake normal branch (ERB ELSE arm) -----
      // DOWNBASE master: 体力 50, 気力 80.
      setMasterBase(next, BASE_ID.体力, (getMasterBase(next, BASE_ID.体力) ?? 0) - 50);
      setMasterBase(next, BASE_ID.気力, (getMasterBase(next, BASE_ID.気力) ?? 0) - 80);

      // Master 快Ｃ SOURCE (settleSourcePalam master-as-target).
      const masterSources: Record<number, number> = {
        [SOURCE_ID.快Ｃ]: 40 + abl(master, ABL_ID.腰) * 50 + abl(master, variant.orificeAbl) * 50,
      };

      // Target SOURCE set.
      const targetSources: Record<number, number> = {
        [variant.pleasureSource]: 50 + abl(master, ABL_ID.腰) * 20,
        [SOURCE_ID.情愛]: 200,
        [SOURCE_ID.苦痛]: 250,
        [SOURCE_ID.欲情]: 250,
        [SOURCE_ID.露出]: 150,
        [SOURCE_ID.逸脱]: 150,
        [SOURCE_ID.反感]: 100,
      };

      // 鬱屈 += 20 if 自己愛<0 || 抵抗.
      if ((target.state.TALENT[TALENT_ID.自己愛] ?? 0) < 0 || (target.state.TALENT[TALENT_ID.抵抗] ?? 0) !== 0) {
        targetSources[SOURCE_ID.鬱屈] = (targetSources[SOURCE_ID.鬱屈] ?? 0) + 20;
      }

      // TRACHECK_EQUIP_挿入継続 adds the active V/A pose pain and favorite-
      // pose SOURCE quanta only in the awake continuation branch.  Keep this
      // before the shared pain ladder and SOURCE_CHECK conversion.
      Object.assign(targetSources, applyHInsertionPoseEffects(targetSources, target, variant.channel));
      if (readCurrentTouchPose(target) === 6) {
        target.state.EXP[variant.expansionExp] = (target.state.EXP[variant.expansionExp] ?? 0) + 1;
      }

      // EXP: PLAYER:挿入経験++ (pre-combo), target Ｖ(Ａ)性交経験++ (post-combo in ERB,
      // but the combo arm is an amplifier not the only writer — model base increment here).
      master.state.EXP[EXP_ID.挿入経験] = (master.state.EXP[EXP_ID.挿入経験] ?? 0) + 1;
      target.state.EXP[variant.intercourseExp] = (target.state.EXP[variant.intercourseExp] ?? 0) + 1;

      // ----- Ｖ(Ａ)コンボ rhythm (TFLAG:193 == 2 / == 3) -----
      // Combo SELECTION (COM_ALTER_317/318 B9 + EFFECTIVE_PATTERN) is deferred →
      // TFLAG:193 stays 0 in trial. A test may seed it to exercise the arms.
      const combo = getTflag(next, TFLAG_ID.SELECTCOM的分岐);
      if (combo === 2) {
        targetSources[variant.pleasureSource] = (targetSources[variant.pleasureSource] ?? 0) + (10 + abl(master, ABL_ID.腰) * 15);
        targetSources[SOURCE_ID.欲情] = (targetSources[SOURCE_ID.欲情] ?? 0) + 100;
        targetSources[SOURCE_ID.屈従] = (targetSources[SOURCE_ID.屈従] ?? 0) + 100;
        targetSources[SOURCE_ID.情愛] = (targetSources[SOURCE_ID.情愛] ?? 0) + 50;
        master.state.TCVAR[TCVAR_ID.射精快感強度] = (master.state.TCVAR[TCVAR_ID.射精快感強度] ?? 0) + abl(master, variant.orificeAbl) * 50;
        target.state.EXP[variant.intercourseExp] = (target.state.EXP[variant.intercourseExp] ?? 0) + 1;
      } else if (combo === 3) {
        targetSources[variant.pleasureSource] = (targetSources[variant.pleasureSource] ?? 0) + (50 + abl(master, ABL_ID.腰) * 30);
        targetSources[SOURCE_ID.欲情] = (targetSources[SOURCE_ID.欲情] ?? 0) + 200;
        targetSources[SOURCE_ID.屈従] = (targetSources[SOURCE_ID.屈従] ?? 0) + 300;
        targetSources[SOURCE_ID.情愛] = (targetSources[SOURCE_ID.情愛] ?? 0) + 200;
        master.state.TCVAR[TCVAR_ID.射精快感強度] = (master.state.TCVAR[TCVAR_ID.射精快感強度] ?? 0) + abl(master, variant.orificeAbl) * 150;
        if (abl(target, variant.senseAbl) >= 5) {
          masterSources[SOURCE_ID.快Ｃ] = (masterSources[SOURCE_ID.快Ｃ] ?? 0) + 30;
        }
        target.state.EXP[variant.intercourseExp] = (target.state.EXP[variant.intercourseExp] ?? 0) + 1;
        setTflag(next, TFLAG_ID.好感度BONUS, 100);
      }

      // TIME += 5 (awake branch only); fold TRACHECK_TIME's conditional −4
      // before the clock authority advances, as for the factory COMF paths.
      const timeCost = applyOneMinuteHCommandTimeCorrection(
        next,
        variant.commandNo,
        ctx.target,
        5,
      );
      advanceTimeTicks(next, timeCost);

      // Settle: master 快Ｃ (master-as-target), target full set.
      settleSourcePalam(next, master, master, masterSources);
      const settled = applyHSourceCheck(next, ctx.target, targetSources, variant.channel, 0);
      target.state.EXP[variant.channelExp] = (target.state.EXP[variant.channelExp] ?? 0) + 1;

      const comboWord = combo === 2 ? "紧贴顶弄，" : combo === 3 ? "扭腰碾弄，" : "";
      return {
        state: next,
        events: [
          {
            kind: "NARRATION" as const,
            timestamp: ctx.now(),
            text: `%CALLNAME:MASTER% 摆动腰身（${variant.word}）。${comboWord}好感度 ${settled.favorDelta >= 0 ? "+" : ""}${settled.favorDelta}。`,
          },
          ...settled.events,
          ...history.map((text) => ({
            kind: "NARRATION" as const,
            timestamp: ctx.now(),
            text,
          })),
        ],
        outcome: "ok" as const,
      };
    },
  };
}

export const comf317HandlerEntry: HandlerEntry = buildThrustHandler(V_VARIANT);
export const comf318HandlerEntry: HandlerEntry = buildThrustHandler(A_VARIANT);
