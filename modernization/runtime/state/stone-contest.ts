/** Authoritative deterministic runtime for COM633 (積み石コンテスト).
 *
 * Upstream anchors:
 * - COMF633 積み石コンテスト.ERB:253-285 gates, 287-519 tournaments.
 * - STONEBATTLE.ERB:1-290 solo formulas, 293-1103 couple scoring.
 * - STONELEVEL.ERB:19-73 opponent pools.
 *
 * Modern deviation: upstream RAND slots representing the player's manual
 * performance are supplied by replayed placement metrics. Opponent RAND and
 * all non-random ability/relationship/reward terms remain deterministic and
 * source-shaped. The reversed upstream fee condition is intentionally fixed.
 */

import type { ObservationEvent } from "../../schemas/types.js";
import { createRng } from "../command/rng.js";
import { charaDataOf } from "./chara-data.js";
import { cloneGameState, type CharaSlot, type GameState } from "./game-state.js";
import { addItem } from "./items.js";
import { grant, pay } from "./money.js";
import { advanceTimeTicks } from "./settlement.js";
import {
  STONE_CONTEST_DURATION_FRAMES,
  replayStoneOperations,
  stoneCandidate,
  stoneCandidateQueue,
  normalizeStoneOperation,
  type StonePlacementOperation,
  type StoneReplayResult,
} from "./stone-contest-physics.js";

export const STONE_CONTEST_RANK_TALENT_ID = 274;
export const STONE_CONTEST_FEE = 3_000;
export const STONE_ITEM_TALC = 633;
export const STONE_ITEM_MIRACLE = 530;
export const STONE_ITEM_LAMENT = 407;

export const STONE_CONTEST_THEMES = [
  "春", "盘子", "恐怖", "音乐", "童话", "布饰", "多彩", "夏", "中国风", "动物",
  "战斗", "未来", "秋", "复古", "高级", "华丽", "和风", "矿石", "智慧", "冬",
  "混沌", "秩序", "西式", "天体", "水", "守矢", "魔法使", "兔子", "植物", "风",
] as const;

export type StoneContestTheme = (typeof STONE_CONTEST_THEMES)[number];
export type StoneContestStrategy = "quick" | "normal" | "careful" | "wait";
export type StoneContestItem = "small-hat" | "strength-jizo" | "carefree" | "honest-sign" | "none";
export type StoneContestMode = "lobby" | "solo" | "couple";
export type StoneContestPhase = "lobby" | "round" | "between-rounds" | "settlement";
export type StoneContestPayer = "free" | "player" | "clerk" | "partner";

export interface StoneThemeRecord {
  bestScore: number;
  bestPartner: number;
  partnerBest: Record<number, number>;
  trophy: boolean;
}

export interface StoneContestProgress {
  visitDays: number;
  lastVisitDay: number;
  soloMatches: number;
  soloWins: number;
  soloChampionships: number;
  coupleMatches: number;
  coupleWins: number;
  rank: number;
  tutorialRead: Record<string, true>;
  itemLevel: number;
  themeRecords: Record<number, StoneThemeRecord>;
  trophyCount: number;
  allClearRewardClaimed: boolean;
  clerkCharaNum?: number;
  clerkName: string;
  clerkStoryStage: number;
  namingStatus: "default" | "pending" | "named";
  settledSessionIds: string[];
  history: string[];
}

export interface StoneContestRoundResult {
  playerTotal: number;
  opponentTotal: number;
  outcome: "win" | "lose" | "tie";
  replay: StoneReplayResult;
  opponentCollapsed: boolean;
}

export interface StoneContestCoupleScore {
  technique: number;
  cooperation: number;
  theme: number;
  total: number;
  award: "champion-perfect" | "champion" | "runner-up" | "third" | "none";
}

export function stoneAwardForScore(total: number): StoneContestCoupleScore["award"] {
  const score = clamp(total, 0, 100);
  return score === 100 ? "champion-perfect" : score >= 80 ? "champion" : score >= 70 ? "runner-up" : score >= 60 ? "third" : "none";
}

export interface StoneContestPendingSettlement {
  id: string;
  outcome: "champion" | "defeat" | "withdraw" | "forfeit" | "couple";
  fee: number;
  payer: StoneContestPayer;
  prize: number;
  timeMinutes: 50 | 60;
  roundResult?: StoneContestRoundResult;
  coupleScore?: StoneContestCoupleScore;
}

export interface StoneContestSession {
  id: string;
  mode: StoneContestMode;
  phase: StoneContestPhase;
  seed: number;
  startedAtTick: number;
  opponent: number;
  partner: number;
  rank: number;
  round: number;
  maxRounds: number;
  prize: number;
  theme: number;
  strategy: StoneContestStrategy;
  item: StoneContestItem;
  /** Persisted fixed-step progress inside the current 30-second bout. */
  elapsedFrames: number;
  /** Changes whenever a same-round tie starts a fresh countdown. */
  bout: number;
  operations: StonePlacementOperation[];
  subtitles: string[];
  payer: StoneContestPayer;
  lastRound?: StoneContestRoundResult;
  pendingSettlement?: StoneContestPendingSettlement;
}

const RANK_CONFIG = [
  { rounds: 2, prize: 5_000 },
  { rounds: 3, prize: 7_000 },
  { rounds: 4, prize: 10_000 },
  { rounds: 5, prize: 15_000 },
  { rounds: 5, prize: 30_000 },
] as const;

const OPPONENTS: readonly (readonly number[])[] = [
  [129, 5, 7],
  [57, 76, 23],
  [1, 121, 55],
  [51, 59, 106],
  [92, 90, 44],
  [132, 124, 56, 30],
  [129, 5, 7, 57, 76, 23, 1, 121, 55, 51, 59, 106, 92, 90, 44, 132, 124, 56, 30, 113],
] as const;

const STRATEGY_TOLERANCE: Readonly<Record<StoneContestStrategy, number>> = {
  quick: -120,
  normal: 0,
  careful: 260,
  wait: 0,
};

const THEME_TAGS: readonly { good: readonly string[]; bad: readonly string[]; skill?: number }[] = [
  { good: ["春", "樱花", "百合", "粉色", "自然"], bad: ["冬", "秋"] },
  { good: ["食器", "皿", "女僕"], bad: [], skill: 44 },
  { good: ["闇", "血", "恐怖", "毒", "幽霊"], bad: ["可爱"] },
  { good: ["音乐", "楽器"], bad: [], skill: 45 },
  { good: ["可爱", "梦", "心形", "粉色"], bad: ["恐怖", "血"] },
  { good: ["装饰", "布", "针", "蝴蝶结", "人形"], bad: [] },
  { good: ["虹", "七色", "赤", "青", "绿", "紫"], bad: ["灰"] },
  { good: ["夏", "西瓜", "向日葵", "自然"], bad: ["冬"] },
  { good: ["大陆", "中国", "龍"], bad: ["和风", "洋风"] },
  { good: ["动物", "猫", "犬", "狼", "狐", "鸟", "鱼"], bad: [] },
  { good: ["刃", "弹", "力量", "战斗"], bad: ["和平"], skill: 42 },
  { good: ["未来", "机械", "人工", "时空"], bad: ["怀旧", "遗物"] },
  { good: ["秋", "枫叶", "紅葉", "自然"], bad: ["春"] },
  { good: ["古", "怀旧", "遗物"], bad: ["未来"] },
  { good: ["高级", "黄金", "宝石", "奢华"], bad: ["便宜"] },
  { good: ["华丽", "装饰", "宝石", "虹"], bad: ["朴素"] },
  { good: ["和风", "巫女", "神社", "樱花"], bad: ["洋风"] },
  { good: ["矿石", "石", "宝石", "水晶", "金"], bad: [] },
  { good: ["智慧", "书", "知识", "学问"], bad: [], skill: 43 },
  { good: ["冬", "雪", "冰", "白"], bad: ["夏"] },
  { good: ["混沌", "奇妙", "不可思议"], bad: ["秩序"] },
  { good: ["秩序", "规则", "整齐"], bad: ["混沌"] },
  { good: ["洋风", "西洋", "女仆"], bad: ["和风"] },
  { good: ["月", "日", "星", "光", "天空"], bad: ["地底"] },
  { good: ["水", "鱼", "雨", "海", "蓝"], bad: ["火", "毒"] },
  { good: ["守矢", "奇迹", "蛙", "蛇", "风", "大地"], bad: ["妖怪"] },
  { good: ["魔法", "魔女", "魔法书", "扫帚"], bad: [] },
  { good: ["兔", "月", "硬币", "卡片"], bad: [] },
  { good: ["植物", "果实", "花", "叶", "自然"], bad: ["机械"] },
  { good: ["风", "疾风", "嵐", "天狗", "鸟"], bad: ["地底"] },
] as const;

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.trunc(Number.isFinite(value) ? value : 0)));
}

function stat(slot: CharaSlot | undefined, namespace: keyof CharaSlot["state"], id: number): number {
  return slot?.state[namespace][id] ?? 0;
}

export function defaultStoneContestProgress(): StoneContestProgress {
  return {
    visitDays: 0,
    lastVisitDay: -1,
    soloMatches: 0,
    soloWins: 0,
    soloChampionships: 0,
    coupleMatches: 0,
    coupleWins: 0,
    rank: 0,
    tutorialRead: {},
    itemLevel: 1,
    themeRecords: {},
    trophyCount: 0,
    allClearRewardClaimed: false,
    clerkName: "积石赛受付员",
    clerkStoryStage: 0,
    namingStatus: "default",
    settledSessionIds: [],
    history: [],
  };
}

export function ensureStoneContestProgress(state: GameState): StoneContestProgress {
  state.stoneContestProgress ??= defaultStoneContestProgress();
  return state.stoneContestProgress;
}

function sessionSeed(state: Readonly<GameState>, seedHint = 0): number {
  return (Math.imul(state.time.dayIndex + 1, 1_000_003) ^ Math.imul(state.time.tickValue + 633, 97_409) ^ seedHint) >>> 0;
}

export function openStoneContestLobby(state: Readonly<GameState>, partner = 0, seedHint = 0): GameState {
  const next = cloneGameState(state);
  const progress = ensureStoneContestProgress(next);
  const seed = sessionSeed(next, seedHint);
  if (progress.lastVisitDay !== next.time.dayIndex) {
    progress.lastVisitDay = next.time.dayIndex;
    progress.visitDays += 1;
    const clerk = progress.clerkCharaNum === undefined ? undefined : next.charas[progress.clerkCharaNum];
    if (clerk) clerk.state.CFLAG[2] = (clerk.state.CFLAG[2] ?? 0) + 7 + (progress.clerkStoryStage >= 5 ? 3 : 0);
  }
  progress.rank = Math.max(progress.rank, clamp(next.master.state.TALENT[STONE_CONTEST_RANK_TALENT_ID] ?? 0, 0, 6));
  const intro = progress.visitDays === 1
    ? ["「你好！这里是积石竞赛的场地！」", "顾名思义，这是一个评判积石技巧的比赛。", "把石头稳稳堆起来，作品与战绩都会被记录。"]
    : [`「欢迎回来，${next.master.callName ?? "挑战者"}！」`, "今天也来挑战积石竞赛吗？"];
  next.stoneContestSession = {
    id: `stone-${next.time.dayIndex}-${next.time.tickValue}-${seed}`,
    mode: "lobby",
    phase: "lobby",
    seed,
    startedAtTick: next.time.tickValue,
    opponent: 0,
    partner,
    rank: 0,
    round: 0,
    maxRounds: 0,
    prize: 0,
    theme: clamp(next.time.date ?? 1, 1, 30),
    strategy: "normal",
    item: "none",
    elapsedFrames: 0,
    bout: 0,
    operations: [],
    subtitles: intro,
    payer: "player",
  };
  return next;
}

function payerFor(state: Readonly<GameState>, mode: Exclude<StoneContestMode, "lobby">, partner: number): StoneContestPayer {
  const rank = state.stoneContestProgress?.rank ?? state.master.state.TALENT[STONE_CONTEST_RANK_TALENT_ID] ?? 0;
  if (rank >= 6) return "free";
  if (state.money >= STONE_CONTEST_FEE) return "player";
  return mode === "couple" && partner > 0 ? "partner" : "clerk";
}

function difficultyFor(session: StoneContestSession): number {
  if (session.rank >= 3 && session.round === session.maxRounds - 1) return 8;
  const base = session.rank === 3 ? 5 : session.rank === 4 ? 6 : session.rank;
  return Math.min(6, base + session.round);
}

function opponentFor(seed: number, difficulty: number, round: number): number {
  if (difficulty >= 7) return 127;
  const pool = OPPONENTS[clamp(difficulty, 0, 6)]!;
  return pool[createRng((seed ^ Math.imul(round + 1, 65_537)) >>> 0).int(pool.length)]!;
}

export interface StoneContestStartOptions {
  mode: "solo" | "couple";
  rank?: number;
  partner?: number;
  theme?: number;
  strategy?: StoneContestStrategy;
  item?: StoneContestItem;
}

export function startStoneContest(state: Readonly<GameState>, options: StoneContestStartOptions): GameState {
  const current = state.stoneContestSession;
  if (!current || current.phase !== "lobby") return cloneGameState(state);
  const next = cloneGameState(state);
  const progress = ensureStoneContestProgress(next);
  const rank = options.mode === "solo" ? clamp(options.rank ?? 0, 0, Math.min(4, progress.rank)) : 0;
  const config = RANK_CONFIG[rank]!;
  const partner = options.mode === "couple" ? Math.max(0, Math.trunc(options.partner ?? current.partner)) : 0;
  if (options.mode === "couple" && (!partner || !next.charas[partner])) return next;
  const item = options.item ?? "none";
  const itemRequiredLevel: Record<StoneContestItem, number> = { "small-hat": 1, "strength-jizo": 2, carefree: 3, "honest-sign": 4, none: 0 };
  const selectedItem = itemRequiredLevel[item] <= progress.itemLevel ? item : "none";
  const difficulty = rank;
  next.stoneContestSession = {
    ...current,
    mode: options.mode,
    phase: "round",
    partner,
    rank,
    round: 0,
    maxRounds: options.mode === "solo" ? config.rounds : 1,
    prize: options.mode === "solo" ? config.prize : 0,
    theme: clamp(options.theme ?? current.theme, 1, 30),
    strategy: options.strategy ?? "normal",
    item: selectedItem,
    elapsedFrames: 0,
    bout: 0,
    opponent: options.mode === "solo" ? opponentFor(current.seed, difficulty, 0) : 0,
    operations: [],
    subtitles: [...current.subtitles, options.mode === "solo" ? `第 1 场，对手登场。` : `情侣组开始！本次主题是「${STONE_CONTEST_THEMES[clamp(options.theme ?? current.theme, 1, 30) - 1]}」。`],
    payer: payerFor(next, options.mode, partner),
  };
  return next;
}

export function stonePlacementLimit(state: Readonly<GameState>): number {
  const session = state.stoneContestSession;
  if (!session || session.phase !== "round") return 0;
  return Math.ceil(STONE_CONTEST_DURATION_FRAMES / 10);
}

export function stoneContestDifficulty(state: Readonly<GameState>): number {
  const session = state.stoneContestSession;
  if (!session) return 0;
  const base = session.mode === "solo" ? difficultyFor(session) : Math.min(6, state.stoneContestProgress?.rank ?? 0);
  const strategy = session.strategy === "quick" ? 1 : session.strategy === "careful" ? -1 : 0;
  const item = session.item === "strength-jizo" ? -1 : 0;
  return clamp(base + strategy + item, 0, 8);
}

export function appendStoneContestPlacement(state: Readonly<GameState>, operation: StonePlacementOperation): GameState {
  const next = cloneGameState(state);
  const session = next.stoneContestSession;
  if (!session || session.phase !== "round" || operation.actor !== "player") return next;
  if (session.strategy === "wait" || session.elapsedFrames >= STONE_CONTEST_DURATION_FRAMES) return next;
  const last = [...session.operations].reverse().find((entry) => entry.actor === "player");
  const normalized = normalizeStoneOperation({ ...operation, frame: clamp(operation.frame, session.elapsedFrames, STONE_CONTEST_DURATION_FRAMES) });
  if (last && normalized.frame - last.frame < 10) return next;
  const difficulty = stoneContestDifficulty(next);
  const replay = replayForSession(next, session, normalized.frame);
  const queue = stoneCandidateQueue(session.seed, difficulty, session.operations, replay.bodies);
  const candidate = queue.find((entry) => entry.candidateId === normalized.candidateId);
  if (!candidate) return next;
  session.operations.push({ ...normalized, sizeQ: candidate.sizeQ });
  return next;
}

function desireWobble(slot: CharaSlot | undefined): number {
  return Math.max(0, stat(slot, "ABL", 11) * 35);
}

export function stoneContestReplayConfig(state: Readonly<GameState>) {
  const session = state.stoneContestSession!;
  const partnerWobble = session.mode === "couple" ? desireWobble(state.charas[session.partner]) : 0;
  return {
    seed: session.seed,
    difficulty: stoneContestDifficulty(state),
    supportToleranceQ: STRATEGY_TOLERANCE[session.strategy] - desireWobble(state.master) - partnerWobble,
    rescueCollapse: session.item === "small-hat",
  };
}

function replayForSession(state: Readonly<GameState>, session: StoneContestSession, untilFrame = session.elapsedFrames): StoneReplayResult {
  return replayStoneOperations(session.operations, { ...stoneContestReplayConfig(state), untilFrame });
}

export function previewStoneContestReplay(state: Readonly<GameState>): StoneReplayResult | null {
  const session = state.stoneContestSession;
  return session ? replayForSession(state, session) : null;
}

export function stoneOpponentPrediction(state: Readonly<GameState>): number | null {
  const session = state.stoneContestSession;
  if (!session || session.mode !== "solo" || session.phase !== "round") return null;
  return opponentFinalCount(session);
}

function opponentTotals(seed: number, difficulty: number): { first: number; second: number; fallback: number } {
  const rng = createRng(seed >>> 0);
  if (difficulty === 0) return { first: rng.int(4) + 1, second: rng.int(4) + rng.int(5) + 1, fallback: rng.int(5) + 1 };
  if (difficulty === 1) return { first: rng.int(5) + 2, second: rng.int(6) + rng.int(6) + 2, fallback: rng.int(6) + 2 };
  if (difficulty === 2) return { first: rng.int(6) + 3, second: rng.int(6) + rng.int(7) + 3, fallback: rng.int(7) + 3 };
  if (difficulty === 3) return { first: rng.int(7) + 4, second: rng.int(7) + rng.int(7) + 4, fallback: rng.int(8) + 4 };
  if (difficulty === 4) return { first: rng.int(8) + 5, second: rng.int(7) + rng.int(8) + 5, fallback: rng.int(9) + 5 };
  if (difficulty === 5) return { first: rng.int(10) + 6, second: rng.int(8) + rng.int(8) + 6, fallback: rng.int(10) + 6 };
  if (difficulty === 6) {
    const local = rng.int(3);
    return { first: rng.int(10 + local) + 5 + local, second: rng.int(8 + local) + rng.int(8 + local) + 5 + local, fallback: rng.int(5) + 8 };
  }
  if (difficulty === 7) return { first: rng.int(12) + 8, second: rng.int(10) + rng.int(10) + 8, fallback: rng.int(6) + 9 };
  if (difficulty === 8) return { first: rng.int(6) + 10, second: rng.int(7) + rng.int(7) + 10, fallback: 20 };
  return { first: rng.int(7) + 12, second: rng.int(8) + rng.int(8) + 12, fallback: 22 };
}

function opponentFinalCount(session: StoneContestSession): number {
  const totals = opponentTotals((session.seed ^ Math.imul(session.round + 1, 1_000_003)) >>> 0, difficultyFor(session));
  const accident = session.item === "carefree" && createRng(session.seed ^ (session.round + 19)).int(9) === 0;
  return Math.max(1, accident ? totals.fallback : Math.round((totals.first + totals.second) * .72));
}

export interface StoneOpponentStatus {
  count: number;
  text: string;
}

/** Text-only opponent lane. It follows the same seed and deadline as final
 * settlement without simulating or rendering a second physics world. */
export function stoneOpponentStatus(state: Readonly<GameState>, frame?: number): StoneOpponentStatus | null {
  const session = state.stoneContestSession;
  if (!session || session.mode !== "solo") return null;
  const elapsed = clamp(frame ?? session.elapsedFrames, 0, STONE_CONTEST_DURATION_FRAMES);
  const finalCount = opponentFinalCount(session);
  const progress = elapsed / STONE_CONTEST_DURATION_FRAMES;
  const count = Math.min(finalCount, Math.floor(finalCount * Math.pow(progress, .82)));
  const opponent = state.charas[session.opponent]?.callName ?? `#${session.opponent}`;
  const text = progress < .18
    ? `${opponent}正在快速比较三枚候选石。`
    : progress < .52
      ? `${opponent}的石堆还很稳，目前约有 ${count} 块。`
      : progress < .82
        ? `${opponent}开始放慢动作，正在修正倾斜。现在约 ${count} 块。`
        : `${opponent}进入最后冲刺，石堆在晃动——约 ${count} 块。`;
  return { count, text };
}

function appendScheduledPartnerOperations(state: GameState, targetFrame: number): void {
  const session = state.stoneContestSession;
  if (!session || session.mode !== "couple" || session.phase !== "round") return;
  const partner = state.charas[session.partner];
  const skill = stat(partner, "ABL", 12) + stat(partner, "ABL", 50) * 2;
  const favor = stat(partner, "CFLAG", 2);
  const interval = clamp(82 - skill * 2 - Math.trunc(favor / 2_500), 43, 86);
  let index = session.operations.filter((entry) => entry.actor === "partner").length;
  while (index < 80) {
    const rng = createRng((session.seed ^ Math.imul(index + 1, 2_654_435_761)) >>> 0);
    const frame = 58 + index * interval + rng.int(15) - 7;
    if (frame > targetFrame || frame >= STONE_CONTEST_DURATION_FRAMES) break;
    const candidateId = 100_000 + index;
    const candidate = stoneCandidate(session.seed ^ session.partner, candidateId, stoneContestDifficulty(state));
    const recent = session.operations.slice(-5);
    const anchor = recent.length ? Math.trunc(recent.reduce((sum, entry) => sum + entry.xQ, 0) / recent.length) : 5_000;
    const error = Math.max(55, 510 - skill * 25 - Math.min(230, Math.trunc(favor / 45)));
    session.operations.push(normalizeStoneOperation({
      kind: "place",
      frame,
      actor: "partner",
      xQ: clamp(anchor + rng.int(error * 2 + 1) - error, 1_400, 8_600),
      rotationQ: clamp(rng.int(9) - 4, -12, 12),
      sizeQ: candidate.sizeQ,
      motifQ: session.theme % 4,
      candidateId,
    }));
    index += 1;
  }
  session.operations.sort((a, b) => a.frame - b.frame || (a.actor === "player" ? -1 : 1));
}

/** Advances the persisted 30-second clock and adds deterministic partner
 * placements. Crossing the deadline resolves the bout automatically. */
export function advanceStoneContestClock(state: Readonly<GameState>, targetFrame: number): GameState {
  const next = cloneGameState(state);
  const session = next.stoneContestSession;
  if (!session || session.phase !== "round") return next;
  session.elapsedFrames = clamp(Math.max(session.elapsedFrames, targetFrame), 0, STONE_CONTEST_DURATION_FRAMES);
  appendScheduledPartnerOperations(next, session.elapsedFrames);
  if (session.elapsedFrames < STONE_CONTEST_DURATION_FRAMES) return next;
  return session.mode === "couple" ? resolveStoneCouple(next) : resolveSoloStoneRound(next);
}

export function resolveSoloStoneRound(state: Readonly<GameState>): GameState {
  const next = cloneGameState(state);
  const session = next.stoneContestSession;
  if (!session || session.mode !== "solo" || session.phase !== "round") return next;
  session.elapsedFrames = STONE_CONTEST_DURATION_FRAMES;
  const replay = replayForSession(next, session, STONE_CONTEST_DURATION_FRAMES);
  const opponentAccident = session.item === "carefree" && createRng(session.seed ^ (session.round + 19)).int(9) === 0;
  const playerTotal = replay.stableCount;
  const opponentTotal = opponentFinalCount(session);
  const outcome: StoneContestRoundResult["outcome"] = playerTotal > opponentTotal ? "win" : playerTotal < opponentTotal ? "lose" : "tie";
  const result: StoneContestRoundResult = { playerTotal, opponentTotal, outcome, replay, opponentCollapsed: opponentAccident };
  session.lastRound = result;
  session.subtitles.push(`${next.master.callName ?? "你"}：${playerTotal}　VS　${next.charas[session.opponent]?.callName ?? `#${session.opponent}`}：${opponentTotal}`);
  if (outcome === "tie") {
    session.operations = [];
    session.elapsedFrames = 0;
    session.bout += 1;
    session.subtitles.push("因为平局，需要再开始一场比赛。");
    return next;
  }
  if (outcome === "lose") {
    session.phase = "settlement";
    session.pendingSettlement = pending(session, "defeat", 0, 50, result);
    return next;
  }
  session.round += 1;
  if (session.round >= session.maxRounds) {
    session.phase = "settlement";
    session.pendingSettlement = pending(session, "champion", session.prize, 60, result);
    session.subtitles.push(`恭喜夺冠！请领取奖金 ${session.prize.toLocaleString("zh-CN")} 円！`);
  } else {
    session.phase = "between-rounds";
    session.subtitles.push(`恭喜在第 ${session.round} 场获胜。要继续挑战吗？`);
  }
  return next;
}

function pending(session: StoneContestSession, outcome: StoneContestPendingSettlement["outcome"], prize: number, timeMinutes: 50 | 60, roundResult?: StoneContestRoundResult, coupleScore?: StoneContestCoupleScore): StoneContestPendingSettlement {
  return { id: `${session.id}:${outcome}:${session.round}`, outcome, fee: session.payer === "player" ? STONE_CONTEST_FEE : 0, payer: session.payer, prize, timeMinutes, ...(roundResult ? { roundResult } : {}), ...(coupleScore ? { coupleScore } : {}) };
}

export function continueStoneContest(state: Readonly<GameState>): GameState {
  const next = cloneGameState(state);
  const session = next.stoneContestSession;
  if (!session || session.mode !== "solo" || session.phase !== "between-rounds") return next;
  session.phase = "round";
  session.operations = [];
  session.elapsedFrames = 0;
  session.bout = 0;
  const difficulty = difficultyFor(session);
  session.opponent = opponentFor(session.seed, difficulty, session.round);
  session.subtitles.push(`第 ${session.round + 1} 场，对手是 ${next.charas[session.opponent]?.callName ?? `#${session.opponent}`}。`);
  return next;
}

export function withdrawStoneContest(state: Readonly<GameState>): GameState {
  const next = cloneGameState(state);
  const session = next.stoneContestSession;
  if (!session || session.phase !== "between-rounds") return next;
  session.phase = "settlement";
  session.pendingSettlement = { ...pending(session, "withdraw", 0, 50, session.lastRound), fee: 0 };
  session.subtitles.push("在回合间结束挑战，参赛费已返还。");
  return next;
}

export function forfeitStoneContestRound(state: Readonly<GameState>): GameState {
  const next = cloneGameState(state);
  const session = next.stoneContestSession;
  if (!session || session.phase !== "round") return next;
  session.phase = "settlement";
  session.pendingSettlement = pending(session, "forfeit", 0, 50);
  session.subtitles.push("当前局按失败结算。");
  return next;
}

function relationBracket(value: number, thresholds: readonly [number, number][]): number {
  for (const [threshold, score] of thresholds) if (value >= threshold) return score;
  return 1;
}

function themeAffinity(state: Readonly<GameState>, partner: CharaSlot, theme: number): number {
  const data = charaDataOf(partner.charaNum);
  const likes = data?.senseLike ?? "";
  const dislikes = data?.senseDislike ?? "";
  const config = THEME_TAGS[clamp(theme, 1, 30) - 1]!;
  let score = 0;
  if (config.good.some((tag) => likes.includes(tag))) score += 35;
  if (config.bad.some((tag) => likes.includes(tag))) score -= 20;
  if (config.good.some((tag) => dislikes.includes(tag))) score -= 30;
  if (config.skill !== undefined) score += stat(state.master, "ABL", config.skill) + stat(partner, "ABL", config.skill);
  return score;
}

function scoreStoneCoupleReplay(
  state: Readonly<GameState>,
  session: StoneContestSession,
  replay: StoneReplayResult,
): StoneContestCoupleScore | null {
  const partner = state.charas[session.partner];
  if (!partner) return null;
  const masterSkill = stat(state.master, "ABL", 50) * 2 + stat(state.master, "ABL", 12);
  const partnerSkill = stat(partner, "ABL", 50) * 2 + stat(partner, "ABL", 12);
  const sourceTechnique = 30
    + stat(state.master, "TALENT", 51) * 5 + stat(state.master, "TALENT", 48) + stat(state.master, "ABL", 40) + stat(state.master, "TALENT", 49) + (state.stoneContestProgress?.rank ?? 0) * 2
    + stat(partner, "TALENT", 51) * 5 + stat(partner, "TALENT", 48) + stat(partner, "ABL", 40) + stat(partner, "TALENT", 49)
    + masterSkill + partnerSkill;
  const technique = sourceTechnique + Math.trunc(replay.precisionPermil * Math.max(1, masterSkill + partnerSkill) / 1000) - (replay.collapsedAt === null ? 0 : 15);
  const favor = stat(partner, "CFLAG", 2);
  const trust = stat(partner, "CFLAG", 4);
  const relationship = relationBracket(favor, [[100_000, 20], [50_000, 18], [30_000, 17], [15_000, 16], [10_000, 14], [5_000, 11], [3_000, 9], [2_000, 7], [1_500, 5]])
    + relationBracket(trust, [[30_000, 20], [10_000, 18], [8_000, 17], [5_000, 16], [3_500, 15], [2_000, 14], [1_000, 13], [700, 11], [500, 9], [300, 7], [200, 5]])
    + relationBracket(stat(partner, "EXP", 77), [[500, 9], [300, 8], [240, 7], [180, 6], [140, 5], [100, 4], [70, 3], [40, 2], [25, 1]])
    + relationBracket(stat(partner, "EXP", 41), [[500, 9], [300, 8], [240, 7], [180, 6], [140, 5], [100, 4], [70, 3], [40, 2], [25, 1]]);
  const authoredLove = stat(partner, "TALENT", 3) * 15 + stat(partner, "TALENT", 8) * 5 + stat(partner, "TALENT", 185) * 3 + stat(partner, "ABL", 9) + stat(partner, "TALENT", 62) * 5 - stat(partner, "TALENT", 14) - stat(partner, "MARK", 3) * 5 + relationship + 5;
  const cooperation = authoredLove + Math.trunc(replay.rhythmPermil * 19 / 1000);
  const theme = 35 + themeAffinity(state, partner, session.theme) + Math.trunc(replay.motifPermil * 34 / 1000);
  const total = Math.min(100, Math.trunc((technique + cooperation + theme) / 3));
  const award = stoneAwardForScore(total);
  return { technique, cooperation, theme, total, award };
}

export function scoreStoneCouple(state: Readonly<GameState>): StoneContestCoupleScore | null {
  const session = state.stoneContestSession;
  if (!session || session.mode !== "couple" || session.phase !== "round") return null;
  return scoreStoneCoupleReplay(state, session, replayForSession(state, session, STONE_CONTEST_DURATION_FRAMES));
}

export function resolveStoneCouple(state: Readonly<GameState>): GameState {
  const next = cloneGameState(state);
  const session = next.stoneContestSession;
  if (session) session.elapsedFrames = STONE_CONTEST_DURATION_FRAMES;
  if (!session || session.mode !== "couple" || session.phase !== "round") return next;
  const replay = replayForSession(next, session, STONE_CONTEST_DURATION_FRAMES);
  const score = scoreStoneCoupleReplay(next, session, replay);
  if (!score) return next;
  const opponentTotal = Math.max(1, Math.round(opponentTotals(session.seed ^ 0x633633, Math.min(8, stoneContestDifficulty(next) + 1)).second * .9));
  const playerTotal = replay.stableCount;
  const result: StoneContestRoundResult = {
    playerTotal,
    opponentTotal,
    outcome: playerTotal > opponentTotal ? "win" : playerTotal < opponentTotal ? "lose" : "tie",
    replay,
    opponentCollapsed: false,
  };
  session.phase = "settlement";
  const prize = result.outcome === "win" ? score.total >= 80 ? 20_000 : score.total >= 70 ? 5_000 : 0 : 0;
  session.pendingSettlement = pending(session, "couple", prize, 60, result, score);
  session.subtitles.push(`我方共堆起 ${playerTotal} 块，对手共堆起 ${opponentTotal} 块。`, `技术 ${score.technique} / 合作 ${score.cooperation} / 题意 ${score.theme}`, `综合得分：${score.total} 点`);
  return next;
}

function appendHistory(progress: StoneContestProgress, lines: readonly string[]): void {
  progress.history.push(...lines);
  if (progress.history.length > 500) progress.history.splice(0, progress.history.length - 500);
}

/** Commits the pending fee/reward/time/log once. A restored settlement screen
 * calls this same function; settled ids make the operation idempotent. */
export function commitStoneContestSettlement(state: Readonly<GameState>, now: () => number = Date.now): GameState {
  const next = cloneGameState(state);
  const session = next.stoneContestSession;
  const settlement = session?.pendingSettlement;
  if (!session || !settlement) return next;
  const progress = ensureStoneContestProgress(next);
  if (progress.settledSessionIds.includes(settlement.id)) {
    next.stoneContestSession = null;
    return next;
  }
  progress.settledSessionIds.push(settlement.id);
  if (progress.settledSessionIds.length > 24) progress.settledSessionIds.shift();
  if (settlement.payer === "player") pay(next, settlement.fee);
  if (settlement.payer === "clerk" && progress.clerkCharaNum !== undefined) {
    const clerk = next.charas[progress.clerkCharaNum];
    if (clerk) clerk.state.CFLAG[2] = (clerk.state.CFLAG[2] ?? 0) - 50;
  }
  if (settlement.payer === "partner") {
    const partner = next.charas[session.partner];
    if (partner) partner.state.CFLAG[2] = (partner.state.CFLAG[2] ?? 0) - 50;
  }
  grant(next, settlement.prize);
  const clerk = progress.clerkCharaNum === undefined ? undefined : next.charas[progress.clerkCharaNum];
  if (clerk) {
    const strongFinish = settlement.outcome === "champion" || (settlement.coupleScore?.total ?? 0) >= 80;
    clerk.state.CFLAG[2] = (clerk.state.CFLAG[2] ?? 0) + (strongFinish ? 30 : 8);
    clerk.state.CFLAG[4] = (clerk.state.CFLAG[4] ?? 0) + (strongFinish ? 3 : 1);
  }

  if (session.mode === "solo") {
    progress.soloMatches += 1;
    progress.soloWins += session.round;
    if (settlement.outcome === "champion") {
      progress.soloChampionships += 1;
      if (progress.rank <= session.rank) progress.rank = Math.min(5, session.rank + 1);
      next.master.state.TALENT[STONE_CONTEST_RANK_TALENT_ID] = Math.max(next.master.state.TALENT[STONE_CONTEST_RANK_TALENT_ID] ?? 0, progress.rank);
      progress.itemLevel = Math.min(4, Math.max(progress.itemLevel, progress.soloChampionships));
      if (progress.clerkStoryStage > 2) addItem(next, STONE_ITEM_TALC, 1);
    }
  } else if (session.mode === "couple" && settlement.coupleScore) {
    progress.coupleMatches += 1;
    const score = settlement.coupleScore;
    const partner = next.charas[session.partner];
    const physicalWin = settlement.roundResult?.outcome === "win";
    if (physicalWin) progress.coupleWins += 1;
    if (partner && physicalWin && score.total >= 80) {
      partner.state.EXP[77] = (partner.state.EXP[77] ?? 0) + 1;
      next.master.state.EXP[77] = (next.master.state.EXP[77] ?? 0) + 1;
      if (progress.clerkStoryStage > 2) addItem(next, STONE_ITEM_TALC, 1);
    }
    const record = progress.themeRecords[session.theme] ?? { bestScore: 0, bestPartner: 0, partnerBest: {}, trophy: false };
    if (score.total > record.bestScore) { record.bestScore = score.total; record.bestPartner = session.partner; }
    record.partnerBest[session.partner] = Math.max(record.partnerBest[session.partner] ?? 0, score.total);
    if (physicalWin && score.total >= 80) record.trophy = true;
    progress.themeRecords[session.theme] = record;
    progress.trophyCount = Object.values(progress.themeRecords).filter((entry) => entry.trophy).length;
    if (progress.trophyCount === 30 && !progress.allClearRewardClaimed) {
      progress.allClearRewardClaimed = true;
      grant(next, 100_000);
      addItem(next, STONE_ITEM_MIRACLE, 3);
      addItem(next, STONE_ITEM_LAMENT, 1);
    }
    if (progress.allClearRewardClaimed && progress.rank === 5) {
      progress.rank = 6;
      next.master.state.TALENT[STONE_CONTEST_RANK_TALENT_ID] = 6;
    }
  }

  appendHistory(progress, session.subtitles);
  const logEvents: ObservationEvent[] = session.subtitles.map((text) => ({ kind: "NARRATION", timestamp: now(), text }));
  logEvents.push(...advanceTimeTicks(next, settlement.timeMinutes).map((event) => ({ ...event, timestamp: now() })));
  next.eventLog = [...next.eventLog, ...logEvents];
  next.stoneContestSession = null;
  return next;
}

export function renameStoneContestClerk(state: Readonly<GameState>, name: string): GameState {
  const next = cloneGameState(state);
  const progress = ensureStoneContestProgress(next);
  const trimmed = name.trim().slice(0, 24);
  if (!trimmed || progress.clerkCharaNum === undefined) return next;
  const clerk = next.charas[progress.clerkCharaNum];
  if (!clerk) return next;
  clerk.callName = trimmed;
  progress.clerkName = trimmed;
  progress.namingStatus = "named";
  progress.clerkStoryStage = Math.max(progress.clerkStoryStage, 2);
  return next;
}

export interface StoneClerkStoryOpportunity {
  stage: number;
  title: string;
  requirement: string;
}

const CLERK_STORY = [
  { favor: 100, trust: 0, title: "赛场上的朋友", requirement: "好感度 100" },
  { favor: 300, trust: 10, title: "请叫我的名字", requirement: "好感度 300 / 信赖度 10" },
  { favor: 2_000, trust: 100, title: "确认彼此的感情", requirement: "好感度 2000 / 信赖度 100" },
  { favor: 4_000, trust: 300, title: "休赛日的约会", requirement: "好感度 4000 / 信赖度 300" },
  { favor: 8_000, trust: 600, title: "赛场灯火熄灭后", requirement: "好感度 8000 / 信赖度 600" },
] as const;

export function stoneClerkStoryOpportunity(state: Readonly<GameState>): StoneClerkStoryOpportunity | null {
  const progress = state.stoneContestProgress;
  const clerk = progress?.clerkCharaNum === undefined ? undefined : state.charas[progress.clerkCharaNum];
  if (!progress || !clerk || progress.clerkStoryStage >= CLERK_STORY.length) return null;
  const target = CLERK_STORY[progress.clerkStoryStage]!;
  if ((clerk.state.CFLAG[2] ?? 0) < target.favor || (clerk.state.CFLAG[4] ?? 0) < target.trust) return null;
  return { stage: progress.clerkStoryStage + 1, title: target.title, requirement: target.requirement };
}

/** Adult replacement for the upstream restricted late branch. Relationship
 * thresholds use the clerk CharaSlot; the final stay is a non-explicit fade. */
export function advanceStoneClerkStory(state: Readonly<GameState>): GameState {
  const opportunity = stoneClerkStoryOpportunity(state);
  const next = cloneGameState(state);
  const progress = next.stoneContestProgress;
  if (!opportunity || !progress) return next;
  progress.clerkStoryStage = opportunity.stage;
  const lines: Record<number, string[]> = {
    1: ["受付员把记分板交给你保管了一会儿。你们已不只是参赛者与工作人员，也是赛场上的朋友。"],
    2: ["「总叫我受付员也有些奇怪呢。下次，请替我想一个名字吧。」"],
    3: ["你们在收起最后一面旗帜时确认了彼此的心意。没有比赛，也无需裁判。"],
    4: ["休赛日，你们离开赛河原，在彼岸安静地约会了一整天。"],
    5: ["夜深后，赛场的灯一盏盏熄灭。你们并肩留了下来。", "——翌晨，木牌上的新赛程已经写好。"],
  };
  if (opportunity.stage === 2) progress.namingStatus = "pending";
  appendHistory(progress, lines[opportunity.stage] ?? []);
  const session = next.stoneContestSession;
  if (session) session.subtitles.push(...(lines[opportunity.stage] ?? []));
  return next;
}

export function leaveStoneContestLobby(state: Readonly<GameState>): GameState {
  const next = cloneGameState(state);
  if (next.stoneContestSession?.phase === "lobby") next.stoneContestSession = null;
  return next;
}
