/**
 * Phase 7.2 — `COMF334 杯を交わす` settlement tail.
 */

import type { GameState } from "../../state/game-state.js";
import { makeSimpleComfHandler } from "./_template.js";
import { BASE_ID, SOURCE_ID, TALENT_ID, ABL_ID } from "../../state/settlement.js";
import { applySourceCheck } from "../source-check.js";
import { createRng } from "../rng.js";

/** Faithful to upstream 碰杯 settlement: increases master drunk level and
 * applies SOURCE to target based on intimacy and alcohol tolerance. */
function settleDrink(
  next: GameState,
  target: { charaNum: number; state: GameState["charas"][0]["state"] },
): void {
  const tolerance = target.state.TALENT[TALENT_ID.酒耐性] ?? 0;
  const masterSlot = next.master;

  // Drain master stamina/energy
  const drain体力 = 20;
  const drain気力 = 10;
  masterSlot.state.BASE[BASE_ID.体力] = Math.max(0, (masterSlot.state.BASE[BASE_ID.体力] ?? 0) - drain体力);
  masterSlot.state.BASE[BASE_ID.気力] = Math.max(0, (masterSlot.state.BASE[BASE_ID.気力] ?? 0) - drain気力);

  // Increase master drunk level (酒気 not 酔い)
  const rng = createRng(next.time.tickValue * 100003 + target.charaNum);
  const drunkIncrease = Math.max(50 + tolerance, 51);
  const currentDrunk = masterSlot.state.BASE[BASE_ID.酒気] ?? 0;
  masterSlot.state.BASE[BASE_ID.酒気] = currentDrunk + drunkIncrease + rng.int(50);

  // Apply SOURCE to target
  const 親密 = target.state.ABL[ABL_ID.親密] ?? 0;
  const 従順 = target.state.ABL[ABL_ID.従順] ?? 0;
  const 施虐 = target.state.ABL[ABL_ID.施虐属性] ?? 0;

  applySourceCheck(next, target.charaNum, {
    [SOURCE_ID.歓楽]: 150 + (親密 + tolerance) * 50,
    [SOURCE_ID.受動]: 100 + (従順 + tolerance) * 50,
    [SOURCE_ID.征服]: 100 + (施虐 + tolerance) * 50,
  }, 0, 1);
}

export const nightCapHandlerEntry = makeSimpleComfHandler({
  commandNo: 334,
  timeDelta: 10,
  narrationLabel: "%CALLNAME:MASTER%和%CALLNAME:TARGET%碰了一杯。",
  // Parity QA P-13 — `@COM_ABLE334`: `SIF CFLAG:職種 != JOB_宴会参加 → RETURN 0`.
  // The extractor only caught requiresMasterStamina + notWhileTimeStopped;
  // compileGate adds the live banquet phase and worker projection checks so
  // 碰杯 stays hidden until the actual banquet stage has started.
  gate: { requiresBanquetParticipant: true },
  body: settleDrink,
});
