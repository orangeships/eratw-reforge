import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** IPC owned by the Mod Studio surface rather than the player runtime. */

export interface ProjectValidation {
  path: string;
  hasErb: boolean;
  hasCsv: boolean;
  hasEmueraConfig: boolean;
  isValid: boolean;
  missing: string[];
}

/** Validate an eraTW project root using the native Rust filesystem boundary. */
export async function validateProject(path: string): Promise<ProjectValidation> {
  return await invoke<ProjectValidation>("validate_project_path", { path });
}

/** Open the Studio's native project-folder picker. */
export async function pickProjectDir(): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const result = await open({
    directory: true,
    multiple: false,
    title: "选择 eraTW 项目根目录",
  });
  if (Array.isArray(result)) return result[0] ?? null;
  return result ?? null;
}

export type ManifestName =
  | "variable-sizes"
  | "characters"
  | "flags"
  | "resources"
  | "plugin-dicts"
  | "functions"
  | "commands"
  | "kojos"
  | "event-messages";

export interface ManifestEnvelope {
  name: ManifestName;
  path: string;
  data: unknown;
}

/** Read a generated Studio manifest through the Rust filesystem boundary. */
export async function getManifest(
  projectRoot: string,
  name: ManifestName,
): Promise<ManifestEnvelope> {
  return await invoke<ManifestEnvelope>("get_manifest", { projectRoot, name });
}

/** Allow the selected project's resources in Tauri's asset protocol scope. */
export async function addAssetScope(projectRoot: string): Promise<string> {
  return await invoke<string>("add_asset_scope", { projectRoot });
}

export interface ManifestRebuiltEvent {
  projectRoot: string;
  generatedAt: string;
  durationMs: number;
  manifestCount: number;
}

export interface ManifestErrorEvent {
  projectRoot: string;
  phase: "watch" | "rebuild" | "spawn";
  message: string;
  exitCode: number | null;
}

/** Start the Studio's source watcher and manifest rebuild loop. */
export async function startWatch(projectRoot: string): Promise<void> {
  await invoke<void>("start_watch", { projectRoot });
}

/** Stop the active Studio source watcher. */
export async function stopWatch(): Promise<void> {
  await invoke<void>("stop_watch");
}

export async function onManifestRebuilt(
  handler: (event: ManifestRebuiltEvent) => void,
): Promise<UnlistenFn> {
  return await listen<ManifestRebuiltEvent>("manifest://rebuilt", (event) => {
    handler(event.payload);
  });
}

export async function onManifestError(
  handler: (event: ManifestErrorEvent) => void,
): Promise<UnlistenFn> {
  return await listen<ManifestErrorEvent>("manifest://error", (event) => {
    handler(event.payload);
  });
}
