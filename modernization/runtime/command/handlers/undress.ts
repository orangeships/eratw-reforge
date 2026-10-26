/**
 * USERCOM 820/821 clothing actions.
 *
 * 820 is the upstream B3 undress picker.  Its full-strip branch performs the
 * panty decision before the clothing reset, so a stolen item can enter
 * PANTS_TEMP (and optionally the collection gap) instead of disappearing.
 * 821 is the direct panty-theft action used during time-stop and H play.
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
import {
  hasPantyGapCharge,
  getPantsTemp,
  pantyPieceName,
  transferPantsToGap,
} from "../../state/panty-collection.js";

function block(message: string): {
  ok: false;
  reason: { kind: "precondition"; message: string };
} {
  return { ok: false, reason: { kind: "precondition", message } };
}

function requestedTarget(state: Readonly<GameState>, target: number): CharaSlot | undefined {
  const slot = target > 0 ? state.charas[target] : undefined;
  return slot?.location === state.master.location ? slot : undefined;
}

function targetHasPanties(state: Readonly<GameState>, targetNum: number): boolean {
  const target = state.charas[targetNum];
  if (!target || (target.state.CFLAG[CFLAG_ID.没穿内裤] ?? 0) !== 0) return false;
  return Boolean(
    (target.state.EQUIP[EQUIP_SLOT.下半身内衣２] ?? 0) !== 0 ||
      charaOutfit(targetNum)?.lowerUnderwear,
  );
}

function targetName(state: Readonly<GameState>, targetNum: number): string {
  return state.charas[targetNum]?.callName ?? `#${targetNum}`;
}

function hasUnderwear(chara: CharaSlot): boolean {
  if ((chara.state.CFLAG[CFLAG_ID.没穿内裤] ?? 0) !== 0) return false;
  const e = chara.state.EQUIP;
  return Boolean(
    (e[EQUIP_SLOT.上半身内衣１] ?? 0) !== 0 ||
      (e[EQUIP_SLOT.上半身内衣２] ?? 0) !== 0 ||
      (e[EQUIP_SLOT.下半身内衣１] ?? 0) !== 0 ||
      (e[EQUIP_SLOT.下半身内衣２] ?? 0) !== 0 ||
      (e[EQUIP_SLOT.レオタード] ?? 0) !== 0 ||
      (e[EQUIP_SLOT.ボディースーツ] ?? 0) !== 0 ||
      charaOutfit(chara.charaNum)?.lowerUnderwear ||
      charaOutfit(chara.charaNum)?.upperUnderwear,
  );
}

const BOTTOM_SLOTS_ALL = [
  EQUIP_SLOT.下半身内衣１,
  EQUIP_SLOT.下半身内衣２,
  EQUIP_SLOT.裤子,
  EQUIP_SLOT.下身衣服,
  EQUIP_SLOT.裙子,
  EQUIP_SLOT.ボディースーツ,
  EQUIP_SLOT.連衣裙,
  EQUIP_SLOT.和服,
  EQUIP_SLOT.レオタード,
];
const TOP_SLOTS_ALL = [
  EQUIP_SLOT.上半身内衣１,
  EQUIP_SLOT.上半身内衣２,
  EQUIP_SLOT.上身衣服１,
  EQUIP_SLOT.上身衣服２,
  EQUIP_SLOT.ボディースーツ,
  EQUIP_SLOT.連衣裙,
  EQUIP_SLOT.和服,
  EQUIP_SLOT.レオタード,
];
const BOTTOM_SLOTS_OUTER_ONLY = [
  EQUIP_SLOT.裤子,
  EQUIP_SLOT.下身衣服,
  EQUIP_SLOT.裙子,
  EQUIP_SLOT.ボディースーツ,
  EQUIP_SLOT.連衣裙,
  EQUIP_SLOT.和服,
  EQUIP_SLOT.レオタード,
];
const TOP_SLOTS_OUTER_ONLY = [
  EQUIP_SLOT.上身衣服１,
  EQUIP_SLOT.上身衣服２,
  EQUIP_SLOT.ボディースーツ,
  EQUIP_SLOT.連衣裙,
  EQUIP_SLOT.和服,
  EQUIP_SLOT.レオタード,
];

function stripCharaBottom(chara: CharaSlot): void {
  for (const slotId of BOTTOM_SLOTS_ALL) chara.state.EQUIP[slotId] = 0;
  recomputeExposure(chara);
}

function stripCharaTop(chara: CharaSlot): void {
  for (const slotId of TOP_SLOTS_ALL) chara.state.EQUIP[slotId] = 0;
  recomputeExposure(chara);
}

function stripCharaToUnderwear(chara: CharaSlot): void {
  for (const slotId of BOTTOM_SLOTS_OUTER_ONLY) chara.state.EQUIP[slotId] = 0;
  for (const slotId of TOP_SLOTS_OUTER_ONLY) chara.state.EQUIP[slotId] = 0;
  recomputeExposure(chara);
}

function dispatchKojo28(
  ctx: CommandContext,
  targetNum: number,
  subid: number,
  arg: number,
  state: GameState,
): ObservationEvent[] {
  if (!ctx.dialogueRouter || targetNum <= 0) return [];
  const lines = resolveEventKojoAndApply(ctx.dialogueRouter, state, targetNum, 28, ctx.rng, [subid, arg]);
  return lines.map((line: KojoLine) => ({
    kind: "DIALOGUE_LINE" as const,
    timestamp: ctx.now(),
    charaNum: targetNum,
    text: line.text,
    form: line.form,
  }));
}

const PICK_FULL = "full";
const PICK_HALF = "half";
const PICK_UNDERWEAR = "underwear";
const PANTY_STEAL = "panty-steal";
const PANTY_DROP = "panty-drop";
const PANTY_GAP = "panty-gap";
const PANTY_CARRY = "panty-carry";

function undress820Prompt(ctx: {
  state: GameState;
  target: number;
  promptAnswer?: CommandContext["promptAnswer"];
}): PromptSpec | null {
  const quickMode = ctx.state.flagStore[FLAG_ID.脱衣選択] ?? 0;
  const selections = ctx.promptAnswer?.kind === "pick_sequence" ? ctx.promptAnswer.values : [];
  const tSlot = requestedTarget(ctx.state, ctx.target);
  const first = typeof selections[0] === "string" ? selections[0] : undefined;

  if (quickMode === 0 && first === undefined) {
    const options = [{ id: PICK_FULL, label: "全部脱掉" }];
    if (tSlot && canHalfStrip(tSlot)) options.push({ id: PICK_HALF, label: "着衣PLAY" });
    if (tSlot && hasUnderwear(tSlot)) options.push({ id: PICK_UNDERWEAR, label: "只穿内衣" });
    return pickOne("要脱到什么程度？", options);
  }

  const effectivePick = quickMode === 1 ? PICK_FULL : quickMode === 2 ? PICK_HALF : first;
  if (effectivePick !== PICK_FULL || !tSlot || !targetHasPanties(ctx.state, tSlot.charaNum)) return null;

  const pantyMode = ctx.state.flagStore[FLAG_ID.胖次泥棒] ?? 0;
  const pantyAction = typeof selections[1] === "string" ? selections[1] : undefined;
  if (pantyMode === 0 && pantyAction === undefined) {
    return pickOne("该怎么做呢？", [
      { id: PANTY_STEAL, label: "没收" },
      { id: PANTY_DROP, label: "只是脱下" },
    ]);
  }
  const stealing = pantyMode === 1 || (pantyMode === 0 && pantyAction === PANTY_STEAL);
  if (!stealing || !hasPantyGapCharge(ctx.state)) return null;
  if ((ctx.state.flagStore[FLAG_ID.C隙間自動仕様] ?? 0) !== 0) return null;
  if ((ctx.state.flagStore[FLAG_ID.胖次輸送] ?? 0) !== 0) return null;
  if (selections[2] === undefined) {
    return pickOne("要使用收藏隙间吗？", [
      { id: PANTY_GAP, label: "放入收藏隙间" },
      { id: PANTY_CARRY, label: "随身携带" },
    ]);
  }
  return null;
}

function check820Eligible(
  state: Readonly<GameState>,
  actor: number,
  target: number,
): { ok: true } | { ok: false; reason: { kind: "precondition"; message: string } } {
  if (actor !== 0) return block("主角才能执行。" );
  if (getMasterCflag(state as GameState, CFLAG_ID.诶嘿嘿) === 0) return block("诶嘿嘿中才可以执行。" );
  if (getMasterCflag(state as GameState, CFLAG_ID.恶作剧) !== 0) return block("恶作剧中不能执行。" );
  if (isNaked(state.master)) return block("已经什么也没穿了。" );
  if (!requestedTarget(state, target)) return block("对象不在这里。" );
  return { ok: true };
}

export const undress820HandlerEntry: HandlerEntry = {
  commandNo: 820,
  gateStatus: "complete",
  gateDiagnostics: ["H mode", "same-room target", "master not naked"],
  stagedPrompt: true,
  prompt: (ctx) => undress820Prompt({
    state: ctx.state as GameState,
    target: ctx.target,
    promptAnswer: ctx.promptAnswer,
  }),
  execCheck: (ctx) => check820Eligible(ctx.state, ctx.actor, ctx.target),
  handler: (ctx) => {
    let next = cloneGameState(ctx.state as GameState);
    const quickMode = next.flagStore[FLAG_ID.脱衣選択] ?? 0;
    const selections = ctx.promptAnswer?.kind === "pick_sequence" ? ctx.promptAnswer.values : [];
    let effectivePick: string | null;
    if (quickMode === 1) effectivePick = PICK_FULL;
    else if (quickMode === 2) effectivePick = PICK_HALF;
    else if (typeof selections[0] === "string") effectivePick = selections[0];
    else {
      const spec = undress820Prompt({ state: next, target: ctx.target, promptAnswer: ctx.promptAnswer });
      const picked = spec ? requirePickOne(spec, ctx.promptAnswer) : null;
      effectivePick = typeof picked === "string" ? picked : null;
    }
    if (![PICK_FULL, PICK_HALF, PICK_UNDERWEAR].includes(effectivePick ?? "")) {
      return {
        state: next,
        events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text: "中断了脱衣。" }],
        outcome: "noop" as const,
      };
    }

    const targetNum = requestedTarget(next, ctx.target)?.charaNum ?? 0;
    const hadPanties = effectivePick === PICK_FULL && targetNum > 0 && targetHasPanties(next, targetNum);
    const pantyPieceId = hadPanties
      ? next.charas[targetNum]!.state.EQUIP[EQUIP_SLOT.下半身内衣２] ?? 0
      : 0;
    let pantyKojoEvents: ObservationEvent[] = [];
    let pantyStorageEvent: ObservationEvent | null = null;
    if (hadPanties) {
      const pantyMode = next.flagStore[FLAG_ID.胖次泥棒] ?? 0;
      const selectedAction = typeof selections[1] === "string" ? selections[1] : undefined;
      const steal = pantyMode === 1 || (pantyMode === 0 && selectedAction === PANTY_STEAL);
      if (steal) {
        next = pantyGet(next, targetNum, "stolen");
        const gapSelected =
          (next.flagStore[FLAG_ID.C隙間自動仕様] ?? 0) !== 0 || selections[2] === PANTY_GAP;
        let transferred = 0;
        if (gapSelected && getPantsTemp(next, targetNum, pantyPieceId) > 0) {
          transferred = transferPantsToGap(next, targetNum, pantyPieceId);
        }
        const pantyName = pantyPieceName(next, targetNum, pantyPieceId);
        const atHome = Boolean(
          (next.homeLocation ?? next.master.homeLocation) &&
            next.master.location === (next.homeLocation ?? next.master.homeLocation),
        );
        if (transferred > 0) {
          pantyStorageEvent = {
            kind: "NARRATION",
            timestamp: ctx.now(),
            charaNum: targetNum,
            text: atHome
              ? `将${targetName(next, targetNum)}的${pantyName}添加到收藏中。`
              : `%CALLNAME:MASTER%打开了收藏隙间，把${targetName(next, targetNum)}的${pantyName}放了进去。`,
          };
        } else {
          pantyStorageEvent = {
            kind: "NARRATION",
            timestamp: ctx.now(),
            charaNum: targetNum,
            text: `将${targetName(next, targetNum)}的${pantyName}放入了随身携带物。`,
          };
        }
        pantyKojoEvents = dispatchKojo28(ctx, targetNum, 3, 0, next);
      } else {
        // The upstream “只是脱下” branch removes the piece without storage.
        next = pantyGet(next, targetNum, "drop");
      }
    }

    if (effectivePick === PICK_FULL) {
      if (targetNum !== 0) {
        next = stripBottom(next, targetNum, 0);
        next = stripTop(next, targetNum, 0, "target");
      }
      stripCharaBottom(next.master);
      stripCharaTop(next.master);
    } else if (effectivePick === PICK_UNDERWEAR) {
      if (targetNum !== 0) stripCharaToUnderwear(next.charas[targetNum]!);
      stripCharaToUnderwear(next.master);
    } else {
      if (targetNum !== 0) next = stripPartialTop(next, targetNum);
      if (canHalfStrip(next.master)) {
        next.master.state.EQUIP[EQUIP_SLOT.上半身内衣１] = 0;
        writeTequip(next.master, TEQUIP_ID.上半身裸露状態, 1);
        if ((next.master.state.EQUIP[EQUIP_SLOT.裤子] ?? 0) !== 0) {
          next.master.state.EQUIP[EQUIP_SLOT.裤子] = 0;
        }
        recomputeExposure(next.master);
      }
    }

    advanceTimeTicks(next, 1);
    const kojoSubid = effectivePick === PICK_FULL ? 0 : effectivePick === PICK_HALF ? 2 : 1;
    const kojoEvents = dispatchKojo28(ctx, targetNum, kojoSubid, 0, next);
    const tName = targetNum > 0 ? next.charas[targetNum]?.callName ?? `#${targetNum}` : "对方";
    const actionLabel = effectivePick === PICK_FULL
      ? "全裸"
      : effectivePick === PICK_HALF
        ? "着衣PLAY（半脱）"
        : "只穿内衣";
    return {
      state: next,
      events: [
        {
          kind: "NARRATION" as const,
          timestamp: ctx.now(),
          text: `%CALLNAME:MASTER%脱下了${tName}的衣服，自己也变成${actionLabel}。`,
        },
        ...pantyKojoEvents,
        ...(pantyStorageEvent ? [pantyStorageEvent] : []),
        ...kojoEvents,
      ],
      outcome: "ok" as const,
    };
  },
};

function check821Eligible(
  state: Readonly<GameState>,
  actor: number,
  targetNum: number,
): { ok: true } | { ok: false; reason: { kind: "precondition"; message: string } } {
  if (actor !== 0) return block("主角才能执行。" );
  const stopped = (state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0;
  const hMode = getMasterCflag(state as GameState, CFLAG_ID.诶嘿嘿) !== 0;
  if (!stopped && !hMode) return block("诶嘿嘿中或时间停止中才可以执行。" );
  const target = requestedTarget(state, targetNum);
  if (!target) return block("对象不在这里。" );
  if (stopped && (target.state.CFLAG[CFLAG_ID.時間停止行動] ?? 0) !== 0) {
    return block("这个对象已经察觉到时间停止中的行动。" );
  }
  if (!targetHasPanties(state, target.charaNum)) return block("对象没有穿内裤。" );
  return { ok: true };
}

function undress821Prompt(ctx: CommandContext): PromptSpec | null {
  if (!targetHasPanties(ctx.state, ctx.target)) return null;
  if ((ctx.state.flagStore[FLAG_ID.C隙間自動仕様] ?? 0) !== 0) return null;
  if (!hasPantyGapCharge(ctx.state)) return null;
  if ((ctx.state.flagStore[FLAG_ID.胖次輸送] ?? 0) !== 0) return null;
  if (ctx.promptAnswer?.kind === "pick_sequence" && ctx.promptAnswer.values.length > 0) return null;
  return pickOne("要使用收藏隙间吗？", [
    { id: PANTY_GAP, label: "放入收藏隙间" },
    { id: PANTY_CARRY, label: "随身携带" },
  ]);
}

export const undress821HandlerEntry: HandlerEntry = {
  commandNo: 821,
  gateStatus: "complete",
  gateDiagnostics: ["H mode or time-stop", "same-room target", "target wearing panties"],
  stagedPrompt: true,
  prompt: undress821Prompt,
  execCheck: (ctx) => check821Eligible(ctx.state, ctx.actor, ctx.target),
  handler: (ctx) => {
    const next = cloneGameState(ctx.state as GameState);
    const targetNum = requestedTarget(next, ctx.target)?.charaNum ?? 0;
    if (targetNum === 0) {
      return {
        state: next,
        events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text: "没有目标。" }],
        outcome: "noop" as const,
      };
    }
    const pieceId = next.charas[targetNum]!.state.EQUIP[EQUIP_SLOT.下半身内衣２] ?? 0;
    const stateAfter = pantyGet(next, targetNum, "stolen");
    const selections = ctx.promptAnswer?.kind === "pick_sequence" ? ctx.promptAnswer.values : [];
    const useGap =
      (stateAfter.flagStore[FLAG_ID.C隙間自動仕様] ?? 0) !== 0 || selections[0] === PANTY_GAP;
    let transferred = 0;
    if (useGap && getPantsTemp(stateAfter, targetNum, pieceId) > 0) {
      transferred = transferPantsToGap(stateAfter, targetNum, pieceId);
    }
    advanceTimeTicks(stateAfter, 1);
    const tName = stateAfter.charas[targetNum]?.callName ?? `#${targetNum}`;
    const pantyName = pantyPieceName(stateAfter, targetNum, pieceId);
    const atHome = Boolean(
      (stateAfter.homeLocation ?? stateAfter.master.homeLocation) &&
        stateAfter.master.location === (stateAfter.homeLocation ?? stateAfter.master.homeLocation),
    );
    return {
      state: stateAfter,
      events: [
        {
          kind: "NARRATION" as const,
          timestamp: ctx.now(),
          text: `%CALLNAME:MASTER%偷走了${tName}穿着的内裤。`,
        },
        {
          kind: "NARRATION" as const,
          timestamp: ctx.now(),
          charaNum: targetNum,
          text: transferred > 0
            ? (atHome
              ? `将${tName}的${pantyName}添加到收藏中。`
              : `%CALLNAME:MASTER%打开了收藏隙间，把${tName}的${pantyName}放了进去。`)
            : `将${tName}的${pantyName}放入了随身携带物。`,
        },
      ],
      outcome: "ok" as const,
    };
  },
};
