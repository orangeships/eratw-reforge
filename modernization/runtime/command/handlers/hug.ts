/**
 * Phase 7.2 — `COMF311 抱き付く` settlement tail.
 */

import { makeSimpleComfHandler } from "./_template.js";

export const hugHandlerEntry = makeSimpleComfHandler({
  commandNo: 311,
  timeDelta: 10,
  narrationLabel: "%CALLNAME:MASTER%抱住了%CALLNAME:TARGET%。",
});
