/**
 * Phase A (实玩反馈 #2) — `COMF416 演奏する` (perform music) ORCHESTRATOR.
 *
 * The single-target settlement math (`@COM416_1`: SOURCE 歓楽/征服 build,
 * outcome/skill/talent scaling, per-target BASE drain + TCVAR:演奏参加 + EXP)
 * already lives in `comf/defs/comf416.ts` as `comf416Def` and is pinned by
 * `comf416.test.ts`. This handler is the MULTI-TARGET orchestrator the
 * `makeComfHandler` factory can't express (the factory settles one
 * `ctx.target`), plus the instrument picker and the cross-target band bonus.
 *
 * Faithful to `@COM416` (`ERB/コマンド関連/COMF/日常系/COMF416 演奏する.ERB`):
 *
 *   1. Instrument selection (`MUSIC_ABLE(30-34)` gate, ERB 32-58). Modeled
 *      as a B9 `pickOne` prompt; when no answer is attached (the web UI does
 *      not yet render B9 pickers) the handler AUTO-PICKS the first usable
 *      instrument — the upstream 随心演奏 / `COM_ALTER_416` random path
 *      (ERB 35-44), made deterministic.
 *   2. Outcome roll ONCE for the whole performance (ERB 106-128 → TFLAG:193),
 *      shared across every listener (NOT re-rolled per target).
 *   3. master DOWNBASE 体力300/気力300 (ERB 155-156).
 *   4. Per-listener `@COM416_1` (reusing `comf416Def.buildSources` +
 *      `applyComfScaling` + `comf416Def.body`), accumulating each
 *      accompanist's 演奏参加 type (TCVAR set by the body).
 *   5. Band/dance bonus (ERB 168-213): `MUSIC_BONUS`/`DANCE_BONUS`/
 *      `BAND_BONUS` and the success/fail post-loop SOURCE adjustment — see
 *      {@link applyBandBonus}.
 *   6. One `applySourceCheck` per listener (SOURCE_CHECK settles each
 *      co-located chara's own SOURCE array — same as 豆まき 364).
 *   7. `TFLAG:好感度BONUS = BAND_BONUS*50` (ERB 215; consumer deferred in
 *      source-check.ts, recorded for parity) + `TIME += 30` (ERB 218).
 *
 * **DEFERRED (documented, faithful — no fake shells):**
 *   - おひねり (tips) / 投石 (THROW_STONE) / INTERRUPTED audience loop
 *     (ERB 17-104). These fire only for co-located `行動==5` WORKING charas
 *     whose 職種 is a banquet/play job (`宴会場所在判定` + `JOB_宴会参加`); the
 *     banquet/job subsystem isn't modeled (職種 never 49) and おひねり pays the
 *     `MONEY:2` casino-chip pool, which the runtime doesn't track. Inert in
 *     normal play → omitted rather than stubbed.
 *   - `演奏集合` NPC congregation (ERB 419-467) — pulls nearby charas into the
 *     room; deferred (scheduler/presence concern, like 364's congregation).
 *   - `TFLAG:192` forced arms (強制成功/失敗/終了), `MAGIC_DLC_大成功相关`,
 *     `MUSIC_BUFF_{N}` per-chara hooks, `ITEM:演奏指南書` EXP bonus,
 *     `GET_SUCCESS_RATE` failThreshold — all deferred in comf416Def already.
 */

import type { CommandContext, HandlerEntry } from "../types.js";
import type { ObservationEvent } from "../../../schemas/types.js";
import type { GameState } from "../../state/game-state.js";
import type { ComfOutcome } from "../comf/comf-def.js";
import { cloneGameState } from "../../state/game-state.js";
import {
  ABL_ID,
  BASE_ID,
  CFLAG_ID,
  FLAG_ID,
  SOURCE_ID,
  advanceTimeTicks,
  getMasterBase,
  setMasterBase,
} from "../../state/settlement.js";
import { applySourceCheck } from "../source-check.js";
import { presentNpcs } from "../../scene/presence.js";
import { itemCount } from "../../state/items.js";
import { pickOne, requirePickOne, type PromptSpec } from "../prompt.js";
import { comf416Def } from "../comf/defs/comf416.js";
import { buildComfCtx, applyComfScaling } from "../comf/make-comf-handler.js";
import { TFLAG_ID, setTflag } from "../../state/tflag.js";

type Blocked = { ok: false; reason: { kind: "precondition"; message: string } };

/** TALENT id for 音感 (sense of pitch) — mirrors comf416.ts. */
const TALENT_ONKAN = 162;
/** TCVAR id for 演奏参加 (accompaniment type: 1=楽器 2=歌唱 3=舞踏) — mirrors comf416.ts. */
const TCVAR_ENSOU_SANKA = 281;

/** Instrument item ids + display names (Item.csv 30-34). */
export const INSTRUMENTS: readonly { item: number; name: string }[] = [
  { item: 30, name: "電子琴" },
  { item: 31, name: "鋼琴" },
  { item: 32, name: "吉他" },
  { item: 33, name: "小號" },
  { item: 34, name: "小提琴" },
];

/**
 * Piano (31) location gate — ERB `MUSIC_ABLE` CASE 31 allows the piano only
 * at `GET_MAP_REPLACEMENT(9/222/309/335)` = 博麗神社居間 / 紅魔館広場 /
 * 地霊殿広場 / 寺子屋. Only 神社:居間 and 人間之里:寺子屋 are built in the modern
 * runtime; 紅魔館/地霊殿 deferred (unbuilt maps).
 */
const PIANO_LOCATIONS = new Set(["神社:居間", "人間之里:寺子屋"]);

/**
 * `@MUSIC_ABLE(itemId)` (ERB 372-392): the player must OWN the instrument,
 * plus per-instrument conditions — 31 鋼琴 needs a piano-room, 34 小提琴 needs
 * 音楽技能 ≥ 2; 30/32/33 only need ownership.
 */
export function musicAble(state: GameState, itemId: number): boolean {
  if (itemCount(state, itemId) < 1) return false;
  switch (itemId) {
    case 30:
    case 32:
    case 33:
      return true;
    case 31:
      return PIANO_LOCATIONS.has(state.master.location);
    case 34:
      return (state.master.state.ABL[ABL_ID.音楽技能] ?? 0) >= 2;
    default:
      return false;
  }
}

/** Item ids of every instrument the player can use right now (ascending). */
export function usableInstruments(state: GameState): number[] {
  return INSTRUMENTS.filter((i) => musicAble(state, i.item)).map((i) => i.item);
}

/** The instrument picker (`pickOne`, the collapse of ERB's ASK_M, 47-56). */
export function instrumentPrompt(state: GameState): PromptSpec {
  return pickOne(
    "要使用什么乐器呢……",
    INSTRUMENTS.map((i) => ({
      id: i.item,
      label: i.name,
      disabled: !musicAble(state, i.item),
    })),
  );
}

/** One listener's post-`@COM416_1` snapshot fed to {@link applyBandBonus}. */
export interface MusicTarget {
  charaNum: number;
  /** SOURCE map after buildSources + scaling (歓楽/征服). Mutated in place. */
  sources: Record<number, number>;
  /** TCVAR:演奏参加 — 0 none, 1 楽器, 2 歌唱, 3 舞踏. */
  sanka: number;
  /** This listener's ABL:音楽技能 (drives MUSIC_BONUS + 反感). */
  musicSkill: number;
  /** This listener's TALENT:音感 (drives MUSIC_BONUS). */
  onkan: number;
}

/**
 * Cross-target band/dance bonus (ERB 168-213). Pure so the band math is
 * pinned without driving the full settlement.
 *
 *   MUSIC_BONUS = Σ (音楽技能 + 2*音感) over 楽器/歌唱 accompanists (sanka 1|2)
 *   DANCE_BONUS = Σ 音楽技能 over 舞踏 accompanists (sanka 3)
 *   BAND_BONUS  = #(sanka==1) + #(sanka==2)         (ERB CMATCH, 181)
 *
 * Success (outcome >= 0, ERB 198-213):
 *   BAND_BONUS += outcome(1 on 大成功) + MAX(⌊√MUSIC_BONUS⌋ - 1, 0)
 *   per target: 歓楽 += MUSIC_BONUS*15, 征服 += MUSIC_BONUS*10,
 *               then ×(2+BAND+DANCE)/2  (era trunc, floored at 0)
 * Fail (outcome < 0, ERB 182-197):
 *   per target: 反感 += MUSIC_BONUS*音楽技能; if accompanying, 鬱屈 += 3*MUSIC_BONUS*音楽技能;
 *               反感/鬱屈 ×(2+BAND+DANCE)/2; 歓楽/征服 ×2/(2+BAND+DANCE) (damped).
 *
 * @returns the same target list with `sources` adjusted in place + the
 *          final `bandBonus` (for TFLAG:好感度BONUS).
 */
export function applyBandBonus(
  targets: MusicTarget[],
  outcome: ComfOutcome,
): { targets: MusicTarget[]; bandBonus: number } {
  let musicBonus = 0;
  let danceBonus = 0;
  let bandBonus = 0;
  for (const t of targets) {
    if (t.sanka === 1 || t.sanka === 2) {
      musicBonus += t.musicSkill + 2 * t.onkan;
      bandBonus += 1;
    } else if (t.sanka === 3) {
      danceBonus += t.musicSkill;
    }
  }

  if (outcome < 0) {
    // 失敗 branch (ERB 182-197).
    const denom = 2 + bandBonus + danceBonus;
    for (const t of targets) {
      let hanken = (t.sources[SOURCE_ID.反感] ?? 0) + musicBonus * t.musicSkill;
      let utsu = t.sources[SOURCE_ID.鬱屈] ?? 0;
      if (t.sanka !== 0) utsu += 3 * musicBonus * t.musicSkill;
      hanken = Math.trunc((hanken * denom) / 2);
      utsu = Math.trunc((utsu * denom) / 2);
      const kanraku = Math.trunc(((t.sources[SOURCE_ID.歓楽] ?? 0) * 2) / denom);
      const seifuku = Math.trunc(((t.sources[SOURCE_ID.征服] ?? 0) * 2) / denom);
      t.sources[SOURCE_ID.反感] = hanken;
      t.sources[SOURCE_ID.鬱屈] = utsu;
      t.sources[SOURCE_ID.歓楽] = kanraku;
      t.sources[SOURCE_ID.征服] = seifuku;
    }
  } else {
    // 成功 / 大成功 branch (ERB 198-213).
    bandBonus += outcome; // TFLAG:193 (1 on 大成功, 0 通常)
    bandBonus += Math.max(Math.floor(Math.sqrt(musicBonus)) - 1, 0);
    const factor = 2 + bandBonus + danceBonus;
    for (const t of targets) {
      const kanraku = (t.sources[SOURCE_ID.歓楽] ?? 0) + musicBonus * 15;
      const seifuku = (t.sources[SOURCE_ID.征服] ?? 0) + musicBonus * 10;
      t.sources[SOURCE_ID.歓楽] = Math.max(0, Math.trunc((kanraku * factor) / 2));
      t.sources[SOURCE_ID.征服] = Math.max(0, Math.trunc((seifuku * factor) / 2));
    }
  }
  return { targets, bandBonus };
}

/** `@COM_ABLE416` (ERB 332-370) — modelable guards only. */
function checkPerformEligible(ctx: CommandContext): { ok: true } | Blocked {
  const s = ctx.state;
  // ERB 368: FLAG:70 時間停止.
  if ((s.flagStore[FLAG_ID.時間停止] ?? 0) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "时间停止中无法演奏。" } };
  }
  // ERB 343-349: いずれの楽器（30-34）も使えない → no usable instrument blocks.
  if (usableInstruments(s).length === 0) {
    return { ok: false, reason: { kind: "precondition", message: "没有可以演奏的乐器。" } };
  }
  // ERB 356: BASE:MASTER:気力 <= 0.
  if (getMasterBase(s, BASE_ID.気力) <= 0) {
    return { ok: false, reason: { kind: "precondition", message: "精力不足。" } };
  }
  const t = s.charas[ctx.target];
  if (!t) {
    return { ok: false, reason: { kind: "precondition", message: "没有愿意聆听的对象。" } };
  }
  // ERB 358: CFLAG:诶嘿嘿 == 2 (partner-led H).
  if ((t.state.CFLAG[CFLAG_ID.诶嘿嘿] ?? 0) === 2) {
    return { ok: false, reason: { kind: "precondition", message: "现在的气氛不适合演奏。" } };
  }
  // ERB 362: 睡眠中 / 陪睡中.
  if ((t.state.CFLAG[CFLAG_ID.睡眠] ?? 0) !== 0 || (t.state.CFLAG[CFLAG_ID.陪睡中] ?? 0) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "对方正在睡觉。" } };
  }
  // ERB 365: 仕事中 (行動==5) かつ宴会参加者ではない — banquet job not modeled → working blocks.
  if ((t.state.CFLAG[CFLAG_ID.行动] ?? 0) === 5) {
    return { ok: false, reason: { kind: "precondition", message: "对方正在工作。" } };
  }
  // ERB 353: BATHCHECK/IN_TOILET && AT_HOME — room props deferred (no consumer here).
  return { ok: true };
}

export const performMusicHandlerEntry: HandlerEntry = {
  commandNo: 416,
  prompt: (ctx) => instrumentPrompt(ctx.state),
  execCheck: (ctx) => {
    const r = checkPerformEligible(ctx);
    return r.ok ? { ok: true } : { ok: false, reason: r.reason };
  },
  handler: (ctx: CommandContext) => {
    const next = cloneGameState(ctx.state);

    // 1. Instrument selection: a UI pick (promptAnswer) OR auto-pick the first
    //    usable instrument (随心演奏 / COM_ALTER_416, ERB 35-44).
    const usable = usableInstruments(next);
    const spec = instrumentPrompt(next);
    const picked = requirePickOne(spec, ctx.promptAnswer);
    const instrument =
      typeof picked === "number" && usable.includes(picked) ? picked : usable[0];
    if (instrument === undefined) {
      return {
        state: next,
        events: [
          { kind: "NARRATION" as const, timestamp: ctx.now(), text: "没有可以演奏的乐器。" },
        ],
        outcome: "noop" as const,
      };
    }
    const instrName = INSTRUMENTS.find((i) => i.item === instrument)!.name;

    // 2. Outcome roll ONCE for the whole performance (ERB 106-128, TFLAG:193).
    const maxRoll = comf416Def.maxRoll ?? 100;
    const great = comf416Def.greatThreshold ?? 10;
    const fail = comf416Def.failThreshold ?? 90;
    const roll = ctx.rng.int(maxRoll);
    const outcome: ComfOutcome = roll < great ? 1 : roll >= fail ? -1 : 0;

    // 3. master DOWNBASE 体力300/気力300 (ERB 155-156).
    setMasterBase(next, BASE_ID.体力, getMasterBase(next, BASE_ID.体力) - 300);
    setMasterBase(next, BASE_ID.気力, getMasterBase(next, BASE_ID.気力) - 300);

    // 4. Per-listener @COM416_1: build scaled SOURCE + run body side-writes.
    //    Audience = present, awake NPCs (working ones handled by the deferred
    //    宴会/投石 path). Reuses comf416Def so the per-target math never diverges.
    const audience = presentNpcs(next, next.master.location).filter(
      (npc) => (npc.state.CFLAG[CFLAG_ID.睡眠] ?? 0) === 0,
    );
    const targets: MusicTarget[] = [];
    const accompanists: string[] = [];
    for (const npc of audience) {
      const c = buildComfCtx(ctx, next, npc.charaNum, outcome);
      const sources = comf416Def.buildSources(c);
      applyComfScaling(comf416Def, c, sources);
      comf416Def.body?.(c);
      const sanka = npc.state.TCVAR[TCVAR_ENSOU_SANKA] ?? 0;
      if (sanka !== 0) accompanists.push(npc.charaNum.toString());
      targets.push({
        charaNum: npc.charaNum,
        sources,
        sanka,
        musicSkill: npc.state.ABL[ABL_ID.音楽技能] ?? 0,
        onkan: npc.state.TALENT[TALENT_ONKAN] ?? 0,
      });
    }

    // 5. Band/dance bonus + post-loop SOURCE adjust (pure).
    const plan = applyBandBonus(targets, outcome);

    // 6. Settle each listener's SOURCE (SOURCE_CHECK per co-located chara).
    //    The favor delta is recorded as background STATUS_MESSAGE events by
    //    applySourceCheck; the NARRATION deliberately omits the numbers.
    const settleEvents: ObservationEvent[] = [];
    for (const t of plan.targets) {
      const r = applySourceCheck(next, t.charaNum, t.sources, 0);
      settleEvents.push(...r.events);
    }

    // 7. TFLAG:好感度BONUS (ERB 215; consumer deferred) + TIME += 30 (ERB 218).
    setTflag(next, TFLAG_ID.好感度BONUS, plan.bandBonus * 50);
    const timeCost = typeof comf416Def.timeCost === "number" ? comf416Def.timeCost : 30;
    const dayEndEvents = advanceTimeTicks(next, timeCost);

    // 8. Narration.
    const tone =
      outcome === 1 ? "演奏大成功！" : outcome === -1 ? "这次演奏有些不尽如人意……" : "完成了演奏。";
    const ensemble =
      accompanists.length > 0 ? `（${accompanists.length}人加入演奏）` : "";
    const head: ObservationEvent = {
      kind: "NARRATION",
      timestamp: ctx.now(),
      text: `演奏了${instrName}。${tone}${ensemble}（听众 ${targets.length}人）`,
    };

    return {
      state: next,
      events: [
        head,
        ...settleEvents.map((e) => ({ ...e, timestamp: ctx.now() })),
        ...(dayEndEvents ?? []).map((e) => ({ ...e, timestamp: ctx.now() })),
      ],
      outcome: "ok" as const,
    };
  },
};
