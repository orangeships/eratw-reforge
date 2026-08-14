/**
 * Phase 7 (P3) — `COMF445 採集する` (gathering), the first "actively earn
 * items" C-tier command. Faithful to the **base** eraTW algorithm in
 * `ERB/コマンド関連/COMF/日常系/COMF445 採集する.ERB`.
 *
 * This ports the **gather** half of the 采集→売→MONEY loop. The produced
 * 素材 ITEMs are real (P1 ITEM namespace); the **sell→money** half is
 * honestly DEFERRED to P6 (multi-map town shops / 摆摊) — there is no
 * general sell-items path in this slice yet.
 *
 * Ported faithfully (base algorithm):
 *   - **execCheck** (`@COM_ABLE445`, ERB 317-344): current location is a
 *     gathering spot, not sleeping, not 诶嘿嘿, `気力 >= 650`, `体力 >= 680`.
 *   - **採集パワー** (ERB 65, non-MAGIC_DLC): `10 + TALENT:採集Lv*10 +
 *     ABL:教養*5` (delegated to `gatheringPower`).
 *   - **Re-roll loop** (ERB 98-132): draw up to 4 times, stop on first
 *     find. The `FLAG:採集再抽選` interactive "keep or re-explore" branch
 *     is deferred — first find is kept.
 *   - **Draw** (`@Gathering_Drawing` base, ERB 991-1084): contiguous
 *     600–707 scan in a `RAND:5` start/direction pattern; first item in
 *     the spot-1 whitelist, under the 999 hold cap, and passing
 *     `採集パワー >= SQRT(ITEMPRICE+1000)` is chosen; QTY by price band.
 *     Delegated to `gatherDraw`.
 *   - **Grant** (ERB 137): `GET_ITEM` with the 999 hold cap (`addItem`).
 *   - **Cost** (ERB 188, 201-202, non-time-stop): `TIME += 60`,
 *     `DOWNBASE:体力 = 180 - (ABL:戦闘能力*15)`, `DOWNBASE:気力 = 150`.
 *   - **EXP** (ERB 142-152): `EXP:採集経験 += 1` always; `+= 2` extra when
 *     nothing found (so found=+1, nothing=+3); `EXP:学習経験 += 1` when
 *     `ABL:教養 <= 2`.
 *
 * **Deferred (mod-layer / subsystem, same posture as cleaning.ts):**
 *   - **QOL draw patch** (`QOL_Gathering_Drawing`, a 魔改 mod-layer
 *     function): the fork `JUMP`s here from base line 989, replacing the
 *     contiguous scan with a weighted-pool + advantage-dice draw (depends
 *     on weather, a static material cache, `RANDSF`/`POWER`). We port the
 *     canonical base algorithm and defer the QOL draw — consistent with
 *     how MAGIC_DLC and the QOL broom bonuses are deferred elsewhere.
 *     Swappable later.
 *   - 土地の恵み daily-luck modifier (ERB 58) → 0.
 *   - MAGIC_DLC power/QTY branches (ERB 66-68, 1068-1081), 宝藏袋 (ERB 94-96).
 *   - Participant (date/TARGET) power-combine + SOURCE (ERB 44-55, 72-79,
 *     145-174, 207-306) — solo gather only.
 *   - Treasure-chest / LOCKPICK_SYSTEM (ERB 89-93).
 *   - Time-stop TSP-cost arm (ERB 177-184) — `FLAG:時間停止` modeled but
 *     the TSP field + arm are deferred.
 *   - Location gates (幽香/天子/百百世 弾幕勝負, ERB 13-41) — multi-map.
 *   - 虹龍洞 (spot 68) thin-air extra cost (ERB 195-203).
 *   - GATHERING_SPOT spots 2-69 (P6 multi-map). Only spot 1 is mapped.
 *   - FLAG:採集再抽選 re-抽選 interactive branch (ERB 108-128).
 *   - Date-gate (ERB 329), 約會経験 (ERB 170-174).
 *   - ITEM:108 power/EXP bonuses (ERB 69-70, 148-149).
 */

import type { GameState } from "../../state/game-state.js";
import type { HandlerEntry, CommandContext } from "../types.js";
import { cloneGameState } from "../../state/game-state.js";
import {
  ABL_ID,
  BASE_ID,
  CFLAG_ID,
  EXP_ID,
  advanceTimeTicks,
  getMasterBase,
  setMasterBase,
} from "../../state/settlement.js";
import { addItem } from "../../state/items.js";
import { gatherDraw, gatheringPower, gatheringSpot } from "../../state/gathering.js";

// ---------------------------------------------------------------------------
// execCheck — `@COM_ABLE445` core (ERB 317-344)
// ---------------------------------------------------------------------------

function checkGatheringEligible(
  ctx: CommandContext,
): { ok: true } | { ok: false; reason: { kind: "precondition"; message: string } } {
  const master = ctx.state.master;
  // ERB 326: current location must resolve to a gathering spot. Spot 1 =
  // 鎮守之森 / 妖精的大樹 (the only spot mapped in this slice).
  if (gatheringSpot(master.location) === 0) {
    return { ok: false, reason: { kind: "precondition", message: "这里不是可以采集的地方。" } };
  }
  // ERB 332: not sleeping.
  if ((master.state.CFLAG[CFLAG_ID.睡眠] ?? 0) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "睡眠中无法采集。" } };
  }
  // ERB 334: not in 诶嘿嘿.
  if ((master.state.CFLAG[CFLAG_ID.诶嘿嘿] ?? 0) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "现在不是采集的时候。" } };
  }
  // ERB 337: 気力 >= 650 && 体力 >= 680.
  if ((getMasterBase(ctx.state, BASE_ID.気力) ?? 0) < 650) {
    return { ok: false, reason: { kind: "precondition", message: "気力不足，无法采集。" } };
  }
  if ((getMasterBase(ctx.state, BASE_ID.体力) ?? 0) < 680) {
    return { ok: false, reason: { kind: "precondition", message: "体力不足，无法采集。" } };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// handler — `@COM445` core (solo, base algorithm, non-time-stop)
// ---------------------------------------------------------------------------

/** Max draw attempts before giving up (ERB 131: `LOCAL:4 <= 3` → 4 draws). */
const MAX_GATHER_ATTEMPTS = 4;
/** Cheapest spot-1 material is price 10 → SQRT(1010) = 31. */
const MIN_SPOT1_POWER = 31;

export const gatheringHandlerEntry: HandlerEntry = {
  commandNo: 445,
  execCheck: (ctx) => {
    const r = checkGatheringEligible(ctx);
    return r.ok ? { ok: true } : { ok: false, reason: r.reason };
  },
  handler: (ctx) => {
    const next: GameState = cloneGameState(ctx.state);

    // ERB 80 / 99: 採集位置 = GATHERING_SPOT(現在位置). execCheck guaranteed
    // a non-zero spot; spot 1 is the only one mapped here.
    const spot = gatheringSpot(next.master.location);
    // Defensive — execCheck should have blocked this, but stay correct if
    // the handler is ever called directly.
    if (spot === 0) {
      return {
        state: next,
        events: [
          { kind: "NARRATION" as const, timestamp: ctx.now(), text: "这里不是可以采集的地方。" },
        ],
        outcome: "noop" as const,
      };
    }

    // ERB 98-132: re-roll loop — draw up to MAX_GATHER_ATTEMPTS times,
    // keep the first find. (FLAG:採集再抽選 interactive branch deferred →
    // first find is always kept, matching the !FLAG:採集再抽選 arm.)
    let foundId = 0;
    let foundQty = 0;
    let foundName = "";
    for (let attempt = 0; attempt < MAX_GATHER_ATTEMPTS; attempt++) {
      const draw = gatherDraw(next, ctx.rng);
      if (draw.id !== 0) {
        foundId = draw.id;
        foundQty = draw.qty;
        foundName = draw.name;
        break;
      }
    }

    // ERB 134-138: grant via GET_ITEM (999 hold cap, addItem).
    if (foundId !== 0) {
      addItem(next, foundId, foundQty);
    }

    // ERB 188: 時間経過 (non-treasure-chest, non-time-stop) → TIME += 60.
    advanceTimeTicks(next, 60);

    // ERB 201-202: DOWNBASE 体力 = 180 - (戦闘能力*15), 気力 = 150.
    // (setMasterBase writes raw — no clamp — matching ERA DOWNBASE semantics.)
    const battle = next.master.state.ABL[ABL_ID.战斗能力] ?? 0;
    setMasterBase(
      next,
      BASE_ID.体力,
      (getMasterBase(next, BASE_ID.体力) ?? 0) - (180 - battle * 15),
    );
    setMasterBase(
      next,
      BASE_ID.気力,
      (getMasterBase(next, BASE_ID.気力) ?? 0) - 150,
    );

    // ERB 142-152: EXP grants (solo — participant branches deferred).
    //   EXP:採集経験 += 1 (always); += 2 extra when nothing found.
    next.master.state.EXP[EXP_ID.採集経験] =
      (next.master.state.EXP[EXP_ID.採集経験] ?? 0) + 1 + (foundId === 0 ? 2 : 0);
    // ERB 151-152: ABL:教養 <= 2 → EXP:学習経験 += 1.
    if ((next.master.state.ABL[ABL_ID.教養] ?? 0) <= 2) {
      next.master.state.EXP[EXP_ID.学習経験] =
        (next.master.state.EXP[EXP_ID.学習経験] ?? 0) + 1;
    }

    const power = gatheringPower(next);
    const text =
      foundId !== 0
        ? `%CALLNAME:MASTER% 采集到了 ${foundQty} 个${foundName}。`
        : power < MIN_SPOT1_POWER
          ? `%CALLNAME:MASTER% 采集了一番，但采集能力还不足，什么也没找到。\n采集经验增加了。`
          : `%CALLNAME:MASTER% 采集了一番，但什么也没找到。\n采集经验增加了。`;
    return {
      state: next,
      events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text }],
      outcome: "ok" as const,
    };
  },
};
