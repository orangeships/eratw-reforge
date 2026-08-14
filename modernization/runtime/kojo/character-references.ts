import roles from "../../characters/_roles_meta.json";

interface CharacterRoleMeta {
  idx: number;
  candidates?: readonly string[];
}

const references = new Map<string, number | null>();

for (const role of roles as readonly CharacterRoleMeta[]) {
  if (!Number.isSafeInteger(role.idx)) continue;
  for (const candidate of role.candidates ?? []) {
    const key = candidate.trim();
    if (!key) continue;
    const existing = references.get(key);
    references.set(key, existing === undefined || existing === role.idx ? role.idx : null);
  }
}

/** Resolve project-authored `[[character name]]` references. Unknown and
 * ambiguous aliases stay unresolved so authored predicates fail closed. */
export function resolveKojoCharacterReference(raw: string): number | null {
  const match = /^\[\[([^\]]+)\]\]$/u.exec(raw.trim());
  return match ? references.get(match[1]!.trim()) ?? null : null;
}
