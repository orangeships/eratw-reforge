import type { AgentPendingEpisode, AgentRuntimeState } from "./types.js";

/** Immutable historical content. It is never a gameplay effect or a provider prompt. */
export interface AgentMemoryRecordV1 {
  kind: "ai-dialogue" | "ai-choice" | "nightly-reflection" | "legacy-memory" | "legacy-reflection" | "legacy-dialogue";
  charaNum: number;
  sourceId: string;
  sessionId?: string;
  dayIndex: number;
  tick: number;
  location: string | null;
  lines: Array<{ speaker: "player" | "character"; text: string }>;
  /** Accepted reflection, evidence and mind revisions, or executed action receipts. */
  details?: unknown;
  incomplete?: true;
}

export interface AgentMemoryBlockV1 {
  version: 1;
  id: string;
  parentId: string | null;
  record: AgentMemoryRecordV1;
}

/** Only roots/cursors live in the frequently cloned GameState. */
export interface AgentMemoryArchiveV1 {
  version: 1;
  heads: Record<number, string>;
  reflectedThrough: Record<number, string>;
  legacyImported: boolean;
}

export function createMemoryArchive(): AgentMemoryArchiveV1 {
  return { version: 1, heads: {}, reflectedThrough: {}, legacyImported: false };
}

export function isMemoryBlockId(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{32}$/.test(value);
}

/** Deterministic content key; collisions are rejected by the storage adapter. */
export function memoryContentId(text: string): string {
  return [2166136261, 2246822507, 3266489909, 668265263].map((seed) => {
    let hash = seed;
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    return (hash >>> 0).toString(16).padStart(8, "0");
  }).join("");
}

function recordIsValid(value: unknown): value is AgentMemoryRecordV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const r = value as AgentMemoryRecordV1;
  return ["ai-dialogue", "ai-choice", "nightly-reflection", "legacy-memory", "legacy-reflection", "legacy-dialogue"].includes(r.kind)
    && Number.isSafeInteger(r.charaNum) && r.charaNum > 0
    && typeof r.sourceId === "string" && r.sourceId.length > 0
    && (r.sessionId === undefined || typeof r.sessionId === "string")
    && Number.isSafeInteger(r.dayIndex) && r.dayIndex >= 0
    && Number.isSafeInteger(r.tick) && r.tick >= 0
    && (r.location === null || typeof r.location === "string")
    && Array.isArray(r.lines) && r.lines.length > 0
    && r.lines.every(line => line && ["player", "character"].includes(line.speaker)
      && typeof line.text === "string")
    && r.lines.reduce((sum, line) => sum + line.text.length, 0) <= 32_000
    && (r.incomplete === undefined || r.incomplete === true);
}

/** JSON map ordering is not semantic: serde_json may sort every nested map. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map(key =>
    `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

export function createMemoryBlock(parentId: string | null, record: AgentMemoryRecordV1): AgentMemoryBlockV1 {
  if ((parentId !== null && !isMemoryBlockId(parentId)) || !recordIsValid(record)) throw new Error("Invalid agent memory record");
  // Detach immutable archive data from caller-owned arrays, removing undefined JSON fields.
  const serializable = JSON.parse(JSON.stringify({ version: 1, parentId, record }));
  const canonical = canonicalJson(serializable);
  const body = JSON.parse(canonical) as Omit<AgentMemoryBlockV1, "id">;
  return { ...body, id: memoryContentId(canonical) };
}

export function validateMemoryBlock(value: unknown): AgentMemoryBlockV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid agent memory block");
  const b = value as AgentMemoryBlockV1;
  if (b.version !== 1 || !isMemoryBlockId(b.id)
    || Object.keys(b).sort().join(",") !== "id,parentId,record,version") throw new Error("Invalid agent memory block");
  const checked = createMemoryBlock(b.parentId, b.record);
  if (checked.id !== b.id) throw new Error("Agent memory checksum mismatch");
  return checked;
}

export function normalizeMemoryArchive(value: unknown): AgentMemoryArchiveV1 | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid agent memory roots");
  const root = value as AgentMemoryArchiveV1;
  if (root.version !== 1 || typeof root.legacyImported !== "boolean") throw new Error("Invalid agent memory roots");
  const ids = (raw: unknown): Record<number, string> => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid agent memory roots");
    return Object.fromEntries(Object.entries(raw).map(([key, id]) => {
      if (!Number.isSafeInteger(Number(key)) || Number(key) <= 0 || String(Number(key)) !== key || !isMemoryBlockId(id)) throw new Error("Invalid agent memory root reference");
      return [key, id];
    }));
  };
  return { version: 1, heads: ids(root.heads), reflectedThrough: ids(root.reflectedThrough), legacyImported: root.legacyImported };
}

export function memoryRecordAsEpisode(record: AgentMemoryRecordV1): AgentPendingEpisode {
  return {
    id: record.sourceId, charaNum: record.charaNum, sessionId: record.sessionId ?? record.sourceId,
    dayIndex: record.dayIndex, createdTick: record.tick, updatedTick: record.tick,
    lines: record.lines.map(line => ({ ...line })), choices: [], heat: 0,
    ...(record.incomplete ? { incomplete: true as const } : {}),
  };
}

export function hasArchivedMemories(runtime: AgentRuntimeState | undefined): boolean {
  return !!runtime?.memoryArchive && Object.keys(runtime.memoryArchive.heads).length > 0;
}

/** Portable imports must be complete independently of the host's existing cache. */
export function validateMemoryAttachments(rootValue: unknown, values: readonly unknown[]): AgentMemoryBlockV1[] {
  const root = normalizeMemoryArchive(rootValue);
  const checked = values.map(validateMemoryBlock);
  const attachments = new Map(checked.map(block => [block.id, block]));
  for (const [actor, head] of Object.entries(root?.heads ?? {})) {
    const seen = new Set<string>();
    let id: string | null = head;
    while (id) {
      if (seen.has(id)) throw new Error("Cyclic memory attachment");
      seen.add(id);
      const block: AgentMemoryBlockV1 | undefined = attachments.get(id);
      if (!block) throw new Error("Incomplete memory attachment");
      if (block.record.charaNum !== Number(actor)) throw new Error("Memory attachment owner mismatch");
      id = block.parentId;
    }
    const cursor = root?.reflectedThrough[Number(actor)];
    if (cursor && !seen.has(cursor)) throw new Error("Memory attachment cursor is outside this branch");
  }
  if (root && Object.keys(root.reflectedThrough).some(actor => !root.heads[Number(actor)])) throw new Error("Memory cursor has no root");
  return checked;
}
