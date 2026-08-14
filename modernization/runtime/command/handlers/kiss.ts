/**
 * Phase 7.2 — `COMF312 キスする` settlement tail.
 */

import { makeSimpleComfHandler } from "./_template.js";

export const kissHandlerEntry = makeSimpleComfHandler({
  commandNo: 312,
  timeDelta: 10,
  narrationLabel: "%CALLNAME:MASTER%亲吻了%CALLNAME:TARGET%。",
});
