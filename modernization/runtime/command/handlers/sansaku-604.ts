/**
 * Slice O2 — COMF604 散策する (date-map stroll).
 *
 * Modern equivalent of `@COM604` (`ERB/コマンド関連/COMF/外出系/COMF604 散策する.ERB`).
 * Per-zone picker over the current date map's ODEKAKE_ZONES — chosen zone's
 * representative room becomes master + date partner's new location, and
 * `TIME += 散步所要時間` (Manhattan distance × 2) is paid.
 *
 * Reachability:
 *   - `!AT_HOME(MASTER)` — must be on a date map (via COMF405 + 605/617/etc.)
 *   - `!CFLAG:诶嘿嘿` / `!潜伏` / `!TFLAG:约会道中` — model mid-date H / sneak
 *     state as blockers (mid-date デート道中 gates block re-entering 604; a
 *     mid-stroll is the same state, so a single デート道中 flag sufficeth).
 *   - `OMANEKIBEYA()` not modeled (O3 work); not in the gate here — we'd
 *     need the 698/697 OMANEKI layer first. (Upstream also blocks here so
 *     the player can't stroll from a private room; MVP: defer to O3.)
 *
 * Picklist is built from `ODEKAKE_ZONES` (odekake-village.ts) — 7 named
 * zones in 人間の里 (1=広場 / 2=商家町 / 3=呑屋小道 / 4=寺子屋 / 5=大衆浴場 /
 * 6=情人用宿屋 / 7=長屋街 bucket). Each option's id = zone.region (1-7);
 * the handler maps that back to the zone's representative room + computes
 * walk time via Manhattan distance between zones' grid coords. The
 * representative room is the modern equivalent of the upstream P_ID for
 * that zone point (P202, P213, P211, P222, P223, P225, P214).
 *
 * Time-stop + GMF + SANSAKU_UNIQUEPLACE arms DEFERRED (per O2 plan); for
 * MVP we accept the zone as long as the date map has it modeled. (情人用宿屋
 * zone would also gate on `MONEY >= 3000` upstream, but the love-hotel
 * enter path is a separate command (698) — MVP lets the player walk
 * there.)
 *
 * Settle:
 *   - `CFLAG:MASTER:現在位置 = targetZone.representativeLocation` (via
 *     setSlotLocation, double-writes CFLAG:現在位置 + slot.location).
 *   - date partner follows (only when `FLAG:约会的对象` is set; multi-
 *     date MOREDATE arm deferred).
 *   - `TIME += walkMinutes` (Manhattan distance × 2; no TCVAR cooldown).
 *   - `FLAG:约会道中 += walkMinutes` (mirrors 605: デート道中 += 10;
 *     keeps mid-date state armed for 603 手を繋ぐ; the デート道中 flag
 *     is what blocks re-entering 604 per upstream `SIF TFLAG:约会道中 →
 *     RETURN 0`).
 *
 * NO source/PALAM settlement — `@COM604` is a pure movement command; the
 * "途中遭遇 / RAND 事件档" the O2 plan noted is upstream QOL (`@QOL_COM604`
 * at the top of COMF604), faithful defer. The MVP is the deterministic
 * "pick zone → walk → land" core.
 */

import type { GameState } from "../../state/game-state.js";
import type { HandlerEntry } from "../types.js";
import { cloneGameState } from "../../state/game-state.js";
import {
  advanceTimeTicks,
  CFLAG_ID,
  FLAG_ID,
  getMasterCflag,
} from "../../state/settlement.js";
import { atPlayerBase } from "../../world/location-predicates.js";
import { ODEKAKE_ZONES, type OdekakeZonePoint } from "../../world/odekake-village.js";
import { setSlotLocation } from "../../world/room-id-location.js";
import { pickOne, requirePickOne, type PromptSpec } from "../prompt.js";
import { TFLAG_ID, addTflag, getTflag } from "../../state/tflag.js";

const WALK_TIME_PER_GRID = 2; // 散步所要時間 = (|dx|+|dy|) * 2

/** Walk time (minutes) between two zones, Manhattan distance × 2. Pure. */
export function walkMinutesBetween(
  from: OdekakeZonePoint,
  to: OdekakeZonePoint,
): number {
  const dx = Math.abs(from.coord.col - to.coord.col);
  const dy = Math.abs(from.coord.row - to.coord.row);
  return (dx + dy) * WALK_TIME_PER_GRID;
}

function block(
  message: string,
): { ok: false; reason: { kind: "precondition"; message: string } } {
  return { ok: false, reason: { kind: "precondition", message } };
}

/**
 * Build the B9 picklist over the 7 ODEKAKE_ZONES for the current date map.
 * Each option's id is the zone's `region` (1-7). The current zone (the
 * representative room the master is in) is marked "现在地" via detail.
 */
export function sansakuPrompt(ctx: { state: GameState }): PromptSpec {
  const current = zoneByLocation(ctx.state.master.location);
  const options = ODEKAKE_ZONES.map((z) => ({
    id: z.region,
    label: z.zone,
    detail: z === current ? "现在地" : undefined,
  }));
  return pickOne("要去哪里呢？", options);
}

function checkSansakuEligible(
  state: Readonly<GameState>,
  actor: number,
): { ok: true } | { ok: false; reason: { kind: "precondition"; message: string } } {
  if (actor !== 0) return block("外出は主人公だけが実行できます。");
  if (atPlayerBase(state as GameState, 0)) {
    return block("据点内では散歩できません。");
  }
  if (getMasterCflag(state as GameState, CFLAG_ID.睡眠) !== 0) {
    return block("睡眠中です。");
  }
  if (getMasterCflag(state as GameState, CFLAG_ID.诶嘿嘿) === 2) {
    return block("诶嘿嘿中は散歩できません。");
  }
  // 潜伏は「隠れんぼ」中 = 露出不可 (UPSTREAM `GETBIT(FLAG:潜伏, 0)`).
  if (((state.flagStore[FLAG_ID.潜伏] ?? 0) & 1) !== 0) {
    return block("潜伏中です。");
  }
  // デート道中中 = 605 寄り道中. 戻るまでは再散歩不可.
  if (getTflag(state, TFLAG_ID.约会道中) !== 0) {
    return block("寄り道中です。");
  }
  return { ok: true };
}

function zoneByLocation(location: string): OdekakeZonePoint | undefined {
  return ODEKAKE_ZONES.find((z) => z.representativeLocation === location);
}

export const sansaku604HandlerEntry: HandlerEntry = {
  commandNo: 604,
  prompt: sansakuPrompt,
  execCheck: (ctx) => checkSansakuEligible(ctx.state, ctx.actor),
  handler: (ctx) => {
    const next: GameState = cloneGameState(ctx.state);
    const spec = sansakuPrompt({ state: next });
    const picked = requirePickOne(spec, ctx.promptAnswer);
    const targetRegion =
      typeof picked === "number" ? picked : Number.parseInt(String(picked), 10);
    const target = ODEKAKE_ZONES.find((z) => z.region === targetRegion);
    if (!target) {
      return {
        state: next,
        events: [
          { kind: "NARRATION" as const, timestamp: ctx.now(), text: "尚未决定目的地。" },
        ],
        outcome: "noop" as const,
      };
    }

    const fromZone = zoneByLocation(next.master.location);
    const walkMin = fromZone ? walkMinutesBetween(fromZone, target) : 0;
    const walkText = walkMin > 0 ? `${walkMin}分` : "今";

    // Move master.
    setSlotLocation(next.master, target.representativeLocation);

    // Move date partner (only when one is set; MOREDATE multi-date defer).
    const partner = next.flagStore[FLAG_ID.デート相手] ?? 0;
    if (partner && partner !== 0 && next.charas[partner]) {
      setSlotLocation(next.charas[partner]!, target.representativeLocation);
    }

    advanceTimeTicks(next, walkMin);
    // デート道中 += walkMin (mirror 605: 约会道中 += 10 / walk).
    addTflag(next, TFLAG_ID.约会道中, walkMin);

    const text =
      walkMin > 0
        ? `在${target.zone}散歩了${walkText}。`
        : `已经在${target.zone}了。`;

    return {
      state: next,
      events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text }],
      outcome: "ok" as const,
    };
  },
};
