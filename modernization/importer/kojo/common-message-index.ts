import type { EventMsgIndex } from "../../runtime/kojo/types.js";

export interface CommonMessageFile {
  relPath: string;
  atFuncs: readonly { name: string; line: number }[];
}

/** COM and SCOM numbers belong to separate namespaces. TRAIN_MESSAGE's
 * common table contains only exact MESSAGE_COM bodies, never SCOM bodies. */
export function commonMessageCommandNo(name: string): number | null {
  const match = /^@?MESSAGE_COM(\d+)$/.exec(name);
  return match ? Number(match[1]) : null;
}

export function buildCommonMessageIndex(entries: readonly CommonMessageFile[]): Record<number, EventMsgIndex> {
  const byCommand: Record<number, EventMsgIndex> = {};
  for (const entry of entries) {
    const funcs = [...entry.atFuncs].sort((a, b) => a.line - b.line);
    for (let i = 0; i < funcs.length; i++) {
      const fn = funcs[i]!;
      const commandNo = commonMessageCommandNo(fn.name);
      if (commandNo === null || byCommand[commandNo]) continue;
      byCommand[commandNo] = {
        filePath: entry.relPath.replaceAll("\\", "/"),
        funcName: `@${fn.name.replace(/^@/, "")}`,
        lineStart: fn.line,
        lineEnd: funcs[i + 1] ? funcs[i + 1]!.line - 1 : 999_999,
      };
    }
  }
  return byCommand;
}
