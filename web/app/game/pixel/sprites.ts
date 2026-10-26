import authoredArt from "../../../../modernization/assets/minigames/pixel-art.json";

/** Authored presentation pixels. Dots are transparent; no game state or RNG. */
export interface PixelArt { rows: readonly string[]; colors: Readonly<Record<string, string>> }
export type PixelSpriteName = keyof typeof authoredArt.sprites;
function withPalette<T extends Record<string, readonly string[]>>(sprites: T) {
  const result = {} as { [K in keyof T]: PixelArt };
  for (const name in sprites) result[name] = { rows: sprites[name]!, colors: authoredArt.colors };
  return result;
}
export const PIXEL_ART = withPalette(authoredArt.sprites);

export function drawPixelSprite(ctx: CanvasRenderingContext2D, name: PixelSpriteName, x: number, y: number, scale = 1, flip = false): void {
  const art = PIXEL_ART[name];
  const width = Math.max(...art.rows.map(row => row.length));
  // Sample onto destination pixels rather than painting fractional rectangles.
  // Small fish remain crisp instead of becoming antialiased dots on Retina.
  for (let row = 0; row < Math.ceil(art.rows.length * scale); row++) {
    const sourceRow = art.rows[Math.min(art.rows.length - 1, Math.floor(row / scale))]!;
    for (let column = 0; column < Math.ceil(width * scale); column++) {
      const sourceColumn = Math.min(width - 1, Math.floor(column / scale));
      const color = art.colors[sourceRow[flip ? width - sourceColumn - 1 : sourceColumn] as keyof typeof art.colors];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(Math.round(x) + column, Math.round(y) + row, 1, 1);
    }
  }
}
