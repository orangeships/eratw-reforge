export type LegacySaveFileType = "normal" | "global" | "variables" | "character";

export interface LegacyIntArray {
  kind: "int-array";
  dimensions: number[];
  /** Only non-zero cells are stored. Missing cells are zero. */
  values: Record<string, bigint>;
}

export interface LegacyStringArray {
  kind: "string-array";
  dimensions: number[];
  /** Only non-empty cells are stored. Missing cells are null/empty. */
  values: Record<string, string>;
}

export type LegacyVariable = bigint | string | LegacyIntArray | LegacyStringArray;

export interface LegacyVariableBlock {
  variables: Record<string, LegacyVariable>;
}

export interface LegacyCharacterSnapshot extends LegacyVariableBlock {
  slotIndex: number;
}

export interface LegacyExtensionEntry {
  kind: "map" | "xml" | "data-table";
  name: string;
  entryCount?: number;
  schemaLength?: number;
  dataLength?: number;
  textLength?: number;
}

export interface LegacySaveSnapshot {
  format: "emuera-binary-1808";
  compressed: boolean;
  fileType: LegacySaveFileType;
  uniqueCode: bigint;
  scriptVersion: bigint;
  comment: string;
  characters: LegacyCharacterSnapshot[];
  globals: LegacyVariableBlock;
  extensions: LegacyExtensionEntry[];
}

export function legacyIntArrayValue(
  block: LegacyVariableBlock,
  variableName: string,
  index: number,
): bigint {
  const value = block.variables[variableName];
  if (!value || typeof value === "bigint" || typeof value === "string" || value.kind !== "int-array") {
    return 0n;
  }
  return value.values[String(index)] ?? 0n;
}

export function legacyStringArrayValue(
  block: LegacyVariableBlock,
  variableName: string,
  index: number,
): string {
  const value = block.variables[variableName];
  if (!value || typeof value === "bigint" || typeof value === "string" || value.kind !== "string-array") {
    return "";
  }
  return value.values[String(index)] ?? "";
}

export function legacyIntArrayEntries(
  block: LegacyVariableBlock,
  variableName: string,
): Array<[number, bigint]> {
  const value = block.variables[variableName];
  if (!value || typeof value === "bigint" || typeof value === "string" || value.kind !== "int-array") {
    return [];
  }
  return Object.entries(value.values)
    .filter(([key]) => !key.includes(","))
    .map(([key, entry]) => [Number(key), entry]);
}
