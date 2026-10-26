/**
 * Player-base visitor destination selection from upstream
 * QOL_VISITOR_LOCATION_SELECTION / QOL_VISITOR_CHECK_AREA.
 *
 * Candidate area preferences and room weights come from the generated
 * `chara-move-spots.bundle.json`; fallback area gates and friend weighting
 * mirror QOL_VISITORS.ERB. Selection is seeded by character/day/time so the
 * world scheduler remains reproducible.
 */
import {
  ABL_ID,
  CFLAG_ID,
  TALENT_ID,
  TCVAR_ID,
} from "../state/settlement.js";
import type { CharaSlot, GameState } from "../state/game-state.js";
import { canEnterRoom } from "./map-can-move.js";
import { relationOf } from "./relation.js";
import { canAppearAtSpot, canMoveToQolRoom, qolVisitorRoomsForArea } from "./chara-move-spots.js";
import { roomCatalogEntryForId } from "./room-catalog.js";

export const QOL_VISITOR_MAX_LOCATIONS = 15;

interface WeightedQolTarget {
  point: number;
  weight: number;
}

const RELATION_TARGETS = {
  reimu: 1,
  yumemi: 9,
  byakuren: 55,
  miko: 56,
  kaguya: 62,
  eirin: 72,
  yuuka: 68,
  marisa: 11,
  alice: 17,
  yuyuko: 66,
  kasen: 43,
  nemuno: 119,
  asama: 164,
  kanako: 32,
  suwako: 33,
  shinki: 102,
  elis: 146,
  sariel: 147,
  toyohime: 99,
} as const;

function value(slot: CharaSlot, namespace: "ABL" | "TALENT", id: number): number {
  return namespace === "ABL"
    ? slot.state.ABL[id] ?? 0
    : slot.state.TALENT[id] ?? 0;
}

function relationOutsideNeutralBand(charaNum: number, otherNum: number): boolean {
  const relation = relationOf(charaNum, otherNum);
  return relation < 1 || relation > 99;
}

/** Fallback QOL_VISITOR_CHECK_AREA calls when CASE 7 yielded no candidates. */
export function qolVisitorFallbackAreas(
  visitor: CharaSlot,
  mapId: number,
): number[] {
  const areas: number[] = [];
  const add = (...localAreaIds: number[]) => {
    areas.push(...localAreaIds.map((id) => mapId * 100 + id));
  };
  const related = (target: number) =>
    relationOutsideNeutralBand(visitor.charaNum, target);
  const fairy = value(visitor, "TALENT", TALENT_ID.妖精) !== 0;
  const humanType = value(visitor, "TALENT", TALENT_ID.人間);
  const additionalRace = value(visitor, "TALENT", TALENT_ID.追加種族);
  const education = value(visitor, "ABL", ABL_ID.教養);

  switch (mapId) {
    case 0:
      if (related(RELATION_TARGETS.reimu)) add(10, 20, 30, 40, 10);
      if (fairy) add(50);
      if (related(RELATION_TARGETS.yumemi) && education > 2) add(60);
      break;
    case 1:
      add(110);
      if (related(RELATION_TARGETS.byakuren)) add(130, 140);
      if (related(RELATION_TARGETS.miko)) add(160, 170);
      break;
    case 2:
      add(210, 220);
      if (value(visitor, "TALENT", TALENT_ID.酒耐性) !== -2) add(230);
      add(240, 250, 270);
      break;
    case 3:
      add(310, 330, 340, 350, 360, 370);
      break;
    case 4:
      add(410, 420, 430);
      if (value(visitor, "TALENT", TALENT_ID.動物耳) === 2) add(440);
      add(450, 460, 470);
      if (related(RELATION_TARGETS.kaguya) && related(RELATION_TARGETS.eirin)) add(480);
      if (related(RELATION_TARGETS.yuuka)) add(490);
      break;
    case 5:
      add(510, 520, 530);
      if (related(RELATION_TARGETS.marisa)) add(540);
      if (related(RELATION_TARGETS.alice)) add(550);
      add(560, 570);
      break;
    case 6:
      add(610, 620, 630);
      if (related(RELATION_TARGETS.yuyuko)) add(650, 660);
      if (humanType === 4 && additionalRace !== 4) add(640, 670, 680, 690);
      break;
    case 7:
      add(710, 720, 730, 740);
      if (education >= 3 && value(visitor, "ABL", ABL_ID.战斗能力) >= 3 && related(RELATION_TARGETS.kasen)) add(750);
      add(760, 770);
      if (education >= 3 && related(RELATION_TARGETS.nemuno)) add(780);
      if ((education >= 3 && related(RELATION_TARGETS.asama)) || visitor.charaNum === RELATION_TARGETS.toyohime) add(790);
      break;
    case 8:
      add(810, 820, 830);
      if (related(RELATION_TARGETS.kanako) && related(RELATION_TARGETS.suwako)) add(840, 850);
      add(860, 890);
      break;
    case 9:
      add(910, 920, 930, 940, 960, 970);
      break;
    case 10:
      add(1010);
      if (!fairy) add(1050, 1060, 1070, 1080);
      add(1090);
      break;
    case 11:
      add(1110);
      if (related(RELATION_TARGETS.shinki)) add(1120);
      if (related(RELATION_TARGETS.elis) || related(RELATION_TARGETS.sariel)) add(1130);
      add(1140, 1150);
      break;
    default:
      break;
  }
  return areas;
}

function areaRoomWeight(
  weight: number | "cleanliness",
  visitor: CharaSlot,
): number {
  if (weight === "cleanliness") {
    return Math.trunc((10 - 5 * value(visitor, "TALENT", TALENT_ID.汚臭耐性)) / 2);
  }
  return weight;
}

function appendAreaCandidates(
  state: GameState,
  visitor: CharaSlot,
  mapId: number,
  areaId: number,
  candidates: WeightedQolTarget[],
): void {
  for (const row of qolVisitorRoomsForArea(areaId)) {
    if (candidates.length >= QOL_VISITOR_MAX_LOCATIONS) return;
    const weight = areaRoomWeight(row.weight, visitor);
    if (weight <= 0) continue;
    const room = roomCatalogEntryForId(row.roomId);
    if (!room || room.mapId !== mapId) continue;
    if (!canEnterRoom(state, room.location, visitor)) continue;
    if (canMoveToQolRoom(visitor.charaNum, row.roomId) === false) continue;
    candidates.push({ point: row.roomId, weight });
  }
}

function appendFriendCandidates(
  state: GameState,
  visitor: CharaSlot,
  candidates: WeightedQolTarget[],
): void {
  for (const resident of Object.values(state.charas).sort((a, b) => a.charaNum - b.charaNum)) {
    if (candidates.length >= QOL_VISITOR_MAX_LOCATIONS) return;
    if (resident.charaNum === visitor.charaNum) continue;
    if (!(resident.state.CFLAG[CFLAG_ID.神社在住] ?? 0)) continue;
    const relation = relationOf(visitor.charaNum, resident.charaNum);
    if (relation <= 100) continue;
    candidates.push({
      point: -resident.charaNum,
      weight: 10 + Math.trunc((relation - 100) / 2),
    });
  }
}

function stablePick(seed: number, totalWeight: number): number {
  let value = seed | 0;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value ^= value >>> 16;
  return (value >>> 0) % totalWeight;
}

/**
 * Return TCVAR:INITIAL_VISITATION_POINT's weighted result (room id, negative
 * friend id, or 0 when no valid candidate). `companionCharaNum` mirrors the
 * optional upstream COMPANION argument.
 */
export function selectQolVisitorTarget(
  state: GameState,
  visitor: CharaSlot,
  mapId: number,
  companionCharaNum = 0,
): number {
  if (companionCharaNum) {
    const target = state.charas[companionCharaNum]?.state.TCVAR[TCVAR_ID.INITIAL_VISITATION_POINT] ?? 0;
    if (target) return target;
  }

  const candidates: WeightedQolTarget[] = [];
  for (let areaId = mapId * 100 + 10; areaId <= mapId * 100 + 100; areaId += 10) {
    if (canAppearAtSpot(visitor.charaNum, areaId) !== true) continue;
    appendAreaCandidates(state, visitor, mapId, areaId, candidates);
  }
  if (candidates.length === 0) {
    for (const areaId of qolVisitorFallbackAreas(visitor, mapId)) {
      appendAreaCandidates(state, visitor, mapId, areaId, candidates);
    }
  }
  appendFriendCandidates(state, visitor, candidates);
  if (candidates.length === 0) return 0;

  const totalWeight = candidates.reduce((sum, item) => sum + item.weight, 0);
  let roll = stablePick(
    visitor.charaNum * 131 + state.time.dayIndex * 977 + state.time.tickValue,
    totalWeight,
  );
  for (const candidate of candidates) {
    if (roll < candidate.weight) return candidate.point;
    roll -= candidate.weight;
  }
  return candidates[candidates.length - 1]!.point;
}
