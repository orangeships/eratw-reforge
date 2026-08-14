/**
 * Colored-map cell width — the em-advance a map cell occupies on the upstream
 * full-width grid (ＭＳ ゴシック / msgothic.ttc, DRAW_COLOREDMAP.ERB:28).
 *
 * Both the in-game `ColoredMapView` and the residence `ColoredMapPreview`
 * enforce this width via an inline-block box, rather than trusting the
 * browser's font advance. Reason: any glyph missing from the `map-gothic`
 * woff2 subset (e.g. simplified-Chinese room labels MS Gothic never had) falls
 * back to a system font whose advance ≠ the grid, and that row's right edge
 * bulges out (the "地图右边凸出来" bug). Boxing each cell to the upstream width
 * makes every row equal regardless of the fallback font.
 */

/**
 * Half-width test, byte-exact against msgothic's `hmtx` for every codepoint
 * the colored-map bundle uses:
 *   - ASCII 0x20-0x7E (room-number digits, brackets)      → 0.5em
 *   - half-width kana / forms 0xFF61-0xFFDC               → 0.5em
 *   - double-line box block 0x2550-0x256C (═║╔╗… — a
 *     msgothic quirk: these render half-width)            → 0.5em
 *   - everything else (CJK, U+3000, single box ─│┌,
 *     arrows, ▲■, simplified-Chinese labels)              → 1em
 */
export function isHalfWidthCp(cp: number): boolean {
  return (
    (cp >= 0x20 && cp <= 0x7e) ||
    (cp >= 0xff61 && cp <= 0xffdc) ||
    (cp >= 0x2550 && cp <= 0x256c)
  );
}

/** Em-advance of a map cell. Empty / ASCII-space cells render as a full-width
 *  space (　), so they're 1em. Multi-glyph cells sum their parts. */
export function cellEmWidth(glyph: string): number {
  if (glyph === "" || glyph === " ") return 1;
  let w = 0;
  for (const ch of glyph) w += isHalfWidthCp(ch.codePointAt(0)!) ? 0.5 : 1;
  return w;
}
