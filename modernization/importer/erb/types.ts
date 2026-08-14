/**
 * Phase 2.3 — types for the ERB function-index and command-catalog importers.
 *
 * Both manifests are "structural index" shapes: they record where things are,
 * not what they do. Function bodies are NOT parsed; command condition logic
 * is NOT executed. Consumers (DialogueRouter, CommandResolver, future
 * Agent code) read these to locate things in the ERB tree.
 */

// ---------------------------------------------------------------------------
// Functions (ERB/**/*.{ERB,ERH} → @-declared functions)
// ---------------------------------------------------------------------------

/** One `@FUNC` declaration inside an ERB/ERH file. */
export interface ErbFunction {
  /** The bare identifier after `@`, e.g. `USERCOM`, `GLOBAL_COMABLE`, `催眠発動`. */
  name: string;
  /** 1-based line number of the declaration. */
  line: number;
  /**
   * The full declaration line as it appears in source, trimmed of leading/
   * trailing whitespace and of any trailing `;` comment. Useful for showing
   * argument signatures like `@GLOBAL_COMABLE(ARG)`.
   */
  signature: string;
}

/** One ERB / ERH file that has been scanned (including 0-function ones). */
export interface ErbFile {
  /** POSIX path relative to the eraTW `ERB/` directory. */
  relPath: string;
  /**
   * Top-level subdirectory the file lives under, e.g. `コマンド関連` or
   * `MOVEMENTS`. Empty string for files directly under `ERB/`.
   */
  dir: string;
  functions: ErbFunction[];
}

/** Full function-index manifest. */
export interface FunctionsManifest {
  generatedAt: string;
  projectRoot: string;
  /** Absolute path to the eraTW `ERB/` directory. */
  erbDir: string;
  /** Directories under `erbDir` that were skipped (e.g. `口上・メッセージ関連`). */
  excludedDirs: string[];
  /** Files scanned, including those with zero `@FUNC` declarations. */
  fileCount: number;
  /** Sum of `functions.length` across all `files`. */
  functionCount: number;
  files: ErbFile[];
}

// ---------------------------------------------------------------------------
// Commands (ERB/コマンド関連/{COMF,SCOMF}/**/*.ERB → command catalog)
// ---------------------------------------------------------------------------

/**
 * The five filename-numbering schemes used by eraTW commands. Determined
 * by the leading token of the basename:
 *   - `COMF<num> <name>.ERB`      → COMF
 *   - `SCOMF<num> <name>.ERB`     → SCOMF
 *   - `IRAI_<num> <name>.ERB`     → IRAI       (story quests, 17 entries upstream)
 *   - `一般依頼<num>_<name>.ERB`  → IRAI_IPPAN (general quests, the 一般依頼 prefix)
 *   - `固有依頼<num>_<name>.ERB`  → IRAI_KOYU  (character-specific quests, 固有依頼 prefix)
 */
export type CommandKind = "COMF" | "SCOMF" | "IRAI" | "IRAI_IPPAN" | "IRAI_KOYU";

/** One numbered command (one ERB file). */
export interface CommandEntry {
  commandNo: number;
  kind: CommandKind;
  /** Display name from filename, after the number and space. */
  displayName: string;
  /** Basename (e.g. `COMF300 会話.ERB`). */
  fileName: string;
  /** POSIX path relative to `commandDir` (the `コマンド関連/` root). */
  relPath: string;
  /**
   * Subfolder under `COMF/` or `SCOMF/` the file lives in, e.g. `日常系`,
   * `依頼`, `700 自慰系`. Empty string if directly under `COMF/` or `SCOMF/`.
   */
  category: string;
}

/**
 * Inferred role of a non-numbered file in `コマンド関連/`. We don't try to
 * guess function semantics — just bucket by filename convention.
 */
export type HelperKind = "USERCOM" | "COMORDER" | "COMABLE" | "OTHER";

/** One non-numbered file in the command tree. */
export interface HelperEntry {
  /** POSIX path relative to `commandDir`. */
  relPath: string;
  kind: HelperKind;
}

/** Full command-catalog manifest. */
export interface CommandsManifest {
  generatedAt: string;
  projectRoot: string;
  /** Absolute path to the eraTW `ERB/コマンド関連/` directory. */
  commandDir: string;
  commandCount: number;
  helperCount: number;
  commands: CommandEntry[];
  helpers: HelperEntry[];
}
