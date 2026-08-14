/** Fixed-step, browser-safe danmaku simulation for the full-screen battle. */
export type DanmakuMode = "training" | "duel";
export interface BattleInput { up: boolean; down: boolean; left: boolean; right: boolean; focus: boolean; }
export const EMPTY_BATTLE_INPUT: BattleInput = { up: false, down: false, left: false, right: false, focus: false };

export type DanmakuBulletShape = "orb" | "needle" | "diamond" | "petal";
export type DanmakuBulletBehavior = "linear" | "aunn-bend" | "aunn-dog" | "spiral";
export type DanmakuPattern = "training" | "aunn" | "suika";
export type DanmakuEmitterKind =
  | "aunn-bend"
  | "aunn-dog"
  | "aunn-cross"
  | "aunn-cluster"
  | "suika-radial"
  | "suika-orbiters"
  | "suika-heavy";
export interface DanmakuBullet {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  baseVx: number;
  baseVy: number;
  radius: number;
  color: string;
  shape: DanmakuBulletShape;
  behavior: DanmakuBulletBehavior;
  age: number;
  turn: number;
  lockCount: number;
  grazed: boolean;
}
export interface DanmakuLaserPoint { x: number; y: number; }
export interface DanmakuLaser { id: number; points: DanmakuLaserPoint[]; width: number; color: string; }
export interface DanmakuShot { id: number; x: number; y: number; vy: number; damage: number; }
export interface DanmakuEmitter { id: number; x: number; y: number; radius: number; color: string; }
export interface DanmakuBattleState {
  frame: number;
  phaseFrame: number;
  playerX: number;
  playerY: number;
  playerHp: number;
  playerMaxHp: number;
  playerLives: number;
  bombs: number;
  invulnerableFrames: number;
  bossInvulnerableFrames: number;
  bossX: number;
  bossY: number;
  bossHp: number;
  bossMaxHp: number;
  phase: 1 | 2 | 3 | 4;
  bullets: DanmakuBullet[];
  lasers: DanmakuLaser[];
  emitters: DanmakuEmitter[];
  shots: DanmakuShot[];
  grazes: number;
  hits: number;
  autoBombs: number;
  gravityStrength: number;
  status: "active" | "victory" | "defeat" | "complete";
}
export interface DanmakuBattleConfig { mode: DanmakuMode; target: number; targetName: string; pattern: DanmakuPattern; seed: number; }
export interface DanmakuBattleKojoLine { text: string; }
/** Frame state is a deterministic projection of config + inputFrames. */
export interface DanmakuBattleSession { id: string; commandNo: 411 | 480; config: DanmakuBattleConfig; startedAtTick: number; inputFrames: BattleInput[]; kojoLines?: DanmakuBattleKojoLine[]; }
export interface DanmakuStepEvent { kind: "graze" | "hit" | "auto-bomb" | "phase" | "end"; }

const WIDTH = 480;
const HEIGHT = 640;
// Touhou-style judgement point: the visible player sprite is deliberately
// much larger than the actual collision core.
const PLAYER_RADIUS = 2;
const GRAZE_RADIUS = 22;
const MAX_ACTIVE_BULLETS = 720;
const TAU = Math.PI * 2;

export interface DanmakuPhaseDefinition {
  label: string;
  emitters: readonly DanmakuEmitterKind[];
  clearOnEnter: boolean;
  resetClockOnEnter: boolean;
  bossInvulnerability: number;
  hideBossMeter?: boolean;
  gravity?: number;
}

export interface DanmakuPatternDefinition {
  id: DanmakuPattern;
  target?: number;
  bossHp: number;
  phases: readonly DanmakuPhaseDefinition[];
}

/** Reusable authored-pattern registry. New opponents compose existing emitter
 * grammars here and only add a new emitter implementation when their motion
 * genuinely cannot be expressed by an existing one. */
export const DANMAKU_PATTERNS: Readonly<Record<DanmakuPattern, DanmakuPatternDefinition>> = {
  training: {
    id: "training",
    bossHp: 1,
    phases: [
      { label: "基础训练", emitters: ["aunn-bend", "aunn-dog"], clearOnEnter: false, resetClockOnEnter: false, bossInvulnerability: 0 },
      { label: "基础训练", emitters: ["aunn-bend", "aunn-dog"], clearOnEnter: false, resetClockOnEnter: false, bossInvulnerability: 0 },
    ],
  },
  aunn: {
    id: "aunn",
    target: 120,
    bossHp: 3600,
    phases: [
      { label: "守护米弹", emitters: ["aunn-bend"], clearOnEnter: true, resetClockOnEnter: true, bossInvulnerability: 36 },
      { label: "野犬散步", emitters: ["aunn-dog"], clearOnEnter: true, resetClockOnEnter: true, bossInvulnerability: 36 },
      { label: "双兽交织", emitters: ["aunn-cross"], clearOnEnter: true, resetClockOnEnter: true, bossInvulnerability: 36 },
      { label: "双兽螺旋", emitters: ["aunn-cluster"], clearOnEnter: true, resetClockOnEnter: true, bossInvulnerability: 36 },
    ],
  },
  suika: {
    id: "suika",
    target: 10,
    bossHp: 4000,
    phases: [
      { label: "全方向扩散", emitters: ["suika-radial"], clearOnEnter: true, resetClockOnEnter: true, bossInvulnerability: 48 },
      { label: "旋转弹源", emitters: ["suika-radial", "suika-orbiters"], clearOnEnter: true, resetClockOnEnter: true, bossInvulnerability: 48 },
      { label: "大型追踪弹", emitters: ["suika-radial", "suika-orbiters", "suika-heavy"], clearOnEnter: true, resetClockOnEnter: true, bossInvulnerability: 48, hideBossMeter: true },
      { label: "黑洞吸引", emitters: ["suika-radial", "suika-orbiters", "suika-heavy"], clearOnEnter: false, resetClockOnEnter: false, bossInvulnerability: 0, hideBossMeter: true, gravity: .28 },
    ],
  },
};

function patternDefinition(config: DanmakuBattleConfig): DanmakuPatternDefinition {
  return DANMAKU_PATTERNS[config.pattern];
}

function phaseDefinition(state: DanmakuBattleState, config: DanmakuBattleConfig): DanmakuPhaseDefinition {
  const phases = patternDefinition(config).phases;
  return phases[Math.min(phases.length - 1, state.phase - 1)]!;
}

export function danmakuPhaseLabel(state: DanmakuBattleState, config: DanmakuBattleConfig): string {
  return phaseDefinition(state, config).label;
}

export function danmakuBossMeterVisible(state: DanmakuBattleState, config: DanmakuBattleConfig): boolean {
  return !phaseDefinition(state, config).hideBossMeter;
}

export function patternForTarget(target: number, mode: DanmakuMode): DanmakuBattleConfig["pattern"] {
  return mode === "training" ? "training" : target === 120 ? "aunn" : target === 10 ? "suika" : "training";
}

export function isRealtimeDanmakuTarget(target: number): boolean { return target === 10 || target === 120; }

export function danmakuPhaseCount(config: DanmakuBattleConfig): 2 | 4 {
  return patternDefinition(config).phases.length as 2 | 4;
}

export function createDanmakuBattleState(config: DanmakuBattleConfig): DanmakuBattleState {
  const training = config.mode === "training";
  const hp = training ? 1 : patternDefinition(config).bossHp;
  return {
    frame: 0,
    phaseFrame: 0,
    playerX: WIDTH / 2,
    playerY: HEIGHT - 80,
    playerHp: 100,
    playerMaxHp: 100,
    playerLives: training ? 99 : 3,
    bombs: training ? 0 : 2,
    invulnerableFrames: 120,
    bossInvulnerableFrames: 0,
    bossX: WIDTH / 2,
    bossY: 108,
    bossHp: hp,
    bossMaxHp: hp,
    phase: 1,
    bullets: [],
    lasers: [],
    emitters: [],
    shots: [],
    grazes: 0,
    hits: 0,
    autoBombs: 0,
    gravityStrength: 0,
    status: "active",
  };
}

function makeBullet(
  id: number,
  x: number,
  y: number,
  angle: number,
  speed: number,
  color: string,
  radius = 7,
  shape: DanmakuBulletShape = "orb",
  behavior: DanmakuBulletBehavior = "linear",
  turn = 0,
): DanmakuBullet {
  const vx = Math.cos(angle) * speed;
  const vy = Math.sin(angle) * speed;
  return { id, x, y, vx, vy, baseVx: vx, baseVy: vy, radius, color, shape, behavior, age: 0, turn, lockCount: 0, grazed: false };
}

function spawnAunnNormalOne(state: DanmakuBattleState, training = false): DanmakuBullet[] {
  const out: DanmakuBullet[] = [];
  const cycleLength = training ? 210 : 174;
  const chainLength = training ? 20 : 30;
  const cycle = state.phaseFrame % cycleLength;
  if (cycle >= chainLength || cycle % 5 !== 0) return out;
  const count = training ? 16 : 20;
  const rotation = Math.floor(state.phaseFrame / cycleLength) * .087;
  for (let i = 0; i < count; i += 1) {
    const angle = rotation + i * TAU / count;
    out.push(makeBullet(state.frame * 100 + i, state.bossX, state.bossY, angle, training ? 1.75 : 2.05, i % 2 ? "#ff76aa" : "#ffd85d", 4.1, "needle", "aunn-bend"));
  }
  return out;
}

function spawnAunnDogWalk(state: DanmakuBattleState, training = false, seed = 0): DanmakuBullet[] {
  const out: DanmakuBullet[] = [];
  const interval = training ? 108 : 54;
  if (state.phaseFrame % interval !== 0) return out;
  const count = training ? 10 : Math.min(21, 12 + Math.floor(state.phaseFrame / 190));
  const rotation = Math.floor(state.phaseFrame / interval) * .19;
  for (let i = 0; i < count; i += 1) {
    const variation = ((i * 17 + state.frame * 13 + seed) % 11 - 5) * .004;
    const angle = rotation + i * TAU / count + variation;
    const speed = (training ? 1.45 : 1.65) + (i % 4) * .085;
    out.push(makeBullet(state.frame * 100 + i, state.bossX, state.bossY, angle, speed, "#ffe262", 7.2, "petal", "aunn-dog"));
  }
  return out;
}

function spawnAunnCrossWeb(state: DanmakuBattleState, twinOffset = 0, idOffset = 0): DanmakuBullet[] {
  const out: DanmakuBullet[] = [];
  if (state.phaseFrame % 5 !== 0 || state.phaseFrame % 120 >= 35) return out;
  const group = Math.floor(state.phaseFrame / 120) % 2;
  const originX = state.bossX + twinOffset + (group ? 18 : -18);
  for (let i = 0; i < 18; i += 1) {
    const t = i / 17;
    const angle = group ? .17 * Math.PI + t * .64 * Math.PI : .19 * Math.PI + t * .58 * Math.PI;
    out.push(makeBullet(state.frame * 100 + idOffset + i, originX, state.bossY + 4, angle, 2.2, group ? "#ff769f" : "#ffd65a", 3.8, "needle"));
  }
  return out;
}

function spawnAunnTopClusters(state: DanmakuBattleState, twinOffset = 0, idOffset = 0): DanmakuBullet[] {
  const out: DanmakuBullet[] = [];
  if (state.phaseFrame % 46 !== 0 || state.phaseFrame < 105) return out;
  const rotation = .28 + state.phaseFrame * .0018;
  for (let arm = 0; arm < 7; arm += 1) {
    const base = rotation + arm * TAU / 7;
    for (let part = 0; part < 4; part += 1) {
      const distance = 26 + part * 9;
      const x = state.bossX + twinOffset + Math.cos(base) * distance;
      const y = state.bossY + Math.sin(base) * distance;
      out.push(makeBullet(state.frame * 100 + idOffset + arm * 4 + part, x, y, base + .72, 1.75 + part * .1, "#ffd84f", 4.2, "needle", "spiral", .007));
    }
  }
  return out;
}

function spawnSuikaRadial(state: DanmakuBattleState): DanmakuBullet[] {
  const out: DanmakuBullet[] = [];
  const interval = state.phase === 1 ? 44 : 50;
  const count = state.phase === 1 ? 30 : 34;
  if (state.phaseFrame % interval !== 0) return out;
  const volley = Math.floor(state.phaseFrame / interval);
  const offset = volley * .083 + (volley % 2 ? TAU / count / 2 : 0);
  for (let i = 0; i < count; i += 1) {
    const angle = offset + i / count * TAU;
    const color = i % 3 === 0 ? "#ff695f" : i % 3 === 1 ? "#ffc45a" : "#cf7cff";
    const speed = 1.55 + (i % 3) * .16 + (volley % 3) * .06;
    out.push(makeBullet(state.frame * 1000 + i, state.bossX, state.bossY, angle, speed, color, 4.2, i % 4 === 0 ? "diamond" : "orb"));
  }
  return out;
}

function suikaOrbiterPositions(state: DanmakuBattleState): DanmakuEmitter[] {
  if (state.phase < 2) return [];
  const count = 4;
  const orbit = 70;
  const rotation = state.frame * .018;
  return Array.from({ length: count }, (_, index) => {
    const angle = rotation + index * TAU / count;
    return {
      id: index,
      x: state.bossX + Math.cos(angle) * orbit,
      y: state.bossY + Math.sin(angle) * orbit,
      radius: 8,
      color: index % 2 ? "#ffb54f" : "#d978ff",
    };
  });
}

function spawnSuikaOrbiters(state: DanmakuBattleState): DanmakuBullet[] {
  if (state.phaseFrame % 18 !== 0) return [];
  const out: DanmakuBullet[] = [];
  for (const emitter of state.emitters) {
    const radial = Math.atan2(emitter.y - state.bossY, emitter.x - state.bossX);
    const tangent = radial + Math.PI / 2;
    for (let lane = -1; lane <= 1; lane += 1) {
      const angle = tangent + lane * .18;
      out.push(makeBullet(
        state.frame * 1000 + 100 + emitter.id * 10 + lane + 1,
        emitter.x,
        emitter.y,
        angle,
        1.75 + (emitter.id % 2) * .16,
        emitter.color,
        3.8,
        lane === 0 ? "needle" : "petal",
      ));
    }
  }
  return out;
}

function spawnSuikaHeavy(state: DanmakuBattleState): DanmakuBullet[] {
  if (state.phaseFrame < 45 || state.phaseFrame % 112 !== 0) return [];
  const aimed = Math.atan2(state.playerY - state.bossY, state.playerX - state.bossX);
  return [-.115, 0, .115].map((spread, index) => makeBullet(
    state.frame * 1000 + 300 + index,
    state.bossX + Math.cos(aimed) * 24,
    state.bossY + Math.sin(aimed) * 24,
    aimed + spread,
    1.02 + index * .045,
    index === 1 ? "#57a8ff" : "#3577e8",
    index === 1 ? 21 : 17,
    "orb",
  ));
}

type EmitterSpawner = (state: DanmakuBattleState, config: DanmakuBattleConfig) => DanmakuBullet[];

const EMITTER_SPAWNERS: Readonly<Record<DanmakuEmitterKind, EmitterSpawner>> = {
  "aunn-bend": (state, config) => spawnAunnNormalOne(state, config.mode === "training"),
  "aunn-dog": (state, config) => spawnAunnDogWalk(state, config.mode === "training", config.seed),
  "aunn-cross": (state) => [
    ...spawnAunnCrossWeb(state, -68, 0),
    ...spawnAunnCrossWeb(state, 68, 40),
  ],
  "aunn-cluster": (state) => [
    ...spawnAunnTopClusters(state, -68, 0),
    ...spawnAunnTopClusters(state, 68, 40),
  ],
  "suika-radial": (state) => spawnSuikaRadial(state),
  "suika-orbiters": (state) => spawnSuikaOrbiters(state),
  "suika-heavy": (state) => spawnSuikaHeavy(state),
};

function spawnPattern(state: DanmakuBattleState, config: DanmakuBattleConfig): DanmakuBullet[] {
  return phaseDefinition(state, config).emitters.flatMap((kind) => EMITTER_SPAWNERS[kind](state, config));
}

function updateBullet(bullet: DanmakuBullet, playerX: number, playerY: number): void {
  bullet.age += 1;
  if (bullet.behavior === "aunn-bend") {
    if (bullet.age >= 38 && bullet.age < 104) {
      const speed = Math.hypot(bullet.vx, bullet.vy);
      const targetAngle = Math.atan2(playerY - bullet.y, playerX - bullet.x);
      bullet.vx += Math.cos(targetAngle) * .026;
      bullet.vy += Math.sin(targetAngle) * .026;
      const currentSpeed = Math.hypot(bullet.vx, bullet.vy) || 1;
      bullet.vx *= speed / currentSpeed;
      bullet.vy *= speed / currentSpeed;
    } else if (bullet.age >= 104 && bullet.age < 148) {
      bullet.vx += (bullet.baseVx - bullet.vx) * .045;
      bullet.vy += (bullet.baseVy - bullet.vy) * .045;
    }
  } else if (bullet.behavior === "aunn-dog") {
    if (bullet.age === 48 || bullet.age === 92 || bullet.age === 136) {
      const speed = 2.15 + bullet.lockCount * .18;
      const angle = Math.atan2(playerY - bullet.y, playerX - bullet.x);
      bullet.vx = Math.cos(angle) * speed;
      bullet.vy = Math.sin(angle) * speed;
      bullet.lockCount += 1;
    }
    if (bullet.age === 178) {
      bullet.color = "#ff416f";
      const baseSpeed = Math.hypot(bullet.baseVx, bullet.baseVy) || 1;
      bullet.vx = bullet.baseVx / baseSpeed * 2.65;
      bullet.vy = bullet.baseVy / baseSpeed * 2.65;
    }
  } else if (bullet.behavior === "spiral" && bullet.turn !== 0) {
    const cosine = Math.cos(bullet.turn);
    const sine = Math.sin(bullet.turn);
    const vx = bullet.vx;
    bullet.vx = vx * cosine - bullet.vy * sine;
    bullet.vy = vx * sine + bullet.vy * cosine;
  }
  bullet.x += bullet.vx;
  bullet.y += bullet.vy;
}

function desiredPhase(state: DanmakuBattleState, config: DanmakuBattleConfig): 1 | 2 | 3 | 4 {
  const count = danmakuPhaseCount(config);
  const progress = 1 - state.bossHp / state.bossMaxHp;
  return Math.min(count, Math.floor(progress * count) + 1) as 1 | 2 | 3 | 4;
}

export function stepDanmakuBattle(
  state: DanmakuBattleState,
  config: DanmakuBattleConfig,
  input: BattleInput = EMPTY_BATTLE_INPUT,
): { state: DanmakuBattleState; events: DanmakuStepEvent[] } {
  if (state.status !== "active") return { state, events: [] };
  const events: DanmakuStepEvent[] = [];
  const next: DanmakuBattleState = {
    ...state,
    bullets: state.bullets.map((bullet) => ({ ...bullet })),
    lasers: state.lasers.map((laser) => ({ ...laser, points: laser.points.map((point) => ({ ...point })) })),
    emitters: state.emitters.map((emitter) => ({ ...emitter })),
    shots: state.shots.map((shot) => ({ ...shot })),
    frame: state.frame + 1,
    phaseFrame: state.phaseFrame + 1,
  };
  const speed = input.focus ? 2.25 : 4.25;
  const dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
  const length = Math.hypot(dx, dy) || 1;
  next.playerX = Math.max(PLAYER_RADIUS, Math.min(WIDTH - PLAYER_RADIUS, next.playerX + dx / length * speed));
  next.playerY = Math.max(PLAYER_RADIUS, Math.min(HEIGHT - PLAYER_RADIUS, next.playerY + dy / length * speed));
  next.invulnerableFrames = Math.max(0, next.invulnerableFrames - 1);
  next.bossInvulnerableFrames = Math.max(0, next.bossInvulnerableFrames - 1);

  if (config.pattern === "suika") {
    // Suika is the fixed center of the centrifugal pattern; only a small
    // breathing hover remains so the source reads as a character, not a pin.
    next.bossX = WIDTH / 2 + Math.sin(next.frame / 97) * 5;
    next.bossY = 152 + Math.sin(next.frame / 61) * 5;
  } else {
    const bossRange = next.phase === 4 ? 42 : 64;
    next.bossX = WIDTH / 2 + Math.sin(next.frame / 82) * bossRange;
    next.bossY = 108 + Math.sin(next.frame / 53) * (next.phase === 4 ? 8 : 14);
  }

  const activePhase = phaseDefinition(next, config);
  next.gravityStrength = activePhase.gravity ?? 0;
  if (next.gravityStrength > 0) {
    const gx = next.bossX - next.playerX;
    const gy = next.bossY - next.playerY;
    const distance = Math.max(48, Math.hypot(gx, gy));
    const pull = next.gravityStrength * Math.min(2.2, 260 / distance);
    next.playerX = Math.max(PLAYER_RADIUS, Math.min(WIDTH - PLAYER_RADIUS, next.playerX + gx / distance * pull));
    next.playerY = Math.max(PLAYER_RADIUS, Math.min(HEIGHT - PLAYER_RADIUS, next.playerY + gy / distance * pull));
  }

  if (next.frame % 5 === 0) {
    next.shots.push({ id: next.frame * 2, x: next.playerX - 5, y: next.playerY - 13, vy: -11, damage: 6 });
    next.shots.push({ id: next.frame * 2 + 1, x: next.playerX + 5, y: next.playerY - 13, vy: -11, damage: 6 });
  }
  const keptShots: DanmakuShot[] = [];
  for (const shot of next.shots) {
    shot.y += shot.vy;
    if (shot.y < -20) continue;
    if (Math.hypot(shot.x - next.bossX, shot.y - next.bossY) <= 36) {
      if (config.mode === "duel" && next.bossInvulnerableFrames === 0) next.bossHp = Math.max(0, next.bossHp - shot.damage);
      continue;
    }
    keptShots.push(shot);
  }
  next.shots = keptShots;

  if (config.mode === "duel") {
    const phase = desiredPhase(next, config);
    if (phase !== next.phase) {
      next.phase = phase;
      const entered = phaseDefinition(next, config);
      if (entered.resetClockOnEnter) next.phaseFrame = 0;
      if (entered.clearOnEnter) {
        next.bullets = [];
        next.lasers = [];
      }
      next.bossInvulnerableFrames = entered.bossInvulnerability;
      events.push({ kind: "phase" });
    }
  }

  next.gravityStrength = phaseDefinition(next, config).gravity ?? 0;
  next.emitters = config.pattern === "suika" ? suikaOrbiterPositions(next) : [];
  next.bullets.push(...spawnPattern(next, config));
  if (next.bullets.length > MAX_ACTIVE_BULLETS) {
    next.bullets.splice(0, next.bullets.length - MAX_ACTIVE_BULLETS);
  }
  // Phase four previously rebuilt and collision-tested hundreds of curved
  // laser points every frame. The twin Aunn pattern now uses only dodgeable
  // entity bullets, so the expensive dividing beams are intentionally gone.
  next.lasers = [];
  let hit = false;
  const keptBullets: DanmakuBullet[] = [];
  for (const bullet of next.bullets) {
    updateBullet(bullet, next.playerX, next.playerY);
    if (bullet.x < -90 || bullet.x > WIDTH + 90 || bullet.y < -100 || bullet.y > HEIGHT + 100) continue;
    const distance = Math.hypot(bullet.x - next.playerX, bullet.y - next.playerY);
    const bulletHitRadius = Math.max(1.5, bullet.radius * .55);
    if (next.invulnerableFrames === 0 && distance <= bulletHitRadius + PLAYER_RADIUS) hit = true;
    else if (!bullet.grazed && distance <= bullet.radius + GRAZE_RADIUS) {
      bullet.grazed = true;
      next.grazes += 1;
      events.push({ kind: "graze" });
    }
    keptBullets.push(bullet);
  }
  next.bullets = keptBullets;
  if (next.invulnerableFrames === 0) {
    for (const laser of next.lasers) {
      if (laser.points.some((point) => Math.hypot(point.x - next.playerX, point.y - next.playerY) <= laser.width / 2 + PLAYER_RADIUS)) {
        hit = true;
        break;
      }
    }
  }

  if (hit) {
    next.hits += 1;
    next.playerHp = Math.max(0, next.playerHp - (config.mode === "training" ? 25 : 40));
    next.invulnerableFrames = 45;
    events.push({ kind: "hit" });
    if (next.playerHp <= 0) {
      if (config.mode === "training") {
        next.playerHp = next.playerMaxHp;
        next.invulnerableFrames = 150;
        next.bullets = [];
        next.lasers = [];
      } else if (next.bombs > 0) {
        next.bombs -= 1;
        next.autoBombs += 1;
        next.playerHp = next.playerMaxHp;
        next.invulnerableFrames = 150;
        next.bullets = [];
        next.lasers = [];
        events.push({ kind: "auto-bomb" });
      } else {
        next.playerLives -= 1;
        next.playerHp = next.playerMaxHp;
        next.invulnerableFrames = 150;
        if (next.playerLives <= 0) {
          next.status = "defeat";
          events.push({ kind: "end" });
        }
      }
    }
  }

  if (config.mode === "training" && next.frame >= 60 * 10) {
    next.status = "complete";
    events.push({ kind: "end" });
  } else if (config.mode === "duel" && next.bossHp <= 0) {
    next.status = "victory";
    events.push({ kind: "end" });
  }

  return { state: next, events };
}
