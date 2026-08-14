/**
 * Phase 2.3-kojo — types for the kojo (per-character dialogue) importer.
 *
 * Splits the `ERB/口上・メッセージ関連/` tree into two manifests:
 *
 *  - `KojosManifest`      — 個人口上/ per-chara tree (155 charas → variants
 *                            → M_KOJO files). Big (~2180 files), no per-func
 *                            body parsing. Cheap to load.
 *
 *  - `EventMessagesManifest` — 33 generic dispatch + per-category event
 *                            handlers. Small. Per-func name list IS
 *                            recorded (because the file count is tiny and
 *                            a Phase-5/6 reader wants to see the dispatch
 *                            hub in full).
 *
 * Survey: `modernization/docs/phase-2-3-kojo-survey.md`.
 * Plan:    `modernization/docs/phase-2-3-kojo-plan.md`.
 */

// =====================================================================
// Per-character kojo (個人口上/)
// =====================================================================

/** A "chara" directory at depth 1 under 個人口上/. */
export interface KojoChara {
  /** 3-digit num parsed from the leading token of the dir name, e.g. 1 for `001 Reimu`. */
  charaNum: number;
  /** English name (verbatim from dir minus the leading number and trailing `[...]`). */
  charaName: string;
  /** Japanese name parsed from `[...]` in the dir, e.g. `霊夢`. `null` if no brackets. */
  charaJpName: string | null;
  /** Full dir name verbatim, e.g. `"001 Reimu [霊夢]"`. */
  charaDirName: string;
}

/**
 * A variant subdir under a chara (depth 2+). A chara typically has 1
 * variant (the default); some have 4-5.
 */
export interface KojoVariant {
  /** Display name of the variant dir, e.g. `霊夢` or `AA琪露诺`. */
  name: string;
  /**
   * Depth: 2 = direct variant, 3 = subvariant (e.g. シナリオ/第1章),
   * 4 = sub-subvariant (rare).
   */
  depth: number;
  /**
   * Variant code parsed from the **first M_KOJO_K* filename** under this
   * variant. `""` for default variant (`M_KOJO_K1_*.ERB`); `"1"` for
   * `M_KOJO_K1_1_*.ERB`; `null` if no M_KOJO files in this variant
   * (rare — e.g. `没写的` placeholder dirs).
   */
  variantCode: string | null;
  /** Number of M_KOJO files in this variant. */
  fileCount: number;
}

/** One M_KOJO_*.{ERB,erb} file (the actual kojo content). */
export interface KojoFile {
  /** POSIX path relative to the kojo dir (`ERB/口上・メッセージ関連/`). */
  relPath: string;
  /** Basename, e.g. `"M_KOJO_K1_イベント.ERB"`. */
  fileName: string;
  /**
   * Chara num parsed from the file's M_KOJO_K* prefix, e.g. 1 for
   * `M_KOJO_K1_*`. `null` for `M_KOJO_KX_*` (the `159 先代` orphan).
   */
  charaNum: number | null;
  /**
   * Variant code parsed from the file, e.g. `""` for `K1_*`, `"1"` for
   * `K1_1_*`, `"514"` for `K38_514_*`, `"[]"` for `K1[]_*`, `null` if
   * no chara num (KX). Zero-padded forms (`"01"`) preserved verbatim.
   */
  variantCode: string | null;
  /**
   * Topic portion of the basename, e.g. `イベント`, `コマンド`,
   * `刻印取得`, or `事件_情事`. CJK + parens verbatim.
   */
  topic: string;
  /** True if basename matched the canonical regex (`M_KOJO_(K<num>|KX)_<topic>.ERB`). */
  isCanonical: boolean;
  /** File size in bytes. */
  sizeBytes: number;
  /** Line count (LF-split, lenient). */
  lineCount: number;
  /** Count of `^@` lines in the file. */
  atFuncCount: number;
}

/** A non-canonical M_KOJO file (regex miss). Logged, not silently dropped. */
export interface KojoFailure {
  relPath: string;
  reason: "regex-miss" | "kx-no-chara" | "chara-num-mismatch";
  detail: string;
}

/** All M_KOJO files belonging to one chara. */
export interface KojoCharaEntry {
  chara: KojoChara;
  /** Direct variant children (depth 2). */
  variants: KojoVariant[];
  /** All M_KOJO files for this chara, across all variants, sorted by relPath. */
  files: KojoFile[];
  /** Non-M_KOJO ERB files in the chara dir tree (e.g. `of_new_kojo_api_TEST.ERB`). */
  otherErbFiles: string[];
  /** Non-ERB files (readmes, zips, 7z, png) under the chara dir. */
  otherFiles: string[];
  /** Sum of `atFuncCount` across all files for this chara. */
  atFuncCountTotal: number;
}

/** Full kojo manifest. */
export interface KojosManifest {
  generatedAt: string;
  projectRoot: string;
  /** Absolute path to `ERB/口上・メッセージ関連/`. */
  kojoDir: string;
  charaCount: number;
  variantCount: number;
  fileCount: number;
  atLineTotal: number;
  /** One per chara, sorted by (charaNum, charaName). */
  charas: KojoCharaEntry[];
  /** All non-canonical M_KOJO files across all charas. */
  failures: KojoFailure[];
}

// =====================================================================
// Generic event-message handlers (top-level + EVENT_MESSAGE_挿入系COM/)
// =====================================================================

/** Categorical bucket for the generic handler. */
export type EventMessageCategory =
  | "DISPATCH"               // KOJO_MESSAGE.ERB and its sub-dispatchers
  | "COMMON"                 // COMMON_KOJO.ERB
  | "EVENT_MESSAGE"          // top-level EVENT_MESSAGE*.ERB (generic events)
  | "EVENT_MESSAGE_COM"      // COM-range generic handlers
  | "EVENT_MESSAGE_POSITION" // EVENT_MESSAGE_挿入系COM/* position-specific
  | "IMAGE"                  // STAND_COM_IMAGE.ERB
  | "UTILITY";               // AUTO_AEGI.ERB, TINKO_TYPE.ERB

export interface EventMessageEntry {
  /** POSIX path relative to the kojo dir. */
  relPath: string;
  fileName: string;
  category: EventMessageCategory;
  /** Count of `^@` lines. */
  atFuncCount: number;
  /**
   * All `@FUNC` declarations (name + line + signature). Unlike `KojoFile`,
   * we DO list them for the generic handlers — they're few (~11 files,
   * ~50 funcs total) and the dispatch hub + per-category templates are
   * exactly what a Phase-5 `CommandResolver` / Phase-6 `DialogueRouter`
   * reader wants to see.
   */
  atFuncs: Array<{ name: string; line: number; signature: string }>;
}

export interface EventMessagesManifest {
  generatedAt: string;
  projectRoot: string;
  kojoDir: string;
  fileCount: number;
  atFuncTotal: number;
  entries: EventMessageEntry[];
}
