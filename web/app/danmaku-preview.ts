import "./danmaku-preview.css";

const canvas = document.querySelector<HTMLCanvasElement>("#battle-canvas")!;
const ctx = canvas.getContext("2d")!;
const wrap = document.querySelector<HTMLElement>("#battle-wrap")!;
const phaseNav = document.querySelector<HTMLElement>("#phase-nav")!;
const phaseIndex = document.querySelector<HTMLElement>("#phase-index")!;
const phaseTitle = document.querySelector<HTMLElement>("#phase-title")!;
const phaseDescription = document.querySelector<HTMLElement>("#phase-description")!;
const phaseCard = document.querySelector<HTMLElement>("#phase-card")!;
const bossHpElement = document.querySelector<HTMLElement>("#boss-hp")!;
const playerHpElement = document.querySelector<HTMLElement>("#player-hp")!;
const playerStateElement = document.querySelector<HTMLElement>("#player-state")!;
const pauseButton = document.querySelector<HTMLButtonElement>("#pause-button")!;
const restartButton = document.querySelector<HTMLButtonElement>("#restart-button")!;

const WIDTH = 540;
const HEIGHT = 720;
const PHASE_LENGTH = 900;
const TAU = Math.PI * 2;

const phases = [
  { title: "通常弹幕一", label: "弯折珠链", card: "放射的珠链向自机位置弯曲", description: "二十方向的粉黄米弹先保持放射，飞行中段受玩家位置吸引，接近后脱离追踪并重新拉直。" },
  { title: "犬符「野犬的散步」", label: "三次锁点", card: "黄色糖豆三次锁定旧位置", description: "黄色糖豆弹分三次锁定玩家当时的位置；完成追踪后变成红色，并沿各自最初方向重新散开。" },
  { title: "通常弹幕二", label: "交叉弹网", card: "两组反向米弹编织菱形窗口", description: "左右两个发射中心交替铺设不同斜率的米弹列，安全窗口会随整张菱形格网向下滑动。" },
  { title: "独乐「狛犬旋转」", label: "旋转独乐", card: "弯曲激光与黄色弹簇分割空间", description: "粉红色弯曲激光从白色核心生长为旋转风车；黄色短弹簇落入叶片间的弯曲通道。" },
] as const;

type Shape = "rice" | "bean" | "orb";
type Behavior = "bend" | "dog" | "straight" | "spiral";
interface Bullet { x: number; y: number; vx: number; vy: number; baseVx: number; baseVy: number; radius: number; age: number; shape: Shape; behavior: Behavior; color: string; lock: number; turn: number; grazed: boolean; }
interface Shot { x: number; y: number; age: number; }
interface Spark { x: number; y: number; vx: number; vy: number; life: number; color: string; }

const bossImage = new Image();
// Resolve the sheet from the generated bundle rather than hardcoding a file
// name: build-portraits fingerprints every output name from its upstream
// path, so a literal `/portraits/120.webp` goes stale the next time the
// bundle is regenerated. (This preview's `danmaku-preview.html` entry has
// already been removed; nothing imports this module any more.)
import portraits from "./game/portraits.bundle.json";
bossImage.src = `/${(portraits as Record<string, { src: string }>)["120"]!.src}`;
const keys = new Set<string>();
let bullets: Bullet[] = [];
let shots: Shot[] = [];
let sparks: Spark[] = [];
let phase = 0;
let phaseFrame = 0;
let globalFrame = 0;
let bossHp = 1000;
let playerHp = 100;
let playerLives = 3;
let grazes = 0;
let invulnerable = 0;
let playerX = WIDTH / 2;
let playerY = HEIGHT - 88;
let bossX = WIDTH / 2;
let bossY = 116;
let paused = false;
let previous = performance.now();
let accumulator = 0;
let seed = 0xA120;

function random(): number {
  seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
  return (seed >>> 0) / 0x100000000;
}

function addBullet(x: number, y: number, angle: number, speed: number, radius: number, shape: Shape, behavior: Behavior, color: string, turn = 0): void {
  const vx = Math.cos(angle) * speed;
  const vy = Math.sin(angle) * speed;
  bullets.push({ x, y, vx, vy, baseVx: vx, baseVy: vy, radius, age: 0, shape, behavior, color, lock: 0, turn, grazed: false });
}

function setPhase(next: number): void {
  phase = (next + phases.length) % phases.length;
  phaseFrame = 0;
  bossHp = 1000;
  bullets = [];
  shots = [];
  sparks = [];
  seed = 0xA120 + phase * 7919;
  playerX = WIDTH / 2;
  playerY = HEIGHT - 88;
  document.querySelectorAll(".phase-nav button").forEach((button, index) => button.classList.toggle("is-active", index === phase));
  phaseIndex.textContent = `PHASE ${phase + 1} / 4`;
  phaseTitle.textContent = phases[phase].title;
  phaseDescription.textContent = phases[phase].description;
  phaseCard.querySelector("strong")!.textContent = phases[phase].title;
  phaseCard.querySelector("span")!.textContent = phases[phase].card;
  phaseCard.classList.remove("is-visible");
  void phaseCard.offsetWidth;
  phaseCard.classList.add("is-visible");
}

for (const [index, item] of phases.entries()) {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.index = String(index + 1).padStart(2, "0");
  button.textContent = item.label;
  button.addEventListener("click", () => setPhase(index));
  phaseNav.append(button);
}

function spawnPhaseOne(): void {
  const cycle = phaseFrame % 174;
  if (cycle >= 30 || cycle % 5 !== 0) return;
  const rotation = Math.floor(phaseFrame / 174) * .087;
  for (let i = 0; i < 20; i++) {
    const angle = rotation + i * TAU / 20;
    addBullet(bossX, bossY, angle, 2.05, 4.1, "rice", "bend", i % 2 ? "#ff76aa" : "#ffd85d");
  }
}

function spawnPhaseTwo(): void {
  if (phaseFrame % 54 !== 0) return;
  const count = Math.min(21, 12 + Math.floor(phaseFrame / 190));
  const rotation = Math.floor(phaseFrame / 54) * .19;
  for (let i = 0; i < count; i++) {
    const angle = rotation + i * TAU / count + (random() - .5) * .05;
    addBullet(bossX, bossY, angle, 1.65 + random() * .34, 7.2, "bean", "dog", "#ffe262");
  }
}

function spawnPhaseThree(): void {
  if (phaseFrame % 5 !== 0 || phaseFrame % 120 >= 35) return;
  const group = Math.floor(phaseFrame / 120) % 2;
  const originX = bossX + (group ? 40 : -40);
  for (let i = 0; i < 18; i++) {
    const t = i / 17;
    const angle = group ? .17 * Math.PI + t * .64 * Math.PI : .19 * Math.PI + t * .58 * Math.PI;
    addBullet(originX, bossY + 4, angle, 2.35, 3.8, "rice", "straight", group ? "#ff769f" : "#ffd65a");
  }
}

function spawnPhaseFour(): void {
  if (phaseFrame % 46 !== 0 || phaseFrame < 105) return;
  const rotation = .28 + phaseFrame * .0018;
  for (let arm = 0; arm < 7; arm++) {
    const base = rotation + arm * TAU / 7;
    for (let part = 0; part < 4; part++) {
      const distance = 26 + part * 9;
      const x = bossX + Math.cos(base) * distance;
      const y = bossY + Math.sin(base) * distance;
      addBullet(x, y, base + .72, 1.85 + part * .12, 4.2, "rice", "spiral", "#ffd84f", .007);
    }
  }
}

function updateBullet(bullet: Bullet): void {
  bullet.age++;
  if (bullet.behavior === "bend") {
    if (bullet.age >= 38 && bullet.age < 104) {
      const speed = Math.hypot(bullet.vx, bullet.vy);
      const targetAngle = Math.atan2(playerY - bullet.y, playerX - bullet.x);
      bullet.vx += Math.cos(targetAngle) * .026;
      bullet.vy += Math.sin(targetAngle) * .026;
      const current = Math.hypot(bullet.vx, bullet.vy) || 1;
      bullet.vx *= speed / current; bullet.vy *= speed / current;
    } else if (bullet.age >= 104 && bullet.age < 148) {
      bullet.vx += (bullet.baseVx - bullet.vx) * .045;
      bullet.vy += (bullet.baseVy - bullet.vy) * .045;
    }
  } else if (bullet.behavior === "dog") {
    const turnAges = [48, 92, 136];
    if (turnAges.includes(bullet.age)) {
      const speed = 2.15 + bullet.lock * .18;
      const angle = Math.atan2(playerY - bullet.y, playerX - bullet.x);
      bullet.vx = Math.cos(angle) * speed; bullet.vy = Math.sin(angle) * speed; bullet.lock++;
      for (let i = 0; i < 3; i++) sparks.push({ x: bullet.x, y: bullet.y, vx: (random() - .5) * 2, vy: (random() - .5) * 2, life: 14, color: "#fff4a5" });
    }
    if (bullet.age === 178) {
      bullet.color = "#ff416f";
      const length = Math.hypot(bullet.baseVx, bullet.baseVy) || 1;
      bullet.vx = bullet.baseVx / length * 2.65; bullet.vy = bullet.baseVy / length * 2.65;
    }
  } else if (bullet.behavior === "spiral") {
    const cos = Math.cos(bullet.turn), sin = Math.sin(bullet.turn);
    const vx = bullet.vx * cos - bullet.vy * sin;
    bullet.vy = bullet.vx * sin + bullet.vy * cos; bullet.vx = vx;
  }
  bullet.x += bullet.vx; bullet.y += bullet.vy;
}

function hitPlayer(): void {
  if (invulnerable > 0) return;
  playerHp -= 25;
  invulnerable = 95;
  wrap.classList.remove("is-hit"); void wrap.offsetWidth; wrap.classList.add("is-hit");
  if (playerHp <= 0) {
    playerLives = Math.max(0, playerLives - 1);
    playerHp = 100;
    bullets = [];
    playerX = WIDTH / 2; playerY = HEIGHT - 88;
  }
}

function laserPoint(arm: number, distance: number, growth: number): [number, number] {
  const length = 760 * growth;
  const base = .28 + phaseFrame * .0018 + arm * TAU / 7;
  const angle = base + 1.58 * (distance / Math.max(1, length));
  return [bossX + Math.cos(angle) * distance, bossY + Math.sin(angle) * distance];
}

function checkLasers(): void {
  if (phase !== 3 || phaseFrame < 70 || invulnerable > 0) return;
  const growth = Math.min(1, (phaseFrame - 50) / 145);
  const length = 760 * growth;
  for (let arm = 0; arm < 7; arm++) {
    for (let distance = 36; distance < length; distance += 12) {
      const [x, y] = laserPoint(arm, distance, growth);
      if (Math.hypot(playerX - x, playerY - y) < 10) { hitPlayer(); return; }
    }
  }
}

function update(): void {
  globalFrame++; phaseFrame++;
  bossX = WIDTH / 2 + Math.sin(globalFrame / (phase === 3 ? 105 : 82)) * (phase === 3 ? 45 : 64);
  bossY = 112 + Math.sin(globalFrame / 53) * 8;
  const focus = keys.has("Shift");
  const speed = focus ? 2.35 : 5.15;
  let dx = 0, dy = 0;
  if (keys.has("ArrowLeft") || keys.has("a")) dx--;
  if (keys.has("ArrowRight") || keys.has("d")) dx++;
  if (keys.has("ArrowUp") || keys.has("w")) dy--;
  if (keys.has("ArrowDown") || keys.has("s")) dy++;
  if (dx && dy) { dx *= .7071; dy *= .7071; }
  playerX = Math.max(14, Math.min(WIDTH - 14, playerX + dx * speed));
  playerY = Math.max(145, Math.min(HEIGHT - 22, playerY + dy * speed));
  if (invulnerable > 0) invulnerable--;

  if (phase === 0) spawnPhaseOne();
  else if (phase === 1) spawnPhaseTwo();
  else if (phase === 2) spawnPhaseThree();
  else spawnPhaseFour();

  if (phaseFrame % 5 === 0) {
    shots.push({ x: playerX - 6, y: playerY - 10, age: 0 }, { x: playerX + 6, y: playerY - 10, age: 0 });
  }
  for (const shot of shots) { shot.y -= 11.5; shot.age++; }
  for (const bullet of bullets) updateBullet(bullet);
  for (const spark of sparks) { spark.x += spark.vx; spark.y += spark.vy; spark.vx *= .94; spark.vy *= .94; spark.life--; }

  for (const shot of shots) {
    if (Math.hypot(shot.x - bossX, shot.y - bossY) < 39) {
      shot.age = 999; bossHp -= 2.2;
      sparks.push({ x: shot.x, y: shot.y, vx: (random() - .5) * 3, vy: -random() * 2, life: 14, color: "#73f6ff" });
    }
  }
  const nextBullets: Bullet[] = [];
  for (const bullet of bullets) {
    if (bullet.x < -90 || bullet.x > WIDTH + 90 || bullet.y < -100 || bullet.y > HEIGHT + 100) continue;
    const distance = Math.hypot(bullet.x - playerX, bullet.y - playerY);
    if (distance < bullet.radius * .62 + 3) { hitPlayer(); continue; }
    if (distance < bullet.radius + 14 && bullet.age > 18 && !bullet.grazed) { grazes++; bullet.grazed = true; }
    nextBullets.push(bullet);
  }
  bullets = nextBullets;
  shots = shots.filter((shot) => shot.y > -30 && shot.age < 900);
  sparks = sparks.filter((spark) => spark.life > 0);
  checkLasers();
  bossHp = Math.max(0, bossHp - .72);
  if (phaseFrame >= PHASE_LENGTH || bossHp <= 0) setPhase((phase + 1) % phases.length);
}

function drawBullet(bullet: Bullet): void {
  const angle = Math.atan2(bullet.vy, bullet.vx);
  ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.strokeStyle = bullet.color; ctx.fillStyle = bullet.color; ctx.shadowColor = bullet.color; ctx.shadowBlur = 13;
  ctx.globalAlpha = .22; ctx.lineWidth = Math.max(2, bullet.radius * .65); ctx.beginPath(); ctx.moveTo(bullet.x, bullet.y); ctx.lineTo(bullet.x - bullet.vx * 5, bullet.y - bullet.vy * 5); ctx.stroke();
  ctx.translate(bullet.x, bullet.y); ctx.rotate(angle); ctx.globalAlpha = 1;
  if (bullet.shape === "rice") { ctx.beginPath(); ctx.ellipse(0, 0, bullet.radius * 1.85, bullet.radius * .58, 0, 0, TAU); ctx.fill(); }
  else if (bullet.shape === "bean") { ctx.beginPath(); ctx.ellipse(0, 0, bullet.radius * 1.38, bullet.radius * .78, 0, 0, TAU); ctx.fill(); }
  else { ctx.beginPath(); ctx.arc(0, 0, bullet.radius, 0, TAU); ctx.fill(); }
  ctx.fillStyle = "rgba(255,255,255,.82)"; ctx.shadowBlur = 3; ctx.beginPath(); ctx.ellipse(-bullet.radius * .32, -bullet.radius * .16, bullet.radius * .42, bullet.radius * .17, 0, 0, TAU); ctx.fill(); ctx.restore();
}

function drawLasers(): void {
  if (phase !== 3 || phaseFrame < 50) return;
  const growth = Math.min(1, (phaseFrame - 50) / 145);
  const length = 760 * growth;
  ctx.save(); ctx.globalCompositeOperation = "lighter";
  for (let arm = 0; arm < 7; arm++) {
    const path = new Path2D();
    for (let distance = 18; distance <= length; distance += 9) {
      const [x, y] = laserPoint(arm, distance, growth);
      if (distance === 18) path.moveTo(x, y); else path.lineTo(x, y);
    }
    ctx.strokeStyle = "rgba(255,45,133,.22)"; ctx.shadowColor = "#ff2f88"; ctx.shadowBlur = 24; ctx.lineWidth = 24; ctx.stroke(path);
    ctx.strokeStyle = "rgba(255,102,174,.82)"; ctx.shadowBlur = 13; ctx.lineWidth = 11; ctx.stroke(path);
    ctx.strokeStyle = "rgba(255,225,241,.86)"; ctx.shadowBlur = 4; ctx.lineWidth = 2.2; ctx.stroke(path);
  }
  ctx.restore();
}

function draw(): void {
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  const gradient = ctx.createRadialGradient(bossX, bossY, 20, WIDTH / 2, HEIGHT / 2, 620);
  gradient.addColorStop(0, "#250610"); gradient.addColorStop(.45, "#080108"); gradient.addColorStop(1, "#000");
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = "rgba(255,100,157,.14)";
  for (let i = 0; i < 42; i++) { const x = (i * 89 + globalFrame * .07) % WIDTH; const y = (i * 137 + globalFrame * .15) % HEIGHT; ctx.fillRect(x, y, 1.2, 1.2); }
  drawLasers();
  for (const bullet of bullets) drawBullet(bullet);
  ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.strokeStyle = "#7cf5ff"; ctx.shadowColor = "#38dffc"; ctx.shadowBlur = 14;
  for (const shot of shots) { ctx.globalAlpha = .25; ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(shot.x, shot.y + 13); ctx.lineTo(shot.x, shot.y - 13); ctx.stroke(); ctx.globalAlpha = 1; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(shot.x, shot.y + 10); ctx.lineTo(shot.x, shot.y - 10); ctx.stroke(); }
  for (const spark of sparks) { ctx.globalAlpha = spark.life / 14; ctx.fillStyle = spark.color; ctx.fillRect(spark.x - 1.5, spark.y - 1.5, 3, 3); }
  ctx.restore();

  ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.fillStyle = "rgba(255,255,255,.92)"; ctx.shadowColor = "#ff66a5"; ctx.shadowBlur = 28; ctx.beginPath(); ctx.arc(bossX, bossY, phase === 3 ? 22 : 12, 0, TAU); ctx.fill(); ctx.restore();
  if (bossImage.complete) ctx.drawImage(bossImage, 0, 0, 180, 180, bossX - 42, bossY - 42, 84, 84);
  ctx.save(); ctx.translate(playerX, playerY); ctx.globalAlpha = invulnerable > 0 && globalFrame % 8 < 4 ? .25 : 1; ctx.globalCompositeOperation = "lighter"; ctx.shadowColor = "#6ef5ff"; ctx.shadowBlur = 18; ctx.fillStyle = "#c9ffff"; ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(8, 9); ctx.lineTo(0, 5); ctx.lineTo(-8, 9); ctx.closePath(); ctx.fill(); ctx.fillStyle = "#ff344f"; ctx.shadowColor = "#ff344f"; ctx.shadowBlur = 8; ctx.beginPath(); ctx.arc(0, 0, keys.has("Shift") ? 3.2 : 1.8, 0, TAU); ctx.fill(); ctx.restore();

  bossHpElement.style.width = `${bossHp / 10}%`;
  playerHpElement.style.width = `${playerHp}%`;
  playerStateElement.textContent = `PLAYER HP ${playerHp}　残机 ${playerLives}　擦弹 ${grazes}`;
}

function loop(now: number): void {
  accumulator += Math.min(80, now - previous); previous = now;
  if (!paused) while (accumulator >= 1000 / 60) { update(); accumulator -= 1000 / 60; }
  else accumulator = 0;
  draw(); requestAnimationFrame(loop);
}

window.addEventListener("keydown", (event) => {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Shift", "w", "a", "s", "d"].includes(key)) event.preventDefault();
  keys.add(key);
  if (event.key >= "1" && event.key <= "4") setPhase(Number(event.key) - 1);
  if (event.key === "Escape") { paused = !paused; pauseButton.textContent = paused ? "继续" : "暂停"; }
});
window.addEventListener("keyup", (event) => keys.delete(event.key.length === 1 ? event.key.toLowerCase() : event.key));
pauseButton.addEventListener("click", () => { paused = !paused; pauseButton.textContent = paused ? "继续" : "暂停"; });
restartButton.addEventListener("click", () => setPhase(phase));

let dragging = false;
canvas.addEventListener("pointerdown", (event) => { dragging = true; canvas.setPointerCapture(event.pointerId); });
canvas.addEventListener("pointerup", () => { dragging = false; });
canvas.addEventListener("pointermove", (event) => {
  if (!dragging) return;
  const rect = canvas.getBoundingClientRect();
  playerX = Math.max(14, Math.min(WIDTH - 14, (event.clientX - rect.left) / rect.width * WIDTH));
  playerY = Math.max(145, Math.min(HEIGHT - 22, (event.clientY - rect.top) / rect.height * HEIGHT));
});

setPhase(0);
requestAnimationFrame(loop);
