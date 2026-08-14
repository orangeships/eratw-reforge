/**
 * Phase 7.2 — `COMF306 お腹を撫でる` settlement tail.
 */

import { makeSimpleComfHandler } from "./_template.js";

export const bellyRubHandlerEntry = makeSimpleComfHandler({
  commandNo: 306,
  timeDelta: 10,
  narrationLabel: "%CALLNAME:MASTER%抚摸了%CALLNAME:TARGET%的肚子。",
});
