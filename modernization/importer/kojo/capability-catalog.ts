/** Read-only syntax inventory for indexed personal-kojo functions.
 *
 * This intentionally recognizes only source constructs, not their outcome.
 * The generated capability report can therefore distinguish “used by authors”
 * from “safe in the production KojoNode path”.
 */

export type KojoCapabilityFamily =
  | "syntax"
  | "expression"
  | "call"
  | "formatter"
  | "state-read"
  | "state-write"
  | "pause";

export interface KojoSourceCapability {
  readonly family: KojoCapabilityFamily;
  readonly name: string;
}

const STATE_NAMESPACE = "TALENT|CFLAG|FLAG|ITEM|TFLAG|TCVAR|ABL|BASE|MAXBASE|EXP|PALAM|SOURCE|EQUIP|STAIN|TEQUIP|MARK|EX|NOWEX";
const STATE_READ = new RegExp(`\\b(${STATE_NAMESPACE}):`, "giu");
const STATE_WRITE = new RegExp(`^\\s*(?:SETBIT|CLEARBIT|ADD|SUB|SET)\\s+(${STATE_NAMESPACE}):|^\\s*(${STATE_NAMESPACE}):[^=]*?(?:=|\\+=|-=)`, "iu");
const FUNCTION = /\b([A-Z][A-Z0-9_]*|[\u3040-\u30ff\u3400-\u9fff]+)\s*\(/gu;
const FORMATTER = /%\s*([A-Z][A-Z0-9_]*|[\u3040-\u30ff\u3400-\u9fff]+)\s*\(/gu;
const CALL = /^\s*(CALL|CALLF|CALLFORM|CALLFORMF|TRYCALL|TRYCALLFORM|TRYCALLFORMF|TRYCCALL|TRYCCALLFORM)\b/iu;
const NON_EXPRESSION_WORDS = new Set([
  "IF", "SIF", "ELSEIF", "ELSE", "ENDIF", "SELECTCASE", "CASE", "CASEELSE", "ENDSELECT",
  "FOR", "NEXT", "REPEAT", "REND", "WHILE", "WEND", "PRINTDATA", "DATAFORM", "ENDDATA",
  "PRINTBUTTON", "WAIT", "WAITANYKEY", "FORCEWAIT", "INPUT", "INPUTS", "ONEINPUT", "ONEINPUTS",
]);

function add(found: Map<string, KojoSourceCapability>, family: KojoCapabilityFamily, name: string): void {
  const normalized = name.toUpperCase();
  found.set(`${family}:${normalized}`, { family, name: normalized });
}

/** Skip disabled upstream blocks before collecting any callable/statement fact. */
export function withoutKojoSkipBlocks(lines: readonly string[]): string[] {
  let skipped = false;
  const result: string[] = [];
  for (const line of lines) {
    if (/^\s*\[SKIPSTART\]\s*$/iu.test(line)) {
      skipped = true;
      continue;
    }
    if (/^\s*\[SKIPEND\]\s*$/iu.test(line)) {
      skipped = false;
      continue;
    }
    if (!skipped) result.push(line);
  }
  return result;
}

export function catalogKojoSourceCapabilities(lines: readonly string[]): KojoSourceCapability[] {
  const found = new Map<string, KojoSourceCapability>();
  for (const raw of withoutKojoSkipBlocks(lines)) {
    const line = raw.replace(/^\s*;.*$/u, "").trim();
    if (!line) continue;
    const statement = /^(IF|SIF|ELSEIF|ELSE|ENDIF|SELECTCASE|CASE|CASEELSE|ENDSELECT|FOR|NEXT|REPEAT|REND|WHILE|WEND|PRINTDATA(?:D|L|W|DL|DW)?|DATAFORM|ENDDATA|PRINTBUTTON)\b/iu.exec(line);
    if (statement) add(found, "syntax", statement[1]!);
    const pause = /^(WAIT|WAITANYKEY|FORCEWAIT|INPUT|INPUTS|ONEINPUT|ONEINPUTS)\b/iu.exec(line);
    if (pause) add(found, "pause", pause[1]!);
    const call = CALL.exec(line);
    if (call) add(found, "call", call[1]!);
    for (const match of line.matchAll(FORMATTER)) add(found, "formatter", match[1]!);
    // A CALL target is a dispatch capability, not an expression function; a
    // %formatter(...)% is catalogued separately for its text-host contract.
    const expressionSource = call
      ? ""
      : line.replace(FORMATTER, "");
    for (const match of expressionSource.matchAll(FUNCTION)) {
      const name = match[1]!.toUpperCase();
      if (!NON_EXPRESSION_WORDS.has(name) && !name.startsWith("PRINT")) add(found, "expression", name);
    }
    for (const match of line.matchAll(STATE_READ)) add(found, "state-read", match[1]!);
    const write = STATE_WRITE.exec(line);
    if (write) add(found, "state-write", write[1] ?? write[2]!);
  }
  return [...found.values()].sort((left, right) =>
    left.family.localeCompare(right.family) || left.name.localeCompare(right.name));
}
