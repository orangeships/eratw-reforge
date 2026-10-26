export interface AsciiCell { glyph: string; tone: number }
const RAMP = " .,:;-~=+*#";

/** Small, presentation-only raster. Transparent pixels remain empty. */
export function rasterToAscii(data: Uint8ClampedArray, cols: number, rows: number): AsciiCell[][] {
  const light = (x: number, y: number): number => {
    const p = (Math.max(0, Math.min(rows - 1, y)) * cols + Math.max(0, Math.min(cols - 1, x))) * 4;
    return (data[p] * 0.2126 + data[p + 1] * 0.7152 + data[p + 2] * 0.0722) / 255 * data[p + 3] / 255;
  };
  return Array.from({ length: rows }, (_, y) => Array.from({ length: cols }, (_, x) => {
    if (data[(y * cols + x) * 4 + 3] < 80) return { glyph: " ", tone: 0 };
    const l = light(x, y);
    const gx = light(x + 1, y) - light(x - 1, y);
    const gy = light(x, y + 1) - light(x, y - 1);
    const edge = Math.hypot(gx, gy) > 0.3;
    const angle = (Math.atan2(gy, gx) * 180 / Math.PI + 180) % 180;
    const glyph = edge
      ? angle < 22.5 || angle >= 157.5 ? "|" : angle < 67.5 ? "\\" : angle < 112.5 ? "-" : "/"
      : RAMP[Math.min(RAMP.length - 1, Math.floor(l * RAMP.length))];
    return { glyph, tone: edge ? 5 : Math.min(4, Math.floor(l * 5)) };
  }));
}

export function asciiHtml(grid: AsciiCell[][]): string {
  const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return grid.map((line) => {
    let result = "", run = "", tone = -1;
    const flush = () => { if (run) result += `<span class="ascii-tone-${tone}">${escape(run)}</span>`; };
    for (const cell of line) {
      if (cell.tone !== tone) { flush(); run = ""; tone = cell.tone; }
      run += cell.glyph;
    }
    flush();
    return result;
  }).join("\n");
}
