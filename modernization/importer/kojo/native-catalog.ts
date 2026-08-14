import { extractFuncs, type ExtractedFunc } from "./extractor.js";

export interface NativeDialogueRouteSource {
  readonly family: string;
  readonly key: string;
  readonly functionName: string;
}

export interface NativeDialogueFunctionCatalog {
  readonly family: string;
  readonly key: string;
  readonly functionName: string;
  readonly declarationLine: number;
  readonly branchHeaders: readonly string[];
  readonly helperCalls: readonly string[];
  readonly printForms: Readonly<Record<string, number>>;
  readonly printLineCount: number;
}

const PRINT_RE = /^(PRINTFORMW|PRINTFORMDW|PRINTFORMDL|PRINTFORMD|PRINTFORML|PRINTFORM|PRINTDW|PRINTDL|PRINTW|PRINTD|PRINTL|PRINT)\b/;
const BRANCH_RE = /^(IF|ELSEIF|ELSE|ENDIF|SELECTCASE|CASE|CASEELSE|ENDSELECT)\b/;
const CALL_RE = /^CALL\s+([A-Za-z_][A-Za-z0-9_\[\]ぁ-ゖァ-ー一-鿿]*)/;

function canonicalFunctionName(name: string): string {
  return name.trim().replace(/\(.*$/, "");
}

function catalogFunction(
  route: NativeDialogueRouteSource,
  fn: ExtractedFunc,
): NativeDialogueFunctionCatalog {
  const branchHeaders: string[] = [];
  const helperCalls = new Set<string>();
  const printForms: Record<string, number> = {};
  let printLineCount = 0;
  for (const line of fn.body) {
    if (BRANCH_RE.test(line)) branchHeaders.push(line);
    const call = CALL_RE.exec(line);
    if (call) helperCalls.add(call[1]!);
    const print = PRINT_RE.exec(line);
    if (print) {
      printLineCount++;
      const form = print[1]!;
      printForms[form] = (printForms[form] ?? 0) + 1;
    }
  }
  return {
    family: route.family,
    key: route.key,
    functionName: canonicalFunctionName(route.functionName),
    declarationLine: fn.declLine,
    branchHeaders,
    helperCalls: [...helperCalls].sort(),
    printForms,
    printLineCount,
  };
}

/** Catalog indexed authored routes without evaluating their ERB. This is a
 * read-only migration aid: semantic packs consume the resulting groups, while
 * the original branch tree remains the oracle. */
export function catalogNativeDialogueRoutes(
  text: string,
  routes: readonly NativeDialogueRouteSource[],
): NativeDialogueFunctionCatalog[] {
  const functions = new Map(
    extractFuncs(text).map((fn) => [canonicalFunctionName(fn.name), fn] as const),
  );
  return routes.flatMap((route) => {
    const fn = functions.get(canonicalFunctionName(route.functionName));
    return fn ? [catalogFunction(route, fn)] : [];
  });
}
