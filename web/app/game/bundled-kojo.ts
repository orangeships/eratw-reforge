import { createTrainMessageRouter } from "../../../modernization/runtime";
import type {
  DialogueRouter,
  TrainMessageRouter,
} from "../../../modernization/runtime";
import { createBrowserKojoRouter } from "./kojo-router.js";
import type { BrowserKojoBundle } from "./kojo-router.js";
import type { TrainMessageBundle } from "../../../modernization/runtime/command/train-message.js";

export interface BundledKojoRouters {
  dialogueRouter: DialogueRouter;
  trainMessageRouter: TrainMessageRouter;
}

async function loadJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Unable to load offline Kojo asset ${path}: ${response.status}`);
  }
  return (await response.json()) as T;
}

/**
 * Load the complete Kojo/train-message corpus staged by package-offline.ps1.
 * These assets are deliberately absent from the normal GitHub/player build.
 */
export async function loadBundledKojoRouters(
  callNames: Record<number, string>,
): Promise<BundledKojoRouters> {
  const [kojoBundle, trainMessageBundle] = await Promise.all([
    loadJson<BrowserKojoBundle>("./kojo.bundle.json"),
    loadJson<TrainMessageBundle>("./train-message.bundle.json"),
  ]);

  return {
    dialogueRouter: createBrowserKojoRouter(kojoBundle),
    trainMessageRouter: createTrainMessageRouter(trainMessageBundle, { callNames }),
  };
}
