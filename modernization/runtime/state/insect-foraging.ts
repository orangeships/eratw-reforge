/**
 * Deterministic state for Wriggle's monthly insect/field-gathering service
 * (COMF443 target 27).
 *
 * The upstream service stores the selected region globally, charges before
 * subscribing, and attempts the first collection on the following morning.
 * This module keeps that lifecycle serializable and makes the failed-draw
 * refund part of the runtime settlement rather than a UI convention.
 */

import type { ObservationEvent } from "../../schemas/types.js";
import type { GameState } from "./game-state.js";
import { ABL_ID, MARK_ID, TALENT_ID } from "./settlement.js";
import { TFLAG_ID, getTflag } from "./tflag.js";
import { GATHERING_SPOT_1_ITEMS } from "./gathering.js";
import { addItem } from "./items.js";
import { grant } from "./money.js";
import type { Rng } from "../command/types.js";

/** Upstream region selector: all 0..10 areas except the village (2). */
export const INSECT_FORAGING_REGIONS = [0, 1, 3, 4, 5, 6, 7, 8, 9, 10] as const;

export interface InsectForagingContract {
  /** Selected upstream gathering region (0..10, excluding 2). */
  region: number;
  /** Subscription fee paid when the contract was started. */
  fee: number;
  /** Day on which the contract was started. */
  startedDay: number;
  /** Monthly expiry boundary; 0 means no expiry for legacy saves. */
  expiresDay: number;
  /** Next morning on which a collection attempt may settle. */
  nextCollectionDay: number;
  /** Last deterministic result, useful for save/replay inspection. */
  lastCollection?: {
    day: number;
    itemId?: number;
    quantity: number;
    failed: boolean;
  };
}

export function isForagingRegion(value: number): boolean {
  return INSECT_FORAGING_REGIONS.includes(value as (typeof INSECT_FORAGING_REGIONS)[number]);
}

/** Price from `IFS_CALCULATE_PRICE`, using the modeled relationship/brand data. */
export function insectForagingFee(state: Readonly<GameState>): number {
  const wriggle = state.charas[27];
  if ((wriggle?.state.TALENT[TALENT_ID.恋人] ?? 0) !== 0) return 0;
  const rebellion = wriggle?.state.MARK[MARK_ID.反発刻印] ?? 0;
  if (rebellion > 0) return 15000 * (rebellion + 1);
  if ((wriggle?.state.TALENT[TALENT_ID.恋慕] ?? 0) < 0) return 7500;
  return 15000;
}

export function startInsectForaging(
  state: GameState,
  region: number,
  fee: number,
): InsectForagingContract | null {
  if (!isForagingRegion(region)) return null;
  const day = state.time.dayIndex;
  const contract: InsectForagingContract = {
    region,
    fee: Math.max(0, Math.trunc(fee)),
    startedDay: day,
    expiresDay: day + 30,
    nextCollectionDay: day + 1,
  };
  state.insectForaging = contract;
  return contract;
}

export function changeInsectForagingRegion(
  state: GameState,
  region: number,
): boolean {
  const contract = state.insectForaging;
  if (!contract || !isForagingRegion(region)) return false;
  contract.region = region;
  contract.nextCollectionDay = Math.max(contract.nextCollectionDay, state.time.dayIndex + 1);
  return true;
}

function collectionPower(state: Readonly<GameState>): number {
  const wriggle = state.charas[27];
  return Math.max(
    0,
    10 +
      (wriggle?.state.TALENT[TALENT_ID.採集Lv] ?? 0) * 10 +
      (wriggle?.state.ABL[ABL_ID.教養] ?? 0) * 5 +
      getTflag(state, TFLAG_ID.幸運補正) * 10,
  );
}

/** Settle one due morning collection. The caller owns morning idempotency. */
export function settleInsectForagingMorning(
  state: GameState,
  rng: Rng,
  now: () => number = () => 0,
): ObservationEvent[] {
  const contract = state.insectForaging;
  if (!contract || state.time.dayIndex < contract.nextCollectionDay) return [];
  if (contract.expiresDay > 0 && state.time.dayIndex > contract.expiresDay) {
    state.insectForaging = undefined;
    return [{
      kind: "NARRATION",
      timestamp: now(),
      text: "莉格露的采集服务期限已到，契约结束了。",
    }];
  }

  const power = collectionPower(state);
  const successRate = Math.max(10, Math.min(95, 30 + power));
  const succeeded = rng.int(100) < successRate && GATHERING_SPOT_1_ITEMS.length > 0;
  contract.nextCollectionDay = state.time.dayIndex + 1;
  if (!succeeded) {
    contract.lastCollection = {
      day: state.time.dayIndex,
      quantity: 0,
      failed: true,
    };
    // The upstream IFS_GATHER branch refunds 1000 yen when no product is
    // drawn; this is intentionally deterministic and persisted through the
    // same cloned GameState as the contract itself.
    grant(state, 1000);
    return [{
      kind: "NARRATION",
      timestamp: now(),
      text: "莉格露今天没有采集到东西，服务费退回了 1000 円。",
    }];
  }

  const index = rng.int(GATHERING_SPOT_1_ITEMS.length);
  const item = GATHERING_SPOT_1_ITEMS[index]!;
  const quantity = Math.max(1, Math.min(5, 1 + Math.trunc(power / 50) + rng.int(3)));
  addItem(state, item.id, quantity);
  contract.lastCollection = {
    day: state.time.dayIndex,
    itemId: item.id,
    quantity,
    failed: false,
  };
  return [{
    kind: "NARRATION",
    timestamp: now(),
    text: `莉格露的采集服务送来了「${item.name}」×${quantity}。`,
  }];
}
