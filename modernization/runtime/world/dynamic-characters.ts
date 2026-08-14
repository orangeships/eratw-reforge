import {
  emptyCharaSlotState,
  type CharaSlot,
  type DynamicCharacterMeta,
  type DynamicCharacterPortrait,
  type GameState,
} from "../state/game-state.js";
import { createRng } from "../command/rng.js";
import { ABL_ID, BASE_ID, CFLAG_ID, TALENT_ID } from "../state/settlement.js";
import { mapKeyOf } from "./location-predicates.js";
import { isTimeStopped } from "../command/h-mode.js";
import { generateMobPortrait } from "./dynamic-portraits.js";

export const MAX_REMEMBERED_MOB_GIRLS = 20;
export const FIRST_DYNAMIC_CHARA_NUM = 10_000;
export const STONE_CONTEST_CLERK_ROLE = "stone-contest-clerk";
export const STONE_CONTEST_CLERK_HOME = "彼岸:賽の河原";
export const RINNOSUKE_ROLE = "kourindou-shopkeeper";
export const RINNOSUKE_HOME = "魔法之森:香霖堂";
export const ARCHIVED_DYNAMIC_LOCATION = "隙間:路人档案";

interface AuthoredResidentDefinition {
  readonly role: string;
  readonly callName: string;
  readonly homeLocation: string;
  readonly seed: number;
  readonly species?: string;
  readonly initializeState: (slot: CharaSlot) => void;
}

const GIVEN_NAMES = [
  "小春", "千代", "铃", "澪", "茜", "椿", "萤", "杏", "菫", "枫",
  "露", "葵", "柚", "纺", "凛", "伊吹", "弥生", "琴", "叶", "桃",
] as const;

const REGION_SPECIES: Readonly<Record<string, readonly string[]>> = {
  人間之里: ["村姑", "人妻"],
  霧之湖: ["妖精"],
  紅魔館: ["女仆妖精"],
  迷途竹林: ["因幡", "售货员"],
  冥界: ["妖怪狐", "妖怪猫"],
  妖怪之山山麓: ["山童", "河童"],
  妖怪之山山頂: ["白狼天狗", "鸦天狗"],
  地底: ["鬼", "僵尸妖精"],
  月都: ["玉兔"],
  命蓮寺: ["妖怪狸"],
  神霊廟: ["妖怪狸"],
};

function seedFor(state: Readonly<GameState>, candidateIndex: number): number {
  let hash = Math.imul(state.time.tickValue + 1, 1_000_003) ^ Math.imul(candidateIndex + 1, 97_409);
  for (const char of state.master.location) hash = Math.imul(hash ^ char.charCodeAt(0), 16_777_619);
  return hash >>> 0;
}

export function mobGirlSpeciesForLocation(location: string): readonly string[] {
  return REGION_SPECIES[mapKeyOf(location)] ?? [];
}

export function canSearchMobGirls(state: Readonly<GameState>): boolean {
  const minute = ((state.time.tickValue % 1440) + 1440) % 1440;
  if (minute < 540 || minute > 1140) return false;
  if (mobGirlSpeciesForLocation(state.master.location).length === 0) return false;
  return !Object.entries(state.dynamicCharacters ?? {}).some(([id, meta]) =>
    meta.origin === "generated" && meta.active && state.charas[Number(id)] !== undefined,
  );
}

function applySpeciesTalents(slot: CharaSlot, species: string): void {
  if (species.includes("妖精")) slot.state.TALENT[TALENT_ID.妖精] = 1;
  if (species === "村姑" || species === "人妻") slot.state.TALENT[TALENT_ID.人类] = 1;
  if (species === "人妻") slot.state.TALENT[TALENT_ID.人妻] = 1;
  if (species === "泡姫") slot.state.TALENT[TALENT_ID.風俗嬢] = 1;
}

export interface GeneratedMobGirl {
  slot: CharaSlot;
  meta: Extract<DynamicCharacterMeta, { origin: "generated" }>;
}

export interface MobGirlCandidateProfile {
  readonly charaNum: number;
  readonly seed: number;
  readonly callName: string;
  readonly species: string;
  readonly region: string;
  readonly location: string;
  readonly encounterType: "同行可带出" | "临时接触";
  readonly stamina: { readonly value: number; readonly max: number };
  readonly will: { readonly value: number; readonly max: number };
  readonly favor: number;
  readonly trust: number;
  /** Upstream `TALENT:処女` projection used by COM444's CHARA_STATE view. */
  readonly firstTimeStatus?: "处女" | "再生处女" | "无自觉非处女" | "非处女";
  /** Compact replacement for the upstream CSTR:処女喪失履歴 line. */
  readonly firstTimeHistory?: string;
  readonly abilities: readonly {
    readonly key: "亲密" | "従順" | "欲望" | "技巧" | "奉仕精神" | "战斗能力";
    readonly value: number;
  }[];
  readonly encounterSummary: string;
  /** The stable upstream-style layer recipe for this generated individual. */
  readonly portrait?: DynamicCharacterPortrait;
}

function firstTimeInfo(slot: CharaSlot): {
  status: MobGirlCandidateProfile["firstTimeStatus"];
  history: string;
} {
  const virgin = slot.state.TALENT[TALENT_ID.処女] ?? 0;
  if (virgin === 1) {
    return { status: "处女", history: "还没有被任何人进入" };
  }
  if (virgin === 2) {
    return { status: "再生处女", history: "处女状态已经恢复" };
  }
  if (virgin === -1) {
    return { status: "无自觉非处女", history: "没有意识到第一次已经失去" };
  }
  const lostDay = slot.state.CFLAG[CFLAG_ID.処女喪失記念日] ?? 0;
  return {
    status: "非处女",
    history: lostDay > 0 ? `第${lostDay}日失去第一次` : "已有性经验",
  };
}

/** Deterministic, browser-safe counterpart of upstream `MAKE_YUKIZURI`. */
export function generateMobGirl(
  state: Readonly<GameState>,
  candidateIndex: number,
  charaNum: number,
): GeneratedMobGirl {
  const seed = seedFor(state, candidateIndex);
  const rng = createRng(seed);
  const region = mapKeyOf(state.master.location);
  const speciesPool = mobGirlSpeciesForLocation(state.master.location);
  if (speciesPool.length === 0) throw new Error(`No MOBGIRL species for ${state.master.location}`);
  const species = rng.pick(speciesPool);
  const callName = rng.pick(GIVEN_NAMES);
  const portrait = generateMobPortrait(seed, species);
  const slot: CharaSlot = {
    charaNum,
    callName,
    location: state.master.location,
    homeLocation: ARCHIVED_DYNAMIC_LOCATION,
    state: emptyCharaSlotState(),
  };
  const maxStamina = 700 + rng.int(501);
  const maxWill = 650 + rng.int(551);
  slot.state.BASE[BASE_ID.体力] = maxStamina;
  slot.state.BASE[BASE_ID.気力] = maxWill;
  slot.state.MAXBASE[BASE_ID.体力] = maxStamina;
  slot.state.MAXBASE[BASE_ID.気力] = maxWill;
  slot.state.ABL[ABL_ID.親密] = rng.int(3);
  slot.state.ABL[ABL_ID.従順] = rng.int(4);
  slot.state.ABL[ABL_ID.欲望] = rng.int(4);
  slot.state.ABL[ABL_ID.技巧] = rng.int(4);
  slot.state.ABL[ABL_ID.奉仕精神] = rng.int(4);
  slot.state.ABL[ABL_ID.战斗能力] = species === "鬼" ? 3 + rng.int(3) : 1 + rng.int(3);
  slot.state.CFLAG[CFLAG_ID.好感度] = rng.int(101);
  slot.state.CFLAG[CFLAG_ID.信頼度] = rng.int(21);
  slot.state.TALENT[TALENT_ID.性別] = 1;
  slot.state.TALENT[TALENT_ID.路人] = 1;
  applySpeciesTalents(slot, species);
  const encounterSummary = `${callName}：第${state.time.dayIndex}日在${region}相遇的${species}`;
  return {
    slot,
    meta: {
      origin: "generated",
      lifecycle: "transient",
      active: true,
      seed,
      species,
      encounterRegion: region,
      encounterSummary,
      createdDay: state.time.dayIndex,
      portrait,
    },
  };
}

export function previewMobGirl(state: Readonly<GameState>, candidateIndex: number): GeneratedMobGirl {
  return generateMobGirl(state, candidateIndex, FIRST_DYNAMIC_CHARA_NUM);
}

/** Read-only projection used by COM444's personal information panel and its
 * optional AI self-introduction. It is derived from the deterministic preview
 * and never materializes a character into GameState.
 *
 * Returns `null` when the master is in a location without a configured
 * MOBGIRL species pool (神社, 魔法之森, etc.) — the caller must handle this
 * gracefully instead of crashing the UI render. */
export function mobGirlCandidateProfile(
  state: Readonly<GameState>,
  candidateIndex: number,
): MobGirlCandidateProfile | null {
  // Guard: don't crash when the current location has no mob-girl species pool.
  if (mobGirlSpeciesForLocation(state.master.location).length === 0) return null;
  const generated = previewMobGirl(state, candidateIndex);
  const slot = generated.slot;
  const st = slot.state;
  const firstTime = firstTimeInfo(slot);
  return {
    charaNum: slot.charaNum,
    seed: generated.meta.seed,
    callName: slot.callName ?? "那个女孩",
    species: generated.meta.species,
    region: generated.meta.encounterRegion,
    location: slot.location,
    encounterType: !isTimeStopped(state) ? "同行可带出" : "临时接触",
    stamina: {
      value: st.BASE[BASE_ID.体力] ?? 0,
      max: st.MAXBASE[BASE_ID.体力] ?? 0,
    },
    will: {
      value: st.BASE[BASE_ID.気力] ?? 0,
      max: st.MAXBASE[BASE_ID.気力] ?? 0,
    },
    favor: st.CFLAG[CFLAG_ID.好感度] ?? 0,
    trust: st.CFLAG[CFLAG_ID.信頼度] ?? 0,
    firstTimeStatus: firstTime.status,
    firstTimeHistory: firstTime.history,
    abilities: [
      { key: "亲密", value: st.ABL[ABL_ID.親密] ?? 0 },
      { key: "従順", value: st.ABL[ABL_ID.従順] ?? 0 },
      { key: "欲望", value: st.ABL[ABL_ID.欲望] ?? 0 },
      { key: "技巧", value: st.ABL[ABL_ID.技巧] ?? 0 },
      { key: "奉仕精神", value: st.ABL[ABL_ID.奉仕精神] ?? 0 },
      { key: "战斗能力", value: st.ABL[ABL_ID.战斗能力] ?? 0 },
    ],
    encounterSummary: generated.meta.encounterSummary,
    portrait: generated.meta.portrait ?? generateMobPortrait(generated.meta.seed, generated.meta.species),
  };
}

/**
 * Projects an already materialized generated character into the same compact
 * facts used by COM444. The projection is read-only so the AI layer can build
 * a persona without taking ownership of character state or settlement.
 */
export function mobGirlProfileForCharacter(
  state: Readonly<GameState>,
  charaNum: number,
): MobGirlCandidateProfile | null {
  const meta = state.dynamicCharacters?.[charaNum];
  const slot = state.charas[charaNum];
  if (!meta || meta.origin !== "generated" || !slot) return null;
  const st = slot.state;
  const firstTime = firstTimeInfo(slot);
  return {
    charaNum,
    seed: meta.seed,
    callName: slot.callName ?? "那个女孩",
    species: meta.species,
    region: meta.encounterRegion,
    location: slot.location,
    encounterType: !isTimeStopped(state) ? "同行可带出" : "临时接触",
    stamina: {
      value: st.BASE[BASE_ID.体力] ?? 0,
      max: st.MAXBASE[BASE_ID.体力] ?? 0,
    },
    will: {
      value: st.BASE[BASE_ID.気力] ?? 0,
      max: st.MAXBASE[BASE_ID.気力] ?? 0,
    },
    favor: st.CFLAG[CFLAG_ID.好感度] ?? 0,
    trust: st.CFLAG[CFLAG_ID.信頼度] ?? 0,
    firstTimeStatus: firstTime.status,
    firstTimeHistory: firstTime.history,
    abilities: [
      { key: "亲密", value: st.ABL[ABL_ID.親密] ?? 0 },
      { key: "従順", value: st.ABL[ABL_ID.従順] ?? 0 },
      { key: "欲望", value: st.ABL[ABL_ID.欲望] ?? 0 },
      { key: "技巧", value: st.ABL[ABL_ID.技巧] ?? 0 },
      { key: "奉仕精神", value: st.ABL[ABL_ID.奉仕精神] ?? 0 },
      { key: "战斗能力", value: st.ABL[ABL_ID.战斗能力] ?? 0 },
    ],
    encounterSummary: meta.encounterSummary,
    portrait: meta.portrait ?? generateMobPortrait(meta.seed, meta.species),
  };
}

export function allocateDynamicCharaNum(state: GameState): number {
  let id = Math.max(FIRST_DYNAMIC_CHARA_NUM, Math.trunc(state.nextDynamicCharaNum ?? FIRST_DYNAMIC_CHARA_NUM));
  while (state.charas[id]) id += 1;
  state.nextDynamicCharaNum = id + 1;
  return id;
}

/** Materializes one stable authored NPC through the same CharaSlot authority as
 * roster and generated characters. The call-name/home fallback adopts a slot
 * supplied by a new-game baseline when an older save has no resident metadata. */
function ensureAuthoredResident(
  state: GameState,
  definition: AuthoredResidentDefinition,
): CharaSlot {
  state.dynamicCharacters ??= {};
  const existingEntry = Object.entries(state.dynamicCharacters).find(([, meta]) =>
    meta.origin === "authored" && meta.role === definition.role,
  );
  if (existingEntry) {
    const slot = state.charas[Number(existingEntry[0])];
    if (slot) {
      state.nextDynamicCharaNum = Math.max(
        FIRST_DYNAMIC_CHARA_NUM,
        Math.trunc(state.nextDynamicCharaNum ?? FIRST_DYNAMIC_CHARA_NUM),
        slot.charaNum + 1,
      );
      return slot;
    }
    delete state.dynamicCharacters[Number(existingEntry[0])];
  }

  const adopted = Object.values(state.charas).find((slot) =>
    state.dynamicCharacters?.[slot.charaNum] === undefined &&
    slot.callName === definition.callName &&
    slot.homeLocation === definition.homeLocation,
  );
  const slot = adopted ?? (() => {
    const charaNum = allocateDynamicCharaNum(state);
    const created: CharaSlot = {
      charaNum,
      callName: definition.callName,
      location: definition.homeLocation,
      homeLocation: definition.homeLocation,
      state: emptyCharaSlotState(),
    };
    definition.initializeState(created);
    state.charas[charaNum] = created;
    return created;
  })();

  state.nextDynamicCharaNum = Math.max(
    FIRST_DYNAMIC_CHARA_NUM,
    Math.trunc(state.nextDynamicCharaNum ?? FIRST_DYNAMIC_CHARA_NUM),
    slot.charaNum + 1,
  );

  state.dynamicCharacters[slot.charaNum] = {
    origin: "authored",
    lifecycle: "resident",
    active: true,
    seed: definition.seed,
    role: definition.role,
    adult: true,
    createdDay: state.time.dayIndex,
    homeLocation: definition.homeLocation,
    ...(definition.species ? { species: definition.species } : {}),
  };
  return slot;
}

/** Stable passerby/shopkeeper model for 森近霖之助. Upstream has no Chara CSV
 * row for him, so conservative deterministic defaults fill the missing slot
 * state while his known identity and home remain explicit metadata. */
export function ensureRinnosuke(state: GameState): CharaSlot {
  return ensureAuthoredResident(state, {
    role: RINNOSUKE_ROLE,
    callName: "霖之助",
    homeLocation: RINNOSUKE_HOME,
    seed: 502,
    species: "半人半妖",
    initializeState: (slot) => {
      slot.state.BASE[BASE_ID.体力] = 1_500;
      slot.state.BASE[BASE_ID.気力] = 1_700;
      slot.state.MAXBASE[BASE_ID.体力] = 1_500;
      slot.state.MAXBASE[BASE_ID.気力] = 1_700;
      slot.state.TALENT[TALENT_ID.性別] = 2;
      slot.state.ABL[ABL_ID.話術技能] = 2;
      slot.state.ABL[ABL_ID.战斗能力] = 1;
      slot.state.ABL[ABL_ID.教養] = 3;
      slot.state.CFLAG[CFLAG_ID.好感度] = 0;
      slot.state.CFLAG[CFLAG_ID.信頼度] = 0;
      slot.state.CFLAG[CFLAG_ID.认识] = 0;
    },
  });
}

/** Lazily materializes COM633's authored adult resident. Unlike generated mob
 * girls this slot is stable, stays active and is ignored by day-end archival. */
export function ensureStoneContestClerk(state: GameState): CharaSlot {
  return ensureAuthoredResident(state, {
    role: STONE_CONTEST_CLERK_ROLE,
    callName: state.stoneContestProgress?.clerkName ?? "积石赛受付员",
    homeLocation: STONE_CONTEST_CLERK_HOME,
    seed: 633,
    initializeState: (slot) => {
      slot.state.BASE[BASE_ID.体力] = 1_200;
      slot.state.BASE[BASE_ID.気力] = 1_200;
      slot.state.MAXBASE[BASE_ID.体力] = 1_200;
      slot.state.MAXBASE[BASE_ID.気力] = 1_200;
      slot.state.CFLAG[CFLAG_ID.好感度] = 0;
      slot.state.CFLAG[CFLAG_ID.信頼度] = 0;
    },
  });
}

export function materializeMobGirl(state: GameState, candidateIndex: number): CharaSlot {
  const id = allocateDynamicCharaNum(state);
  const generated = generateMobGirl(state, candidateIndex, id);
  state.charas[id] = generated.slot;
  state.dynamicCharacters ??= {};
  state.dynamicCharacters[id] = generated.meta;
  return generated.slot;
}

export function rememberedMobGirls(state: Readonly<GameState>, sameRegion = true): CharaSlot[] {
  const region = mapKeyOf(state.master.location);
  return Object.entries(state.dynamicCharacters ?? {})
    .filter(([, meta]) => meta.lifecycle === "remembered" && (!sameRegion || meta.encounterRegion === region))
    .map(([id]) => state.charas[Number(id)])
    .filter((slot): slot is CharaSlot => slot !== undefined)
    .sort((a, b) => (state.dynamicCharacters?.[a.charaNum]?.rememberedSlot ?? 99) - (state.dynamicCharacters?.[b.charaNum]?.rememberedSlot ?? 99));
}

export function activateRememberedMobGirl(state: GameState, charaNum: number): CharaSlot | null {
  const meta = state.dynamicCharacters?.[charaNum];
  const slot = state.charas[charaNum];
  if (!meta || !slot || meta.lifecycle !== "remembered" || meta.encounterRegion !== mapKeyOf(state.master.location)) return null;
  meta.active = true;
  slot.location = state.master.location;
  // The caller decides whether this encounter is a real companion or a
  // field-only contact. Keeping this activation neutral avoids reintroducing
  // a cross-map companion when a remembered girl is recalled outside a base.
  slot.state.CFLAG[CFLAG_ID.同行] = 0;
  return slot;
}

export function prepareMobGirlDayEnd(state: GameState): void {
  if (state.mobGirlMemorySession) return;
  for (const [idText, meta] of Object.entries(state.dynamicCharacters ?? {})) {
    if (!meta.active) continue;
    const charaNum = Number(idText);
    const slot = state.charas[charaNum];
    if (!slot) continue;
    if (meta.lifecycle === "transient") {
      state.mobGirlMemorySession = { kind: "mob-girl-memory", charaNum, dayIndex: state.time.dayIndex };
      return;
    }
    if (meta.lifecycle === "resident") continue;
    meta.active = false;
    slot.location = ARCHIVED_DYNAMIC_LOCATION;
    slot.state.CFLAG[CFLAG_ID.同行] = 0;
  }
}

export function resolveMobGirlMemory(state: GameState, remember: boolean, replaceSlot?: number): string | null {
  const session = state.mobGirlMemorySession;
  if (!session) return null;
  state.mobGirlMemorySession = null;
  const slot = state.charas[session.charaNum];
  const meta = state.dynamicCharacters?.[session.charaNum];
  if (!slot || !meta || meta.lifecycle !== "transient") return null;
  if (!remember) {
    delete state.charas[session.charaNum];
    delete state.dynamicCharacters?.[session.charaNum];
    return `${slot.callName ?? "那个女孩"}的事情被忘得一干二净。`;
  }

  const used = new Set(rememberedMobGirls(state, false).map((entry) => state.dynamicCharacters?.[entry.charaNum]?.rememberedSlot).filter((value): value is number => value !== undefined));
  let targetSlot = replaceSlot;
  if (targetSlot === undefined) {
    for (let index = 0; index < MAX_REMEMBERED_MOB_GIRLS; index += 1) {
      if (!used.has(index)) { targetSlot = index; break; }
    }
  }
  if (targetSlot === undefined || targetSlot < 0 || targetSlot >= MAX_REMEMBERED_MOB_GIRLS) return null;
  for (const [idText, existing] of Object.entries(state.dynamicCharacters ?? {})) {
    if (existing.lifecycle === "remembered" && existing.rememberedSlot === targetSlot) {
      delete state.charas[Number(idText)];
      delete state.dynamicCharacters?.[Number(idText)];
    }
  }
  meta.lifecycle = "remembered";
  meta.rememberedSlot = targetSlot;
  meta.active = false;
  slot.state.TALENT[TALENT_ID.路人] = 2;
  slot.state.CFLAG[CFLAG_ID.同行] = 0;
  slot.location = ARCHIVED_DYNAMIC_LOCATION;
  return `把${slot.callName ?? "那个女孩"}的事情记得很清楚。`;
}
