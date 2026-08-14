/**
 * Phase 4.5I — named-stat accessor (the "real variables" bridge).
 *
 * The UI layer (`web/app/**`) may NOT spell the legacy namespace tokens
 * (CFLAG/TALENT/EXP/PALAM/BASE/… — forbidden-names guard). But it still
 * needs to display REAL `GameState` values (体力/気力/…). This module —
 * which lives in `modernization/runtime`, where the tokens ARE allowed —
 * is the adapter: the UI asks for a value by its display name, and this
 * file does the namespace+id lookup.
 *
 * **Updated 5B**: the name→id mapping now matches
 * `eratw-sub-modding-main/CSV/BASE.csv` directly (体力=0, 気力=1,
 * 精力=6, TSP=8). The previous prototype values were wrong: TSP was
 * pinned to id 2 (which collided with `射精`), and 精力 was pinned
 * to id 3 (uninit). Phase 7's importer will replace this hand-pinned
 * map with a CSV-derived one; for now we keep it accurate by hand
 * because the UI's status bar and Phase 5+ settlement both read
 * through it.
 */

import { emptyCharaSlotState, type CharaSlotState, type GameState } from "./game-state.js";
import { ABL_ID, BASE_ID, CFLAG_ID, FLAG_ID, MARK_ID, PALAM_ID, TCVAR_ID } from "./settlement.js";
import { charaCstrOf } from "./chara-data.js";
import { weekdayName } from "../world/calendar.js";
import { JOB_LABEL, WORK_MANIFEST, resolveWorkEntry, type WorkEntry } from "../world/work/work-manifest.js";

export interface NamedStat {
  value: number;
  max: number;
}

interface StatSlot {
  ns: keyof CharaSlotState;
  id: number;
  max: number;
}

/** Display name → where its value lives + its FALLBACK max. The fallback is
 *  only used when the chara's real `MAXBASE` cap is unset (test fixtures /
 *  un-seeded slots); the live data path reads the real per-chara MAXBASE.
 *  Pinned to `CSV/BASE.csv` ids (体力=0, 気力=1, 精力=6, TSP=8). */
const STAT_MAP: Readonly<Record<string, StatSlot>> = {
  体力: { ns: "BASE", id: 0, max: 2000 },
  気力: { ns: "BASE", id: 1, max: 2000 },
  // Parity QA F-1d-1 — 酒気 (BASE:15), shown between 気力 and 精力 per eraTW's
  // status line `体(N)气(N)酒(N)精(N)`. Max from MAXBASE:酒気 (eraTW caps via
  // @DRUNKEN); fallback 1000 (the eraTW seed ceiling) when unset.
  酒: { ns: "BASE", id: 15, max: 1000 },
  TSP: { ns: "BASE", id: 8, max: 100 },
  精力: { ns: "BASE", id: 6, max: 100 },
};

/** The named stats shown in the status bar, in display order. */
export const NAMED_STAT_KEYS = ["体力", "気力", "酒", "TSP", "精力"] as const;

/**
 * Read a named stat's current value + max from a CharaSlotState.
 *
 * `max` comes from the chara's REAL `MAXBASE` cap (eraTW seeds it from the
 * Chara CSV 基礎 values — 霊夢 体力 2000/2000). Falls back to STAT_MAP's
 * pinned ceiling only when MAXBASE is unset (≤0) so a status bar never
 * divides by a wrong constant 100 (the old bug: NPC 体力 2000 rendered
 * against max 100 → the bar overflowed; the master's seeded 72 looked
 * absurdly small next to it). `value` is clamped at 0 for display so a
 * stat driven negative by a DOWNBASE never shows a negative bar.
 */
export function getNamedStat(state: CharaSlotState, name: string): NamedStat {
  const slot = STAT_MAP[name];
  if (!slot) return { value: 0, max: 0 };
  const raw = state[slot.ns][slot.id] ?? 0;
  const realMax = state.MAXBASE[slot.id] ?? 0;
  const max = realMax > 0 ? realMax : slot.max;
  return { value: Math.max(0, raw), max };
}

/**
 * Parity QA P-31 — namespace-free relational/affinity stats for the status
 * panel (the UI may not spell CFLAG/BASE). These are the per-NPC values eraTW
 * shows on the status line for the focused target:
 *   好感度 = CFLAG:2, 信頼度 = CFLAG:4, 情緒 = BASE:10, 理性 = BASE:11.
 * 情緒/理性 carry a real MAXBASE cap (used for the ★ display); 好感度/信頼度
 * are open-ended counters (no cap).
 */
const RELATION_MAP: Readonly<Record<string, { ns: keyof CharaSlotState; id: number; capId?: number }>> = {
  好感度: { ns: "CFLAG", id: 2 },
  信頼度: { ns: "CFLAG", id: 4 },
  情緒: { ns: "BASE", id: 10, capId: 10 },
  理性: { ns: "BASE", id: 11, capId: 11 },
  憤怒: { ns: "BASE", id: 12, capId: 12 },
};

export const RELATION_STAT_KEYS = ["好感度", "信頼度", "情緒", "理性", "憤怒"] as const;

/**
 * Parity QA P-31 + kuchiku-mark-rescue (2026-07-09) — namespace-free
 * rebellion-brand accessor (`MARK:反発刻印` = `MARK[3]`). The runtime writes
 * it from `source-check.ts::settleSourcePalam::markGotCheckHankan`
 * (lines 340-423) on 反感/不快 CUP thresholds, and the dialogue router
 * selects anger / refusal kojo branches on it (after the `RAW_VAR_REF_RE`
 * regex now accepts `MARK`). This helper exists so the **UI may surface
 * the tier without spelling the legacy `MARK` token** (forbidden-names
 * guard).
 *
 * @returns `{tier, max}` where tier is clamped to 0..3 (max) per the
 *   upstream `markGotCheckHankan` clamp.
 */
export function getRebellionBrand(slot: CharaSlotState): { tier: number; max: number } {
  const raw = (slot.MARK ?? {})[MARK_ID.反発刻印] ?? 0;
  const tier = Number.isFinite(raw) ? Math.trunc(raw) : 0;
  return { tier: Math.max(0, Math.min(3, tier)), max: 3 };
}

/** Seed the rebellion brand (0..3). Mutates + returns the slot. */
export function seedRebellionBrand(slot: CharaSlotState, tier: number): CharaSlotState {
  slot.MARK ??= {} as CharaSlotState["MARK"];
  slot.MARK[MARK_ID.反発刻印] = Math.max(0, Math.min(3, Math.trunc(tier)));
  return slot;
}

/**
 * 今日の運勢 — `CFLAG:今日の運勢` (id 378), a 0-999 daily-luck score. eraTW
 * shows it on the status line as `<今日运势：N>` per INFO.ERB. The data layer
 * is NOT yet wired (no writer seeds/updates it — see settlement.ts:165
 * "Consumer not yet ported"), so this reads 0 until that lands. The UI shows
 * a placeholder when the value is 0 AND it was never seeded, but we cannot
 * distinguish "0 fortune" from "unseeded" from the value alone — so callers
 * should treat 0 as "unseeded" for display (a real fortune is always ≥1).
 *
 * Namespace-free (UI may not spell CFLAG) — same posture as getRelationStat.
 */
export function getFortune(state: CharaSlotState): number {
  return Math.max(0, state.CFLAG[CFLAG_ID.今日の運勢] ?? 0);
}

/**
 * Parity QA F-1d-2 — PALAM accumulators shown on the status line. The initial
 * bridge only exposed the five "state" gauges; the main HUD needs the same
 * broad readout as INFO.ERB: 快感 0-4, state 9-16, favor 20-21, bad-state
 * 30-33. Namespace-free for the UI layer.
 */
const PALAM_DISPLAY_MAP: Readonly<Record<string, number>> = {
  快C: PALAM_ID.快Ｃ,
  快V: PALAM_ID.快Ｖ,
  快A: PALAM_ID.快Ａ,
  快B: PALAM_ID.快Ｂ,
  快M: PALAM_ID.快Ｍ,
  润滑: PALAM_ID.潤滑, // 9
  恭顺: PALAM_ID.恭順, // 10
  情欲: PALAM_ID.欲情, // 11
  屈服: PALAM_ID.屈服, // 12
  习得: PALAM_ID.習得, // 13
  羞耻: PALAM_ID.恥情, // 14
  苦痛: PALAM_ID.苦痛, // 15
  恐怖: PALAM_ID.恐怖, // 16
  好意: PALAM_ID.好意, // 20
  优越: PALAM_ID.優越, // 21
  反感: PALAM_ID.反感, // 30
  不快: PALAM_ID.不快, // 31
  抑郁: PALAM_ID.抑鬱, // 32
  眠奸: PALAM_ID.眠姦, // 33
};

/** The PALAM display keys shown in the status row, in eraTW's order. */
export const PALAM_STAT_KEYS = [
  "快C",
  "快V",
  "快A",
  "快B",
  "快M",
  "润滑",
  "恭顺",
  "情欲",
  "屈服",
  "习得",
  "羞耻",
  "苦痛",
  "恐怖",
  "好意",
  "优越",
  "反感",
  "不快",
  "抑郁",
  "眠奸",
] as const;

/** Read a PALAM accumulator by display name. Missing → 0. Namespace-free. */
export function getPalamStat(state: CharaSlotState, name: string): number {
  const id = PALAM_DISPLAY_MAP[name];
  if (id === undefined) return 0;
  return Math.max(0, state.PALAM[id] ?? 0);
}

/**
 * Parity QA — ABL (能力) parameters for the status panel's "Param" section.
 * eraTW's 能力 display lists ~20 ability gauges, each a small level bar. The
 * ids/labels mirror `CSV/Abl.csv` (感覚 0-4, 基本 9-18, 技能 40-45); 中毒/性技
 * are deferred (H-subsystem, kept off the everyday Param view). Namespace-free:
 * the UI maps over these groups and reads each via `getAblStat`.
 */
export interface AblParam {
  label: string;
  id: number;
}
export interface AblParamGroup {
  group: string;
  items: ReadonlyArray<AblParam>;
}
export const ABL_PARAM_GROUPS: ReadonlyArray<AblParamGroup> = [
  {
    group: "感覚",
    items: [
      { label: "Ｃ感覚", id: 0 },
      { label: "Ｖ感覚", id: 1 },
      { label: "Ａ感覚", id: 2 },
      { label: "Ｂ感覚", id: 3 },
      { label: "Ｍ感覚", id: 4 },
    ],
  },
  {
    group: "基本",
    items: [
      { label: "親密", id: 9 },
      { label: "従順", id: 10 },
      { label: "欲望", id: 11 },
      { label: "技巧", id: 12 },
      { label: "奉仕精神", id: 13 },
      { label: "露出癖", id: 14 },
      { label: "受虐属性", id: 15 },
      { label: "施虐属性", id: 16 },
      { label: "百合属性", id: 17 },
      { label: "断袖属性", id: 18 },
    ],
  },
  {
    group: "技能",
    items: [
      { label: "清掃技能", id: 40 },
      { label: "話術技能", id: 41 },
      { label: "戦闘能力", id: 42 },
      { label: "教養", id: 43 },
      { label: "料理技能", id: 44 },
      { label: "音楽技能", id: 45 },
    ],
  },
];

/** eraTW ABL gauges are levels (0..5 for the everyday abilities); the bar fills
 *  level/ABL_DISPLAY_MAX. */
export const ABL_DISPLAY_MAX = 5;

/** Read an ABL ability level by its Abl.csv id. Missing → 0. Namespace-free. */
export function getAblStat(state: CharaSlotState, id: number): number {
  return Math.max(0, state.ABL[id] ?? 0);
}

/** Read the relationship frustration gauge without exposing its storage. */
export function getFrustrationStat(state: CharaSlotState): number {
  return Math.max(0, state.TCVAR[TCVAR_ID.欲求不満度管理] ?? 0);
}

const WORKING_ACTION = 5;

export interface HudWorkInfo {
  kind: string;
  day: string;
  hours: string;
  place: string;
  active: boolean;
}

export interface HudActionHints {
  canEatMeal: boolean;
  canEatDessert: boolean;
  timeStop: "active" | "available" | "unavailable";
  hypnosisAvailable: boolean;
  wakeAid: number;
}

function formatClock(min: number): string {
  const h = Math.trunc(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}时` : `${h}时${String(m).padStart(2, "0")}分`;
}

function roomLabel(location: string | null): string {
  if (!location) return "—";
  const i = location.indexOf(":");
  return i >= 0 ? location.slice(i + 1) : location;
}

function condDayLabel(state: GameState, entry: WorkEntry): string {
  const matches: number[] = [];
  for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
    const probe = { ...state, time: { ...state.time, dayIndex } };
    if (entry.cond({ state: probe, dayIndex })) matches.push(dayIndex);
  }
  const weekdays = [0, 1, 2, 3, 4];
  if (matches.length === 7) return "毎日";
  if (weekdays.every((d) => matches.includes(d)) && matches.length === weekdays.length) {
    return "平日";
  }
  if (matches.length > 0 && matches.length <= 3) return matches.map(weekdayName).join("/");
  return "今日";
}

function cstrHudWorkInfo(state: GameState, charaNum: number): HudWorkInfo | null {
  const kind = charaCstrOf(charaNum, "工作情報").trim();
  const place = (charaCstrOf(charaNum, "職場") || charaCstrOf(charaNum, "2")).trim();
  if (!kind && !place) return null;
  const slot = state.charas[charaNum];
  const active = (slot?.state.CFLAG[CFLAG_ID.行动] ?? 0) === WORKING_ACTION;
  return {
    kind,
    day: "",
    hours: "",
    place: place || "—",
    active,
  };
}

/** Main-HUD work line for the focused target: today's matching work arm, if any. */
export function getHudWorkInfo(state: GameState, charaNum: number): HudWorkInfo | null {
  const tickMin = ((state.time.tickValue % 1440) + 1440) % 1440;
  const today = state.time.dayIndex;
  const ctx = { state, dayIndex: today };
  const entries = WORK_MANIFEST.flatMap((entry) => {
    if (entry.charaNum !== charaNum) return [];
    if (!entry.cond(ctx)) return [];
    const resolved = resolveWorkEntry(entry, ctx);
    return resolved ? [resolved] : [];
  });
  if (entries.length === 0) return cstrHudWorkInfo(state, charaNum);
  const entry =
    entries.find((e) => tickMin >= e.startMin && tickMin < e.endMin) ?? entries[0]!;
  const slot = state.charas[charaNum];
  const active = (slot?.state.CFLAG[CFLAG_ID.行动] ?? 0) === WORKING_ACTION;
  return {
    kind: JOB_LABEL[entry.jobType] ?? "仕事",
    day: condDayLabel(state, entry),
    hours: `${formatClock(entry.startMin)}~${formatClock(entry.endMin)}`,
    place: roomLabel(entry.location),
    active,
  };
}

/** Battle ability in the compact `C 2` style used by the main HUD. */
export function getBattleAbilityDisplay(state: CharaSlotState): string {
  const level = getAblStat(state, ABL_ID.战斗能力);
  const ranks = ["E", "D", "C", "B", "A", "S"];
  const rank = ranks[Math.max(0, Math.min(ranks.length - 1, level))] ?? "E";
  return `${rank} ${level}`;
}

/** Current main-HUD action hints sourced from existing clocks/flags. */
export function getHudActionHints(state: GameState): HudActionHints {
  const master = state.master.state;
  const canEatMeal = state.time.tickValue >= (master.TCVAR[TCVAR_ID.空腹時刻] ?? 0);
  const canEatDessert = state.time.tickValue >= (master.TCVAR[TCVAR_ID.甜点空腹時刻] ?? 0);
  const timeStopActive = (state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0;
  const timeStopAvailable =
    !timeStopActive &&
    (master.BASE[BASE_ID.TSP] ?? 0) > 0 &&
    (master.BASE[BASE_ID.気力] ?? 0) > 0 &&
    (master.CFLAG[CFLAG_ID.诶嘿嘿] ?? 0) === 0 &&
    (master.CFLAG[CFLAG_ID.恶作剧] ?? 0) === 0 &&
    (master.CFLAG[CFLAG_ID.陪睡中] ?? 0) === 0;
  return {
    canEatMeal,
    canEatDessert,
    timeStop: timeStopActive ? "active" : timeStopAvailable ? "available" : "unavailable",
    hypnosisAvailable: (state.flagStore[FLAG_ID.催眠強度] ?? 0) > 0,
    wakeAid: Math.max(0, master.CFLAG[CFLAG_ID.清醒劑] ?? 0),
  };
}

/**
 * Read a relational stat (value + optional max) for the focused target.
 * `max` is the chara's real MAXBASE cap when the stat is capped (情緒/理性),
 * else 0 (open-ended counters 好感度/信頼度). Value clamped ≥ 0 for display.
 */
export function getRelationStat(state: CharaSlotState, name: string): NamedStat {
  const slot = RELATION_MAP[name];
  if (!slot) return { value: 0, max: 0 };
  const raw = state[slot.ns][slot.id] ?? 0;
  const max = slot.capId !== undefined ? (state.MAXBASE[slot.capId] ?? 0) : 0;
  return { value: Math.max(0, raw), max };
}

/**
 * Namespace-free seeder for relational stats (好感度/信頼度/情緒/理性) + their
 * MAXBASE caps for 情緒/理性. Lets the UI layer + tests set them without
 * spelling CFLAG/BASE (forbidden-names guard). `caps` seeds MAXBASE for the
 * capped stats (情緒/理性). Mutates + returns.
 */
export function seedRelationStats(
  state: CharaSlotState,
  values: Readonly<Record<string, number>>,
  caps: Readonly<Record<string, number>> = {},
): CharaSlotState {
  for (const [name, value] of Object.entries(values)) {
    const slot = RELATION_MAP[name];
    if (slot) state[slot.ns][slot.id] = value;
  }
  for (const [name, cap] of Object.entries(caps)) {
    const slot = RELATION_MAP[name];
    if (slot?.capId !== undefined) state.MAXBASE[slot.capId] = cap;
  }
  return state;
}

/** Seed the master's 亲热 (intimacy, TCVAR id 130) — the value many
 *  `@COM_ABLE` gates require (`SIF TCVAR:MASTER:亲热 < n → RETURN 0`). Exposed
 *  as a namespace-free helper so the UI layer + tests can set it without
 *  spelling the `TCVAR` token (forbidden-names guard). Mutates + returns. */
export function seedIntimacy(state: CharaSlotState, value: number): CharaSlotState {
  state.TCVAR[130] = value;
  return state;
}

/** Write named-stat seeds into a CharaSlotState (mutates + returns it). */
export function seedNamedStats(
  state: CharaSlotState,
  seeds: Readonly<Record<string, number>>,
): CharaSlotState {
  for (const [name, value] of Object.entries(seeds)) {
    const slot = STAT_MAP[name];
    if (slot) state[slot.ns][slot.id] = value;
  }
  return state;
}

/**
 * Write named-stat MAXBASE caps into a CharaSlotState (mutates + returns).
 * Namespace-free sibling of `seedNamedStats` so the UI layer / tests can
 * give a chara a realistic stat ceiling (eraTW seeds MAXBASE from the
 * Chara CSV 基礎 values) without spelling the `MAXBASE` token directly
 * (forbidden-names guard).
 */
export function seedNamedStatMaxes(
  state: CharaSlotState,
  maxes: Readonly<Record<string, number>>,
): CharaSlotState {
  for (const [name, value] of Object.entries(maxes)) {
    const slot = STAT_MAP[name];
    if (slot) state.MAXBASE[slot.id] = value;
  }
  return state;
}

/**
 * Build the MASTER's initial CharaSlotState, seeded to the REAL upstream
 * new-game values (`NEWGAME_MAKE.ERB:22-28`): the player starts at full
 * 体力/気力 (2000/2000), TSP 100/100, and 精力 0/0 (精力 grows via 精力強化,
 * not seeded at new-game). The previous prototype mock (72/88/34/55 against
 * a flat max 100) is gone — it made the master look starved next to NPCs
 * whose real 体力 is 2000. Each stat's MAXBASE cap is set so `recoverPermil`
 * (rest/nap) and the status bar both read the right ceiling.
 */
const MASTER_NEWGAME_STATS: Readonly<Record<string, { base: number; max: number }>> = {
  体力: { base: 2000, max: 2000 },
  気力: { base: 2000, max: 2000 },
  酒: { base: 0, max: 1000 }, // 酒気 starts sober; fills via drinking (COMF332 etc.)
  TSP: { base: 100, max: 100 },
  精力: { base: 0, max: 0 }, // grows via 精力強化; new-game default is 0/0
};

export function buildSeededMasterState(): CharaSlotState {
  const state = emptyCharaSlotState();
  for (const name of NAMED_STAT_KEYS) {
    const slot = STAT_MAP[name]!;
    const seed = MASTER_NEWGAME_STATS[name]!;
    state.BASE[slot.id] = seed.base;
    // Only set a positive MAXBASE cap; 精力 0/0 leaves MAXBASE unset so
    // getNamedStat's fallback (100) gives the empty bar a sane scale.
    if (seed.max > 0) state.MAXBASE[slot.id] = seed.max;
  }
  return state;
}
