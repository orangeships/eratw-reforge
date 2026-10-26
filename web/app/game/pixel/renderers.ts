import type { DanmakuBattleState, FishingGameState } from '../../../../modernization/runtime/state/index.js';
import { drawDuelBackdrop, drawPondBackdrop, fishingPalette, pixelEllipse, pixelLine } from './scenery.js';
import { drawPixelSprite } from './sprites.js';

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

export function drawPixelBattle(canvas: HTMLCanvasElement, battle: DanmakuBattleState, focus: boolean, backdrop = true) {
  const ctx = canvas.getContext('2d'); if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  if (backdrop) drawDuelBackdrop(ctx);
  else ctx.clearRect(0, 0, canvas.width, canvas.height);
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
  if (!backdrop) {
    // The player's own ship is a precise point, without an invented avatar.
    const x = Math.round(battle.playerX), y = Math.round(battle.playerY);
    const color = battle.invulnerableFrames > 0 && battle.frame % 6 < 3 ? '#777' : '#c8f4ef';
    pixelLine(ctx, x - 6, y, x, y - 6, color);
    pixelLine(ctx, x, y - 6, x + 6, y, color);
    pixelLine(ctx, x + 6, y, x, y + 6, color);
    pixelLine(ctx, x, y + 6, x - 6, y, color);
    ctx.fillStyle = '#fff'; ctx.fillRect(x - 1, y - 1, 3, 3);
  }
}

export function drawPixelFishing(canvas: HTMLCanvasElement, game: FishingGameState, catchSize: number, spotName: string) {
  const ctx = canvas.getContext('2d'); if (!ctx) return;
  const rect = canvas.getBoundingClientRect();
  // A fixed art width keeps fish/rod pixels proportional across resolutions.
  // Aspect follows the input rectangle; physics still uses its unchanged 0..100.
  const width = 384;
  const height = Math.max(90, Math.round(width * (rect.height || 600) / (rect.width || 960)));
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  ctx.imageSmoothingEnabled = false;
  const px = (n: number) => n / 100 * width, py = (n: number) => n / 100 * height;
  drawPondBackdrop(ctx, width, height, fishingPalette(spotName), game.elapsedMs);
  // The exact Runtime fan is outlined without painting over the fish shadows.
  if (game.phase === 'casting') {
    let previous: { x: number; y: number } | undefined;
    for (let n = 0; n <= 46; n++) {
      const angle = (-52 + n / 46 * 104) * Math.PI / 180;
      const point = { x: px(50 + Math.sin(angle) * 62), y: py(92 - Math.cos(angle) * 62) };
      if (previous && n % 3) pixelLine(ctx, previous.x, previous.y, point.x, point.y, '#7bb4ac');
      previous = point;
    }
  }
  const fish = (x: number, y: number, direction: number, size: number, active = false) => {
    if (active) {
      const scale = Math.max(.6, Math.min(1.4, size * .2));
      drawPixelSprite(ctx, 'fish', Math.round(px(x) - 12 * scale), Math.round(py(y) - 7 * scale), scale, direction < 0);
    } else {
      const length = Math.max(3, Math.round(3 + size * .9));
      pixelEllipse(ctx, px(x), py(y), length, Math.max(1, Math.round(length * .4)), '#255c67', true);
      const tail = Math.round(px(x) - direction * length);
      pixelLine(ctx, tail, py(y), tail - direction * 2, py(y) - 2, '#255c67');
      pixelLine(ctx, tail, py(y), tail - direction * 2, py(y) + 2, '#255c67');
    }
  };
  game.shadows.forEach((shadow, index) => {
    if ((game.phase === 'waiting' || game.phase === 'hook') && index === game.activeShadow) return;
    fish(shadow.x, shadow.y, shadow.heading, shadow.size);
  });
  const fighting = game.phase === 'fighting';
  if (game.phase === 'waiting' || game.phase === 'hook') fish(game.fishX, game.fishY, game.fishDirection, 2.2);
  if (fighting) {
    fish(game.fishX, game.fishY, game.fishDirection, Math.max(2.3, Math.min(6.2, 1.8 + Math.sqrt(Math.max(5, catchSize)) * .18)), true);
    const x = px(game.fishX), y = py(game.fishY) - 13;
    pixelLine(ctx, x - game.fishDirection * 6, y, x + game.fishDirection * 6, y, '#f5e8be');
    pixelLine(ctx, x + game.fishDirection * 6, y, x + game.fishDirection * 2, y - 3, '#f5e8be');
    pixelLine(ctx, x + game.fishDirection * 6, y, x + game.fishDirection * 2, y + 3, '#f5e8be');
  }
  if (game.phase === 'casting') {
    const x = px(game.aimX), y = py(game.aimY);
    pixelEllipse(ctx, x, y, 9, 5, '#eee6b9');
    pixelLine(ctx, x - 12, y, x - 5, y, '#f4e8bf'); pixelLine(ctx, x + 5, y, x + 12, y, '#f4e8bf');
    pixelLine(ctx, x, y - 8, x, y - 3, '#f4e8bf'); pixelLine(ctx, x, y + 3, x, y + 8, '#f4e8bf');
  }
  const tip = fighting ? { x: 50 + game.rodDirection * 10, y: 82 } : { x: 50 + (game.aimX - 50) * .12, y: 82 };
  pixelLine(ctx, px(50), py(99), px(tip.x), py(tip.y), '#493c36', 3);
  pixelLine(ctx, px(50), py(99), px(tip.x), py(tip.y), '#d3ba80', 1);
  const endpoint = fighting ? { x: game.fishX + game.fishDirection * Math.max(1.2, Math.min(4.4, Math.sqrt(Math.max(5, catchSize)) * .16)), y: game.fishY } : { x: game.lureX, y: game.lureY };
  const color = game.tension > 78 ? '#ec8b7b' : '#d7e2d0';
  let previous = { x: px(tip.x), y: py(tip.y) };
  for (let n = 1; n <= 30; n++) {
    const t = n / 30, inv = 1 - t;
    const point = {
      x: inv * inv * px(tip.x) + 2 * inv * t * ((px(tip.x) + px(endpoint.x)) / 2 + game.rodDirection * 4) + t * t * px(endpoint.x),
      y: inv * inv * py(tip.y) + 2 * inv * t * ((py(tip.y) + py(endpoint.y)) / 2 + (fighting ? 3 + game.tension * .03 : 7)) + t * t * py(endpoint.y),
    };
    if (game.phase !== 'casting' || n % 3) pixelLine(ctx, previous.x, previous.y, point.x, point.y, color);
    previous = point;
  }
  if (game.phase !== 'casting' && !fighting) {
    ctx.fillStyle = '#f0e5c3'; ctx.fillRect(Math.round(px(game.lureX)) - 1, Math.round(py(game.lureY)) - 2, 3, 5);
    ctx.fillStyle = '#d66668'; ctx.fillRect(Math.round(px(game.lureX)) - 1, Math.round(py(game.lureY)) - 3, 3, 3);
  }
  for (const splash of game.splashes) {
    ctx.globalAlpha = Math.max(0, 1 - splash.age / 900);
    pixelEllipse(ctx, px(splash.x), py(splash.y), (splash.size + splash.age * .03) / 3, (splash.size + splash.age * .03) * .14, '#b6ddd0');
  }
  ctx.globalAlpha = 1;
  if (game.phase === 'hook') {
    const x = Math.round(px(game.lureX)), y = Math.round(py(game.lureY)) - 23;
    ctx.fillStyle = '#172c3a'; ctx.fillRect(x - 3, y - 1, 7, 16);
    ctx.fillStyle = '#f9d57c'; ctx.fillRect(x - 1, y, 3, 9); ctx.fillRect(x - 1, y + 12, 3, 3);
  }
}
