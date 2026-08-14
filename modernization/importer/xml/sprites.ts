/**
 * R1 — Resource sprite atlas parser.
 *
 * Walks every XML under `<projectRoot>/resources/`, parses each as a
 * `<sprites>` document (the schema emitted by mkResourceXml.py), and returns
 * a `ResourcesManifest` with one entry per file.
 *
 * Schema recap (see modernization/docs/phase-2-2-plan.md):
 *   <sprites>
 *     <i name="…" src="…" param="x,y,w,h[,…]"/>          <!-- still -->
 *     <a name="…" width="…" height="…">                 <!-- anime -->
 *       <f src="…" param="x,y,w,h[,…]"/>
 *       …
 *     </a>
 *   </sprites>
 *
 * `src` is relative to `resources/` (the runtime base), NOT to the XML's
 * own folder. We preserve the value verbatim and let the React side resolve
 * it via `path.join(resourcesDir, src)` + Tauri `convertFileSrc`.
 */

import * as path from "node:path";
import { promises as fs } from "node:fs";
import { XMLParser } from "fast-xml-parser";
import { readXmlText } from "../encoding/read-text.js";
import type {
  AnimeFrame,
  ResourceFile,
  ResourcesManifest,
  SpriteAnime,
  SpriteEntry,
  SpriteStill,
} from "./types.js";

/** Files we skip: title-only root assets with no XML index. */
const SKIP_BASENAMES = new Set(["title.webp", "title.png", "title.jpg"]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  // Order matters: we want sibling `<i>` and `<a>` to preserve their
  // CSV-declared order, so disable the always-arrays optimization and let
  // entries stay as objects (a child → object, multiple → array, decided
  // by `isArray` per tag name).
  isArray: (name) => name === "i" || name === "a" || name === "f",
  parseAttributeValue: false,
  trimValues: true,
});

/**
 * Decode a `param` attribute into `number[]`. Empty string → []. Non-numeric
 * tokens are dropped (with a console warning) — better to lose a token than
 * to crash the whole file.
 */
function decodeParam(raw: string | undefined): number[] {
  if (raw == null || raw.trim() === "") return [];
  const out: number[] = [];
  for (const tok of raw.split(",")) {
    const n = Number(tok.trim());
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

interface RawSpritesDoc {
  sprites?: {
    i?: Array<Record<string, string>>;
    a?: Array<Record<string, string> & { f?: Array<Record<string, string>> }>;
  };
}

function normalizeStill(raw: Record<string, string>): SpriteStill {
  return {
    shape: "i",
    name: raw["@_name"] ?? "",
    src: raw["@_src"] ?? "",
    param: decodeParam(raw["@_param"]),
  };
}

function normalizeAnime(raw: Record<string, string> & { f?: Array<Record<string, string>> }): SpriteAnime {
  const frames: AnimeFrame[] = (raw.f ?? []).map((f) => ({
    src: f["@_src"] ?? "",
    param: decodeParam(f["@_param"]),
  }));
  return {
    shape: "a",
    name: raw["@_name"] ?? "",
    width: Number(raw["@_width"] ?? 0),
    height: Number(raw["@_height"] ?? 0),
    frames,
  };
}

async function listSpritesXml(resourcesDir: string): Promise<string[]> {
  // Recursive find for *.xml; skip the known orphan assets.
  async function walk(dir: string): Promise<string[]> {
    const out: string[] = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        out.push(...(await walk(full)));
      } else if (
        e.isFile() &&
        e.name.toLowerCase().endsWith(".xml") &&
        !SKIP_BASENAMES.has(e.name.toLowerCase())
      ) {
        out.push(full);
      }
    }
    return out;
  }
  const found = await walk(resourcesDir);
  found.sort();
  return found;
}

async function parseOneFile(absolutePath: string, resourcesDir: string): Promise<ResourceFile> {
  const text = await readXmlText(absolutePath);
  const doc = parser.parse(text) as RawSpritesDoc;
  const spritesRoot = doc.sprites ?? {};
  const entries: SpriteEntry[] = [
    ...(spritesRoot.i ?? []).map(normalizeStill),
    ...(spritesRoot.a ?? []).map(normalizeAnime),
  ];
  const rel = path.relative(resourcesDir, absolutePath).split(path.sep).join("/");
  const folder = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
  return {
    fileName: rel,
    folder,
    kind: "sprites",
    entries,
  };
}

export async function parseSpritesDir(resourcesDir: string): Promise<ResourcesManifest> {
  // Compute total entry count while we go, so the manifest carries it.
  // Tolerate a missing resources/ dir (it's optional in eraTW layouts and
  // some fixtures may not include one) — return an empty manifest rather
  // than throwing.
  const xmlFiles = await listSpritesXml(resourcesDir).catch((e: NodeJS.ErrnoException) => {
    if (e?.code === "ENOENT") return [] as string[];
    throw e;
  });
  const files: ResourceFile[] = [];
  let entryCount = 0;
  for (const abs of xmlFiles) {
    const f = await parseOneFile(abs, resourcesDir);
    files.push(f);
    entryCount += f.entries.length;
  }
  return {
    generatedAt: new Date().toISOString(),
    // projectRoot is filled in by loadAllXml; placeholder here.
    projectRoot: "",
    resourcesDir,
    fileCount: files.length,
    entryCount,
    files,
  };
}
