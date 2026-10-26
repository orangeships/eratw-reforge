export type {
  Anchor,
  AnchorRole,
  KojoSourceFile,
  PatchVerification,
  SourceFunction,
  SourceIssue,
  SourceLine,
} from "./types.js";
export { collectGotoTargets, scanKojoSource, splitPhysicalLines, STRUCTURAL_OPENERS, stripComment } from "./scan.js";
export { anchorText, anchorsOfFunction, orderedAnchors, render } from "./render.js";
export type { DeleteAnchor, InsertAfterAnchor, PatchResult, ReplaceAnchor, ReplaceRange, SourcePatchLine, SourceEdit } from "./patch.js";
export { applyEdits, describePatch } from "./patch.js";
