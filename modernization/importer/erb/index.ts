/**
 * Phase 2.3 ERB dispatcher — reads the function index + command catalog
 * from an eraTW project root in parallel. This is what build-manifests.ts
 * calls in addition to the existing csv `loadAll` and xml `loadAllXml`.
 *
 * Each sub-parser returns its own manifest shape; the bundle composes
 * them. Mirrors xml/index.ts.
 */

import * as path from "node:path";
import { parseFunctions, type FunctionsManifest } from "./functions.js";
import { parseCommands, type CommandsManifest } from "./commands.js";

export interface ErbManifestBundle {
  functions: FunctionsManifest;
  commands: CommandsManifest;
}

export async function loadAllErb(projectRoot: string): Promise<ErbManifestBundle> {
  const erbDir = path.join(projectRoot, "ERB");
  const commandDir = path.join(erbDir, "コマンド関連");

  const [functions, commands] = await Promise.all([
    parseFunctions(erbDir),
    parseCommands(commandDir),
  ]);

  // Stamp projectRoot at the bundle level for parity with the csv / xml bundles.
  return {
    functions: { ...functions, projectRoot },
    commands: { ...commands, projectRoot },
  };
}

export * from "./types.js";
export * from "./functions.js";
export * from "./commands.js";
