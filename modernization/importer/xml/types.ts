/**
 * Phase 2.2 — types for the resources/ and plugins/ XML importers.
 *
 * These types describe the SHAPE we hand to the React side, not the raw
 * fast-xml-parser output. The parsers normalize XML into these shapes and
 * the JSON manifest files use them as their on-disk contract.
 */

// ---------------------------------------------------------------------------
// Resources (resources/**/*.xml)
// ---------------------------------------------------------------------------

/** A single still sprite entry. `<i name=… src=… param=…/>` in the source. */
export interface SpriteStill {
  shape: "i";
  name: string;
  /** Path relative to `resources/` in the eraTW project root. */
  src: string;
  /** Decoded from the `param` attribute. May be 0..9 ints; empty `param=""` → []. */
  param: number[];
}

/** A single animation frame. `<f src=… param=…/>` inside an `<a>`. */
export interface AnimeFrame {
  src: string;
  param: number[];
}

/** An animation container. `<a name=… width=… height=…>…<f/>…</a>`. */
export interface SpriteAnime {
  shape: "a";
  name: string;
  width: number;
  height: number;
  frames: AnimeFrame[];
}

/** One entry inside a sprite file. Discriminate on `shape`. */
export type SpriteEntry = SpriteStill | SpriteAnime;

/** One `<sprites>` XML file under `resources/`. */
export interface ResourceFile {
  /** POSIX path relative to the eraTW project root, e.g. `FASH绘/resources.xml`. */
  fileName: string;
  /** Top-level folder the file lives in, e.g. `FASH绘`. Empty for files at the root. */
  folder: string;
  /** Always `"sprites"` in 2.2. Reserved for future formats (e.g. CG, BGM). */
  kind: "sprites";
  entries: SpriteEntry[];
}

/** The full resources manifest. */
export interface ResourcesManifest {
  generatedAt: string;
  projectRoot: string;
  /** Absolute path to the eraTW `resources/` directory. */
  resourcesDir: string;
  fileCount: number;
  entryCount: number;
  files: ResourceFile[];
}

// ---------------------------------------------------------------------------
// Plugin dicts (plugins/*.xml)
// ---------------------------------------------------------------------------

/** `bbas_dataset` schema — used by bbas_dataset.xml and tw_csv_chs.xml. */
export interface BbasDictEntry {
  id: number;
  /** Optional name; sometimes absent in bbas_dataset.xml. */
  name?: string;
  /** All other sub-elements as string→string, preserving key names verbatim. */
  fields: Record<string, string>;
}

/** `tw_taste_chs` schema — a k/v translation table. */
export interface TasteChsEntry {
  key: string;
  value: string;
}

export type PluginDictEntry = BbasDictEntry | TasteChsEntry;

export type PluginDictSchema = "bbas_dataset" | "tw_taste_chs";

/** One parsed plugin XML file. */
export interface PluginDictFile {
  fileName: string;
  schema: PluginDictSchema;
  entryCount: number;
  entries: PluginDictEntry[];
}

/** The full plugin-dicts manifest. */
export interface PluginDictsManifest {
  generatedAt: string;
  projectRoot: string;
  pluginsDir: string;
  dicts: PluginDictFile[];
}
