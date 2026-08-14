import type { GameState } from "../state/game-state.js";

/**
 * Resolve the active personal-kojo variant using the same precedence in
 * Browser, KojoCache, and Tauri adapters.
 *
 * `selectedKojoVariants` stores bundle ids (`"0"` for the default), while
 * the lazy index stores the upstream selector code (`""` for the default),
 * hence the explicit `defaultCode` parameter.
 */
export function resolveActiveKojoVariantCode(
  state: Readonly<GameState>,
  charaNum: number,
  availableCodes: Iterable<string>,
  defaultCode: string,
): string {
  const available = new Set(availableCodes);
  const selected = state.selectedKojoVariants?.[charaNum];
  const selectedCode = normalizeVariantCode(selected, defaultCode);
  if (selectedCode !== undefined && available.has(selectedCode)) return selectedCode;

  const slot = charaNum === 0 ? state.master : state.charas[charaNum];
  const cflag = slot?.state.CFLAG?.[998];
  const cflagCode = Number.isFinite(cflag) ? normalizeVariantCode(String(cflag), defaultCode) : undefined;
  if (cflagCode !== undefined && available.has(cflagCode)) return cflagCode;

  return available.has(defaultCode) ? defaultCode : [...available][0] ?? defaultCode;
}

function normalizeVariantCode(value: string | undefined, defaultCode: string): string | undefined {
  if (value === undefined || value.trim().length === 0) return undefined;
  if (value === "0" || value.startsWith("default:")) return defaultCode;
  return value;
}
