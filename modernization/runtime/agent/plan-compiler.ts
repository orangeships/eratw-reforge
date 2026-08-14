import type { GameState } from "../state/game-state.js";
import type { AgentPlanCandidate } from "./types.js";
import { workEntriesForDay } from "../world/work/work-manifest.js";
import { roomIdToLocation } from "../world/room-id-location.js";

export interface HardBlock {
  kind: "sleep" | "work";
  startMin: number;
  endMin: number;
  location: string;
}

export interface FreeWindow {
  startMin: number;
  endMin: number;
}

const DAY_LENGTH = 1440;
/** Skip windows shorter than this. */
const MIN_WINDOW_MINUTES = 30;
/** Max candidates per window. */
const MAX_CANDIDATES_PER_WINDOW = 8;

/**
 * Compile hard blocks for one character on the current day.
 * Hard blocks = sleep + work — the character MUST be at that location.
 */
export function compileHardBlocks(
  state: GameState,
  charaNum: number,
  /** Day index to compile for (default: state.time.dayIndex). */
  dayIndex?: number,
): HardBlock[] {
  const slot = state.charas[charaNum];
  if (!slot) return [];

  const blocks: HardBlock[] = [];
  const targetDay = dayIndex ?? state.time.dayIndex;

  // ── Sleep block ──────────────────────────────────────────
  const sleepMin = slot.state.CFLAG?.[354] as number | undefined;
  const wakeMin = slot.state.CFLAG?.[355] as number | undefined;
  if (typeof sleepMin === "number" && typeof wakeMin === "number") {
    const home = (slot as { homeLocation?: string }).homeLocation ?? "神社:自室";
    if (sleepMin < wakeMin) {
      // Normal: sleep at night, e.g. 1320→420 (22:00→07:00)
      blocks.push({ kind: "sleep", startMin: sleepMin, endMin: wakeMin, location: home });
    } else {
      // Overnight wrapping: sleep from sleepMin to midnight, then midnight to wakeMin
      blocks.push({ kind: "sleep", startMin: sleepMin, endMin: DAY_LENGTH, location: home });
      blocks.push({ kind: "sleep", startMin: 0, endMin: wakeMin, location: home });
    }
  }

  // ── Work blocks ──────────────────────────────────────────
  const entries = workEntriesForDay(state, charaNum, targetDay);
  for (const entry of entries) {
    blocks.push({
      kind: "work",
      startMin: entry.startMin,
      endMin: entry.endMin,
      location: entry.location,
    });
  }

  // Sort by start time
  blocks.sort((a, b) => a.startMin - b.startMin);
  return blocks;
}

/**
 * Derive free windows from hard blocks.
 * Free windows are gaps between hard blocks ≥ MIN_WINDOW_MINUTES.
 */
export function deriveFreeWindows(blocks: HardBlock[]): FreeWindow[] {
  const windows: FreeWindow[] = [];
  let cursor = 0;

  for (const block of blocks) {
    if (block.startMin > cursor + MIN_WINDOW_MINUTES) {
      windows.push({ startMin: cursor, endMin: block.startMin });
    }
    cursor = Math.max(cursor, block.endMin);
  }

  // Trailing window after last block
  if (DAY_LENGTH > cursor + MIN_WINDOW_MINUTES) {
    windows.push({ startMin: cursor, endMin: DAY_LENGTH });
  }

  // Handle the edge case: if the first block starts after 0, we already
  // have a leading window. If the last block ends before DAY_LENGTH, we
  // already have a trailing window. Overnight wrapping is handled by
  // the sleep block splitting above.

  return windows;
}

/**
 * Generate location candidates for each free window.
 * For each window:
 * - "stay": remain at current location
 * - "room:N": go to a reachable room
 * - "visit:N": go visit another NPC at their location
 */
export function generateCandidates(
  state: GameState,
  charaNum: number,
  windows: FreeWindow[],
): AgentPlanCandidate[] {
  const slot = state.charas[charaNum];
  if (!slot) return [];

  const homeLoc = (slot as { homeLocation?: string }).homeLocation ?? slot.location;
  const results: AgentPlanCandidate[] = [];

  // Collect visit-able characters (same map, not self, not master)
  const visitTargets: Array<{ charaNum: number; name: string; location: string }> = [];
  for (const [id, other] of Object.entries(state.charas)) {
    const otherNum = Number(id);
    if (otherNum <= 0 || otherNum === charaNum) continue;
    const otherLoc = other.location;
    if (!otherLoc) continue;
    // Same map prefix = can visit
    const homePrefix = homeLoc.split(":")[0];
    const otherPrefix = otherLoc.split(":")[0];
    if (homePrefix === otherPrefix || otherLoc.startsWith("神社:")) {
      visitTargets.push({
        charaNum: otherNum,
        name: other.callName ?? `#${otherNum}`,
        location: otherLoc,
      });
    }
  }
  // Limit visit candidates
  const limitedVisits = visitTargets.slice(0, 6);

  // Collect reachable rooms (simple: common rooms on the same map)
  const homePrefix = homeLoc.split(":")[0];
  const reachableRooms = collectReachableRooms(state, homePrefix, homeLoc);

  for (const window of windows) {
    const entries: AgentPlanCandidate[] = [];

    // stay
    const currentLoc = slot.location;
    entries.push({
      id: "stay",
      kind: "stay",
      windowStart: window.startMin,
      windowEnd: window.endMin,
      location: currentLoc,
      label: `留在 ${currentLoc}`,
    });

    // rooms (up to 4)
    for (const room of reachableRooms.slice(0, 4)) {
      entries.push({
        id: `room:${room}`,
        kind: "room",
        windowStart: window.startMin,
        windowEnd: window.endMin,
        location: room,
        label: `去 ${room}`,
      });
    }

    // visits (up to 4)
    for (const vt of limitedVisits.slice(0, 4)) {
      entries.push({
        id: `visit:${vt.charaNum}`,
        kind: "visit",
        windowStart: window.startMin,
        windowEnd: window.endMin,
        location: vt.location,
        label: `拜访 ${vt.name}（${vt.location}）`,
      });
    }

    // Shuffle and cap
    results.push(...entries.slice(0, MAX_CANDIDATES_PER_WINDOW));
  }

  return results;
}

/** Collect rooms on the same map prefix reachable from this character's home. */
function collectReachableRooms(
  state: GameState,
  mapPrefix: string,
  homeLoc: string,
): string[] {
  const rooms = new Set<string>();
  // Always include home
  if (homeLoc) rooms.add(homeLoc);
  // Collect all NPC locations on the same map
  for (const [, slot] of Object.entries(state.charas)) {
    const loc = (slot as { location?: string }).location;
    if (loc && loc.startsWith(mapPrefix)) {
      rooms.add(loc);
    }
  }
  // Collect common rooms from scene data (room-id → location bridge).
  // This covers public rooms even when no NPC is currently there.
  for (let roomId = 1; roomId <= 500; roomId++) {
    const loc = resolveRoomLocation(roomId);
    if (loc && loc.startsWith(mapPrefix)) rooms.add(loc);
  }
  return [...rooms].slice(0, 12);
}

/** Try to resolve a room id to a location string. */
function resolveRoomLocation(roomId: number): string | null {
  const loc = roomIdToLocation(roomId);
  return loc ?? null;
}

/**
 * Compute a deterministic hash of the plan context (hard blocks).
 *
 * The hash is stored in `AcceptedAgentDailyPlan.contextHash` at compile
 * time.  At execution time, `activePlanSelection` re-computes the hash
 * from the current state: if it differs, the plan's underlying schedule
 * has drifted (changed sleep times, work hours, location) and the plan
 * is discarded.
 *
 * Uses a simple DJB2-style hash on the sorted block structure — no
 * Node crypto dependency (runs in browser).
 */
export function hashPlanContext(
  blocks: HardBlock[],
  candidates: readonly AgentPlanCandidate[] = [],
): string {
  const parts = blocks.map(
    (b) => `${b.kind}:${b.startMin}:${b.endMin}:${b.location}`,
  );
  for (const candidate of candidates) {
    parts.push(`candidate:${candidate.id}:${candidate.windowStart}:${candidate.windowEnd}:${candidate.location}`);
  }
  const str = parts.join("|");
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return `h${Math.abs(hash).toString(36)}`;
}
