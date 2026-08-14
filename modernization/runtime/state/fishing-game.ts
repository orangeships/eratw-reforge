import type { FishCatchResult, FishingLineId, FishingRodId } from "./fishing.js";

export type FishingGamePhase = "casting" | "waiting" | "hook" | "fighting" | "landed" | "escaped" | "snapped";

export interface FishingKojoLine {
  charaNum: number;
  text: string;
  form?: string;
}

export interface FishingGameSession {
  id: string;
  seed: number;
  spotId: number;
  spotName: string;
  partner: number;
  startedAtTick: number;
  rodId: FishingRodId;
  lineId: FishingLineId;
  rodControl: number;
  lineTension: number;
  lineDurability: number;
  catch: FishCatchResult;
  biteDelayMs: number;
  hookWindowMs: number;
  difficulty: number;
  /** Visible population around the spot; old saves default in the reducer. */
  fishDensity?: number;
  /** Authored command kojo captured for the in-scene result presentation. */
  kojoLines?: readonly FishingKojoLine[];
}

/** FishingGameSession outcome that's visible to the player; same as
 *  `FishingSettlementOutcome` in handlers/fishing.ts. The in-scene terminal
 *  phase card branches its label, kojo branch, and confirmation copy per
 *  outcome. */
export type FishingGameOutcome = "landed" | "escaped" | "snapped" | "aborted";

/** Per-outcome settlement result the player sees on the fishing page. Held
 *  separately from `state.fishingGame` so the screen keeps the session alive
 *  while it renders the kojo branch; cleared on commit. */
export interface FishingSettlement {
  outcome: FishingGameOutcome;
  spotName: string;
  /** The catch identity for the terminal card. Persisted alongside the
   *  kojo so the screen can render the catch even after `fishingGame` has
   *  been cleared (session already settled). */
  catch: FishCatchResult;
  /** Authored partner kojo captured at settlement. Branched per outcome
   *  upstream via COM621 dispatch (caught vs. line-snap vs. escaped-hook).
   *  Empty for `aborted` (player left voluntarily, no kojo). */
  settlementKojo: readonly FishingKojoLine[];
  finishedAtTick: number;
}

export interface FishingGameInput {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  reel: boolean;
  action: boolean;
  /** Pointer target in the same 0..100 scene coordinates as all physics. */
  aimX?: number;
  aimY?: number;
}

export const EMPTY_FISHING_INPUT: FishingGameInput = {
  left: false,
  right: false,
  up: false,
  down: false,
  reel: false,
  action: false,
};

export interface FishingShadow {
  x: number;
  y: number;
  size: number;
  heading: 1 | -1;
  speed: number;
  phase: number;
}

export interface FishingGameState {
  phase: FishingGamePhase;
  elapsedMs: number;
  phaseMs: number;
  aimX: number;
  aimY: number;
  lureX: number;
  lureY: number;
  fishX: number;
  fishY: number;
  fishDirection: 1 | -1;
  rodDirection: -1 | 0 | 1;
  fishStamina: number;
  fishMaxStamina: number;
  lineLength: number;
  tension: number;
  lineHealth: number;
  castDensity: number;
  biteTargetMs: number;
  activeShadow: number;
  pulse: number;
  shadows: readonly FishingShadow[];
  splashes: readonly FishingSplash[];
}

export interface FishingSplash { x: number; y: number; age: number; size: number }

export interface FishingStepResult { state: FishingGameState; event?: "cast" | "bite" | "hooked" | "landed" | "escaped" | "snapped" }

const FAN_ORIGIN_X = 50;
const FAN_ORIGIN_Y = 92;
const FAN_MIN_RADIUS = 18;
const FAN_MAX_RADIUS = 62;
const FAN_HALF_ANGLE = Math.PI * 52 / 180;

function noise(seed: number, n: number): number {
  const x = Math.sin(seed * 12.9898 + n * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** Clamp any pointer/keyboard target into the castable fan in scene space. */
export function clampFishingCastPoint(x: number, y: number): { x: number; y: number } {
  const dx = Number.isFinite(x) ? x - FAN_ORIGIN_X : 0;
  const dy = Number.isFinite(y) ? FAN_ORIGIN_Y - y : 42;
  const rawRadius = Math.hypot(dx, dy);
  const radius = Math.max(FAN_MIN_RADIUS, Math.min(FAN_MAX_RADIUS, rawRadius || 42));
  const angle = Math.max(-FAN_HALF_ANGLE, Math.min(FAN_HALF_ANGLE, Math.atan2(dx, Math.max(.001, dy))));
  return {
    x: FAN_ORIGIN_X + Math.sin(angle) * radius,
    y: FAN_ORIGIN_Y - Math.cos(angle) * radius,
  };
}

function pointInFan(seed: number, index: number, cluster: number): { x: number; y: number } {
  const clusterAngle = (noise(seed, 100 + cluster) * 1.6 - .8) * FAN_HALF_ANGLE;
  const clusterRadius = 27 + noise(seed, 120 + cluster) * 35;
  const angle = clusterAngle + (noise(seed, 200 + index) - .5) * .34;
  const radius = clusterRadius + (noise(seed, 300 + index) - .5) * 19;
  return clampFishingCastPoint(
    FAN_ORIGIN_X + Math.sin(angle) * radius,
    FAN_ORIGIN_Y - Math.cos(angle) * radius,
  );
}

function createShadows(session: FishingGameSession): FishingShadow[] {
  const count = Math.max(12, Math.min(38, Math.round(session.fishDensity ?? 20)));
  return Array.from({ length: count }, (_, index) => {
    const point = pointInFan(session.seed, index, index % 3);
    return {
      ...point,
      size: 1.1 + noise(session.seed, 400 + index) * 1.9,
      heading: noise(session.seed, 500 + index) > .5 ? 1 as const : -1 as const,
      speed: .00025 + noise(session.seed, 600 + index) * .00032,
      phase: noise(session.seed, 700 + index) * Math.PI * 2,
    };
  });
}

function staminaForCatch(session: FishingGameSession): number {
  const size = Math.max(5, session.catch.sizeCm ?? 18);
  return 42 + Math.sqrt(size) * 9 + session.catch.rank * .22;
}

export function createFishingGameState(session: FishingGameSession): FishingGameState {
  const stamina = staminaForCatch(session);
  const aim = clampFishingCastPoint(50, 43);
  const shadows = createShadows(session);
  return {
    phase: "casting",
    elapsedMs: 0,
    phaseMs: 0,
    aimX: aim.x,
    aimY: aim.y,
    lureX: aim.x,
    lureY: aim.y,
    fishX: shadows[0]?.x ?? aim.x,
    fishY: shadows[0]?.y ?? aim.y,
    fishDirection: noise(session.seed, 3) > .5 ? 1 : -1,
    rodDirection: 0,
    fishStamina: stamina,
    fishMaxStamina: stamina,
    lineLength: 100,
    tension: 18,
    lineHealth: session.lineDurability,
    castDensity: 0,
    biteTargetMs: session.biteDelayMs,
    activeShadow: 0,
    pulse: 0,
    shadows,
    splashes: [],
  };
}

function enter(state: FishingGameState, phase: FishingGamePhase): FishingGameState {
  return { ...state, phase, phaseMs: 0 };
}

function terminal(phase: FishingGamePhase): boolean {
  return phase === "landed" || phase === "escaped" || phase === "snapped";
}

function driftShadows(shadows: readonly FishingShadow[], elapsedMs: number, dt: number): FishingShadow[] {
  return shadows.map((shadow, index) => {
    const wave = Math.sin(elapsedMs * .00055 + shadow.phase + index) * .00022;
    let heading = shadow.heading;
    const point = clampFishingCastPoint(shadow.x + heading * shadow.speed * dt, shadow.y + wave * dt);
    if (Math.abs(point.x - shadow.x) < shadow.speed * dt * .2) heading = heading === 1 ? -1 : 1;
    return { ...shadow, ...point, heading };
  });
}

function densityAt(shadows: readonly FishingShadow[], x: number, y: number): number {
  return shadows.reduce((sum, shadow) => {
    const distance = Math.hypot(shadow.x - x, shadow.y - y);
    return sum + Math.max(0, 1 - distance / 12) * (.7 + shadow.size * .18);
  }, 0);
}

function nearestShadow(shadows: readonly FishingShadow[], x: number, y: number): number {
  let best = 0;
  let distance = Number.POSITIVE_INFINITY;
  shadows.forEach((shadow, index) => {
    const candidate = Math.hypot(shadow.x - x, shadow.y - y);
    if (candidate < distance) { distance = candidate; best = index; }
  });
  return best;
}

/** Fixed-step top-down fishing reducer. All physics use normalized scene coordinates. */
export function stepFishingGame(
  current: FishingGameState,
  session: FishingGameSession,
  input: FishingGameInput,
  dtMs = 1000 / 60,
): FishingStepResult {
  if (terminal(current.phase)) return { state: current };
  const dt = Math.min(50, Math.max(0, dtMs));
  let state: FishingGameState = {
    ...current,
    elapsedMs: current.elapsedMs + dt,
    phaseMs: current.phaseMs + dt,
    pulse: Math.max(0, current.pulse - dt / 220),
    shadows: driftShadows(current.shadows, current.elapsedMs + dt, dt),
    splashes: current.splashes.map((splash) => ({ ...splash, age: splash.age + dt })).filter((splash) => splash.age < 900),
  };

  if (state.phase === "casting") {
    const pointerTarget = input.aimX !== undefined && input.aimY !== undefined
      ? { x: input.aimX, y: input.aimY }
      : { x: state.aimX + (Number(input.right) - Number(input.left)) * dt * .026, y: state.aimY + (Number(input.down) - Number(input.up)) * dt * .026 };
    const aim = clampFishingCastPoint(pointerTarget.x, pointerTarget.y);
    state = { ...state, aimX: aim.x, aimY: aim.y, lureX: aim.x, lureY: aim.y };
    if (input.action) {
      const castDensity = densityAt(state.shadows, aim.x, aim.y);
      const activeShadow = nearestShadow(state.shadows, aim.x, aim.y);
      const densitySpeed = Math.max(.62, Math.min(2.45, .62 + castDensity * .24));
      state = enter({
        ...state,
        castDensity,
        biteTargetMs: session.biteDelayMs / densitySpeed,
        activeShadow,
        fishX: state.shadows[activeShadow]?.x ?? aim.x,
        fishY: state.shadows[activeShadow]?.y ?? aim.y,
        splashes: [...state.splashes, { x: aim.x, y: aim.y, age: 0, size: 5 }],
      }, "waiting");
      return { state, event: "cast" };
    }
    return { state };
  }

  if (state.phase === "waiting") {
    const approach = Math.min(1, state.phaseMs / Math.max(1, state.biteTargetMs));
    const easing = Math.min(.065, dt * .00115) * (.5 + approach);
    state = { ...state, fishX: state.fishX + (state.lureX - state.fishX) * easing, fishY: state.fishY + (state.lureY - state.fishY) * easing };
    if (input.action && state.phaseMs < state.biteTargetMs - 240) return { state: enter(state, "casting"), event: "escaped" };
    if (state.phaseMs >= state.biteTargetMs) {
      state = enter({ ...state, fishX: state.lureX, fishY: state.lureY, pulse: 1, splashes: [...state.splashes, { x: state.lureX, y: state.lureY, age: 0, size: 11 }] }, "hook");
      return { state, event: "bite" };
    }
    return { state };
  }

  if (state.phase === "hook") {
    if (input.action) {
      state = enter({ ...state, tension: 38, pulse: 1 }, "fighting");
      return { state, event: "hooked" };
    }
    if (state.phaseMs > session.hookWindowMs) return { state: enter(state, "escaped"), event: "escaped" };
    return { state };
  }

  // Fish stamina drains steadily. Missing its left/right run consumes the line.
  const period = Math.max(620, 1450 - session.difficulty * 5.2);
  const segment = Math.floor(state.phaseMs / period);
  let fishDirection: 1 | -1 = noise(session.seed, 20 + segment) > .5 ? 1 : -1;
  const burst = noise(session.seed, 90 + segment) > .72 ? 1.42 : 1;
  const fishSpeed = (.005 + session.difficulty * .000026) * burst;
  let fishX = state.fishX + fishDirection * fishSpeed * dt;
  if (fishX < 12 || fishX > 88) {
    fishDirection = fishX < 12 ? 1 : -1;
    fishX = Math.max(12, Math.min(88, fishX));
  }
  const rodDirection: -1 | 0 | 1 = input.left === input.right ? 0 : input.left ? -1 : 1;
  const aligned = rodDirection === fishDirection;
  const tensionRate = aligned ? -42 - session.rodControl * 6 : 31 + session.difficulty * .11;
  const tension = Math.max(9, Math.min(100, state.tension + tensionRate * dt / 1000));
  const staminaDrain = 8.8 + session.rodControl * 1.7;
  const expectedFightSeconds = state.fishMaxStamina / staminaDrain;
  const lineForgiveness = Math.min(.84, .55 + (session.lineTension - 1) * .5 + (Math.sqrt(session.lineDurability / 100) - 1) * .12);
  const damageRate = session.lineDurability / Math.max(1, expectedFightSeconds * lineForgiveness) * burst;
  const lineHealth = aligned ? state.lineHealth : state.lineHealth - damageRate * dt / 1000;
  const fishStamina = Math.max(0, state.fishStamina - staminaDrain * dt / 1000);
  const fishY = Math.max(20, Math.min(73, state.aimY + Math.sin(state.phaseMs * .0035 + session.seed) * 6));
  const lineLength = Math.max(0, Math.min(100, 35 + Math.hypot(fishX - 50, fishY - FAN_ORIGIN_Y)));
  const splashTick = Math.floor(state.phaseMs / 330) !== Math.floor((state.phaseMs - dt) / 330);
  state = {
    ...state,
    fishX,
    fishY,
    lureX: fishX,
    lureY: fishY,
    fishDirection,
    rodDirection,
    tension,
    lineHealth,
    fishStamina,
    lineLength,
    splashes: splashTick ? [...state.splashes, { x: fishX, y: fishY, age: 0, size: 3 + burst * 2 }] : state.splashes,
  };
  if (lineHealth <= 0) return { state: enter(state, "snapped"), event: "snapped" };
  if (fishStamina <= 0) return { state: enter(state, "landed"), event: "landed" };
  return { state };
}
