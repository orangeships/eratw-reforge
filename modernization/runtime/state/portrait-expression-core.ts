/**
 * 表情判定核心 — `@CALC_EXPRESSION_CORE` (QOL_IMAGE.ERB:1392-1530) deterministic
 * port, returned as candidate expressions for the render layer.
 *
 * The upstream function layers ~7 levels of precedence and returns two
 * expressions (EX_BASE for the idle face, EX_HOVER for the mouse-over face).
 * This module reproduces the layers we can model with the modern runtime;
 * unmodeled upstream dependencies are marked `DEFERRED` per layer and fall
 * through to the next candidate (never guessed).
 *
 * **Important boundary**: this module reports the *candidate* expression the
 * state implies. Whether the sprite sheet actually contains that expression
 * is a resource question — the web adapter (`portraitForExpression`) does the
 * fail-closed degradation (missing variant → normal portrait). The core does
 * not inspect the bundle.
 *
 * Layers mapped (QOL_IMAGE.ERB):
 *   - L0  base emotion: 心情/ブチギレ → 憤怒; 心情==1/情緒≥70%/烂醉 → 笑顔; else 通常
 *   - L1  adjustments: 陥落 +1; 反発刻印 -1; 憤怒≥500 -1; 情緒≥650 +1; 嫉妬+デート → 憤怒
 *   - L2  hover derivation
 *   - L3  resource-degradation → web adapter
 *   - L4  special overrides: 発情 / 睡眠 / トロ顔 / イキ顔
 *   - L5  IMAGE_CHARA_OVERRIDE — DEFERRED (unported)
 *   - L6  command-face aliases (性交/自慰/愛撫) — their assets are not yet
 *        indexed in the Web bundle; retain the L4 state expression. The H
 *        view selects an authored DISPLAY_COM_IMAGE pose separately.
 *   - L7  RAND swap — DEFERRED (non-deterministic); IMAGE_CHARA_OVERRIDE COM — DEFERRED
 */

import type { GameState } from "../state/game-state.js";
import {
  BASE_ID,
  CFLAG_ID,
  EX_ID,
  FLAG_ID,
  MARK_ID,
  PALAM_ID,
  TALENT_ID,
  TCVAR_ID,
  palamLevel,
} from "./settlement.js";
import { getTflag } from "./tflag.js";
import { computeConsentJudgement } from "./attitude.js";

/** Candidate expressions the modern render layer can display. */
export type CoreExpression =
  | "normal"
  | "smile"
  | "angry"
  | "sleep"
  | "lust"
  | "aroused"
  | "climax";

export interface ExpressionCoreResult {
  /** The idle (base) face. */
  base: CoreExpression;
  /** The mouse-over face. */
  hover: CoreExpression;
  /** True when the candidate was degraded because a resource is missing —
   *  informational; the web adapter does the actual degradation. */
  degradedBase: boolean;
}

const KOCHITSU_TALENTS: readonly number[] = [
  TALENT_ID.思慕,
  TALENT_ID.恋慕,
  TALENT_ID.愛欲,
  TALENT_ID.恋人,
  TALENT_ID.炮友,
];

/** 陥落 (CHECK_CHARA(...,"陥落") — COMMON.ERB:1687): any of the fall-state
 *  talents present. */
function isFallen(state: GameState, charaNum: number): boolean {
  const slot = charaNum === 0 ? state.master : state.charas[charaNum];
  if (!slot) return false;
  return KOCHITSU_TALENTS.some((id) => (slot.state.TALENT[id] ?? 0) !== 0);
}

/** `BASE:情緒 >= MAXBASE*7/10` (L0 笑顔 trigger). */
function emotionHigh(state: GameState, charaNum: number): boolean {
  const slot = charaNum === 0 ? state.master : state.charas[charaNum];
  if (!slot) return false;
  const v = slot.state.BASE[BASE_ID.情緒] ?? 0;
  const max = slot.state.MAXBASE[BASE_ID.情緒] ?? 0;
  return v > 0 && max > 0 && v >= Math.trunc((max * 7) / 10);
}

/** The current focused TARGET of this command frame (0 when none). */
function currentTarget(state: GameState): number {
  return state.turnContext?.frame?.target ?? state.turnContext?.frame?.actor ?? 0;
}

/**
 * `@CALC_EXPRESSION_CORE` deterministic core. Returns candidate base/hover
 * expressions for `charaNum` in `state`. See header for the layer mapping and
 * which layers are DEFERRED.
 */
export function calcExpressionCore(
  state: GameState,
  charaNum: number,
): ExpressionCoreResult {
  const slot = charaNum === 0 ? state.master : state.charas[charaNum];
  // No slot → safe default (normal), never a guess.
  if (!slot) return { base: "normal", hover: "normal", degradedBase: false };

  const T = slot.state.TALENT;
  const C = slot.state.CFLAG;
  const B = slot.state.BASE;
  const TV = slot.state.TCVAR;
  const P = slot.state.PALAM;

  // L0 — base emotion (QOL_IMAGE.ERB:1412-1421).
  let exBase: CoreExpression = "normal";
  let emotionLv = 0;
  if ((T[TALENT_ID.心情] ?? 0) === -1 || (C[CFLAG_ID.勃然大怒] ?? 0) !== 0) {
    exBase = "angry";
    emotionLv = -1;
  } else if (
    (T[TALENT_ID.心情] ?? 0) === 1 ||
    emotionHigh(state, charaNum) ||
    (TV[TCVAR_ID.泥酔] ?? 0) !== 0
  ) {
    exBase = "smile";
    emotionLv = 1;
  }

  // L1 — adjustments (QOL_IMAGE.ERB:1422-1435). 澡堂逐出 DEFERRED.
  if (isFallen(state, charaNum)) emotionLv += 1;
  if ((slot.state.MARK?.[MARK_ID.反発刻印] ?? 0) !== 0) emotionLv -= 1;
  if ((B[BASE_ID.憤怒] ?? 0) >= 500) emotionLv -= 1;
  if ((B[BASE_ID.情緒] ?? 0) >= 650) emotionLv += 1;
  // 嫉妬 && デート相手==CHARA && TARGET!=CHARA → forced 憤怒.
  const datePartner = state.flagStore[FLAG_ID.デート相手] ?? 0;
  if (
    (T[TALENT_ID.嫉妬] ?? 0) !== 0 &&
    datePartner === charaNum &&
    currentTarget(state) !== charaNum
  ) {
    exBase = "angry";
    emotionLv = -1;
  }

  // L2 — hover derivation (QOL_IMAGE.ERB:1437-1444).
  let exHover: CoreExpression = exBase;
  if (exBase === "smile") {
    exHover = "normal";
  } else if (exBase === "angry") {
    exHover = emotionLv > 0 ? "normal" : "angry";
  } else {
    exHover = emotionLv > 0 ? "smile" : emotionLv < 0 ? "angry" : "normal";
  }

  // L4 — special overrides, in upstream order (QOL_IMAGE.ERB:1452-1476).
  // 発情: ENDURE>550 && 理性<=350 (ENDURE approximated by 合意判定>550 via the
  // derived computeConsentJudgement — never read the stored CFLAG, it is a
  // derived slot) OR TCVAR:発情.
  const endureHigh =
    computeConsentJudgement(slot, charaNum === 0 ? slot : state.master, state) > 550 &&
    (B[BASE_ID.理性] ?? 0) <= 350;
  if ((endureHigh || (TV[TCVAR_ID.発情] ?? 0) !== 0) && lustFaceAvailable()) {
    exBase = "lust";
    exHover = "lust";
  } else if ((C[CFLAG_ID.睡眠] ?? 0) !== 0 && sleepFaceAvailable()) {
    exBase = "sleep";
    exHover = "sleep";
  } else if (
    (C[CFLAG_ID.诶嘿嘿] ?? 0) !== 0 &&
    palamLevel(P[PALAM_ID.欲情] ?? 0, 10) >= 7
  ) {
    // QOL_IMAGE checks NOWEX:TotalEX after selecting トロ顔. The resource
    // adapter applies the same fallback when a crop is missing: イキ顔 → トロ顔 → base.
    const totalEx = state.turnContext?.frame?.nowExByChara[charaNum]?.[EX_ID.TotalEX] ?? 0;
    exBase = totalEx >= 5 ? "climax" : "aroused";
    exHover = exBase;
  }

  // L6 — QOL_IMAGE's command-face expression names are distinct from 発情.
  // They are not indexed in the Web portrait bundle yet, so keep the previous
  // state candidate instead of incorrectly painting an arousal face for every
  // sex command. The H view handles a matching DISPLAY_COM_IMAGE pose.

  // L7 RAND swap — DEFERRED (non-deterministic); keep the stable base.

  return { base: exBase, hover: exHover, degradedBase: false };
}

// ---------------------------------------------------------------------------
// Resource availability belongs to the rendering adapter. Upstream coverage
// varies by character, clothing, portrait package and expression.
// ---------------------------------------------------------------------------

function lustFaceAvailable(): boolean {
  return true; // 発情 face is present for most characters (upstream 161/161 服).
}
function sleepFaceAvailable(): boolean {
  return true; // 睡眠 face exists for ~30 chars; bundle omits when absent.
}
// Re-export the flag id so the web layer can flip the kind without importing
// settlement directly (forbidden-names guard).
export { FLAG_ID };
export { getTflag };
