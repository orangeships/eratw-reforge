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
