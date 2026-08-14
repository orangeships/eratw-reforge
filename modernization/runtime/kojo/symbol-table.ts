import generated from "./kojo-symbols.json";

export const KOJO_SYMBOL_NAMESPACES = [
  /** Compile-time-only ERB `#DIM CONST` values. These are folded into the
   * generated AST and are never exposed as a runtime state namespace. */
  "CONST",
  "CHARA",
  "TALENT",
  "CFLAG",
  "FLAG",
  "ITEM",
  "TFLAG",
  "TCVAR",
  "ABL",
  "BASE",
  "MAXBASE",
  "EXP",
  "PALAM",
  "JUEL",
  "SOURCE",
  "EQUIP",
  "STAIN",
  "TEQUIP",
  "MARK",
  "EX",
  "NOWEX",
  "STR",
] as const;

export type KojoSymbolNamespace = (typeof KOJO_SYMBOL_NAMESPACES)[number];

export type KojoSymbolTables = Partial<
  Record<KojoSymbolNamespace, Readonly<Record<string, number>>>
>;

export interface KojoNamedDeclarations {
  numeric: readonly string[];
  string: readonly string[];
}

export interface KojoSymbolArtifact {
  generatedAt: string;
  source: string;
  namespaces: KojoSymbolTables;
  /** Character-private constants inferred from that character's ERH/ERB
   * sources. They are merged only while parsing the matching source owner. */
  scopedNamespaces?: Readonly<Record<string, KojoSymbolTables>>;
  /** Non-CONST ERH declarations used to classify authored global variables
   * consistently in Browser bundles and source-backed KojoCache parsing. */
  declarations?: KojoNamedDeclarations;
  scopedDeclarations?: Readonly<Record<string, KojoNamedDeclarations>>;
}

const artifact = generated as KojoSymbolArtifact;

export const DEFAULT_KOJO_SYMBOLS: KojoSymbolTables = artifact.namespaces;

export const SCOPED_KOJO_SYMBOLS: Readonly<Record<string, KojoSymbolTables>> =
  artifact.scopedNamespaces ?? {};

export const GLOBAL_KOJO_DECLARATIONS: KojoNamedDeclarations =
  artifact.declarations ?? { numeric: [], string: [] };

export const SCOPED_KOJO_DECLARATIONS: Readonly<Record<string, KojoNamedDeclarations>> =
  artifact.scopedDeclarations ?? {};

export function mergeKojoSymbolTables(
  base: KojoSymbolTables,
  scoped?: KojoSymbolTables,
): KojoSymbolTables {
  if (!scoped) return base;
  return Object.fromEntries(
    KOJO_SYMBOL_NAMESPACES.map((namespace) => [
      namespace,
      { ...(base[namespace] ?? {}), ...(scoped[namespace] ?? {}) },
    ]),
  );
}

export function resolveKojoSymbol(
  tables: KojoSymbolTables,
  namespace: KojoSymbolNamespace,
  rawName: string,
): number | null {
  const name = rawName.trim();
  if (/^-?\d+$/.test(name)) return Number(name);
  return tables[namespace]?.[name] ?? null;
}
