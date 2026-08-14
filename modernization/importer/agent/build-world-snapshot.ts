/**
 * Phase 2.6 — Build a `WorldSnapshot` from the 9 manifests produced
 * by `scripts/build-manifests.ts`.
 *
 * Pure function. Reads JSON from disk (the 9 manifests), projects
 * them into the read-only `WorldSnapshot` shape. No I/O beyond
 * `fs.readFile` for the JSONs; no network; no LLM.
 *
 * Used by:
 *   - `tests/unit/build-world-snapshot.test.ts` (verifies the shape)
 *   - Future Phase 5+ `CommandResolver` / Phase 6 `DialogueRouter`
 *     (online path — load manifests, snapshot, hand to the
 *     deterministic core, which then publishes the snapshot)
 *
 * The shape is locked to `schemas/types.ts` `WorldSnapshot`. If
 * you change one, change the other.
 */

import * as path from "node:path";
import { promises as fs } from "node:fs";
import type { WorldSnapshot } from "../../schemas/types.js";

// -------- narrowed shapes of the 9 manifests we read --------
//
// We re-declare the fields we need locally (rather than importing
// the importer types) to keep this module free of side-effecting
// imports — the importer modules are run via tsx from /web/ and we
// don't want the snapshot builder to depend on that.

interface CharactersManifest {
  count: number;
  entries: Array<{
    id: number;
    fields: Record<string, string>;
  }>;
}

interface FlagsManifest {
  files: Array<{
    entries: Array<{ id: number; names: string[] }>;
  }>;
}

interface CommandsManifest {
  commandCount: number;
  commands: Array<{
    commandNo: number;
    kind: "COMF" | "SCOMF" | "IRAI" | "IRAI_IPPAN" | "IRAI_KOYU";
    displayName: string;
  }>;
}

interface FunctionsManifest {
  functionCount: number;
  files: Array<{
    relPath: string;
    dir: string;
    functions: Array<{ name: string; line: number }>;
  }>;
}

interface KojosManifest {
  charaCount: number;
  fileCount: number;
  atLineTotal: number;
  charas: Array<{
    chara: {
      charaNum: number;
      charaName: string;
      charaJpName: string | null;
      charaDirName: string;
    };
    variants: Array<{
      name: string;
      depth: number;
      variantCode: string | null;
      fileCount: number;
    }>;
    files: Array<{
      relPath: string;
      fileName: string;
      charaNum: number | null;
      variantCode: string | null;
      topic: string;
      isCanonical: boolean;
      sizeBytes: number;
      lineCount: number;
      atFuncCount: number;
    }>;
  }>;
}

interface EventMessagesManifest {
  fileCount: number;
  atFuncTotal: number;
  entries: Array<{
    relPath: string;
    fileName: string;
    category: string;
    atFuncs: Array<{ name: string; line: number }>;
  }>;
}

export interface ManifestPaths {
  /** Absolute or relative path to the 9 manifest JSONs. */
  outDir: string;
  /** Optional override of the takenAt timestamp; defaults to Date.now(). */
  takenAt?: number;
}

async function readJson<T>(p: string): Promise<T> {
  const text = await fs.readFile(p, "utf-8");
  return JSON.parse(text) as T;
}

/**
 * Build a `WorldSnapshot` from the 9 manifests under `paths.outDir`.
 *
 * Throws if any of the 9 files is missing or malformed — fail-fast
 * is the right behavior here. Callers wanting partial snapshots can
 * catch + inspect, but the production usage (Phase 5+ runtime) wants
 * the full picture.
 */
export async function buildWorldSnapshot(paths: ManifestPaths): Promise<WorldSnapshot> {
  const takenAt = paths.takenAt ?? Date.now();
  const out = paths.outDir;

  // Read the 9 manifests in parallel — they're independent.
  const [
    chars,
    flags,
    commands,
    functions,
    kojos,
    eventMessages,
  ] = await Promise.all([
    readJson<CharactersManifest>(path.join(out, "characters.json")),
    readJson<FlagsManifest>(path.join(out, "flags.json")),
    readJson<CommandsManifest>(path.join(out, "commands.json")),
    readJson<FunctionsManifest>(path.join(out, "functions.json")),
    readJson<KojosManifest>(path.join(out, "kojos.json")),
    readJson<EventMessagesManifest>(path.join(out, "event-messages.json")),
  ]);

  // -------- charas --------
  const charaRows = chars.entries.map((e) => ({
    charaNum: e.id,
    name: e.fields["名前"] ?? "",
    callName: e.fields["呼び名"] ?? "",
  }));

  // -------- flagUniverse --------
  // Flatten the per-file `entries` arrays into a single id→names
  // list. There may be duplicates across .als files; we de-dup by
  // id and merge the names. (This is the only place in 2.6 where
  // we do any cross-file reconciliation.)
  const flagMap = new Map<number, string[]>();
  for (const f of flags.files) {
    for (const entry of f.entries) {
      const slot = flagMap.get(entry.id) ?? [];
      for (const n of entry.names) {
        if (!slot.includes(n)) slot.push(n);
      }
      flagMap.set(entry.id, slot);
    }
  }
  const flagUniverse = [...flagMap.entries()]
    .sort(([a], [b]) => a - b)
    .map(([id, names]) => ({ id, names }));

  // -------- commandCatalog --------
  const commandCatalog = commands.commands.map((c) => ({
    commandNo: c.commandNo,
    kind: c.kind,
    displayName: c.displayName,
  }));

  // -------- functionIndex --------
  // Project every (file, function) pair into a flat list. The
  // function index is the largest manifest; the snapshot keeps
  // it in full so an agent can name-drop existing @-funcs.
  const functionIndex = functions.files.flatMap((f) =>
    f.functions.map((fn) => ({ name: fn.name, file: f.relPath, line: fn.line })),
  );

  // -------- kojoMap --------
  // Group by charaNum; under each, list variants + their files.
  // Empty variants list per chara is allowed (the synthetic
  // variant for `159 先代` already has files attached, but if
  // a chara has zero M_KOJO files it shows as a chara with empty
  // variants — that's still useful for the agent).
  const kojoMap = kojos.charas.map((c) => ({
    charaNum: c.chara.charaNum,
    variants: c.variants.map((v) => {
      // Files that live under this variant's dir; we re-filter
      // here because the importer already bucketed them, but the
      // grouping is by variant dir NAME, not variant code.
      const files = c.files
        .filter((f) => f.relPath.includes(`/${v.name}/`))
        .map((f) => ({
          topic: f.topic,
          relPath: f.relPath,
          atFuncCount: f.atFuncCount,
        }));
      return {
        variantCode: v.variantCode,
        files,
      };
    }),
  }));

  // -------- genericHandlers --------
  const genericHandlers = eventMessages.entries.map((e) => ({
    relPath: e.relPath,
    category: e.category,
    atFuncs: e.atFuncs.map((f) => ({ name: f.name, line: f.line })),
  }));

  return {
    takenAt,
    charas: charaRows,
    flagUniverse,
    commandCatalog,
    functionIndex,
    kojoMap,
    genericHandlers,
    timeOfDay: null,
    locationMap: null,
  };
}
