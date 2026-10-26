import type { GameState } from "../../../modernization/runtime/state/game-state.js";
import { getVisibleExperiences } from "../../../modernization/runtime/experience.js";
import { currentRegionWeather } from "../../../modernization/runtime/weather/region-override.js";
import type { AgentRuntimeState } from "../../../modernization/runtime/agent/types.js";
import {
  createMemoryArchive, createMemoryBlock, memoryRecordAsEpisode, normalizeMemoryArchive, validateMemoryBlock,
  type AgentMemoryArchiveV1, type AgentMemoryBlockV1, type AgentMemoryRecordV1,
} from "../../../modernization/runtime/agent/memory-archive.js";
import { loadMemoryBlock, persistMemoryBlock } from "../ipc/memory-archive-storage.js";

// Immutable cold data; never attached to or cloned with the current GameState.
const blocks = new Map<string, AgentMemoryBlockV1>();
const commits = new Set<Promise<unknown>>();

/** Ignore other characters' private cognition while retaining this reply's world dependencies. */
export function memoryPublicationContext(state: GameState, actor: number): string {
  const directive = state.activeEventContext?.participantIds.includes(actor) ? state.activeEventContext : null;
  return JSON.stringify({
    time: state.time, master: state.master, target: state.charas[actor], money: state.money,
    flags: state.flagStore, weather: currentRegionWeather(state), directive,
    present: Object.values(state.charas).filter(slot => slot.location === state.master.location).map(slot => slot.charaNum).sort((a, b) => a - b),
    cognition: state.agentRuntime?.cognitions[actor],
    experiences: getVisibleExperiences(state.acceptedExperiences ?? [], actor),
    head: state.agentRuntime?.memoryArchive?.heads[actor],
    hooks: state.narrativeHooks?.filter(h => h.speakerId === actor),
    enabled: state.agentRuntime?.settings.masterEnabled, permit: state.aiDialogueAccompany?.[actor],
  });
}

export async function trackMemoryCommit<T>(operation: Promise<T>): Promise<T> {
  commits.add(operation);
  try { return await operation; } finally { commits.delete(operation); }
}

export async function awaitMemoryCommits(): Promise<void> {
  while (commits.size) await Promise.all([...commits]);
}

export function clearMemoryArchiveCache(): void { blocks.clear(); }

export async function hydrateMemoryArchive(value: unknown): Promise<void> {
  const root = normalizeMemoryArchive(value);
  if (!root) return;
  await Promise.all(Object.entries(root.heads).map(async ([actor, head]) => {
    const seen = new Set<string>();
    let id: string | null = head;
    while (id) {
      if (seen.has(id)) throw new Error("Cyclic memory archive");
      seen.add(id);
      const block: AgentMemoryBlockV1 = blocks.get(id) ?? await loadMemoryBlock(id);
      if (block.record.charaNum !== Number(actor)) throw new Error("Memory archive owner mismatch");
      blocks.set(id, block);
      id = block.parentId;
    }
    const cursor = root.reflectedThrough[Number(actor)];
    if (cursor && !seen.has(cursor)) throw new Error("Memory reflection cursor is outside this save branch");
  }));
  if (Object.keys(root.reflectedThrough).some(actor => !root.heads[Number(actor)])) throw new Error("Memory cursor has no character root");
}

export function archivedCharacterBlocks(runtime: Pick<AgentRuntimeState, "memoryArchive"> | undefined, actor: number): AgentMemoryBlockV1[] {
  let id: string | null = runtime?.memoryArchive?.heads[actor] ?? null;
  const result: AgentMemoryBlockV1[] = [], seen = new Set<string>();
  while (id) {
    if (seen.has(id)) throw new Error("Cyclic memory archive");
    seen.add(id);
    const block = blocks.get(id);
    if (!block || block.record.charaNum !== actor) throw new Error("Memory archive is not hydrated for this character");
    result.push(block);
    id = block.parentId;
  }
  return result.reverse();
}

/** Writes candidates first; callers publish the returned roots only after their owner guard. */
export async function prepareMemoryRecords(runtime: AgentRuntimeState, records: readonly AgentMemoryRecordV1[]): Promise<AgentMemoryArchiveV1> {
  await hydrateMemoryArchive(runtime.memoryArchive);
  const root = structuredClone(runtime.memoryArchive ?? createMemoryArchive());
  for (const record of records) {
    const existing = archivedCharacterBlocks({ ...runtime, memoryArchive: root }, record.charaNum)
      .find(b => b.record.sourceId === record.sourceId);
    if (existing) {
      if (createMemoryBlock(existing.parentId, record).id !== existing.id) throw new Error("Memory source already has different content");
      continue;
    }
    const block = createMemoryBlock(root.heads[record.charaNum] ?? null, record);
    await persistMemoryBlock(block);
    blocks.set(block.id, block);
    root.heads[record.charaNum] = block.id;
  }
  return root;
}

/** Import only surviving, normalized legacy content; never invent deleted history. */
export async function importLegacyMemories(state: GameState): Promise<void> {
  const runtime = state.agentRuntime;
  if (!runtime) return;
  await hydrateMemoryArchive(runtime.memoryArchive);
  if (runtime.memoryArchive?.legacyImported) return;
  const records: AgentMemoryRecordV1[] = [];
  for (const [actorText, cognition] of Object.entries(runtime.cognitions)) {
    const charaNum = Number(actorText);
    for (const [kind, collection] of [
      ["legacy-memory", cognition.memories], ["legacy-reflection", cognition.reflections],
    ] as const) for (const entry of collection) {
      if (typeof entry.text !== "string" || !entry.text) continue;
      records.push({ kind, charaNum, sourceId: `legacy:${kind}:${entry.id}`,
        dayIndex: Math.max(0, Math.trunc(entry.createdDay ?? 0)), tick: Math.max(0, Math.trunc(entry.createdTick ?? 0)),
        location: null, lines: [{ speaker: "character", text: entry.text }], details: entry, incomplete: true });
    }
    for (const episode of cognition.pendingEpisodes ?? []) records.push({
      kind: "legacy-dialogue", charaNum, sourceId: episode.id, sessionId: episode.sessionId,
      dayIndex: episode.dayIndex, tick: episode.createdTick, location: null,
      lines: episode.lines, details: { choices: episode.choices }, incomplete: true,
    });
  }
  const root = await prepareMemoryRecords(runtime, records);
  root.legacyImported = true;
  runtime.memoryArchive = root;
}

export function pendingArchivedDialogues(runtime: AgentRuntimeState, actor: number, dayIndex: number): AgentMemoryBlockV1[] {
  const list = archivedCharacterBlocks(runtime, actor);
  const cursor = runtime.memoryArchive?.reflectedThrough[actor];
  const start = cursor ? list.findIndex(b => b.id === cursor) + 1 : 0;
  const selected: AgentMemoryBlockV1[] = [];
  let characters = 0;
  for (const block of list.slice(start)) {
    if (!["ai-dialogue", "ai-choice", "legacy-dialogue"].includes(block.record.kind) || block.record.dayIndex > dayIndex) continue;
    const size = block.record.lines.reduce((sum, line) => sum + line.text.length, 0);
    if (selected.length && characters + size > 32_000) break;
    selected.push(block);
    characters += size;
    if (selected.length === 12) break;
  }
  return selected;
}

export function archivedEpisodes(runtime: AgentRuntimeState, actor: number, dayIndex: number) {
  return pendingArchivedDialogues(runtime, actor, dayIndex).map(b => memoryRecordAsEpisode(b.record));
}

export function retrieveCharacterMemories(runtime: Pick<AgentRuntimeState, "memoryArchive"> | undefined, actor: number, cue = "", limit = 3): Array<{ sourceId: string; dayIndex: number; kind: string; text: string; incomplete?: true }> {
  const words = cue.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [];
  const query = new Set(words.flatMap(word => word.length > 3 ? [word, ...Array.from({ length: word.length - 1 }, (_, i) => word.slice(i, i + 2))] : [word]));
  return archivedCharacterBlocks(runtime, actor).map((block, index) => {
    const text = block.record.lines.map(line => `${line.speaker === "player" ? "玩家" : "角色"}：${line.text}`).join("\n");
    const relevance = [...query].filter(word => text.toLowerCase().includes(word)).length;
    const match = [...query].map(word => text.toLowerCase().indexOf(word)).filter(position => position >= 0).sort((a, b) => a - b)[0];
    const start = Math.max(0, (match ?? 0) - 100);
    return { block, text: text.slice(start, start + 480), relevance, index };
  }).sort((a, b) => b.relevance - a.relevance || b.index - a.index)
    .slice(0, Math.max(0, Math.min(limit, 6))).map(({ block, text }) => ({
      sourceId: block.record.sourceId, dayIndex: block.record.dayIndex, kind: block.record.kind, text: text.slice(0, 480),
      ...(block.record.incomplete ? { incomplete: true as const } : {}),
    }));
}

export function exportMemoryBlocks(runtime: AgentRuntimeState | undefined): AgentMemoryBlockV1[] {
  const all = new Map<string, AgentMemoryBlockV1>();
  for (const actor of Object.keys(runtime?.memoryArchive?.heads ?? {}))
    for (const block of archivedCharacterBlocks(runtime, Number(actor))) all.set(block.id, block);
  return structuredClone([...all.values()]);
}

export async function importMemoryBlocks(values: readonly unknown[]): Promise<void> {
  const checked = values.map(value => validateMemoryBlock(value));
  for (const block of checked) {
    await persistMemoryBlock(block);
    blocks.set(block.id, block);
  }
}
