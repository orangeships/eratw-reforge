import type { GameState } from "../state/index.js";
import { applyKojoEffects } from "../kojo/effects.js";
import type { KojoEffectTarget, KojoStagedEffect } from "../kojo/types.js";
import { DEFAULT_KOJO_SYMBOLS, resolveKojoSymbol, type KojoSymbolTables } from "../kojo/symbol-table.js";
import type { KojoVmWrite } from "./types.js";

const WRITABLE_NAMESPACES = new Set<KojoEffectTarget["ns"]>([
  "CFLAG", "TFLAG", "TCVAR", "EXP", "MARK", "ABL", "TALENT", "BASE", "MAXBASE", "PALAM", "FLAG",
  "MONEY", "ITEM", "JUEL", "EX", "EQUIP", "STAIN", "TEQUIP", "CUP", "CDOWN", "SOURCE", "NOWEX", "TIME",
  "DIARY", "MAX_DIARY_PAGE", "PAGESET", "DOWNBASE",
]);

export interface KojoVmEffectMapping {
  effects: KojoStagedEffect[];
  unsupportedWrites: string[];
}

/** Convert raw ERB overlay writes into the existing authoritative effect
 * contract. Numeric slot ids are accepted alongside canonical symbols because
 * the upstream ERB uses both forms. Unsupported writes cannot be partially
 * committed. */
export function mapKojoVmWritesToEffects(
  writes: readonly KojoVmWrite[],
  targetChara: number,
  symbols: KojoSymbolTables = DEFAULT_KOJO_SYMBOLS,
): KojoVmEffectMapping {
  const effects: KojoStagedEffect[] = [];
  const unsupportedWrites: string[] = [];
  for (const write of writes) {
    if ("kind" in write && write.kind === "string") {
      const masterName = /^MASTERNAME:(.+)$/i.exec(write.target.trim());
      if (!masterName || !/^\d+$/.test(masterName[1]!)) {
        unsupportedWrites.push(`${write.target}: unsupported string namespace`);
        continue;
      }
      effects.push({ kind: "display-name", observer: Number(masterName[1]), subject: 0, value: write.value, line: write.location.line });
      continue;
    }
    if (!("target" in write)) {
      effects.push({ kind: "memory", memory: write.memory, charaNum: write.charaNum, key: write.key });
      continue;
    }
    // The string branch above handles the only string write variant, leaving
    // a numeric staged state write here.
    const parts = write.target.split(":");
    const namespace = parts.shift()?.toUpperCase() as KojoEffectTarget["ns"] | undefined;
    if (!namespace || !WRITABLE_NAMESPACES.has(namespace)) {
      unsupportedWrites.push(`${write.target}: unsupported namespace`);
      continue;
    }
    const diaryNamespace = namespace === "DIARY" || namespace === "MAX_DIARY_PAGE" || namespace === "PAGESET";
    const global = namespace === "FLAG" || namespace === "TFLAG" || namespace === "ITEM" || namespace === "MONEY" || namespace === "TIME";
    let scope: number | "GLOBAL" = global ? "GLOBAL" : targetChara;
    if (!global) {
      const scopeToken = parts[0]?.toUpperCase();
      if (scopeToken === "TARGET") {
        parts.shift();
      } else if (scopeToken === "MASTER") {
        parts.shift();
        scope = 0;
      // A single numeric segment is the field id (`CFLAG:1001`), not a
      // character scope. Numeric subjects are only unambiguous with a
      // subsequent field segment (`CFLAG:59:1001`).
      } else if (scopeToken && /^\d+$/.test(scopeToken) && parts.length > 1) {
        parts.shift();
        scope = Number(scopeToken);
      }
    }
    let id: number | null;
    if (diaryNamespace) {
      const rawId = parts.join(":").trim();
      id = /^\d+$/.test(rawId) ? Number(rawId) : null;
    } else if (namespace === "MONEY") {
      const rawId = parts.join(":").trim();
      id = rawId === "" ? 0 : /^\d+$/.test(rawId) ? Number(rawId) : null;
    } else if (namespace === "TIME") {
      id = 0;
    } else {
      const symbolNamespace = namespace === "CUP" || namespace === "CDOWN"
        ? "PALAM"
        : namespace === "DOWNBASE"
          ? "BASE"
          : namespace;
      id = resolveKojoSymbol(symbols, symbolNamespace, parts.join(":"));
    }
    if (id === null) {
      unsupportedWrites.push(`${write.target}: unresolved symbol`);
      continue;
    }
    effects.push({ kind: write.operation, target: { ns: namespace, scope, id }, value: write.value, line: write.location.line });
  }
  return unsupportedWrites.length > 0 ? { effects: [], unsupportedWrites } : { effects, unsupportedWrites: [] };
}

/** The only VM write commit path. It delegates to the established authored
 * kojo effect applier and returns the untouched snapshot if mapping failed. */
export function commitKojoVmWrites(
  state: Readonly<GameState>,
  writes: readonly KojoVmWrite[],
  targetChara: number,
  symbols: KojoSymbolTables = DEFAULT_KOJO_SYMBOLS,
): { state: GameState; mapping: KojoVmEffectMapping } {
  const mapping = mapKojoVmWritesToEffects(writes, targetChara, symbols);
  return {
    state: mapping.unsupportedWrites.length > 0 ? state as GameState : applyKojoEffects(state, mapping.effects),
    mapping,
  };
}
