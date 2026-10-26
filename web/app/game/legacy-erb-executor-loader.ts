/**
 * RETIRED PRODUCTION ADAPTER.
 *
 * Kept only for focused compatibility tests and oracle tooling. Player and
 * application bootstrap code must not import this module, and ordinary Kojo
 * defects must be fixed in the active static importer/router/cache path.
 */
import type {
  KojoVmBundleManifest,
  KojoVmProgramShard,
} from "../../../modernization/runtime/kojo-vm/bundle.js";
import type { KojoVmProgram } from "../../../modernization/runtime/kojo-vm/types.js";

export type BrowserKojoVmLoadResult =
  | { status: "resolved"; program: KojoVmProgram; commandNos?: readonly number[]; eventArms?: readonly number[]; spEventSubids?: readonly number[]; encounter?: true; counterActions?: readonly number[] }
  | { status: "not-authored" | "unsupported"; reason: string };

type FetchJson = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeFileName(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9.-]*\.json$/.test(value);
}

function parseManifest(value: unknown): KojoVmBundleManifest | null {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.shared) || !Array.isArray(value.charas)) return null;
  if (typeof value.shared.file !== "string" || !isSafeFileName(value.shared.file)) return null;
  if (!value.charas.every((entry) => isRecord(entry)
    && Number.isSafeInteger(entry.charaNum)
    && typeof entry.file === "string"
    && isSafeFileName(entry.file)
    && [entry.commandNos, entry.eventArms, entry.spEventSubids, entry.counterActions].every((routes) => routes === undefined || (
      Array.isArray(routes) && routes.every((routeNo) => Number.isSafeInteger(routeNo) && routeNo >= 0)
    ))
    && (entry.encounter === undefined || entry.encounter === true))) return null;
  return value as unknown as KojoVmBundleManifest;
}

function parseShard(value: unknown, expectedChara: number | null): KojoVmProgramShard | null {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.charaNum !== expectedChara
    || !isRecord(value.program) || !isRecord(value.program.functions) || !Array.isArray(value.duplicateFunctions)) return null;
  const arrays = value.program.globalNumberArrays;
  if (arrays !== undefined && (!isRecord(arrays) || !Object.values(arrays).every((entry) => Array.isArray(entry)
    && entry.every((value) => Number.isSafeInteger(value))))) return null;
  return value as unknown as KojoVmProgramShard;
}

function sameNumberArray(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** Lazy browser reader for generated VM program shards. This is intentionally
 * independent of the legacy DialogueRouter until the opt-in route supplies
 * complete host adapters and parity evidence. */
export class BrowserKojoVmLoader {
  private readonly basePath: string;
  private readonly fetchJson: FetchJson;
  private manifestPromise: Promise<KojoVmBundleManifest | null> | null = null;
  private sharedPromise: Promise<KojoVmProgramShard | null> | null = null;
  private readonly charaPromises = new Map<number, Promise<KojoVmProgramShard | null>>();

  constructor(options: { basePath?: string; fetchJson?: FetchJson } = {}) {
    this.basePath = (options.basePath ?? "/kojo-vm").replace(/\/+$/, "");
    this.fetchJson = options.fetchJson ?? fetch;
  }

  private async getJson(file: string): Promise<unknown | null> {
    try {
      const response = await this.fetchJson(`${this.basePath}/${file}`);
      return response.ok ? await response.json() : null;
    } catch {
      return null;
    }
  }

  private getManifest(): Promise<KojoVmBundleManifest | null> {
    this.manifestPromise ??= this.getJson("manifest.json").then(parseManifest);
    return this.manifestPromise;
  }

  private getShared(manifest: KojoVmBundleManifest): Promise<KojoVmProgramShard | null> {
    this.sharedPromise ??= this.getJson(manifest.shared.file).then((value) => parseShard(value, null));
    return this.sharedPromise;
  }

  private getChara(charaNum: number, file: string): Promise<KojoVmProgramShard | null> {
    const cached = this.charaPromises.get(charaNum);
    if (cached) return cached;
    const loaded = this.getJson(file).then((value) => parseShard(value, charaNum));
    this.charaPromises.set(charaNum, loaded);
    return loaded;
  }

  async loadProgram(charaNum: number): Promise<BrowserKojoVmLoadResult> {
    const manifest = await this.getManifest();
    if (!manifest) return { status: "unsupported", reason: "invalid KojoVM manifest" };
    const entry = manifest.charas.find((candidate) => candidate.charaNum === charaNum);
    if (!entry) return { status: "not-authored", reason: `no KojoVM shard for character ${charaNum}` };
    const [shared, chara] = await Promise.all([this.getShared(manifest), this.getChara(charaNum, entry.file)]);
    if (!shared || !chara) return { status: "unsupported", reason: "invalid or unavailable KojoVM shard" };
    if (shared.duplicateFunctions.length > 0 || chara.duplicateFunctions.length > 0) {
      return { status: "unsupported", reason: "duplicate function definitions in KojoVM shard" };
    }
    const conflicts = Object.keys(shared.program.functions).filter((name) => chara.program.functions[name]);
    if (conflicts.length > 0) return { status: "unsupported", reason: `shared and character function conflict: ${conflicts[0]}` };
    const sharedArrays = shared.program.globalNumberArrays ?? {};
    const charaArrays = chara.program.globalNumberArrays ?? {};
    const arrayConflict = Object.keys(sharedArrays).find((name) => charaArrays[name] && !sameNumberArray(sharedArrays[name]!, charaArrays[name]!));
    if (arrayConflict) return { status: "unsupported", reason: `shared and character array conflict: ${arrayConflict}` };
    const globalNumberArrays = { ...sharedArrays, ...charaArrays };
    return {
      status: "resolved",
      program: {
        functions: { ...shared.program.functions, ...chara.program.functions },
        ...(Object.keys(globalNumberArrays).length > 0 ? { globalNumberArrays } : {}),
      },
      ...(entry.commandNos ? { commandNos: entry.commandNos } : {}),
      ...(entry.eventArms ? { eventArms: entry.eventArms } : {}),
      ...(entry.spEventSubids ? { spEventSubids: entry.spEventSubids } : {}),
      ...(entry.encounter ? { encounter: true as const } : {}),
      ...(entry.counterActions ? { counterActions: entry.counterActions } : {}),
    };
  }
}
