/**
 * P2-b — seasonal map palette.
 *
 * Ports `@GETSEASONALCOLORS` (DRAW_COLOREDMAP.ERB:401) so the colored-map
 * grid recolors with `time.season` instead of the static spring snapshot.
 *
 * Upstream `SEASONALCOLORS` (DRAW_COLOREDMAP.ERB:405-418) is a flat 48-entry
 * table: 12 terrain names × 4 seasonal slots. Each terrain occupies a
 * 4-entry block (offsets 0..47). The upstream lookup is
 * `SEASONALCOLORS:(DAY:2 % 4 + OFFSET)`, so DAY:2 values 1..4 select slots
 * 1,2,3,0 for spring, summer, autumn, winter respectively.
 *
 *   terrain   offset   winter        spring        summer        autumn
 *   bambood     0     0x3C2D0F      0x2D2D00      0x323D2D      0x46461E
 *   bambool     4     0x5A4B1E      0x787800      0x648C4B      0x8C8C3C
 *   bamboon     8     0x4B3C14      0x4B4B00      0x50643C      0x64642D
 *   bamboos    12     0x2D1E0A      0x141400      0x141E0F      0x28280F
 *   florad     16     0x3C2D0F      0x64963C      0x238C32      0x78460F
 *   floral     20     0x5A4B1E      0xA0D264      0x50B45A      0xB4961E
 *   floran     24     0x4B3C14      0x82B450      0x32A046      0x966E14
 *   floras     28     0x2D1E0A      0x3C7828      0x00641E      0x3C280A
 *   sakurad    32     0x321E14      0xF096C8      0x643C5A      0x5A4B32
 *   sakural    36     0x28190F      0xD26496      0x502846      0x4B3C28
 *   sakuran    40     0x1E140A      0xA03C64      0x3C1E37      0x3C2D1E
 *   sakuras    44     0x140A05      0x5A283C      0x281423      0x2D1E14
 *
 * MVP (P2-b): use the season's own column (no DAY:3 intra-season gradient,
 * no winter snow overlay, no water/fire/flower animation, no 気配/汚れ/time-stop
 * recolor — those are deferred). Faithful to GETSEASONALCOLORS's
 * `SEASONALCOLORS((DAY:2 % 4) + OFFSET)` mid-season return.
 */

/** terrain-name → 4-entry block offset in SEASONALCOLORS (0-indexed). */
const TERRAIN_OFFSET: Record<string, number> = {
  bambood: 0,
  bambool: 4,
  bamboon: 8,
  bamboos: 12,
  florad: 16,
  floral: 20,
  floran: 24,
  floras: 28,
  sakurad: 32,
  sakural: 36,
  sakuran: 40,
  sakuras: 44,
};

/** The flat 48-entry SEASONALCOLORS table (DRAW_COLOREDMAP.ERB:405-418). */
const SEASONALCOLORS: readonly number[] = [
  0x3c2d0f, 0x2d2d00, 0x323d2d, 0x46461e,
  0x5a4b1e, 0x787800, 0x648c4b, 0x8c8c3c,
  0x4b3c14, 0x4b4b00, 0x50643c, 0x64642d,
  0x2d1e0a, 0x141400, 0x141e0f, 0x28280f,
  0x3c2d0f, 0x64963c, 0x238c32, 0x78460f,
  0x5a4b1e, 0xa0d264, 0x50b45a, 0xb4961e,
  0x4b3c14, 0x82b450, 0x32a046, 0x966e14,
  0x2d1e0a, 0x3c7828, 0x00641e, 0x3c280a,
  0x321e14, 0xf096c8, 0x643c5a, 0x5a4b32,
  0x28190f, 0xd26496, 0x502846, 0x4b3c28,
  0x1e140a, 0xa03c64, 0x3c1e37, 0x3c2d1e,
  0x140a05, 0x5a283c, 0x281423, 0x2d1e14,
];

/** Fixed (non-terrain) named colors used by MAPROW_COLORS that don't vary by
 *  season. From SPRING_PALETTE in build-colored-maps.ts (the animation/fixed
 *  representatives). These are NOT in SEASONALCOLORS upstream; they're
 *  ANIMATIONCOLORS / fixed picks the bundle also emits as raw tokens. */
const FIXED_NAMED: Record<string, string> = {
  ground: "#9C7850",
  paving: "#A0A0A0",
  water: "#336688",
  still: "#225577",
  tides: "#447799",
  flower: "#FF66CC",
  flowers: "#FF99FF",
  flame: "#FF6600",
  spray: "#EEEEEE",
  fall: "#CC6600",
  def: "#C8C8C8",
  white: "#FFFFFF",
};

const DEFAULT_TERRAIN_COLOR = "#3C4A2A";

function toHexCss(n: number): string {
  return "#" + n.toString(16).padStart(6, "0").toUpperCase();
}

/**
 * Resolve a raw MAPROW_COLORS token to a CSS color for the given season.
 *
 * @param raw   the verbatim token (terrain name, "0xRRGGBB", "0", or "" = inherit)
 * @param season 1=spring, 2=summer, 3=autumn, 4=winter (GameState.time.season)
 * @returns CSS color string, or `null` when `raw` is empty (inherit from left)
 */
export function resolveMapColor(raw: string, season: number): string | null {
  const s = raw.trim();
  if (!s) return null; // inherit from left neighbor
  if (/^0x[0-9A-Fa-f]{6}$/.test(s)) return "#" + s.slice(2).toUpperCase();
  // Upstream `0` token = RESETCOLOR → GETDEFCOLOR (the runtime default color,
  // white — DRAW_COLOREDMAP.ERB:87-89). Rendering it #000000 makes those
  // default-colored place-name labels (花屋/铃奈庵/警察署 …) invisible black on
  // the dark map. The baked `page.colors` path already returns #e6edf3
  // (build-colored-maps.ts::resolveColor); this seasonal path — the one used
  // in actual gameplay (season is always passed) — must match it.
  if (s === "0") return "#e6edf3";
  const off = TERRAIN_OFFSET[s];
  if (off !== undefined) {
    // Faithful to GETSEASONALCOLORS: DAY:2 values 1..4 select 1,2,3,0.
    const col = ((season % 4) + 4) % 4;
    return toHexCss(SEASONALCOLORS[off + col]!);
  }
  if (FIXED_NAMED[s]) return FIXED_NAMED[s]!;
  return null; // unknown name → inherit
}

/**
 * Build a per-cell RGB grid for a map page from its raw `colorNames` + the
 * current season, applying the same left-inheritance the build script uses
 * (empty token inherits the previous cell's color).
 */
export function resolvePageColors(
  colorNames: readonly (readonly string[])[],
  season: number,
): string[][] {
  const out: string[][] = [];
  for (const row of colorNames) {
    const outRow: string[] = [];
    let last = DEFAULT_TERRAIN_COLOR;
    for (const raw of row) {
      const resolved = resolveMapColor(raw, season);
      if (resolved) last = resolved;
      outRow.push(last);
    }
    out.push(outRow);
  }
  return out;
}
