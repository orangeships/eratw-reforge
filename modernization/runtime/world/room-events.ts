/**
 * P1-03 — room-enter event registry.
 *
 * eraTW's move chain (`@SKIP_MOVE` / `COMF400 移動.ERB:537-625`) fires a
 * small set of DESTINATION events when the master FINALLY arrives at a room:
 * an occupied toilet bounces, a bath decides eject/eye-contact/companion, an
 * asleep resident in a locked private room pauses for the 潜入/算了 choice, an
 * occupied ordinary room triggers an EVENT 4 greeting, and a first meeting
 * triggers an ENCOUNTER. This module is the SINGLE data source for those
 * routes: it enumerates every room-enter event kind, its upstream anchor, its
 * trigger predicate, the kojo arms it may emit, and whether the modern runtime
 * ROUTES it (`routed`), has upstream content but NO modern route
 * (`unmodeled` — the fail-closed gap P1-03 surfaces), or upstream has no
 * room-enter event at all (`not-authored`).
 *
 * It also exposes `auditRoomEnter(state, location, deps)`: a per-room
 * resolution that reports which routes apply and how they resolve. The build
 * manifest (`build-room-event-manifest.ts`) iterates every scene over this
 * audit so "房间 → 事件 → 口上 → 状态效果" coverage is generated, not
 * hand-claimed.
 *
 * **Scope note.** This is a catalog + fail-closed diagnostic layer, NOT a new
 * behavior engine. The existing dispatch in `skip-move.ts` (`runDestinationEvent`
 * / `concludeWalk`) keeps its behavior; this module owns the route METADATA so
 * the dispatch and the audit cannot drift. Rooms whose place flags imply an
 * enter event but that have no modern route are reported `unmodeled` and stay
 * that way until a route is added — no invented narration, no LLM.
 *
 * No upstream file mutation. See `CLAUDE.md`.
 */

import type { GameState } from "../state/game-state.js";
import type { DialogueRouter } from "../kojo/types.js";
import type { Rng } from "../command/types.js";
import { placeFlagsOf, inToilet, bathCheck } from "./location-predicates.js";
import {
  PLACE_BATH,
  PLACE_GARDEN,
  PLACE_KITCHEN,
  PLACE_PRIVATE,
  PLACE_STUDY,
  PLACE_TOILET,
  PLACE_TRAINING,
} from "./place-flags.js";

/** A destination room-enter event kind the move chain knows about. */
export type RoomEnterKind =
  /** Occupied toilet → bounce back to 直前位置 (COMF400.ERB:537-540). */
  | "toilet"
  /** Bath/onsen arrival → eject / eye-contact / companion invite (COMF400.ERB:541-579). */
  | "bath"
  /** Asleep resident in a locked private room → pause for 潜入/算了 (COMF400.ERB:586-605). */
  | "locked-private"
  /** Occupied ordinary room on final arrival → EVENT 4 greeting (COMF400.ERB:516-524). */
  | "encounter-greeting"
  /** First meeting on room transition → ENCOUNTER kojo (first-meeting.ts). */
  | "first-meeting"
  /** 宴会場 arrival → `ENKAI_SINKOU` (upstream `TFLAG:宴会場`). NOT ROUTED. */
  | "banquet-venue"
  /** 落穴 trap (COMF400.ERB:650-670). */
  | "trap-pit";

/** Route resolution status for the audit. */
export type RoomEnterStatus = "routed" | "unmodeled" | "not-authored";

/** Room-enter kinds that are really command-gated place flags (informational
 *  only — the route table does not define them as enter events; their content
 *  is reached via kitchen/study/training/garden commands). */
export type CommandGatedRoomKind = "kitchen" | "study" | "training" | "garden";

/** One room-enter route: the contract a `kind` implies. */
export interface RoomEnterRoute {
  kind: RoomEnterKind;
  label: string;
  /** Upstream ERB anchor (file or label). */
  upstream: string;
  /** Human-readable trigger predicate. */
  trigger: string;
  /** Kojo category/arms this route may emit when it fires. */
  kojoArms: readonly string[];
  /** Whether the modern runtime dispatches this route. */
  status: RoomEnterStatus;
  /** Why it is unmodeled / deferred (when status !== routed). */
  note?: string;
}

/**
 * The authoritative route table. `trigger` predicates are evaluated by
 * `auditRoomEnter`; the audit relies on this list being exhaustive for every
 * room that has a room-enter event upstream.
 */
export const ROOM_ENTER_ROUTES: readonly RoomEnterRoute[] = [
  {
    kind: "toilet",
    label: "厕所",
    upstream: "COMF400 移動.ERB:537-540",
    trigger: "PLACE_TOILET; occupied && !时停 → bounce to 直前位置; empty → enter",
    kojoArms: [],
    status: "routed",
  },
  {
    kind: "bath",
    label: "浴室/温泉",
    upstream: "COMF400 移動.ERB:541-579",
    trigger: "BATHCHECK; companion invite → EVENT 23; occupied eject → bounce; empty → 泡澡",
    kojoArms: ["EVENT 11 (reaction)", "EVENT 23 (companion invite)"],
    status: "routed",
  },
  {
    kind: "locked-private",
    label: "施錠私室",
    upstream: "COMF400 移動.ERB:586-605",
    trigger: "PLACE_PRIVATE && resident asleep && LOCK → pause for 潜入/算了",
    kojoArms: ["潜入 (sneak-in)"],
    status: "routed",
  },
  {
    kind: "encounter-greeting",
    label: "有人房间到达问候",
    upstream: "COMF400 移動.ERB:516-524",
    trigger: "occupied non-special destination → EVENT 4 greeting arm",
    kojoArms: ["EVENT 4 (greet/ignore/stop)"],
    status: "routed",
  },
  {
    kind: "first-meeting",
    label: "初次见面",
    upstream: "SYOTAIMEN / ENCOUNTER",
    trigger: "room transition introduces an unseen chara → ENCOUNTER kojo",
    kojoArms: ["ENCOUNTER (first-meeting)"],
    status: "routed",
  },
  {
    kind: "banquet-venue",
    label: "宴会场地到达",
    upstream: "COMF400 移動.ERB 宴会 ENKAI_SINKOU",
    trigger: "TFLAG:宴会場 room arrival → 宴会進行",
    kojoArms: ["ENKAI_SINKOU"],
    status: "unmodeled",
    note: "宴会程序由 day-end 调度持有，移动到达未接 ENKAI_SINKOU。",
  },
  {
    kind: "trap-pit",
    label: "落穴",
    upstream: "COMF400 移動.ERB:650-670",
    trigger: "落穴 room arrival → 掉落事件",
    kojoArms: [],
    status: "routed",
  },
];

/** Event kinds whose route is `unmodeled` — the fail-closed gap the manifest
 *  must keep visible. */
export const UNMODELED_ROOM_ENTER_KINDS: readonly RoomEnterKind[] =
  ROOM_ENTER_ROUTES.filter((route) => route.status === "unmodeled").map((route) => route.kind);

/** Event kinds whose route is `routed` — dispatched by the move chain. */
export const ROUTED_ROOM_ENTER_KINDS: readonly RoomEnterKind[] =
  ROOM_ENTER_ROUTES.filter((route) => route.status === "routed").map((route) => route.kind);

function hasFlag(location: string, flag: bigint): boolean {
  return (placeFlagsOf(location) & flag) !== 0n;
}

/** The routed room-enter kinds that apply to a location, in dispatch order.
 *  Room properties come from the single `LOCATION_PLACE_FLAGS` authority
 *  (P1-13). */
export function roomEnterKindsFor(state: GameState, location: string): RoomEnterKind[] {
  const kinds: RoomEnterKind[] = [];
  if (inToilet(location) || hasFlag(location, PLACE_TOILET)) kinds.push("toilet");
  if (bathCheck(state, location) || hasFlag(location, PLACE_BATH)) kinds.push("bath");
  if (hasFlag(location, PLACE_PRIVATE)) kinds.push("locked-private");
  // encounter-greeting / first-meeting are occupant-dependent (state), not
  // place-flag dependent; the audit resolves them.
  return kinds;
}

export interface RoomEnterAuditEntry {
  kind: RoomEnterKind;
  route: RoomEnterRoute;
  applies: boolean;
  /** How the route resolved for this room. `unmodeled` = upstream gap. */
  resolution: "ok" | "unmodeled" | "not-applicable";
  diagnostics: string[];
}

export interface RoomEnterAudit {
  location: string;
  hasOccupant: boolean;
  /** Routes that apply to this room (in `ROOM_ENTER_ROUTES` order). */
  applicable: RoomEnterAuditEntry[];
  /** Unmodeled upstream routes this room's flags imply. */
  unmodeled: RoomEnterAuditEntry[];
  /** Command-gated place kinds (kitchen/study/training/garden) — their content
   *  is reached via commands, not enter events; recorded so the absence of an
   *  enter route is not misread as a gap. */
  commandGated: CommandGatedRoomKind[];
}

export interface RoomEnterAuditDeps {
  router?: DialogueRouter;
  rng?: Rng;
}

/**
 * Per-room audit: which room-enter routes apply and how each resolves.
 *
 * The `resolution` field is the fail-closed signal:
 *   - `ok`          → route exists and the runtime dispatches it.
 *   - `unmodeled`   → upstream implies the event but there is no modern route.
 *   - `not-applicable` → the route's trigger does not hold for this room.
 */
export function auditRoomEnter(
  state: GameState,
  location: string,
  _deps: RoomEnterAuditDeps = {},
): RoomEnterAudit {
  const flags = placeFlagsOf(location);
  const hasOccupant = Object.values(state.charas).some(
    (slot) => Boolean(slot) && slot.location === location,
  ) || state.master.location === location;

  const applicable: RoomEnterAuditEntry[] = [];
  const unmodeled: RoomEnterAuditEntry[] = [];
  const commandGated: CommandGatedRoomKind[] = [];

  const entry = (
    route: RoomEnterRoute,
    applies: boolean,
    resolution: RoomEnterAuditEntry["resolution"],
    diagnostics: string[] = [],
  ): RoomEnterAuditEntry => ({
    kind: route.kind,
    route,
    applies,
    resolution,
    diagnostics,
  });

  for (const route of ROOM_ENTER_ROUTES) {
    switch (route.kind) {
      case "toilet": {
        const applies = (flags & PLACE_TOILET) !== 0n || inToilet(location);
        if (applies) applicable.push(entry(route, true, "ok"));
        break;
      }
      case "bath": {
        const applies = (flags & PLACE_BATH) !== 0n || bathCheck(state, location);
        if (applies) applicable.push(entry(route, true, "ok"));
        break;
      }
      case "locked-private": {
        const applies = (flags & PLACE_PRIVATE) !== 0n;
        if (applies) applicable.push(entry(route, true, "ok"));
        break;
      }
      case "encounter-greeting": {
        // Occupied NON-special destination on final arrival.
        const special = (flags & PLACE_TOILET) !== 0n || (flags & PLACE_BATH) !== 0n
          || inToilet(location) || bathCheck(state, location);
        if (hasOccupant && !special) applicable.push(entry(route, true, "ok"));
        break;
      }
      case "first-meeting": {
        if (hasOccupant) applicable.push(entry(route, true, "ok"));
        break;
      }
      case "banquet-venue": {
        const active = state.worldEvents?.some((we) =>
          we.kind === "banquet" && we.phase !== "resolved" && we.phase !== "cancelled" &&
          (we.venue === location || location.startsWith(we.venue))
        );
        if (active) {
          unmodeled.push(entry(route, true, "unmodeled", [route.note ?? "宴会場到达未接 ENKAI_SINKOU。"]));
        }
        break;
      }
      case "trap-pit": {
        // Unlike toilet/bath, a pitfall is a transient room-scoped activity,
        // not a PLACE_* flag. The arrival resolver consumes this same active
        // record, so the audit reports a routed event only while it exists.
        const pitfall = state.freeActionMeta?.pitfall;
        if (pitfall?.dayIndex === state.time.dayIndex && pitfall.location === location) {
          applicable.push(entry(route, true, "ok"));
        }
        break;
      }
    }
  }

  // Command-gated place kinds (informational, not enter routes).
  if ((flags & PLACE_KITCHEN) !== 0n) commandGated.push("kitchen");
  if ((flags & PLACE_STUDY) !== 0n) commandGated.push("study");
  if ((flags & PLACE_TRAINING) !== 0n) commandGated.push("training");
  if ((flags & PLACE_GARDEN) !== 0n) commandGated.push("garden");

  return { location, hasOccupant, applicable, unmodeled, commandGated };
}
