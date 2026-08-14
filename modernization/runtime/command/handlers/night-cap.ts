/**
 * Phase 7.2 — `COMF334 杯を交わす` settlement tail.
 */

import { makeSimpleComfHandler } from "./_template.js";

export const nightCapHandlerEntry = makeSimpleComfHandler({
  commandNo: 334,
  timeDelta: 10,
  narrationLabel: "%CALLNAME:MASTER%和%CALLNAME:TARGET%碰了一杯。",
  // Parity QA P-13 — `@COM_ABLE334`: `SIF CFLAG:職種 != JOB_宴会参加 → RETURN 0`.
  // The extractor only caught requiresMasterStamina + notWhileTimeStopped; the
  // core banquet-participant gate needs the (unmodeled) banquet/job subsystem.
  // requiresBanquetParticipant blocks faithfully — 職種 is never 49 in our
  // runtime (no banquet is ever hosted), so 碰杯 stays hidden instead of
  // showing everywhere.
  gate: { requiresBanquetParticipant: true },
});
