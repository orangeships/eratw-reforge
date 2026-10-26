/**
 * キャラデータ preference strings (感性/料理) — live-config seam + the
 * SHOW_TASTE tag-folding logic.
 *
 * Data source: `web/app/game/chara-data.bundle.json`, extracted from
 * `ERB/キャラデータ/Chara_data_<N>_<名前>.ERB` by
 * `modernization/scripts/build-chara-data.ts`; injected at app init via
 * `setCharaDataTable` (the relation-table seam pattern). Unconfigured (unit
 * tests / Node before wiring) ⇒ empty table ⇒ every accessor returns
 * "no data" and the PAGE 3 sections stay absent — graceful.
 *
 * Faithfulness anchors:
 *  - `@SHOW_TASTE` (COOKING_UI.ERB:314): `CNT_SPLIT` folds the slash-
 *    delimited tag string counting duplicates (repetition = weight), then
 *    `ARRAYMSORT` sorts by weight; tags print as `[名]Lv{weight}`. When the
 *    親密 gate fails (`INVISIBLE`), the NAME masks to `[？？？？]` but the
 *    weight stays visible — that exact semantic is preserved via `masked`.
 *  - `[得意料理：X]` — the `＊`-delimited specialty inside 助手効果 prints
 *    BEFORE (and regardless of) the mask branch → always visible.
 *  - Weight tiers drive the upstream colors (≥2 green/orange, ≥5 aqua/red);
 *    exposed as `tier` so the UI can map to classes without re-deriving.
 */

export interface CharaDataEntry {
  senseLike?: string;
  senseDislike?: string;
  foodLike?: string;
  foodDislike?: string;
  assistEffect?: string;
  /**
   * 衣装セット id for `デート衣装` — the outfit `EX_COSTUME(C_ID, "デート")`
   * applies at date start (SET_CMN.ERB:309). Upstream resolves the character's
   * `[[const]]` through `衣装セットNN`; most characters declare no such arm and
   * are therefore left undefined.
   */
  dateOutfitSet?: number;
  /** 衣装セット id for `人里デート衣装` — the MAPID-2 variant (SET_CMN.ERB:303). */
  villageDateOutfitSet?: number;
}

let table: Record<number, CharaDataEntry> = {};

/** Inject the built キャラデータ table (from `chara-data.bundle.json`). */
export function setCharaDataTable(t: Record<string | number, CharaDataEntry> | null | undefined): void {
  table = {};
  if (!t) return;
  for (const [k, v] of Object.entries(t)) table[Number(k)] = v;
}

export function charaDataOf(charaNum: number): CharaDataEntry | undefined {
  return table[charaNum];
}

export interface TasteTag {
  tag: string;
  /** Duplicate count in the raw string — the upstream weight (`Lv`). */
  weight: number;
  /** 1 = weight<2, 2 = weight 2..4, 3 = weight ≥5 (upstream color tiers). */
  tier: 1 | 2 | 3;
}

/**
 * Fold a slash-delimited weighted tag string into unique tags sorted by
 * weight desc (mirrors CNT_SPLIT + ARRAYMSORT). The `＊`-delimited specialty
 * segments (得意料理) are stripped first — read them via `specialtyOf`.
 */
export function foldTasteTags(raw: string | undefined): TasteTag[] {
  if (!raw) return [];
  // Remove ＊…＊ specialty segments (SHOW_TASTE splits them off before CNT_SPLIT).
  const cleaned = raw.replace(/＊[^＊]*＊/g, "");
  const counts = new Map<string, number>();
  for (const piece of cleaned.split("/")) {
    const tag = piece.trim();
    if (!tag) continue;
    counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  const out: TasteTag[] = [];
  for (const [tag, weight] of counts) {
    out.push({ tag, weight, tier: weight >= 5 ? 3 : weight >= 2 ? 2 : 1 });
  }
  // 权重降序，同权重按 tag 码点升序。括号是必须的：`||` 比 `?:` 结合得更紧，
  // 早先漏了括号 → 只要权重不同就恒返回 -1（比较器自相矛盾），权重排序失效，
  // 排序结果取决于实现。面板的 [名]LvN 顺序和 L1 的「最强 6 条」都依赖这个顺序。
  out.sort((a, b) => b.weight - a.weight || (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  return out;
}

/** Extract the 得意料理 specialty (`…＊和食＊…` → "和食"), if any. */
export function specialtyOf(raw: string | undefined): string | null {
  if (!raw) return null;
  const m = /＊([^＊]+)＊/.exec(raw);
  return m ? m[1]! : null;
}

// ---------------------------------------------------------------------------
// CSTR (chara CSV string rows) seam — 角色介绍 (CSVCSTR 10..19) + 工作情報/職場
// ---------------------------------------------------------------------------

let cstrTable: Record<number, Record<string, string>> = {};
let personaTraitTable: Record<number, Record<string, number>> = {};

interface LegacyCharaBundleEntry {
  CSTR?: Record<string, string>;
  TALENT?: Record<string, number>;
}

/** Inject per-chara CSTR maps (charas.bundle.json `CSTR` field). */
export function setCharaCstrTable(
  t: Record<string | number, { CSTR?: Record<string, string> } | Record<string, string>> | null | undefined,
): void {
  cstrTable = {};
  personaTraitTable = {};
  if (!t) return;
  for (const [k, v] of Object.entries(t)) {
    const legacy = v as LegacyCharaBundleEntry;
    const cstr = legacy.CSTR ?? (v as Record<string, string>);
    if (cstr && typeof cstr === "object") cstrTable[Number(k)] = cstr as Record<string, string>;
    if (legacy.TALENT && typeof legacy.TALENT === "object") {
      personaTraitTable[Number(k)] = legacy.TALENT;
    }
  }
}

export function charaCstrOf(charaNum: number, key: string): string {
  return cstrTable[charaNum]?.[key] ?? "";
}

/** Distinguishes an authored empty CSTR value from a missing bundle entry.
 * VM routing needs that distinction so unknown string state stays fail-closed. */
export function findCharaCstr(charaNum: number, key: string): string | undefined {
  return cstrTable[charaNum]?.[key];
}

/**
 * Browser-safe view of imported personality traits. The legacy namespace key
 * stays inside this runtime adapter instead of leaking into authored UI code.
 */
export function charaPersonaTraitEntries(charaNum: number): Array<{ id: number; value: number }> {
  return Object.entries(personaTraitTable[charaNum] ?? {}).map(([id, value]) => ({
    id: Number(id),
    value,
  }));
}

/** 角色介绍 — `CSVCSTR(ARG, 10..19)` non-empty paragraphs (PRINT_STATE2.ERB:167-170). */
export function charaIntroParagraphs(charaNum: number): string[] {
  const map = cstrTable[charaNum];
  if (!map) return [];
  const out: string[] = [];
  for (let i = 10; i < 20; i++) {
    const v = map[String(i)];
    if (v) out.push(v);
  }
  return out;
}
