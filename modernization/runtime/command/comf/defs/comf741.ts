/**
 * Phase 7 — `COMF741 Ｅマッサージャ(慰)` (E-massager self-use, master-only).
 *
 * Ports the **normal-mode core** of `@COM741`
 * (`ERB/コマンド関連/COMF/700 自慰系/COMF741 Ｅマッサージャ(慰).ERB`).
 *
 * **Self/auto family sibling** (700 自慰系). Master only. No target.
 *
 * **Faithful normal-mode core (ERB 13-41):**
 *   - DOWNBASE: master 体力 30 / 気力 150 (ERB 16-17)
 *   - SOURCE master: 快Ｃ 500, 露出 40, 逸脱 60, 反感 60 (ERB 19-22)
 *   - 鬱屈 +60 if 自己愛<0 || 抵抗 (ERB 28-29)
 *   - body: 道具使用経験 PLAYER++, 自慰过了 PLAYER++
 *     (ERB 37-39), TIME += 5 (ERB 34-35).
 *
 * **DEFERRED (documented):**
 *   - TCVAR:116 = PLAYER (ERB 10) — display marker.
 *   - TEQUIP:32 ABLE gate (ERB 64) — 淋浴中, slot not in TEQUIP_ID.
 *   - TEQUIP-touch setters (ERB 72-78) — TOUCH handler deferred.
 *
 * **Gate (P1-14):** `@COM_ABLE741` — hasItem(1) 电动按摩棒 + !BEDROOM ≈
 *   roomProps.private; deferred TFLAG:100 / GLOBAL_COMABLE / NOITEM / ASSIPLAY.
 *
 * **TIME += 5** (ERB 34-35). Modeled as `timeCost: 5`.
 */

import type { ExecCheck, HandlerEntry } from "../../types.js";
import {
  BASE_ID,
  EXP_ID,
  SOURCE_ID,
  TALENT_ID,
} from "../../../state/settlement.js";
import { makeComfHandler } from "../make-comf-handler.js";
import type { ComfDef } from "../comf-def.js";
import { hasItem } from "../../../state/items.js";
import { roomProps } from "../../comable/room-props.js";

const block = (message: string) =>
  ({ ok: false, reason: { kind: "precondition", message } }) as const;

/**
 * `@COM_ABLE741` gate (faithful core). Deferred: TFLAG:100, GLOBAL_COMABLE,
 * NOITEM 道具無設定 mode, ASSIPLAY 技巧<3 gate, TEQUIP:32 淋浴中.
 */
const com741Check: ExecCheck = (ctx) => {
  const target = ctx.state.charas[ctx.target];
  if (!target) return block("需要在场的对象。");
  if (!hasItem(ctx.state, 1)) return block("需要持有电动按摩棒。");
  // !BEDROOM(現在位置) → 近似 roomProps().private (comf23 同款).
  if (!roomProps(ctx.state.master.location).private) {
    return block("需要回到卧室/床铺附近。");
  }
  return { ok: true };
};

export const comf741Def: ComfDef = {
  commandNo: 741,
  label: "Ｅマッサージャ(慰)",

  requiresItem: 1,

  canExecute: com741Check,
  hModeMenuCheck: com741Check,

  maxRoll: 100,
  greatThreshold: 0,
  failThreshold: 101,

  timeCost: 5,

  requiresTarget: false,

  downbase: { [BASE_ID.体力]: 30, [BASE_ID.気力]: 150 },

  buildSources: (c) => {
    const sources: Record<number, number> = {
      [SOURCE_ID.快Ｃ]: 500,
      [SOURCE_ID.露出]: 40,
      [SOURCE_ID.逸脱]: 60,
      [SOURCE_ID.反感]: 60,
    };

    if (
      (c.master.state.TALENT[TALENT_ID.自己愛] !== undefined &&
        c.master.state.TALENT[TALENT_ID.自己愛] < 0) ||
      c.master.state.TALENT[TALENT_ID.抵抗]
    ) {
      sources[SOURCE_ID.鬱屈] = 60;
    }

    return sources;
  },

  body: (c) => {
    c.master.state.CFLAG[/*自慰过了*/ 347] =
      (c.master.state.CFLAG[347] ?? 0) + 1;
    c.master.state.EXP[EXP_ID.道具使用経験] =
      (c.master.state.EXP[EXP_ID.道具使用経験] ?? 0) + 1;
  },

  narration: (_c, favorDelta) =>
    `%CALLNAME:MASTER% 对自己使用了电动按摩器 — Ｅマッサージャ(慰)；好感度 ${
      favorDelta >= 0 ? "+" : ""
    }${favorDelta}.`,
};

export const comf741HandlerEntry: HandlerEntry = makeComfHandler(comf741Def);
