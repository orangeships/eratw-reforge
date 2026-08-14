/**
 * Deterministic fixed-step polygon physics for COM633.
 *
 * Stones are convex, irregular seeded polygons. Placement operations only
 * record the chosen candidate plus release pose; gravity, collision, toppling
 * and return-tray loss are reconstructed from that compact stream. Canvas is
 * presentation-only and never decides the score.
 */

export const STONE_WORLD_WIDTH_Q = 10_000;
export const STONE_FLOOR_Y_Q = 0;
export const STONE_PLATFORM_LEFT_Q = 2_350;
export const STONE_PLATFORM_RIGHT_Q = 7_650;
export const STONE_SPAWN_Y_Q = 6_250;
export const STONE_FIXED_STEP_MS = 20;
export const STONE_CONTEST_DURATION_FRAMES = 30_000 / STONE_FIXED_STEP_MS;

export type StoneActor = "player" | "partner";

export interface StonePointQ {
  xQ: number;
  yQ: number;
}

export interface StoneCandidate {
  candidateId: number;
  sizeQ: number;
  irregularityQ: number;
  widthQ: number;
  heightQ: number;
  verticesQ: StonePointQ[];
}

export interface StonePlacementOperation {
  kind: "place";
  /** Fixed-step frame at which the stone is released. */
  frame: number;
  actor: StoneActor;
  /** Horizontal release centre, quantized to [0, 10000]. */
  xQ: number;
  /** Initial rotation in five-degree units, clamped to [-12, 12]. */
  rotationQ: number;
  /** Candidate-derived size bucket, retained for old-save compatibility. */
  sizeQ: number;
  /** Theme gesture chosen for this stone, 0..3. */
  motifQ: number;
  /** Stable seeded candidate identity. */
  candidateId: number;
}

export interface StoneBody {
  id: number;
  actor: StoneActor;
  candidateId: number;
  xQ: number;
  yQ: number;
  /** Tenths of one degree. */
  angleQ: number;
  widthQ: number;
  heightQ: number;
  verticesQ: StonePointQ[];
  motifQ: number;
  vxQ: number;
  vyQ: number;
  angularVelocityQ: number;
  state: "falling" | "stacked" | "returned";
  stable: boolean;
  restFrames: number;
}

export interface StoneReplayConfig {
  seed?: number;
  difficulty?: number;
  untilFrame?: number;
  /** One deterministic rescue supplied by the small-stone hat. */
  rescueCollapse?: boolean;
  /** Kept for save/API compatibility; now influences contact friction. */
  supportToleranceQ?: number;
}

export interface StoneReplayResult {
  bodies: StoneBody[];
  collapsedAt: number | null;
  rescued: boolean;
  returnedCount: number;
  stableCount: number;
  heightQ: number;
  precisionPermil: number;
  rhythmPermil: number;
  motifPermil: number;
  simulatedFrames: number;
}

export interface StoneSimulationState {
  frame: number;
  bodies: StoneBody[];
  operationIndex: number;
  rescueAvailable: boolean;
  rescued: boolean;
}

interface Axis {
  x: number;
  y: number;
}

interface Collision {
  normal: Axis;
  depth: number;
}

function integer(value: number, fallback = 0): number {
  return Number.isFinite(value) ? Math.trunc(value) : fallback;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, integer(value)));
}

function quantize(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function hash32(seed: number): number {
  let value = seed >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return value >>> 0;
}

function randomUnit(seed: number): number {
  return hash32(seed) / 0x1_0000_0000;
}

function cross(origin: StonePointQ, a: StonePointQ, b: StonePointQ): number {
  return (a.xQ - origin.xQ) * (b.yQ - origin.yQ) - (a.yQ - origin.yQ) * (b.xQ - origin.xQ);
}

function convexHull(points: StonePointQ[]): StonePointQ[] {
  const sorted = [...points].sort((a, b) => a.xQ - b.xQ || a.yQ - b.yQ);
  const lower: StonePointQ[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper: StonePointQ[] = [];
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index]!;
    while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, point) <= 0) upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

/** Creates a visibly non-geometric candidate. Harder ranks increase radial
 * variance and add asymmetrical hull points, while keeping the body convex so
 * collision resolution remains stable. */
export function stoneCandidate(seed: number, candidateId: number, difficulty = 0): StoneCandidate {
  const hard = clamp(difficulty, 0, 8);
  const sizeSeed = hash32(seed ^ Math.imul(candidateId + 1, 0x45d9f3b));
  const sizeQ = sizeSeed % 5;
  const radiusX = 430 + sizeQ * 78;
  const radiusY = 300 + sizeQ * 56;
  const irregularityQ = 150 + hard * 48 + (hash32(sizeSeed ^ 0x633) % 90);
  const samples = 14 + Math.trunc(hard / 2);
  const raw: StonePointQ[] = [];
  for (let index = 0; index < samples; index += 1) {
    const angle = Math.PI * 2 * index / samples + (randomUnit(sizeSeed ^ Math.imul(index + 9, 97_409)) - .5) * (.11 + hard * .012);
    const variance = (randomUnit(sizeSeed ^ Math.imul(index + 17, 2_654_435_761)) * 2 - 1) * irregularityQ / 1_000;
    const asymmetric = 1 + Math.sin(angle * 3 + randomUnit(sizeSeed ^ 0xa511e9b3) * 4) * (.055 + hard * .009);
    raw.push({
      xQ: Math.round(Math.cos(angle) * radiusX * (1 + variance) * asymmetric),
      yQ: Math.round(Math.sin(angle) * radiusY * (1 + variance * .72) / asymmetric),
    });
  }
  const hull = convexHull(raw);
  const centreX = Math.round((Math.min(...hull.map((point) => point.xQ)) + Math.max(...hull.map((point) => point.xQ))) / 2);
  const centreY = Math.round((Math.min(...hull.map((point) => point.yQ)) + Math.max(...hull.map((point) => point.yQ))) / 2);
  const verticesQ = hull.map((point) => ({ xQ: point.xQ - centreX, yQ: point.yQ - centreY }));
  const widthQ = Math.max(...verticesQ.map((point) => point.xQ)) - Math.min(...verticesQ.map((point) => point.xQ));
  const heightQ = Math.max(...verticesQ.map((point) => point.yQ)) - Math.min(...verticesQ.map((point) => point.yQ));
  return { candidateId, sizeQ, irregularityQ, widthQ, heightQ, verticesQ };
}

/** Reconstructs the three-slot tray solely from the accepted player stream. */
export function stoneCandidateQueue(
  seed: number,
  difficulty: number,
  rawOperations: readonly StonePlacementOperation[],
): StoneCandidate[] {
  const queue = [0, 1, 2];
  let nextId = 3;
  for (const raw of rawOperations) {
    const operation = normalizeStoneOperation(raw);
    if (operation.actor !== "player") continue;
    const chosen = queue.indexOf(operation.candidateId);
    if (chosen >= 0) queue.splice(chosen, 1);
    else queue.shift();
    queue.push(nextId);
    nextId += 1;
  }
  return queue.map((candidateId) => stoneCandidate(seed, candidateId, difficulty));
}

export function normalizeStoneOperation(value: StonePlacementOperation): StonePlacementOperation {
  return {
    kind: "place",
    frame: clamp(value.frame, 0, STONE_CONTEST_DURATION_FRAMES),
    actor: value.actor === "partner" ? "partner" : "player",
    xQ: clamp(value.xQ, 0, STONE_WORLD_WIDTH_Q),
    rotationQ: clamp(value.rotationQ, -12, 12),
    sizeQ: clamp(value.sizeQ, 0, 4),
    motifQ: clamp(value.motifQ, 0, 3),
    candidateId: Math.max(0, integer(value.candidateId, 0)),
  };
}

/** Pointer/touch and keyboard routes share this normalized operation shape. */
export function stoneOperationFromPointer(
  frame: number,
  clientX: number,
  left: number,
  width: number,
  rotationQ: number,
  sizeQ: number,
  motifQ: number,
  actor: StoneActor = "player",
  candidateId = 0,
): StonePlacementOperation {
  const safeWidth = Math.max(1, width);
  const xQ = Math.round(((clientX - left) / safeWidth) * STONE_WORLD_WIDTH_Q);
  return normalizeStoneOperation({ kind: "place", frame, actor, xQ, rotationQ, sizeQ, motifQ, candidateId });
}

export function stoneOperationFromKeyboard(
  frame: number,
  cursorQ: number,
  rotationQ: number,
  sizeQ: number,
  motifQ: number,
  actor: StoneActor = "player",
  candidateId = 0,
): StonePlacementOperation {
  return normalizeStoneOperation({ kind: "place", frame, actor, xQ: cursorQ, rotationQ, sizeQ, motifQ, candidateId });
}

function worldVertices(body: StoneBody): StonePointQ[] {
  const angle = body.angleQ * Math.PI / 1_800;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return body.verticesQ.map((point) => ({
    xQ: quantize(body.xQ + point.xQ * cos - point.yQ * sin),
    yQ: quantize(body.yQ + point.xQ * sin + point.yQ * cos),
  }));
}

function polygonAxes(points: readonly StonePointQ[]): Axis[] {
  return points.map((point, index) => {
    const next = points[(index + 1) % points.length]!;
    const edgeX = next.xQ - point.xQ;
    const edgeY = next.yQ - point.yQ;
    const length = Math.max(.001, Math.hypot(edgeX, edgeY));
    return { x: -edgeY / length, y: edgeX / length };
  });
}

function project(points: readonly StonePointQ[], axis: Axis): { min: number; max: number } {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    const value = point.xQ * axis.x + point.yQ * axis.y;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return { min, max };
}

function collide(a: StoneBody, b: StoneBody): Collision | null {
  if (Math.abs(a.xQ - b.xQ) > (a.widthQ + b.widthQ) * .56 || Math.abs(a.yQ - b.yQ) > (a.heightQ + b.heightQ) * .62) return null;
  const aPoints = worldVertices(a);
  const bPoints = worldVertices(b);
  const aMinX = Math.min(...aPoints.map((point) => point.xQ));
  const aMaxX = Math.max(...aPoints.map((point) => point.xQ));
  const aMinY = Math.min(...aPoints.map((point) => point.yQ));
  const aMaxY = Math.max(...aPoints.map((point) => point.yQ));
  const bMinX = Math.min(...bPoints.map((point) => point.xQ));
  const bMaxX = Math.max(...bPoints.map((point) => point.xQ));
  const bMinY = Math.min(...bPoints.map((point) => point.yQ));
  const bMaxY = Math.max(...bPoints.map((point) => point.yQ));
  if (aMaxX <= bMinX || bMaxX <= aMinX || aMaxY <= bMinY || bMaxY <= aMinY) return null;
  let depth = Number.POSITIVE_INFINITY;
  let normal: Axis = { x: 0, y: 1 };
  for (const axis of [...polygonAxes(aPoints), ...polygonAxes(bPoints)]) {
    const aRange = project(aPoints, axis);
    const bRange = project(bPoints, axis);
    const overlap = Math.min(aRange.max, bRange.max) - Math.max(aRange.min, bRange.min);
    if (overlap <= 0) return null;
    if (overlap < depth) { depth = overlap; normal = axis; }
  }
  if ((b.xQ - a.xQ) * normal.x + (b.yQ - a.yQ) * normal.y < 0) normal = { x: -normal.x, y: -normal.y };
  return { normal, depth };
}

function spawnBody(operation: StonePlacementOperation, config: StoneReplayConfig, id: number): StoneBody {
  const candidate = stoneCandidate(config.seed ?? 0, operation.candidateId, config.difficulty ?? 0);
  return {
    id,
    actor: operation.actor,
    candidateId: operation.candidateId,
    xQ: operation.xQ,
    yQ: STONE_SPAWN_Y_Q + candidate.heightQ / 2,
    angleQ: operation.rotationQ * 50,
    widthQ: candidate.widthQ,
    heightQ: candidate.heightQ,
    verticesQ: candidate.verticesQ,
    motifQ: operation.motifQ,
    vxQ: 0,
    vyQ: 0,
    angularVelocityQ: operation.rotationQ * 0.08,
    state: "falling",
    stable: false,
    restFrames: 0,
  };
}

function resolveFloor(body: StoneBody, contacted: Set<number>, friction: number): void {
  const points = worldVertices(body);
  const minY = Math.min(...points.map((point) => point.yQ));
  const minX = Math.min(...points.map((point) => point.xQ));
  const maxX = Math.max(...points.map((point) => point.xQ));
  if (minY >= STONE_FLOOR_Y_Q || body.xQ <= STONE_PLATFORM_LEFT_Q || body.xQ >= STONE_PLATFORM_RIGHT_Q || maxX <= minX) return;
  body.yQ += STONE_FLOOR_Y_Q - minY;
  if (body.vyQ < 0) body.vyQ = -body.vyQ * .11;
  body.vxQ *= friction;
  body.angularVelocityQ *= .76;
  contacted.add(body.id);
}

function resolvePair(a: StoneBody, b: StoneBody, contacted: Set<number>, friction: number): void {
  if (a.stable && b.stable) return;
  const collision = collide(a, b);
  if (!collision) return;
  const aInv = a.restFrames > 24 ? .22 : 1;
  const bInv = b.restFrames > 24 ? .22 : 1;
  const sum = aInv + bInv;
  const correction = collision.depth + .5;
  a.xQ -= collision.normal.x * correction * aInv / sum;
  a.yQ -= collision.normal.y * correction * aInv / sum;
  b.xQ += collision.normal.x * correction * bInv / sum;
  b.yQ += collision.normal.y * correction * bInv / sum;
  const relative = (b.vxQ - a.vxQ) * collision.normal.x + (b.vyQ - a.vyQ) * collision.normal.y;
  if (relative < 0) {
    const impulse = -(1.08 * relative) / sum;
    a.vxQ -= impulse * collision.normal.x * aInv;
    a.vyQ -= impulse * collision.normal.y * aInv;
    b.vxQ += impulse * collision.normal.x * bInv;
    b.vyQ += impulse * collision.normal.y * bInv;
  }
  a.vxQ *= friction;
  b.vxQ *= friction;
  const torque = collision.normal.x * Math.min(18, collision.depth * .018);
  a.angularVelocityQ -= torque * aInv;
  b.angularVelocityQ += torque * bInv;
  contacted.add(a.id);
  contacted.add(b.id);
}

function advanceFrame(bodies: StoneBody[], config: StoneReplayConfig, rescue: { available: boolean; used: boolean }): void {
  const active = bodies.filter((body) => body.state !== "returned");
  for (const body of active) {
    if (body.stable) continue;
    body.vyQ = Math.max(-250, body.vyQ - 14);
    body.vxQ *= .996;
    body.angularVelocityQ *= .994;
    body.xQ += body.vxQ;
    body.yQ += body.vyQ;
    body.angleQ += body.angularVelocityQ;
  }
  const contacted = new Set<number>();
  const friction = clamp(config.supportToleranceQ ?? 0, -500, 700) >= 200 ? .72 : clamp(config.supportToleranceQ ?? 0, -500, 700) < 0 ? .88 : .81;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    for (const body of active) resolveFloor(body, contacted, friction);
    for (let aIndex = 0; aIndex < active.length; aIndex += 1) {
      for (let bIndex = aIndex + 1; bIndex < active.length; bIndex += 1) {
        resolvePair(active[aIndex]!, active[bIndex]!, contacted, friction);
      }
    }
  }
  for (const body of active) {
    // A settled stone is intentionally not integrated on the next fixed
    // step. Its polygon is exactly on the floor, so resolveFloor has no
    // penetration to correct and contacted[] is empty. Recomputing stable
    // from that empty set made every resting stone flip back to falling for a
    // frame, which caused stacks to jitter and re-collide indefinitely.
    const wasStable = body.stable;
    if (wasStable && !contacted.has(body.id)) {
      body.state = "stacked";
      continue;
    }
    const slow = Math.abs(body.vxQ) < 7 && Math.abs(body.vyQ) < 7 && Math.abs(body.angularVelocityQ) < 2.2;
    body.restFrames = contacted.has(body.id) && slow ? body.restFrames + 1 : 0;
    body.stable = contacted.has(body.id) && body.restFrames >= 10;
    body.state = body.stable || contacted.has(body.id) ? "stacked" : "falling";
    if (body.yQ < -1_100 || body.xQ < -1_500 || body.xQ > STONE_WORLD_WIDTH_Q + 1_500) {
      if (rescue.available) {
        rescue.available = false;
        rescue.used = true;
        body.xQ = STONE_WORLD_WIDTH_Q / 2;
        body.yQ = STONE_SPAWN_Y_Q + body.heightQ / 2;
        body.vxQ = 0;
        body.vyQ = 0;
        body.angularVelocityQ *= .25;
        body.state = "falling";
      } else {
        body.state = "returned";
        body.stable = false;
      }
    }
    body.xQ = quantize(body.xQ);
    body.yQ = quantize(body.yQ);
    body.vxQ = quantize(body.vxQ);
    body.vyQ = quantize(body.vyQ);
    body.angleQ = quantize(body.angleQ);
    body.angularVelocityQ = quantize(body.angularVelocityQ);
  }
}

function replayMetrics(operations: readonly StonePlacementOperation[]): Pick<StoneReplayResult, "precisionPermil" | "rhythmPermil" | "motifPermil"> {
  if (operations.length === 0) return { precisionPermil: 0, rhythmPermil: 1000, motifPermil: 0 };
  let precision = 0;
  let motif = 0;
  let rhythmPenalty = 0;
  for (let index = 0; index < operations.length; index += 1) {
    const operation = operations[index]!;
    const prior = operations[index - 1];
    const desired = prior?.xQ ?? STONE_WORLD_WIDTH_Q / 2;
    precision += Math.max(0, 1000 - Math.trunc(Math.abs(operation.xQ - desired) / 3));
    motif += operation.motifQ === index % 4 ? 1000 : operation.motifQ === (index + 1) % 4 ? 650 : 300;
    if (prior) rhythmPenalty += Math.min(1000, Math.abs(operation.frame - prior.frame - 65) * 8);
  }
  return {
    precisionPermil: Math.trunc(precision / operations.length),
    rhythmPermil: operations.length < 2 ? 1000 : Math.max(0, 1000 - Math.trunc(rhythmPenalty / (operations.length - 1))),
    motifPermil: Math.trunc(motif / operations.length),
  };
}

function orderedOperations(rawOperations: readonly StonePlacementOperation[]): StonePlacementOperation[] {
  return rawOperations
    .map(normalizeStoneOperation)
    .sort((a, b) => a.frame - b.frame || (a.actor === b.actor ? a.candidateId - b.candidateId : a.actor === "player" ? -1 : 1));
}

export function createStoneSimulation(config: StoneReplayConfig = {}): StoneSimulationState {
  return { frame: -1, bodies: [], operationIndex: 0, rescueAvailable: config.rescueCollapse === true, rescued: false };
}

/** Incremental form used by the live canvas. It advances only newly elapsed
 * fixed steps while preserving the exact same result as a full replay. */
export function advanceStoneSimulation(
  previous: Readonly<StoneSimulationState>,
  rawOperations: readonly StonePlacementOperation[],
  config: StoneReplayConfig,
  targetFrame: number,
): StoneSimulationState {
  const operations = orderedOperations(rawOperations);
  const state: StoneSimulationState = {
    frame: previous.frame,
    bodies: previous.bodies.map((body) => ({ ...body, verticesQ: body.verticesQ })),
    operationIndex: Math.min(previous.operationIndex, operations.length),
    rescueAvailable: previous.rescueAvailable,
    rescued: previous.rescued,
  };
  const untilFrame = clamp(targetFrame, state.frame, STONE_CONTEST_DURATION_FRAMES + 300);
  const rescue = { available: state.rescueAvailable, used: state.rescued };
  for (let frame = state.frame + 1; frame <= untilFrame; frame += 1) {
    while (state.operationIndex < operations.length && operations[state.operationIndex]!.frame <= frame) {
      state.bodies.push(spawnBody(operations[state.operationIndex]!, config, state.operationIndex));
      state.operationIndex += 1;
    }
    const nextOperationFrame = operations[state.operationIndex]?.frame ?? Number.POSITIVE_INFINITY;
    if (state.bodies.length > 0 && state.bodies.every((body) => body.state === "returned" || body.stable) && nextOperationFrame > frame + 1) {
      frame = Math.min(untilFrame, nextOperationFrame - 1);
      state.frame = frame;
      continue;
    }
    advanceFrame(state.bodies, config, rescue);
    state.frame = frame;
  }
  state.rescueAvailable = rescue.available;
  state.rescued = rescue.used;
  return state;
}

export function stoneReplayFromSimulation(
  simulation: Readonly<StoneSimulationState>,
  rawOperations: readonly StonePlacementOperation[],
): StoneReplayResult {
  const operations = orderedOperations(rawOperations).slice(0, simulation.operationIndex);
  const bodies = simulation.bodies.map((body) => ({ ...body, verticesQ: body.verticesQ }));
  const returned = bodies.filter((body) => body.state === "returned");
  const standing = bodies.filter((body) => body.state === "stacked" && body.yQ >= -1);
  const metrics = replayMetrics(operations);
  return {
    bodies,
    collapsedAt: returned[0]?.id ?? null,
    rescued: simulation.rescued,
    returnedCount: returned.length,
    stableCount: standing.length,
    heightQ: standing.reduce((max, body) => Math.max(max, ...worldVertices(body).map((point) => point.yQ)), 0),
    ...metrics,
    simulatedFrames: Math.max(0, simulation.frame),
  };
}

/** Replays gravity and polygon collisions to an exact fixed-step frame. */
export function replayStoneOperations(
  rawOperations: readonly StonePlacementOperation[],
  config: StoneReplayConfig = {},
): StoneReplayResult {
  const operations = orderedOperations(rawOperations);
  const requested = config.untilFrame ?? Math.max(STONE_CONTEST_DURATION_FRAMES, (operations.at(-1)?.frame ?? 0) + 260);
  const untilFrame = clamp(requested, 0, STONE_CONTEST_DURATION_FRAMES + 300);
  const simulation = advanceStoneSimulation(createStoneSimulation(config), operations, config, untilFrame);
  return stoneReplayFromSimulation(simulation, operations);
}
