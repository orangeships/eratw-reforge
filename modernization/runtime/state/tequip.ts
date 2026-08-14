/**
 * TEQUIP — per-chara equipment state API (`Tequip.csv`).
 *
 * TEQUIP is the character-bound equipment namespace, parallel to `EQUIP`
 * (clothes: worn piece per slot). Toggleable equipment — 调教道具 (陰蒂夾 11 …
 * 口球 20, 拘束 25), PLAY 模式 (野外PLAY 29 … 圍裙 34), 避孕套 (35), 継続接吻 (45) —
 * lives here as 0/1 flags on `chara.state.TEQUIP`, exactly like a worn
 * garment lives on `chara.state.EQUIP`. Value 0/absent = not equipped.
 *
 * **Never store these ids in `state.EQUIP`.** EQUIP slots 11–22 are the
 * clothing pieces (裤子=11 / 下身衣服=12 / 連衣裙=13 / 和服=14 / 裙子=15 /
 * 上身衣服２=16 / 上身衣服１=17 / 外搭=18 / 其他１=19 / 其他２=20 / 其他３=21 /
 * 腕部装束=22) — writing a TEQUIP id into EQUIP corrupts the outfit. This
 * module is the single typed gateway for equipment state (mirrors the
 * `clothing-write.ts` accessor pair `getEquip`/`setEquip`).
 *
 * Not covered here: the exposure bitmasks `TEQUIP:0/1` and the half-undress /
 * top-stripped flags `3/5` (managed by `clothing-write.ts`), and the
 * intercourse / contact-history ids `50/51` + `101-120` (managed by H-command
 * code). This API is for the 0/1 toggleable equipment slots.
 */
import type { GameState, CharaSlot } from "./game-state.js";
import { cloneGameState } from "./game-state.js";
import { TEQUIP_ID } from "./settlement.js";

/** The toggleable equipment TEQUIP ids this API manages. */
export const EQUIPMENT_IDS: readonly number[] = [
  // 调教道具 (Tequip.csv 11-20, 25)
  TEQUIP_ID.陰蒂夾,
  TEQUIP_ID.飛機杯,
  TEQUIP_ID.振動棒,
  TEQUIP_ID.肛用振動棒,
  TEQUIP_ID.後庭拉珠,
  TEQUIP_ID.乳頭夾,
  TEQUIP_ID.搾乳機,
  TEQUIP_ID.眼罩,
  TEQUIP_ID.縄,
  TEQUIP_ID.口球,
  TEQUIP_ID.拘束,
  // PLAY 模式 (Tequip.csv 29-34; 浴室/羞耻/野外/新妻 + 圍裙)
  TEQUIP_ID.野外PLAY,
  TEQUIP_ID.羞耻PLAY,
  TEQUIP_ID.浴室PLAY,
  TEQUIP_ID.新妻PLAY,
  TEQUIP_ID.圍裙,
  // 避孕套 (35) / 継続接吻 (45)
  TEQUIP_ID.避孕套,
  TEQUIP_ID.継続接吻,
];

/** Read a TEQUIP value while preserving the distinction between absent and 0. */
export function readTequipOptional(chara: CharaSlot, id: number): number | undefined {
  const bag = chara.state.TEQUIP;
  if (!bag || typeof bag !== "object" || Array.isArray(bag)) return undefined;
  const value = bag[id];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Return a TEQUIP value with the ordinary ERA flag default (0).
 *
 * `CharaSlotState.TEQUIP` is required for new-game states, but adapters,
 * imported saves, and small test fixtures can still omit it. Most flags use
 * 0 for an absent value; callers such as `IS_SEXING` can use
 * `readTequipOptional` when an explicit 0 has different meaning.
 */
export function readTequip(chara: CharaSlot, id: number): number {
  return readTequipOptional(chara, id) ?? 0;
}

/** Ensure a mutable TEQUIP bag exists before a runtime write. */
export function ensureTequipState(chara: CharaSlot): Record<number, number> {
  const bag = chara.state.TEQUIP;
  if (bag && typeof bag === "object" && !Array.isArray(bag)) return bag;
  const next: Record<number, number> = {};
  chara.state.TEQUIP = next;
  return next;
}

/** Write one TEQUIP value while preserving the namespace boundary. */
export function writeTequip(chara: CharaSlot, id: number, value: number): void {
  ensureTequipState(chara)[id] = Number.isFinite(value) ? value : 0;
}

/** Whether the chara currently has equipment `id` equipped (`TEQUIP:id != 0`). */
export function isEquipped(chara: CharaSlot, id: number): boolean {
  return readTequip(chara, id) !== 0;
}

/** Set/clear equipment `id` in place (`TEQUIP:id = on ? 1 : 0`).
 *  Cleared slots are explicitly `0` (sparse-record convention, matching
 *  `EQUIP` strips in `clothing-write.ts`). */
export function setEquipped(chara: CharaSlot, id: number, on: boolean): void {
  writeTequip(chara, id, on ? 1 : 0);
}

/**
 * Flip equipment `id` for a chara, cloning the state (mirrors the
 * `stripBottom`/`changeClothes` pattern in `clothing-write.ts`). No-op
 * (returns the input) when the chara doesn't exist. `charaNum` 0 = master.
 */
export function toggleEquipped(
  state: GameState,
  charaNum: number,
  id: number,
): GameState {
  const next = cloneGameState(state);
  const chara = charaNum === 0 ? next.master : next.charas[charaNum];
  if (!chara) return state;
  setEquipped(chara, id, !isEquipped(chara, id));
  return next;
}
