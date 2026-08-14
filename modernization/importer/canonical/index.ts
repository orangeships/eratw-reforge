/**
 * Phase 2.6 PR 2 — Canonical-name bundle.
 *
 * Mirrors `importer/erb/index.ts` shape: the two utilities +
 * the loader compose into a single import. Test code and Phase 3+
 * TS code import from here.
 *
 * This is the **adapter boundary** for canonical names. Per
 * [[eratw-canonical-naming]] rule 1: "adapter 就是 legacy 的
 * 边界。adapter 边界内保留 legacy，边界外全部走 canonical."
 *
 * In other words: every file OUTSIDE this directory uses
 * `canonical` names. The only place `legacy` names are written
 * back to the picture is `apply-glossary.ts` here, when talking
 * to upstream data.
 */

export * from "./types.js";
export * from "./glossary-loader.js";
export * from "./apply-glossary.js";
