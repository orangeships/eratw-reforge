/**
 * 斗虫 (COMF483 ムシバトル / COMF497 ムシ合わせ) — deterministic battle engine.
 *
 * Faithful port of:
 *   - `ERB/コマンド関連/COMF/日常系/MUSHI_BATTLE.ERB`      (1122 lines)
 *   - `@MUSHI_PALAM` / `@MUSHI_FLAGSETTING` in `COMF449 虫捕り.ERB:850-924`
 *   - `@MBP` / `@MBP_RANK` in `COMF483 ムシバトル.ERB:900-1065`
 *   - `@CHARA_MUSHICAGE_SETTING` / `@DRAW_MUSHI_DESIGN` in COMF483:763-895 / COMF449:374-472
 *
 * Design constraints (per AGENTS.md):
 *   - Pure functions. No `GameState` mutation, no I/O, no `Math.random`.
 *   - Every RNG draw goes through the injected `rng`, so a seed reproduces a
 *     battle exactly. `eraRand(n)` mirrors ERA `RAND:n` (0..n-1).
 *   - Integer arithmetic uses `Math.floor` to match Emuera truncation.
 *
 * Upstream bugs preserved on purpose (do NOT "fix" without a decision):
 *   1. Rarity-gap damage bonus (×1.05…1.30) is wrapped in `[SKIPSTART]/[SKIPEND]`
 *      at `MUSHI_BATTLE.ERB:513-527` — it is dead code upstream and stays dead.
 *   2. `先手必勝` compares `MUSHI_ORDER:1` (a *flag* number, always `player*10+slot`,
 *      i.e. 11/21/31/41) against `ARG` (a *player* number, 1..4). It can never
 *      match, so the ×1.20 bonus never applies. See `firstStandNum` below.
 *   3. `流砂` compares `NAME_FIELD_TYPE(MUSHI_FIELD:99) == "[砂地]"`. That function
 *      concatenates every set bit, so equality only holds when the battle field is
 *      *exactly* bit 3 — never when the location maps to several field types.
 *   4. `蝶効果` halves the HP of every insect including the user's own team.
 */

import { BUG_CATALOG, bugDefFor, type BugDef, type CaughtBug } from "./bug-catching.js";

// ---------------------------------------------------------------------------
// Constants (MUSHI_ERH.ERH)
// ---------------------------------------------------------------------------

/** `MUSHI_MAXSELECT` — insects fielded per battler. */
export const MUSHI_MAX_SELECT = 3;
/** `MUSHI_MAXBATTLE` — battlers per battle (MASTER is always slot 1). */
export const MUSHI_MAX_BATTLE = 4;

/**
 * Field-type bit layout, shared with `bug-catching.ts` `FIELD`.
 * Upstream display names (`NAME_FIELD_TYPE`, COMF449:1382-1401):
 * 0 草原 · 1 花畑 · 2 森林 · 3 砂地 · 4 水辺 · 5 岩場 · 6 家屋 · 7 磚瓦 · 8 圣域 · 9 魔界
 */
export const FIELD_TYPE = {
  PLAIN: 1 << 0,
  FLOWERS: 1 << 1,
  FOREST: 1 << 2,
  SAND: 1 << 3,
  WATERSIDE: 1 << 4,
  ROCKY: 1 << 5,
  HOUSE: 1 << 6,
  TILES: 1 << 7,
  SANCTUARY: 1 << 8,
  YOUKAI: 1 << 9,
} as const;

const FIELD_TYPE_NAMES: readonly string[] = [
  "[草原]", "[花畑]", "[森林]", "[砂地]", "[水辺]",
  "[岩場]", "[家屋]", "[磚瓦]", "[圣域]", "[魔界]",
];

/** `NAME_FIELD_TYPE` — concatenates every set bit, in bit order. */
export function nameFieldType(bits: number): string {
  let out = "";
  for (let bit = 0; bit < FIELD_TYPE_NAMES.length; bit++) {
    if (bits & (1 << bit)) out += FIELD_TYPE_NAMES[bit]!;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * `MUSHI_STATUS` is an upstream `<标签>`-delimited string; we model it as a set.
 * Order matches the upstream append order so log output stays comparable.
 */
export type BugStatus =
  | "得意地形" | "得意季節" | "大将" | "高揚" | "逆襲" | "陽炎"
  | "睡眠" | "麻痹" | "緩慢" | "混乱" | "毒" | "猛毒" | "悪臭";

/** One fielded insect, mirroring `MUSHI_CAGE:(player*10+slot)` + the derived stats. */
export interface BattleBug {
  /** 1..3, upstream `MUSHI_STANDNUM % 10`. */
  slot: number;
  /** Upstream `MUSHI_NUM` species index. */
  bugNum: number;
  name: string;
  rare: number;
  rank: number;
  gType: boolean;
  xType: boolean;
  type: string;
  tribe: string;
  field: number;
  skl: string;
  size: number;
  maxHp: number;
  hp: number;
  atk: number;
  spd: number;
}

/** A participant. Upstream `MUSHI_BATTLER:i` + the parallel `MUSHI_*` arrays. */
export interface BattleBattler {
  /** 1..4. Slot 1 is always MASTER. */
  player: number;
  /** 0 = MASTER, otherwise the character number. */
  charaNum: number;
  name: string;
  /** Upstream team parity: `(player % 2)`. Team battle treats equal parity as allies. */
  team: number;
  /** `MUSHI_MENTAL` — reaching 0 forces a forfeit. -1 once forfeited. */
  mental: number;
  /** Fielded insects in slot order; `undefined` = consumed / empty. */
  bugs: (BattleBug | undefined)[];
  /** Index into `bugs`; -1 once the battler has nothing left. */
  standIndex: number;
  forfeited: boolean;
  /** 1-based finishing position; 0 while still fighting. */
  placement: number;
  status: BugStatus[];
}

/** One log line. `kind` drives UI emphasis, not gameplay. */
export interface BattleLine {
  round: number;
  kind: "info" | "attack" | "skill" | "damage" | "evade" | "ko" | "forfeit" | "result";
  text: string;
}

/**
 * Immutable view of one battler at the end of a round.
 *
 * Upstream redraws the whole field after every message, so a presentation layer
 * must be able to see HP/status *as of* each round. The engine is pure and
 * hands out copies rather than references so replaying a finished battle can
 * never mutate it.
 */
export interface BattleSnapshot {
  player: number;
  name: string;
  /** `standingBug` at this moment, or null when the slot is spent. */
  bugNum: number | null;
  bugName: string | null;
  hp: number;
  maxHp: number;
  atk: number;
  spd: number;
  rank: number;
  gType: boolean;
  xType: boolean;
  type: string;
  statuses: readonly BugStatus[];
  /** Insects still held, drawn as ●○. */
  remaining: number;
  forfeited: boolean;
}

/** The finished battle. `rounds[i]` holds the lines emitted during round `i`. */
export interface BattleResult {
  rounds: BattleLine[][];
  /** `snapshots[i]` is the state at the end of round `i`, one entry per battler. */
  snapshots: BattleSnapshot[][];
  /** `MUSHI_FINISH` — battler number per finishing slot, 0 when unfilled. */
  finish: number[];
  /** Winner battler number (upstream `MUSHI_FINISH:0`), 0 when the game set never resolved. */
  winner: number;
  /** Battler numbers that were knocked out or forfeited, in elimination order. */
  eliminated: number[];
}

/** Everything the engine needs; no ambient state is read. */
export interface BattleSetup {
  battlers: BattleBattler[];
  /** `MUSHI_FIELD:99` — the battle field bitset. */
  field: number;
  /** `MUSHI_TEAM` — non-zero enables ally-by-parity targeting. */
  team: boolean;
  /** `MUSHI_POWER` per battler (`特殊補正`), normally 0. */
  power?: Record<number, number>;
  /**
   * Player-controlled swap-ins. Upstream blocks on `INPUT` inside the round loop
   * (COMF483 `@MUSHI_BATTLE_CHANGE`); a modern turn-based port resolves it here.
   * Keyed by battler number. Omitted entries fall back to "first insect still held".
   */
  chooseSwap?: (battler: BattleBattler) => BattleBug | undefined;
  /** Season label used for `得意季節` (`春の虫`/`夏の虫`/`秋の虫`). */
  month?: "春之月" | "夏之月" | "秋之月" | "冬之月";
  /** Guard against a pathological loop; upstream is unbounded. */
  maxRounds?: number;
}

// ---------------------------------------------------------------------------
// RNG helpers
// ---------------------------------------------------------------------------

/** ERA `RAND:n` → integer in [0, n). */
export function eraRand(rng: () => number, n: number): number {
  if (n <= 0) return 0;
  return Math.floor(rng() * n);
}

/** `SKILL` 判定 — `RAND:100 < 確率`, where 確率 may be fractional after ×1.5. */
function skillRoll(chance: number, rng: () => number): boolean {
  return eraRand(rng, 100) < chance;
}

// ---------------------------------------------------------------------------
// MUSHI_PALAM — stat derivation (COMF449:850-905)
// ---------------------------------------------------------------------------

export interface PalamInput {
  def: BugDef;
  rank: number;
  gType: boolean;
  xType: boolean;
  /** `特殊補正` (`MUSHI_POWER`). */
  power: number;
  statuses: readonly BugStatus[];
  /** `戦闘中HP`; 0 or omitted means "fill to max". */
  battleHp?: number;
}

/**
 * Derive max HP / ATK / SPD / SIZE for one insect.
 * `補正値 = 80 + ((RANK + 1) / 2) + 特殊補正`, integer-truncated as in ERA.
 */
export function mushiPalam(input: PalamInput): { maxHp: number; atk: number; spd: number; size: number; hp: number } {
  const { def, rank, gType, xType, power, statuses } = input;
  const correction = Math.floor(80 + ((rank + 1) / 2) + power);
  let maxHp = Math.floor((def.hp * correction) / 100);
  let atk = Math.floor((def.atk * correction) / 100);
  let spd = Math.floor((def.spd * correction) / 100);
  let size = Math.floor((def.size * correction) / 100);

  // 変異による補正 (COMF449:865-873)
  if (gType) {
    maxHp = Math.floor(maxHp * 1.5);
    atk = Math.floor(atk * 1.5);
    size = Math.floor(size * 2.0);
  }
  if (xType) {
    spd = Math.floor(spd * 1.5);
    size = Math.floor(size * 0.5);
  }

  // 状態変化による補正 (COMF449:874-900)
  if (statuses.includes("得意季節")) { atk = Math.floor(atk * 1.2); spd = Math.floor(spd * 1.2); }
  if (statuses.includes("得意地形")) { atk = Math.floor(atk * 1.2); spd = Math.floor(spd * 1.2); }
  if (statuses.includes("大将")) { atk = Math.floor(atk * 1.2); spd = Math.floor(spd * 1.2); }
  if (statuses.includes("高揚")) { atk = Math.floor(atk * 1.5); spd = Math.floor(spd * 1.5); }
  if (statuses.includes("逆襲")) { atk = Math.floor(atk * 1.5); spd = Math.floor(spd * 1.5); }
  if (statuses.includes("悪臭")) atk = Math.floor(atk * 0.5);
  if (statuses.includes("麻痹")) spd = Math.floor(spd * 0.5);
  if (statuses.includes("緩慢")) spd = Math.floor(spd * 0.5);

  const hp = input.battleHp ? input.battleHp : maxHp;
  return { maxHp, atk, spd, size, hp };
}

// ---------------------------------------------------------------------------
// MBP — 斗虫 battle power (COMF483:900-1023)
// ---------------------------------------------------------------------------

/** Inputs to `MBP`, kept structural so callers supply real game state. */
export interface MbpInput {
  /** `TALENT:採集Lv` → { 0:1, 1:2, 2:4, 3:8, 4:12, 5:18, else 25 }. */
  gatheringLevel: number;
  /** `ABL:教養` → { 0:1, 1:1.2, 2:1.4, 3:1.6, 4:1.8, 5:2, else 2.4 }. */
  refinement: number;
  /** `ABL:戦闘能力` → { 0:1, 1:1.1, 2:1.2, 3:1.3, 4:1.5, 5:1.7, else 2 }. */
  combatAbility: number;
  /** `TALENT:汚臭耐性` → { -2:0.2, -1:0.5, 1:2, 2:3 }. 0 applies no multiplier. */
  stenchResistance: number;
  hasMixingKnowledge: boolean;
  hasForbiddenKnowledge: boolean;
  isChildish: boolean;
  /** 人类 tribe name: 天人 / 仙人 / 月人 / 魔界人 / 外界人 / other. */
  humanTribe: string;
  /** True when the character is Kaguya or Eirin (月人 exception). */
  isLunarException: boolean;
  /** 妖怪 tribe name: 鬼 / 河童 / 天狗 / 妖兽 / 妖鸟 / 妖虫 / 恶魔 / 小人 / 山童 / 妖怪 / other. */
  youkaiTribe: string;
  isVampire: boolean;
  /** True when 妖怪 tribe is 妖精. */
  isFairy: boolean;
  /** How many `怪诞/` entries appear in 料理：喜欢的味道. */
  likedBizarreCount: number;
  /** How many `怪诞/` entries appear in 料理：讨厌的味道. */
  dislikedBizarreCount: number;
}

/** `MBP` — base 1000 scaled by gathering, abilities, talents, tribes and taste. */
export function mushiBattlePower(input: MbpInput): number {
  let value = 1000;

  const gatherTable: readonly number[] = [1, 2, 4, 8, 12, 18];
  value *= input.gatheringLevel <= 5 ? gatherTable[input.gatheringLevel]! : 25;

  const refineTable: readonly number[] = [1, 1.2, 1.4, 1.6, 1.8, 2];
  value *= input.refinement <= 5 ? refineTable[input.refinement]! : 2.4;

  const combatTable: readonly number[] = [1, 1.1, 1.2, 1.3, 1.5, 1.7];
  value *= input.combatAbility <= 5 ? combatTable[input.combatAbility]! : 2;

  if (input.stenchResistance === -2) value *= 0.2;
  else if (input.stenchResistance === -1) value *= 0.5;
  else if (input.stenchResistance === 1) value *= 2;
  else if (input.stenchResistance === 2) value *= 3;

  if (input.hasMixingKnowledge) value *= 1.5;
  if (input.hasForbiddenKnowledge) value *= 2.5;
  if (input.isChildish) value *= 15;

  if (input.humanTribe === "天人") value *= 0.3;
  else if (input.humanTribe === "仙人") value *= 1.5;
  else if (input.humanTribe === "月人" && !input.isLunarException) value *= 0.05;
  else if (input.humanTribe === "魔界人") value *= 1.5;
  else if (input.humanTribe === "外界人") value *= 0.8;

  const youkai = input.youkaiTribe;
  if (youkai === "鬼") value *= 4;
  else if (youkai === "河童") value *= 2;
  else if (youkai === "天狗") value *= 1.5;
  else if (youkai === "妖兽") value *= 2;
  else if (youkai === "妖鸟") value *= 2;
  else if (youkai === "妖虫") value *= 25;
  else if (youkai === "恶魔") value *= 2.5;
  else if (youkai === "小人") value *= 0.05;
  else if (youkai === "山童") value *= 4;
  else if (youkai === "妖怪") value *= 1.2;
  else if (input.isVampire) value *= 1.5;

  if (input.isFairy) value *= 15;

  if (input.likedBizarreCount >= 5) value *= 4;
  else if (input.likedBizarreCount >= 3) value *= 3;
  else if (input.likedBizarreCount >= 1) value *= 2;

  if (input.dislikedBizarreCount >= 5) value *= 0.1;
  else if (input.dislikedBizarreCount >= 3) value *= 0.2;
  else if (input.dislikedBizarreCount === 1) value *= 0.5;

  return Math.floor(value);
}

/**
 * `MBP_RANK` (COMF483:1028-1065) and the `RARE_MAX` ladder it feeds
 * (`CHARA_MUSHICAGE_SETTING`, COMF483:843-875). Both walk the same thresholds;
 * the rank ladder collapses each pair into one bucket.
 */
const MBP_LADDER: readonly [number, number][] = [
  [300, 0], [1000, 0], [1600, 1], [2200, 1], [3200, 2], [5000, 2],
  [6200, 3], [8000, 3], [12000, 4], [20000, 4], [30000, 5], [50000, 5],
  [150000, 6], [500000, 6], [1000000, 7],
];

/** `MBP_RANK` — 0..8. */
export function mushiBattlePowerRank(mbp: number): number {
  if (mbp >= 1000000) return 8;
  for (const [threshold, rank] of MBP_LADDER) {
    if (mbp < threshold) return rank;
  }
  return 8;
}

/** `RARE_MAX` for an NPC cage — the un-collapsed ladder (0..9). */
export function rarityMaxForPower(mbp: number): number {
  if (mbp >= 1000000) return 9;
  for (const [threshold, rank] of MBP_LADDER) {
    if (mbp < threshold) return Math.min(rank + 2, 9);
  }
  return 9;
}

// ---------------------------------------------------------------------------
// Cage construction
// ---------------------------------------------------------------------------

/** Convert a caught insect (or a plain species id) into a fielded `BattleBug`. */
export function toBattleBug(
  caught: CaughtBug,
  power: number,
  slot = 0,
  statuses: readonly BugStatus[] = [],
  battleHp = 0,
): BattleBug | undefined {
  const def = bugDefFor(caught.bugNum);
  if (!def) return undefined;
  const stats = mushiPalam({
    def,
    rank: caught.rank,
    gType: caught.gType,
    xType: caught.xType,
    power,
    statuses,
    battleHp,
  });
  return {
    slot,
    bugNum: def.num,
    name: def.name,
    rare: def.rarity,
    rank: caught.rank,
    gType: caught.gType,
    xType: caught.xType,
    type: def.type,
    tribe: def.tribe,
    field: def.field,
    skl: def.skl,
    size: stats.size,
    maxHp: stats.maxHp,
    hp: stats.hp,
    atk: stats.atk,
    spd: stats.spd,
  };
}

export interface CageDrawRequest {
  /** Minimum rarity (upstream `RARE_MIN`, defaults to `mushiBattlePowerRank`). */
  rareMin?: number;
  rareMax?: number;
  rankMin?: number;
  rankMax?: number;
  /** Mutation chance percent for G-type / X-type (upstream `D_MUTA`). */
  mutationRate?: number;
  /** Required field bits, tribe substring, type substring, area bits. */
  field?: number;
  area?: number;
  tribe?: string;
  type?: string;
  /** `CHARA == 999` (an NPC) skips the mechanical-tribe restrictions. */
  npc?: boolean;
  /** Tribe restrictions, only applied when `npc` is false. */
  humanTribe?: string;
  youkaiTribe?: string;
  isLunarException?: boolean;
}

/**
 * `DRAW_MUSHI_DESIGN` (COMF449:374-472) — pick a species and roll its identity.
 *
 * Upstream shuffles all 400 slots and walks them; a filtered shuffle preserves
 * that "uniform over the eligible set" behaviour. Upstream blacklists
 * `那个 / 蚰蜒 / 蝇 / 蚊 / 跳蚤`, which are never catchable.
 */
export function drawBugCageEntry(request: CageDrawRequest, rng: () => number): CaughtBug | undefined {
  const {
    rareMin = 0,
    rareMax = 9,
    rankMin = 0,
    rankMax = 100,
    mutationRate = 3,
    field = 0,
    area = 0,
    tribe = "",
    type = "",
    npc = false,
    humanTribe,
    youkaiTribe,
    isLunarException = false,
  } = request;

  const NEVER_CATCHABLE = ["那个", "蚰蜒", "蝇", "蚊", "跳蚤"];
  const eligible = BUG_CATALOG.filter((bug) => {
    if (bug.rarity < rareMin || bug.rarity > rareMax) return false;
    if (field && !(bug.field & field)) return false;
    if (area && !(bug.area & area)) return false;
    if (tribe !== "" && !bug.tribe.includes(tribe)) return false;
    if (type !== "" && !bug.type.includes(type)) return false;
    if (NEVER_CATCHABLE.some((name) => bug.name.includes(name))) return false;
    if (npc) return true;
    // 月人は機械のみ（輝夜と永琳を除く）; otherwise only 河童 may use 機械.
    if (humanTribe === "月人") {
      if (!isLunarException && !bug.tribe.includes("機械")) return false;
    } else if (youkaiTribe !== "河童" && bug.tribe.includes("機械")) {
      return false;
    }
    return true;
  });

  if (eligible.length === 0) return undefined;
  const def = eligible[eraRand(rng, eligible.length)]!;

  // Rank: upstream loops until the roll clears RANK_MIN, which biases upward.
  let rank = -1;
  if (rankMax) {
    let guard = 0;
    while (rank < rankMin && guard++ < 1000) rank = eraRand(rng, rankMax);
    if (rank < rankMin) rank = rankMin;
  } else {
    rank = eraRand(rng, 100);
  }

  const gType = eraRand(rng, 100) < mutationRate;
  const xType = eraRand(rng, 100) < mutationRate;

  return {
    id: `npc-${def.num}-${rank}-${gType ? 1 : 0}${xType ? 1 : 0}`,
    bugNum: def.num,
    rank,
    gType,
    xType,
    caughtDay: 0,
    location: "",
  };
}

/**
 * `CHARA_MUSHICAGE_SETTING` (COMF483:763-895) — build an opponent's full cage.
 * The opponent's `MBP` drives rarity ceiling, rank floor and mutation rate.
 */
export function buildNpcCage(
  power: number,
  size: number,
  request: CageDrawRequest = {},
  rng: () => number = () => 0.5,
): CaughtBug[] {
  const rareMax = request.rareMax ?? rarityMaxForPower(power);
  const rankMin = request.rankMin ?? Math.max(0, Math.min(80, Math.floor(power / 2000)));
  const mutationRate = request.mutationRate ?? Math.max(1, Math.min(25, Math.floor(power / 10000)));
  const cage: CaughtBug[] = [];
  for (let index = 0; index < size; index++) {
    const entry = drawBugCageEntry(
      { ...request, rareMax, rankMin, mutationRate, npc: true },
      rng,
    );
    if (entry) cage.push(entry);
  }
  return cage;
}

// ---------------------------------------------------------------------------
// Engine internals
// ---------------------------------------------------------------------------

/** `残りムシ数` — insects still held by a battler. */
export function bugsRemaining(battler: BattleBattler): number {
  return battler.bugs.filter((bug) => bug !== undefined).length;
}

function standOf(battler: BattleBattler): BattleBug | undefined {
  return battler.bugs[battler.standIndex];
}

/** `MUSHI_HP` bookkeeping — `MUSHI_DAMAGE` clamps at 0 (COMF449:745-746). */
function applyDamage(bug: BattleBug, amount: number): void {
  bug.hp = Math.max(bug.hp - amount, 0);
}

function countType(type: string, colour: string): number {
  return type.includes(colour) ? 1 : 0;
}

/**
 * 属性相性 (MUSHI_BATTLE.ERB:529-540). Each matching step is ×1.50 and they
 * compound: `赤→緑→青→赤` and `白→黒→白`. Multi-type insects can stack steps.
 */
export function typeAdvantageStep(attackerType: string, defenderType: string): number {
  let steps = 0;
  steps += countType(attackerType, "赤") * countType(defenderType, "緑");
  steps += countType(attackerType, "緑") * countType(defenderType, "青");
  steps += countType(attackerType, "青") * countType(defenderType, "赤");
  steps += countType(attackerType, "白") * countType(defenderType, "黒");
  steps += countType(attackerType, "黒") * countType(defenderType, "白");
  return steps;
}

/**
 * 回避率 (MUSHI_BATTLE.ERB:435-464). The ladder compares with integer division,
 * so a 1.0× speed gap gives 10% rather than 0% (ERA's `<` is strict).
 */
export function evasionRate(attacker: BattleBug, defender: BattleBug, defenderStatuses: readonly BugStatus[], uncounterable: boolean): number {
  if (uncounterable) return 0;
  const a = attacker.spd;
  const d = defender.spd;
  let rate = 0;
  if (Math.floor((a * 500) / 100) < d) rate = 70;
  else if (Math.floor((a * 400) / 100) < d) rate = 60;
  else if (Math.floor((a * 300) / 100) < d) rate = 50;
  else if (Math.floor((a * 250) / 100) < d) rate = 40;
  else if (Math.floor((a * 200) / 100) < d) rate = 30;
  else if (Math.floor((a * 150) / 100) < d) rate = 20;
  else if (Math.floor((a * 100) / 100) < d) rate = 10;
  else rate = 0;

  if (defender.skl.includes("極小")) rate += 30;
  if (defender.skl.includes("高速回避")) rate += 30;
  // 睡眠|麻痹|緩慢 zero the whole rate, not just the ladder part.
  if (["睡眠", "麻痹", "緩慢"].some((status) => defenderStatuses.includes(status as BugStatus))) rate = 0;
  return Math.min(rate, 80);
}

/** Status applied by each single-effect skill. */
const SKILL_STATUS: Readonly<Record<string, BugStatus>> = {
  毒攻撃: "毒",
  猛毒攻撃: "猛毒",
  麻痹攻撃: "麻痹",
  睡眠粉: "睡眠",
  音波攻撃: "混乱",
  黏液攻撃: "緩慢",
  悪臭攻撃: "悪臭",
};

// ---------------------------------------------------------------------------
// The battle
// ---------------------------------------------------------------------------

interface Engine {
  setup: BattleSetup;
  battlers: BattleBattler[];
  field: number;
  round: number;
  lines: BattleLine[];
  rounds: BattleLine[][];
  finish: number[];
  winner: number;
  eliminated: number[];
  rng: () => number;
  /** `MUSHI_ORDER` — battler numbers acting this round, fastest first. */
  order: number[];
  /** `MUSHI_ORDER:1` as upstream computes it: `player * 10 + slot`. */
  firstStandNum: number;
}

function emit(engine: Engine, kind: BattleLine["kind"], text: string): void {
  const line: BattleLine = { round: engine.round, kind, text };
  engine.lines.push(line);
}

/** `MUSHI_BATTLE_ETB` (MUSHI_BATTLE.ERB:1040-1089) — field an insect and set up its statuses. */
function enterField(engine: Engine, battler: BattleBattler, index: number): void {
  const bug = battler.bugs[index];
  if (!bug) return;
  battler.standIndex = index;
  battler.status = [];

  const power = engine.setup.power?.[battler.player] ?? 0;
  const has = (token: string): boolean => bug.skl.includes(token);
  const def = bugDefFor(bug.bugNum);

  if (has("浄化")) {
    engine.field = FIELD_TYPE.TILES; // `SETBIT MUSHI_FIELD:99, 7`
    emit(engine, "skill", `《${bug.name}》的[浄化]发动！场地变化为＜${nameFieldType(engine.field)}＞了！`);
  } else if (bug.field & engine.field) {
    battler.status.push("得意地形");
  }

  if (has("春の虫") && engine.setup.month === "春之月") battler.status.push("得意季節");
  else if (has("夏の虫") && engine.setup.month === "夏之月") battler.status.push("得意季節");
  else if (has("秋の虫") && engine.setup.month === "秋之月") battler.status.push("得意季節");

  if (bugsRemaining(battler) === 1) {
    if (has("大将")) {
      battler.status.push("大将");
      emit(engine, "skill", `《${bug.name}》的[大将]发动！因为是最后的一只而充满活力！`);
    } else {
      emit(engine, "info", `《${bug.name}》是最后的一只！`);
    }
  }

  if (has("陽炎")) {
    battler.status.push("陽炎");
    emit(engine, "skill", `《${bug.name}》的[陽炎]发动！`);
  }

  if (def) {
    const stats = mushiPalam({
      def,
      rank: bug.rank,
      gType: bug.gType,
      xType: bug.xType,
      power,
      statuses: battler.status,
      battleHp: 0,
    });
    bug.maxHp = stats.maxHp;
    bug.hp = stats.maxHp;
    bug.atk = stats.atk;
    bug.spd = stats.spd;
    bug.size = stats.size;
  }
}

/**
 * Target selection (MUSHI_BATTLE.ERB:249-281). Rejects self, allies (team
 * battle parity), KO'd insects, forfeited battlers and 擬態 at 50%. Upstream
 * gives up after 100 rolls and prints a "no target" line.
 */
function selectTarget(engine: Engine, attacker: BattleBattler): BattleBattler | undefined {
  const count = engine.battlers.length;
  for (let attempt = 0; attempt <= 100; attempt++) {
    const candidate = engine.battlers[eraRand(engine.rng, count)]!;
    if (candidate.player === attacker.player) continue;
    if (engine.setup.team && candidate.team === attacker.team) continue;
    const bug = standOf(candidate);
    if (!bug || bug.hp <= 0) continue;
    if (candidate.forfeited) continue;
    if (bug.skl.includes("擬態") && !eraRand(engine.rng, 2)) continue;
    return candidate;
  }
  return undefined;
}

interface AttackOutcome {
  /** Damage dealt to the (possibly swapped) target. */
  dealt: number;
}

/** `MUSHI_BATTLE_COMBAT` (MUSHI_BATTLE.ERB:226-720). */
function combat(engine: Engine, attacker: BattleBattler, target: BattleBattler): void {
  let actor = attacker;
  let victim = target;
  const actorBug = standOf(actor);
  const victimBug = standOf(victim);
  if (!actorBug || !victimBug) return;

  if (actorBug.hp <= 0 || actor.forfeited) return;
  if (actor.status.includes("睡眠")) {
    emit(engine, "info", `《${actorBug.name}》正在睡眠……zZZ`);
    return;
  }

  // 攻撃時判定 — ダメージ補正 is a percentage starting at 100.
  let modifier = 100;
  let fixedDamage = 0;
  let attackSkill = "";
  const skillNames: string[] = [];
  const has = (token: string): boolean => actorBug.skl.includes(token);
  const victimHas = (token: string): boolean => victimBug.skl.includes(token);
  /** `スキル判定` — 得意地形/猛攻/Ｘ型 each ×1.5; 麻痹 forces 0. */
  const proc = (chance: number): boolean => {
    let c = chance;
    if (actor.status.includes("得意地形")) c *= 1.5;
    if (has("猛攻")) c *= 1.5;
    if (actorBug.xType) c *= 1.5;
    if (actor.status.includes("麻痹")) c = 0;
    return skillRoll(c, engine.rng);
  };

  // 単独の攻撃スキル — an ELSEIF chain, so at most one fires.
  if (has("毒攻撃") && !has("猛毒攻撃") && proc(40) && !victim.status.includes("毒")) {
    emit(engine, "attack", `【${actor.name}】《${actorBug.name}》的『毒攻撃』！`);
    modifier *= 0.8; attackSkill = "毒攻撃"; skillNames.push("毒攻撃");
  } else if (has("猛毒攻撃") && proc(20) && !victim.status.includes("猛毒")) {
    emit(engine, "attack", `【${actor.name}】《${actorBug.name}》的『猛毒攻撃』！`);
    modifier *= 0.8; attackSkill = "猛毒攻撃"; skillNames.push("猛毒攻撃");
  } else if (has("麻痹攻撃") && proc(30) && !victim.status.includes("麻痹")) {
    emit(engine, "attack", `【${actor.name}】《${actorBug.name}》的『麻痹攻撃』！`);
    modifier *= 0.8; attackSkill = "麻痹攻撃"; skillNames.push("麻痹攻撃");
  } else if (has("睡眠粉") && proc(20) && !victim.status.includes("睡眠")) {
    emit(engine, "attack", `【${actor.name}》《${actorBug.name}》的『睡眠粉』！`);
    modifier *= 0.8; attackSkill = "睡眠粉"; skillNames.push("睡眠粉");
  } else if (has("音波攻撃") && proc(40) && !victim.status.includes("混乱")) {
    emit(engine, "attack", `【${actor.name}】《${actorBug.name}》的『音波攻撃』！`);
    modifier *= 0.8; attackSkill = "音波攻撃"; skillNames.push("音波攻撃");
  } else if (has("黏液攻撃") && proc(40) && !victim.status.includes("緩慢")) {
    emit(engine, "attack", `【${actor.name}】《${actorBug.name}》的『黏液攻撃』！`);
    modifier *= 0.8; attackSkill = "黏液攻撃"; skillNames.push("黏液攻撃");
  } else if (has("悪臭攻撃") && proc(40) && !victim.status.includes("悪臭")) {
    emit(engine, "attack", `【${actor.name}】《${actorBug.name}》的『悪臭攻撃』！`);
    modifier *= 0.8; attackSkill = "悪臭攻撃"; skillNames.push("悪臭攻撃");
  } else if (has("诅咒攻撃") && proc(30)) {
    emit(engine, "attack", `【${actor.name}】《${actorBug.name}》的『诅咒攻撃』！`);
    modifier *= 0.8; attackSkill = "诅咒攻撃"; skillNames.push("诅咒攻撃");
  } else if (has("吸収攻撃") && proc(100)) {
    emit(engine, "attack", `【${actor.name}】《${actorBug.name}》的『吸収攻撃』！`);
    attackSkill = "吸収攻撃"; skillNames.push("吸収攻撃");
  }

  // 複合攻撃スキル — independent IFs, so several can stack.
  if (has("強攻撃") && proc(40)) {
    if (victimHas("光の装甲")) {
      emit(engine, "info", `但是【${victim.name}】《${victimBug.name}》用『光の装甲』只受到了通常的伤害！`);
    } else {
      emit(engine, "skill", "造成伤害1.3倍！");
      modifier *= 1.3; skillNames.push("強攻撃");
    }
  }
  if (has("要害攻撃") && proc(20)) {
    if (victimHas("光の装甲")) {
      emit(engine, "info", `但是【${victim.name}】《${victimBug.name}》用『光の装甲』只受到了通常的伤害！`);
    } else {
      emit(engine, "skill", "造成伤害2倍！！");
      modifier *= 2.0; skillNames.push("要害攻撃");
    }
  }
  if (has("致命攻撃") && proc(10)) {
    if (victimHas("光の装甲")) {
      emit(engine, "info", `但是【${victim.name}】《${victimBug.name}》用『光の装甲』只受到了通常的伤害！`);
    } else {
      emit(engine, "skill", "造成致命伤害！！");
      fixedDamage = victimBug.hp < Math.floor((victimBug.maxHp * 50) / 100) ? victimBug.hp : victimBug.hp - 1;
      skillNames.push("致命攻撃");
    }
  }
  if (has("红色极限黄金最大燃烧") && proc(30) && actorBug.hp < Math.floor(actorBug.maxHp / 3)) {
    emit(engine, "skill", "谜之能量溢出！造成3倍伤害！");
    modifier *= 3.0; skillNames.push("红色极限黄金最大燃烧");
  }
  if (has("激光攻撃") && proc(20)) {
    emit(engine, "skill", "本次攻撃无法避開！！");
    skillNames.push("激光攻撃");
  }

  if (attackSkill === "") emit(engine, "attack", `【${actor.name}】《${actorBug.name}》的『通常攻撃』！`);

  // 追加ダメージUP
  //
  // Upstream bug preserved: `MUSHI_ORDER:1 == ARG` compares a *stand* number
  // (`player * 10 + slot`, i.e. 11/21/31/41) with a *player* number (1..4).
  // `先手必勝` therefore never procs. `firstStandNum` keeps the comparison
  // honest so the dead branch stays observably dead.
  if (has("先手必勝") && engine.firstStandNum === actor.player) {
    emit(engine, "skill", `《${actorBug.name}》的『先手必勝』発動！依照速度提升伤害！`);
    modifier *= 1.2;
  }
  if (has("駆逐") && bugsRemaining(victim) === 1) {
    emit(engine, "skill", `《${actorBug.name}》的『駆逐』発動！`);
    modifier *= 1.5;
  }
  if (has("主宰") && actorBug.hp === actorBug.maxHp) {
    emit(engine, "skill", `《${actorBug.name}》的『主宰』発動！HP満时必定攻撃要害！！`);
    modifier *= 2.0;
  }
  if (has("水棲特効") && victimBug.tribe.includes("水棲")) { emit(engine, "skill", "对[水棲]的敌人造成高伤害！！"); modifier *= 2.0; }
  if (has("飛行特効") && victimBug.tribe.includes("飛行")) { emit(engine, "skill", "对[飛行]的敌人造成高伤害！！"); modifier *= 2.0; }
  if (has("軟体特効") && victimBug.tribe.includes("軟体")) { emit(engine, "skill", "对[軟体]的敌人造成高伤害！！"); modifier *= 2.0; }

  // 回避判定
  const uncounterable = skillNames.includes("激光攻撃") || has("怪诞攻撃");
  const evade = evasionRate(actorBug, victimBug, victim.status, uncounterable);
  if (eraRand(engine.rng, 100) < evade) {
    if (victimHas("高速回避")) emit(engine, "evade", `《${victimBug.name}》的『高速回避』発動！以俊敏的動作回避了攻撃！！`);
    else if (victimHas("極小")) emit(engine, "evade", `《${victimBug.name}》的『極小』発動！因为身体过小而没有被攻撃击中！！`);
    else emit(engine, "evade", `《${victimBug.name}》回避了攻撃！`);
    return;
  }

  // 防御時判定
  if (victim.status.includes("陽炎")) {
    emit(engine, "info", `【${victim.name}】《${victimBug.name}》只是幻影！`);
    victim.status = victim.status.filter((status) => status !== "陽炎");
    modifier = 0;
  } else if (victimHas("Counter") && proc(10)) {
    emit(engine, "info", `《${victimBug.name}》的『Counter』発動！！返还等量伤害！！`);
    const swapActor = actor;
    actor = victim;
    victim = swapActor;
  } else if (victimHas("僅防禦") && proc(30)) {
    emit(engine, "info", `《${victimBug.name}》的『僅防禦』発動！受到伤害减半！`);
    modifier *= 0.5;
  }
  if (victim.status.includes("緩慢")) {
    emit(engine, "info", `《${victimBug.name}》在<緩慢>状態下受到伤害增加！`);
    modifier *= 1.5;
  }

  if (!modifier) return;

  // 相性補正 (MULTIPLIES WITH the death code above — rarity bonus is omitted)
  const steps = typeAdvantageStep(actorBug.type, victimBug.type);
  for (let step = 0; step < steps; step++) modifier *= 1.5;
  if (steps > 0) emit(engine, "skill", "属性相性卓越！");

  // ダメージ決定
  const attackerBugNow = standOf(actor);
  const victimBugNow = standOf(victim);
  if (!attackerBugNow || !victimBugNow) return;
  let dealt = Math.floor((attackerBugNow.atk * modifier) / 100);
  dealt = Math.floor((dealt * (80 + eraRand(engine.rng, 40))) / 100);
  if (fixedDamage) dealt = fixedDamage;

  applyDamage(victimBugNow, dealt);
  emit(engine, "damage", `【${victim.name}】《${victimBugNow.name}》受到了 ${dealt} 的伤害！`);

  if (attackSkill === "吸収攻撃") {
    emit(engine, "skill", `【${actor.name}】《${attackerBugNow.name}》回復了 ${dealt}！`);
    attackerBugNow.hp = Math.min(attackerBugNow.hp + dealt, attackerBugNow.maxHp);
  }

  // [逆襲]
  if (
    victimBugNow.hp >= 1 &&
    victimBugNow.hp <= Math.floor(victimBugNow.maxHp / 2) &&
    victimBugNow.skl.includes("逆襲") &&
    !victim.status.includes("逆襲")
  ) {
    victim.status.push("逆襲");
    emit(engine, "skill", `《${victimBugNow.name}》的『逆襲』発動！受到攻撃后变为了<逆襲>状態！！`);
    refreshStats(victim);
  }

  const outcome: AttackOutcome = { dealt };

  if (victimBugNow.hp <= 0) {
    checkKo(engine, actor);
  } else if (attackSkill !== "" && victimBugNow.skl.includes("太古の力")) {
    emit(engine, "info", `《${victimBugNow.name}》的『太古の力』発動！！不受${attackSkill}効果的影响！`);
  } else if (attackSkill !== "") {
    const status = SKILL_STATUS[attackSkill];
    if (status && !victim.status.includes(status)) {
      victim.status.push(status);
      emit(engine, "skill", `《${victimBugNow.name}》陷入了<${status}>！`);
    }
    if (attackSkill === "诅咒攻撃") {
      const extra = Math.floor(victimBugNow.hp / 2) + 1;
      applyDamage(victimBugNow, extra);
      emit(engine, "damage", `【${victim.name}】《${victimBugNow.name}》因诅咒遭受了 ${extra} 的伤害！`);
    }
    refreshStats(victim);
  }

  // --- Post-damage rider skills (MUSHI_BATTLE.ERB:629-720) ------------------
  // All of these run after the main hit resolves, in this exact order.

  // [蝶効果] — halves *every* insect's HP, including the user's own team.
  if (has("蝴蝶效应") && proc(5)) {
    emit(engine, "skill", `《${attackerBugNow.name}》的『蝴蝶效应』発動！蝴蝶的翅膀扇动引起了竜卷风！！`);
    for (const other of engine.battlers) {
      const otherBug = standOf(other);
      if (!otherBug || otherBug.hp <= 1) continue;
      const halved = Math.floor(otherBug.hp / 2);
      applyDamage(otherBug, halved);
      emit(engine, "damage", `【${other.name}】《${otherBug.name}》受到了 ${halved} 的伤害！`);
    }
    checkKo(engine, actor);
    if (engine.winner !== 0) return;
  }

  // [噪音攻击] — only in a 3+ battler battle; every enemy except the target.
  if (has("噪音攻击") && engine.battlers.length > 2) {
    let announced = false;
    for (const other of engine.battlers) {
      const otherBug = standOf(other);
      if (!otherBug || otherBug.hp <= 0) continue;
      if (other.forfeited) continue;
      if (other === actor) continue;
      if (other === victim) continue;
      if (engine.setup.team && other.team === actor.team) continue;
      if (!announced) {
        emit(engine, "skill", `《${attackerBugNow.name}》的『噪音攻击』発動！对其他所有敵人造成伤害！`);
        announced = true;
      }
      applyDamage(otherBug, outcome.dealt);
      emit(engine, "damage", `【${other.name}】《${otherBug.name}》受到了 ${outcome.dealt} 的伤害！`);
    }
    if (announced) {
      checkKo(engine, actor);
      if (engine.winner !== 0) return;
    }
  }

  // [発光] — the target's glow confuses the attacker.
  if (victimBugNow.skl.includes("発光")) {
    emit(engine, "skill", `《${victimBugNow.name}》的『発光』発動！`);
    if (!actor.status.includes("混乱")) actor.status.push("混乱");
    emit(engine, "skill", `【${actor.name}】《${attackerBugNow.name}》<混乱>了！`);
  }

  // <混乱> — the attacker hurts itself for half the damage it dealt.
  if (actor.status.includes("混乱")) {
    emit(engine, "skill", `《${attackerBugNow.name}》在<混乱>中！`);
    const selfDamage = Math.floor(outcome.dealt / 2);
    applyDamage(attackerBugNow, selfDamage);
    emit(engine, "damage", `【${actor.name}】《${attackerBugNow.name}》受到了 ${selfDamage} 的伤害！`);
    checkKo(engine);
    if (engine.winner !== 0) return;
  }

  // [怪诞攻撃] — drains 精神 from everyone; hitting 0 forces a forfeit.
  if (has("怪诞攻撃")) {
    emit(engine, "attack", `【${actor.name}】《${attackerBugNow.name}》的『怪诞攻撃』発動！毛骨悚然的挙動对全員造成了精神伤害！！`);
    let someoneCracked = false;
    for (const other of engine.battlers) {
      if (other.mental <= 0 || other.forfeited) continue;
      other.mental = Math.max(other.mental - outcome.dealt, 0);
      if (other.mental === 0 && !other.forfeited) {
        emit(engine, "forfeit", `【${other.name}】无法忍耐眼前的惨状而弃权了！`);
        someoneCracked = true;
      }
    }
    if (someoneCracked) {
      checkDropout(engine);
      if (engine.winner !== 0) return;
    }
  }
}

/** Re-derive ATK/SPD after a status change (`MUSHI_PALAM` + `MUSHI_FLAGSETTING`). */
function refreshStats(battler: BattleBattler, power = 0): void {
  const bug = standOf(battler);
  if (!bug) return;
  const def = bugDefFor(bug.bugNum);
  if (!def) return;
  const stats = mushiPalam({
    def,
    rank: bug.rank,
    gType: bug.gType,
    xType: bug.xType,
    power,
    statuses: battler.status,
    battleHp: bug.hp,
  });
  bug.maxHp = stats.maxHp;
  bug.hp = stats.hp;
  bug.atk = stats.atk;
  bug.spd = stats.spd;
}

/** `MUSHI_BATTLE_CHECK_KO` (MUSHI_BATTLE.ERB:753-793). */
function checkKo(engine: Engine, attacker?: BattleBattler): void {
  for (const battler of engine.battlers) {
    const bug = standOf(battler);
    if (!bug || bug.hp < 0) continue;

    if (bug.hp === 0) {
      // 硬撑 — 15% to survive at 1 HP.
      let survive = false;
      if (bug.skl.includes("硬撑")) {
        let chance = 15;
        if (battler.status.includes("得意地形")) chance *= 1.5;
        if (bug.skl.includes("猛攻")) chance *= 1.5;
        if (bug.xType) chance *= 1.5;
        if (battler.status.includes("麻痹")) chance = 0;
        survive = skillRoll(chance, engine.rng);
      }
      if (survive) {
        bug.hp = 1;
        emit(engine, "info", `《${bug.name}》的『硬撑』発動！！`);
      } else {
        emit(engine, "ko", `【${battler.name}】《${bug.name}》倒下了！！`);
        // -1 (not 0) so the next sweep skips it, per upstream.
        bug.hp = -1;
        battler.bugs[battler.standIndex] = undefined;
        if (attacker && attacker !== battler && standOf(attacker)?.skl.includes("高揚") && !attacker.status.includes("高揚")) {
          attacker.status.push("高揚");
          emit(engine, "skill", `《${standOf(attacker)!.name}》的『高揚』発動！因敌人倒下而进入了<高揚>状態！！`);
          refreshStats(attacker);
        }
      }
    } else if (
      bug.hp <= Math.floor(bug.maxHp / 2) &&
      bug.skl.includes("逆襲") &&
      !battler.status.includes("逆襲")
    ) {
      battler.status.push("逆襲");
      emit(engine, "skill", `《${bug.name}》的『逆襲』発動！受到攻撃后变为了<逆襲>状態！！`);
      refreshStats(battler);
    }
  }
  checkDropout(engine);
}

/**
 * `MUSHI_BATTLE_CHECK_DO` (MUSHI_BATTLE.ERB:798-876).
 *
 * Forfeited battlers are assigned positions from the back. When the *first*
 * position slot is the one just filled, the battle is a tie: the survivor gets
 * a last-gasp stand and the battle resolves as a normal win.
 */
function checkDropout(engine: Engine): boolean {
  let lastFilled = 0;
  for (const battler of engine.battlers) {
    // `!MUSHI_REST:LPCOUNT` upstream — the battler is out once every insect slot
    // is spent (all REST bits cleared), or once their 精神 hits 0.
    const out = (bugsRemaining(battler) === 0 || battler.mental === 0) && battler.mental >= 0;
    if (!out) continue;
    emit(engine, "forfeit", `【${battler.name}】敗退！！`);
    battler.mental = -1;
    battler.forfeited = true;
    engine.eliminated.push(battler.player);
    for (let slot = 1; slot <= engine.battlers.length; slot++) {
      const from = engine.battlers.length + 1 - slot;
      if (!engine.finish[from]) {
        engine.finish[from] = battler.player;
        battler.placement = from;
        lastFilled = from;
        break;
      }
    }
  }
  if (engine.eliminated.length === 0) return false;

  // Upstream 引き分け: when the *first* finishing slot is the one just filled,
  // every battler dropped on the same check and the survivor gets a last-gasp
  // stand (`SETBIT MUSHI_REST:(MUSHI_FINISH:1), 3`). This port emits the same
  // line but does not resurrect an already-spent slot — the battler is already
  // flagged forfeited and its cage is empty, so there is nothing to field.
  if (lastFilled === 1) {
    const survivor = engine.battlers.find((b) => b.player === engine.finish[1]);
    const survivorBug = survivor ? standOf(survivor) : undefined;
    if (survivor && survivorBug) {
      emit(engine, "info", `什么、【${survivor.name}】《${survivorBug.name}》用最後的力量站了起来！！`);
      lastFilled = 2;
    }
  }

  // Nobody left standing: settle immediately instead of spinning to the round cap.
  if (engine.battlers.every((b) => b.forfeited || bugsRemaining(b) === 0)) {
    const survivor = engine.battlers.find((b) => !b.forfeited && bugsRemaining(b) > 0);
    engine.winner = survivor?.player ?? engine.battlers[0]?.player ?? 0;
    engine.finish[0] = engine.winner;
    emit(engine, "result", `（全员败退，判定 ${engine.winner !== 0 ? engine.winner : 0}）`);
    return true;
  }

  if (engine.setup.team) {
    const oddAlive = [0, 2, 4, 6].some((index) => {
      const battler = engine.battlers[index];
      return battler && !battler.forfeited && bugsRemaining(battler) > 0;
    });
    const evenAlive = [1, 3, 5, 7].some((index) => {
      const battler = engine.battlers[index];
      return battler && !battler.forfeited && bugsRemaining(battler) > 0;
    });
    if (!oddAlive || !evenAlive) {
      engine.finish = engine.finish.map(() => 0);
      const winners = oddAlive
        ? [0, 2, 4, 6]
        : [1, 3, 5, 7];
      winners.forEach((index, position) => {
        const battler = engine.battlers[index];
        if (battler) {
          engine.finish[position + 1] = battler.player;
          emit(engine, "result", `☆☆☆勝者　团队【${battler.name}】☆☆☆`);
        }
      });
      engine.winner = engine.finish[1] ?? 0;
      return true;
    }
    return false;
  }

  // 个人戦
  if (lastFilled === 2) {
    const champion = engine.battlers.find((b) => !b.forfeited && bugsRemaining(b) > 0);
    if (champion) {
      engine.finish[0] = champion.player;
      engine.winner = champion.player;
      emit(engine, "result", `☆☆☆勝者　【${champion.name}】☆☆☆`);
      return true;
    }
  }
  return false;
}

/** `MUSHI_BATTLE_ENDSTEP` (MUSHI_BATTLE.ERB:881-1006). */
function endStep(engine: Engine): boolean {
  // [流砂] — only when the field is *exactly* quicksand (upstream string compare).
  const quicksandOnly = nameFieldType(engine.field) === "[砂地]";
  if (quicksandOnly) {
    for (const battler of engine.battlers) {
      const bug = standOf(battler);
      if (!bug || !bug.skl.includes("流砂")) continue;
      let announced = false;
      for (const other of engine.battlers) {
        const otherBug = standOf(other);
        if (!otherBug || otherBug.hp <= 0) continue;
        if (other === battler) continue;
        if (engine.setup.team && other.team === battler.team) continue;
        if (!announced) {
          emit(engine, "skill", `《${bug.name}》的『流砂』発動！将全部敵人拖入了流砂！`);
          announced = true;
        }
        const damage = Math.floor(otherBug.maxHp / 4);
        applyDamage(otherBug, damage);
        emit(engine, "damage", `【${other.name}】《${otherBug.name}》受到了 ${damage} 的伤害！`);
      }
      if (announced) {
        checkKo(engine, battler);
        if (engine.winner !== 0) return true;
      }
    }
  }

  // 毒ダメージ処理,猛毒優先
  for (const battler of engine.battlers) {
    let damaged = false;
    const bug = standOf(battler);
    if (bug && bug.hp > 0 && battler.status.includes("猛毒")) {
      const damage = Math.floor(bug.maxHp / 2);
      applyDamage(bug, damage);
      emit(engine, "damage", `【${battler.name}】《${bug.name}》受到了猛毒的 ${damage} 伤害！`);
      damaged = true;
    } else if (bug && bug.hp > 0 && battler.status.includes("毒")) {
      const damage = Math.floor(bug.maxHp / 4);
      applyDamage(bug, damage);
      emit(engine, "damage", `【${battler.name}】《${bug.name}》受到了毒的 ${damage} 伤害！`);
      damaged = true;
    }
    if (damaged) {
      checkKo(engine, battler);
      if (engine.winner !== 0) return true;
    }
  }

  // 睡眠が起きる処理 — 50% wake-up.
  for (const battler of engine.battlers) {
    if (battler.status.includes("睡眠") && !eraRand(engine.rng, 2)) {
      const bug = standOf(battler);
      if (bug && bug.hp > 0) {
        battler.status = battler.status.filter((status) => status !== "睡眠");
        emit(engine, "info", `【${battler.name}】《${bug.name}》从睡眠中醒来了！`);
      }
    }
  }

  // 再生処理
  for (const battler of engine.battlers) {
    const bug = standOf(battler);
    if (bug && bug.skl.includes("再生") && bug.hp >= 1 && bug.hp <= bug.maxHp - 1) {
      const heal = Math.floor(bug.maxHp / 4);
      bug.hp = Math.min(bug.hp + heal, bug.maxHp);
      emit(engine, "skill", `《${bug.name}》的『再生』発動！回復了 ${heal}！`);
    }
  }

  // 入れ替え
  for (const battler of engine.battlers) {
    if (battler.forfeited) continue;
    if (bugsRemaining(battler) === 0) {
      checkDropout(engine);
      if (engine.winner !== 0) return true;
      continue;
    }
    const stand = standOf(battler);
    if (stand && stand.hp <= 0) {
      const choose = engine.setup.chooseSwap;
      let next: BattleBug | undefined;
      if (choose) {
        next = choose(battler);
      } else {
        // 角色は上から順に出していく (MUSHI_BATTLE.ERB:994-999)
        next = battler.bugs.find((candidate) => candidate !== undefined);
      }
      const index = next ? battler.bugs.indexOf(next) : -1;
      if (index >= 0) enterField(engine, battler, index);
      else {
        checkDropout(engine);
        if (engine.winner !== 0) return true;
      }
    }
  }
  return false;
}

/**
 * Run a battle to completion.
 *
 * Round 0 only prints the opening (upstream `MUSHI_BATTLE.ERB:16-22, 54-66`);
 * combat starts on round 1. Turn order is a descending selection sort on the
 * standing insect's SPD, matching the upstream loop.
 */
export function runBugBattle(setup: BattleSetup, rng: () => number): BattleResult {
  const engine: Engine = {
    setup,
    battlers: setup.battlers,
    field: setup.field,
    round: 0,
    lines: [],
    rounds: [],
    finish: new Array(setup.battlers.length + 1).fill(0),
    winner: 0,
    eliminated: [],
    rng,
    order: [],
    firstStandNum: 0,
  };

  // 全員のETB処理
  for (const battler of setup.battlers) {
    const first = battler.bugs.findIndex((bug) => bug !== undefined);
    if (first < 0) continue;
    enterField(engine, battler, first);
    emit(engine, "info", `【${battler.name}】派《${standOf(battler)!.name}》を进入了戦場！`);
  }

  const maxRounds = setup.maxRounds ?? 500;
  let decided = false;
  const snapshots: BattleSnapshot[][] = [snapshotOf(setup.battlers)];

  while (!decided && engine.round < maxRounds) {
    if (engine.round === 0) {
      emit(engine, "info", `◆回合一 ＜场地类型：${nameFieldType(engine.field)}＞`);
    } else {
      emit(engine, "info", `◆回合 ${engine.round} ＜场地类型：${nameFieldType(engine.field)}＞`);
    }

    // 行動順判定 — highest SPD first, each taken once.
    engine.order = [];
    const taken = new Set<number>();
    for (let pick = 0; pick < setup.battlers.length; pick++) {
      let best: BattleBattler | undefined;
      let bestSpd = 0;
      for (const battler of setup.battlers) {
        if (taken.has(battler.player)) continue;
        const bug = standOf(battler);
        if (bug && bug.spd > bestSpd) {
          bestSpd = bug.spd;
          best = battler;
        }
      }
      if (!best) break;
      taken.add(best.player);
      engine.order.push(best.player);
    }

    const lead = setup.battlers.find((b) => engine.order[0] === b.player);
    const leadBug = lead ? standOf(lead) : undefined;
    engine.firstStandNum = lead && leadBug ? lead.player * 10 + leadBug.slot : 0;

    if (engine.round > 0) {
      for (const player of engine.order) {
        if (decided) break;
        const battler = setup.battlers.find((b) => b.player === player);
        if (!battler) continue;
        const target = selectTarget(engine, battler);
        if (!target) {
          emit(engine, "info", `【${battler.name}】《${standOf(battler)?.name ?? ""}》的攻撃索敌没有成功…`);
          continue;
        }
        combat(engine, battler, target);
        if (engine.winner !== 0) { decided = true; break; }
      }
      if (!decided) decided = endStep(engine);
    }

    engine.rounds.push(engine.lines);
    engine.lines = [];
    snapshots.push(snapshotOf(setup.battlers));
    engine.round++;
  }

  if (!decided && engine.winner === 0) {
    // Round cap reached without a resolution — fall back to "still holding wins"
    // so a caller never gets an unresolved battle.
    const survivor = setup.battlers.find((b) => !b.forfeited);
    if (survivor) {
      engine.winner = survivor.player;
      engine.finish[0] = survivor.player;
      emit(engine, "result", `（回合上限 ${maxRounds}，判定未结算）`);
    }
  }
  engine.rounds.push(engine.lines);
  // The trailing result banner is its own round, so it needs its own snapshot.
  snapshots.push(snapshotOf(setup.battlers));

  return {
    rounds: engine.rounds,
    snapshots,
    finish: engine.finish,
    winner: engine.winner,
    eliminated: engine.eliminated,
  };
}

/** Deep-enough copy of each battler for a presentation replay. */
function snapshotOf(battlers: readonly BattleBattler[]): BattleSnapshot[] {
  return battlers.map((battler) => {
    const bug = standOf(battler);
    return {
      player: battler.player,
      name: battler.name,
      bugNum: bug ? bug.bugNum : null,
      bugName: bug ? bug.name : null,
      hp: bug ? bug.hp : 0,
      maxHp: bug ? bug.maxHp : 0,
      atk: bug ? bug.atk : 0,
      spd: bug ? bug.spd : 0,
      rank: bug ? bug.rank : 0,
      gType: bug ? bug.gType : false,
      xType: bug ? bug.xType : false,
      type: bug ? bug.type : "",
      statuses: [...battler.status],
      remaining: bugsRemaining(battler),
      forfeited: battler.forfeited,
    };
  });
}

/** Human-readable one-line summary of a standing insect, for prompts and logs. */
export function describeBug(bug: BattleBug): string {
  const tags = [`HP ${bug.hp}/${bug.maxHp}`, `ATK ${bug.atk}`, `SPD ${bug.spd}`];
  if (bug.type) tags.push(bug.type);
  if (bug.rank) tags.push(`R${bug.rank}`);
  if (bug.gType) tags.push("Ｇ型");
  if (bug.xType) tags.push("Ｘ型");
  return `《${bug.name}》 ${tags.join(" / ")}`;
}
