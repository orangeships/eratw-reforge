/**
 * Phase 7.5 (§3E) — `sekuhara.ts`: the セクハラコマンド shared skeleton.
 *
 * `COMF310 尻を撫でる` is the **root exemplar** of the entire セクハラ族
 * (317 胸を揉む / 318 耳を舐める / 332 キスするetc. are 換皮 of the same
 * skeleton). Per the family-exemplar strategy (`phase-7-status.md`), the
 * genuinely-shared sub-formulas live here as hand-verified primitives so
 * the sibling ports reuse them instead of re-deriving:
 *
 *   - {@link getSuccessRate} — `@GET_SUCCESS_RATE` (`COMMON_J.ERB:1`), the
 *     non-DLC core. Drives the failure threshold `MIN(109, 90 + rate/5)`.
 *   - {@link kojoForcedFailure} — `@KOJO_FORCED_FAILURE` CASE 0 (the only
 *     arm our resolver can reach: `TFLAG:192` is never passed, so the
 *     force-fail/force-success CASEELSE is dead). Maps the roll to the
 *     `TFLAG:193` success tier (1=失敗 / 2=成功 / 3=大成功).
 *   - {@link hitoke} — `@HITOKE` (`押し倒され.ERB:566`), the bystander
 *     check that doubles 露出/反感 SOURCE when someone else is around.
 *   - {@link applySekuharaTier} — the `TFLAG:193` ×table (310 lines
 *     85-107) every セクハラ command applies to its SOURCE set.
 *
 * **DEFERRED (documented, off-by-default in the trial slice):**
 *   - `MAGIC_DLC_大成功相关` 重做 branch (GET_SUCCESS_RATE line 8) — DLC.
 *   - TALENT terms not in our enum: 態度 / 目立ちたがり / 容易高潮 / 愛欲 /
 *     魅惑 / 謎之魅力 / 魅力, and `OTOKOGIRAI()` / `RELATION` — all 0 for a
 *     clean chara. Their arms are skipped (faithful: a fresh chara has them
 *     off), not silently dropped.
 *   - `TFLAG:幸運補正` — not modeled → 0.
 *   - `TFLAG:192` force arms (CASE 1/-1/-2) — resolver doesn't pass it; we
 *     always take CASE 0. `TFLAG:193 == -2 → RETURN -1` therefore never
 *     fires (it's the CASE -1 force-terminate artifact).
 *   - `TFLAG:102` 先制 (310 line 65 `MAX(TFLAG:193,2)`) — not passed → 0.
 *   - HITOKE's 公共の場 (ROOMDATA) / `CAN_SEE` / `nChildrenAwake` arms —
 *     need room-adjacency + room-data we don't import. Only the 同室
 *     multi-target arm (`FINDELEMENT(TARGET,0)-1 > 1`) is modeled: true
 *     when ≥2 NPCs are co-present with master. In the single-char trial
 *     (霊夢 alone) HITOKE is therefore false — correct.
 */

import type { CharaSlot, GameState } from "./game-state.js";
import {
  ABL_ID,
  CFLAG_ID,
  PALAM_ID,
  TALENT_ID,
  palamLevel,
  times,
} from "./settlement.js";
import { selectPresentCharas } from "../scene/presence.js";

const abl = (s: CharaSlot, id: number) => s.state.ABL[id] ?? 0;
const cflag = (s: CharaSlot, id: number) => s.state.CFLAG[id] ?? 0;
const talent = (s: CharaSlot, id: number) => s.state.TALENT[id] ?? 0;
const palam = (s: CharaSlot, id: number) => s.state.PALAM[id] ?? 0;

/**
 * `@GET_SUCCESS_RATE(CHARA)` non-DLC core (`COMMON_J.ERB:1-89`), with
 * `CHARA` defaulting to the target. Returns the success-rate used by the
 * セクハラ outcome roll (`LOCAL:1 = MIN(109, 90 + rate/5)`).
 *
 * Ports every term our enum can read; the unimported TALENT arms are
 * skipped (a clean chara has them off, so this is faithful). `RELATION`,
 * `OTOKOGIRAI`, the player 魅惑/魅力 cluster, and `TFLAG:幸運補正` defer
 * to 0. Floor 0 (ERB line 84-85).
 */
export function getSuccessRate(t: CharaSlot, master: CharaSlot): number {
  let local = 0;
  // 親密 (line 11).
  local += Math.min(abl(t, ABL_ID.親密), 10) * 5;
  // 恭順 PALAM level (line 13).
  local += palamLevel(palam(t, PALAM_ID.恭順), 5) * 3;
  // 態度 (line 16) — TALENT not imported → 0.
  // 胆量 (line 18).
  if (talent(t, TALENT_ID.胆量) > 0) local -= 5;
  // 自尊心 (lines 22-26).
  if (talent(t, TALENT_ID.自尊心) > 0) local -= 15;
  else if (talent(t, TALENT_ID.自尊心) < 0) local += 5;
  // 目立ちたがり (line 28) — not imported → 0.
  // 自己愛 (line 31) — 圧抑.
  if (talent(t, TALENT_ID.自己愛) < 0) local -= 10;
  // 抵抗 (line 34).
  if (talent(t, TALENT_ID.抵抗)) local -= 10;
  // 容易高潮 (line 37) — not imported → 0.
  // OTOKOGIRAI (line 40) — not imported → 0.
  // 心情 (line 43).
  local += talent(t, TALENT_ID.心情) * 15;
  // PLAYER 魅惑/謎之魅力/魅力 (lines 47-53) — not imported → 0.
  // RELATION (lines 56-69) — not imported → 0.
  // 好感度 (line 72).
  local += Math.min(Math.trunc(cflag(t, CFLAG_ID.好感度) / 200), 50);
  // 信頼度 (line 74).
  local += Math.min(Math.trunc(cflag(t, CFLAG_ID.信頼度) / 20), 50);
  // 思慕 || 愛欲 (line 77) — 愛欲 not imported; 思慕 modeled.
  if (talent(t, TALENT_ID.思慕)) local += 20;
  // 恋慕 (line 80).
  if (talent(t, TALENT_ID.恋慕)) local += 40;
  // 地位差 (line 82): (CFLAG:MASTER:310 - CFLAG:CHARA:310) / 500.
  local += Math.trunc(
    (cflag(master, CFLAG_ID.地位) - cflag(t, CFLAG_ID.地位)) / 500,
  );
  // TFLAG:幸運補正 (line 83) — not modeled → 0.
  if (local < 0) local = 0;
  return local;
}

/**
 * `@KOJO_FORCED_FAILURE(roll, failThreshold)` CASE 0 (`COMF310.ERB:156`).
 * The resolver never passes `TFLAG:192`, so the force-fail CASEELSE is
 * unreachable; this is the only live arm. Returns the `TFLAG:193` tier:
 *
 *   roll <= 9            → 3 (大成功)
 *   roll >= failThreshold → 1 (失敗)
 *   else                 → 2 (成功)
 */
export function kojoForcedFailure(
  roll: number,
  failThreshold: number,
): 1 | 2 | 3 {
  if (roll <= 9) return 3;
  if (roll >= failThreshold) return 1;
  return 2;
}

/**
 * `@HITOKE(1)` (`押し倒され.ERB:566`) — bystander-present check. Models
 * only the 同室 multi-target arm (`FINDELEMENT(TARGET,0)-1 > 1`): true
 * when ≥2 NPCs are co-located with master. The 公共の場 (ROOMDATA) /
 * `CAN_SEE` / `nChildrenAwake` arms defer (no room data imported); in the
 * single-char trial HITOKE is therefore false, which is correct.
 */
export function hitoke(state: GameState): boolean {
  const present = selectPresentCharas(state, state.master.location);
  // present[0] is master; the rest are co-located NPCs.
  return present.length - 1 >= 2;
}

/**
 * The `TFLAG:193` ×table every セクハラ command applies to its SOURCE
 * set (`COMF310.ERB:85-107`). Mutates `sources` in place via ERA `TIMES`
 * (truncate toward zero). NOTE: tier 2 (成功) leaves 反感 untouched (the
 * ERB has no `TIMES SOURCE:反感` line in that branch); tier 1 and the
 * else(4) branch DO scale 反感.
 *
 *   1 (失敗): 歓楽×.10 / 情愛×.50 / 受動×.50 / 欲情×.50 / 反感×1.50
 *   2 (成功): 歓楽×1.0 / 情愛×1.0 / 受動×1.0 / 欲情×1.0          (反感 unchanged)
 *   3 (大成功): 歓楽×1.5 / 情愛×1.5 / 受動×1.5 / 欲情×1.5
 *   else (4): 歓楽×2.0 / 情愛×2.0 / 受動×2.0 / 欲情×2.0 / 反感×0.75
 *
 * `露出` is NOT tier-scaled (only HITOKE doubles it) — caller applies
 * HITOKE before calling this.
 */
export function applySekuharaTier(
  sources: Record<number, number>,
  tflag193: number,
  ids: { 歓楽: number; 情愛: number; 受動: number; 欲情: number; 反感: number },
): void {
  const scale = (id: number, f: number) => {
    if (sources[id] !== undefined) sources[id] = times(sources[id]!, f);
  };
  if (tflag193 === 1) {
    scale(ids.歓楽, 0.1);
    scale(ids.情愛, 0.5);
    scale(ids.受動, 0.5);
    scale(ids.欲情, 0.5);
    scale(ids.反感, 1.5);
  } else if (tflag193 === 2) {
    scale(ids.歓楽, 1.0);
    scale(ids.情愛, 1.0);
    scale(ids.受動, 1.0);
    scale(ids.欲情, 1.0);
  } else if (tflag193 === 3) {
    scale(ids.歓楽, 1.5);
    scale(ids.情愛, 1.5);
    scale(ids.受動, 1.5);
    scale(ids.欲情, 1.5);
  } else {
    scale(ids.歓楽, 2.0);
    scale(ids.情愛, 2.0);
    scale(ids.受動, 2.0);
    scale(ids.欲情, 2.0);
    scale(ids.反感, 0.75);
  }
}
