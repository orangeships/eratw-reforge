import { drawPixelSprite } from './sprites.js';

/** Fixed palettes and coordinate patterns: presentation never consumes gameplay RNG. */
const backdrops = new Map<string, HTMLCanvasElement>();
const shade = (n: number) => {
  let value = Math.imul(n ^ 0x6d2b79f5, 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
};
function cached(ctx: CanvasRenderingContext2D, key: string, width: number, height: number, paint: (c: CanvasRenderingContext2D) => void) {
  let canvas = backdrops.get(key);
  if (!canvas) {
    canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const c = canvas.getContext('2d');
    if (!c) return;
    paint(c);
    if (backdrops.size >= 8) backdrops.delete(backdrops.keys().next().value!);
    backdrops.set(key, canvas);
  }
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(canvas, 0, 0, width, height);
}

export function pixelLine(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, color: string, size = 1) {
  const count = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) / size));
  ctx.fillStyle = color;
  for (let n = 0; n <= count; n++) ctx.fillRect(Math.round((x0 + (x1 - x0) * n / count) / size) * size, Math.round((y0 + (y1 - y0) * n / count) / size) * size, size, size);
}

export function pixelEllipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, color: string, filled = false, step = 1) {
  ctx.fillStyle = color;
  for (let row = -Math.ceil(ry / step); row <= Math.ceil(ry / step); row++) {
    const yy = row * step;
    const xx = Math.round(Math.sqrt(Math.max(0, 1 - (yy / Math.max(1, ry)) ** 2)) * rx / step) * step;
    if (filled) ctx.fillRect(Math.round(x - xx), Math.round(y + yy), xx * 2 + step, step);
    else {
      ctx.fillRect(Math.round(x - xx), Math.round(y + yy), step, step);
      ctx.fillRect(Math.round(x + xx), Math.round(y + yy), step, step);
    }
  }
}

function pine(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, light = false) {
  const s = Math.max(1, Math.round(size));
  ctx.fillStyle = '#293c3b'; ctx.fillRect(x - s, y, s * 2, s * 16);
  for (let tier = 0; tier < 4; tier++) {
    const w = (tier + 2) * s;
    ctx.fillStyle = light ? '#426853' : '#243f3e';
    ctx.fillRect(x - w, y + tier * s * 3, w * 2 + s, s * 4);
    ctx.fillStyle = light ? '#658665' : '#33534a';
    ctx.fillRect(x - w, y + tier * s * 3, w * 2 - s, s);
  }
}

export function drawDuelBackdrop(ctx: CanvasRenderingContext2D) {
  cached(ctx, 'shrine-duel', 480, 640, c => {
    c.fillStyle = '#101b2c'; c.fillRect(0, 0, 480, 640);
    c.fillStyle = '#152337'; c.fillRect(0, 100, 480, 260);
    c.fillStyle = '#1a2b3b'; c.fillRect(0, 225, 480, 190);
    // A small moon, distant mountains, cedar silhouettes and a red shrine gate.
    pixelEllipse(c, 360, 65, 23, 23, '#889598', true, 2);
    pixelEllipse(c, 365, 62, 18, 18, '#bac0a2', true, 2);
    for (let x = 0; x < 480; x += 4) {
      const y = 185 + Math.round((Math.sin(x * .018) * 29 + Math.sin(x * .042) * 12) / 4) * 4;
      c.fillStyle = '#1e3442'; c.fillRect(x, y, 4, 240 - y);
      const near = 242 + Math.round((Math.sin(x * .025 + 2) * 22) / 4) * 4;
      c.fillStyle = '#263e43'; c.fillRect(x, near, 4, 320 - near);
    }
    for (let n = 0; n < 40; n++) {
      const x = Math.round(shade(n) * 120) * 4, y = Math.round(shade(n + 87) * 40) * 4;
      c.fillStyle = n % 3 ? '#536777' : '#8b9a98'; c.fillRect(x, y, 2, 2);
    }
    for (let n = 0; n < 6; n++) { pine(c, n * 22 + 4, 250 + n % 3 * 18, 3); pine(c, 480 - n * 22, 250 + n % 3 * 18, 3); }
    c.fillStyle = '#1b3035'; c.fillRect(0, 330, 480, 310);
    // Quiet tiled approach stays low contrast beneath collision-bearing bullets.
    for (let y = 352; y < 640; y += 24) {
      const spread = 44 + (y - 350) * .28;
      for (let x = 240 - spread; x < 240 + spread; x += 28) {
        c.fillStyle = (Math.floor(x + y) % 3) ? '#2b3f43' : '#304449';
        c.fillRect(Math.round(x / 2) * 2, y, 25, 20);
        c.fillStyle = '#354a4c'; c.fillRect(Math.round(x / 2) * 2, y, 25, 2);
      }
    }
    c.fillStyle = '#4c3538'; c.fillRect(144, 252, 12, 112); c.fillRect(324, 252, 12, 112);
    c.fillStyle = '#694148'; c.fillRect(146, 254, 4, 106); c.fillRect(326, 254, 4, 106);
    c.fillStyle = '#74444b'; c.fillRect(128, 246, 224, 8); c.fillRect(142, 276, 196, 6);
    c.fillStyle = '#956060'; c.fillRect(122, 240, 236, 6); c.fillRect(128, 238, 24, 2); c.fillRect(328, 238, 24, 2);
    for (const x of [114, 354]) {
      c.fillStyle = '#2d3c3e'; c.fillRect(x, 364, 12, 36); c.fillRect(x - 4, 364, 20, 4);
      c.fillStyle = '#b09b71'; c.fillRect(x + 2, 369, 8, 9);
      c.fillStyle = '#4c5a52'; c.fillRect(x - 2, 397, 16, 5);
    }
    c.fillStyle = '#0e1c27'; c.fillRect(0, 0, 4, 640); c.fillRect(476, 0, 4, 640);
  });
}

export type WaterPalette = 'lake' | 'river' | 'night';
export function fishingPalette(name: string): WaterPalette {
  return /地底|地狱|旧都|灼热/.test(name) ? 'night' : /河|溪|川|山麓|玄武/.test(name) ? 'river' : 'lake';
}

export function drawPondBackdrop(ctx: CanvasRenderingContext2D, width: number, height: number, palette: WaterPalette, time: number) {
  const dark = palette === 'night';
  cached(ctx, `pond:${width}:${height}:${palette}`, width, height, c => {
    const bands = dark ? ['#192d3d', '#1c3646', '#214253', '#234a58']
      : palette === 'river' ? ['#465f69', '#3d6d75', '#417d7d', '#3b6c70']
      : ['#416c76', '#3a7580', '#32838a', '#2c747e'];
    c.fillStyle = bands[0]!; c.fillRect(0, 0, width, height);
    for (let n = 0; n < 4; n++) {
      for (let x = 0; x < width; x += 6) {
        const edge = Math.round(height * (.12 + n * .21) + Math.sin(x * .035 + n * 2) * 3);
        c.fillStyle = bands[n]!; c.fillRect(x, edge, 6, Math.ceil(height * .3));
      }
    }
    // Pixelated shallows at the banks, leaving the actual casting fan open.
    for (let y = 0; y < height; y += 4) {
      const shore = Math.max(0, Math.round((11 + Math.sin(y * .041) * 5 - y / height * 8) / 2) * 2);
      c.fillStyle = dark ? '#34565c' : '#659d8c'; c.fillRect(0, y, shore + 7, 4); c.fillRect(width - shore - 8, y, shore + 8, 4);
      c.fillStyle = dark ? '#2e403f' : '#486d4e'; c.fillRect(0, y, shore, 4); c.fillRect(width - shore, y, shore, 4);
    }
    // Far bank and small stepping stones, outside the fish-bearing play area.
    for (let x = 0; x < width; x += 6) {
      const bank = 6 + Math.round((Math.sin(x * .032) * 3 + 4) / 2) * 2;
      c.fillStyle = dark ? '#293e3e' : '#536d4d'; c.fillRect(x, 0, 6, bank);
      c.fillStyle = dark ? '#3f5854' : '#88a26c'; c.fillRect(x, bank, 6, 2);
    }
    // Low wooded banks: clustered willow leaves, moss, fallen petals and rocks.
    // All scenery stays at the edge of the existing fish-bearing coordinates.
    for (let n = 0; n < Math.ceil(width / 24); n++) {
      const x = n * 27 + Math.round(shade(n + 760) * 9), y = 1 + Math.round(shade(n + 211) * 3);
      pixelEllipse(c, x, y + 4, 17, 8, dark ? '#283e3d' : '#3a5c46', true);
      pixelEllipse(c, x - 4, y, 13, 7, dark ? '#375448' : '#5a7a4e', true);
      pixelEllipse(c, x - 7, y - 2, 8, 5, dark ? '#456452' : '#7c925d', true);
      c.fillStyle = dark ? '#71866b' : '#b5b97c'; c.fillRect(x - 9, y + 1, 3, 1);
      if (n % 4 === 1) { c.fillStyle = '#e3bca4'; c.fillRect(x + 6, y + 2, 2, 2); c.fillRect(x + 9, y + 4, 1, 1); }
    }
    for (let n = 0; n < 18; n++) {
      const x = Math.round(shade(n + 331) * width), y = 14 + Math.round(shade(n + 13) * height * .1);
      pixelEllipse(c, x, y, 5 + n % 4, 2 + n % 2, dark ? '#354c53' : '#718d7f', true);
      c.fillStyle = dark ? '#4b6767' : '#9bb19a'; c.fillRect(x - 3, y - 2, 5, 1);
    }
    for (let n = 0; n < 80; n++) {
      const x = Math.round(shade(n + 123) * width), y = Math.round(shade(n + 299) * height);
      c.fillStyle = dark ? '#2b4e5d' : '#478b90'; c.fillRect(x, y, 4 + n % 11, 1);
      if (n % 4 === 0) { c.fillStyle = dark ? '#365a66' : '#63a39e'; c.fillRect(x + 3, y + 2, 3, 1); }
    }
    for (const side of [0, 1]) {
      for (let n = 0; n < 4; n++) {
        const x = side ? width - 3 : 1, y = Math.round(height * (.18 + n * .24));
        pixelEllipse(c, x, y, 9, 8, dark ? '#365246' : '#547c53', true);
        pixelEllipse(c, x - 2, y - 3, 6, 5, dark ? '#4b6a50' : '#78995f', true);
        c.fillStyle = dark ? '#6c8560' : '#9cae70'; c.fillRect(x - 4, y - 5, 4, 1);
      }
      for (let n = 0; n < 10; n++) {
        const x = side ? width - 8 - n % 3 * 4 : 4 + n % 3 * 4;
        const y = height * (.3 + n * .065);
        pixelLine(c, x, y, x - 3 + n % 7, y - 8 - n % 5, dark ? '#638779' : '#8ab174');
        if (n % 3 === 0) { c.fillStyle = '#b9a776'; c.fillRect(x - 2, Math.round(y - 12), 2, 4); }
      }
    }
    for (let n = 0; n < 5; n++) {
      const x = n % 2 ? width * .93 : width * .065, y = height * (.25 + n * .14);
      pixelEllipse(c, x, y, 6, 3, dark ? '#477367' : '#7ca877', true);
      c.fillStyle = dark ? '#192d3d' : '#3a7580'; c.fillRect(Math.round(x), Math.round(y - 3), 2, 3);
      if (n === 2) { c.fillStyle = '#efc5bf'; c.fillRect(Math.round(x - 3), Math.round(y - 3), 3, 2); }
    }
    const dockX = Math.round(width * .5) - 22, dockY = Math.round(height * .94);
    c.fillStyle = '#283d40'; c.fillRect(dockX - 3, dockY + 2, 52, height - dockY);
    for (let n = 0; n < 5; n++) {
      c.fillStyle = n % 2 ? '#96775b' : '#a58865'; c.fillRect(dockX + n * 9, dockY, 8, height - dockY);
      c.fillStyle = '#bda17a'; c.fillRect(dockX + n * 9, dockY, 8, 1);
      c.fillStyle = '#6b584d'; c.fillRect(dockX + n * 9 + 3, dockY + 5, 1, 6);
    }
    c.fillStyle = '#d8c497'; c.fillRect(dockX - 3, dockY - 1, 4, 4); c.fillRect(dockX + 44, dockY - 1, 4, 4);
  });
  // A few stepped water glints animate independently of the simulation.
  for (let n = 0; n < 18; n++) {
    const x = Math.round(shade(n + 815) * width), y = Math.round((.2 + shade(n + 41) * .65) * height);
    const shift = Math.floor(time / 500 + n) % 4;
    ctx.fillStyle = dark ? '#426876' : '#83b7ac';
    ctx.fillRect(x + shift, y, 3 + shift, 1);
    if (n % 3 === 0) ctx.fillRect(x - shift + 2, y + 3, 3, 1);
  }
  drawPixelSprite(ctx, 'player', Math.round(width * .5) - 12, height - 24, 1);
}
