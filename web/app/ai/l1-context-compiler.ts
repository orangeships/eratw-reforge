import type { AiRelationshipLens } from "./relationship-lens.js";
import { interactionHistoryVisibleTo } from "./interaction-history.js";
import type { AiContextMessage, AiInteractionHistoryEntry } from "./types.js";

interface L1PromptDocument extends Record<string, unknown> {
  runtime: Record<string, unknown>;
}

const HISTORY_CHAR_BUDGET = 2400;
const HISTORY_LINE_LIMIT = 8;

/** Read-only presentation compiler. The card has already passed its field
 * switches; never reload authored presets or infer new beliefs here. */
export function compileL1PromptContext(input: {
  document: L1PromptDocument;
  relationship: AiRelationshipLens | null;
  history: readonly AiInteractionHistoryEntry[];
  target: number;
  masterName: string;
}): { document: L1PromptDocument; contextMessages: AiContextMessage[] } {
  const runtime = { ...input.document.runtime };
  const background: Record<string, unknown> = {};
  for (const key of ["inner_world", "recent_experiences", "archived_memories"] as const) {
    if (runtime[key] !== undefined) background[key] = runtime[key];
    delete runtime[key];
  }
  if (input.relationship && runtime.relationship) {
    // Enum keys remain compatible with existing custom context blocks. Only
    // active meanings are compiled, replacing the global enum dictionary.
    runtime.relationship = {
      ...(runtime.relationship as Record<string, unknown>),
      meaning: [...input.relationship.lines],
    };
  }

  let remaining = HISTORY_CHAR_BUDGET;
  const packets: AiContextMessage[][] = [];
  const witnessed: Array<{ target: string; command: string; lines: string[] }> = [];
  // Reserve space for newest records first, then restore chronological order.
  for (const entry of [...input.history].reverse()) {
    if (entry.source !== "command" || !interactionHistoryVisibleTo(entry, [input.target])) continue;
    const lines: string[] = [];
    for (const line of entry.visibleLines.slice(-HISTORY_LINE_LIMIT)) {
      if (!line.trim() || line.length > remaining) continue;
      lines.push(line);
      remaining -= line.length;
    }
    if (!lines.length) continue;
    if (entry.target !== input.target || entry.outcome !== "ok") {
      witnessed.unshift({ target: entry.targetName, command: entry.commandLabel, lines });
      continue;
    }
    const playerPrefix = `${input.masterName}：`;
    const characterPrefix = `${entry.targetName}：`;
    const packet: AiContextMessage[] = [{ role: "user", content:
      `【已发生互动；指令名称不是玩家台词】${entry.commandLabel}；地点：${entry.location}` }];
    for (const line of lines) {
      // Unprefixed aiLines are known target output. Unknown speakers and
      // narration remain attributed context; names alone are not enough.
      const generated = entry.aiLines.includes(line);
      const narration = line.startsWith("旁白：");
      const playerSpeech = !narration && playerPrefix !== characterPrefix && line.startsWith(playerPrefix);
      const role = generated ? "assistant"
        : !narration && playerPrefix !== characterPrefix && line.startsWith(characterPrefix) ? "assistant" : "user";
      const content = generated ? line
        : role === "assistant" ? line.slice(characterPrefix.length)
        : playerSpeech ? line.slice(playerPrefix.length)
        : `【当时可见记录】${line}`;
      const previous = packet.at(-1)!;
      if (previous.role === role) packet[packet.length - 1] = { role, content: `${previous.content}\n${content}` };
      else packet.push({ role, content });
    }
    packets.unshift(packet);
  }
  if (witnessed.length) runtime.witnessed_interactions = witnessed;
  const { recent_interactions: _legacyHistory, ...document } = input.document;
  return {
    document: { ...document, runtime, ...(Object.keys(background).length ? { background } : {}) },
    contextMessages: packets.flat(),
  };
}
