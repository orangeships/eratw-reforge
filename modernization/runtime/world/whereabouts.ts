/**
 * EXCOM 811 `所在地察觉` — read-only current-map character search.
 *
 * Upstream anchors:
 *   - USERCOM.ERB (RESULT 811 gate)
 *   - qol_MAP.ERB `QOL_HITOSAGASI`
 *   - COMF420 `HITOSAGASI_2`
 *
 * This is deliberately separate from `detection.ts`: that module colours map
 * cells, while 811 opens the detailed character list.  The result is a pure
 * runtime projection so browser/Tauri UI adapters cannot invent or mutate
 * character state.
 */
import type { CharaSlot, GameState } from "../state/game-state.js";
import { CFLAG_ID, TALENT_ID, TCVAR_ID } from "../state/settlement.js";
import { mapIdOfLocation } from "./location-predicates.js";
import { locationToRoomId } from "./room-id-location.js";

export type WhereaboutsRelationTone = "lover" | "love" | "desire" | "longing" | "none";
export type WhereaboutsSafety = "danger" | "safe" | "none";
export type WhereaboutsActivity = "sleep" | "work" | "idle";

export interface WhereaboutsRow {
  charaNum: number;
  name: string;
  resident: boolean;
  commissionMark: "!" | "?" | "*" | "";
  heart: boolean;
  relation: string;
  relationTone: WhereaboutsRelationTone;
  safety: WhereaboutsSafety;
  roomId: number | null;
  location: string;
  activity: WhereaboutsActivity;
  activityValue: number;
  sleepMinute: number;
  wakeMinute: number;
  returnMinute: number;
  remainingMinutes: number;
  freeActionMinutes: number;
}

export interface WhereaboutsResolution {
  ok: boolean;
  reason?: string;
  mapId: number | null;
  rows: WhereaboutsRow[];
}

/** Current-map whereabouts is a player-facing navigation aid and is always available. */
export function canOpenWhereabouts(_state: Readonly<GameState>): { ok: boolean; reason?: string } {
  return { ok: true };
}

function relationOf(slot: CharaSlot): Pick<WhereaboutsRow, "heart" | "relation" | "relationTone"> {
  const t = slot.state.TALENT;
  if ((t[TALENT_ID.恋人] ?? 0) !== 0) return { heart: true, relation: "恋人", relationTone: "lover" };
  if ((t[TALENT_ID.恋慕] ?? 0) !== 0) return { heart: true, relation: "爱恋", relationTone: "love" };
  if ((t[TALENT_ID.愛欲] ?? 0) !== 0) return { heart: true, relation: "爱欲", relationTone: "desire" };
  if ((t[TALENT_ID.炮友] ?? 0) !== 0) return { heart: true, relation: "情人", relationTone: "desire" };
  if ((t[TALENT_ID.思慕] ?? 0) !== 0) return { heart: false, relation: "思慕", relationTone: "longing" };
  return { heart: false, relation: "", relationTone: "none" };
}

/** `ESTRUS_CYCLE` values used by HITOSAGASI_2: 150=危险日, 15=安全日. */
function estrusCycle(stage: number): number {
  switch (stage) {
    case 1:
    case 2: return 15;
    case 3:
    case 4: return 30;
    case 5: return 50;
    case 6: return 70;
    case 7: return 150;
    case 8: return 100;
    case 9: return 60;
    case 10: return 40;
    default: return 0;
  }
}

function safetyOf(slot: CharaSlot): WhereaboutsSafety {
  const cycle = estrusCycle(slot.state.CFLAG[CFLAG_ID.生理周期] ?? 0);
  if (cycle === 150) return "danger";
  if (cycle === 15) return "safe";
  return "none";
}

function commissionMark(slot: CharaSlot): WhereaboutsRow["commissionMark"] {
  const status = slot.state.CFLAG[CFLAG_ID.依頼状況] ?? 0;
  if (status === 1) return "!";
  if (status === 2) return "?";
  return (slot.state.CFLAG[CFLAG_ID.依頼内容] ?? 0) !== 0 ? "*" : "";
}

function minutesUntil(now: number, future: number): number {
  if (!Number.isFinite(future) || future <= 0) return 0;
  const normalizedNow = ((Math.trunc(now) % 1440) + 1440) % 1440;
  const normalizedFuture = ((Math.trunc(future) % 1440) + 1440) % 1440;
  return (normalizedFuture - normalizedNow + 1440) % 1440;
}

function rowOf(state: Readonly<GameState>, slot: CharaSlot): WhereaboutsRow {
  const cf = slot.state.CFLAG;
  const sleeping = (cf[CFLAG_ID.睡眠] ?? 0) !== 0;
  const working = (cf[CFLAG_ID.行动] ?? 0) === 5;
  const wakeMinute = cf[CFLAG_ID.起床時間] ?? 0;
  const returnMinute = cf[CFLAG_ID.帰宅時間] ?? 0;
  const activity: WhereaboutsActivity = sleeping ? "sleep" : working ? "work" : "idle";
  const scheduleTarget = sleeping ? wakeMinute : working ? returnMinute : (cf[CFLAG_ID.就寝時間] ?? 0);
  return {
    charaNum: slot.charaNum,
    name: slot.callName ?? `#${slot.charaNum}`,
    resident: (cf[CFLAG_ID.神社在住] ?? 0) !== 0,
    commissionMark: commissionMark(slot),
    ...relationOf(slot),
    safety: safetyOf(slot),
    roomId: locationToRoomId(slot.location),
    location: slot.location,
    activity,
    activityValue: sleeping
      ? (slot.state.TCVAR[TCVAR_ID.睡眠深度] ?? 0)
      : working
        ? 0
        : (cf[CFLAG_ID.溜まってる度] ?? 0),
    sleepMinute: cf[CFLAG_ID.就寝時間] ?? 0,
    wakeMinute,
    returnMinute,
    remainingMinutes: minutesUntil(state.time.tickValue, scheduleTarget),
    freeActionMinutes: state.freeActions?.[slot.charaNum]?.remainingMinutes ?? 0,
  };
}

/** Resolve all NPCs on MASTER's current map, residents first then chara id. */
export function resolveWhereabouts(state: Readonly<GameState>): WhereaboutsResolution {
  const gate = canOpenWhereabouts(state);
  const mapId = mapIdOfLocation(state.master.location);
  if (!gate.ok) return { ok: false, reason: gate.reason, mapId, rows: [] };
  if (mapId === null) {
    return { ok: false, reason: "当前位置没有可解析的原版地图编号。", mapId: null, rows: [] };
  }

  const rows = Object.values(state.charas)
    .filter((slot) => slot.location.length > 0 && mapIdOfLocation(slot.location) === mapId)
    .map((slot) => rowOf(state, slot))
    .sort((a, b) => Number(b.resident) - Number(a.resident) || a.charaNum - b.charaNum);
  return { ok: true, mapId, rows };
}
