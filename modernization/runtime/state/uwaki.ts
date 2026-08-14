/**
 * 浮気把握 (UWAKI) — who knows about MASTER's affairs with whom.
 *
 * Upstream (`ERB/イベント関連/情事発覚.ERB`):
 *  - `@UWAKI_RECORD(witness, 公认, 浮气相手)` (line 701) appends the partner's
 *    CALLNAME to the witness's `UWAKI_KNOWN:witness:0` slash-list (and to
 *    `UWAKI_ACCEPTED` when 公认). With 浮气相手 omitted, it records EVERY
 *    chara in MASTER's room who is actively involved (`TCVAR:MASTER:亲热>=3 &&
 *    GETBIT(既成事實,1)` — the "in the act with consent" filter).
 *  - Trigger `@AFFAIR_DISCLOSURE` (line 8): a third character enters (同室) or
 *    peeks (覗き) while MASTER is in うふふ with someone else.
 *  - `@GET_UWAKI_HISTORY(witness, partner)` (line 735): 2 = 公认 (yellow),
 *    1 = known, 0 = unknown. Read by 浮気把握状況 (PRINT_STATE2.ERB:731).
 *
 * Modern model: `GameState.uwaki[witness] = { known: number[], accepted:
 * number[] }` (charaNums — JSON-safe, avoids the upstream name-string
 * matching). The record hook lives in the per-command end pipeline
 * (`event-com-end`): after an H-family command executes, every chara in
 * MASTER's room who is NOT part of the うふふ session witnesses the session
 * partners. That is the 同室-branch of AFFAIR_DISCLOSURE; the full event
 * (催眠/anger/把柄/getout prose) is a separate port — the RECORD side is what
 * the dashboard's mechanism needs and is faithful to "witnessed = recorded".
 */

import type { GameState } from "./game-state.js";
import { CFLAG_ID } from "./settlement.js";
import { requiresHMode } from "../command/h-mode.js";

export interface UwakiEntry {
  known: number[];
  accepted: number[];
}

function entryFor(state: GameState, witness: number): UwakiEntry {
  state.uwaki ??= {};
  return (state.uwaki[witness] ??= { known: [], accepted: [] });
}

/** `@UWAKI_RECORD` — witness learns about MASTER × partner. */
export function uwakiRecord(
  state: GameState,
  witness: number,
  accepted: boolean,
  partner: number,
): void {
  if (witness <= 0 || partner <= 0 || witness === partner) return;
  const e = entryFor(state, witness);
  if (!e.known.includes(partner)) e.known.push(partner);
  if (accepted && !e.accepted.includes(partner)) e.accepted.push(partner);
}

/** `@GET_UWAKI_HISTORY` — 2 公认 / 1 known / 0 unknown. */
export function getUwakiHistory(state: Readonly<GameState>, witness: number, partner: number): 0 | 1 | 2 {
  const e = state.uwaki?.[witness];
  if (!e) return 0;
  if (e.accepted.includes(partner)) return 2;
  if (e.known.includes(partner)) return 1;
  return 0;
}

/**
 * Per-command hook (同室 disclosure): after an H-family command ran, every
 * same-room chara outside the session records the session partners.
 * Mirrors UWAKI_RECORD's no-partner branch: partners = charas in MASTER's
 * room with the うふふ flag (the modern "in the act" marker; upstream uses
 * 亲热≥3 + 既成事實 bit1, whose modern per-session equivalent is 诶嘿嘿).
 */
export function runUwakiWitnessCheck(state: GameState, commandNo: number): void {
  if (!requiresHMode(commandNo)) return;
  if ((state.master.state.CFLAG[CFLAG_ID.诶嘿嘿] ?? 0) === 0) return;
  const room = state.master.location;
  if (!room) return;

  const partners: number[] = [];
  const bystanders: number[] = [];
  for (const slot of Object.values(state.charas)) {
    if (slot.location !== room) continue;
    if ((slot.state.CFLAG[CFLAG_ID.诶嘿嘿] ?? 0) !== 0) partners.push(slot.charaNum);
    else bystanders.push(slot.charaNum);
  }
  if (partners.length === 0 || bystanders.length === 0) return;
  for (const witness of bystanders) {
    for (const partner of partners) {
      uwakiRecord(state, witness, false, partner);
    }
  }
}

export interface UwakiRow {
  charaNum: number;
  callName: string;
  /** 2 = 公认 (upstream renders yellow). */
  level: 1 | 2;
}

/** 浮気把握状況 (PRINT_STATE2.ERB:731) — partners `witness` knows about. */
export function buildUwakiRows(state: Readonly<GameState>, witness: number): UwakiRow[] {
  if (witness === 0) return []; // upstream: C_ID == MASTER ⇒ RETURN
  const out: UwakiRow[] = [];
  for (const slot of Object.values(state.charas)) {
    if (slot.charaNum === witness) continue;
    const level = getUwakiHistory(state, witness, slot.charaNum);
    if (level === 0) continue;
    out.push({ charaNum: slot.charaNum, callName: slot.callName ?? `#${slot.charaNum}`, level });
  }
  return out;
}
