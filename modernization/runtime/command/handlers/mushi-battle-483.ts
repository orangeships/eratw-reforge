/**
 * `COMF483 ムシバトル` — 斗虫 duel against the focused target.
 *
 * Faithful to `ERB/コマンド関連/COMF/日常系/COMF483 ムシバトル.ERB`. The battle
 * itself lives in `state/bug-battle.ts`; this file is the command surface:
 * `@COM_ABLE483` gates, cage → battler conversion, `@CHARA_MUSHICAGE_SETTING`
 * for the opponent, and the post-battle settlement of COMF483:86-154.
 *
 * ## V1 SCOPE — duel mode only
 * Upstream has three modes, chosen by how many characters are eligible
 * (COMF483:36-66):
 *   - タイマン (1v1)     — only TARGET is eligible
 *   - バトルロイヤル     — 3+ eligible, free-for-all
 *   - チーム戦           — 4 players split by parity
 * This port ships **タイマン only**. `MUSHI_TEAM` and multi-battler placement
 * are implemented in the engine (and tested), but the command always builds two
 * battlers. BR/team need a participant picker; see the deferral list below.
 *
 * ## DEFERRED (deliberate, documented)
 *   - バトルロイヤル / チーム戦 — needs `@MUSHIBATTLE_CHARASELECT` (COMF483:211)
 *     and its multi-select UI.
 *   - Player insect picker — upstream is an `INPUT` loop that toggles up to 3
 *     cage slots (`MUSHI_BATTLE_SELECTION_MASTER`, COMF483:416-492). V1 fields the
 *     three strongest insects by rank, then HP+ATK+SPD. The `chooseSwap` hook in
 *     `bug-battle.ts` is the seam a picker plugs into later.
 *   - 切り札 (`MUSHI_KIRIHUDA_{CHARA}`) and キャラ指定虫笼 requests
 *     (`MUSHI_CHARACAGE_{CHARA}`, COMF483:806-834) — per-character override hooks.
 *   - Kojo hooks: 戦場に出した / 攻撃時 / 倒れた時 / 敗退時 / 試合前後一言
 *     (`KOJO_MESSAGE_SEND("MUSHI_BATTLE", ...)`). `MUSHI_BATTLE` kojo is not in
 *     the modern bundle yet, so no dialogue is emitted.
 *   - `NPC` stream (`VSNPC`) and `COMF497 ムシ合わせ` (6.1KB) — separate command,
 *     still unregistered. The engine it would call is now in place.
 *   - Tribe-name resolution in `MBP` (天���/仙人/月人/鬼/…): the modern port has no
 *     `GET_TRIBENAME` equivalent, so those multipliers are skipped. Neutral input,
 *     never a guess — a wrong tribe would silently skew every opponent.
 */

import type { ObservationEvent } from "../../../schemas/types.js";
import type { CommandContext, HandlerEntry } from "../types.js";
import { cloneGameState } from "../../state/game-state.js";
import { applySourceCheck } from "../source-check.js";
import { isHMode } from "../h-mode.js";
import {
  ABL_ID,
  BASE_ID,
  CFLAG_ID,
  FLAG_ID,
  SOURCE_ID,
  TALENT_ID,
  TCVAR_ID,
  advanceTimeTicks,
  getCharaAbl,
  getCharaBase,
  getMasterAbl,
  getMasterBase,
  getMasterTalent,
} from "../../state/settlement.js";
import { bugDefFor, cageOf, isBugSeason, mushitoriSpot } from "../../state/bug-catching.js";
import {
  buildNpcCage,
  mushiBattlePower,
  mushiBattlePowerRank,
  runBugBattle,
  toBattleBug,
  type BattleBattler,
  type BattleBug,
} from "../../state/bug-battle.js";
import { battleFrameSequence, renderBattleFrame } from "../../state/mushi-battle-frame.js";
import type { GameState } from "../../state/game-state.js";

// ---------------------------------------------------------------------------
// Constants — COMF483
// ---------------------------------------------------------------------------

/** COMF483:26 — participants need 気力 AND 体力 ≥ 500. */
const PARTICIPANT_MIN_BASE = 500;
/** COMF483:86-87 — the battle itself costs 気力 400 / 体力 200. */
const REWARD_KIJIRYOKU = 400;
const REWARD_TAIRYOKU = 200;
/** COMF483:152 — `TIME += 60`. */
const TIME_COST = 60;
/** COMF483:41-42 — rank band 0..8, printed as ★. */
const RANK_STARS = ["", "★", "★★", "★★★", "★★★★", "★★★★★", "★★★★★★", "★★★★★★★", "★★★★★★★★"];

// ---------------------------------------------------------------------------
// State readers — kept local so a missing field degrades to a neutral value
// ---------------------------------------------------------------------------

function charSlot(state: GameState, charaNum: number) {
  return charaNum === 0 ? state.master : state.charas?.[charaNum];
}

function readAbl(state: GameState, charaNum: number, id: number): number {
  if (charaNum === 0) return getMasterAbl(state, id) ?? 0;
  try {
    return getCharaAbl(state, charaNum, id) ?? 0;
  } catch {
    return 0;
  }
}

function readTalent(state: GameState, charaNum: number, id: number): number {
  if (charaNum === 0) return getMasterTalent(state, id) ?? 0;
  return charSlot(state, charaNum)?.state.TALENT?.[id] ?? 0;
}

function readBase(state: GameState, charaNum: number, id: number): number {
  if (charaNum === 0) return getMasterBase(state, id) ?? 0;
  return getCharaBase(state, charaNum, id) ?? 0;
}

function charaName(state: GameState, charaNum: number): string {
  const slot = charSlot(state, charaNum);
  return slot?.callName || slot?.name || (charaNum === 0 ? "你" : `角色${charaNum}`);
}

/**
 * `MBP` (COMF483:900-1023) with the tribe terms neutral.
 * See the module header: tribe-name resolution is not modeled, so those
 * multipliers are omitted rather than guessed.
 */
function battlePowerOf(state: GameState, charaNum: number): number {
  return mushiBattlePower({
    gatheringLevel: readTalent(state, charaNum, TALENT_ID.採集Lv),
    refinement: readAbl(state, charaNum, ABL_ID.教養),
    combatAbility: readAbl(state, charaNum, ABL_ID.戦闘能力),
    stenchResistance: readTalent(state, charaNum, TALENT_ID.汚臭耐性),
    hasMixingKnowledge: readTalent(state, charaNum, TALENT_ID.調合知識) !== 0,
    hasForbiddenKnowledge: readTalent(state, charaNum, TALENT_ID.禁断的知識) !== 0,
    isChildish: readTalent(state, charaNum, TALENT_ID.幼稚) !== 0,
    humanTribe: "",
    isLunarException: false,
    youkaiTribe: "",
    isVampire: false,
    isFairy: false,
    likedBizarreCount: 0,
    dislikedBizarreCount: 0,
  });
}

/**
 * V1 team selection: strongest three by rank, then HP+ATK+SPD.
 * Stands in for the upstream `INPUT` picker; `chooseSwap` keeps the later
 * interactive path possible.
 */
function pickStrongest(cage: readonly { id: string; bugNum: number; rank: number }[], limit: number) {
  const scored = cage
    .map((caught) => {
      const def = bugDefFor(caught.bugNum);
      const power = def ? def.hp + def.atk + def.spd : 0;
      return { caught, score: caught.rank * 10_000 + power };
    })
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((entry) => entry.caught);
}

function buildBattler(
  state: GameState,
  charaNum: number,
  player: number,
  power: number,
  caught: readonly { id: string; bugNum: number; rank: number; gType: boolean; xType: boolean; caughtDay: number; location: string }[],
): BattleBattler | undefined {
  const bugs: (BattleBug | undefined)[] = [];
  caught.forEach((entry, index) => {
    const bug = toBattleBug(entry, power, index + 1);
    if (bug) bugs.push(bug);
  });
  if (bugs.length === 0) return undefined;
  return {
    player,
    charaNum,
    name: charaName(state, charaNum),
    team: player % 2,
    // `MUSHI_MENTAL` starts at the battler's 斗虫 power (COMF483:410,512).
    mental: Math.max(1, power),
    bugs: [...bugs, ...Array.from({ length: Math.max(0, 3 - bugs.length) }, () => undefined)],
    standIndex: 0,
    forfeited: false,
    placement: 0,
    status: [],
  };
}

// ---------------------------------------------------------------------------
// execCheck — `@COM_ABLE483`
// ---------------------------------------------------------------------------

function checkMushiBattle(ctx: CommandContext): { ok: true } | { ok: false; message: string } {
  // COM_ABLE483: 時間停止中は不可.
  if ((ctx.state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0) {
    return { ok: false, message: "时间停止中无法斗虫。" };
  }
  // GLOBAL_COMABLE(483): daily commands are unavailable in stealth/H mode.
  if ((ctx.state.flagStore[FLAG_ID.潜伏] ?? 0) !== 0 || isHMode(ctx.state, ctx.target)) {
    return { ok: false, message: "当前状态下无法斗虫。" };
  }

  // CSV/Item.csv:25. Owning insects does not replace the required kit.
  if ((ctx.state.items?.[25] ?? 0) <= 0) return { ok: false, message: "需要昆虫採集套装才能斗虫。" };
  if (!mushitoriSpot(ctx.state.master.location)) return { ok: false, message: "这里无法斗虫。" };
  if (!isBugSeason(ctx.state.time.season ?? 1)) return { ok: false, message: "冬天无法斗虫。" };
  if (!cageOf(ctx.state).some((bug) => bugDefFor(bug.bugNum))) return { ok: false, message: "虫笼里没有可以出战的虫子。" };

  const target = ctx.target;
  const opponent = ctx.state.charas[target];
  if (target <= 0 || target === ctx.actor || !opponent || opponent.location !== ctx.state.master.location) {
    return { ok: false, message: "没有同处一地的对战对象。" };
  }
  // SHIRAHU(TARGET), COMMON.ERB:827-841.
  if ((opponent.state.CFLAG[CFLAG_ID.睡眠] ?? 0) !== 0 ||
      (opponent.state.CFLAG[CFLAG_ID.陪睡中] ?? 0) !== 0 ||
      (opponent.state.CFLAG[CFLAG_ID.衰弱] ?? 0) !== 0 ||
      (opponent.state.TCVAR[TCVAR_ID.烂醉] ?? 0) !== 0) {
    return { ok: false, message: `${charaName(ctx.state, target)}现在无法参加斗虫。` };
  }
  const masterFlags = ctx.state.master.state.CFLAG;
  if ((masterFlags[CFLAG_ID.陪睡中] ?? 0) !== 0 || (masterFlags[CFLAG_ID.诶嘿嘿] ?? 0) !== 0) {
    return { ok: false, message: "当前状态下无法斗虫。" };
  }
  if ((opponent.state.CFLAG[CFLAG_ID.行动] ?? 0) === 5) {
    return { ok: false, message: "对方正在工作，无法参加斗虫。" };
  }
  if (readBase(ctx.state, 0, BASE_ID.気力) < PARTICIPANT_MIN_BASE ||
      readBase(ctx.state, 0, BASE_ID.体力) < PARTICIPANT_MIN_BASE) {
    return { ok: false, message: `${charaName(ctx.state, 0)}的体力或气力不足。` };
  }

  // COMF483:11-14 — an exhausted target refuses outright.
  const exhausted = ctx.state.charas?.[target]?.state.TCVAR?.[TCVAR_ID.斗虫参加可否];
  if (exhausted === -1) return { ok: false, message: `${charaName(ctx.state, target)}的虫子们都很疲惫了。` };

  // COMF483:26 — the opponent needs 気力 and 体力.
  if (readBase(ctx.state, target, BASE_ID.気力) < PARTICIPANT_MIN_BASE ||
      readBase(ctx.state, target, BASE_ID.体力) < PARTICIPANT_MIN_BASE) {
    return { ok: false, message: `${charaName(ctx.state, target)}体力不足，无法参加斗虫。` };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// handler
// ---------------------------------------------------------------------------

export const mushiBattle483HandlerEntry: HandlerEntry = {
  commandNo: 483,
  gateStatus: "complete",
  gateDiagnostics: [
    "owns 昆虫採集套装 (ITEM:25) and a battle-ready insect",
    "field spot resolves via @MUSHITORI_SPOT",
    "not winter; a present, conscious, non-working target; not co-sleeping, in stealth or H mode",
    "master and target BASE 気力/体力 >= 500 (COM_ABLE483)",
    "TCVAR:斗虫参加可否 != -1 (opponent not spent)",
    "not time-stopped",
    "V1: duel mode only; BR/team and the player picker are deferred",
  ],
  execCheck: (ctx) => {
    const result = checkMushiBattle(ctx);
    return result.ok ? { ok: true } : { ok: false, reason: { kind: "precondition", message: result.message } };
  },
  handler: (ctx) => {
    const gate = checkMushiBattle(ctx);
    if (!gate.ok) {
      return {
        state: cloneGameState(ctx.state),
        events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text: gate.message }],
        outcome: "blocked" as const,
        failReason: { kind: "precondition" as const, message: gate.message },
      };
    }

    const next = cloneGameState(ctx.state);
    const events: ObservationEvent[] = [];
    const push = (text: string) => {
      events.push({ kind: "NARRATION" as const, timestamp: ctx.now(), text });
    };

    const playerPower = battlePowerOf(next, 0);
    const targetPower = battlePowerOf(next, ctx.target);

    // MUSHI_BATTLE_SELECTION:402 — the battle field comes from the spot bitset.
    const field = mushitoriSpot(next.master.location) || 1;

    const playerCage = pickStrongest(cageOf(next), 3);
    const opponentCage = buildNpcCage(targetPower, 8, {}, ctx.rng.next);

    const player = buildBattler(next, 0, 1, playerPower, playerCage as never);
    const opponent = buildBattler(next, ctx.target, 2, targetPower, opponentCage);
    if (!player || !opponent) {
      const message = "虫笼里没有可以出战的虫子。";
      return {
        state: next,
        events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text: message }],
        outcome: "noop" as const,
        failReason: { kind: "precondition", message },
      };
    }

    push(`◆对战 ${opponent.name}　斗虫力：${RANK_STARS[mushiBattlePowerRank(targetPower)] ?? "★"}(${targetPower})`);

    const result = runBugBattle(
      { battlers: [player, opponent], field, team: false, month: monthOf(next.time.season) },
      ctx.rng.next,
    );

    // Upstream redraws the whole field after every message
    // (`MUSHI_BATTLE_MSG` → `MUSHI_BATTLE_FIELD`), so the battle is emitted as a
    // sequence of complete frames rather than a flat log. That keeps the era
    // read — a full screen you step through — and needs no new UI surface,
    // because it travels through the same NARRATION renderer as everything else.
    const frames = battleFrameSequence({
      battlers: [player, opponent],
      snapshots: result.snapshots,
      field,
      rounds: result.rounds,
      finish: result.finish,
      winner: result.winner,
    });
    for (const frame of frames) {
      push(renderBattleFrame(frame).join("\n"));
    }

    // --- settlement (COMF483:86-154) -------------------------------------
    // Every participant walks away 気力 +400 / 体力 +200.
    for (const charaNum of [0, ctx.target]) {
      const slot = charSlot(next, charaNum);
      if (!slot) continue;
      slot.state.BASE[BASE_ID.気力] = (slot.state.BASE[BASE_ID.気力] ?? 0) + REWARD_KIJIRYOKU;
      slot.state.BASE[BASE_ID.体力] = (slot.state.BASE[BASE_ID.体力] ?? 0) + REWARD_TAIRYOKU;
    }

    // COMF483:59 / 145-149 — everyone who fought is spent for the day.
    next.charas[ctx.target]!.state.TCVAR[TCVAR_ID.斗虫参加可否] = -1;

    if (result.winner === 2) {
      // COMF483:97-110 — losing still pays, and the first loss is remembered.
      const intimacy = readAbl(next, ctx.target, ABL_ID.親密 ?? -1);
      const obedience = readAbl(next, ctx.target, ABL_ID.従順 ?? -1);
      const sourceResult = applySourceCheck(
        next,
        ctx.target,
        { [SOURCE_ID.歓楽]: 1000 + Math.max(0, intimacy) * 100, [SOURCE_ID.受動]: 400 + Math.max(0, obedience) * 120 },
        0,
        1,
      );
      events.push(...sourceResult.events.map((event) => ({ ...event, timestamp: ctx.now() })));
      const slot = next.charas[ctx.target];
      if (slot && (slot.state.CFLAG[CFLAG_ID.斗虫直接勝利] ?? 0) === 0) {
        slot.state.CFLAG[CFLAG_ID.斗虫直接勝利] = 1;
        push(`☆初次在与${opponent.name}的直接对决中落败！`);
      }
    } else if (result.winner === 1) {
      push(`☆在与${opponent.name}的直接对决中获胜！`);
    }

    advanceTimeTicks(next, TIME_COST);

    return { state: next, events, outcome: "ok" as const };
  },
};

/** Season label used by `得意季節` (`春の虫` / `夏の虫` / `秋の虫`). */
function monthOf(season: number | undefined): "春之月" | "夏之月" | "秋之月" | "冬之月" {
  if (season === 2) return "夏之月";
  if (season === 3) return "秋之月";
  if (season === 4) return "冬之月";
  return "春之月";
}

/** Exposed for the V1 team-battle wiring and tests. */
export { buildBattler as buildMushiBattler, pickStrongest as pickStrongestMushi };
