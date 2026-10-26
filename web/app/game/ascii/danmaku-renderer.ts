import { pixelEllipse, pixelLine } from '../pixel/primitives.js';
import type { DanmakuBattleState } from '../../../../modernization/runtime/state/index.js';
const bulletSprites = new Map<string, HTMLCanvasElement>();
function bulletSprite(bullet: DanmakuBattleState['bullets'][number]) {
  const direction = Math.round(Math.atan2(bullet.vy, bullet.vx) / (Math.PI / 8));
  const radius = Math.max(2, Math.round(bullet.radius));
  const key = `${bullet.shape}:${radius}:${bullet.color}:${direction}`;
  let sprite = bulletSprites.get(key);
  if (sprite) return sprite;
  const extent = radius * 2 + 4;
  sprite = document.createElement('canvas'); sprite.width = sprite.height = extent * 2;
  const ctx = sprite.getContext('2d');
  if (!ctx) return sprite;
  const cos = Math.cos(direction * Math.PI / 8), sin = Math.sin(direction * Math.PI / 8);
  for (let y = -extent; y <= extent; y += 2) for (let x = -extent; x <= extent; x += 2) {
    const xx = x * cos + y * sin, yy = -x * sin + y * cos;
    const distance = bullet.shape === 'needle' ? Math.max(Math.abs(xx) / 1.8, Math.abs(yy) / .45)
      : bullet.shape === 'diamond' ? (Math.abs(x) + Math.abs(y)) / 1.35
      : bullet.shape === 'petal' ? Math.hypot(xx / 1.5, yy / .7) : Math.hypot(x, y);
    if (distance > radius) continue;
    ctx.fillStyle = bullet.color; ctx.fillRect(x + extent, y + extent, 2, 2);
    if (distance < radius * .55 && x + y < 1) { ctx.fillStyle = '#f9efd9'; ctx.fillRect(x + extent, y + extent, 2, 2); }
  }
  if (bulletSprites.size >= 256) bulletSprites.delete(bulletSprites.keys().next().value!);
  bulletSprites.set(key, sprite);
  return sprite;
}

export function drawBattle(canvas: HTMLCanvasElement, battle: DanmakuBattleState, focus: boolean) {
  const ctx = canvas.getContext('2d'); if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (battle.gravityStrength > 0) {
    pixelEllipse(ctx, battle.bossX, battle.bossY, 32, 32, '#111623', true, 2);
    for (let ring = 0; ring < 3; ring++) pixelEllipse(ctx, battle.bossX, battle.bossY, 36 + ring * 9, 25 + ring * 9, ring % 2 ? '#7b618d' : '#4a3f68', false, 2);
  }
  for (const shot of battle.shots) {
    ctx.fillStyle = '#39778f'; ctx.fillRect(Math.round(shot.x) - 3, Math.round(shot.y) - 14, 6, 24);
    ctx.fillStyle = '#b4eeec'; ctx.fillRect(Math.round(shot.x) - 1, Math.round(shot.y) - 14, 2, 20);
  }
  for (const emitter of battle.emitters) {
    pixelEllipse(ctx, emitter.x, emitter.y, emitter.radius + 3, emitter.radius + 3, '#1b2734', true, 2);
    pixelEllipse(ctx, emitter.x, emitter.y, emitter.radius, emitter.radius, emitter.color, true, 2);
    ctx.fillStyle = '#f7efd7'; ctx.fillRect(Math.round(emitter.x) - 2, Math.round(emitter.y) - 2, 3, 3);
  }
  for (const laser of battle.lasers) for (let n = 1; n < laser.points.length; n++) {
    const a = laser.points[n - 1]!, b = laser.points[n]!;
    pixelLine(ctx, a.x, a.y, b.x, b.y, laser.color, Math.max(2, Math.round(laser.width)));
  }
  for (const bullet of battle.bullets) {
    const sprite = bulletSprite(bullet);
    ctx.drawImage(sprite, Math.round(bullet.x - sprite.width / 2), Math.round(bullet.y - sprite.height / 2));
  }
  if (focus) pixelEllipse(ctx, battle.playerX, battle.playerY, 12, 12, '#e8dcc0', false, 2);
  // The player's own ship is a precise point, without an invented avatar.
  const x = Math.round(battle.playerX), y = Math.round(battle.playerY);
  const color = battle.invulnerableFrames > 0 && battle.frame % 6 < 3 ? '#777' : '#c8f4ef';
  pixelLine(ctx, x - 6, y, x, y - 6, color);
  pixelLine(ctx, x, y - 6, x + 6, y, color);
  pixelLine(ctx, x + 6, y, x, y + 6, color);
  pixelLine(ctx, x, y + 6, x - 6, y, color);
  ctx.fillStyle = '#fff'; ctx.fillRect(x - 1, y - 1, 3, 3);
}
