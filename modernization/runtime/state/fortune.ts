/** Runtime seam for the upstream 幻存神签 catalog. */

export interface FortuneSlip {
  /** The visible 1-based slip number used by 神签打印(ARG). */
  id: number;
  /** Character id from 神签TOID:ARG; 29/125 have upstream name overrides. */
  characterId: number;
  /** Text lines extracted from the upstream 神签INFO function. */
  lines: readonly string[];
}

export interface FortuneCatalog {
  maxNum: number;
  /** Index 0 is the ERB dummy slot; indexes 1..maxNum are playable slips. */
  toCharacterId: readonly number[];
  slips: Record<string, FortuneSlip>;
}

let catalog: FortuneCatalog | null = null;

export function setFortuneCatalog(next: FortuneCatalog | null | undefined): void {
  catalog = next ?? null;
}

export function fortuneCatalogLoaded(): boolean {
  return Boolean(catalog && Object.keys(catalog.slips).length >= 129);
}

export function fortuneSlip(id: number): FortuneSlip | undefined {
  return catalog?.slips[String(id)];
}

export function fortuneCharacterId(id: number): number {
  return catalog?.toCharacterId[id] ?? 0;
}

export function fortuneMaxNum(): number {
  return catalog?.maxNum ?? 129;
}
