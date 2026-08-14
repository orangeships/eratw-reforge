/** Extract the enabled static `@Map紹介_<n>` prose from an upstream MAP_COMM ERB. */
export function extractUpstreamMapIntroduction(source: string, mapId: number): string {
  const normalized = source.replace(/\r\n/g, "\n");
  const start = normalized.search(new RegExp(`^@Map紹介_${mapId}\\s*$`, "m"));
  if (start < 0) throw new Error(`MAP_COMM_${mapId}: @Map紹介_${mapId} was not found`);
  const body = normalized.slice(start).split("\n").slice(1);
  const lines: string[] = [];
  let skipDepth = 0;
  for (const raw of body) {
    const line = raw.trim();
    if (line === "[SKIPSTART]") { skipDepth += 1; continue; }
    if (line === "[SKIPEND]") { skipDepth = Math.max(0, skipDepth - 1); continue; }
    if (skipDepth > 0) continue;
    if (line.startsWith("@")) break;
    if (line === "" || line.startsWith(";") || line.startsWith("#")) continue;
    const print = line.match(/^PRINT(?:FORM)?L\s*(.*)$/i);
    if (!print) continue;
    const text = print[1]!.trim();
    if (!text) continue;
    // Dynamic ERB expressions need runtime state and are not valid static prose.
    // Keep the authored literal arm only when one exists; otherwise fail closed.
    if (text.includes("\\@") || text.includes("%")) continue;
    lines.push(text);
  }
  if (lines.length === 0) throw new Error(`MAP_COMM_${mapId}: @Map紹介_${mapId} has no enabled static prose`);
  return lines.join("\n");
}
