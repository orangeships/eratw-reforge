import { readCsvText, splitLines } from "../encoding/read-text.js";

/**
 * Phase 7 (P1) importer — `CSV/Item.csv`.
 *
 * Source shape (real file, ~455 lines, UTF-8 BOM):
 *   0,跳蛋,3000,
 *   ;6,後庭拉珠,4500,                  ← commented-out (disabled) item
 *   19,测定仪,30000,;女子力を計る機械   ← col 4 is a free-form comment
 *   30,電子琴,30000                     ← trailing comma omitted (3 fields)
 *   38,簡易泳池,5000,人魚可以入住,FLAG:管理泳池   ← 5 fields (extra note)
 *   47,新鲜精液                          ← price column missing entirely
 *   	;40～59番までは…                   ← tab-indented section comment
 *
 * This mirrors the four parallel ERA arrays sized 1000
 * (`CSV/VariableSize.csv:17-18`): `ITEM:n` (count owned), `ITEMSALES:n`
 * (shop stock), `ITEMNAME:n` (name, auto-loaded from col 2), `ITEMPRICE:n`
 * (price, auto-loaded from col 3). `AutoConst_Item.ERH` exposes the named
 * constant per id (`ITEM_<name> = <id>`). `NOITEM` (VariableSize:19) is a
 * debug flag that makes sex-command item-ownership checks short-circuit —
 * not modeled here.
 *
 * Parser rules:
 *   - Trim each line; skip empty lines and lines starting with `;`
 *     (disabled items + section comments, including tab-indented ones).
 *   - col 0 = id (must be a non-negative integer; otherwise the line is
 *     treated as a non-item comment and skipped).
 *   - col 1 = name (empty name → skip).
 *   - col 2 = price (missing/empty → 0, e.g. 鲜精液 / 衣装 items that are
 *     never shop-bought; present-but-non-integer → throw, that's real
 *     corruption).
 *   - col 3+ = free-form comment (rejoined with `,` in case it contains
 *     commas; a leading `;` is stripped).
 *
 * Note: eraTW has NO type/category column in `Item.csv`. Categories
 * (調教/消耗品/日用品/食材/酒/素質/魔法/…) are decided per-item by the
 * `SELECTCASE` in `ERB/SHOP関連/ITEMDATA.ERB` ("TYPE:…" queries). That rule
 * table is not parsed here — it belongs to the P4 shop slice.
 */

export interface ItemEntry {
  id: number;
  name: string;
  /** Shop price in yen (`ITEMPRICE`). 0 = not shop-purchasable. */
  price: number;
  /** Free-form comment from col 4+ (may be empty). */
  comment: string;
}

export interface ItemsManifest {
  generatedAt: string;
  source: string;
  count: number;
  entries: ItemEntry[];
}

/**
 * Parse `CSV/Item.csv` text into `ItemEntry[]`. Pure (no IO) so it can be
 * unit-tested against fixtures.
 */
export function parseItemsText(text: string): ItemEntry[] {
  const out: ItemEntry[] = [];
  for (const rawLine of splitLines(text)) {
    // splitLines already trims + drops empties. Skip commented-out items
    // and section comments (some are tab-indented before the `;`).
    if (rawLine.startsWith(";")) continue;

    const parts = rawLine.split(",");
    const idStr = (parts[0] ?? "").trim();
    // Section headers / stray non-numeric first columns → skip (not items).
    if (!/^\d+$/.test(idStr)) continue;

    const name = (parts[1] ?? "").trim();
    if (name === "") continue;

    const priceStr = (parts[2] ?? "").trim();
    let price: number;
    if (priceStr === "") {
      price = 0; // e.g. "47,新鲜精液" — exists, never shop-bought.
    } else {
      price = Number.parseInt(priceStr, 10);
      if (!Number.isFinite(price) || price < 0) {
        throw new Error(`Item row has invalid price: "${rawLine}"`);
      }
    }

    // Col 4+ is a free-form comment; rejoin (may contain commas) and strip
    // a leading `;` (eraTW uses `;` to start inline comments there).
    let comment = parts.slice(3).join(",").trim();
    if (comment.startsWith(";")) comment = comment.slice(1).trim();

    out.push({ id: Number.parseInt(idStr, 10), name, price, comment });
  }
  return out;
}

export async function parseItemsFile(filePath: string): Promise<ItemsManifest> {
  const text = await readCsvText(filePath);
  const entries = parseItemsText(text);
  return {
    generatedAt: new Date().toISOString(),
    source: filePath,
    count: entries.length,
    entries,
  };
}
