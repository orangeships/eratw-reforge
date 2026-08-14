/**
 * Phase 7.2 — `COMF305 膝枕してもらう` settlement tail.
 *
 * TARGET's lap pillow. Light-touch via template; time +10.
 */

import { makeSimpleComfHandler } from "./_template.js";

export const lapPillowReceiveHandlerEntry = makeSimpleComfHandler({
  commandNo: 305,
  timeDelta: 10,
  narrationLabel: "%CALLNAME:MASTER%枕在了%CALLNAME:TARGET%的膝上。",
});
