/**
 * `@约会終了タイムアップ処理` (ERB/イベント関連/デート終了タイムアップ処理.ERB)
 * — the date time-up handler.
 *
 * Upstream evaluates it after each turn and ends the date when the master runs
 * out of 気力, the master gets sleepy (`NEMUKE() >= 720`), the master is
 * blackout drunk, or the partner is 衰弱 / out of 気力 away from an inn. When the
 * partner has `CFLAG:招待` set it then offers a **stay-over**: a 恋慕 partner
 * lets the player stay instead of walking home, ending the date without
 * returning to the main map.
 *
 * Faithful in one important respect: this path calls `SET_DATE(99, …)` and
 * deliberately **does not** run `DATE_EVENT`, so it must not call
 * `runDateEvent` — a forced end grants no kiss, no confession, no gift.
 */

import type { GameState, CharaSlot } from "../state/game-state.js";
import type { ObservationEvent } from "../../schemas/types.js";
import { BASE_ID, CFLAG_ID, TALENT_ID, TCVAR_ID } from "../state/settlement.js";
import { endDate } from "./date-session.js";
import { restoreDateOutfit } from "./date-outfit.js";
import { nemuke } from "../state/nemuke.js";

/** Upstream `NEMUKE() >= 720` — half a day awake. */
const SLEEPY_NEMUKE = 720;

/** Locations where an exhausted partner may legitimately stay out. */
function isRestStop(location: string): boolean {
  return location.includes("情人用宿屋")
    || location.includes("情人旅館")
    || location.includes("待客室");
}

export interface DateTimeUpFlags {
  masterExhausted: boolean;
  masterSleepy: boolean;
  masterDrunk: boolean;
  targetExhausted: boolean;
  /** Upstream `ANY_AFFECTED` — any participant forces the date to end. */
  anyAffected: boolean;
  /** Upstream offers a stay-over when the partner invited the master. */
  canStayOver: boolean;
}

/** Evaluate upstream's trigger conditions for the current date partner. */
export function dateTimeUpFlags(state: Readonly<GameState>): DateTimeUpFlags | null {
  const session = state.dateSession;
  if (!session) return null;
  const partner: CharaSlot | undefined = state.charas[session.partner];
  const masterExhausted = (state.master.state.BASE[BASE_ID.気力] ?? 0) === 0;
  const masterSleepy = nemuke(state as GameState) >= SLEEPY_NEMUKE;
  const sakeMax = state.master.state.MAXBASE[BASE_ID.酒気] ?? 0;
  const masterDrunk = sakeMax > 0 && (state.master.state.BASE[BASE_ID.酒気] ?? 0) >= sakeMax;
  let targetExhausted = false;
  if (partner) {
    const weakened = (partner.state.CFLAG[CFLAG_ID.衰弱] ?? 0) !== 0;
    const spent = (partner.state.BASE[BASE_ID.気力] ?? 0) === 0 && !isRestStop(partner.location);
    if (weakened || spent) targetExhausted = true;
  }
  const anyAffected = masterExhausted || masterSleepy || masterDrunk || targetExhausted;
  const invited = (state.master.state.CFLAG[CFLAG_ID.招待] ?? 0) !== 0;
  const romantic = (partner?.state.TALENT[TALENT_ID.恋人] ?? 0) !== 0;
  return {
    masterExhausted,
    masterSleepy,
    masterDrunk,
    targetExhausted,
    anyAffected,
    canStayOver: invited && romantic
      && (masterExhausted || masterSleepy || masterDrunk || targetExhausted),
  };
}

export interface DateTimeUpResult {
  ended: boolean;
  /** The player chose to stay over; upstream skips the return trip entirely. */
  stayedOver: boolean;
  events: ObservationEvent[];
}

/**
 * Apply the time-up end. `stayOver` selects upstream's 留下 branch: the date
 * mirrors clear at the current location and nobody walks home.
 */
export function applyDateTimeUp(
  state: GameState,
  flags: DateTimeUpFlags,
  opts: { stayOver?: boolean; now: () => number } = { now: () => state.time.tickValue },
): DateTimeUpResult {
  const session = state.dateSession;
  if (!session || !flags.anyAffected) return { ended: false, stayedOver: false, events: [] };
  const partner = state.charas[session.partner];
  const name = partner?.callName ?? "对方";
  const events: ObservationEvent[] = [];
  const push = (text: string): void => {
    events.push({ kind: "NARRATION", timestamp: opts.now(), text });
  };

  // 泡風呂終了判定("你限界") is not modeled; upstream falls through to the
  // normal stay-over arm when no bath is active, which is what happens here.
  if (opts.stayOver) {
    push(
      (partner?.state.TCVAR[TCVAR_ID.連住禁止] ?? 0) === 0
        ? `今天${name}提供了借宿的样子`
        : `今天也住在${name}这里吗？`,
    );
    push("恭敬不如从命那就住下来吧");
    restoreDateOutfit(state, session.partner);
    endDate(state, { resolution: "resolved" });
    return { ended: true, stayedOver: true, events };
  }

  push(flags.masterExhausted || flags.targetExhausted ? "快筋疲力尽了" : "差不多到了回去的时间了");
  if (flags.masterExhausted) {
    push("***** 因为气力归０了、踏上了归途 *****");
  } else if (flags.masterDrunk) {
    push("***** 酩酊大醉着、踏上了归途 *****");
    push("回到了博丽神社的我们就直接当场倒下了");
  } else if (flags.masterSleepy) {
    push("***** 因为倦意袭来了、踏上了归途 *****");
  }
  // `帰宅の時間経過`: upstream charges `QOL_RETURN_HOME_TIME_REQUIRED()`, which
  // without a road stage is just the date-map → main-map leg. The travel time
  // is charged by the caller (the resolver already advanced the clock for the
  // turn that triggered this), matching upstream where the time-up arm calls
  // `帰宅の時間経過` after the failing turn.
  restoreDateOutfit(state, session.partner);
  endDate(state, { returnHome: true, resolution: "resolved" });
  return { ended: true, stayedOver: false, events };
}
