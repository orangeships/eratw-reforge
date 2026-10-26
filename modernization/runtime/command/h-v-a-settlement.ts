/**
 * Shared V/A settlement for the bounded H-mode routes.
 *
 * This module owns effects that are common to thrust and explicit withdrawal:
 * pain ladders, orgasm-before-CUP-flush, deflowering records, ejaculation
 * residue, and the command-local NOWEX snapshot. It never creates gameplay
 * actions; callers still decide when an insertion or an explicit ejaculation
 * is valid.
 */

import type { GameState, CharaSlot } from "../state/game-state.js";
import {
  BASE_ID,
  CFLAG_ID,
  EX_ID,
  EXP_ID,
  PALAM_ID,
  SOURCE_ID,
  TALENT_ID,
  TCVAR_ID,
} from "../state/settlement.js";
import { applySourceCheck, type SourceCheckResult } from "./source-check.js";
import { setTflagBit, TFLAG_ID } from "../state/tflag.js";
import { stainSwapInsertA, stainSwapInsertV, setStainBit, STAIN_BIT, STAIN_PART } from "../state/stain.js";
import { depositEjaculate, ejaculateAmount } from "../world/semen-residue.js";
import { dateOf } from "../world/calendar.js";
import { readCurrentTouchPose } from "../state/touch-state.js";
import { addHEjaculationBit, ejaculationSiteInfo, type HEjaculationMarkerBit } from "./h-ejaculation-semantics.js";

export type HChannel = "v" | "a";

const H_CHANNEL = {
  v: {
    pleasure: PALAM_ID.快Ｖ,
    orgasmEx: EX_ID.Ｖ絶頂,
    orgasmExp: EXP_ID.Ｖ絶頂経験,
    experience: EXP_ID.Ｖ経験,
    creampieExp: EXP_ID.膣射経験,
    site: 1 as const,
    internalPart: STAIN_PART.膣内,
  },
  a: {
    pleasure: PALAM_ID.快Ａ,
    orgasmEx: EX_ID.Ａ絶頂,
    orgasmExp: EXP_ID.Ａ絶頂経験,
    experience: EXP_ID.Ａ経験,
    creampieExp: EXP_ID.肛射経験,
    site: 2 as const,
    internalPart: STAIN_PART.腸内,
  },
} as const;

function add(record: Record<number, number>, id: number, amount: number): void {
  record[id] = (record[id] ?? 0) + amount;
}

function multiply(value: number, numerator: number, denominator: number): number {
  return Math.trunc((value * numerator) / denominator);
}

/**
 * Apply the pose-dependent SOURCE additions from
 * `TRACHECK_EQUIP_挿入継続.ERB` before SOURCE_CHECK consumes the map.
 *
 * The upstream V and A tables use different pose namespaces: V compares the
 * current pose directly with CFLAG:喜欢的体位, while A compares it with the
 * same preference minus five.  This helper stays pure so time-stop and
 * explicit ejaculation routes can deliberately omit the continuation-only
 * effects.
 */
export function applyHInsertionPoseEffects(
  source: Readonly<Record<number, number>>,
  target: CharaSlot,
  channel: HChannel,
): Record<number, number> {
  const next = { ...source };
  const pose = readCurrentTouchPose(target);
  if (pose <= 0) return next;

  if (pose === 6) {
    next[SOURCE_ID.苦痛] = (next[SOURCE_ID.苦痛] ?? 0) + 300;
  }

  const favoritePose = target.state.CFLAG[CFLAG_ID.喜欢的体位] ?? 0;
  const expectedFavoritePose = channel === "v" ? favoritePose : favoritePose - 5;
  if (pose === expectedFavoritePose) {
    next[SOURCE_ID.情愛] = (next[SOURCE_ID.情愛] ?? 0) + 100;
    next[SOURCE_ID.恭順] = (next[SOURCE_ID.恭順] ?? 0) + 50;
  }
  return next;
}

/** Apply the upstream V/A pain ladder before SOURCE converters run. */
export function applyHInsertionPain(
  source: Readonly<Record<number, number>>,
  target: CharaSlot,
  channel: HChannel,
): Record<number, number> {
  const next = { ...source };
  const experience = target.state.EXP[H_CHANNEL[channel].experience] ?? 0;
  const lubrication = target.state.PALAM[PALAM_ID.潤滑] ?? 0;

  let pain: [number, number];
  let aversion: [number, number];
  if (channel === "v") {
    if (experience < 1) {
      pain = [5, 2];
      aversion = [3, 2];
    } else if (experience < 4) {
      pain = [3, 2];
      aversion = [6, 5];
    } else if (experience < 20) {
      pain = [1, 1];
      aversion = [1, 1];
    } else if (experience < 50) {
      pain = [1, 2];
      aversion = [1, 1];
    } else if (experience < 200) {
      pain = [3, 10];
      aversion = [1, 1];
    } else {
      pain = [1, 10];
      aversion = [1, 1];
    }
    if (lubrication < 100) {
      pain = [pain[0] * 6, pain[1] * 5];
      aversion = [aversion[0] * 3, aversion[1] * 2];
    } else if (lubrication < 500) {
      pain = [pain[0] * 7, pain[1] * 10];
      aversion = [aversion[0] * 6, aversion[1] * 5];
    } else if (lubrication < 3000) {
      pain = [pain[0] * 2, pain[1] * 5];
    } else if (lubrication < 10000) {
      pain = [pain[0], pain[1] * 10];
    }
  } else {
    if (experience < 1) {
      pain = [3, 1];
      aversion = [3, 1];
    } else if (experience < 4) {
      pain = [2, 1];
      aversion = [2, 1];
    } else if (experience < 20) {
      pain = [1, 1];
      aversion = [3, 2];
    } else if (experience < 50) {
      pain = [3, 5];
      aversion = [6, 5];
    } else if (experience < 200) {
      pain = [2, 5];
      aversion = [1, 1];
    } else {
      pain = [1, 5];
      aversion = [1, 1];
    }
    if (lubrication < 100) {
      pain = [pain[0] * 6, pain[1] * 5];
      aversion = [aversion[0] * 2, aversion[1]];
    } else if (lubrication < 500) {
      aversion = [aversion[0] * 3, aversion[1] * 2];
    } else if (lubrication < 3000) {
      pain = [pain[0] * 3, pain[1] * 5];
    } else if (lubrication < 10000) {
      pain = [pain[0] * 3, pain[1] * 10];
    } else {
      pain = [pain[0], pain[1] * 5];
    }
  }

  if (next[SOURCE_ID.苦痛] !== undefined) {
    next[SOURCE_ID.苦痛] = multiply(next[SOURCE_ID.苦痛]!, pain[0], pain[1]);
  }
  if (next[SOURCE_ID.反感] !== undefined) {
    next[SOURCE_ID.反感] = multiply(next[SOURCE_ID.反感]!, aversion[0], aversion[1]);
  }
  return next;
}

function recordNowEx(state: GameState, charaNum: number, id: number, amount: number): void {
  const frame = state.turnContext?.frame;
  if (!frame) return;
  frame.nowExByChara[charaNum] ??= {};
  frame.nowExByChara[charaNum][id] = (frame.nowExByChara[charaNum][id] ?? 0) + amount;
}

/** V/A-aware SOURCE_CHECK wrapper: pain first, orgasm before CUP flush. */
export function applyHSourceCheck(
  state: GameState,
  target: number,
  source: Readonly<Record<number, number>>,
  channel: HChannel,
  favorBias = 0,
  trustSeed = 0,
): SourceCheckResult {
  const targetSlot = state.charas[target];
  if (!targetSlot) throw new Error(`applyHSourceCheck: unknown target ${target}`);
  const settledSource = applyHInsertionPain(source, targetSlot, channel);
  // ORGASM_ADD is now owned by the shared SOURCE_CHECK window. H handlers
  // only contribute their channel-specific pain ladder here; all five
  // pleasure channels are settled by the same runtime path.
  return applySourceCheck(state, target, settledSource, favorBias, trustSeed);
}

/** Record the first V/A loss and its partner on the target. */
export function recordHChannelHistory(state: GameState, target: number, channel: HChannel): string[] {
  const slot = state.charas[target];
  if (!slot) return [];
  const messages: string[] = [];
  if (channel === "v") {
    slot.state.TCVAR[TCVAR_ID.破瓜] = 1;
    const virgin = slot.state.TALENT[TALENT_ID.処女] ?? 0;
    if (virgin === 1 || virgin === 2 || virgin === -1) {
      if ((slot.state.CFLAG[CFLAG_ID.処女喪失記念日] ?? 0) === 0) {
        slot.state.CFLAG[CFLAG_ID.処女喪失記念日] = dateOf(state.time);
      }
      slot.state.TALENT[TALENT_ID.処女] = 0;
      messages.push(virgin === -1 ? "不知道什么时候已经失去了处女之身。" : "第一次插入终于夺走了处女之身。");
    }
    slot.state.CFLAG[CFLAG_ID.処女喪失対象] = (slot.state.CFLAG[CFLAG_ID.処女喪失対象] ?? 0) | 1;
    slot.state.CFLAG[CFLAG_ID.処女喪失相手] = state.master.charaNum;
  } else {
    slot.state.TCVAR[TCVAR_ID.Ａ破瓜] = 1;
    if ((slot.state.CFLAG[CFLAG_ID.尻穴処女喪失記念日] ?? 0) === 0) {
      slot.state.CFLAG[CFLAG_ID.尻穴処女喪失記念日] = dateOf(state.time);
      messages.push("第一次肛门插入留下了记录。");
    }
    slot.state.CFLAG[CFLAG_ID.アナル処女喪失対象] = (slot.state.CFLAG[CFLAG_ID.アナル処女喪失対象] ?? 0) | 1;
    slot.state.CFLAG[CFLAG_ID.アナル処女喪失相手] = state.master.charaNum;
  }
  return messages;
}

/** Finalize an explicit V/A ejaculation chosen by COMF26. */
export function settleHEjaculation(
  state: GameState,
  input: {
    sender: number;
    receiver?: number;
    channel: HChannel;
    inside: boolean;
    amount?: number;
    /** Exact upstream TCVAR ejaculation site; defaults to V/A inside or body. */
    site?: number;
    /** Protection and failed pull-out share marker bit 0, but stay distinct here. */
    condom?: boolean;
    pulloutFailed?: boolean;
    /** Source-derived TFLAG:50 combinations, applied only on a real ejaculation. */
    markerBits?: readonly HEjaculationMarkerBit[];
    /** Number of ejaculations represented by this settlement. */
    count?: number;
  },
): number {
  const sender = input.sender === 0 ? state.master : state.charas[input.sender];
  if (!sender) return 0;
  const data = H_CHANNEL[input.channel];
  const amount = Math.max(0, input.amount ?? ejaculateAmount(sender.state));
  const count = Math.max(1, Math.trunc(input.count ?? 1));
  const receiver = input.receiver === undefined
    ? undefined
    : input.receiver === 0 ? state.master : state.charas[input.receiver];
  const requestedSite = input.site ?? (input.inside ? data.site : 8);
  // Older modern code stored condom use as -1 in the site slot. Retain the
  // channel's real site when handling that legacy input, and classify the
  // condom separately in TCVAR:50.
  const site = requestedSite === -1 ? data.site : requestedSite;
  const condom = input.condom ?? requestedSite === -1;
  const inside = input.inside && !condom;

  sender.state.BASE[BASE_ID.射精] = 0;
  sender.state.BASE[BASE_ID.精力] = Math.max(0, (sender.state.BASE[BASE_ID.精力] ?? 0) - amount);
  sender.state.TCVAR[TCVAR_ID.已射精部位FLAG] = site;
  add(sender.state.EXP, EXP_ID.絶頂経験, count);
  add(sender.state.EXP, EXP_ID.射精経験, count);
  add(sender.state.EX, EX_ID.射精, count);
  recordNowEx(state, sender.charaNum, EX_ID.射精, count);
  setTflagBit(state, TFLAG_ID.一日一回, 8);

  if (receiver) {
    let outputMask = receiver.state.TCVAR[TCVAR_ID.口上出力用射精部位] ?? 0;
    const siteInfo = ejaculationSiteInfo(site);
    if (siteInfo) outputMask = addHEjaculationBit(outputMask, siteInfo.code);
    if (condom || input.pulloutFailed) outputMask = addHEjaculationBit(outputMask, 0);
    for (const bit of input.markerBits ?? []) outputMask = addHEjaculationBit(outputMask, bit);
    receiver.state.TCVAR[TCVAR_ID.口上出力用射精部位] = outputMask;
  }

  if (inside && receiver) {
    depositEjaculate(state, {
      sender: sender.charaNum,
      receiver: receiver.charaNum,
      site: data.site,
      amount,
    });
    const insideFlag = input.channel === "v" ? CFLAG_ID.膣内射精 : CFLAG_ID.肛門射精;
    receiver.state.CFLAG[insideFlag] = 1;
    if (input.channel === "v") {
      receiver.state.TCVAR[TCVAR_ID.V被中出FLAG] = 1;
      receiver.state.TCVAR[TCVAR_ID.Vに中出しした角色番号] = sender.charaNum;
    } else {
      receiver.state.TCVAR[TCVAR_ID.A被中出FLAG] = 1;
      receiver.state.TCVAR[TCVAR_ID.Aに中出しした角色番号] = sender.charaNum;
    }
    add(receiver.state.EXP, EXP_ID.射精経験, 1);
    add(receiver.state.EXP, EXP_ID.精液経験, amount * 2);
    add(receiver.state.EXP, data.creampieExp, amount * 2);
    if (amount > 0) {
      setStainBit(receiver, data.internalPart, STAIN_BIT.精液);
      setStainBit(sender, STAIN_PART.Ｐ, STAIN_BIT.精液);
    }
  } else if (!inside && !condom && receiver && amount > 0) {
    // Current shared H surface actions also settle receiver-side EXP and stain.
    // Other legacy site effects stay deferred until their action route exists.
    const receiverExp = {
      3: count + 1,
      4: count * 3,
      5: count * 3,
      6: count,
      7: count,
      8: count * 2,
    }[site];
    if (receiverExp !== undefined) add(receiver.state.EXP, EXP_ID.精液経験, receiverExp);
    const receiverStain = {
      3: STAIN_PART.手,
      4: STAIN_PART.口,
      5: STAIN_PART.Ｂ,
      6: STAIN_PART.Ｖ,
    }[site];
    if (receiverStain !== undefined) setStainBit(receiver, receiverStain, STAIN_BIT.精液);
    if (site === 3) receiver.state.CFLAG[CFLAG_ID.手上精液] = 1;
    if (site === 4) receiver.state.CFLAG[CFLAG_ID.口内精液] = 1;
    if (site === 5) receiver.state.CFLAG[CFLAG_ID.脸上精液] = 1;
    setStainBit(sender, STAIN_PART.Ｐ, STAIN_BIT.精液);
  } else if (!inside && !condom && !receiver && amount > 0) {
    setStainBit(sender, STAIN_PART.Ｐ, STAIN_BIT.精液);
  }
  return amount;
}

/** Run the existing insertion soil exchange for a repeated thrust. */
export function syncHChannelStain(target: CharaSlot, master: CharaSlot, channel: HChannel): void {
  if (channel === "v") stainSwapInsertV(target, master);
  else stainSwapInsertA(target, master);
}
