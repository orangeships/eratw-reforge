/**
 * Phase 2.3-kojo bundle.
 *
 * Mirrors `importer/erb/index.ts` shape: the two parsers run in parallel
 * and the bundle composes them.
 *
 * `parseKojos` walks `個人口上/`. `parseEventMessages` walks the
 * top-level + `EVENT_MESSAGE_挿入系COM/`. Both write into
 * `modernization/out/` via `scripts/build-manifests.ts`.
 */

import * as path from "node:path";
import { parseKojos, type KojosManifest } from "./kojos.js";
import { parseEventMessages, type EventMessagesManifest } from "./event-messages.js";

export interface KojoManifestBundle {
  kojos: KojosManifest;
  eventMessages: EventMessagesManifest;
}

export async function loadAllKojo(projectRoot: string): Promise<KojoManifestBundle> {
  const kojoDir = path.join(projectRoot, "ERB", "口上・メッセージ関連");

  const [kojos, eventMessages] = await Promise.all([
    parseKojos(kojoDir),
    parseEventMessages(kojoDir),
  ]);

  return {
    kojos: { ...kojos, projectRoot },
    eventMessages: { ...eventMessages, projectRoot },
  };
}

export * from "./types.js";
export * from "./kojos.js";
export * from "./event-messages.js";
