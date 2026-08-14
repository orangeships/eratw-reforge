/**
 * Phase 4.5A — SceneAsset loader (S2).
 *
 * `parseSceneAsset` is pure (parsed scene.json + ascii string -> a
 * validated `SceneAsset`) so it can be unit-tested without disk IO.
 * `loadSceneAsset` / `loadAllScenes` do the filesystem read against
 * `modernization/scenes/<id>/{scene.json,background.txt}`.
 *
 * Validation is strict and throws descriptive errors: a malformed
 * scene asset is a build-time authoring bug, not a silent skip.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { SceneAsset, SceneExit } from "./types.js";

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

function asNonEmptyString(value: unknown, field: string, sceneHint: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`scene "${sceneHint}": field "${field}" must be a non-empty string`);
  }
  return value;
}

/**
 * Merge a parsed `scene.json` object with its `background.txt` text
 * into a validated `SceneAsset`. Pure — throws on any malformed field.
 */
export function parseSceneAsset(raw: unknown, ascii: string): SceneAsset {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("scene.json must be a JSON object");
  }
  const obj = raw as Record<string, unknown>;
  const idHint = typeof obj.id === "string" ? obj.id : "?";
  const id = asNonEmptyString(obj.id, "id", idHint);
  const location = asNonEmptyString(obj.location, "location", id);
  const displayName = asNonEmptyString(obj.displayName, "displayName", id);
  const rawIntro = asNonEmptyString(obj.intro, "intro", id);
  // Generated legacy scene inputs used `<location>。` as a silent placeholder.
  // Surface the missing upstream MAP_COMM prose explicitly instead of showing
  // invented location text as if it were authored narration.
  const intro = rawIntro === `${location}。`
    ? `[not-authored: MAP_COMM location prose unavailable for ${location}]`
    : rawIntro;

  const asciiText = stripBom(ascii).replace(/\r\n/g, "\n");
  if (asciiText.trim().length === 0) {
    throw new Error(`scene "${id}": background.txt is empty`);
  }

  if (!Array.isArray(obj.exits)) {
    throw new Error(`scene "${id}": "exits" must be an array`);
  }
  const exits: SceneExit[] = obj.exits.map((e, i) => {
    if (typeof e !== "object" || e === null || Array.isArray(e)) {
      throw new Error(`scene "${id}": exit[${i}] must be an object`);
    }
    const ex = e as Record<string, unknown>;
    if (typeof ex.commandNo !== "number" || !Number.isInteger(ex.commandNo)) {
      throw new Error(`scene "${id}": exit[${i}].commandNo must be an integer`);
    }
    return {
      commandNo: ex.commandNo,
      toLocation: asNonEmptyString(ex.toLocation, `exit[${i}].toLocation`, id),
      label: asNonEmptyString(ex.label, `exit[${i}].label`, id),
    };
  });

  const variant =
    obj.variant === undefined ? undefined : asNonEmptyString(obj.variant, "variant", id);

  return { id, location, displayName, ascii: asciiText, intro, exits, variant };
}

/** Read one scene directory's `scene.json` + `background.txt`. */
export async function loadSceneAsset(sceneDir: string): Promise<SceneAsset> {
  const [jsonText, ascii] = await Promise.all([
    fs.readFile(path.join(sceneDir, "scene.json"), "utf-8"),
    fs.readFile(path.join(sceneDir, "background.txt"), "utf-8"),
  ]);
  let raw: unknown;
  try {
    raw = JSON.parse(stripBom(jsonText));
  } catch (e) {
    throw new Error(`scene dir "${sceneDir}": scene.json is not valid JSON: ${String(e)}`);
  }
  return parseSceneAsset(raw, ascii);
}

/** Load every scene under `scenesRoot`, sorted by directory name. */
export async function loadAllScenes(scenesRoot: string): Promise<SceneAsset[]> {
  const entries = await fs.readdir(scenesRoot, { withFileTypes: true });
  const dirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  const assets: SceneAsset[] = [];
  for (const dir of dirs) {
    assets.push(await loadSceneAsset(path.join(scenesRoot, dir)));
  }
  return assets;
}

/**
 * Index scenes by their `location` string for `selectScene`. Throws if
 * two scenes claim the same location (an authoring conflict).
 */
export function indexScenesByLocation(assets: SceneAsset[]): Record<string, SceneAsset> {
  const byLocation: Record<string, SceneAsset> = {};
  for (const asset of assets) {
    const existing = byLocation[asset.location];
    if (existing) {
      throw new Error(
        `duplicate scene location "${asset.location}" (scenes "${existing.id}" and "${asset.id}")`,
      );
    }
    byLocation[asset.location] = asset;
  }
  return byLocation;
}
