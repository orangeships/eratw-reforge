/**
 * Phase C (实玩反馈 #3) — 察知 (sensing) map overlays.
 *
 * Faithful port of `@GETMAP`'s 居場所察知 / 汚部屋察知 per-room coloring
 * (`DRAW_MAP.ERB:133-287` + helpers `@CHECK_HEHAI` / `@SET_KEHAI_COLOR`).
 * Two overlay modes, selected by `FLAG:察知模式`:
 *   mode 1 居場所察知 (presence) — always available for the current map
 *   mode 2 汚部屋察知 (dirt)     — `TALENT:汚部屋察知` (Talent.csv 160) | 千里眼
 *
 * The color constants are the DIM.ERH `C_*` values (`DIM.ERH:571-604`).
 *
 * **Scope (this slice).** 察知 overlays ONLY. The timestop color inversion
 * (`@APPLYCOLOR_F`, `FLAG:70` → `COLOR ^ 0xFFFFFF`, `DRAW_COLOREDMAP.ERB:360`)
 * is intentionally NOT modeled here (per user: 察知 first, 时停 later).
 *
 * **Deferred (documented, not fabricated):**
 *   - 場所_路人 pink fallback (`DRAW_MAP.ERB:137`) — `場所_路人` isn't in
 *     `place-flags-data`, so passer-by rooms get no default tint.
 *   - winter-outdoor 積雪量 snow ladder (dirt mode, `DRAW_MAP.ERB:164-180`) —
 *     needs a per-room `OUTROOF`; the MVP renders the standard cleanliness
 *     ladder for every room.
 *   - SHOP-preview orange (默认初期位置/大家候補, `DRAW_MAP.ERB:205-208`) —
 *     belongs to residence selection (#13).
 *
 * No upstream file mutation. No LLM. See `CLAUDE.md`.
 */

import { CFLAG_ID, TALENT_ID } from "../state/settlement.js";
import { getYogore, cleanlinessLabel } from "../state/yogore.js";
import type { CharaSlot, GameState } from "../state/game-state.js";

// ---------------------------------------------------------------------------
// 察知模式 (FLAG:察知模式) — overlay mode selector.
// ---------------------------------------------------------------------------

export const DETECTION_OFF = 0;
export const DETECTION_PRESENCE = 1;
export const DETECTION_DIRT = 2;
export type DetectionMode = 0 | 1 | 2;

/** Cycle the mode 0 → 1 → 2 → 0 (qol_MAP.ERB:268). */
export function nextDetectionMode(mode: DetectionMode): DetectionMode {
  return ((mode >= 2 ? 0 : mode + 1) as DetectionMode);
}

// ---------------------------------------------------------------------------
// DIM.ERH color constants (DIM.ERH:571-604) used by the overlays.
// ---------------------------------------------------------------------------

const C_GREEN = "#00ff00";
const C_M_GREEN = "#00fa9a";
const C_P_GREEN = "#70c070";
const C_YELLOW = "#ffff00";
const C_D_ORANGE = "#ff6400";
const C_RED = "#ff0000";
const C_N_BLUE = "#0078b4";
const C_H_PINK = "#ff69b4";
const C_V_PINK = "#ff00ff";
// const C_D_PINK = "#990099"; // 場所_路人 fallback (deferred)

// ---------------------------------------------------------------------------
// Current-map presence is always available. Dirt sensing remains talent-gated.
// ---------------------------------------------------------------------------

export function canSensePresence(_state: GameState): boolean {
  return true;
}
export function canSenseDirt(state: GameState): boolean {
  return (state.master.state.TALENT[TALENT_ID.汚部屋察知] ?? 0) !== 0;
}

// ---------------------------------------------------------------------------
// 居場所察知 — presence (@CHECK_HEHAI / @SET_KEHAI_COLOR, DRAW_MAP.ERB:314-350)
// ---------------------------------------------------------------------------

/** KEHAI — what a sensed character is doing (`@CHECK_HEHAI`). */
export type Kehai = 0 | 1 | 2 | 3 | 4;

/**
 * `@CHECK_HEHAI(ARG)` (DRAW_MAP.ERB:314-330): 仕事中(2) → 睡眠中(3) →
 * 自由行動中(4) → 何もしてない(1), in that precedence.
 */
export function checkHehai(slot: CharaSlot, state?: GameState): Kehai {
  const cf = slot.state.CFLAG;
  if ((cf[CFLAG_ID.行动] ?? 0) === 5) return 2; // 仕事中
  if ((cf[CFLAG_ID.睡眠] ?? 0) !== 0) return 3; // 睡眠中
  if ((state?.freeActions?.[slot.charaNum]?.remainingMinutes ?? 0) > 0) return 4;
  return 1; // 何もしてない
}

/** `@SET_KEHAI_COLOR` (DRAW_MAP.ERB:335-350). 0 = no character → no color. */
const KEHAI_COLOR: Record<Kehai, string | null> = {
  0: null,
  1: C_H_PINK, // 何もしてない＠粉色
  2: C_D_ORANGE, // 仕事中＠濃オレンジ
  3: C_N_BLUE, // 睡眠中＠紺色
  4: C_YELLOW, // 自由行動中＠黄色
};

/** Title suffix per KEHAI (DRAW_MAP.ERB:271-282). */
const KEHAI_LABEL: Record<Kehai, string> = {
  0: "",
  1: "什么都没在做",
  2: "工作中",
  3: "睡眠中",
  4: "自由行动中",
};

// ---------------------------------------------------------------------------
// Overlay results
// ---------------------------------------------------------------------------

export interface DetectionCell {
  /** Overlay color (hex) for the room cell, or `""` to keep the base color. */
  color: string;
  /** Tooltip lines for the room (\n-joined), faithful to `LOCAL_TITLE`. */
  title: string;
}

/** Present NPCs in a room, in ascending charaNum order (stable). */
function npcsAt(state: GameState, location: string): CharaSlot[] {
  return Object.keys(state.charas)
    .map(Number)
    .sort((a, b) => a - b)
    .map((n) => state.charas[n]!)
    .filter((slot) => slot.location === location);
}

function charaName(slot: CharaSlot): string {
  return slot.callName ?? `#${slot.charaNum}`;
}

/**
 * 居場所察知 overlay for one room (DRAW_MAP.ERB:133-161 color + 250-287 title).
 *
 * Color precedence: the first sensed character with KEHAI > 1 (仕事/睡眠/
 * 自由行動) wins; otherwise the idle pink if anyone's home; finally MASTER's
 * own room is forced green (`DRAW_MAP.ERB:202`, top priority). Title lists
 * every present character + activity, or "谁都不在" when empty.
 */
export function presenceOverlay(state: GameState, location: string): DetectionCell {
  const npcs = npcsAt(state, location);

  // Color: walk in chara order, break on the first KEHAI>1 (DRAW_MAP.ERB:141-160).
  let kehai: Kehai = 0;
  for (const slot of npcs) {
    kehai = checkHehai(slot, state);
    if (kehai > 1) break;
  }
  let color = KEHAI_COLOR[kehai] ?? "";

  // MASTER is highest priority (DRAW_MAP.ERB:202).
  if (state.master.location === location) color = C_GREEN;

  // Title: every present character + their activity (DRAW_MAP.ERB:250-287).
  const lines = npcs.map((slot) => `${charaName(slot)} ${KEHAI_LABEL[checkHehai(slot, state)]}`);
  const title = lines.length > 0 ? lines.join("\n") : "谁都不在";

  return { color, title };
}

// ---------------------------------------------------------------------------
// 汚部屋察知 — dirt (DRAW_MAP.ERB:163-198 color + 213-248 title)
// ---------------------------------------------------------------------------

/**
 * The dirt-ladder cell color (`DRAW_MAP.ERB:182-197`, standard non-winter
 * branch). Higher YOGORE → dirtier → warmer color:
 *   < 100 绿 / < 500 中绿 / < 1000 浅绿 / < 2000 黄 / < 3500 品红 / else 红
 */
export function dirtColor(yogore: number): string {
  if (yogore < 100) return C_GREEN;
  if (yogore < 500) return C_M_GREEN;
  if (yogore < 1000) return C_P_GREEN;
  if (yogore < 2000) return C_YELLOW;
  if (yogore < 3500) return C_V_PINK;
  return C_RED; // < 5000 and CASEELSE both C_RED
}

/**
 * 汚部屋察知 overlay for one room. Colors by `YOGORE:<location>` (reuses
 * `yogore.ts`); title is the "清洁度:XX" label. MASTER's room is forced green
 * (DRAW_MAP.ERB:202), faithful even in dirt mode.
 */
export function dirtOverlay(state: GameState, location: string): DetectionCell {
  const y = getYogore(state, location);
  let color = dirtColor(y);
  if (state.master.location === location) color = C_GREEN;
  return { color, title: `清洁度:${cleanlinessLabel(y)}` };
}

// ---------------------------------------------------------------------------
// Combined entry point
// ---------------------------------------------------------------------------

/**
 * The active 察知 overlay for a room, or `null` when sensing is off or the
 * master lacks the relevant dirt-sensing talent. Presence is always available.
 */
export function detectionOverlay(
  state: GameState,
  location: string,
  mode: DetectionMode,
): DetectionCell | null {
  if (mode === DETECTION_PRESENCE && canSensePresence(state)) {
    return presenceOverlay(state, location);
  }
  if (mode === DETECTION_DIRT && canSenseDirt(state)) {
    return dirtOverlay(state, location);
  }
  return null;
}
