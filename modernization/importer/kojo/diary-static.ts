import { parseKojoValue, type ScopedKojoSymbols } from "./parser.js";
import type { KojoNode } from "./parser-types.js";

/**
 * Source-backed static lowering for the one diary helper that lives outside
 * personal kojo files.  The helper's upstream loop is implemented by the
 * deterministic runtime's `pickPageSetting`; no VM or arbitrary CALL bridge
 * is involved.
 */
export function resolveDiaryStaticCall(
  functionName: string,
  args: readonly string[],
  line: number,
  symbols: ScopedKojoSymbols,
): KojoNode | null {
  if (functionName.toUpperCase() !== "CHARA_DIARY_PAGESETTING") return null;
  if (args.length !== 2) return null;
  const chara = parseKojoValue(args[0]!, symbols);
  const page = parseKojoValue(args[1]!, symbols);
  if (!chara || !page) return null;
  return { type: "diary-page-setting", chara, page, line };
}
