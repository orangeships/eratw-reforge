/**
 * F2 — ERB command-catalog parser.
 *
 * Walks `ERB/コマンド関連/` recursively and extracts the eraTW command
 * catalog from **filenames alone**. Command numbers and display names are
 * embedded in basenames (e.g. `COMF300 会話.ERB`), so we don't need to
 * parse ERB bodies for the index. See phase-2-3-survey.md §5.
 *
 * Three numbered patterns map to a `CommandKind`; everything else is a
 * helper bucketed by basename / containing-directory.
 */

import * as path from "node:path";
import { promises as fs } from "node:fs";
import type {
  CommandEntry,
  CommandKind,
  CommandsManifest,
  HelperEntry,
  HelperKind,
} from "./types.js";

/** ERB extension we recognize for command files. */
const ERB_EXT = ".erb";

/**
 * Filename patterns. Order matters for COMF: the spaced form is checked
 * first, then the no-separator-CJK form, then the number-only form. Other
 * kinds have only one variant in the upstream tree.
 *
 * Notable real-world cases captured:
 *   - `COMF300 会話.ERB`           → COMF #300 "会話"          (standard form)
 *   - `COMF460妄想オナニー.ERB`     → COMF #460 "妄想オナニー"   (no separator, CJK name)
 *   - `COMF999.ERB`                → COMF #999 ""               (number-only placeholder)
 *   - `COMF270-299KOJO.ERB`        → NOT a command; the digit-range form falls
 *                                    to helpers (the third pattern's `[^\d\s-]`
 *                                    anchor blocks `-` as the first name char).
 */
const COMMAND_PATTERNS: Array<{ kind: CommandKind; re: RegExp }> = [
  { kind: "COMF", re: /^COMF(\d+)\s+(.+)\.ERB$/i },
  { kind: "COMF", re: /^COMF(\d+)([^\d\s-].*?)\.ERB$/i },
  // Empty capture group `()` so `m[2]` is "" (not undefined) for the
  // number-only form. Keeps the matchFilename body uniform.
  { kind: "COMF", re: /^COMF(\d+)()\.ERB$/i },
  { kind: "SCOMF", re: /^SCOMF(\d+)\s+(.+)\.ERB$/i },
  { kind: "IRAI", re: /^IRAI_(\d+)\s+(.+)\.ERB$/i },
  // Note: 一般依頼 / 固有依頼 use `_` as the number / name separator (no
  // space after the number), so the regex is `_(.+)` not `\s+(.+)`.
  { kind: "IRAI_IPPAN", re: /^一般依頼(\d+)_(.+)\.ERB$/i },
  { kind: "IRAI_KOYU", re: /^固有依頼(\d+)_(.+)\.ERB$/i },
];

interface MatchedCommand {
  kind: CommandKind;
  commandNo: number;
  displayName: string;
}

function matchFilename(basename: string): MatchedCommand | null {
  for (const { kind, re } of COMMAND_PATTERNS) {
    const m = re.exec(basename);
    if (m) {
      return {
        kind,
        commandNo: Number(m[1]),
        displayName: m[2] ?? "",
      };
    }
  }
  return null;
}

/**
 * Infer a helper's role from its basename + the path it sits under.
 *
 *   - basename starts with `USERCOM`  → USERCOM
 *   - basename starts with `COMORDER` → COMORDER
 *   - basename starts with `COMABLE` or any segment of the relPath equals
 *     `COMABLE`                       → COMABLE
 *   - else                            → OTHER
 *
 * The COMABLE check covers both `COMABLE.ERB` (basename) and
 * `COMABLE/COMABLE_300.ERB` (subdir membership), since eraTW uses the
 * directory `COMABLE/` as a logical bucket as well as the basename prefix.
 */
function inferHelperKind(basename: string, relPath: string): HelperKind {
  if (basename.startsWith("USERCOM")) return "USERCOM";
  if (basename.startsWith("COMORDER")) return "COMORDER";
  const segments = relPath.split("/");
  if (basename.startsWith("COMABLE") || segments.includes("COMABLE")) {
    return "COMABLE";
  }
  return "OTHER";
}

/**
 * Compute the category folder. Strip a leading `COMF/` or `SCOMF/` and
 * return the remaining directory portion (without basename). Returns `""`
 * when the file sits directly under `COMF/` or `SCOMF/`.
 */
function computeCategory(relPath: string): string {
  let p = relPath;
  if (p.startsWith("COMF/")) p = p.slice("COMF/".length);
  else if (p.startsWith("SCOMF/")) p = p.slice("SCOMF/".length);
  const slash = p.lastIndexOf("/");
  return slash < 0 ? "" : p.slice(0, slash);
}

/** Recursively list every *.ERB file under `commandDir`, sorted, POSIX-relative. */
async function listErbFiles(commandDir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (
        e.isFile() &&
        path.extname(e.name).toLowerCase() === ERB_EXT
      ) {
        out.push(full);
      }
    }
  }
  await walk(commandDir);
  out.sort();
  return out;
}

/**
 * Parse the `コマンド関連/` directory into a `CommandsManifest`. Tolerates
 * a missing directory (returns an empty manifest) — useful for fixtures
 * that don't include the full eraTW shape.
 */
export async function parseCommands(
  commandDir: string,
): Promise<CommandsManifest> {
  const absFiles = await listErbFiles(commandDir).catch(
    (e: NodeJS.ErrnoException) => {
      if (e?.code === "ENOENT") return [] as string[];
      throw e;
    },
  );

  const commands: CommandEntry[] = [];
  const helpers: HelperEntry[] = [];

  for (const abs of absFiles) {
    const rel = path.relative(commandDir, abs).split(path.sep).join("/");
    const base = path.basename(rel);
    const matched = matchFilename(base);
    if (matched) {
      commands.push({
        commandNo: matched.commandNo,
        kind: matched.kind,
        displayName: matched.displayName,
        fileName: base,
        relPath: rel,
        category: computeCategory(rel),
      });
    } else {
      helpers.push({
        relPath: rel,
        kind: inferHelperKind(base, rel),
      });
    }
  }

  // Stable sort: commands by (commandNo, kind), helpers by relPath. The
  // walker already returns paths sorted, so helpers come out sorted; we
  // re-sort commands because filename order doesn't equal number order
  // (e.g. SCOMF1 sorts before SCOMF60 fine, but COMF300 sorts before
  // COMF40 lexicographically — we want numeric order).
  commands.sort((a, b) => a.commandNo - b.commandNo || a.kind.localeCompare(b.kind));

  return {
    generatedAt: new Date().toISOString(),
    projectRoot: "",
    commandDir,
    commandCount: commands.length,
    helperCount: helpers.length,
    commands,
    helpers,
  };
}
