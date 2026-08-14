/**
 * K1 — Kojo per-chara parser.
 *
 * Walks `ERB/口上・メッセージ関連/個人口上/` and produces a `KojosManifest`.
 * No body parsing of M_KOJO files beyond counting `^@` lines. The
 * dispatch protocol is a stable string template
 * (`M_KOJO%NAME%_<EVENT>_K<CHARA>[_<SUBID>]`, see
 * `phase-2-3-kojo-survey.md` §3) but reproducing it is a Phase 6 concern;
 * the index just records the structure.
 *
 * Conventions:
 *   - Chara dirs are `^(\d+)\s+(.+?)(?:\s+\[([^\]]+)\])?$`.
 *   - M_KOJO files match `^M_KOJO_(K\d+(?:_\d+)*|KX)_(.+)\.(?:ERB|erb)$`
 *     (case-insensitive ext). The same regex is used in
 *     `scripts/survey-kojo.mjs` §4.
 *   - Chara num cross-check: the `K<num>` in the file prefix should
 *     match the chara num from the parent dir. Mismatch → `failures[]`,
 *     but the file is still indexed.
 *   - The `159 先代` orphan (no num prefix, no `[...]`) gets
 *     `charaNum: null, charaJpName: null, charaName: "先代"`. Its
 *     `M_KOJO_KX_*` files are indexed with `charaNum: null,
 *     variantCode: null, isCanonical: true`.
 *
 * Encoding: re-uses `readXmlText` aliased `readErbText` from
 * `importer/encoding/read-text.ts`. Survey §2 confirms 100% UTF-8.
 */

import * as path from "node:path";
import { promises as fs } from "node:fs";
import { readXmlText as readErbText } from "../encoding/read-text.js";
import type {
  KojoChara,
  KojoCharaEntry,
  KojoFailure,
  KojoFile,
  KojoVariant,
  KojosManifest,
} from "./types.js";

const KOJO_RE = /^M_KOJO_(K\d+(?:_\d+)*|KX)_(.+)\.(?:ERB|erb)$/i;
const CHARA_DIR_RE = /^(\d+)\s+(.+?)(?:\s+\[([^\]]+)\])?$/;
const AT_RE = /^@([^\s(,;]+)/;

/** Strip a trailing `;...` comment + surrounding whitespace. */
function trimComment(line: string): string {
  const semi = line.indexOf(";");
  const out = semi >= 0 ? line.slice(0, semi) : line;
  return out.replace(/\s+$/, "").replace(/^\s+/, "");
}

/**
 * Parse a chara dir name like `001 Reimu [霊夢]` or `159 先代`.
 * Returns `null` if the dir name doesn't start with a 1+ digit number —
 * which is a malformed chara dir (we don't have any upstream but the
 * check guards against future drift).
 */
function parseCharaDirName(dirName: string): KojoChara | null {
  const m = CHARA_DIR_RE.exec(dirName);
  if (!m) return null;
  return {
    charaNum: Number(m[1]),
    charaName: m[2].trim(),
    charaJpName: m[3] ? m[3].trim() : null,
    charaDirName: dirName,
  };
}

/**
 * From a chara+variant prefix like `K1`, `K14_1`, `K38_514`, `K70_01`,
 * `KX`, `K1[]`, return `{charaNum, variantCode}`. KX → both null. K1[] →
 * `charaNum: 1, variantCode: "[]"`.
 */
function parseCharaVariantPrefix(prefix: string): {
  charaNum: number | null;
  variantCode: string | null;
} {
  if (prefix === "KX") return { charaNum: null, variantCode: null };
  // K<num>(_<num>)* — capture first num as charaNum, rest as variant
  const m = /^K(\d+)((?:_\d+)*|_\[\])?$/.exec(prefix);
  if (!m) return { charaNum: null, variantCode: null };
  const charaNum = Number(m[1]);
  const variantRaw = m[2] ?? "";
  // strip leading underscore from variant
  const variantCode = variantRaw.startsWith("_") ? variantRaw.slice(1) : variantRaw;
  return { charaNum, variantCode };
}

interface ScannedFile {
  /** POSIX path relative to the chara dir, e.g. `霊夢/M_KOJO_K1_イベント.ERB`. */
  relPath: string;
  absPath: string;
  fileName: string;
  isMKojo: boolean;
  charaNum: number | null;
  variantCode: string | null;
  topic: string;
  isCanonical: boolean;
  sizeBytes: number;
  lineCount: number;
  atFuncCount: number;
}

async function scanFile(absPath: string, relPath: string): Promise<ScannedFile> {
  const fileName = path.basename(absPath);
  const stat = await fs.stat(absPath);
  const base = {
    relPath,
    absPath,
    fileName,
    sizeBytes: stat.size,
  };
  if (!/^M_KOJO_/i.test(fileName)) {
    // Not a canonical M_KOJO_ file name. Some upstream variants ship their
    // dispatch + body funcs under free-form file names (e.g. 不坠之月's
    // `飞刀版事件系.ERB`, OwO 正邪's `NO.1M_KOJO_K97_OwO_事件系.ERB`,
    // 铃紫苑's bare `事件系.ERB`). Those would otherwise land in
    // `otherErbFiles` and their variants would never be discovered, so scan
    // the file body for an `@M_KOJO_K{n}[_{v}](` dispatch and, when found,
    // treat it as a personal-kojo file with the chara/variant inferred from
    // the dispatch name.
    const text = await readErbText(absPath);
    const lines = text.split(/\r?\n/);
    const dispatchRe = /^@M_KOJO_K(\d+)(?:_([1-9]\d*))?\s*\(/;
    const bodyRe = /^@M_KOJO.+?_K(\d+)(?:_|$)/;
    let inferred: { charaNum: number; variantCode: string } | null = null;
    for (const line of lines) {
      const dm = dispatchRe.exec(line.trim());
      if (dm) {
        inferred = { charaNum: Number(dm[1]), variantCode: dm[2] ?? "" };
        break;
      }
      // Fall back to a body func for the chara num (variant unknown → the
      // build-kojo-index Pass B routes by infix anyway). Only use this when
      // there is no dispatch; prefer the dispatch's exact variant.
      if (!inferred) {
        const bm = bodyRe.exec(line.trim());
        if (bm) inferred = { charaNum: Number(bm[1]), variantCode: "" };
      }
    }
    if (inferred) {
      let atFuncCount = 0;
      for (const l of lines) {
        if (l.length > 0 && l.charCodeAt(0) === 0x40 /* '@' */ && AT_RE.test(l)) {
          atFuncCount++;
        }
      }
      return {
        ...base,
        isMKojo: true,
        charaNum: inferred.charaNum,
        variantCode: inferred.variantCode,
        topic: fileName.replace(/\.(ERB|erb)$/i, ""),
        isCanonical: false,
        lineCount: lines.length,
        atFuncCount,
      };
    }
    return {
      ...base,
      isMKojo: false,
      charaNum: null,
      variantCode: null,
      topic: "",
      isCanonical: false,
      lineCount: 0,
      atFuncCount: 0,
    };
  }
  const m = KOJO_RE.exec(fileName);
  if (!m) {
    return {
      ...base,
      isMKojo: true,
      charaNum: null,
      variantCode: null,
      topic: "",
      isCanonical: false,
      lineCount: 0,
      atFuncCount: 0,
    };
  }
  const { charaNum, variantCode } = parseCharaVariantPrefix(m[1]);
  const text = await readErbText(absPath);
  const lines = text.split(/\r?\n/);
  let atFuncCount = 0;
  for (const line of lines) {
    if (line.length > 0 && line.charCodeAt(0) === 0x40 /* '@' */ && AT_RE.test(line)) {
      atFuncCount++;
    }
  }
  return {
    ...base,
    isMKojo: true,
    charaNum,
    variantCode,
    topic: m[2],
    isCanonical: true,
    lineCount: lines.length,
    atFuncCount,
  };
}

/** Walk a chara-dir's subtree, returning files with POSIX relPath relative
 *  to the chara dir (e.g. `霊夢/M_KOJO_K1_イベント.ERB`). */
async function walkCharaSubtree(charaDirAbs: string): Promise<ScannedFile[]> {
  const out: ScannedFile[] = [];
  async function walk(dirAbs: string, relPrefix: string): Promise<void> {
    const entries = await fs.readdir(dirAbs, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dirAbs, e.name);
      const rel = relPrefix ? `${relPrefix}/${e.name}` : e.name;
      if (e.isDirectory()) {
        await walk(full, rel);
      } else if (e.isFile()) {
        out.push(await scanFile(full, rel));
      }
    }
  }
  await walk(charaDirAbs, "");
  return out;
}

/**
 * Parse the whole `個人口上/` tree under `kojoDir` into a `KojosManifest`.
 * Tolerates a missing dir (returns empty manifest, doesn't throw).
 */
export async function parseKojos(kojoDir: string): Promise<KojosManifest> {
  const kojinDir = path.join(kojoDir, "個人口上");
  const exists = await fs.access(kojinDir).then(() => true).catch(() => false);
  if (!exists) {
    return {
      generatedAt: new Date().toISOString(),
      projectRoot: "",
      kojoDir,
      charaCount: 0,
      variantCount: 0,
      fileCount: 0,
      atLineTotal: 0,
      charas: [],
      failures: [],
    };
  }

  // First level under 個人口上/ = chara dirs. Walk each independently so
  // we can attribute files to the right chara without carrying chara
  // names through recursion. Each chara subtree is a list of files with
  // POSIX relPath relative to the chara dir.
  const charaEntries = await fs.readdir(kojinDir, { withFileTypes: true });
  const charaDirs: { dirName: string; abs: string; files: ScannedFile[] }[] = [];
  for (const e of charaEntries) {
    if (!e.isDirectory()) continue;
    const charaDirName = e.name;
    const charaDirAbs = path.join(kojinDir, charaDirName);
    const files = await walkCharaSubtree(charaDirAbs);
    charaDirs.push({ dirName: charaDirName, abs: charaDirAbs, files });
  }

  // Sort by chara num.
  charaDirs.sort((a, b) => {
    const pa = parseCharaDirName(a.dirName);
    const pb = parseCharaDirName(b.dirName);
    if (pa && pb) return pa.charaNum - pb.charaNum || a.dirName.localeCompare(b.dirName);
    if (pa) return -1;
    if (pb) return 1;
    return a.dirName.localeCompare(b.dirName);
  });

  const charas: KojoCharaEntry[] = [];
  const failures: KojoFailure[] = [];

  for (const { dirName: charaDirName, files } of charaDirs) {
    const chara = parseCharaDirName(charaDirName);
    if (!chara) {
      failures.push({
        relPath: `個人口上/${charaDirName}/`,
        reason: "regex-miss",
        detail: `chara dir name does not match ^(\\d+)\\s+(.+?)(?:\\s+\\[([^\\]]+)\\])?$: ${charaDirName}`,
      });
      continue;
    }

    // Variant = first segment of a file's relPath under the chara dir.
    // Files directly in the chara dir (single-segment relPath) go into
    // a synthetic variant whose name == chara dir name. The 159 先代
    // orphan uses this path — its M_KOJO_KX_* files sit in the chara
    // dir with no variant subdir.
    const variantDirs = new Map<string, ScannedFile[]>();
    let topLevelMKojoCount = 0;
    for (const f of files) {
      const segs = f.relPath.split("/");
      let variantName: string;
      if (segs.length < 2) {
        // File directly in chara dir → synthetic variant.
        variantName = charaDirName;
        if (f.isMKojo) topLevelMKojoCount++;
      } else {
        variantName = segs[0];
      }
      const slot = variantDirs.get(variantName) ?? [];
      slot.push(f);
      variantDirs.set(variantName, slot);
    }
    // Avoid a synthetic "chara dir name" entry when there's no M_KOJO
    // file at the top level (e.g. a chara that only has variant subdirs
    // plus a stray readme.txt at the chara dir).
    if (topLevelMKojoCount === 0 && variantDirs.has(charaDirName)) {
      const slot = variantDirs.get(charaDirName)!;
      if (!slot.some((f) => f.isMKojo)) {
        variantDirs.delete(charaDirName);
      }
    }

    const variants: KojoVariant[] = [];
    const mKojoFiles: KojoFile[] = [];
    const otherErbFiles: string[] = [];
    const otherFiles: string[] = [];

    for (const [variantName, variantFiles] of variantDirs) {
      const depth = 2; // direct children of chara dir
      const firstMKojo = variantFiles.find((f) => f.isMKojo && f.isCanonical);
      const variantCode = firstMKojo?.variantCode ?? null;
      const mKojoInVariant = variantFiles.filter((f) => f.isMKojo);
      variants.push({
        name: variantName,
        depth,
        variantCode,
        fileCount: mKojoInVariant.length,
      });
    }

    for (const f of files) {
      if (!f.isMKojo) {
        if (/\.(ERB|erb|ERH|erh)$/i.test(f.fileName)) {
          otherErbFiles.push(f.relPath);
        } else {
          otherFiles.push(f.relPath);
        }
        continue;
      }
      if (!f.isCanonical) {
        failures.push({
          relPath: `個人口上/${charaDirName}/${f.relPath}`,
          reason: "regex-miss",
          detail: `M_KOJO filename does not match the canonical regex: ${f.fileName}`,
        });
        mKojoFiles.push({
          relPath: `個人口上/${charaDirName}/${f.relPath}`,
          fileName: f.fileName,
          charaNum: f.charaNum,
          variantCode: f.variantCode,
          topic: "",
          isCanonical: false,
          sizeBytes: f.sizeBytes,
          lineCount: f.lineCount,
          atFuncCount: f.atFuncCount,
        });
        continue;
      }
      if (chara.charaNum !== null && f.charaNum !== null && chara.charaNum !== f.charaNum) {
        failures.push({
          relPath: `個人口上/${charaDirName}/${f.relPath}`,
          reason: "chara-num-mismatch",
          detail: `dir charaNum=${chara.charaNum} but file prefix K${f.charaNum} (mismatch; still indexed)`,
        });
      }
      mKojoFiles.push({
        relPath: `個人口上/${charaDirName}/${f.relPath}`,
        fileName: f.fileName,
        charaNum: f.charaNum,
        variantCode: f.variantCode,
        topic: f.topic,
        isCanonical: true,
        sizeBytes: f.sizeBytes,
        lineCount: f.lineCount,
        atFuncCount: f.atFuncCount,
      });
    }

    mKojoFiles.sort((a, b) => a.relPath.localeCompare(b.relPath));
    variants.sort((a, b) => a.name.localeCompare(b.name));
    // The nested file records are the manifest authority. In particular,
    // non-canonical filenames are still indexed above, so their functions
    // must contribute to both the character and top-level aggregates.
    const atFuncCountTotal = mKojoFiles.reduce(
      (sum, file) => sum + file.atFuncCount,
      0,
    );

    charas.push({
      chara,
      variants,
      files: mKojoFiles,
      otherErbFiles: otherErbFiles.sort(),
      otherFiles: otherFiles.sort(),
      atFuncCountTotal,
    });
  }

  const variantCount = charas.reduce((sum, entry) => sum + entry.variants.length, 0);
  const fileCount = charas.reduce((sum, entry) => sum + entry.files.length, 0);
  const atLineTotal = charas.reduce((sum, entry) => sum + entry.atFuncCountTotal, 0);

  return {
    generatedAt: new Date().toISOString(),
    projectRoot: "",
    kojoDir,
    charaCount: charas.length,
    variantCount,
    fileCount,
    atLineTotal,
    charas,
    failures,
  };
}
