import { gunzipSync } from "node:zlib";
import type {
  LegacyCharacterSnapshot,
  LegacyExtensionEntry,
  LegacyIntArray,
  LegacySaveFileType,
  LegacySaveSnapshot,
  LegacyStringArray,
  LegacyVariable,
  LegacyVariableBlock,
} from "./types.js";

const ERA_HEADER = Buffer.from([0x89, 0x45, 0x52, 0x41, 0x0d, 0x0a, 0x1a, 0x0a]);
const ERA_ZIP_HEADER = Buffer.from([0x89, 0x45, 0x52, 0x41, 0x5a, 0x49, 0x50, 0x0a]);
const FORMAT_VERSION = 1808;

const TYPE_INT = 0x00;
const TYPE_INT_ARRAY = 0x01;
const TYPE_INT_ARRAY_2D = 0x02;
const TYPE_INT_ARRAY_3D = 0x03;
const TYPE_STRING = 0x10;
const TYPE_STRING_ARRAY = 0x11;
const TYPE_STRING_ARRAY_2D = 0x12;
const TYPE_STRING_ARRAY_3D = 0x13;
const TYPE_MAP = 0x20;
const TYPE_XML = 0x21;
const TYPE_DATA_TABLE = 0x22;
const TYPE_SEPARATOR = 0xfd;
const TYPE_EOC = 0xfe;
const TYPE_EOF = 0xff;

const COMPACT_BYTE_MAX = 0xcf;
const COMPACT_INT16 = 0xd0;
const COMPACT_INT32 = 0xd1;
const COMPACT_INT64 = 0xd2;
const COMPACT_STRING = 0xd8;
const ARRAY_END_ROW = 0xe0;
const ARRAY_END_MATRIX = 0xe1;
const ARRAY_ZERO = 0xf0;
const ARRAY_ZERO_ROWS = 0xf1;
const ARRAY_ZERO_MATRICES = 0xf2;
const ARRAY_END = 0xff;

class Cursor {
  offset = 0;

  constructor(readonly data: Buffer) {}

  get remaining(): number {
    return this.data.length - this.offset;
  }

  private require(length: number): void {
    if (!Number.isSafeInteger(length) || length < 0 || this.offset + length > this.data.length) {
      throw new Error(`ERA save is truncated or has an invalid length at byte ${this.offset}`);
    }
  }

  u8(): number {
    this.require(1);
    return this.data[this.offset++]!;
  }

  i16(): number {
    this.require(2);
    const value = this.data.readInt16LE(this.offset);
    this.offset += 2;
    return value;
  }

  i32(): number {
    this.require(4);
    const value = this.data.readInt32LE(this.offset);
    this.offset += 4;
    return value;
  }

  u32(): number {
    this.require(4);
    const value = this.data.readUInt32LE(this.offset);
    this.offset += 4;
    return value;
  }

  i64(): bigint {
    this.require(8);
    const value = this.data.readBigInt64LE(this.offset);
    this.offset += 8;
    return value;
  }

  bytes(length: number): Buffer {
    this.require(length);
    const value = this.data.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  dotNetString(): string {
    let byteLength = 0;
    let shift = 0;
    for (let count = 0; count < 5; count += 1) {
      const byte = this.u8();
      byteLength |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) {
        if ((byteLength & 1) !== 0) {
          throw new Error(`Invalid UTF-16LE string length ${byteLength} at byte ${this.offset}`);
        }
        return this.bytes(byteLength).toString("utf16le");
      }
      shift += 7;
    }
    throw new Error(`Invalid .NET string length prefix at byte ${this.offset}`);
  }
}

function compactInt(cursor: Cursor, firstByte?: number): bigint {
  const marker = firstByte ?? cursor.u8();
  if (marker <= COMPACT_BYTE_MAX) return BigInt(marker);
  if (marker === COMPACT_INT16) return BigInt(cursor.i16());
  if (marker === COMPACT_INT32) return BigInt(cursor.i32());
  if (marker === COMPACT_INT64) return cursor.i64();
  throw new Error(`Invalid compact integer marker 0x${marker.toString(16)} at byte ${cursor.offset - 1}`);
}

function checkedDimension(cursor: Cursor): number {
  const value = cursor.i32();
  if (value < 0 || value > 10_000_000) {
    throw new Error(`Invalid ERA array dimension ${value} at byte ${cursor.offset - 4}`);
  }
  return value;
}

function indexKey(indices: number[]): string {
  return indices.join(",");
}

function compactCount(cursor: Cursor): number {
  const raw = compactInt(cursor);
  if (raw < 0n || raw > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`Invalid ERA array run length ${raw} at byte ${cursor.offset}`);
  }
  return Number(raw);
}

function parseArray(cursor: Cursor, dimensionsCount: number, strings: boolean): LegacyIntArray | LegacyStringArray {
  const dimensions = Array.from({ length: dimensionsCount }, () => checkedDimension(cursor));
  const indices = Array(dimensionsCount).fill(0) as number[];
  const intValues: Record<string, bigint> = {};
  const stringValues: Record<string, string> = {};

  const ensureInBounds = (): void => {
    for (let axis = 0; axis < dimensionsCount; axis += 1) {
      if (indices[axis]! < 0 || indices[axis]! >= dimensions[axis]!) {
        throw new Error(`ERA array data exceeds declared dimensions at byte ${cursor.offset}`);
      }
    }
  };

  while (true) {
    const marker = cursor.u8();
    if (marker === ARRAY_END) break;
    if (marker === ARRAY_ZERO) {
      indices[dimensionsCount - 1]! += compactCount(cursor);
      continue;
    }
    if (marker === ARRAY_END_ROW && dimensionsCount >= 2) {
      indices[dimensionsCount - 2]! += 1;
      indices[dimensionsCount - 1] = 0;
      continue;
    }
    if (marker === ARRAY_ZERO_ROWS && dimensionsCount >= 2) {
      indices[dimensionsCount - 2]! += compactCount(cursor);
      indices[dimensionsCount - 1] = 0;
      continue;
    }
    if (marker === ARRAY_END_MATRIX && dimensionsCount === 3) {
      indices[0]! += 1;
      indices[1] = 0;
      indices[2] = 0;
      continue;
    }
    if (marker === ARRAY_ZERO_MATRICES && dimensionsCount === 3) {
      indices[0]! += compactCount(cursor);
      indices[1] = 0;
      indices[2] = 0;
      continue;
    }

    ensureInBounds();
    const key = indexKey(indices);
    if (strings) {
      if (marker !== COMPACT_STRING) {
        throw new Error(`Invalid string-array marker 0x${marker.toString(16)} at byte ${cursor.offset - 1}`);
      }
      const value = cursor.dotNetString();
      if (value !== "") stringValues[key] = value;
    } else {
      const value = compactInt(cursor, marker);
      if (value !== 0n) intValues[key] = value;
    }
    indices[dimensionsCount - 1]! += 1;
  }

  return strings
    ? { kind: "string-array", dimensions, values: stringValues }
    : { kind: "int-array", dimensions, values: intValues };
}

function parseValue(cursor: Cursor, type: number): LegacyVariable {
  switch (type) {
    case TYPE_INT: return compactInt(cursor);
    case TYPE_INT_ARRAY: return parseArray(cursor, 1, false);
    case TYPE_INT_ARRAY_2D: return parseArray(cursor, 2, false);
    case TYPE_INT_ARRAY_3D: return parseArray(cursor, 3, false);
    case TYPE_STRING: return cursor.dotNetString();
    case TYPE_STRING_ARRAY: return parseArray(cursor, 1, true);
    case TYPE_STRING_ARRAY_2D: return parseArray(cursor, 2, true);
    case TYPE_STRING_ARRAY_3D: return parseArray(cursor, 3, true);
    default: throw new Error(`Unsupported ERA variable type 0x${type.toString(16)} at byte ${cursor.offset - 1}`);
  }
}

function parseBlock(cursor: Cursor, terminator: number): LegacyVariableBlock {
  const variables: Record<string, LegacyVariable> = {};
  while (true) {
    const type = cursor.u8();
    if (type === terminator) return { variables };
    if (type === TYPE_SEPARATOR) continue;
    if (type === TYPE_EOC || type === TYPE_EOF || type >= TYPE_MAP) {
      throw new Error(`Unexpected ERA block marker 0x${type.toString(16)} at byte ${cursor.offset - 1}`);
    }
    const name = cursor.dotNetString();
    variables[name] = parseValue(cursor, type);
  }
}

function parseExtensions(cursor: Cursor): LegacyExtensionEntry[] {
  const entries: LegacyExtensionEntry[] = [];
  if (cursor.remaining === 0) return entries;
  while (true) {
    const type = cursor.u8();
    if (type === TYPE_EOF) break;
    const name = cursor.dotNetString();
    if (type === TYPE_MAP) {
      const count = cursor.i32();
      if (count < 0 || count > 1_000_000) throw new Error(`Invalid ERA map size ${count}`);
      for (let index = 0; index < count; index += 1) {
        cursor.dotNetString();
        cursor.dotNetString();
      }
      entries.push({ kind: "map", name, entryCount: count });
    } else if (type === TYPE_XML) {
      const xml = cursor.dotNetString();
      entries.push({ kind: "xml", name, textLength: xml.length });
    } else if (type === TYPE_DATA_TABLE) {
      const schema = cursor.dotNetString();
      const data = cursor.dotNetString();
      entries.push({ kind: "data-table", name, schemaLength: schema.length, dataLength: data.length });
    } else {
      throw new Error(`Unsupported ERA extension type 0x${type.toString(16)} at byte ${cursor.offset - 1}`);
    }
  }
  if (cursor.remaining !== 0) {
    throw new Error(`Unexpected ${cursor.remaining} trailing bytes after ERA save EOF`);
  }
  return entries;
}

function fileTypeName(value: number): LegacySaveFileType {
  const names: LegacySaveFileType[] = ["normal", "global", "variables", "character"];
  const name = names[value];
  if (!name) throw new Error(`Unsupported ERA save file type ${value}`);
  return name;
}

/** Parse Emuera's 1808 binary save format without mutating the source file. */
export function parseEraSave(input: Uint8Array): LegacySaveSnapshot {
  const file = Buffer.from(input);
  if (file.length < 16) throw new Error("ERA save is too short");
  const compressed = file.subarray(0, 8).equals(ERA_ZIP_HEADER);
  if (!compressed && !file.subarray(0, 8).equals(ERA_HEADER)) {
    throw new Error("Not an Emuera ERA/ERAZIP save");
  }
  const header = new Cursor(file.subarray(8));
  const version = header.u32();
  if (version !== FORMAT_VERSION) throw new Error(`Unsupported ERA save format version ${version}`);
  const dataCount = header.u32();
  header.bytes(dataCount * 4);
  const payloadBytes = file.subarray(16 + dataCount * 4);
  let payload: Buffer;
  try {
    payload = compressed ? gunzipSync(payloadBytes) : payloadBytes;
  } catch (error) {
    throw new Error(`Could not decompress ERAZIP payload: ${error instanceof Error ? error.message : String(error)}`);
  }

  const cursor = new Cursor(payload);
  const fileType = fileTypeName(cursor.u8());
  if (fileType !== "normal") throw new Error(`Expected a normal gameplay save, received ${fileType}`);
  const uniqueCode = cursor.i64();
  const scriptVersion = cursor.i64();
  const comment = cursor.dotNetString();
  const characterCountBig = cursor.i64();
  if (characterCountBig < 0n || characterCountBig > 100_000n) {
    throw new Error(`Invalid ERA character count ${characterCountBig}`);
  }
  const characterCount = Number(characterCountBig);
  const characters: LegacyCharacterSnapshot[] = [];
  for (let slotIndex = 0; slotIndex < characterCount; slotIndex += 1) {
    characters.push({ slotIndex, ...parseBlock(cursor, TYPE_EOC) });
  }
  const globals = parseBlock(cursor, TYPE_EOF);
  const extensions = parseExtensions(cursor);
  return {
    format: "emuera-binary-1808",
    compressed,
    fileType,
    uniqueCode,
    scriptVersion,
    comment,
    characters,
    globals,
    extensions,
  };
}
