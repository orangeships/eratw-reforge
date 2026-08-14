/**
 * Chara stat-tweak harness for the in-game 调试面板
 * (`web/app/game/KojoDebugPopup.tsx`) — lets a creator nudge the five common
 * relationship stats (信頼度/好感度/親密/従順/欲望) on any chara at any 阶段, to
 * check dialogue / training reactions without playing there naturally.
 *
 * Kept in the runtime layer + exposing only these fields so the UI never
 * touches the raw CFLAG/ABL namespaces (the forbidden-names guard).
 */

import type { GameState } from "../state/game-state.js";
import {
  ABL_ID,
  CFLAG_ID,
  TALENT_ID,
  getCharaAbl,
  getCharaCflag,
  getMasterAbl,
  getMasterTalent,
  setCharaAbl,
  setCharaCflag,
  setMasterAbl,
  setMasterTalent,
} from "../state/settlement.js";

/** The five relationship stats the panel exposes. */
export interface CharaGates {
  /** CFLAG:信頼度 (trust). */
  信頼度: number;
  /** CFLAG:好感度 (favor). */
  好感度: number;
  /** ABL:親密 (intimacy). */
  親密: number;
  /** ABL:従順 (obedience). */
  従順: number;
  /** ABL:欲望 (desire). */
  欲望: number;
}

/** Explicit, non-progression presets for exercising authored dialogue tiers. */

export function readCharaGates(state: GameState, charaNum: number): CharaGates {
  return {
    信頼度: getCharaCflag(state, charaNum, CFLAG_ID.信頼度),
    好感度: getCharaCflag(state, charaNum, CFLAG_ID.好感度),
    親密: getCharaAbl(state, charaNum, ABL_ID.親密),
    従順: getCharaAbl(state, charaNum, ABL_ID.従順),
    欲望: getCharaAbl(state, charaNum, ABL_ID.欲望),
  };
}

/** Mutate the given stats in place (only the keys present in `patch`). */
export function patchCharaGates(
  state: GameState,
  charaNum: number,
  patch: Partial<CharaGates>,
): void {
  if (patch.信頼度 !== undefined) setCharaCflag(state, charaNum, CFLAG_ID.信頼度, patch.信頼度);
  if (patch.好感度 !== undefined) setCharaCflag(state, charaNum, CFLAG_ID.好感度, patch.好感度);
  if (patch.親密 !== undefined) setCharaAbl(state, charaNum, ABL_ID.親密, patch.親密);
  if (patch.従順 !== undefined) setCharaAbl(state, charaNum, ABL_ID.従順, patch.従順);
  if (patch.欲望 !== undefined) setCharaAbl(state, charaNum, ABL_ID.欲望, patch.欲望);
}

/** Master-only daily capabilities exposed by the in-game debug popup. */
export const MASTER_DEBUG_ABILITY_FIELDS = [
  { key: "清扫技能", id: ABL_ID.清扫技能, namespace: "abl" },
  { key: "话术技能", id: ABL_ID.話術技能, namespace: "abl" },
  { key: "战斗能力", id: ABL_ID.战斗能力, namespace: "abl" },
  { key: "教养", id: ABL_ID.教養, namespace: "abl" },
  { key: "料理技能", id: ABL_ID.料理技能, namespace: "abl" },
  { key: "音乐技能", id: ABL_ID.音楽技能, namespace: "abl" },
  { key: "采集Lv", id: TALENT_ID.採集Lv, namespace: "talent" },
] as const;

export type MasterDebugAbilityKey = (typeof MASTER_DEBUG_ABILITY_FIELDS)[number]["key"];
export type MasterDebugAbilities = Record<MasterDebugAbilityKey, number>;

const MASTER_DEBUG_ABILITY_MIN = 0;
const MASTER_DEBUG_ABILITY_MAX = 5;

/** Read only the master abilities intentionally exposed to in-game debug. */
export function readMasterDebugAbilities(state: GameState): MasterDebugAbilities {
  return Object.fromEntries(
    MASTER_DEBUG_ABILITY_FIELDS.map((field) => [
      field.key,
      field.namespace === "abl" ? getMasterAbl(state, field.id) : getMasterTalent(state, field.id),
    ]),
  ) as MasterDebugAbilities;
}

/** Patch only supported master abilities and clamp them to the gameplay range. */
export function patchMasterDebugAbilities(
  state: GameState,
  patch: Partial<MasterDebugAbilities>,
): void {
  for (const field of MASTER_DEBUG_ABILITY_FIELDS) {
    const value = patch[field.key];
    if (value === undefined || !Number.isFinite(value)) continue;
    const normalized = Math.max(
      MASTER_DEBUG_ABILITY_MIN,
      Math.min(MASTER_DEBUG_ABILITY_MAX, Math.trunc(value)),
    );
    if (field.namespace === "abl") setMasterAbl(state, field.id, normalized);
    else setMasterTalent(state, field.id, normalized);
  }
}
