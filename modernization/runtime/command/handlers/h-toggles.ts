/**
 * Phase 7 (Wave 4d) — H-mode toggle/utility commands (50 / 51 / 24).
 *
 * Three small bespoke H commands that don't fit the SOURCE-settlement
 * ComfDef shape — they flip equipment / consume items / re-route the H
 * scene's initiative, all `RETURN 0`/`RETURN 1` with no SOURCE settlement.
 *
 * - **COMF50 ゴム装着** (`COMF50 ゴム装着.ERB`): toggle the condom. If not
 *   worn → consume 1 避孕套 (ITEM 45) + set TEQUIP:避孕套; if worn → clear
 *   the flag + reset ゴム内/使用済み. `RETURN 0` (no turn cost). The condom
 *   flag lives in the master TEQUIP namespace (`state.TEQUIP[35]`, see
 *   `state/tequip.ts`).
 * - **COMF51 避妊薬** (`COMF51 避妊薬.ERB`): give the target the oral pill.
 *   If already taken (TCVAR:口服避孕薬) → noop; else consume 1 口服避孕薬
 *   (ITEM 49) + set the target's TCVAR:口服避孕薬 = 1. `RETURN 0`.
 * - **COMF24 攻守交替** (`COMF24 攻守交替.ERB`): hand the initiative to the
 *   partner(s). Master 诶嘿嘿 = 2; every co-located chara already in 诶嘿嘿
 *   gets 诶嘿嘿 = 2 (skip those at 0, to avoid pulling bystanders in during
 *   潜伏). `TIME += 5`, `RETURN 1`.
 *
 * **DEFERRED:** the common @COM_ABLE preamble (TFLAG:100/GLOBAL_COMABLE),
 * COMF51's fuller target/medicine gate, and COMF24's `SETBIT TCVAR:随便,1`
 * marker. COMF50's command-specific `HAS_PENIS` and simultaneous V/A
 * insertion locks are implemented below from the upstream predicate;
 * TCVAR:116 行為者 marker; 24's per-partner `SETBIT TCVAR:随便,1` marker;
 * the display-name variants (50 "コンドームを外す").
 */

import type { GameState } from "../../state/game-state.js";
import type { CommandContext, ExecCheck, HandlerEntry } from "../types.js";
import { cloneGameState } from "../../state/game-state.js";
import { hasItem, removeItem, itemCount } from "../../state/items.js";
import { selectPresentCharas } from "../../scene/presence.js";
import {
  CFLAG_ID,
  EX_ID,
  TALENT_ID,
  TCVAR_ID,
  TEQUIP_ID,
  advanceTimeTicks,
} from "../../state/settlement.js";
import { isEquipped, readTequip, setEquipped } from "../../state/tequip.js";
import { isPlayerHInsertionActive } from "../../state/h-interaction-state.js";
import { isHMode, isTimeStopped } from "../h-mode.js";

/** TEQUIP slot for the condom (TEQUIP.csv id 35 避孕套). Master-side. */
const EQUIP_CONDOM = TEQUIP_ID.避孕套;
/** ITEM id for a single condom (Item.csv 45). */
const ITEM_CONDOM = 45;
/** ITEM id for the oral pill (Item.csv 49 口服避孕薬). */
const ITEM_PILL = 49;
/** TCVAR slot marking "pill taken today" (TCVAR.csv 109 口服避孕薬). */
const TCVAR_PILL_TAKEN = 109;
/** 诶嘿嘿 initiative value: 2 = partner-led (COMF24). */
const UFUFU_PARTNER_LED = 2;

const EDGING_EX_IDS = [
  EX_ID.Ｃ寸止め,
  EX_ID.Ｖ寸止め,
  EX_ID.Ａ寸止め,
  EX_ID.Ｂ寸止め,
  EX_ID.Ｍ寸止め,
] as const;

/**
 * USERCOM.ERB:826's shared gate.  The menu reaches this command from the
 * training branch, while FLAG:70 also keeps the upstream time-stop escape
 * hatch available.  The command itself never advances time.
 */
const com826Check: ExecCheck = (ctx) => {
  const target = ctx.state.charas[ctx.target];
  if (!target) {
    return {
      ok: false as const,
      reason: { kind: "precondition" as const, message: "目标角色必须在场。" },
    };
  }
  const masterInTraining = (ctx.state.master.state.CFLAG[CFLAG_ID.诶嘿嘿] ?? 0) !== 0;
  const masterPrank = (ctx.state.master.state.CFLAG[CFLAG_ID.恶作剧] ?? 0) !== 0;
  if (!isTimeStopped(ctx.state) && (!masterInTraining || masterPrank)) {
    return {
      ok: false as const,
      reason: { kind: "precondition" as const, message: "当前不能使用挑逗开关。" },
    };
  }
  return { ok: true as const };
};

/** COMF826 — 挑逗 / 结束挑逗.  This is a free toggle (no TIME advance). */
export const teasing826HandlerEntry: HandlerEntry = {
  commandNo: 826,
  execCheck: com826Check,
  hModeMenuCheck: com826Check,
  handler: (ctx: CommandContext) => {
    const next = cloneGameState(ctx.state);
    const target = next.charas[ctx.target];
    if (!target) {
      return {
        state: next,
        events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text: "目标角色不在场。" }],
        outcome: "noop" as const,
      };
    }

    if (readTequip(target, TEQUIP_ID.挑逗モード) !== 0) {
      target.state.TEQUIP[TEQUIP_ID.挑逗モード] = 0;
      return {
        state: next,
        events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text: "结束挑逗。" }],
        outcome: "noop" as const,
      };
    }

    if ((next.master.state.TCVAR[TCVAR_ID.要去了] ?? 0) !== 0) {
      return {
        state: next,
        events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text: "已经没有那么做的余裕了！" }],
        outcome: "noop" as const,
      };
    }

    if (EDGING_EX_IDS.some((id) => (target.state.EX[id] ?? 0) > 0)) {
      return {
        state: next,
        events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text: "在挑逗中" }],
        outcome: "noop" as const,
      };
    }

    target.state.TEQUIP[TEQUIP_ID.挑逗モード] = 1;
    return {
      state: next,
      events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text: "开始挑逗。" }],
      outcome: "noop" as const,
    };
  },
};

// ---------------------------------------------------------------------------
// COMF50 — ゴム装着 (condom toggle)
// ---------------------------------------------------------------------------

/**
 * `COM_ABLE50` command-specific gate.
 *
 * Upstream allows removal unconditionally once the condom is worn.  For the
 * put-on branch it requires ITEM:45, a penis on PLAYER, and rejects the
 * malformed/unsupported state where the selected target has both V and A
 * intercourse links pointing at PLAYER.  The common TFLAG:100 and
 * GLOBAL_COMABLE preamble is owned by the command system and is intentionally
 * not duplicated here (see comf-def.ts).
 */
const com50Check: ExecCheck = (ctx) => {
  if (isEquipped(ctx.state.master, EQUIP_CONDOM)) {
    return { ok: true as const };
  }
  if (!hasItem(ctx.state, ITEM_CONDOM, 1)) {
    return {
      ok: false as const,
      reason: { kind: "precondition" as const, message: "没有避孕套了。" },
    };
  }
  if (((ctx.state.master.state.TALENT[TALENT_ID.性別] ?? 0) & 2) === 0) {
    return {
      ok: false as const,
      reason: { kind: "precondition" as const, message: "当前角色没有可装着避孕套的阴茎。" },
    };
  }

  const targetHasForwardV = isPlayerHInsertionActive(ctx.state, ctx.target, "v");
  const targetHasForwardA = isPlayerHInsertionActive(ctx.state, ctx.target, "a");
  if (targetHasForwardV && targetHasForwardA) {
    return {
      ok: false as const,
      reason: { kind: "precondition" as const, message: "正在同时进行 V/A 插入，不能在此时装着避孕套。" },
    };
  }
  return { ok: true as const };
};

export const condom50HandlerEntry: HandlerEntry = {
  commandNo: 50,
  execCheck: com50Check,
  hModeMenuCheck: com50Check,
  handler: (ctx: CommandContext) => {
    const next: GameState = cloneGameState(ctx.state);
    const worn = isEquipped(next.master, EQUIP_CONDOM);
    let text: string;
    if (!worn) {
      // Put it on — consume one (execCheck would gate ITEM>0; defensive here).
      if (!hasItem(next, ITEM_CONDOM, 1)) {
        return {
          state: next,
          events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text: "没有避孕套了。" }],
          outcome: "noop" as const,
        };
      }
      removeItem(next, ITEM_CONDOM, 1);
      setEquipped(next.master, EQUIP_CONDOM, true);
      text = `戴上了避孕套（剩余 ${itemCount(next, ITEM_CONDOM)} 枚）。`;
    } else {
      // Take it off (always allowed).
      setEquipped(next.master, EQUIP_CONDOM, false);
      text = "取下了避孕套。";
    }
    // RETURN 0 — toggle, no turn cost.
    return {
      state: next,
      events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text }],
      outcome: "noop" as const,
    };
  },
};

// ---------------------------------------------------------------------------
// COMF51 — 避妊薬 (oral pill)
// ---------------------------------------------------------------------------

export const pill51HandlerEntry: HandlerEntry = {
  commandNo: 51,
  // @COM_ABLE51 (P1-14): needs a present target + the pill item. H-only range
  // (40-51) → the hModeMenuCheck surfaces it in the うふふ menu only while a
  // pill is owned.
  execCheck: (ctx) => {
    if (!ctx.state.charas[ctx.target]) {
      return { ok: false as const, reason: { kind: "precondition" as const, message: "需要在场的对象。" } };
    }
    if (!hasItem(ctx.state, ITEM_PILL, 1)) {
      return { ok: false as const, reason: { kind: "precondition" as const, message: "没有口服避孕药了。" } };
    }
    return { ok: true as const };
  },
  hModeMenuCheck: (ctx) => {
    if (!ctx.state.charas[ctx.target]) {
      return { ok: false as const, reason: { kind: "precondition" as const, message: "需要在场的对象。" } };
    }
    if (!hasItem(ctx.state, ITEM_PILL, 1)) {
      return { ok: false as const, reason: { kind: "precondition" as const, message: "没有口服避孕药了。" } };
    }
    return { ok: true as const };
  },
  handler: (ctx: CommandContext) => {
    const next: GameState = cloneGameState(ctx.state);
    const target = next.charas[ctx.target];
    if (!target) {
      return {
        state: next,
        events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text: "没有对象。" }],
        outcome: "noop" as const,
      };
    }
    // Already taken → noop (ERB RETURN -1).
    if ((target.state.TCVAR[TCVAR_PILL_TAKEN] ?? 0) !== 0) {
      return {
        state: next,
        events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text: "已服用过避孕药。" }],
        outcome: "noop" as const,
      };
    }
    if (!hasItem(next, ITEM_PILL, 1)) {
      return {
        state: next,
        events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text: "没有口服避孕药了。" }],
        outcome: "noop" as const,
      };
    }
    removeItem(next, ITEM_PILL, 1);
    target.state.TCVAR[TCVAR_PILL_TAKEN] = 1;
    return {
      state: next,
      events: [
        {
          kind: "NARRATION" as const,
          timestamp: ctx.now(),
          text: `让 %CALLNAME:TARGET% 喝下了避孕药（剩余 ${itemCount(next, ITEM_PILL)} 个）。`,
        },
      ],
      outcome: "noop" as const, // RETURN 0
    };
  },
};

// ---------------------------------------------------------------------------
// COMF24 — 攻守交替 (hand over initiative)
// ---------------------------------------------------------------------------

/** @COM_ABLE24 gate (P1-14 逆推): a present partner + someone already in
 *  うふふ (诶嘿嘿 != 0). Upstream's HAS_PENIS / 欲情 GETPALAMLV arms deferred. */
const com24Check: ExecCheck = (ctx) => {
  if (!ctx.state.charas[ctx.target]) {
    return { ok: false as const, reason: { kind: "precondition" as const, message: "需要目标角色在场。" } };
  }
  if (!isHMode(ctx.state, ctx.target)) {
    return { ok: false as const, reason: { kind: "precondition" as const, message: "需要先进入调教状态。" } };
  }
  return { ok: true as const };
};

export const swapRoles24HandlerEntry: HandlerEntry = {
  commandNo: 24,
  execCheck: com24Check,
  hModeMenuCheck: com24Check,
  handler: (ctx: CommandContext) => {
    const next: GameState = cloneGameState(ctx.state);
    // Master 诶嘿嘿 = 2 (partner-led).
    next.master.state.CFLAG[CFLAG_ID.诶嘿嘿] = UFUFU_PARTNER_LED;
    // Every co-located chara already in 诶嘿嘿 flips to 2; skip those at 0
    // (avoid pulling bystanders in during 潜伏).
    let count = 0;
    for (const slot of selectPresentCharas(next, next.master.location)) {
      if (slot.charaNum === 0) continue;
      if ((slot.state.CFLAG[CFLAG_ID.诶嘿嘿] ?? 0) === 0) continue;
      slot.state.CFLAG[CFLAG_ID.诶嘿嘿] = UFUFU_PARTNER_LED;
      count++;
    }
    // TIME += 5.
    advanceTimeTicks(next, 5);
    const who = count > 1 ? "她们" : "%CALLNAME:TARGET%";
    return {
      state: next,
      events: [
        { kind: "NARRATION" as const, timestamp: ctx.now(), text: `把主导权交给了${who}。` },
      ],
      outcome: "ok" as const,
    };
  },
};
