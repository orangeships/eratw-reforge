/**
 * Faithful port of eraTW `@MAP_CAN_MOVE_0(ARG, CHARA)` — the shrine room
 * ENTRY-permission gate (`MAP_COMM_00.ERB:114-167`).
 *
 * This is DISTINCT from `@CAN_MOVE_0` (connectivity, `shrine-graph.ts`): a
 * room may be an adjacent walkable edge (`CAN_MOVE & 1`) yet still barred to
 * a character by THIS function. The roam engine (`@角色移動処理`) and the
 * player room-move handler both consult it before relocating a character
 * into `dest`.
 *
 * THE BUG THIS FIXES: without this gate, non-inchling NPCs (霊夢) roamed into
 * 針妙丸's P54 小人的虫籠 — an impossible event the original never allows.
 * 針妙丸 is a 小人 (体型 == -5) with her own 万宝槌 system; only characters
 * with 体型 ≤ -5 (小人体质) may enter her cage.
 *
 * Returns `{ can, reason }` where `reason` mirrors `TFLAG:移動不能メッセージ`
 * (0 = none / 1 = 三妖精 locked / 2 = 虫籠 locked / 3 = 大別墅 locked) for
 * `@MAP_CANNOT_WORD_0`. Callers that only need the boolean read `can`.
 *
 * FAITHFUL ARMS PORTED (non-DLC, data available — `MAP_COMM_00.ERB:117-154`):
 *   - P54 小人的虫籠: requires `TALENT:体型 <= -5` (小人). Else reason 2.
 *   - P27-P35 三妖精之家: 妖精 talent, OR already inside, OR (CHARA==MASTER &&
 *     (恋慕 of 桑尼/露娜/斯塔 OR 教養≥1 OR 初期位置 inside)). Else reason 1.
 *   - P37-P51 夢幻遺跡: already inside allowed; non-master with 教養≤2 blocked.
 *
 * DEFERRED ARM (DLC, not modeled — `MAP_COMM_00.ERB:155-165`):
 *   - P57-P68 大別墅: gated by the `FamilyHotel` DLC flag (`大别墅.ERB`). The
 *     DLC subsystem isn't ported (CLAUDE.md: DLC-gated systems defer), so we
 *     have no flag to read; this arm returns `{ can: true }` (allowed). Only
 *     P68 大广场 is in the shrine graph (P57/60/67 are un-drawn), and its
 *     content is DLC — entry stays allowed pending a DLC slice. See
 *     DEBUG-BOARD. (Faithfulness note: a real owned-DLC check would block
 *     non-residents; deferred, not silently fabricated.)
 */

import type { GameState, CharaSlot } from "../state/game-state.js";
import { ABL_ID, CFLAG_ID, TALENT_ID } from "../state/settlement.js";
import { locationToRoomId } from "./room-id-location.js";
import { relationOf } from "./relation.js";

/** The three fairies whose 恋慕 (talent id 3) unlock 三妖精之家 for the
 *  master (`TALENT:[[桑尼]]:恋慕 || …`). 桑尼=5, 露娜=6, 斯塔=7
 *  (CSV/Chara: Chara5 サニー / Chara6 ルナ / Chara7 スター). */
const FAIRY_CHARAS = [5, 6, 7] as const;

/** Room-id ranges for the gated arms (the P-ids from PLACE_ERH.ERH). */
const THREE_FAIRY_RANGE: readonly [number, number] = [27, 35]; // P27大廳 .. P35地下室
const DREAM_RUINS_RANGE: readonly [number, number] = [37, 51]; // P37一階通路 .. P51倉庫
const MANSION_RANGE: readonly [number, number] = [57, 68]; // P57大温泉 .. P68大广场
const INCHLING_CAGE = 54; // P54 小人的虫籠

function inRange(value: number, [lo, hi]: readonly [number, number]): boolean {
  return value >= lo && value <= hi;
}

export interface MapCanMoveResult {
  can: boolean;
  /** Mirrors `TFLAG:移動不能メッセージ`: 0=allowed, 1=三妖精, 2=虫籠, 3=大別墅. */
  reason: 0 | 1 | 2 | 3;
  /** Refusal text from the matching `@MAP_CANNOT_WORD_N`, when modeled. */
  message?: string;
}

/**
 * `@MAP_CAN_MOVE_0(ARG=dest, CHARA=slot)` → RETURNF 1/0. `dest` is the
 * destination location string; `slot` is the moving character. The master
 * is detected via `slot.charaNum === state.master.charaNum` (master is
 * charaNum 0 and lives in `state.master`).
 */
export function mapCanMove0(
  state: GameState,
  dest: string,
  slot: CharaSlot,
): MapCanMoveResult {
  const destId = locationToRoomId(dest) ?? 0;
  if (destId === 0) return { can: true, reason: 0 }; // unmapped room → no gate

  const st = slot.state;
  const isMaster = slot.charaNum === state.master.charaNum;
  const curPos = locationToRoomId(slot.location) ?? st.CFLAG[CFLAG_ID.現在位置] ?? 0;
  const initialPos = st.CFLAG[CFLAG_ID.初期位置] ?? 0;

  // ── P54 小人の虫籠: 小人 (体型 ≤ -5) only. ─────────────────────────
  if (destId === INCHLING_CAGE) {
    if ((st.TALENT[TALENT_ID.体型] ?? 0) > -5) {
      return { can: false, reason: 2 };
    }
    return { can: true, reason: 0 };
  }

  // ── P27-P35 三妖精之家・大廳…地下室 ───────────────────────────────
  if (inRange(destId, THREE_FAIRY_RANGE)) {
    if (st.TALENT[TALENT_ID.妖精]) return { can: true, reason: 0 }; // 妖精なら入れる
    if (inRange(curPos, THREE_FAIRY_RANGE)) return { can: true, reason: 0 }; // 中からは動ける
    if (isMaster) {
      // 恋慕 of any three-fairy OR 教養≥1 OR 初期位置 inside
      const lovesFairy = FAIRY_CHARAS.some(
        (n) => state.charas[n]?.state.TALENT[TALENT_ID.恋慕],
      );
      if (
        lovesFairy ||
        (st.ABL[ABL_ID.教養] ?? 0) >= 1 ||
        inRange(initialPos, THREE_FAIRY_RANGE)
      ) {
        return { can: true, reason: 0 };
      }
      return { can: false, reason: 1 };
    }
    return { can: false, reason: 1 }; // それ以外は入れない
  }

  // ── P37-P51 夢幻遺跡: 中からは動ける; 你以外は教養LV3が必要 ─────────
  if (inRange(destId, DREAM_RUINS_RANGE)) {
    if (inRange(curPos, DREAM_RUINS_RANGE)) return { can: true, reason: 0 }; // 中からは動ける
    if ((st.ABL[ABL_ID.教養] ?? 0) <= 2 && !isMaster) {
      return { can: false, reason: 0 }; // blocked, no special msg (ERB sets none)
    }
    return { can: true, reason: 0 };
  }

  // ── P57-P68 大別墅: FamilyHotel DLC gate (DEFERRED — see header). ───
  if (inRange(destId, MANSION_RANGE)) {
    // DLC not modeled: allowed pending the 大別墅 DLC slice.
    return { can: true, reason: 0 };
  }

  return { can: true, reason: 0 }; // ENDSELECT → RETURNF 1
}

/** Convenience boolean for callers that don't need the reason code. */
export function canEnterRoom(
  state: GameState,
  dest: string,
  slot: CharaSlot,
): boolean {
  return mapCanMove(state, dest, slot).can;
}

const TIME_STOP_FLAG = 70;
const HYPNOSIS_FLAG = 9021;
const ROLEPLAY_FLAG = 5;
const DATE_PARTNER_FLAG = 73;
const BANQUET_FLAG = 30;
const BANQUET_START_FLAG = 33;
const WATER_DWELLER_TALENT = 163;
const WATER_ORB_ITEM = 406;

const KOSUZU = 70;
const AKYUU = 80;
const MIYOI = 134;
const KOTOHIME = 145;
const REISEN = 52;
const TEWI = 53;
const KAGUYA = 62;
const EIRIN = 72;
const YORIHIME = 98;
const TOYOHIME = 99;
const REISEN_II = 100;
const SAGUME = 110;

const EIENTEI_CORE = [REISEN, TEWI, KAGUYA, EIRIN] as const;
const MOON_FOLK = [YORIHIME, TOYOHIME, REISEN_II, SAGUME] as const;

function localRoomId(location: string): number {
  return locationToRoomId(location) ?? 0;
}

function allowed(message?: string): MapCanMoveResult {
  return { can: true, reason: 0, message };
}

function blocked(reason: MapCanMoveResult["reason"] = 0, message?: string): MapCanMoveResult {
  return { can: false, reason, message };
}

function currentRoomId(slot: CharaSlot): number {
  return localRoomId(slot.location) || slot.state.CFLAG[CFLAG_ID.現在位置] || 0;
}

function initialRoomId(slot: CharaSlot): number {
  return slot.state.CFLAG[CFLAG_ID.初期位置] ?? 0;
}

function isMasterSlot(state: GameState, slot: CharaSlot): boolean {
  return slot.charaNum === state.master.charaNum;
}

function chara(state: GameState, charaNum: number): CharaSlot | undefined {
  return charaNum === state.master.charaNum ? state.master : state.charas[charaNum];
}

function hasTalent(state: GameState, charaNum: number, talentId: number): boolean {
  return (chara(state, charaNum)?.state.TALENT[talentId] ?? 0) !== 0;
}

function isFollowing(state: GameState, charaNum: number): boolean {
  return (chara(state, charaNum)?.state.CFLAG[CFLAG_ID.同行] ?? 0) !== 0;
}

function isAtRoom(state: GameState, charaNum: number, roomId: number): boolean {
  const slot = chara(state, charaNum);
  return !!slot && currentRoomId(slot) === roomId;
}

function sameAsOrFriend(slot: CharaSlot, owner: number): boolean {
  return slot.charaNum === owner || relationOf(owner, slot.charaNum) >= 100;
}

function masterPrivateRoomPermission(
  state: GameState,
  destId: number,
  owner: number,
  extraFollowers: readonly number[] = [],
): boolean {
  if ((state.flagStore[TIME_STOP_FLAG] ?? 0) !== 0) return true;
  if (isFollowing(state, owner) || extraFollowers.some((n) => isFollowing(state, n))) return true;
  if (hasTalent(state, owner, TALENT_ID.恋慕)) return true;
  if (hasTalent(state, owner, TALENT_ID.思慕) && isAtRoom(state, owner, destId)) return true;
  return false;
}

function privateRoomGate(
  state: GameState,
  destId: number,
  slot: CharaSlot,
  owner: number,
  extraFollowers: readonly number[] = [],
  extraNpcAllowed: readonly number[] = [],
): MapCanMoveResult {
  if (isMasterSlot(state, slot)) {
    return masterPrivateRoomPermission(state, destId, owner, extraFollowers)
      ? allowed()
      : blocked(0, "随便进去不太好");
  }
  return sameAsOrFriend(slot, owner) || extraNpcAllowed.includes(slot.charaNum)
    ? allowed()
    : blocked();
}

function emptyRoomGate(state: GameState, destId: number): MapCanMoveResult {
  const occupied = Object.values(state.charas).some((slot) => initialRoomId(slot) === destId);
  if (!occupied && initialRoomId(state.master) !== destId) return blocked(0, "进不去");
  return allowed();
}

export function mapCanMove1(state: GameState, dest: string, _slot: CharaSlot): MapCanMoveResult {
  const destId = localRoomId(dest);
  if (destId === 119) return emptyRoomGate(state, destId);
  return allowed();
}

export function mapCanMove2(state: GameState, dest: string, slot: CharaSlot): MapCanMoveResult {
  const destId = localRoomId(dest);
  switch (destId) {
    case 281:
      return privateRoomGate(state, destId, slot, KOTOHIME);
    case 226:
      return privateRoomGate(state, destId, slot, KOSUZU, [AKYUU], [AKYUU]);
    case 229:
      return privateRoomGate(state, destId, slot, AKYUU);
    case 239:
      return privateRoomGate(state, destId, slot, MIYOI);
    case 220:
    case 225:
      return isMasterSlot(state, slot) ? allowed() : blocked();
    case 228:
      if (!isMasterSlot(state, slot)) return blocked();
      return blocked(0, "想要直接进去的话必须包下来");
    case 230:
    case 243:
      return emptyRoomGate(state, destId);
    default:
      return allowed();
  }
}

export function mapCanMove3(state: GameState, dest: string, slot: CharaSlot): MapCanMoveResult {
  const destId = localRoomId(dest);
  if (destId === 348) {
    const waterOk =
      (slot.state.TALENT[WATER_DWELLER_TALENT] ?? 0) !== 0 ||
      (state.items?.[WATER_ORB_ITEM] ?? 0) > 0;
    if (!waterOk) return blocked(0, "会淹死的…");
  }
  if (destId === 304 || destId === 321) return emptyRoomGate(state, destId);
  return allowed();
}

function eienteiPermit(state: GameState): boolean {
  if ((state.items?.[982] ?? 0) >= 2) return true;
  if ((state.flagStore[HYPNOSIS_FLAG] ?? 0) > 50) return true;
  if ((chara(state, KAGUYA)?.state.CFLAG[CFLAG_ID.认识] ?? 0) !== 0) return true;
  if (EIENTEI_CORE.some((n) => hasTalent(state, n, TALENT_ID.恋慕))) return true;
  if (EIENTEI_CORE.includes((state.flagStore[DATE_PARTNER_FLAG] ?? 0) as typeof EIENTEI_CORE[number])) return true;
  if (EIENTEI_CORE.includes((state.flagStore[ROLEPLAY_FLAG] ?? 0) as typeof EIENTEI_CORE[number])) return true;
  if (EIENTEI_CORE.some((n) => isFollowing(state, n))) return true;
  return (state.flagStore[BANQUET_FLAG] ?? 0) === 3 && state.time.tickValue >= (state.flagStore[BANQUET_START_FLAG] ?? 0);
}

export function mapCanMove4(state: GameState, dest: string, slot: CharaSlot): MapCanMoveResult {
  const destId = localRoomId(dest);
  if (inRange(destId, [407, 430])) {
    if (EIENTEI_CORE.includes(slot.charaNum as typeof EIENTEI_CORE[number])) return allowed();
    if (MOON_FOLK.includes(slot.charaNum as typeof MOON_FOLK[number])) return allowed();
    if (inRange(currentRoomId(slot), [407, 430])) return allowed();
    if (isMasterSlot(state, slot)) {
      if (
        eienteiPermit(state) ||
        inRange(initialRoomId(state.master), [401, 430]) ||
        (state.flagStore[TIME_STOP_FLAG] ?? 0) !== 0
      ) {
        return allowed();
      }
      return blocked(0, "没有关系亲密的人的话无法进入永远亭里面…");
    }
    return blocked();
  }
  if (destId === 412 || destId === 428 || destId === 442 || destId === 460) {
    return emptyRoomGate(state, destId);
  }
  return allowed();
}

export function mapCanMove(
  state: GameState,
  dest: string,
  slot: CharaSlot,
): MapCanMoveResult {
  const destId = localRoomId(dest);
  if (destId >= 1 && destId < 100) return mapCanMove0(state, dest, slot);
  if (destId >= 100 && destId < 200) return mapCanMove1(state, dest, slot);
  if (destId >= 200 && destId < 300) return mapCanMove2(state, dest, slot);
  if (destId >= 300 && destId < 400) return mapCanMove3(state, dest, slot);
  if (destId >= 400 && destId < 500) return mapCanMove4(state, dest, slot);
  return allowed();
}
