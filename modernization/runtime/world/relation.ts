/**
 * 相性 (RELATION) lookup for the 拠点来訪 来訪連鎖 (visit chain).
 *
 * `RELATION:A:B` is A's compatibility toward B (directional, default 0). When a
 * chara is rolled to visit, a compatible friend (相性 > 100) may tag along
 * (`来訪フラグ.ERB:99-114`). The data is extracted from `Add_Relation.ERB` into
 * `relation.bundle.json` (build-relation.ts) and injected at app init via
 * `setRelationTable` — the same live-config seam as the dialogue router /
 * catalog. Unconfigured (unit tests, or the Node runtime before wiring) ⇒ an
 * empty table ⇒ `relationOf` returns 0 ⇒ the chain never fires (graceful).
 */

export type RelationTable = Record<number, Record<number, number>>;

let table: RelationTable = {};

/** Inject the built 相性 table (from `relation.bundle.json`). */
export function setRelationTable(t: RelationTable | null | undefined): void {
  table = t ?? {};
}

/** `RELATION:a:b` — a's compatibility toward b (default 0 for unset pairs). */
export function relationOf(a: number, b: number): number {
  return table[a]?.[b] ?? 0;
}
