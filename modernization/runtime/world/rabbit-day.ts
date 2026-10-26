/**
 * 兔子之日的确定性祭日效果。
 *
 * Upstream anchors:
 *   - 祭日事件.ERB:75-76 — SEASONAL_MORNING 的兔子之日地文
 *   - BEFORETRAIN.ERB:490-516 — 每日衣装流程调用 SPECIAL_OUTFIT
 *   - 衣服/CLOTHES.ERB:1851-1862 — SPECIAL_OUTFIT() 返回套装 55
 *   - OBJ/CLASS/衣装セット.ERB:1357-1385 — 套装 55 的具体装备
 *
 * This is deliberately a world hook, not a DailyEvent: the original has no
 * choice, reward, inventory mutation, or standalone random event here.
 */

import type { ObservationEvent } from "../../schemas/types.js";
import type { CharaSlot, GameState } from "../state/game-state.js";
import { clothingIdByName } from "../state/clothing-catalog.js";
import { CFLAG_ID, EQUIP_SLOT, TALENT_ID, TEQUIP_ID } from "../state/settlement.js";
import { festivalNow, SEASON_WINTER, seasonOf } from "./calendar.js";

export const RABBIT_DAY_NAME = "兔子之日";
export const RABBIT_DAY_OUTFIT_SET = 55;
export const FASHION_OUTFIT_SETS = [62, 74] as const;

/** Persisted before applying the temporary festival clothing. */
export type FestivalOutfitSnapshot = Record<number, number>;

const RABBIT_DAY_WEAR = [
  ["帽子", "兔耳发箍"],
  ["腕部装束", "袖套"],
  ["レオタード", "兔女郎服"],
  ["襪子", "渔网袜"],
  ["靴", "高跟鞋"],
  ["其他１", "领带"],
] as const satisfies ReadonlyArray<[keyof typeof EQUIP_SLOT, string]>;

const FASHION_WEAR = {
  62: [
    ["裙子", "三色裙子"],
    ["靴", "靴子"],
    ["襪子", "袜子"],
    ["上身衣服２", "地獄Ｔ恤衬衫"],
  ],
  74: [
    ["帽子", "发饰"],
    ["靴", "皮鞋"],
    ["襪子", "袜子"],
    ["上身衣服１", "水手服"],
    ["裙子", "学生制服短裙"],
  ],
} as const satisfies Readonly<Record<number, ReadonlyArray<[keyof typeof EQUIP_SLOT, string]>>>;

function isRabbitDay(state: GameState): boolean {
  return festivalNow(state.time) === RABBIT_DAY_NAME;
}

function allCharacters(state: GameState): CharaSlot[] {
  return [state.master, ...Object.values(state.charas).sort((a, b) => a.charaNum - b.charaNum)];
}

function isEligibleForRabbitDay(slot: CharaSlot): boolean {
  // Upstream SPECIAL_OUTFIT is gated by `TALENT:性別 != 2`; absent talent
  // values retain the ERA default and are therefore eligible.
  return (slot.state.TALENT[TALENT_ID.性別] ?? 0) !== 2;
}

function snapshotEquip(slot: CharaSlot): FestivalOutfitSnapshot {
  const snapshot: FestivalOutfitSnapshot = {};
  for (const slotId of Object.values(EQUIP_SLOT)) {
    const pieceId = slot.state.EQUIP[slotId] ?? 0;
    if (pieceId !== 0) snapshot[slotId] = pieceId;
  }
  return snapshot;
}

function resolveWear(entries: ReadonlyArray<readonly [keyof typeof EQUIP_SLOT, string]>): Record<number, number> | null {
  const resolved: Record<number, number> = {};
  for (const [slotName, pieceName] of entries) {
    const slotId = EQUIP_SLOT[slotName];
    const pieceId = clothingIdByName(slotId, pieceName);
    // Generated catalog data is the source of truth. If it is incomplete,
    // fail closed instead of applying a half-built outfit.
    if (pieceId === undefined) return null;
    resolved[slotId] = pieceId;
  }
  return resolved;
}

function applyWear(slot: CharaSlot, wear: Readonly<Record<number, number>>, outfitSet: number): void {
  for (const slotId of Object.values(EQUIP_SLOT)) delete slot.state.EQUIP[slotId];
  for (const [slotId, pieceId] of Object.entries(wear)) {
    slot.state.EQUIP[Number(slotId)] = pieceId;
  }
  recomputeRabbitDayExposure(slot);
  slot.state.CFLAG[CFLAG_ID.衣装一時変更] = outfitSet;
}

/**
 * The ordinary clothing writer imports the toggleable-TEQUIP module, whose
 * top-level catalog construction is incompatible with the settlement/clock
 * cycle used by day-end. Rabbit Day only needs the deterministic EQUIP →
 * TEQUIP:0/1 projection, so keep this small projection local and side-effect
 * free at module evaluation time.
 */
function recomputeRabbitDayExposure(slot: CharaSlot): void {
  const e = slot.state.EQUIP;
  let lower = 0;
  let upper = 0;
  if (e[EQUIP_SLOT.下半身内衣１]) lower |= 0b0100;
  if (e[EQUIP_SLOT.下半身内衣２]) lower |= 0b0010;
  if (e[EQUIP_SLOT.裤子]) lower |= 0b0100 | 0b1000;
  if (e[EQUIP_SLOT.下身衣服]) lower |= 0b0010;
  if (e[EQUIP_SLOT.裙子]) lower |= 0b0001;
  if (e[EQUIP_SLOT.ボディースーツ]) lower |= 0b0100 | 0b1000 | 0b10000;
  if (e[EQUIP_SLOT.連衣裙] || e[EQUIP_SLOT.和服]) lower |= 0b0001;
  if (e[EQUIP_SLOT.レオタード]) lower |= 0b0010 | 0b10000;

  if (e[EQUIP_SLOT.上半身内衣１]) upper |= 0b0010 | 0b0100;
  if (e[EQUIP_SLOT.上半身内衣２]) upper |= 0b0001;
  if (e[EQUIP_SLOT.上身衣服１]) upper |= 0b0010 | 0b0100;
  if (e[EQUIP_SLOT.上身衣服２]) upper |= 0b0001;
  if (e[EQUIP_SLOT.ボディースーツ]) upper |= 0b0010 | 0b0100;
  if (e[EQUIP_SLOT.連衣裙] || e[EQUIP_SLOT.レオタード]) upper |= 0b0010 | 0b0100;
  if (e[EQUIP_SLOT.和服]) upper |= 0b0001;
  if (slot.state.TEQUIP[TEQUIP_ID.上半身裸露状態]) upper &= ~0b0010;

  slot.state.TEQUIP[TEQUIP_ID.下半身着衣状況] = lower;
  slot.state.TEQUIP[TEQUIP_ID.上半身着衣状況] = upper;
}

/** Apply the upstream temporary outfit to all eligible characters once. */
export function applyRabbitDayOutfits(state: GameState): number {
  if (!isRabbitDay(state)) return 0;
  const wear = resolveWear(RABBIT_DAY_WEAR);
  if (!wear) return 0;
  const snapshots = state.festivalOutfitSnapshots ??= {};
  let applied = 0;
  for (const slot of allCharacters(state)) {
    if (!isEligibleForRabbitDay(slot)) continue;
    const key = slot.charaNum;
    if (snapshots[key] === undefined) snapshots[key] = snapshotEquip(slot);
    applyWear(slot, wear, RABBIT_DAY_OUTFIT_SET);
    applied += 1;
  }
  return applied;
}

/** Restore outfits saved before the festival and clear the temporary marker. */
export function restoreRabbitDayOutfits(state: GameState): number {
  const snapshots = state.festivalOutfitSnapshots;
  if (!snapshots) return 0;
  let restored = 0;
  for (const [rawCharaNum, snapshot] of Object.entries(snapshots)) {
    const charaNum = Number(rawCharaNum);
    const slot = charaNum === 0 ? state.master : state.charas[charaNum];
    if (!slot) continue;
    for (const slotId of Object.values(EQUIP_SLOT)) delete slot.state.EQUIP[slotId];
    for (const [slotId, pieceId] of Object.entries(snapshot)) {
      slot.state.EQUIP[Number(slotId)] = pieceId;
    }
    recomputeRabbitDayExposure(slot);
    if ([RABBIT_DAY_OUTFIT_SET, ...FASHION_OUTFIT_SETS].includes(
      (slot.state.CFLAG[CFLAG_ID.衣装一時変更] ?? 0) as typeof RABBIT_DAY_OUTFIT_SET,
    )) {
      slot.state.CFLAG[CFLAG_ID.衣装一時変更] = 0;
    }
    restored += 1;
  }
  delete state.festivalOutfitSnapshots;
  return restored;
}

/** Keep the temporary clothing state correct across morning/day boundaries. */
export function syncRabbitDayOutfits(state: GameState): void {
  const outfitSet = isRabbitDay(state)
    ? RABBIT_DAY_OUTFIT_SET
    : FASHION_OUTFIT_SETS.includes((state.flagStore[880] ?? 0) as 62 | 74)
      ? state.flagStore[880]!
      : 0;
  if (outfitSet === 0) {
    restoreRabbitDayOutfits(state);
    return;
  }
  const wear = resolveWear(outfitSet === RABBIT_DAY_OUTFIT_SET
    ? RABBIT_DAY_WEAR
    : FASHION_WEAR[outfitSet as 62 | 74]);
  if (!wear) return;

  // If the priority changes (fashion -> Rabbit Day or vice versa), rebuild
  // from the original snapshot instead of layering one temporary set over
  // another.
  const currentSet = Object.values(state.charas)[0]?.state.CFLAG[CFLAG_ID.衣装一時変更]
    ?? state.master.state.CFLAG[CFLAG_ID.衣装一時変更]
    ?? 0;
  if (state.festivalOutfitSnapshots && currentSet !== 0 && currentSet !== outfitSet) {
    restoreRabbitDayOutfits(state);
  }

  const snapshots = state.festivalOutfitSnapshots ??= {};
  for (const slot of allCharacters(state)) {
    if (!isEligibleForRabbitDay(slot)) continue;
    if (snapshots[slot.charaNum] === undefined) snapshots[slot.charaNum] = snapshotEquip(slot);
    applyWear(slot, wear, outfitSet);
  }
}

/** Emit the two ordinary BEFORETRAIN festival narration lines. */
export function runRabbitDayMorning(
  state: GameState,
  now: () => number,
): ObservationEvent[] {
  if (!isRabbitDay(state)) return [];
  const seasonalText = seasonOf(state.time) === SEASON_WINTER
    ? "在寒空之下穿着兔女郎服度过艰难的一天……"
    : "大家应该都穿着兔女郎服";
  return [
    { kind: "NARRATION", timestamp: now(), text: `今天是${RABBIT_DAY_NAME}。` },
    { kind: "NARRATION", timestamp: now(), text: seasonalText },
  ];
}
