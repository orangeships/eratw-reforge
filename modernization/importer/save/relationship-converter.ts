import type { CharaSlotState, GameState } from "../../runtime/state/game-state.js";
import { cloneGameState } from "../../runtime/state/game-state.js";
import { defaultWeatherState } from "../../runtime/state/weather-state.js";
import { roomIdToLocation, setSlotLocation } from "../../runtime/world/room-id-location.js";
import {
  ABL_ID,
  BASE_ID,
  CFLAG_ID,
  MARK_ID,
  PALAM_ID,
  TALENT_ID,
} from "../../runtime/state/settlement.js";
import { TFLAG_FIELD_REGISTRY } from "../../runtime/state/tflag.js";
import type { LegacyCharacterSnapshot, LegacySaveSnapshot } from "./types.js";
import { legacyIntArrayEntries, legacyIntArrayValue, legacyStringArrayValue } from "./types.js";

type RelationshipNamespace = "CFLAG" | "TALENT" | "ABL" | "BASE" | "PALAM" | "MARK";

interface RelationshipFieldSpec {
  namespace: RelationshipNamespace;
  id: number;
  label: string;
}

const RELATIONSHIP_FIELDS: readonly RelationshipFieldSpec[] = [
  { namespace: "CFLAG", id: CFLAG_ID.既成事実, label: "既成事実" },
  { namespace: "CFLAG", id: CFLAG_ID.好感度, label: "好感度" },
  { namespace: "CFLAG", id: CFLAG_ID.信頼度, label: "信頼度" },
  { namespace: "CFLAG", id: CFLAG_ID.弱み握り, label: "弱み握り" },
  { namespace: "CFLAG", id: CFLAG_ID.认识, label: "认识/面识" },
  { namespace: "CFLAG", id: CFLAG_ID.勃然大怒, label: "勃然大怒" },
  { namespace: "CFLAG", id: CFLAG_ID.不機嫌, label: "不機嫌" },
  { namespace: "TALENT", id: TALENT_ID.恋慕, label: "恋慕" },
  { namespace: "TALENT", id: TALENT_ID.恋人, label: "恋人" },
  { namespace: "TALENT", id: TALENT_ID.思慕, label: "思慕" },
  { namespace: "TALENT", id: TALENT_ID.愛欲, label: "愛欲" },
  { namespace: "TALENT", id: TALENT_ID.炮友, label: "炮友" },
  { namespace: "TALENT", id: TALENT_ID.合意誤認, label: "合意誤認" },
  { namespace: "ABL", id: ABL_ID.親密, label: "親密" },
  { namespace: "ABL", id: ABL_ID.欲望, label: "欲望" },
  { namespace: "BASE", id: BASE_ID.情緒, label: "情緒" },
  { namespace: "BASE", id: BASE_ID.理性, label: "理性" },
  { namespace: "PALAM", id: PALAM_ID.欲情, label: "欲情" },
  { namespace: "PALAM", id: PALAM_ID.好意, label: "好意" },
  { namespace: "MARK", id: MARK_ID.反発刻印, label: "反発刻印" },
  { namespace: "MARK", id: MARK_ID.反発取得履歴, label: "反発取得履歴" },
] as const;

export interface LegacyRelationshipCharacterReport {
  legacySlotIndex: number;
  characterId?: number;
  legacyName?: string;
  modernName?: string;
  status: "imported" | "master-skipped" | "not-in-modern-roster" | "duplicate-character-id" | "invalid-character-id";
  importedFieldCount: number;
  nonZeroFieldCount: number;
  warnings: string[];
}

export interface LegacyRelationshipImportReport {
  format: "eraTW-relationship-import-v1";
  sourceComment: string;
  sourceUniqueCode: string;
  sourceScriptVersion: string;
  sourceCharacterCount: number;
  importedCharacterCount: number;
  skippedCharacterCount: number;
  importedFieldCount: number;
  nonZeroFieldCount: number;
  preservedModernSections: string[];
  recomputedFields: string[];
  characters: LegacyRelationshipCharacterReport[];
}

export interface LegacyRelationshipImportResult {
  state: GameState;
  report: LegacyRelationshipImportReport;
}

export interface LegacyProgressSummary {
  migratedGlobalFlags: number;
  migratedTflags: number;
  migratedItems: number;
  migratedShopStock: number;
  migratedCharacterCount: number;
  migratedCharacterCells: number;
  migratedLocations: number;
  migratedYogoreRooms: number;
  migratedDiaryEntries: number;
  migratedWeatherFields: number;
  /** Number of legacy kojo option bitmasks retained without treating them as variant ids. */
  migratedKojoOptionBitmasks: number;
  warnings: string[];
  unsupported: string[];
}

export interface LegacyProgressImportResult extends LegacyRelationshipImportResult {
  report: LegacyRelationshipImportReport & {
    format: "eraTW-progress-import-v2";
    progress: LegacyProgressSummary;
  };
}

function scalarInt(character: LegacyCharacterSnapshot, name: string): bigint | undefined {
  const value = character.variables[name];
  return typeof value === "bigint" ? value : undefined;
}

function scalarString(character: LegacyCharacterSnapshot, name: string): string | undefined {
  const value = character.variables[name];
  return typeof value === "string" && value !== "" ? value : undefined;
}

function safeCharacterId(character: LegacyCharacterSnapshot): number | undefined {
  const raw = scalarInt(character, "NO");
  if (raw === undefined || raw < 0n || raw > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
  return Number(raw);
}

function storeSparseValue(store: Record<number, number>, id: number, value: number): void {
  if (value === 0) delete store[id];
  else store[id] = value;
}

/**
 * eraTW stores the partner id only on MASTER.  An NPC's TALENT:恋人 is a
 * boolean and authored kojo frequently tests it with `== 1`.  Some old/modded
 * saves contain the partner/self id in the NPC slot as well; preserving that
 * non-zero value makes loose checks pass but exact lover branches fall through.
 */
function normalizeNpcLoverTalent(
  target: CharaSlotState,
  warnings: string[],
  characterId: number,
): void {
  const value = target.TALENT[TALENT_ID.恋人] ?? 0;
  if (value === 0 || value === 1) return;
  target.TALENT[TALENT_ID.恋人] = 1;
  warnings.push(`角色 ${characterId} 的 TALENT:恋人=${value} 已按 NPC 布尔语义规范为 1`);
}

function copyRelationshipFields(
  source: LegacyCharacterSnapshot,
  target: CharaSlotState,
  warnings: string[],
): { imported: number; nonZero: number } {
  let imported = 0;
  let nonZero = 0;
  for (const field of RELATIONSHIP_FIELDS) {
    const raw = legacyIntArrayValue(source, field.namespace, field.id);
    if (raw < BigInt(Number.MIN_SAFE_INTEGER) || raw > BigInt(Number.MAX_SAFE_INTEGER)) {
      warnings.push(`${field.namespace}:${field.label}(${field.id}) 超出 JavaScript 安全整数范围，已跳过`);
      continue;
    }
    const value = Number(raw);
    storeSparseValue(target[field.namespace], field.id, value);
    imported += 1;
    if (value !== 0) nonZero += 1;
  }

  // These are caches produced by CHARA_ATTITUDE. The modern relationship
  // authority derives them from the imported source fields on demand.
  delete target.CFLAG[CFLAG_ID.態度];
  delete target.CFLAG[CFLAG_ID.合意判定];
  return { imported, nonZero };
}

/**
 * Overlay relationship authority from an old eraTW save onto an existing,
 * current-schema modern save. Unrelated modern progress stays untouched.
 */
export function importLegacyRelationships(
  baseState: GameState,
  source: LegacySaveSnapshot,
): LegacyRelationshipImportResult {
  const state = cloneGameState(baseState);
  const occurrences = new Map<number, number>();
  for (const character of source.characters) {
    const id = safeCharacterId(character);
    if (id !== undefined) occurrences.set(id, (occurrences.get(id) ?? 0) + 1);
  }

  const characters: LegacyRelationshipCharacterReport[] = [];
  let importedCharacterCount = 0;
  let importedFieldCount = 0;
  let nonZeroFieldCount = 0;

  for (const legacy of source.characters) {
    const characterId = safeCharacterId(legacy);
    const legacyName = scalarString(legacy, "NAME") ?? scalarString(legacy, "CALLNAME");
    const common = {
      legacySlotIndex: legacy.slotIndex,
      characterId,
      legacyName,
      importedFieldCount: 0,
      nonZeroFieldCount: 0,
      warnings: [] as string[],
    };
    if (characterId === undefined) {
      characters.push({ ...common, status: "invalid-character-id" });
      continue;
    }
    if (characterId === 0) {
      characters.push({ ...common, modernName: state.master.name ?? state.master.callName, status: "master-skipped" });
      continue;
    }
    if ((occurrences.get(characterId) ?? 0) > 1) {
      characters.push({ ...common, status: "duplicate-character-id" });
      continue;
    }
    const modern = state.charas[characterId];
    if (!modern) {
      characters.push({ ...common, status: "not-in-modern-roster" });
      continue;
    }
    const counts = copyRelationshipFields(legacy, modern.state, common.warnings);
    normalizeNpcLoverTalent(modern.state, common.warnings, characterId);
    importedCharacterCount += 1;
    importedFieldCount += counts.imported;
    nonZeroFieldCount += counts.nonZero;
    characters.push({
      ...common,
      modernName: modern.name ?? modern.callName,
      status: "imported",
      importedFieldCount: counts.imported,
      nonZeroFieldCount: counts.nonZero,
    });
  }

  return {
    state,
    report: {
      format: "eraTW-relationship-import-v1",
      sourceComment: source.comment,
      sourceUniqueCode: source.uniqueCode.toString(),
      sourceScriptVersion: source.scriptVersion.toString(),
      sourceCharacterCount: source.characters.length,
      importedCharacterCount,
      skippedCharacterCount: source.characters.length - importedCharacterCount,
      importedFieldCount,
      nonZeroFieldCount,
      preservedModernSections: ["时间与世界进度", "玩家状态", "物品与金钱", "事件/小游戏会话", "现代存档结构版本"],
      recomputedFields: ["CFLAG:態度(6)", "CFLAG:合意判定(19)"],
      characters,
    },
  };
}

const PERSISTENT_CHARA_NAMESPACES = [
  "BASE", "MAXBASE", "ABL", "TALENT", "EXP", "MARK", "PALAM", "CFLAG",
  "JUEL", "EQUIP", "TEQUIP", "STAIN", "TCVAR", "BUFF", "EX",
] as const satisfies readonly (keyof CharaSlotState)[];

function safeNumber(raw: bigint, label: string, warnings: string[]): number | undefined {
  if (raw < BigInt(Number.MIN_SAFE_INTEGER) || raw > BigInt(Number.MAX_SAFE_INTEGER)) {
    warnings.push(`${label} 超出 JavaScript 安全整数范围，已跳过`);
    return undefined;
  }
  return Number(raw);
}

function intRecord(
  block: LegacyCharacterSnapshot | LegacySaveSnapshot["globals"],
  name: string,
  warnings: string[],
): Record<number, number> {
  const result: Record<number, number> = {};
  for (const [id, raw] of legacyIntArrayEntries(block, name)) {
    const value = safeNumber(raw, `${name}:${id}`, warnings);
    if (value !== undefined && value !== 0) result[id] = value;
  }
  return result;
}

function fixedNumbers(
  block: LegacyCharacterSnapshot | LegacySaveSnapshot["globals"],
  name: string,
  length: number,
  warnings: string[],
): number[] {
  return Array.from({ length }, (_, index) =>
    safeNumber(legacyIntArrayValue(block, name, index), `${name}:${index}`, warnings) ?? 0,
  );
}

function parseSlashIds(value: string): number[] {
  return value.split("/").map(Number).filter((id) => Number.isSafeInteger(id) && id > 0);
}

function migrateWeather(source: LegacySaveSnapshot, warnings: string[]) {
  const g = source.globals;
  const one = (name: string) => safeNumber(legacyIntArrayValue(g, name, 0), `${name}:0`, warnings) ?? 0;
  const triple = (name: string) => fixedNumbers(g, name, 3, warnings) as [number, number, number];
  const weather = defaultWeatherState();
  weather.weatherTimezone = one("WEATHER_TIMEZOME");
  weather.windVelocity = one("WIND_VELOCITY");
  weather.continuousRainfall = one("CONTINUOUS_RAINFALL");
  weather.continuousSnowfall = one("CONTINUOUS_SNOWFALL");
  weather.snowCoverage = one("SNOW_COVERAGE");
  weather.possibilityAvalanche = one("POSSIBLITY_AVALANCHE");
  weather.nowWeatherControl = one("NOW_WEATHER_CONTROL");
  weather.nowTerm = one("NOW_TERM");
  weather.powerColdAir = one("POWER_COLD_AIR");
  weather.powerWarmAir = one("POWER_WARM_AIR");
  weather.yearWeatherControl = one("YEAR_WEATHER_CONTROL");
  weather.isRainySeason1 = fixedNumbers(g, "IS_RAINY_SEASON1", 2, warnings) as [number, number];
  weather.isRainySeason2 = one("IS_RAINY_SEASON2");
  weather.isColdLow = one("IS_COLD_LOW");
  weather.isSojLow = one("IS_SoJ_LOW");
  weather.isSouthernLow = one("IS_SOUTHERN_LOW");
  weather.isTyphoon = fixedNumbers(g, "IS_TYPHOON", 4, warnings) as [number, number, number, number];
  weather.isLinerRainband = fixedNumbers(g, "IS_LINER_RAINBAND", 2, warnings) as [number, number];
  weather.timeEnterTerritoryColdLow = triple("TIME_ENTER_TERRITORY_COLD_LOW");
  weather.timePassageTerritoryColdLow = triple("TIME_PASSAGE_TERRITORY_COLD_LOW");
  weather.timeEnterTerritorySojLow = triple("TIME_ENTER_TERRITORY_SoJ_LOW");
  weather.timeClosestSojLow = triple("TIME_CLOSEST_SoJ_LOW");
  weather.timePassageFakeFine = triple("TIME_PASSAGE_FAKE_FINE");
  weather.timePassageSojLow = triple("TIME_PASSAGE_SoJ_LOW");
  weather.timeEnterTerritorySouthernLow = triple("TIME_ENTER_TERRITORY_SOUTHERN_LOW");
  weather.timePassageSouthernLow = triple("TIME_PASSAGE_SOUTHERN_LOW");
  weather.timeEnterTerritoryTyphoon = triple("TIME_ENTER_TERRITORY_TYPHOON");
  weather.timeEnterWindZoneTyphoon = triple("TIME_ENTER_WIND_ZONE_TYPHOON");
  weather.timeClosestTyphoon = triple("TIME_CLOSEST_TYPHOON");
  weather.timePassageEyeTyphoon = triple("TIME_PASSAGE_EYE_TYPHOON");
  weather.timePassageWindZoneTyphoon = triple("TIME_PASSAGE_WIND_ZONE_TYPHOON");
  weather.timeEnterStormAreaTyphoon = triple("TIME_ENTER_STORM_AREA_TYPHOON");
  weather.timePassageStormAreaTyphoon = triple("TIME_PASSAGE_STORM_AREA_TYPHOON");
  weather.timeEnterTerritoryLinerRainband = triple("TIME_ENTER_TERRITORY_LINER_RAINBAND");
  weather.timePassageLinerRainband = triple("TIME_PASSAGE_LINER_RAINBAND");
  weather.timeEnterTerritoryExtratropicalLow = triple("TIME_ENTER_TERRITORY_EXTRATROPICAL_LOW");
  weather.timePassageWarmFront = triple("TIME_PASSAGE_WARM_FRONT");
  weather.timePassageColdFront = triple("TIME_PASSAGE_COLD_FRONT");
  weather.timePassageExtratropicalLow = triple("TIME_PASSAGE_EXTRATROPICAL_LOW");
  weather.canStratus = one("CAN_STRATUS");
  weather.canCumulus = fixedNumbers(g, "CAN_CUMULUS", 3, warnings) as [number, number, number];
  weather.atmosphericInstability = one("ATMOSPHERIC_INSTABILITY");
  weather.forbiddenChangeWeather = one("FORBIDDEN_CHANGE_WEATHER");
  weather.timeEnterTerritoryCumulus = one("TIME_ENTER_TERRITORY_CUMULUS");
  weather.timeClosestCumulus = one("TIME_CLOSEST_CUMULUS");
  weather.timePassageCumulus = one("TIME_PASSAGE_CUMULUS");
  weather.amountColdCropDamage = one("AMOUNT_COLD_CROP_DAMAGE");
  weather.isColdCropDamage = one("IS_COLD_CROP_DAMAGE");
  weather.isStormCropDamage = one("IS_STORM_CROP_DAMAGE");
  weather.isFloodCropDamage = one("IS_FLOOD_CROP_DAMAGE");
  weather.gensokyoWeatherSystem = fixedNumbers(g, "GENSOKYO_WEATHER_SYSTEM", 10, warnings);
  weather.gensokyoWindVeSystem = fixedNumbers(g, "GENSOKYO_WIND_VE_SYSTEM", 10, warnings);
  weather.gensokyoRainbowSystem = fixedNumbers(g, "GENSOKYO_RAINBOW_SYSTEM", 10, warnings);
  return weather;
}

/**
 * Broad, safe-boundary migration. It restores every old field for which the
 * modern GameState has an explicit semantic owner, and reports the remainder.
 */
export function importLegacyProgress(
  baseState: GameState,
  source: LegacySaveSnapshot,
): LegacyProgressImportResult {
  const relationship = importLegacyRelationships(baseState, source);
  const state = relationship.state;
  const warnings: string[] = [];
  const progress: LegacyProgressSummary = {
    migratedGlobalFlags: 0,
    migratedTflags: 0,
    migratedItems: 0,
    migratedShopStock: 0,
    migratedCharacterCount: 0,
    migratedCharacterCells: 0,
    migratedLocations: 0,
    migratedYogoreRooms: 0,
    migratedDiaryEntries: 0,
    migratedWeatherFields: 50,
    migratedKojoOptionBitmasks: 0,
    warnings,
    unsupported: [
      "TFLAG 中属于 turn/session 生命周期的字段，以及 RESULT/SELECTCOM 调用现场（在安全检查点重置）",
      "旧 ERB 正在执行中的训练、睡眠、宴会、约会与输入 continuation",
      "现代 roster 不存在的角色及尚未实现的 DLC/插件专用状态",
      "MONEY:1 法力货币（现代运行时尚无对应字段）",
      "礼物压缩日志、旧 DataTable 互动日志与未建模的照片/宠物系统",
    ],
  };

  const day = Math.max(1, safeNumber(legacyIntArrayValue(source.globals, "DAY", 0), "DAY:0", warnings) ?? 1);
  const minute = Math.max(0, Math.min(1439, safeNumber(legacyIntArrayValue(source.globals, "TIME", 0), "TIME:0", warnings) ?? 0));
  state.time = {
    tickValue: (day - 1) * 1440 + minute,
    dayIndex: day - 1,
    hourOfDay: Math.floor(minute / 60),
    season: safeNumber(legacyIntArrayValue(source.globals, "DAY", 2), "DAY:2", warnings) ?? 1,
    date: safeNumber(legacyIntArrayValue(source.globals, "DAY", 3), "DAY:3", warnings) ?? 1,
  };
  state.masterWakeMinute = safeNumber(legacyIntArrayValue(source.globals, "TIME", 3), "TIME:3", warnings) ?? 420;
  state.brewDays = safeNumber(legacyIntArrayValue(source.globals, "DAY", 10), "DAY:10", warnings) ?? 0;
  state.money = Math.max(0, safeNumber(legacyIntArrayValue(source.globals, "MONEY", 0), "MONEY:0", warnings) ?? 0);
  state.casinoChips = Math.max(0, safeNumber(legacyIntArrayValue(source.globals, "MONEY", 2), "MONEY:2", warnings) ?? 0);
  state.flagStore = intRecord(source.globals, "FLAG", warnings);
  progress.migratedGlobalFlags = Object.keys(state.flagStore).length;
  const legacyTflags = intRecord(source.globals, "TFLAG", warnings);
  const restorableTflagIds = new Set(
    TFLAG_FIELD_REGISTRY
      .filter((field) => field.lifecycle === "day" || field.lifecycle === "persistent")
      .map((field) => field.id),
  );
  state.tflagStore = Object.fromEntries(
    Object.entries(legacyTflags).filter(([id]) => restorableTflagIds.has(Number(id))),
  );
  progress.migratedTflags = Object.keys(state.tflagStore).length;

  state.items = {};
  for (const [id, raw] of legacyIntArrayEntries(source.globals, "ITEM")) {
    const value = safeNumber(raw, `ITEM:${id}`, warnings);
    if (value === undefined || value <= 0) {
      if (value !== undefined && value < 0) warnings.push(`ITEM:${id}=${value} 为旧插件负值，现代库存按 0 处理`);
      continue;
    }
    state.items[id] = Math.min(999, value);
    if (value > 999) warnings.push(`ITEM:${id}=${value} 超出现代持有上限，已截断为 999`);
  }
  progress.migratedItems = Object.keys(state.items).length;
  state.itemSales = intRecord(source.globals, "ITEMSALES", warnings);
  progress.migratedShopStock = Object.keys(state.itemSales).length;

  const sourceById = new Map<number, LegacyCharacterSnapshot>();
  const duplicateIds = new Set<number>();
  for (const character of source.characters) {
    const id = safeCharacterId(character);
    if (id === undefined) continue;
    if (sourceById.has(id)) duplicateIds.add(id);
    else sourceById.set(id, character);
  }
  const targets = [state.master, ...Object.values(state.charas)];
  const pantsTemp: Record<number, Record<number, number>> = {};
  const childSexPreg: Record<number, Record<number, number>> = {};
  const diaryFlags: Record<number, Record<number, 0 | 1 | 2 | 3>> = {};
  const diaryPageSet: Record<number, Record<number, number>> = {};
  const diaryMaxPage: Record<number, number> = {};
  const uwaki: NonNullable<GameState["uwaki"]> = {};
  const selectedKojoVariants: Record<number, string> = {};
  for (const target of targets) {
    const legacy = sourceById.get(target.charaNum);
    if (!legacy || duplicateIds.has(target.charaNum)) continue;
    const retainedLocation = target.location;
    const retainedRoomId = target.state.CFLAG[CFLAG_ID.現在位置];
    for (const namespace of PERSISTENT_CHARA_NAMESPACES) {
      const record = intRecord(legacy, namespace, warnings);
      target.state[namespace] = record;
      progress.migratedCharacterCells += Object.keys(record).length;
    }
    if (target.charaNum !== 0) {
      normalizeNpcLoverTalent(target.state, warnings, target.charaNum);
    }
    delete target.state.CFLAG[CFLAG_ID.態度];
    delete target.state.CFLAG[CFLAG_ID.合意判定];
    const legacyName = scalarString(legacy, "NAME");
    const legacyCallName = scalarString(legacy, "CALLNAME");
    if (legacyName) target.name = legacyName;
    if (legacyCallName) target.callName = legacyCallName;
    const roomId = target.state.CFLAG[CFLAG_ID.現在位置] ?? 0;
    const location = roomIdToLocation(roomId);
    if (location) {
      setSlotLocation(target, location);
      progress.migratedLocations += 1;
    } else if (roomId > 0) {
      // Keep the modern string/numeric location pair internally consistent.
      // The unsupported old room id remains visible in the conversion report.
      target.location = retainedLocation;
      if (retainedRoomId === undefined) delete target.state.CFLAG[CFLAG_ID.現在位置];
      else target.state.CFLAG[CFLAG_ID.現在位置] = retainedRoomId;
      warnings.push(`角色 ${target.charaNum} 的旧房间 ${roomId} 尚无现代映射，保留现代位置`);
    }
    const pants = intRecord(legacy, "PANTS_TEMP", warnings);
    if (Object.keys(pants).length > 0) pantsTemp[target.charaNum] = pants;
    const pregnancy = intRecord(legacy, "CHILD_SEX_PREG", warnings);
    if (Object.keys(pregnancy).length > 0) childSexPreg[target.charaNum] = pregnancy;
    const flags = intRecord(legacy, "DIARY", warnings) as Record<number, 0 | 1 | 2 | 3>;
    if (Object.keys(flags).length > 0) diaryFlags[target.charaNum] = flags;
    const pages = intRecord(legacy, "PAGESET", warnings);
    if (Object.keys(pages).length > 0) diaryPageSet[target.charaNum] = pages;
    const maxPage = safeNumber(legacyIntArrayValue(legacy, "MAX_DIARY_PAGE", 0), `MAX_DIARY_PAGE:${target.charaNum}`, warnings) ?? 0;
    if (maxPage > 0) diaryMaxPage[target.charaNum] = maxPage;
    const known = parseSlashIds(legacyStringArrayValue(legacy, "UWAKI_KNOWN", 0));
    const accepted = parseSlashIds(legacyStringArrayValue(legacy, "UWAKI_ACCEPTED", 0));
    if (known.length > 0 || accepted.length > 0) uwaki[target.charaNum] = { known, accepted };
    // CFLAG:490 is the upstream `kojo_option` bitmask (one bit per authored
    // script), not the active variant selector.  Treating a value such as 1
    // as variant "1" silently moves characters onto a sparse/alternate pack
    // (notably 龙), which is why imported dialogue can look truncated.  Keep
    // the raw bitmask in CFLAG for compatibility, but only project the actual
    // selector field (CFLAG:998) into the browser-facing map.
    if ((target.state.CFLAG[490] ?? 0) !== 0) progress.migratedKojoOptionBitmasks += 1;
    const modernKojoSelector = target.state.CFLAG[CFLAG_ID.口上セレクタ] ?? 0;
    if (modernKojoSelector > 0) selectedKojoVariants[target.charaNum] = String(modernKojoSelector);
    progress.migratedCharacterCount += 1;
  }
  state.pantsTemp = pantsTemp;
  state.childSexPreg = childSexPreg;
  state.diaryFlags = diaryFlags;
  state.diaryPageSet = diaryPageSet;
  state.diaryMaxPage = diaryMaxPage;
  state.uwaki = uwaki;
  state.selectedKojoVariants = selectedKojoVariants;

  const masterHomeRoom = state.master.state.CFLAG[CFLAG_ID.初期位置] ?? 0;
  const masterHome = roomIdToLocation(masterHomeRoom);
  if (masterHome) state.homeLocation = masterHome;

  const yogore: Record<string, number> = {};
  let unmappedYogore = 0;
  for (const [roomId, raw] of legacyIntArrayEntries(source.globals, "YOGORE")) {
    const location = roomIdToLocation(roomId);
    const value = safeNumber(raw, `YOGORE:${roomId}`, warnings);
    if (location && value !== undefined) yogore[location] = value;
    else unmappedYogore += 1;
  }
  state.yogore = yogore;
  progress.migratedYogoreRooms = Object.keys(yogore).length;
  if (unmappedYogore > 0) warnings.push(`${unmappedYogore} 个旧房间的污垢值因缺少现代房间映射而跳过`);

  state.farm = Array.from({ length: 5 }, (_, index) => ({
    type: safeNumber(legacyIntArrayValue(source.globals, "PLANT_TYPE", index), `PLANT_TYPE:${index}`, warnings) ?? 0,
    days: safeNumber(legacyIntArrayValue(source.globals, "PLANT_DAYS", index), `PLANT_DAYS:${index}`, warnings) ?? 0,
    grow: safeNumber(legacyIntArrayValue(source.globals, "PLANT_GROW", index), `PLANT_GROW:${index}`, warnings) ?? 0,
    dry: safeNumber(legacyIntArrayValue(source.globals, "PLANT_DRY", index), `PLANT_DRY:${index}`, warnings) ?? 0,
    food: safeNumber(legacyIntArrayValue(source.globals, "PLANT_FOOD", index), `PLANT_FOOD:${index}`, warnings) ?? 0,
    name: legacyStringArrayValue(source.globals, "HATAKE_NAME", index),
  }));
  state.varWater = legacyStringArrayValue(source.globals, "VAR_WATER", 0);
  state.varFerment = legacyStringArrayValue(source.globals, "VAR_FERMENT", 0);
  state.learnedMenu = intRecord(source.globals, "LEARNED_MENU", warnings);
  const diary = legacyStringArrayValue(source.globals, "SAVESTR", 1);
  state.masterDiary = diary.split("//").map((entry) => entry.trim()).filter(Boolean);
  progress.migratedDiaryEntries = state.masterDiary.length;
  const dayEventsEnabled = safeNumber(legacyIntArrayValue(source.globals, "ENABLE_DAYEVENTS", 0), "ENABLE_DAYEVENTS:0", warnings) ?? 1;
  state.dayEventsEnabled = dayEventsEnabled === 0 || dayEventsEnabled === 2 ? dayEventsEnabled : 1;
  state.dailyEventFlags = {
    23: safeNumber(legacyIntArrayValue(source.globals, "FLAG_DAILY_EV23", 0), "FLAG_DAILY_EV23:0", warnings) ?? 0,
    28: safeNumber(legacyIntArrayValue(source.globals, "FLAG_DAILY_EV28", 0), "FLAG_DAILY_EV28:0", warnings) ?? 0,
    29: safeNumber(legacyIntArrayValue(source.globals, "FLAG_DAILY_EV29", 0), "FLAG_DAILY_EV29:0", warnings) ?? 0,
  };
  const gatheringSeason = safeNumber(legacyIntArrayValue(source.globals, "GatheringSeason", 0), "GatheringSeason:0", warnings) ?? 0;
  state.gatheringSeason = gatheringSeason >= 1 && gatheringSeason <= 4 ? gatheringSeason as 1 | 2 | 3 | 4 : undefined;
  const raceBuffDays = safeNumber(legacyIntArrayValue(source.globals, "RACEBUFF_DAYS", 0), "RACEBUFF_DAYS:0", warnings) ?? 0;
  const race = legacyStringArrayValue(source.globals, "BUFFED_RACE", 0);
  state.mobRaceBuff = raceBuffDays > 0 && race ? { days: raceBuffDays, race } : undefined;
  state.weather = migrateWeather(source, warnings);

  // Old interpreter continuations cannot be reconstructed from SAVEDATA.
  // Resume at a deterministic command boundary while retaining persistent facts.
  state.turnContext = undefined;
  state.sleepSession = null;
  state.dailyEventSession = null;
  state.mobMealSession = null;
  state.mobGirlMemorySession = null;
  state.outing = null;
  state.outingEventSession = null;
  state.dateSession = null;
  state.danmakuBattle = null;
  state.fishingGame = null;
  state.stoneContestSession = null;
  state.walkSession = null;
  state.training = null;
  state.workRuntime = undefined;
  state.daySnapshot = Object.fromEntries(
    Object.entries(state.charas).map(([id, slot]) => [id, structuredClone(slot.state)]),
  );

  return {
    state,
    report: {
      ...relationship.report,
      format: "eraTW-progress-import-v2",
      progress,
    },
  };
}
