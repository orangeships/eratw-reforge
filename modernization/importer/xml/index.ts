/**
 * Phase 2.2 XML dispatcher — reads resources/ and plugins/ trees from an
 * eraTW project root in parallel. This is what build-manifests.ts calls
 * in addition to the existing csv `loadAll`.
 *
 * Each sub-parser returns its own manifest shape; the bundle just composes
 * them. Mirrors csv/index.ts but is intentionally separate: the CSV data is
 * stable, the XML layer may evolve (more plugin dicts, new XML flavors).
 */

import * as path from "node:path";
import { parseSpritesDir, type ResourcesManifest } from "./sprites.js";
import { parsePluginDictDir, type PluginDictsManifest } from "./plugin-dict.js";

export interface XmlManifestBundle {
  resources: ResourcesManifest;
  pluginDicts: PluginDictsManifest;
}

export async function loadAllXml(projectRoot: string): Promise<XmlManifestBundle> {
  const resourcesDir = path.join(projectRoot, "resources");
  const pluginsDir = path.join(projectRoot, "plugins");

  const [resources, pluginDicts] = await Promise.all([
    parseSpritesDir(resourcesDir),
    parsePluginDictDir(pluginsDir),
  ]);

  // Stamp projectRoot at the bundle level for parity with the csv bundle.
  return {
    resources: { ...resources, projectRoot },
    pluginDicts: { ...pluginDicts, projectRoot },
  };
}

export * from "./types.js";
export * from "./sprites.js";
export * from "./plugin-dict.js";
