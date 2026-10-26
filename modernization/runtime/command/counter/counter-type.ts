/**
 * COUNTER_TYPE multiplier table — ported from
 * `ERB/ステータス計算関連/COUNTER/COUNTER_TYPE.ERB` for the daily-life and
 * bounded H counter subset, with the fork's actual runtime behaviour applied.
 *
 * Mode: upstream keys the arms off `TFLAG:102` (1=daily / 2=normal H /
 * 3=partner-led insertion). The modern state derives the same three modes
 * from `isHMode` plus the canonical partner-led (`诶嘿嘿 == 2`) flag instead of reading/writing the
 * COMABLE管理 flag, which already owns id 102 for another purpose.
 *
 * Personality weights: upstream `CFLAG:ARG:誘惑/害羞/積極性/攻` are
 * `@SETTING_PERSONALITY`-derived values whose aliases the fork's CFLAG.als
 * renamed — every such term resolves to 0 at runtime, so only the TALENT
 * corrections (恋慕/思慕/処女/無知/風騷 …) survive. Those are ported here;
 * restoring the full personality derivation is a separate slice.
 */

import type { GameState } from "../../state/index.js";
import {
  BASE_ID,
  CFLAG_ID,
  PALAM_ID,
  TALENT_ID,
  TCVAR_ID,
  palamLevel,
} from "../../state/settlement.js";
import { getTflag, TFLAG_ID } from "../../state/tflag.js";
import { isHMode } from "../h-mode.js";
import type { CounterTypeId } from "./counter-actions.js";

export type CounterMode = 1 | 2 | 3;

/** Upstream `TFLAG:102` semantics, derived from modern state. */
export function resolveCounterMode(state: Readonly<GameState>, target: number): CounterMode {
  if (!isHMode(state, target)) return 1;
  if (
    (state.master.state.CFLAG[CFLAG_ID.诶嘿嘿] ?? 0) === 2 ||
    (state.charas[target]?.state.CFLAG[CFLAG_ID.诶嘿嘿] ?? 0) === 2
  ) return 3;
  return 2;
}

const talent = (state: Readonly<GameState>, target: number, id: number): number =>
  state.charas[target]?.state.TALENT[id] ?? 0;

const palam = (state: Readonly<GameState>, target: number, id: number): number =>
  state.charas[target]?.state.PALAM[id] ?? 0;

function requestMultiplier(state: Readonly<GameState>, target: number): number {
  const desireLevel = palamLevel(palam(state, target, PALAM_ID.欲情), 10);
  if (desireLevel <= 3) return 0;

  let perLevel = 12;
  if (talent(state, target, TALENT_ID.風騷) !== 0) perLevel += 5;
  if (talent(state, target, TALENT_ID.炮友) !== 0) perLevel += 5;
  if (talent(state, target, TALENT_ID.自尊心) > 0) perLevel -= 3;
  if (talent(state, target, TALENT_ID.羞恥心) < 0) perLevel += 3;
  if (talent(state, target, TALENT_ID.性的兴趣) > 0) perLevel += 3;
  if (talent(state, target, TALENT_ID.一線越えない) !== 0) perLevel -= 5;
  if (talent(state, target, TALENT_ID.自制心) !== 0) perLevel -= 3;
  if (talent(state, target, TALENT_ID.羞恥心) > 0) perLevel -= 3;

  const targetState = state.charas[target]?.state;
  if ((targetState?.TCVAR[TCVAR_ID.媚薬] ?? 0) !== 0) perLevel += 2;
  if ((targetState?.TCVAR[TCVAR_ID.発情] ?? 0) !== 0) perLevel += 2;
  if (talent(state, target, TALENT_ID.処女) !== 0) {
    perLevel -= 7;
    if (talent(state, target, TALENT_ID.貞操) > 0) perLevel -= 5;
  }

  const value = desireLevel * Math.max(perLevel, 1);
  if (
    talent(state, target, TALENT_ID.無知) !== 0 &&
    talent(state, target, TALENT_ID.風騷) === 0 &&
    talent(state, target, TALENT_ID.処女) !== 0
  ) return 0;
  return Math.max(value, 0);
}

function serviceMultiplier(state: Readonly<GameState>, target: number): number {
  if (resolveCounterMode(state, target) !== 3 || getTflag(state, TFLAG_ID.抱住模式) !== 0) {
    return 0;
  }

  const targetState = state.charas[target]?.state;
  if (!targetState) return 0;

  // COUNTER_TYPE.ERB's 脱衣愛撫 arm. The fork has not materialised the
  // upstream CFLAG personality cache (攻/積極性), so those two terms remain
  // deliberately zero; all canonical BASE/TALENT corrections are retained.
  let value = 80;
  const emotion = targetState.BASE[BASE_ID.情緒] ?? 0;
  const reason = targetState.BASE[BASE_ID.理性] ?? 0;
  if (emotion > 900) value += 10;
  else if (emotion > 500) value += 5;
  if (reason <= 0) value += 15;
  else if (reason <= 500) value += 10;

  if (talent(state, target, TALENT_ID.風騷) !== 0) value += 5;
  if (talent(state, target, TALENT_ID.性的兴趣) > 0) value += 3;
  if (talent(state, target, TALENT_ID.貞操) < 0) value += 3;
  if (talent(state, target, TALENT_ID.羞恥心) < 0) value += 3;
  if (talent(state, target, TALENT_ID.献身的) !== 0) value += 3;
  if (talent(state, target, TALENT_ID.自制心) !== 0) value -= 3;
  if (talent(state, target, TALENT_ID.性的兴趣) < 0) value -= 5;
  if (talent(state, target, TALENT_ID.一線越えない) !== 0) value -= 5;
  if (talent(state, target, TALENT_ID.貞操) > 0) value -= 5;
  if (talent(state, target, TALENT_ID.羞恥心) > 0) value -= 3;
  return Math.max(value, 0);
}

function coercionMultiplier(state: Readonly<GameState>, target: number): number {
  let value = serviceMultiplier(state, target);
  if (value === 0) return 0;

  // COUNTER_TYPE.ERB:65-103 — 脱衣強要 starts from 脱衣愛撫 and adds
  // coercion-specific talent corrections. The fork still has no materialised
  // CFLAG personality cache, so the two CFLAG terms remain deliberately zero.
  if (talent(state, target, TALENT_ID.風騷) !== 0) value += 5;
  if (talent(state, target, TALENT_ID.施虐狂) !== 0) value += 2;
  if (talent(state, target, TALENT_ID.淫乱) !== 0) value += 5;
  if (talent(state, target, TALENT_ID.自尊心) > 0) value += 3;
  if (talent(state, target, TALENT_ID.羞恥心) < 0) value += 3;
  if (talent(state, target, TALENT_ID.性的兴趣) > 0) value += 3;
  if (talent(state, target, TALENT_ID.献身的) !== 0) value -= 3;
  if (talent(state, target, TALENT_ID.一線越えない) !== 0) value -= 5;
  if (talent(state, target, TALENT_ID.自制心) !== 0) value -= 3;
  if (talent(state, target, TALENT_ID.羞恥心) > 0) value -= 3;
  if (talent(state, target, TALENT_ID.応答) < 0) value -= 3;
  if (talent(state, target, TALENT_ID.胆量) < 0) value -= 3;

  const masterGender = state.master.state.TALENT[TALENT_ID.性別] ?? 0;
  const targetGender = talent(state, target, TALENT_ID.性別);
  if ((masterGender & 1) !== 0 && (targetGender & 1) !== 0) {
    value = Math.trunc(value * ((targetGender & 2) !== 0 ? 3 : 2) / 5);
  }
  return Math.max(value, 0);
}

function sexualMultiplier(state: Readonly<GameState>, target: number): number {
  if (resolveCounterMode(state, target) !== 3 || getTflag(state, TFLAG_ID.抱住模式) !== 0) {
    return 0;
  }

  const targetState = state.charas[target]?.state;
  if (!targetState) return 0;

  // COUNTER_TYPE.ERB's 性交/責め arm starts from 脱衣愛撫. The old
  // personality cache (CFLAG:誘惑/害羞/積極性/攻) is not materialised in the
  // modern state, so only canonical TALENT corrections are applied here.
  let value = serviceMultiplier(state, target);
  if (value === 0) return 0;
  if (talent(state, target, TALENT_ID.風騷) !== 0) value += 5;
  if (talent(state, target, TALENT_ID.炮友) !== 0) value += 5;
  if (
    talent(state, target, TALENT_ID.献身的) !== 0 &&
    talent(state, target, TALENT_ID.恋慕) !== 0
  ) value += 3;
  if (talent(state, target, TALENT_ID.恋慕) !== 0) {
    value += talent(state, target, TALENT_ID.恋人) !== 0 ? 5 : 3;
  }
  if (talent(state, target, TALENT_ID.一線越えない) !== 0) value -= 5;
  if (talent(state, target, TALENT_ID.自制心) !== 0) value -= 3;
  if ((state.master.state.TALENT[TALENT_ID.処女] ?? 0) !== 0) value -= 5;
  if (
    talent(state, target, TALENT_ID.処女) !== 0 &&
    talent(state, target, TALENT_ID.恋慕) === 0 &&
    talent(state, target, TALENT_ID.風騷) === 0
  ) return 0;
  if (talent(state, target, TALENT_ID.無知) !== 0 && talent(state, target, TALENT_ID.風騷) === 0) {
    return 0;
  }
  return Math.max(value, 0);
}

/**
 * Mode-gated multiplier for one counter type. Daily-life types return 0
 * outside mode 1 (their actions cannot fire mid-H); contact/insertion types
 * are mode 2/3 only. This slice restores the deterministic おねだり,
 * 脱衣愛撫, 脱衣強迫, and 性交/責め arms; 着衣/挿入中/抱きつき remain
 * closed until their individual body/gate pairs are ported.
 */
export function counterTypeMultiplier(
  type: CounterTypeId,
  state: Readonly<GameState>,
  target: number,
): number {
  const mode = resolveCounterMode(state, target);
  const loves = talent(state, target, TALENT_ID.恋慕) !== 0;
  const yearns = talent(state, target, TALENT_ID.思慕) !== 0;
  switch (type) {
    case "コミュ":
      // COUNTER_TYPE.ERB:17-19 — daily conversation; H-gate off.
      return mode === 1 ? 100 : 0;
    case "ベリーソフト":
      // COUNTER_TYPE.ERB:11-16 — daily; halved without 恋慕/思慕.
      if (mode !== 1) return 0;
      return !loves && !yearns ? 50 : 100;
    case "ソフト":
      // COUNTER_TYPE.ERB:8-10 — daily, requires 亲热 >= 2 (TCVAR, unmodelled
      // in the S1 gate set; the multiplier stays faithful to the mode gate).
      return mode === 1 ? 100 : 0;
    // Mode 2/3 families — actions land with the contact-slice table.
    case "着衣":
    case "挿入中":
    case "抱きつき":
      return 0;
    case "脱衣爱抚":
      return serviceMultiplier(state, target);
    case "脱衣强迫":
      return coercionMultiplier(state, target);
    case "性交":
    case "責め":
      return sexualMultiplier(state, target);
    case "おねだり":
      if (mode !== 3 || getTflag(state, TFLAG_ID.抱住模式) !== 0) return 0;
      return requestMultiplier(state, target);
  }
}
