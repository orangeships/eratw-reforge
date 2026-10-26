import { promises as fs } from "node:fs";
import * as path from "node:path";
import { readXmlText as readErbText } from "../encoding/read-text.js";
import { compileKojoVmProgram } from "./compiler.js";
import type { KojoVmFunction, KojoVmProgram } from "../../runtime/kojo-vm/types.js";

const ERB_EXTENSIONS = new Set([".erb", ".erh", ".erhex"]);
const GLOBAL_NUMERIC_CONST = /^\s*#DIM\s+CONST\s+([\p{L}_][\p{L}\p{N}_]*)\s*=\s*([^,;{}]+?)\s*(?:;.*)?$/imu;
const GLOBAL_NUMERIC_ARRAY = /^\s*#DIM\s+CONST\s+([\p{L}_][\p{L}\p{N}_]*)\s*=\s*(.*?)\s*$/iu;

const IDENTIFIER = /[\p{L}_][\p{L}\p{N}_]*/gu;

function parseGlobalNumericConstant(raw: string): number | null {
  const value = raw.trim();
  if (/^-?\d+$/.test(value) || /^0x[0-9a-f]+$/i.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  // Emuera's `1p9` notation denotes a bit value (1 << 9). It appears in
  // project-wide flag constants and must remain a numeric constant, rather
  // than an unresolved authored symbol in the VM.
  const bitValue = /^(-?\d+)\s*[pP]\s*(\d+)$/.exec(value);
  if (!bitValue) return null;
  const base = Number(bitValue[1]);
  const shift = Number(bitValue[2]);
  const parsed = base * 2 ** shift;
  return Number.isSafeInteger(base) && Number.isSafeInteger(shift) && Number.isSafeInteger(parsed) ? parsed : null;
}

function withoutComment(line: string): string {
  const comment = line.indexOf(";");
  return (comment < 0 ? line : line.slice(0, comment)).trim();
}

function parseGlobalNumberArrayValues(raw: string, constants: ReadonlyMap<string, number>): number[] | null {
  const values = raw.split(",").map((value) => value.trim()).filter(Boolean);
  if (values.length === 0) return null;
  const parsed = values.map((value) => parseGlobalNumericConstant(value) ?? constants.get(value.toUpperCase()));
  return parsed.every((value): value is number => value !== undefined) ? parsed : null;
}

function arraysEqual(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function collectGlobalNumberConstants(
  files: readonly string[],
  sources: ReadonlyMap<string, string>,
): Map<string, number> {
  const constants = new Map<string, number>();
  const conflictedNames = new Set<string>();
  for (const file of files) {
    const source = sources.get(file);
    if (source === undefined) throw new Error(`missing loaded ERB source: ${file}`);
    for (const line of source.split(/\r?\n/)) {
      const match = GLOBAL_NUMERIC_CONST.exec(line);
      if (!match) continue;
      const name = match[1]!.toUpperCase();
      const value = parseGlobalNumericConstant(match[2]!);
      if (value === null) continue;
      // Definitions must agree. Ambiguous global constants are deliberately
      // left unexpanded so their consuming route remains fail-closed.
      if (conflictedNames.has(name)) continue;
      if (!constants.has(name)) constants.set(name, value);
      else if (constants.get(name) !== value) {
        constants.delete(name);
        conflictedNames.add(name);
      }
    }
  }
  return constants;
}

function collectGlobalNumberArrays(
  files: readonly string[],
  constants: ReadonlyMap<string, number>,
  sources: ReadonlyMap<string, string>,
): Record<string, readonly number[]> {
  const arrays: Record<string, readonly number[]> = {};
  const conflictedNames = new Set<string>();
  for (const file of files) {
    const source = sources.get(file);
    if (source === undefined) throw new Error(`missing loaded ERB source: ${file}`);
    const lines = source.split(/\r?\n/);
    let active: { name: string; values: string[] } | null = null;
    let braceArrayBlock = false;
    const record = (name: string, values: readonly string[]) => {
      const parsed = parseGlobalNumberArrayValues(values.join(","), constants);
      if (!parsed || conflictedNames.has(name)) return;
      const previous = arrays[name];
      if (!previous) arrays[name] = parsed;
      else if (!arraysEqual(previous, parsed)) {
        delete arrays[name];
        conflictedNames.add(name);
      }
    };
    for (const sourceLine of lines) {
      const line = withoutComment(sourceLine);
      if (active) {
        const closing = line.indexOf("}");
        active.values.push(closing < 0 ? line : line.slice(0, closing));
        if (closing >= 0) {
          record(active.name, active.values);
          active = null;
        }
        continue;
      }
      if (line === "{") {
        braceArrayBlock = true;
        continue;
      }
      if (line === "}") {
        braceArrayBlock = false;
        continue;
      }
      const declaration = GLOBAL_NUMERIC_ARRAY.exec(line);
      if (!declaration) continue;
      const name = declaration[1]!.toUpperCase();
      const initial = declaration[2]!.trim();
      if (initial.includes(",")) {
        if (braceArrayBlock) active = { name, values: [initial] };
        else record(name, [initial]);
      } else if (!initial) {
        active = { name, values: [] };
      }
    }
  }
  return arrays;
}

function expandGlobalNumberConstants(source: string, constants: ReadonlyMap<string, number>): string {
  if (constants.size === 0) return source;
  return source.split(/\r?\n/).map((line) => {
    const comment = line.indexOf(";");
    const code = comment < 0 ? line : line.slice(0, comment);
    // Keep declarations literal so they do not turn their own identifier into
    // a numeric token. PRINT text is not numeric source syntax.
    if (/^\s*(?:#DIM\s+CONST|PRINT)/i.test(code)) return line;
    const expanded = code.replace(IDENTIFIER, (name) => String(constants.get(name.toUpperCase()) ?? name));
    return comment < 0 ? expanded : `${expanded}${line.slice(comment)}`;
  }).join("\n");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function expandGlobalNumberArrays(source: string, arrays: Readonly<Record<string, readonly number[]>>): string {
  const names = Object.keys(arrays);
  if (names.length === 0) return source;
  const reference = new RegExp(
    `(?<![\\p{L}\\p{N}_])(${names.map(escapeRegExp).join("|")}):([\\p{L}_][\\p{L}\\p{N}_]*(?::\\d+)?|\\d+)`,
    "giu",
  );
  return source.split(/\r?\n/).map((line) => {
    const comment = line.indexOf(";");
    const code = comment < 0 ? line : line.slice(0, comment);
    if (/^\s*#DIM\s+CONST/i.test(code)) return line;
    const expanded = code.replace(reference, (_whole, name: string, index: string) => `__KOJO_VM_ARRAY(${name.toUpperCase()}, ${index})`);
    return comment < 0 ? expanded : `${expanded}${line.slice(comment)}`;
  }).join("\n");
}

export interface KojoVmDuplicateFunction {
  name: string;
  first: KojoVmFunction["location"];
  duplicate: KojoVmFunction["location"];
}

export interface KojoVmProjectLoad {
  program: KojoVmProgram;
  files: string[];
  duplicateFunctions: KojoVmDuplicateFunction[];
}

async function listErbFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(fullPath);
      else if (entry.isFile() && ERB_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(fullPath);
    }
  }
  await visit(root);
  return files.sort((left, right) => left.localeCompare(right));
}

/** Node-only project loader for P1 compilation. It uses the same mixed-encoding
 * reader as the existing importers and deliberately reports duplicate function
 * names rather than treating filesystem order as ERB semantics. */
export async function loadKojoVmProject(erbRoot: string): Promise<KojoVmProjectLoad> {
  const files = await listErbFiles(erbRoot);
  // The project-wide constant passes and compiler consume the same mixed-
  // encoding source. Read each file once so full-project differential runs
  // remain bounded without changing declaration order or duplicate handling.
  const sources = new Map(await Promise.all(files.map(async (file) => [file, await readErbText(file)] as const)));
  const globalConstants = collectGlobalNumberConstants(files, sources);
  const globalNumberArrays = collectGlobalNumberArrays(files, globalConstants, sources);
  const program: KojoVmProgram = { functions: {} };
  const duplicateFunctions: KojoVmDuplicateFunction[] = [];
  for (const file of files) {
    const relPath = path.relative(erbRoot, file).split(path.sep).join("/");
    const rawSource = sources.get(file);
    if (rawSource === undefined) throw new Error(`missing loaded ERB source: ${file}`);
    const source = expandGlobalNumberArrays(
      expandGlobalNumberConstants(rawSource, globalConstants),
      globalNumberArrays,
    );
    const compiled = compileKojoVmProgram(source, relPath);
    for (const [name, fn] of Object.entries(compiled.functions)) {
      const first = program.functions[name];
      if (first) {
        duplicateFunctions.push({ name, first: first.location, duplicate: fn.location });
        continue;
      }
      program.functions[name] = fn;
    }
  }
  if (Object.keys(globalNumberArrays).length > 0) program.globalNumberArrays = globalNumberArrays;
  return { program, files: files.map((file) => path.relative(erbRoot, file).split(path.sep).join("/")), duplicateFunctions };
}
