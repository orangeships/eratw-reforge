/**
 * EVENT_COUNTER action table — daily-life plus bounded H counter actions.
 *
 * Upstream: `ERB/ステータス計算関連/COUNTER/CCOMF/CCOMF{n}_*.ERB`, one
 * three-function file per action (`@CCOMF{n}` execute / `@CCOM_ABLE{n}` gate
 * / `@CCOM_ORDER{n}` weight). Each def below transcribes those three
 * functions for the fork's actual runtime behaviour: the fork's CFLAG.als
 * renamed 誘惑/害羞/積極性 to simplified aliases that no longer match the
 * Japanese names the CCOMF files reference, so every `CFLAG:ARG:…` term in
 * the upstream weight formulas resolves to 0 — the effective weight is the
 * flat 基本値 (10) before the COUNTER_TYPE multiplier. Restoring the
 * original-era personality weights needs CFLAG 550/551/552 modelled and is
 * deferred with the remaining counter-type and personality work.
 *
 * SOURCES are transcribed verbatim (`SOURCE:ARG:<name> += n`, source.als
 * ids). The bounded insertion and service/coercion requests also project the
 * current pose/contact ring; `with-counter` sends their SOURCE through the
 * shared `SOURCE_CHECK` path.
 */

import type { GameState, CharaSlot } from "../../state/index.js";
import {
  ABL_ID,
  BASE_ID,
  CFLAG_ID,
  EQUIP_SLOT,
  EX_ID,
  EXP_ID,
  FLAG_ID,
  PALAM_ID,
  SOURCE_ID,
  STAIN_ID,
  TALENT_ID,
  TCVAR_ID,
  TEQUIP_ID,
  palamLv,
} from "../../state/settlement.js";
import { readCurrentTouchPose, setCurrentTouchRelation, TOUCH_PART } from "../../state/touch-state.js";
import { readTequip, readTequipOptional, writeTequip } from "../../state/tequip.js";
import { addTflag, getTflag, setTflag, TFLAG_ID } from "../../state/tflag.js";
import { syncHInsertionChannel, syncHInsertionState } from "../training-session.js";
import { counterTypeMultiplier } from "./counter-type.js";
import { seedCounterUndressMarkers } from "./counter-undress.js";
import type { Rng } from "../types.js";

export type CounterActionFamily = "soft" | "daily" | "contact" | "head" | "personal";

/** Upstream `COUNTER_TYPE` family names (COUNTER_TYPE.ERB SELECTCASE arms). */
export type CounterTypeId =
  | "ソフト"
  | "ベリーソフト"
  | "コミュ"
  | "着衣"
  | "脱衣爱抚"
  | "脱衣强迫"
  | "性交"
  | "責め"
  | "おねだり"
  | "挿入中"
  | "抱きつき";

export interface CounterApplyResult {
  /** `SOURCE:ARG:<id> += n` transcriptions, applied by the counter settle. */
  readonly sources?: Readonly<Record<number, number>>;
  /** `SOURCE:PLAYER:<id> += n` transcriptions, settled into MASTER's PALAM. */
  readonly masterSources?: Readonly<Record<number, number>>;
  /** Upstream `CALL TOUCH_RESET_T(ARG)` — the counter resets its own touch state. */
  readonly touchReset?: boolean;
}

export interface CounterActionDef {
  /** Upstream CCOM id — also the `EVENT_COUNTER_MESSAGE{n}` / TCVAR:20 key. */
  readonly id: number;
  readonly label: string;
  readonly family: CounterActionFamily;
  readonly counterType: CounterTypeId;
  /** Upstream `@CCOM_ABLE{n}`; absent ⇒ always able (the upstream default). */
  readonly able?: (state: Readonly<GameState>, target: number) => boolean;
  /**
   * Upstream `@CCOM_ORDER{n}` weight with the fork's dead CFLAG terms
   * dropped: constant 基本値 (10). The type multiplier joins in S2.
   */
  readonly weight: (state: Readonly<GameState>, target: number) => number;
  /** Upstream `@CCOMF{n}` body — SOURCE deltas (+ touch reset in S2). */
  readonly apply: (state: GameState, target: number, rng?: Rng) => CounterApplyResult;
}

/** Flat 基本値 weight — see the file header for the fork-behaviour rationale. */
const BASE_WEIGHT = 10;

/** CCOM_ORDER weight = 基本値 × COUNTER_TYPE multiplier (deterministic). */
function orderWeight(
  counterType: CounterTypeId,
  state: Readonly<GameState>,
  target: number,
): number {
  return BASE_WEIGHT * counterTypeMultiplier(counterType, state, target);
}

/** Upstream  SOURCE deltas, transcribed verbatim (source.als ids). */
function dailyAction(
  id: number,
  label: string,
  family: CounterActionFamily,
  counterType: CounterTypeId,
  sources: Readonly<Record<number, number>>,
): CounterActionDef {
  return {
    id,
    label,
    family,
    counterType,
    weight: (state, target) => orderWeight(counterType, state, target),
    apply: () => ({ sources }),
  };
}

const insertionSources: Readonly<Record<number, number>> = {
  [SOURCE_ID.誘惑]: 1000,
  [SOURCE_ID.挑発]: 500,
  [SOURCE_ID.強要]: 150,
};

function hasVagina(slot: CharaSlot): boolean {
  return ((slot.state.TALENT[TALENT_ID.性別] ?? 0) & 1) !== 0;
}

function hasPenis(slot: CharaSlot): boolean {
  return ((slot.state.TALENT[TALENT_ID.性別] ?? 0) & 2) !== 0;
}

function hasActiveInsertion(state: Readonly<GameState>, target: number): boolean {
  const t = state.charas[target];
  if (!t) return true;
  return (
    readTequip(t, TEQUIP_ID.Ｖ性交) !== 0 ||
    readTequip(t, TEQUIP_ID.Ａ性交) !== 0 ||
    readTequip(state.master, TEQUIP_ID.Ｖ性交) !== 0 ||
    readTequip(state.master, TEQUIP_ID.Ａ性交) !== 0
  );
}

function blockedByInsertEquipment(slot: CharaSlot, site: "v" | "a"): boolean {
  const blocked = site === "v"
    ? [TEQUIP_ID.振動棒, TEQUIP_ID.肛用振動棒, TEQUIP_ID.後庭拉珠, TEQUIP_ID.浣腸, TEQUIP_ID.拡張氣球, TEQUIP_ID.肛門電極]
    : [TEQUIP_ID.肛用振動棒, TEQUIP_ID.後庭拉珠, TEQUIP_ID.浣腸, TEQUIP_ID.拡張氣球, TEQUIP_ID.肛門電極];
  return blocked.some((id) => (slot.state.TEQUIP[id] ?? 0) !== 0);
}

function canRequestInsertion(state: Readonly<GameState>, target: number, site: "v" | "a"): boolean {
  const t = state.charas[target];
  if (!t) return false;
  if (!hasVagina(t) || !hasPenis(state.master)) return false;
  if ((state.master.state.BASE[BASE_ID.勃起] ?? 0) < 1000) return false;
  if (hasActiveInsertion(state, target)) return false;
  if ((t.state.PALAM[PALAM_ID.潤滑] ?? 0) < palamLv(3)) return false;
  if (readCurrentTouchPose(t) !== 0) return false;
  if (blockedByInsertEquipment(t, site)) return false;
  if ((t.state.EQUIP[EQUIP_SLOT.下半身内衣２] ?? 0) >= 27 && (t.state.EQUIP[EQUIP_SLOT.下半身内衣２] ?? 0) <= 30) {
    return false;
  }
  if (site === "a" && (t.state.EXP[EXP_ID.Ａ経験] ?? 0) < 30) return false;
  return true;
}

function applyInsertionRequest(
  state: GameState,
  target: number,
  site: "v" | "a",
  pose: number,
): CounterApplyResult {
  setCurrentTouchRelation(
    state,
    0,
    target,
    TOUCH_PART.Ｐ,
    site === "v" ? TOUCH_PART.Ｖ : TOUCH_PART.Ａ,
    { pose, resetCurrent: true },
  );
  syncHInsertionState(state, target, site);
  return { sources: insertionSources, touchReset: true };
}

function insertionAction(
  id: number,
  label: string,
  site: "v" | "a",
  pose: number,
  order: (state: Readonly<GameState>, target: number) => number,
): CounterActionDef {
  return {
    id,
    label,
    family: "contact",
    counterType: "おねだり",
    able: (state, target) => canRequestInsertion(state, target, site),
    weight: order,
    apply: (state, target) => applyInsertionRequest(state, target, site, pose),
  };
}

function insertionOrder(
  site: "v" | "a",
  state: Readonly<GameState>,
  target: number,
  sensitivityWeight: number,
): number {
  const slot = state.charas[target];
  if (!slot) return 0;
  const ablId = site === "v" ? ABL_ID.Ｖ感覚 : ABL_ID.Ａ感覚;
  const exId = site === "v" ? EX_ID.Ｖ寸止め : EX_ID.Ａ寸止め;
  let base = BASE_WEIGHT + (slot.state.ABL[ablId] ?? 0) * sensitivityWeight + (slot.state.EX[exId] ?? 0) * 10;
  if (talentValue(slot, TALENT_ID.動物耳) !== 0) base += (slot.state.ABL[ablId] ?? 0) * 2;
  base = Math.max(base, 1);
  return base * counterTypeMultiplier("おねだり", state, target);
}

function talentValue(slot: CharaSlot, id: number): number {
  return slot.state.TALENT[id] ?? 0;
}

type SourceBuilder =
  | Readonly<Record<number, number>>
  | ((state: Readonly<GameState>, target: number) => Readonly<Record<number, number>>);

type CounterExpDelta = readonly [id: number, amount: number];

type CounterTcvarBuilder =
  | Readonly<Record<number, number>>
  | ((state: Readonly<GameState>, target: number) => Readonly<Record<number, number>>);

type CounterActor =
  | number
  | ((state: Readonly<GameState>, target: number) => number);

interface CounterInsertionSpec {
  readonly site: "v" | "a";
  /** Use the one-channel initial-insertion writer instead of preserving the
   * other active channel (ongoing thrusts use `false`). */
  readonly initial?: boolean;
  /** Some reverse A counter ERBs do not call a STAIN helper. */
  readonly transferStain?: boolean;
}

interface ServiceActionSpec {
  readonly id: number;
  readonly label: string;
  readonly counterType?: CounterTypeId;
  readonly actorPart?: number;
  readonly targetPart?:
    | number
    | ((state: Readonly<GameState>, target: number) => number);
  readonly usageFlag?: number;
  readonly usageFlags?: readonly number[];
  /** Upstream TFLAG assignments such as `MASTERのＰ挿入中 = 1`. */
  readonly usageSetFlags?: readonly number[];
  readonly usageGate?: (state: Readonly<GameState>) => boolean;
  readonly actor?: CounterActor;
  /** Body-slot owner for the contact ring; reverse actions touch MASTER (0)
   * while their selected counter target remains the acting NPC. */
  readonly contactTarget?: CounterActor;
  readonly touchPose?: number;
  readonly touchResetCurrent?: boolean;
  readonly insertion?: CounterInsertionSpec;
  readonly sources: SourceBuilder;
  readonly masterSources?: SourceBuilder;
  readonly targetExp?:
    | readonly CounterExpDelta[]
    | ((state: Readonly<GameState>, target: number) => readonly CounterExpDelta[]);
  readonly masterExp?:
    | readonly CounterExpDelta[]
    | ((state: Readonly<GameState>, target: number) => readonly CounterExpDelta[]);
  readonly targetTcvars?: Readonly<Record<number, number>>;
  readonly targetTcvarDeltas?: CounterTcvarBuilder;
  readonly masterTcvars?: Readonly<Record<number, number>>;
  readonly masterTcvarDeltas?: CounterTcvarBuilder;
  readonly targetBaseDrains?: Readonly<Record<number, number>>;
  readonly masterBaseDrains?: Readonly<Record<number, number>>;
  readonly targetTequips?: Readonly<Record<number, number>>;
  readonly stainPair?: readonly [targetStain: number, actorStain: number];
  readonly able?: (state: Readonly<GameState>, target: number) => boolean;
  readonly order: (state: Readonly<GameState>, target: number) => number;
}

function resolveSources(
  builder: SourceBuilder | undefined,
  state: Readonly<GameState>,
  target: number,
): Readonly<Record<number, number>> | undefined {
  return typeof builder === "function" ? builder(state, target) : builder;
}

function resolveTcvars(
  builder: CounterTcvarBuilder | undefined,
  state: Readonly<GameState>,
  target: number,
): Readonly<Record<number, number>> | undefined {
  return typeof builder === "function" ? builder(state, target) : builder;
}

function addExperience(slot: CharaSlot, deltas: readonly CounterExpDelta[] | undefined): void {
  for (const [id, amount] of deltas ?? []) {
    slot.state.EXP[id] = (slot.state.EXP[id] ?? 0) + amount;
  }
}

function applyBaseDrains(slot: CharaSlot, drains: Readonly<Record<number, number>> | undefined): void {
  for (const [id, amount] of Object.entries(drains ?? {})) {
    const baseId = Number(id);
    slot.state.BASE[baseId] = Math.max(0, (slot.state.BASE[baseId] ?? 0) - amount);
  }
}

function resolveExperience(
  builder: ServiceActionSpec["targetExp"] | ServiceActionSpec["masterExp"],
  state: Readonly<GameState>,
  target: number,
): readonly CounterExpDelta[] | undefined {
  return typeof builder === "function" ? builder(state, target) : builder;
}

function hasInsertionOn(slot: CharaSlot, site: "v" | "a"): boolean {
  return readTequip(slot, site === "v" ? TEQUIP_ID.Ｖ性交 : TEQUIP_ID.Ａ性交) !== 0;
}

function hasAnyInsertion(slot: CharaSlot): boolean {
  return hasInsertionOn(slot, "v") || hasInsertionOn(slot, "a");
}

function noTargetAndMasterInsertion(state: Readonly<GameState>, target: number): boolean {
  const targetSlot = state.charas[target];
  return Boolean(targetSlot && !hasAnyInsertion(targetSlot) && !hasAnyInsertion(state.master));
}

function serviceAction(spec: ServiceActionSpec): CounterActionDef {
  const counterType = spec.counterType ?? "脱衣爱抚";
  const usageFlags = [
    ...(spec.usageFlags ?? []),
    ...(spec.usageFlag === undefined ? [] : [spec.usageFlag]),
  ].filter((id, index, ids) => ids.indexOf(id) === index);
  return {
    id: spec.id,
    label: spec.label,
    family: "contact",
    counterType,
    able: (state, target) =>
      (spec.usageGate ? spec.usageGate(state) : usageFlags.every((id) => getTflag(state, id) === 0)) &&
      (!spec.able || spec.able(state, target)),
    weight: (state, target) =>
      Math.max(spec.order(state, target), 1) * counterTypeMultiplier(counterType, state, target),
    apply: (state, target, rng) => {
      const actor = typeof spec.actor === "function" ? spec.actor(state, target) : (spec.actor ?? 0);
      const contactTarget = typeof spec.contactTarget === "function"
        ? spec.contactTarget(state, target)
        : (spec.contactTarget ?? target);
      // Resolve SOURCE before EXP/TCVAR mutations. This mirrors the ERB body
      // order and matters for CCOMF84's cervix-experience ladder.
      const sources = resolveSources(spec.sources, state, target);
      const masterSources = resolveSources(spec.masterSources, state, target);
      const targetExperience = resolveExperience(spec.targetExp, state, target);
      const masterExperience = resolveExperience(spec.masterExp, state, target);
      const targetTcvarDeltas = resolveTcvars(spec.targetTcvarDeltas, state, target);
      const masterTcvarDeltas = resolveTcvars(spec.masterTcvarDeltas, state, target);
      if (spec.insertion) {
        const insertionOptions = { transferStain: spec.insertion.transferStain ?? true };
        if (spec.insertion.initial) {
          syncHInsertionState(state, target, spec.insertion.site, actor, insertionOptions);
        } else {
          syncHInsertionChannel(state, target, spec.insertion.site, actor, insertionOptions);
        }
      }
      if (spec.actorPart !== undefined && spec.targetPart !== undefined) {
        const targetPart = typeof spec.targetPart === "function"
          ? spec.targetPart(state, target)
          : spec.targetPart;
        setCurrentTouchRelation(state, actor, contactTarget, spec.actorPart, targetPart, {
          ...(spec.touchPose === undefined ? {} : { pose: spec.touchPose }),
          ...(spec.touchResetCurrent ? { resetCurrent: true } : {}),
        });
      }
      // Upstream CCOMF DATUI calls happen after contact/pose setup and before
      // EVENT_COUNTER_MESSAGE. Preserve that order so DATUI_BOTTOM_T sees the
      // pose that this counter action just established.
      seedCounterUndressMarkers(state, target, spec.id, rng);
      for (const id of spec.usageSetFlags ?? []) setTflag(state, id, 1);
      for (const id of usageFlags) {
        if (!(spec.usageSetFlags ?? []).includes(id)) addTflag(state, id, 1);
      }

      const targetSlot = state.charas[target];
      if (targetSlot) {
        addExperience(targetSlot, targetExperience);
        for (const [id, value] of Object.entries(spec.targetTcvars ?? {})) {
          targetSlot.state.TCVAR[Number(id)] = value;
        }
        for (const [id, value] of Object.entries(targetTcvarDeltas ?? {})) {
          targetSlot.state.TCVAR[Number(id)] = (targetSlot.state.TCVAR[Number(id)] ?? 0) + value;
        }
        for (const [id, value] of Object.entries(spec.targetTequips ?? {})) {
          writeTequip(targetSlot, Number(id), value);
        }
      }
      addExperience(state.master, masterExperience);
      for (const [id, value] of Object.entries(spec.masterTcvars ?? {})) {
        state.master.state.TCVAR[Number(id)] = value;
      }
      for (const [id, value] of Object.entries(masterTcvarDeltas ?? {})) {
        state.master.state.TCVAR[Number(id)] = (state.master.state.TCVAR[Number(id)] ?? 0) + value;
      }
      applyBaseDrains(targetSlot ?? state.master, spec.targetBaseDrains);
      applyBaseDrains(state.master, spec.masterBaseDrains);
      if (targetSlot && spec.stainPair) {
        const [targetStainId, actorStainId] = spec.stainPair;
        const targetStain = targetSlot.state.STAIN[targetStainId] ?? 0;
        const actorStain = state.master.state.STAIN[actorStainId] ?? 0;
        targetSlot.state.STAIN[targetStainId] = targetStain | actorStain;
        state.master.state.STAIN[actorStainId] = actorStain | targetStain;
      }

      return {
        ...(sources ? { sources } : {}),
        ...(masterSources ? { masterSources } : {}),
      };
    },
  };
}

function masterErectionWeight(state: Readonly<GameState>): number {
  return Math.trunc((state.master.state.BASE[BASE_ID.勃起] ?? 0) / 500);
}

function counterServiceSources(
  entries: Readonly<Record<number, number>>,
): Readonly<Record<number, number>> {
  return entries;
}

function conditionalSource(
  condition: boolean,
  id: number,
  amount: number,
): Readonly<Record<number, number>> {
  return condition ? { [id]: amount } : {};
}

const serviceActions: readonly CounterActionDef[] = [
  serviceAction({
    id: 50,
    label: "手淫",
    actorPart: TOUCH_PART.指,
    targetPart: TOUCH_PART.Ｐ,
    usageFlag: TFLAG_ID.Ｃ使用中,
    sources: counterServiceSources({
      [SOURCE_ID.性行動]: 250,
      [SOURCE_ID.誘惑]: 500,
      [SOURCE_ID.挑発]: 100,
      [SOURCE_ID.加虐]: 100,
      [SOURCE_ID.征服]: 200,
    }),
    masterSources: (state) => conditionalSource(!hasPenis(state.master), SOURCE_ID.快Ｃ, 300),
    masterTcvarDeltas: { [TCVAR_ID.射精快感強度]: 500 },
    targetExp: [[EXP_ID.手淫経験, 1]],
    targetTcvars: {
      [TCVAR_ID.奉仕フラグ]: 1,
      [TCVAR_ID.嗜虐フラグ]: 1,
    },
    able: (state, target) => {
      const targetSlot = state.charas[target];
      return Boolean(
        targetSlot &&
        (targetSlot.state.ABL[ABL_ID.指] ?? 0) >= 1 &&
        !hasAnyInsertion(targetSlot) &&
        !(hasInsertionOn(state.master, "v") && !hasPenis(state.master)),
      );
    },
    order: (state, target) => {
      const slot = state.charas[target];
      return BASE_WEIGHT +
        2 * (slot?.state.TALENT[TALENT_ID.器用な指] ?? 0) +
        (slot?.state.ABL[ABL_ID.指] ?? 0) +
        masterErectionWeight(state);
    },
  }),
  serviceAction({
    id: 51,
    label: "口交、舐陰",
    actorPart: TOUCH_PART.口,
    targetPart: TOUCH_PART.Ｐ,
    usageFlag: TFLAG_ID.Ｃ使用中,
    sources: counterServiceSources({
      [SOURCE_ID.性行動]: 300,
      [SOURCE_ID.誘惑]: 600,
      [SOURCE_ID.挑発]: 150,
      [SOURCE_ID.征服]: 250,
      [SOURCE_ID.奉仕]: 800,
      [SOURCE_ID.快Ｍ]: 200,
    }),
    masterSources: (state) => conditionalSource(!hasPenis(state.master), SOURCE_ID.快Ｃ, 500),
    masterTcvarDeltas: { [TCVAR_ID.射精快感強度]: 800 },
    targetExp: [[EXP_ID.口淫経験, 1]],
    targetTcvars: { [TCVAR_ID.奉仕フラグ]: 1 },
    able: (state, target) => {
      const slot = state.charas[target];
      return Boolean(slot && (slot.state.ABL[ABL_ID.舌] ?? 0) >= 1 && noTargetAndMasterInsertion(state, target));
    },
    order: (state, target) => {
      const slot = state.charas[target];
      return BASE_WEIGHT +
        (slot?.state.TALENT[TALENT_ID.汚臭耐性] ?? 0) +
        2 * (slot?.state.TALENT[TALENT_ID.舌使い] ?? 0) +
        (slot?.state.ABL[ABL_ID.舌] ?? 0) +
        masterErectionWeight(state);
    },
  }),
  serviceAction({
    id: 52,
    label: "素股、貝合わせ",
    actorPart: TOUCH_PART.Ｃ,
    targetPart: (state) => hasPenis(state.master) ? TOUCH_PART.Ｐ : TOUCH_PART.Ｃ,
    usageFlag: TFLAG_ID.Ｃ使用中,
    sources: counterServiceSources({
      [SOURCE_ID.快Ｃ]: 150,
      [SOURCE_ID.性行動]: 250,
      [SOURCE_ID.誘惑]: 700,
      [SOURCE_ID.挑発]: 200,
      [SOURCE_ID.奉仕]: 400,
      [SOURCE_ID.強要]: 500,
    }),
    masterSources: (state) => conditionalSource(!hasPenis(state.master), SOURCE_ID.快Ｃ, 500),
    masterTcvarDeltas: (state, target) => ({
      [TCVAR_ID.射精快感強度]: (state.charas[target]?.state.ABL[ABL_ID.腰] ?? 0) >= 1 ? 800 : 200,
    }),
    targetTcvars: {
      [TCVAR_ID.奉仕フラグ]: 1,
      [TCVAR_ID.嗜虐フラグ]: 1,
    },
    able: (state, target) => {
      const slot = state.charas[target];
      if (!slot || !noTargetAndMasterInsertion(state, target)) return false;
      if ((slot.state.ABL[ABL_ID.腰] ?? 0) < 1) {
        if ((slot.state.PALAM[PALAM_ID.欲情] ?? 0) < palamLv(3)) return false;
        if (talentValue(slot, TALENT_ID.無知) !== 0 && (slot.state.PALAM[PALAM_ID.快Ｃ] ?? 0) < palamLv(3)) {
          return false;
        }
      }
      // CCOMF52 uses the literal 2000 lubrication gate, not PALAMLV[3]
      // (which is 3000 in the base table).
      return (slot.state.PALAM[PALAM_ID.潤滑] ?? 0) >= 2000;
    },
    order: (state, target) => {
      const slot = state.charas[target];
      return BASE_WEIGHT +
        (slot?.state.ABL[ABL_ID.腰] ?? 0) +
        2 * (slot?.state.TALENT[TALENT_ID.濡れやすさ] ?? 0) +
        masterErectionWeight(state);
    },
  }),
  serviceAction({
    id: 53,
    label: "乳交",
    actorPart: TOUCH_PART.Ｂ,
    targetPart: TOUCH_PART.Ｐ,
    usageFlag: TFLAG_ID.Ｃ使用中,
    sources: counterServiceSources({
      [SOURCE_ID.性行動]: 400,
      [SOURCE_ID.快Ｂ]: 50,
      [SOURCE_ID.誘惑]: 800,
      [SOURCE_ID.挑発]: 400,
      [SOURCE_ID.奉仕]: 800,
      [SOURCE_ID.強要]: 200,
      [SOURCE_ID.征服]: 500,
    }),
    masterTcvarDeltas: { [TCVAR_ID.射精快感強度]: 1000 },
    targetExp: [[EXP_ID.乳交経験, 2]],
    targetTcvars: { [TCVAR_ID.奉仕フラグ]: 1 },
    able: (state, target) => {
      const slot = state.charas[target];
      return Boolean(
        slot &&
        (slot.state.ABL[ABL_ID.胸] ?? 0) >= 1 &&
        (slot.state.TALENT[TALENT_ID.胸围] ?? 0) + (slot.state.ABL[ABL_ID.技巧] ?? 0) >= 3 &&
        hasPenis(state.master) &&
        noTargetAndMasterInsertion(state, target),
      );
    },
    order: (state, target) => {
      const slot = state.charas[target];
      return BASE_WEIGHT +
        (slot?.state.TALENT[TALENT_ID.胸围] ?? 0) +
        2 * (slot?.state.TALENT[TALENT_ID.淫乳] ?? 0) +
        5 * (slot?.state.ABL[ABL_ID.胸] ?? 0) +
        masterErectionWeight(state);
    },
  }),
  serviceAction({
    id: 54,
    label: "足交",
    actorPart: TOUCH_PART.足,
    targetPart: TOUCH_PART.Ｐ,
    usageFlag: TFLAG_ID.Ｃ使用中,
    sources: counterServiceSources({
      [SOURCE_ID.性行動]: 250,
      [SOURCE_ID.挑発]: 300,
      [SOURCE_ID.侮辱]: 400,
      [SOURCE_ID.奉仕]: 300,
      [SOURCE_ID.加虐]: 800,
      [SOURCE_ID.征服]: 600,
    }),
    masterTcvarDeltas: { [TCVAR_ID.射精快感強度]: 500 },
    targetTcvars: {
      [TCVAR_ID.嗜虐フラグ]: 1,
      [TCVAR_ID.奉仕フラグ]: 1,
    },
    able: (state, target) => {
      const slot = state.charas[target];
      return Boolean(
        slot &&
        hasPenis(state.master) &&
        (slot.state.ABL[ABL_ID.施虐属性] ?? 0) >= 1 &&
        noTargetAndMasterInsertion(state, target),
      );
    },
    order: (state, target) => {
      const slot = state.charas[target];
      return BASE_WEIGHT +
        2 * (slot?.state.TALENT[TALENT_ID.施虐狂] ?? 0) +
        Math.max(slot?.state.ABL[ABL_ID.施虐属性] ?? 0, 5) +
        4 * (slot?.state.TALENT[TALENT_ID.美脚] ?? 0) +
        Math.trunc((slot?.state.ABL[ABL_ID.足] ?? 0) * 1.5) +
        masterErectionWeight(state);
    },
  }),
  serviceAction({
    id: 55,
    label: "肛門愛撫",
    actorPart: TOUCH_PART.指,
    targetPart: TOUCH_PART.Ａ,
    usageFlag: TFLAG_ID.Ａ使用中,
    sources: counterServiceSources({
      [SOURCE_ID.性行動]: 150,
      [SOURCE_ID.加虐]: 500,
      [SOURCE_ID.誘惑]: 100,
      [SOURCE_ID.挑発]: 100,
      [SOURCE_ID.奉仕]: 100,
      [SOURCE_ID.征服]: 600,
    }),
    masterSources: { [SOURCE_ID.快Ａ]: 300 },
    targetExp: [[EXP_ID.手淫経験, 1]],
    targetTcvars: {
      [TCVAR_ID.奉仕フラグ]: 1,
      [TCVAR_ID.嗜虐フラグ]: 1,
    },
    able: (state, target) => {
      const slot = state.charas[target];
      return Boolean(
        slot &&
        (state.flagStore[FLAG_ID.アナル開発無効] ?? 0) === 0 &&
        (slot.state.ABL[ABL_ID.指] ?? 0) >= 1 &&
        !hasInsertionOn(state.master, "a") &&
        (state.master.state.PALAM[PALAM_ID.潤滑] ?? 0) >= palamLv(2),
      );
    },
    order: (state, target) => {
      const slot = state.charas[target];
      const experience = slot?.state.EXP[EXP_ID.Ａ経験] ?? 0;
      return (BASE_WEIGHT +
        2 * (slot?.state.TALENT[TALENT_ID.器用な指] ?? 0) +
        (slot?.state.ABL[ABL_ID.指] ?? 0)) * (experience > 0 ? 1 : 0);
    },
  }),
  serviceAction({
    id: 56,
    label: "舐肛",
    actorPart: TOUCH_PART.口,
    targetPart: TOUCH_PART.Ａ,
    usageFlag: TFLAG_ID.Ａ使用中,
    sources: counterServiceSources({
      [SOURCE_ID.性行動]: 150,
      [SOURCE_ID.侮辱]: 300,
      [SOURCE_ID.誘惑]: 100,
      [SOURCE_ID.挑発]: 100,
      [SOURCE_ID.征服]: 300,
      [SOURCE_ID.奉仕]: 300,
      [SOURCE_ID.快Ｍ]: 50,
    }),
    masterSources: { [SOURCE_ID.快Ａ]: 200 },
    targetExp: [[EXP_ID.口淫経験, 1]],
    targetTcvars: { [TCVAR_ID.奉仕フラグ]: 1 },
    able: (state, target) => {
      const slot = state.charas[target];
      return Boolean(
        slot &&
        (state.flagStore[FLAG_ID.アナル開発無効] ?? 0) === 0 &&
        !(
          ((state.master.state.STAIN[STAIN_ID.Ａ] ?? 0) & 8) !== 0 &&
          (slot.state.TALENT[TALENT_ID.汚臭耐性] ?? 0) < 1
        ) &&
        (slot.state.ABL[ABL_ID.舌] ?? 0) >= 1 &&
        !hasAnyInsertion(slot) &&
        !hasInsertionOn(state.master, "a") &&
        readTequipOptional(state.master, TEQUIP_ID.Ｖ性交) !== target,
      );
    },
    order: (state, target) => {
      const slot = state.charas[target];
      const experience = slot?.state.EXP[EXP_ID.Ａ経験] ?? 0;
      return (BASE_WEIGHT +
        2 * (slot?.state.TALENT[TALENT_ID.舌使い] ?? 0) +
        (slot?.state.ABL[ABL_ID.舌] ?? 0) +
        Math.min(slot?.state.TALENT[TALENT_ID.汚臭耐性] ?? 0, 0)) * (experience > 0 ? 1 : 0);
    },
  }),
  serviceAction({
    id: 57,
    label: "指挿入",
    actorPart: TOUCH_PART.指,
    targetPart: TOUCH_PART.Ｖ,
    usageFlag: TFLAG_ID.Ｖ使用中,
    sources: counterServiceSources({
      [SOURCE_ID.性行動]: 150,
      [SOURCE_ID.侮辱]: 200,
      [SOURCE_ID.挑発]: 150,
      [SOURCE_ID.征服]: 400,
      [SOURCE_ID.加虐]: 100,
    }),
    masterSources: { [SOURCE_ID.快Ｖ]: 300 },
    targetExp: [[EXP_ID.手淫経験, 1]],
    targetTcvars: { [TCVAR_ID.嗜虐フラグ]: 1 },
    able: (state, target) => {
      const slot = state.charas[target];
      if (!slot || !hasVagina(state.master) || hasInsertionOn(state.master, "v")) return false;
      if (talentValue(slot, TALENT_ID.施虐狂) === 0 && talentValue(state.master, TALENT_ID.処女) > 0) return false;
      return talentValue(slot, TALENT_ID.施虐狂) !== 0 ||
        (state.master.state.PALAM[PALAM_ID.潤滑] ?? 0) >= palamLv(2);
    },
    order: (state, target) => {
      const slot = state.charas[target];
      return BASE_WEIGHT +
        2 * (slot?.state.TALENT[TALENT_ID.器用な指] ?? 0) +
        (slot?.state.ABL[ABL_ID.指] ?? 0);
    },
  }),
  serviceAction({
    id: 58,
    label: "胸愛撫",
    actorPart: TOUCH_PART.指,
    targetPart: TOUCH_PART.Ｂ,
    usageFlag: TFLAG_ID.Ｂ使用中,
    sources: (state) => {
      const sources: Record<number, number> = {
        [SOURCE_ID.性行動]: 200,
        [SOURCE_ID.侮辱]: 300,
        [SOURCE_ID.誘惑]: 200,
        [SOURCE_ID.挑発]: 100,
        [SOURCE_ID.征服]: 300,
      };
      if (!hasVagina(state.master)) sources[SOURCE_ID.加虐] = 100;
      return sources;
    },
    masterSources: { [SOURCE_ID.快Ｂ]: 300 },
    targetExp: [[EXP_ID.手淫経験, 1]],
    able: (state, target) => {
      const slot = state.charas[target];
      return Boolean(slot && (slot.state.ABL[ABL_ID.指] ?? 0) >= 1);
    },
    order: (state, target) => {
      const slot = state.charas[target];
      return BASE_WEIGHT +
        2 * (slot?.state.TALENT[TALENT_ID.器用な指] ?? 0) +
        (slot?.state.ABL[ABL_ID.指] ?? 0);
    },
  }),
  serviceAction({
    id: 59,
    label: "乳首吸い",
    actorPart: TOUCH_PART.口,
    targetPart: TOUCH_PART.Ｂ,
    usageFlag: TFLAG_ID.Ｂ使用中,
    sources: counterServiceSources({
      [SOURCE_ID.性行動]: 300,
      [SOURCE_ID.誘惑]: 150,
      [SOURCE_ID.挑発]: 200,
      [SOURCE_ID.征服]: 100,
    }),
    masterSources: { [SOURCE_ID.快Ｂ]: 400 },
    targetExp: [[EXP_ID.口淫経験, 1]],
    able: (state, target) => {
      const slot = state.charas[target];
      return Boolean(slot && (slot.state.ABL[ABL_ID.舌] ?? 0) >= 1 && !hasAnyInsertion(state.master));
    },
    order: (state, target) => {
      const slot = state.charas[target];
      return BASE_WEIGHT +
        2 * (slot?.state.TALENT[TALENT_ID.舌使い] ?? 0) +
        (slot?.state.ABL[ABL_ID.舌] ?? 0) +
        (slot?.state.TALENT[TALENT_ID.幼稚] ?? 0) -
        (state.master.state.TALENT[TALENT_ID.性別] ?? 0);
    },
  }),
  serviceAction({
    id: 60,
    label: "ディープ接吻",
    actorPart: TOUCH_PART.口,
    targetPart: TOUCH_PART.口,
    usageFlag: TFLAG_ID.口使用中,
    sources: counterServiceSources({
      [SOURCE_ID.性行動]: 100,
      [SOURCE_ID.誘惑]: 150,
      [SOURCE_ID.奉仕]: 150,
      [SOURCE_ID.征服]: 200,
      [SOURCE_ID.快Ｍ]: 300,
    }),
    masterSources: { [SOURCE_ID.快Ｍ]: 300 },
    targetExp: [
      [EXP_ID.接吻経験, 1],
      [EXP_ID.口淫経験, 2],
    ],
    masterExp: [[EXP_ID.接吻経験, 1]],
    able: (state) => !hasAnyInsertion(state.master),
    order: (state, target) => {
      const slot = state.charas[target];
      return BASE_WEIGHT +
        (2 * (slot?.state.TALENT[TALENT_ID.舌使い] ?? 0) + (slot?.state.ABL[ABL_ID.舌] ?? 0)) *
        (slot && talentValue(slot, TALENT_ID.キス未経験) === 0 ? 1 : 0);
    },
  }),
];

function masterHasActiveInsertion(state: Readonly<GameState>): boolean {
  return hasInsertionOn(state.master, "v") || hasInsertionOn(state.master, "a");
}

function masterInsertionTargets(state: Readonly<GameState>, target: number): boolean {
  return readTequip(state.master, TEQUIP_ID.Ｖ性交) === target ||
    readTequip(state.master, TEQUIP_ID.Ａ性交) === target;
}

function masterUnderwearBlocksForcedCounter(state: Readonly<GameState>): boolean {
  const underwear = state.master.state.EQUIP[EQUIP_SLOT.下半身内衣２] ?? 0;
  return underwear >= 27 && underwear <= 30;
}

const coercionActions: readonly CounterActionDef[] = [
  serviceAction({
    id: 70,
    label: "クンニ強制",
    counterType: "脱衣强迫",
    actorPart: TOUCH_PART.口,
    targetPart: TOUCH_PART.Ｃ,
    usageFlag: TFLAG_ID.口使用中,
    stainPair: [STAIN_ID.Ｖ, STAIN_ID.口],
    sources: {
      [SOURCE_ID.快Ｃ]: 100,
      [SOURCE_ID.性行動]: 300,
      [SOURCE_ID.征服]: 500,
      [SOURCE_ID.液体]: 60,
      [SOURCE_ID.誘惑]: 100,
      [SOURCE_ID.挑発]: 100,
      [SOURCE_ID.強要]: 300,
      [SOURCE_ID.加虐]: 30,
    },
    masterSources: { [SOURCE_ID.快Ｍ]: 150 },
    masterExp: [[EXP_ID.口淫経験, 1]],
    targetTcvars: { [TCVAR_ID.嗜虐フラグ]: 1 },
    able: (state, target) => {
      const slot = state.charas[target];
      return Boolean(
        slot &&
        hasVagina(slot) &&
        noTargetAndMasterInsertion(state, target) &&
        !masterUnderwearBlocksForcedCounter(state),
      );
    },
    order: (state, target) => BASE_WEIGHT + (state.charas[target]?.state.ABL[ABL_ID.Ｃ感覚] ?? 0),
  }),
  serviceAction({
    id: 71,
    label: "フェラチオ強制",
    counterType: "脱衣强迫",
    actorPart: TOUCH_PART.Ｐ,
    targetPart: TOUCH_PART.口,
    usageFlag: TFLAG_ID.口使用中,
    stainPair: [STAIN_ID.Ｐ, STAIN_ID.口],
    sources: (state) => {
      const sources: Record<number, number> = {
        [SOURCE_ID.性行動]: 300,
        [SOURCE_ID.征服]: 700,
        [SOURCE_ID.液体]: 60,
        [SOURCE_ID.挑発]: 100,
        [SOURCE_ID.加虐]: 500,
        [SOURCE_ID.強要]: 1000,
      };
      if (hasVagina(state.master)) sources[SOURCE_ID.快Ｃ] = 100;
      return sources;
    },
    masterSources: { [SOURCE_ID.快Ｍ]: 200 },
    masterExp: [[EXP_ID.口淫経験, 1]],
    targetTcvars: { [TCVAR_ID.嗜虐フラグ]: 1 },
    targetTcvarDeltas: { [TCVAR_ID.射精快感強度]: 800 },
    able: (state, target) => {
      const slot = state.charas[target];
      return Boolean(
        slot &&
        hasPenis(slot) &&
        !hasInsertionOn(slot, "v") &&
        !masterInsertionTargets(state, target),
      );
    },
    order: (state, target) => BASE_WEIGHT + (state.charas[target]?.state.ABL[ABL_ID.Ｃ感覚] ?? 0),
  }),
  serviceAction({
    id: 72,
    label: "アナル奉仕",
    counterType: "脱衣强迫",
    actorPart: TOUCH_PART.口,
    targetPart: TOUCH_PART.Ａ,
    usageFlag: TFLAG_ID.口使用中,
    stainPair: [STAIN_ID.Ａ, STAIN_ID.口],
    sources: {
      [SOURCE_ID.快Ａ]: 100,
      [SOURCE_ID.性行動]: 300,
      [SOURCE_ID.征服]: 600,
      [SOURCE_ID.侮辱]: 300,
      [SOURCE_ID.挑発]: 100,
      [SOURCE_ID.強要]: 400,
      [SOURCE_ID.加虐]: 50,
    },
    masterSources: { [SOURCE_ID.快Ｍ]: 100 },
    masterExp: [[EXP_ID.口淫経験, 1]],
    targetTcvars: { [TCVAR_ID.嗜虐フラグ]: 1, [TCVAR_ID.射精箇所]: 9 },
    targetTcvarDeltas: { [TCVAR_ID.射精快感強度]: 200 },
    able: (state, target) =>
      Boolean(state.charas[target] && noTargetAndMasterInsertion(state, target)),
    order: (state, target) => {
      const slot = state.charas[target];
      const eligible = (slot?.state.EXP[EXP_ID.Ａ絶頂経験] ?? 0) >= 10 ? 1 : 0;
      return (BASE_WEIGHT + (slot?.state.ABL[ABL_ID.Ａ感覚] ?? 0)) * eligible;
    },
  }),
  serviceAction({
    id: 73,
    label: "ぱふぱふ",
    counterType: "脱衣强迫",
    actorPart: TOUCH_PART.Ｂ,
    targetPart: TOUCH_PART.Ｂ,
    usageFlag: TFLAG_ID.口使用中,
    usageGate: () => true,
    sources: {
      [SOURCE_ID.快Ｂ]: 80,
      [SOURCE_ID.性行動]: 250,
      [SOURCE_ID.受動]: 300,
      [SOURCE_ID.誘惑]: 600,
      [SOURCE_ID.情愛]: 250,
    },
    able: (state, target) => {
      const slot = state.charas[target];
      return Boolean(
        slot &&
        !masterInsertionTargets(state, target) &&
        ![2, 5].includes(readCurrentTouchPose(slot)),
      );
    },
    order: (state, target) => BASE_WEIGHT + (state.charas[target]?.state.ABL[ABL_ID.Ｂ感覚] ?? 0),
  }),
  serviceAction({
    id: 74,
    label: "乳合わせ",
    counterType: "脱衣强迫",
    actorPart: TOUCH_PART.Ｂ,
    targetPart: TOUCH_PART.Ｂ,
    usageFlag: TFLAG_ID.Ｂ使用中,
    sources: {
      [SOURCE_ID.快Ｂ]: 80,
      [SOURCE_ID.性行動]: 300,
      [SOURCE_ID.誘惑]: 600,
      [SOURCE_ID.強要]: 100,
    },
    masterSources: (state) => conditionalSource(hasVagina(state.master), SOURCE_ID.快Ｂ, 100),
    targetTcvars: { [TCVAR_ID.奉仕フラグ]: 1 },
    able: (state, target) => Boolean(
      state.charas[target] &&
      hasPenis(state.charas[target]!) &&
      !masterHasActiveInsertion(state) &&
      readCurrentTouchPose(state.charas[target]!) === 0,
    ),
    order: (state, target) => BASE_WEIGHT + (state.charas[target]?.state.ABL[ABL_ID.Ｂ感覚] ?? 0),
  }),
  serviceAction({
    id: 75,
    label: "タワシ洗い",
    counterType: "脱衣强迫",
    actorPart: TOUCH_PART.指,
    targetPart: TOUCH_PART.Ｃ,
    usageFlag: TFLAG_ID.手使用中,
    usageGate: (state) => getTflag(state, TFLAG_ID.手使用中) <= 1,
    sources: {
      [SOURCE_ID.快Ｃ]: 100,
      [SOURCE_ID.性行動]: 150,
      [SOURCE_ID.誘惑]: 100,
      [SOURCE_ID.挑発]: 150,
      [SOURCE_ID.征服]: 100,
      [SOURCE_ID.強要]: 200,
    },
    able: (state, target) => Boolean(
      state.charas[target] &&
      hasVagina(state.charas[target]!) &&
      (state.charas[target]!.state.PALAM[PALAM_ID.潤滑] ?? 0) >= 1500 &&
      !masterHasActiveInsertion(state) &&
      getTflag(state, TFLAG_ID.口使用中) > 0 &&
      getTflag(state, TFLAG_ID.手使用中) <= 1,
    ),
    order: (state, target) => BASE_WEIGHT + (state.charas[target]?.state.ABL[ABL_ID.Ｃ感覚] ?? 0),
  }),
  serviceAction({
    id: 76,
    label: "強制アソコ愛撫",
    counterType: "脱衣强迫",
    actorPart: TOUCH_PART.指,
    targetPart: TOUCH_PART.Ｃ,
    usageFlag: TFLAG_ID.手使用中,
    usageGate: () => true,
    sources: (state, target) => {
      const sources: Record<number, number> = {
        [SOURCE_ID.快Ｃ]: 100,
        [SOURCE_ID.性行動]: 150,
        [SOURCE_ID.誘惑]: 100,
        [SOURCE_ID.挑発]: 150,
        [SOURCE_ID.強要]: 400,
        [SOURCE_ID.征服]: 200,
      };
      if (talentValue(state.charas[target]!, TALENT_ID.処女) === 0) sources[SOURCE_ID.快Ｖ] = 100;
      return sources;
    },
    able: (state, target) => Boolean(
      state.charas[target] &&
      hasVagina(state.charas[target]!) &&
      (state.charas[target]!.state.PALAM[PALAM_ID.潤滑] ?? 0) >= 1000 &&
      !masterInsertionTargets(state, target) &&
      readCurrentTouchPose(state.charas[target]!) === 0 &&
      !masterUnderwearBlocksForcedCounter(state),
    ),
    order: (state, target) => {
      const slot = state.charas[target];
      return BASE_WEIGHT + Math.trunc(((slot?.state.ABL[ABL_ID.Ｃ感覚] ?? 0) + (slot?.state.ABL[ABL_ID.Ｖ感覚] ?? 0)) / 2);
    },
  }),
  serviceAction({
    id: 77,
    label: "乳を吸わせる",
    counterType: "脱衣强迫",
    actorPart: TOUCH_PART.Ｂ,
    targetPart: TOUCH_PART.Ｂ,
    usageFlag: TFLAG_ID.口使用中,
    sources: {
      [SOURCE_ID.誘惑]: 500,
      [SOURCE_ID.奉仕]: 200,
      [SOURCE_ID.強要]: 100,
      [SOURCE_ID.快Ｂ]: 200,
      [SOURCE_ID.情愛]: 100,
    },
    targetExp: (state, target) =>
      talentValue(state.charas[target]!, TALENT_ID.母乳体質) !== 0
        ? [[EXP_ID.噴乳経験, 1]]
        : [],
    targetTequips: { [TEQUIP_ID.吸乳头]: 1 },
    able: (state, target) => Boolean(
      state.charas[target] &&
      !masterInsertionTargets(state, target) &&
      ![2, 5].includes(readCurrentTouchPose(state.charas[target]!)),
    ),
    order: (state, target) => BASE_WEIGHT + (state.charas[target]?.state.ABL[ABL_ID.Ｂ感覚] ?? 0),
  }),
  serviceAction({
    id: 78,
    label: "尻ズリ",
    counterType: "脱衣强迫",
    sources: {
      [SOURCE_ID.誘惑]: 200,
      [SOURCE_ID.強要]: 400,
      [SOURCE_ID.征服]: 700,
      [SOURCE_ID.快Ｃ]: 100,
    },
    targetTcvars: { [TCVAR_ID.射精箇所]: 8 },
    targetTcvarDeltas: { [TCVAR_ID.射精快感強度]: 200 },
    able: (state, target) => Boolean(
      state.charas[target] &&
      hasPenis(state.charas[target]!) &&
      getTflag(state, TFLAG_ID.Ａ使用中) === 0 &&
      (state.charas[target]!.state.BASE[BASE_ID.勃起] ?? 0) >= 500 &&
      !masterHasActiveInsertion(state) &&
      readCurrentTouchPose(state.charas[target]!) === 0,
    ),
    order: (state, target) => {
      const slot = state.charas[target];
      return (BASE_WEIGHT * 10 / 8) +
        (slot?.state.ABL[ABL_ID.Ｃ感覚] ?? 0) +
        Math.max(Math.trunc((slot?.state.EXP[EXP_ID.射精経験] ?? 0) / 15), 8);
    },
  }),
];

type HInsertionSite = "v" | "a";

function hInsertionIds(site: HInsertionSite): { tequip: number; tcvar: number } {
  return site === "v"
    ? { tequip: TEQUIP_ID.Ｖ性交, tcvar: TCVAR_ID.V挿入管理 }
    : { tequip: TEQUIP_ID.Ａ性交, tcvar: TCVAR_ID.A挿入管理 };
}

/** Forward link: MASTER.P -> TARGET.V/A. Explicit zero is a real active
 * partner id, so optional reads are intentional here. */
function hasForwardHInsertion(
  state: Readonly<GameState>,
  target: number,
  site: HInsertionSite,
): boolean {
  const slot = state.charas[target];
  if (!slot) return false;
  const ids = hInsertionIds(site);
  return (
    readTequipOptional(state.master, ids.tequip) === target &&
    readTequipOptional(slot, ids.tequip) === 0 &&
    slot.state.TCVAR[ids.tcvar] === 0
  );
}

/** Reverse link: TARGET.P -> MASTER.V/A. */
function hasReverseHInsertion(
  state: Readonly<GameState>,
  target: number,
  site: HInsertionSite,
): boolean {
  const slot = state.charas[target];
  if (!slot) return false;
  const ids = hInsertionIds(site);
  return (
    readTequipOptional(slot, ids.tequip) === target &&
    readTequipOptional(state.master, ids.tequip) === target &&
    slot.state.TCVAR[ids.tcvar] === target
  );
}

function hasAnyHInsertion(state: Readonly<GameState>, target: number): boolean {
  return (['v', 'a'] as const).some((site) =>
    hasForwardHInsertion(state, target, site) || hasReverseHInsertion(state, target, site));
}

function targetLowerUnderwearBlocksInsertion(state: Readonly<GameState>, target: number): boolean {
  const underwear = state.charas[target]?.state.EQUIP[EQUIP_SLOT.下半身内衣２] ?? 0;
  return underwear >= 27 && underwear <= 30;
}

function analDevelopmentDisabled(state: Readonly<GameState>, bit: 0 | 1): boolean {
  return ((state.flagStore[FLAG_ID.アナル開発無効] ?? 0) & (1 << bit)) !== 0;
}

function canForwardInitialHInsertion(
  state: Readonly<GameState>,
  target: number,
  site: HInsertionSite,
): boolean {
  const slot = state.charas[target];
  if (!slot || !hasVagina(slot) || !hasPenis(state.master)) return false;
  if ((state.master.state.BASE[BASE_ID.勃起] ?? 0) < 1000) return false;
  if (hasAnyHInsertion(state, target)) return false;
  if (getTflag(state, TFLAG_ID.Ｐ挿入中) !== 0 || getTflag(state, TFLAG_ID.Ｃ使用中) !== 0) return false;
  if (getTflag(state, TFLAG_ID.Ｖ使用中) !== 0) return false;
  if (readCurrentTouchPose(slot) !== 0) return false;
  if (blockedByInsertEquipment(slot, site)) return false;
  if (targetLowerUnderwearBlocksInsertion(state, target)) return false;
  if ((slot.state.PALAM[PALAM_ID.潤滑] ?? 0) < palamLv(3)) return false;
  if ((slot.state.TALENT[TALENT_ID.人形] ?? 0) === 99) return false;
  if (site === "a") {
    if (analDevelopmentDisabled(state, 1)) return false;
    if ((slot.state.ABL[ABL_ID.Ａ感覚] ?? 0) < 3) return false;
  }
  return true;
}

function canReverseInitialHInsertion(
  state: Readonly<GameState>,
  target: number,
  site: HInsertionSite,
): boolean {
  const slot = state.charas[target];
  if (!slot || !hasPenis(slot)) return false;
  if (site === "v" && !hasVagina(state.master)) return false;
  if ((slot.state.BASE[BASE_ID.勃起] ?? 0) < 1000) return false;
  if (hasAnyHInsertion(state, target)) return false;
  if (site === "v" && getTflag(state, TFLAG_ID.Ｖ使用中) !== 0) return false;
  if (site === "a" && getTflag(state, TFLAG_ID.Ａ使用中) !== 0) return false;
  if (site === "a" && analDevelopmentDisabled(state, 0)) return false;
  if (site === "a" && (state.master.state.ABL[ABL_ID.Ａ感覚] ?? 0) < 2) return false;
  if (site === "v") {
    const underwear = slot.state.EQUIP[EQUIP_SLOT.下半身内衣２] ?? 0;
    if (underwear === 27 || underwear === 28) return false;
  }
  if ((slot.state.TALENT[TALENT_ID.施虐狂] ?? 0) === 0 &&
      (state.master.state.PALAM[PALAM_ID.潤滑] ?? 0) < palamLv(3)) return false;
  return true;
}

function canReverseOralCounter(state: Readonly<GameState>, target: number): boolean {
  const slot = state.charas[target];
  if (!slot || !hasPenis(slot)) return false;
  if ((slot.state.BASE[BASE_ID.勃起] ?? 0) < 1000) return false;
  if (hasAnyHInsertion(state, target) || masterHasActiveInsertion(state)) return false;
  if (masterInsertionTargets(state, target)) return false;
  return true;
}

function ejaculationWeight(slot: CharaSlot | undefined): number {
  return Math.max(Math.trunc((slot?.state.EXP[EXP_ID.射精経験] ?? 0) / 15), 15);
}

function affectionExperience(state: Readonly<GameState>, target: number): readonly CounterExpDelta[] {
  return [[EXP_ID.愛情経験, state.charas[target]?.state.TALENT[TALENT_ID.恋慕] ?? 0]];
}

function reverseVThrustMasterSources(state: Readonly<GameState>): Readonly<Record<number, number>> {
  const cervixExperience = state.master.state.EXP[EXP_ID.子宮口開発経験] ?? 0;
  let pleasure = 1000;
  if (cervixExperience > 150) pleasure += 200;
  else if (cervixExperience > 75) pleasure += 100;
  else if (cervixExperience <= 25) pleasure = Math.trunc(pleasure / 2);
  return { [SOURCE_ID.快Ｖ]: pleasure };
}

const sexualActions: readonly CounterActionDef[] = [
  serviceAction({
    id: 80,
    label: "被正常位",
    counterType: "性交",
    actor: (_state, target) => target,
    contactTarget: 0,
    actorPart: TOUCH_PART.Ｐ,
    targetPart: TOUCH_PART.Ｖ,
    touchPose: 1,
    touchResetCurrent: true,
    insertion: { site: "v", initial: true },
    usageFlag: TFLAG_ID.Ｖ使用中,
    sources: {
      [SOURCE_ID.性行動]: 300,
      [SOURCE_ID.征服]: 1200,
      [SOURCE_ID.誘惑]: 600,
      [SOURCE_ID.加虐]: 400,
      [SOURCE_ID.強要]: 800,
    },
    masterSources: { [SOURCE_ID.快Ｖ]: 1000 },
    targetExp: [[EXP_ID.挿入経験, 1]],
    masterExp: [[EXP_ID.Ｖ性交経験, 1]],
    targetTcvars: {
      [TCVAR_ID.童貞喪失]: 1,
      [TCVAR_ID.射精箇所]: 1,
      [TCVAR_ID.嗜虐フラグ]: 1,
    },
    masterTcvars: { [TCVAR_ID.射精箇所]: 13 },
    targetTcvarDeltas: { [TCVAR_ID.射精快感強度]: 1000 },
    masterTcvarDeltas: { [TCVAR_ID.射精快感強度]: 150 },
    able: (state, target) => canReverseInitialHInsertion(state, target, "v"),
    order: (state, target) => BASE_WEIGHT +
      (state.charas[target]?.state.ABL[ABL_ID.Ｃ感覚] ?? 0) +
      ejaculationWeight(state.charas[target]),
  }),
  serviceAction({
    id: 83,
    label: "被後背位",
    counterType: "性交",
    actor: (_state, target) => target,
    contactTarget: 0,
    actorPart: TOUCH_PART.Ｐ,
    targetPart: TOUCH_PART.Ｖ,
    touchPose: 2,
    touchResetCurrent: true,
    insertion: { site: "v", initial: true },
    usageFlag: TFLAG_ID.Ｖ使用中,
    sources: {
      [SOURCE_ID.性行動]: 300,
      [SOURCE_ID.征服]: 1500,
      [SOURCE_ID.誘惑]: 300,
      [SOURCE_ID.加虐]: 600,
      [SOURCE_ID.強要]: 600,
    },
    masterSources: { [SOURCE_ID.快Ｖ]: 1000 },
    targetExp: [[EXP_ID.挿入経験, 1]],
    masterExp: [[EXP_ID.Ｖ性交経験, 1]],
    targetTcvars: {
      [TCVAR_ID.童貞喪失]: 1,
      [TCVAR_ID.射精箇所]: 1,
      [TCVAR_ID.嗜虐フラグ]: 1,
    },
    masterTcvars: { [TCVAR_ID.射精箇所]: 13 },
    targetTcvarDeltas: { [TCVAR_ID.射精快感強度]: 1000 },
    masterTcvarDeltas: { [TCVAR_ID.射精快感強度]: 150 },
    able: (state, target) => canReverseInitialHInsertion(state, target, "v"),
    order: (state, target) => Math.trunc(BASE_WEIGHT * 7 / 10) +
      (state.charas[target]?.state.ABL[ABL_ID.Ｃ感覚] ?? 0) +
      ejaculationWeight(state.charas[target]) +
      (state.charas[target]?.state.ABL[ABL_ID.施虐属性] ?? 0) / 2,
  }),
  serviceAction({
    id: 84,
    label: "腰振りＶ受け",
    counterType: "性交",
    actor: (_state, target) => target,
    contactTarget: 0,
    actorPart: TOUCH_PART.Ｐ,
    targetPart: TOUCH_PART.Ｖ,
    insertion: { site: "v" },
    usageFlag: TFLAG_ID.Ｖ使用中,
    usageGate: () => true,
    sources: {
      [SOURCE_ID.性行動]: 300,
      [SOURCE_ID.征服]: 1200,
      [SOURCE_ID.誘惑]: 400,
      [SOURCE_ID.加虐]: 400,
      [SOURCE_ID.強要]: 800,
    },
    masterSources: reverseVThrustMasterSources,
    targetExp: [[EXP_ID.挿入経験, 1]],
    masterExp: (state, target) => [
      [EXP_ID.Ｖ性交経験, 1],
      [
        EXP_ID.子宮口開発経験,
        1 + ((state.charas[target]?.state.ABL[ABL_ID.腰] ?? 0) >= 3 ? 1 : 0),
      ],
    ],
    targetTcvars: {
      [TCVAR_ID.射精箇所]: 1,
      [TCVAR_ID.嗜虐フラグ]: 1,
    },
    masterTcvars: { [TCVAR_ID.射精箇所]: 13 },
    targetTcvarDeltas: (state, target) => {
      const cervixExperience = state.master.state.EXP[EXP_ID.子宮口開発経験] ?? 0;
      const favor = state.charas[target]?.state.CFLAG[CFLAG_ID.好感度] ?? 0;
      return {
        [TCVAR_ID.射精快感強度]:
          2500 +
          (favor >= 10000 ? Math.min(Math.trunc(favor / 50), 1000) : 0) +
          (cervixExperience >= 25 ? Math.min(cervixExperience * 5, 1500) : 0),
      };
    },
    masterTcvarDeltas: { [TCVAR_ID.射精快感強度]: 150 },
    able: (state, target) => hasReverseHInsertion(state, target, "v"),
    order: (state, target) => BASE_WEIGHT +
      (state.charas[target]?.state.ABL[ABL_ID.Ｃ感覚] ?? 0),
  }),
  serviceAction({
    id: 85,
    label: "騎乗位Ｖ",
    counterType: "性交",
    actor: 0,
    actorPart: TOUCH_PART.Ｐ,
    targetPart: TOUCH_PART.Ｖ,
    touchPose: 3,
    touchResetCurrent: true,
    insertion: { site: "v", initial: true },
    usageFlags: [TFLAG_ID.Ｃ使用中],
    usageSetFlags: [TFLAG_ID.Ｐ挿入中],
    sources: {
      [SOURCE_ID.征服]: 700,
      [SOURCE_ID.快Ｖ]: 300,
      [SOURCE_ID.情愛]: 150,
      [SOURCE_ID.性行動]: 500,
      [SOURCE_ID.達成]: 300,
      [SOURCE_ID.苦痛]: 250,
      [SOURCE_ID.露出]: 60,
      [SOURCE_ID.加虐]: 200,
    },
    masterTcvars: {
      [TCVAR_ID.童貞喪失]: 1,
      [TCVAR_ID.射精箇所]: 1,
      [TCVAR_ID.射精快感強度]: 1000,
      [TCVAR_ID.行為者]: 0,
    },
    targetExp: (state, target) => [
      [EXP_ID.Ｖ性交経験, 1],
      ...affectionExperience(state, target),
    ],
    targetTcvars: { [TCVAR_ID.嗜虐フラグ]: 1 },
    targetBaseDrains: { [BASE_ID.体力]: 60, [BASE_ID.気力]: 120 },
    able: (state, target) => canForwardInitialHInsertion(state, target, "v"),
    order: (state, target) => BASE_WEIGHT +
      (state.charas[target]?.state.ABL[ABL_ID.Ｖ感覚] ?? 0) * 3 +
      (state.charas[target]?.state.EX[EX_ID.Ｖ寸止め] ?? 0) * 10,
  }),
  serviceAction({
    id: 86,
    label: "だいしゅきホールド",
    counterType: "性交",
    actor: 0,
    actorPart: TOUCH_PART.Ｐ,
    targetPart: TOUCH_PART.Ｖ,
    insertion: { site: "v" },
    usageFlags: [TFLAG_ID.Ｃ使用中],
    usageSetFlags: [TFLAG_ID.Ｐ挿入中],
    usageGate: () => true,
    sources: {
      [SOURCE_ID.快Ｖ]: 200,
      [SOURCE_ID.情愛]: 450,
      [SOURCE_ID.誘惑]: 1000,
      [SOURCE_ID.征服]: 800,
      [SOURCE_ID.強要]: 200,
      [SOURCE_ID.性行動]: 250,
      [SOURCE_ID.達成]: 250,
    },
    masterTcvars: { [TCVAR_ID.行為者]: 0 },
    masterTcvarDeltas: { [TCVAR_ID.射精快感強度]: 1800 },
    targetExp: (state, target) => [
      [EXP_ID.Ｖ性交経験, 1],
      ...affectionExperience(state, target),
    ],
    targetTcvars: { [TCVAR_ID.嗜虐フラグ]: 1 },
    able: (state, target) => {
      const slot = state.charas[target];
      if (!slot || !hasForwardHInsertion(state, target, "v")) return false;
      const partnerLed = slot.state.CFLAG[CFLAG_ID.诶嘿嘿] === 2;
      if ((state.master.state.TCVAR[TCVAR_ID.已射精部位FLAG] ?? 0) !== 1 && !partnerLed) return false;
      if (partnerLed && (slot.state.TCVAR[TCVAR_ID.要去了] ?? 0) === 0) return false;
      if ((slot.state.CFLAG[CFLAG_ID.允许无套] ?? 0) !== 2) return false;
      return ![2, 5].includes(readCurrentTouchPose(state.master));
    },
    order: (state, target) => BASE_WEIGHT +
      (state.charas[target]?.state.ABL[ABL_ID.親密] ?? 0) * 3 +
      (state.charas[target]?.state.EX[EX_ID.Ｖ寸止め] ?? 0) * 10,
  }),
  serviceAction({
    id: 87,
    label: "騎乗位Ａ",
    counterType: "性交",
    actor: 0,
    actorPart: TOUCH_PART.Ｐ,
    targetPart: TOUCH_PART.Ａ,
    touchPose: 3,
    touchResetCurrent: true,
    insertion: { site: "a", initial: true },
    usageFlags: [TFLAG_ID.Ｃ使用中],
    usageSetFlags: [TFLAG_ID.Ｐ挿入中],
    sources: {
      [SOURCE_ID.液体]: 100,
      [SOURCE_ID.快Ａ]: 500,
      [SOURCE_ID.情愛]: 150,
      [SOURCE_ID.性行動]: 500,
      [SOURCE_ID.達成]: 300,
      [SOURCE_ID.苦痛]: 400,
      [SOURCE_ID.露出]: 60,
      [SOURCE_ID.征服]: 700,
      [SOURCE_ID.強要]: 200,
      [SOURCE_ID.加虐]: 300,
    },
    masterTcvars: {
      [TCVAR_ID.童貞喪失]: 1,
      [TCVAR_ID.射精箇所]: 2,
      [TCVAR_ID.射精快感強度]: 1000,
      [TCVAR_ID.行為者]: 0,
    },
    targetExp: (state, target) => [
      [EXP_ID.Ａ性交経験, 1],
      ...affectionExperience(state, target),
    ],
    targetTcvars: {
      [TCVAR_ID.Ａ喪失発生]: 1,
      [TCVAR_ID.奉仕フラグ]: 1,
      [TCVAR_ID.嗜虐フラグ]: 1,
    },
    targetBaseDrains: { [BASE_ID.体力]: 60, [BASE_ID.気力]: 150 },
    able: (state, target) => canForwardInitialHInsertion(state, target, "a"),
    order: (state, target) => BASE_WEIGHT +
      (state.charas[target]?.state.ABL[ABL_ID.Ａ感覚] ?? 0) * 3 +
      (state.charas[target]?.state.EX[EX_ID.Ａ寸止め] ?? 0) * 10,
  }),
  serviceAction({
    id: 88,
    label: "腰振りＶ",
    counterType: "性交",
    actor: 0,
    actorPart: TOUCH_PART.Ｐ,
    targetPart: TOUCH_PART.Ｖ,
    insertion: { site: "v" },
    usageFlags: [TFLAG_ID.Ｃ使用中],
    usageSetFlags: [TFLAG_ID.Ｐ挿入中],
    usageGate: () => true,
    sources: {
      [SOURCE_ID.快Ｖ]: 300,
      [SOURCE_ID.情愛]: 200,
      [SOURCE_ID.性行動]: 500,
      [SOURCE_ID.達成]: 200,
      [SOURCE_ID.征服]: 500,
      [SOURCE_ID.加虐]: 100,
    },
    masterTcvars: {
      [TCVAR_ID.射精箇所]: 1,
      [TCVAR_ID.行為者]: 0,
    },
    masterTcvarDeltas: { [TCVAR_ID.射精快感強度]: 1000 },
    masterBaseDrains: { [BASE_ID.体力]: 40, [BASE_ID.気力]: 80 },
    targetExp: (state, target) => [
      [EXP_ID.Ｖ性交経験, 1],
      ...affectionExperience(state, target),
    ],
    targetTcvars: {
      [TCVAR_ID.嗜虐フラグ]: 1,
      [TCVAR_ID.奉仕フラグ]: 1,
    },
    able: (state, target) => {
      const slot = state.charas[target];
      return Boolean(
        slot &&
        hasVagina(slot) &&
        hasPenis(state.master) &&
        (state.master.state.BASE[BASE_ID.勃起] ?? 0) >= 1000 &&
        hasForwardHInsertion(state, target, "v") &&
        (slot.state.ABL[ABL_ID.腰] ?? 0) >= 2,
      );
    },
    order: (state, target) => BASE_WEIGHT +
      ((state.charas[target]?.state.ABL[ABL_ID.奉仕精神] ?? 0) +
        (state.charas[target]?.state.ABL[ABL_ID.Ｖ感覚] ?? 0)) * 2,
  }),
  serviceAction({
    id: 89,
    label: "腰振りＡ",
    counterType: "性交",
    actor: 0,
    actorPart: TOUCH_PART.Ｐ,
    targetPart: TOUCH_PART.Ａ,
    insertion: { site: "a", transferStain: false },
    usageFlags: [TFLAG_ID.Ｃ使用中],
    usageSetFlags: [TFLAG_ID.Ｐ挿入中],
    usageGate: () => true,
    sources: {
      [SOURCE_ID.快Ａ]: 300,
      [SOURCE_ID.情愛]: 200,
      [SOURCE_ID.性行動]: 500,
      [SOURCE_ID.達成]: 200,
      [SOURCE_ID.征服]: 500,
      [SOURCE_ID.加虐]: 100,
    },
    masterTcvars: { [TCVAR_ID.行為者]: 0 },
    masterTcvarDeltas: { [TCVAR_ID.射精快感強度]: 1000 },
    masterBaseDrains: { [BASE_ID.体力]: 40, [BASE_ID.気力]: 80 },
    targetExp: (state, target) => [
      [EXP_ID.Ａ性交経験, 1],
      ...affectionExperience(state, target),
    ],
    targetTcvars: {
      [TCVAR_ID.嗜虐フラグ]: 1,
      [TCVAR_ID.奉仕フラグ]: 1,
    },
    able: (state, target) => {
      const slot = state.charas[target];
      return Boolean(
        slot &&
        hasVagina(slot) &&
        hasPenis(state.master) &&
        (state.master.state.BASE[BASE_ID.勃起] ?? 0) >= 1000 &&
        hasForwardHInsertion(state, target, "a") &&
        (slot.state.ABL[ABL_ID.腰] ?? 0) >= 2,
      );
    },
    order: (state, target) => BASE_WEIGHT +
      ((state.charas[target]?.state.ABL[ABL_ID.奉仕精神] ?? 0) +
        (state.charas[target]?.state.ABL[ABL_ID.Ａ感覚] ?? 0)) * 2,
  }),
  serviceAction({
    id: 90,
    label: "被後背位Ａ",
    counterType: "責め",
    actor: (_state, target) => target,
    contactTarget: 0,
    actorPart: TOUCH_PART.Ｐ,
    targetPart: TOUCH_PART.Ａ,
    touchPose: 2,
    touchResetCurrent: true,
    insertion: { site: "a", initial: true, transferStain: false },
    usageFlag: TFLAG_ID.Ａ使用中,
    sources: {
      [SOURCE_ID.快Ｃ]: 100,
      [SOURCE_ID.性行動]: 300,
      [SOURCE_ID.征服]: 1000,
      [SOURCE_ID.加虐]: 800,
      [SOURCE_ID.強要]: 800,
    },
    masterSources: {
      [SOURCE_ID.液体]: 100,
      [SOURCE_ID.快Ａ]: 800,
    },
    targetExp: [[EXP_ID.挿入経験, 1]],
    masterExp: [[EXP_ID.Ａ性交経験, 1]],
    targetTcvars: {
      [TCVAR_ID.童貞喪失]: 1,
      [TCVAR_ID.射精箇所]: 2,
      [TCVAR_ID.奉仕フラグ]: 1,
      [TCVAR_ID.嗜虐フラグ]: 1,
    },
    masterTcvars: { [TCVAR_ID.Ａ喪失発生]: 1 },
    targetTcvarDeltas: { [TCVAR_ID.射精快感強度]: 1000 },
    masterTcvarDeltas: { [TCVAR_ID.射精快感強度]: 250 },
    able: (state, target) => canReverseInitialHInsertion(state, target, "a"),
    order: (state, target) => Math.trunc(BASE_WEIGHT * 5 / 10) +
      (state.charas[target]?.state.ABL[ABL_ID.Ｃ感覚] ?? 0) +
      ejaculationWeight(state.charas[target]) +
      (state.charas[target]?.state.ABL[ABL_ID.施虐属性] ?? 0) / 2 -
      ((state.master.state.TALENT[TALENT_ID.性別] ?? 0) & 1) * 4 +
      (state.master.state.ABL[ABL_ID.肛門] ?? 0) * 2 -
      (state.master.state.ABL[ABL_ID.膣] ?? 0),
  }),
  serviceAction({
    id: 91,
    label: "イラマチオされる",
    counterType: "責め",
    actor: (_state, target) => target,
    contactTarget: 0,
    actorPart: TOUCH_PART.Ｐ,
    targetPart: TOUCH_PART.口,
    usageFlag: TFLAG_ID.口使用中,
    stainPair: [STAIN_ID.Ｐ, STAIN_ID.口],
    sources: (state) => {
      const sources: Record<number, number> = {
      [SOURCE_ID.性行動]: 300,
      [SOURCE_ID.征服]: 800,
      [SOURCE_ID.加虐]: 800,
      [SOURCE_ID.強要]: 800,
      [SOURCE_ID.逸脱]: 100,
      };
      if (hasVagina(state.master)) sources[SOURCE_ID.快Ｃ] = 200;
      return sources;
    },
    masterSources: {
      [SOURCE_ID.液体]: 100,
      [SOURCE_ID.快Ｍ]: 80,
    },
    masterExp: [[EXP_ID.口淫経験, 1]],
    targetTcvars: {
      [TCVAR_ID.嗜虐フラグ]: 1,
    },
    targetTcvarDeltas: { [TCVAR_ID.射精快感強度]: 800 },
    able: (state, target) => canReverseOralCounter(state, target),
    order: (state, target) => BASE_WEIGHT +
      (state.charas[target]?.state.ABL[ABL_ID.Ｃ感覚] ?? 0) +
      (state.charas[target]?.state.ABL[ABL_ID.施虐属性] ?? 0),
  }),
  serviceAction({
    id: 93,
    label: "腰振り逆Ａ",
    counterType: "責め",
    actor: (_state, target) => target,
    contactTarget: 0,
    actorPart: TOUCH_PART.Ｐ,
    targetPart: TOUCH_PART.Ａ,
    insertion: { site: "a", transferStain: false },
    usageFlag: TFLAG_ID.Ａ使用中,
    usageGate: () => true,
    sources: {
      [SOURCE_ID.快Ｃ]: 100,
      [SOURCE_ID.性行動]: 300,
      [SOURCE_ID.征服]: 1000,
      [SOURCE_ID.加虐]: 600,
      [SOURCE_ID.強要]: 600,
    },
    masterSources: {
      [SOURCE_ID.液体]: 100,
      [SOURCE_ID.快Ａ]: 1000,
    },
    targetExp: [[EXP_ID.挿入経験, 1]],
    masterExp: [[EXP_ID.Ａ性交経験, 1]],
    targetTcvars: {
      [TCVAR_ID.奉仕フラグ]: 1,
      [TCVAR_ID.嗜虐フラグ]: 1,
    },
    targetTcvarDeltas: { [TCVAR_ID.射精快感強度]: 1000 },
    masterTcvarDeltas: { [TCVAR_ID.射精快感強度]: 250 },
    able: (state, target) => Boolean(
      state.charas[target] &&
      hasPenis(state.charas[target]!) &&
      !analDevelopmentDisabled(state, 0) &&
      hasReverseHInsertion(state, target, "a"),
    ),
    order: (state, target) => BASE_WEIGHT +
      (state.charas[target]?.state.ABL[ABL_ID.Ｃ感覚] ?? 0) +
      ejaculationWeight(state.charas[target]),
  }),
  serviceAction({
    id: 94,
    label: "被正常位Ａ",
    counterType: "責め",
    actor: (_state, target) => target,
    contactTarget: 0,
    actorPart: TOUCH_PART.Ｐ,
    targetPart: TOUCH_PART.Ａ,
    touchPose: 1,
    touchResetCurrent: true,
    insertion: { site: "a", initial: true, transferStain: false },
    usageFlag: TFLAG_ID.Ａ使用中,
    sources: {
      [SOURCE_ID.快Ｃ]: 100,
      [SOURCE_ID.性行動]: 300,
      [SOURCE_ID.征服]: 1000,
      [SOURCE_ID.誘惑]: 400,
      [SOURCE_ID.加虐]: 600,
      [SOURCE_ID.強要]: 800,
    },
    masterSources: {
      [SOURCE_ID.液体]: 100,
      [SOURCE_ID.快Ａ]: 800,
    },
    targetExp: [[EXP_ID.挿入経験, 1]],
    masterExp: [[EXP_ID.Ａ性交経験, 1]],
    targetTcvars: {
      [TCVAR_ID.童貞喪失]: 1,
      [TCVAR_ID.嗜虐フラグ]: 1,
    },
    masterTcvars: { [TCVAR_ID.Ａ喪失発生]: 1 },
    targetTcvarDeltas: { [TCVAR_ID.射精快感強度]: 1000 },
    masterTcvarDeltas: { [TCVAR_ID.射精快感強度]: 250 },
    able: (state, target) => canReverseInitialHInsertion(state, target, "a"),
    order: (state, target) => Math.trunc(BASE_WEIGHT * 8 / 10) +
      (state.charas[target]?.state.ABL[ABL_ID.Ｃ感覚] ?? 0) +
      ejaculationWeight(state.charas[target]) -
      ((state.master.state.TALENT[TALENT_ID.性別] ?? 0) & 1) * 4 +
      (state.master.state.ABL[ABL_ID.肛門] ?? 0) * 2 -
      (state.master.state.ABL[ABL_ID.膣] ?? 0),
  }),
];

export const COUNTER_ACTIONS: readonly CounterActionDef[] = [
  dailyAction(1, "距離が近い", "soft", "コミュ", { 10: 10 }),
  dailyAction(2, "チラ見", "soft", "コミュ", { 10: 20 }),
  dailyAction(3, "おはなし", "daily", "コミュ", { 20: 20 }),
  dailyAction(4, "いい匂い", "soft", "コミュ", { 50: 20 }),
  dailyAction(11, "近寄ってくる", "soft", "ベリーソフト", { 50: 50, 53: 40 }),
  dailyAction(12, "笑顔を浮かべる", "soft", "ベリーソフト", { 50: 40 }),
  dailyAction(13, "構って欲しがる", "soft", "ベリーソフト", { 50: 70, 52: 30 }),
  dailyAction(14, "身をすり寄せる", "soft", "ベリーソフト", { 50: 70, 52: 30 }),
  dailyAction(15, "見つめてくる", "soft", "ベリーソフト", { 50: 40 }),
  insertionAction(41, "正常位Ｖおねだり", "v", 1, (state, target) => insertionOrder("v", state, target, 4)),
  insertionAction(43, "後背位Ｖおねだり", "v", 2, (state, target) => insertionOrder("v", state, target, 3)),
  insertionAction(44, "後背位Ａおねだり", "a", 2, (state, target) => insertionOrder("a", state, target, 3)),
  ...serviceActions,
  ...coercionActions,
  ...sexualActions,
];

/** Look up a counter action def by its upstream CCOM id. */
export function counterActionById(id: number): CounterActionDef | undefined {
  return COUNTER_ACTIONS.find((action) => action.id === id);
}
