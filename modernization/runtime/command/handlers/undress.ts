/**
 * CLOTHES P1-b — USERCOM 820 脱衣服 + 821 偷胖次 (player-initiated undress).
 *
 * Upstream anchors:
 *   - `@脱衣服` (`USERCOM_服を脱がせる.ERB:155-281`) — B3 picker over
 *     {全裸, 着衣PLAY, 只穿内衣} → `@脱衣処理(TARGET, TYPE)` +
 *     `@脱衣処理(MASTER, TYPE)`. Gated on CFLAG:诶嘿嘿 (H-mode, 推倒後).
 *   - `@脱衣処理(C_ID, TYPE, OP)` (same file:9-151) — 4-CASE dispatcher:
 *     "全裸" / "くすねる" / "变成只穿内衣的样子" / "半脱".
 *   - USERCOM 821 is the simple "steal panties" command (くすねる).
 *
 * The 820 handler mirrors the upstream B3 picker faithfully:
 *   [0] 全部脱掉 → stripTop + stripBottom on both TARGET and MASTER
 *   [1] 着衣PLAY → stripPartialTop on both (gated on canHalfStrip)
 *   [2] 只穿内衣 → 脱衣処理 "变成只穿内衣的样子" (keep underwear, strip outer)
 *
 * Panty negotiation (FLAG:胖次泥棒, ASK_YN, 従順/親密 ladder, panty exchange)
 * is **deferred** — the MVP strips EQUIP directly without the interactive
 * panty-collection ceremony. The 821 handler does the simple panty-get.
 *
 * KOJO_EVENT_28 dispatch: subid 0=全裸, 1=只穿内衣, 2=半脱 (wired below).
 *   Subid 3 (panty negotiation) deferred — full ABL ladder needs subsystems
 *   not yet built (催眠強度, FLAG:胖次泥棒 menu toggle).
 *
 * TIME cost: RETURN 1 in upstream → advanceTimeTicks(next, 1).
 */

import type { GameState, CharaSlot } from "../../state/game-state.js";
import type { HandlerEntry, CommandContext } from "../types.js";
import type { KojoLine } from "../../kojo/types.js";
import type { ObservationEvent } from "../../../schemas/types.js";
import { cloneGameState } from "../../state/game-state.js";
import { resolveEventKojoAndApply } from "../../kojo/effects.js";
import {
  advanceTimeTicks,
  CFLAG_ID,
  EQUIP_SLOT,
  FLAG_ID,
  TEQUIP_ID,
  getMasterCflag,
} from "../../state/settlement.js";
import { pickOne, requirePickOne, type PromptSpec } from "../prompt.js";
import {
  stripBottom,
  stripTop,
  stripPartialTop,
  canHalfStrip,
  pantyGet,
  isNaked,
  recomputeExposure,
} from "../../state/clothing-write.js";
import { charaOutfit } from "../../state/clothing-outfits.js";
import { writeTequip } from "../../state/tequip.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function block(
  message: string,
): { ok: false; reason: { kind: "precondition"; message: string } } {
  return { ok: false, reason: { kind: "precondition", message } };
}

/** True if the chara has any underwear on (for the "只穿内衣" gate).
 *  Checks both EQUIP slots AND 固有 underwear (name-on-chara, not in EQUIP
 *  per Phase 0 S5 design — 灵夢's 前缎带胖次 is outfit.lowerUnderwear). */
function hasUnderwear(chara: CharaSlot): boolean {
  const e = chara.state.EQUIP;
  if ((chara.state.CFLAG[CFLAG_ID.NO_PANTIES_TODAY] ?? 0) !== 0) return false;
  if (
    (e[EQUIP_SLOT.上半身内衣１] ?? 0) !== 0 ||
    (e[EQUIP_SLOT.上半身内衣２] ?? 0) !== 0 ||
    (e[EQUIP_SLOT.下半身内衣１] ?? 0) !== 0 ||
    (e[EQUIP_SLOT.下半身内衣２] ?? 0) !== 0 ||
    (e[EQUIP_SLOT.レオタード] ?? 0) !== 0 ||
    (e[EQUIP_SLOT.ボディースーツ] ?? 0) !== 0
  ) {
    return true;
  }
  // Also check 固有 underwear (name-on-chara, e.g. 灵夢's 前缎带胖次)
  const outfit = charaOutfit(chara.charaNum);
  if (outfit?.lowerUnderwear || outfit?.upperUnderwear) return true;
  return false;
}

// Slot groups for direct CharaSlot stripping (mirrors clothing-write.ts).
// Used for the master (state.master, not state.charas[0]).
const BOTTOM_SLOTS_ALL = [
  EQUIP_SLOT.下半身内衣１, EQUIP_SLOT.下半身内衣２, EQUIP_SLOT.裤子,
  EQUIP_SLOT.下身衣服, EQUIP_SLOT.裙子, EQUIP_SLOT.ボディースーツ,
  EQUIP_SLOT.連衣裙, EQUIP_SLOT.和服, EQUIP_SLOT.レオタード,
];
const TOP_SLOTS_ALL = [
  EQUIP_SLOT.上半身内衣１, EQUIP_SLOT.上半身内衣２,
  EQUIP_SLOT.上身衣服１, EQUIP_SLOT.上身衣服２,
  EQUIP_SLOT.ボディースーツ, EQUIP_SLOT.連衣裙, EQUIP_SLOT.和服,
  EQUIP_SLOT.レオタード,
];

/** Dispatch EVENT_28 kojo lines for the undress outcome.
 *  subid: 0=全裸, 1=只穿内衣, 2=半脱. */
function dispatchKojo28(
  ctx: CommandContext,
  targetNum: number,
  subid: number,
  arg: number,
  state: GameState,
): ObservationEvent[] {
  if (!ctx.dialogueRouter || targetNum <= 0) return [];
  const lines = resolveEventKojoAndApply(ctx.dialogueRouter, state, targetNum, 28, ctx.rng, [subid, arg]);
  return lines.map((l: KojoLine) => ({
    kind: "DIALOGUE_LINE" as const,
    timestamp: ctx.now(),
    charaNum: targetNum,
    text: l.text,
    form: l.form,
  }));
}

/** Directly strip a CharaSlot's bottom slots (for master, not in state.charas). */
function stripCharaBottom(chara: CharaSlot): void {
  for (const slotId of BOTTOM_SLOTS_ALL) chara.state.EQUIP[slotId] = 0;
  recomputeExposure(chara);
}

/** Directly strip a CharaSlot's top slots (for master).
 *  TEQUIP:5 is target-side only; master doesn't get it (mirrors DATUI_TOP_LATE). */
function stripCharaTop(chara: CharaSlot): void {
  for (const slotId of TOP_SLOTS_ALL) chara.state.EQUIP[slotId] = 0;
  recomputeExposure(chara);
}

// ---------------------------------------------------------------------------
// USERCOM 820 — 脱衣服 (B3 picker → strip both TARGET + MASTER)
// ---------------------------------------------------------------------------

const PICK_FULL = "full";       // [0] 全部脱掉
const PICK_HALF = "half";       // [1] 着衣PLAY
const PICK_UNDERWEAR = "underwear"; // [2] 只穿内衣

function requestedTarget(state: Readonly<GameState>, target: number): CharaSlot | undefined {
  const slot = target > 0 ? state.charas[target] : undefined;
  return slot?.location === state.master.location ? slot : undefined;
}

function undress820Prompt(ctx: { state: GameState; target: number }): PromptSpec | null {
  // Quick-mode: skip the B3 picker (FLAG:脱衣選択 != 0).
  const quickMode = (ctx.state as GameState).flagStore[FLAG_ID.脱衣選択] ?? 0;
  if (quickMode !== 0) return null;

  const tSlot = requestedTarget(ctx.state, ctx.target);
  const options = [
    { id: PICK_FULL, label: "全部脱掉" },
  ];
  if (tSlot && canHalfStrip(tSlot)) {
    options.push({ id: PICK_HALF, label: "着衣PLAY" });
  }
  if (tSlot && hasUnderwear(tSlot)) {
    options.push({ id: PICK_UNDERWEAR, label: "只穿内衣" });
  }
  return pickOne("要脱到什么程度？", options);
}

function check820Eligible(
  state: Readonly<GameState>,
  actor: number,
  target: number,
): { ok: true } | { ok: false; reason: { kind: "precondition"; message: string } } {
  if (actor !== 0) return block("主人公だけが実行できます。");
  // Must be in H-mode (诶嘿嘿==2, i.e. 推倒後)
  if (getMasterCflag(state as GameState, CFLAG_ID.诶嘿嘿) !== 2) {
    return block("诶嘿嘿中ではありません。");
  }
  // Must not be in prank mode
  if (getMasterCflag(state as GameState, CFLAG_ID.恶作剧) !== 0) {
    return block("恶作剧中です。");
  }
  // Master must not already be naked
  if (isNaked(state.master)) {
    return block("既に何も着ていません。");
  }
  // Need a TARGET at the same location
  if (!requestedTarget(state, target)) {
    return block("対象がいません。");
  }
  return { ok: true };
}

export const undress820HandlerEntry: HandlerEntry = {
  commandNo: 820,
  prompt: (ctx) => undress820Prompt({ state: ctx.state as GameState, target: ctx.target }),
  execCheck: (ctx) => check820Eligible(ctx.state, ctx.actor, ctx.target),
  handler: (ctx) => {
    let next: GameState = cloneGameState(ctx.state as GameState);

    // FLAG:脱衣選択 quick-mode: skip B3 picker when set to 1 (always full)
    // or 2 (always half). Mode 0 = normal B3 picker.
    const quickMode = next.flagStore[FLAG_ID.脱衣選択] ?? 0;
    let effectivePick: string | number | null;
    if (quickMode === 1) {
      effectivePick = PICK_FULL;
    } else if (quickMode === 2) {
      effectivePick = PICK_HALF;
    } else {
      const spec = undress820Prompt({ state: next, target: ctx.target });
      const picked = requirePickOne(spec!, ctx.promptAnswer);
      if (picked === null) {
        return {
          state: next,
          events: [
            { kind: "NARRATION" as const, timestamp: ctx.now(), text: "脱衣を中断しました。" },
          ],
          outcome: "noop" as const,
        };
      }
      effectivePick = picked;
    }

    const targetNum = requestedTarget(next, ctx.target)?.charaNum ?? 0;

    // Apply stripping to both TARGET and MASTER based on effectivePick.
    // Master (charaNum 0) lives in state.master, NOT state.charas[0],
    // so we use direct CharaSlot helpers for the master side.
    if (effectivePick === PICK_FULL || effectivePick === PICK_UNDERWEAR) {
      // 全部脱掉 / 只穿内衣: full strip top + bottom for both.
      if (targetNum !== 0) {
        next = stripBottom(next, targetNum, 0);
        next = stripTop(next, targetNum, 0, "target");
      }
      stripCharaBottom(next.master);
      stripCharaTop(next.master);
    } else if (effectivePick === PICK_HALF) {
      // 着衣PLAY: half-strip (semi-nude, keep cover)
      if (targetNum !== 0) {
        next = stripPartialTop(next, targetNum);
      }
      // Master half-strip via direct CharaSlot manipulation
      if (canHalfStrip(next.master)) {
        next.master.state.EQUIP[EQUIP_SLOT.上半身内衣１] = 0;
        writeTequip(next.master, TEQUIP_ID.上半身裸露状態, 1);
        const hasPants = (next.master.state.EQUIP[EQUIP_SLOT.裤子] ?? 0) !== 0;
        if (hasPants) next.master.state.EQUIP[EQUIP_SLOT.裤子] = 0;
        recomputeExposure(next.master);
      }
    }

    // Slice 4: Panty negotiation (PICK_FULL only).
    // If target still has panties after full strip (EQUIP or 固有 underwear),
    // handle per FLAG:胖次泥棒. ABL ladder + master panty exchange deferred.
    let pantyKojoEvents: ObservationEvent[] = [];
    if (effectivePick === PICK_FULL && targetNum > 0) {
      const tSlot = next.charas[targetNum]!;
      const hasPanties =
        (tSlot.state.EQUIP[EQUIP_SLOT.下半身内衣２] ?? 0) !== 0 ||
        Boolean(charaOutfit(targetNum)?.lowerUnderwear);
      if (hasPanties && (tSlot.state.CFLAG[CFLAG_ID.NO_PANTIES_TODAY] ?? 0) === 0) {
        const pantyMode = next.flagStore[FLAG_ID.胖次泥棒] ?? 0;
        if (pantyMode === 1) {
          // Auto confiscate + KOJO subid=3 arg=0
          next = pantyGet(next, targetNum, "collect");
          pantyKojoEvents = dispatchKojo28(ctx, targetNum, 3, 0, next);
        } else if (pantyMode === 2) {
          // Only remove, no collection
          next = pantyGet(next, targetNum, "drop");
        }
        // pantyMode === 0 (ASK_YN): MVP defers interactive prompt → drop only
        else {
          next = pantyGet(next, targetNum, "drop");
        }
      }
    }

    // RETURN 1 in upstream → consumes a turn
    advanceTimeTicks(next, 1);

    // EVENT_28 kojo dispatch: map pick → subid (0=全裸, 1=只穿内衣, 2=半脱)
    const kojoSubid = effectivePick === PICK_FULL ? 0 : effectivePick === PICK_HALF ? 2 : 1;
    const kojoEvents = dispatchKojo28(ctx, targetNum, kojoSubid, 0, next);

    const tName = targetNum !== 0 ? (next.charas[targetNum]?.callName ?? `#${targetNum}`) : "相手";
    const actionLabel =
      effectivePick === PICK_FULL ? "全裸にした" :
      effectivePick === PICK_HALF ? "着衣PLAY（半脱）にした" :
      "只穿内衣にした";

    return {
      state: next,
      events: [
        {
          kind: "NARRATION" as const,
          timestamp: ctx.now(),
          text: `%CALLNAME:MASTER%は${tName}の服を脱がせ、自分も${actionLabel}。`,
        },
        ...kojoEvents,
        ...pantyKojoEvents,
      ],
      outcome: "ok" as const,
    };
  },
};

// ---------------------------------------------------------------------------
// USERCOM 821 — 偷胖次 (steal panties)
// ---------------------------------------------------------------------------

function check821Eligible(
  state: Readonly<GameState>,
  actor: number,
  targetNum: number,
): { ok: true } | { ok: false; reason: { kind: "precondition"; message: string } } {
  if (actor !== 0) return block("主人公だけが実行できます。");
  // Must be in H-mode
  if (getMasterCflag(state as GameState, CFLAG_ID.诶嘿嘿) !== 2) {
    return block("诶嘿嘿中ではありません。");
  }
  // Need a TARGET at the same location
  const target = requestedTarget(state, targetNum);
  if (!target) {
    return block("対象がいません。");
  }
  // Target must be wearing panties (check EQUIP + 固有 underwear)
  const hasPanties =
    (target.state.CFLAG[CFLAG_ID.NO_PANTIES_TODAY] ?? 0) === 0 &&
    ((target.state.EQUIP[EQUIP_SLOT.下半身内衣２] ?? 0) !== 0 ||
      Boolean(charaOutfit(target.charaNum)?.lowerUnderwear));
  if (!hasPanties) {
    return block("対象は胖次を履いていません。");
  }
  return { ok: true };
}

export const undress821HandlerEntry: HandlerEntry = {
  commandNo: 821,
  execCheck: (ctx) => check821Eligible(ctx.state, ctx.actor, ctx.target),
  handler: (ctx) => {
    const next: GameState = cloneGameState(ctx.state as GameState);

    const targetNum = requestedTarget(next, ctx.target)?.charaNum ?? 0;

    if (targetNum === 0) {
      return {
        state: next,
        events: [
          { kind: "NARRATION" as const, timestamp: ctx.now(), text: "対象がいません。" },
        ],
        outcome: "noop" as const,
      };
    }

    const stateAfter = pantyGet(next, targetNum, "collect");
    const tName = stateAfter.charas[targetNum]?.callName ?? `#${targetNum}`;

    // RETURN 1 in upstream → consumes a turn
    advanceTimeTicks(stateAfter, 1);

    return {
      state: stateAfter,
      events: [
        {
          kind: "NARRATION" as const,
          timestamp: ctx.now(),
          text: `%CALLNAME:MASTER%は${tName}の胖次をこっそり盗んだ。`,
        },
      ],
      outcome: "ok" as const,
    };
  },
};
