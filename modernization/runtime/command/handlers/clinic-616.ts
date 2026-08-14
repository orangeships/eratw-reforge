/**
 * COMF616 診察を受ける — Eientei clinic service.
 *
 * Faithful playable arms from `COMF616 診察を受ける.ERB`:
 *  - [0] fatigue treatment: `REMEDY(RAND:3)`, 3000 yen, TIME +30.
 *  - [1] mental treatment: `REMEDY(RAND:2+3+永琳 talent bonus)`, 3000 yen,
 *    TIME +30.
 *  - no-money treatment branch: after the remedy, `BASE:体力 -= 100`,
 *    `BASE:気力 -= 200`, `TIME += 180`, `TFLAG:成功分岐 = 1`, then the normal
 *    `TIME += 30` tail.
 *  - [3] clinic/training-tool shop, flattened into one B9 pickOne over the
 *    original `ITEMDATA SHOP:診察` item ids.
 *  - [4] 清掃中毒 cure: first cure free, subsequent cures cost
 *    `FLAG:850 * 10000`, then clears `TALENT:清掃中毒`.
 *
 * Deferred by design: [6] the rare male-erection Eirin H branch. It depends on
 * full H settlement / COM81-style source handling and is documented in the map
 * TODO instead of being replaced by a fake shortcut.
 */

import type { CommandContext, HandlerEntry } from "../types.js";
import { cloneGameState, type CharaSlot } from "../../state/game-state.js";
import { addItem, itemCount } from "../../state/items.js";
import { canAfford, pay } from "../../state/money.js";
import {
  BASE_ID,
  CFLAG_ID,
  FLAG_ID,
  TALENT_ID,
  advanceTimeTicks,
  recoverBase,
} from "../../state/settlement.js";
import { pickOne, requirePickOne, type PromptOption, type PromptSpec } from "../prompt.js";
import { TFLAG_ID, getTflag, setTflag, setTflagBit } from "../../state/tflag.js";

const CLINIC_LOCATION = "永遠亭:診察室";
const EIRIN = 72;
const TREATMENT_COST = 3000;
const ONCE_PER_DAY_BIT = 1 << 3;
const CLEANING_CURE_COUNT_FLAG = 850;
const SHOP_ID_OFFSET = 1000;

const CLINIC_SHOP_ITEMS: ReadonlyArray<{ id: number; name: string; price: number }> = [
  { id: 0, name: "跳蛋", price: 3000 },
  { id: 1, name: "電動按摩棒", price: 9000 },
  { id: 2, name: "陰蒂夾", price: 3000 },
  { id: 3, name: "飛機杯", price: 12000 },
  { id: 4, name: "振動棒", price: 4500 },
  { id: 5, name: "肛用振動棒", price: 4500 },
  { id: 10, name: "乳頭夾", price: 3000 },
  { id: 11, name: "搾乳器", price: 4500 },
  { id: 12, name: "穿戴式假陰茎", price: 20000 },
  { id: 15, name: "眼罩", price: 15000 },
  { id: 16, name: "縄", price: 15000 },
  { id: 20, name: "塑料地墊", price: 6000 },
  { id: 23, name: "圍裙", price: 15000 },
  { id: 27, name: "【捕縛技能】", price: 30000 },
];

function hasOncePerDay(state: Readonly<import("../../state/game-state.js").GameState>): boolean {
  return (getTflag(state, TFLAG_ID.一日一回) & ONCE_PER_DAY_BIT) !== 0;
}

function setOncePerDay(state: import("../../state/game-state.js").GameState): void {
  setTflagBit(state, TFLAG_ID.一日一回, 3);
}

function check616(ctx: CommandContext): { ok: true } | {
  ok: false;
  reason: { kind: "precondition"; message: string };
} {
  const state = ctx.state;
  if ((state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "時間停止中は診察を受けられない。" } };
  }
  if (state.master.location !== CLINIC_LOCATION) {
    return { ok: false, reason: { kind: "precondition", message: "診察室にいない。" } };
  }
  if ((state.master.state.CFLAG[CFLAG_ID.睡眠] ?? 0) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "睡眠中は診察を受けられない。" } };
  }
  if ((state.master.state.CFLAG[CFLAG_ID.约会中] ?? 0) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "約会中は診察を受けられない。" } };
  }
  if (hasOncePerDay(state)) {
    return { ok: false, reason: { kind: "precondition", message: "今日はもう診察を受けた。" } };
  }
  const eirin = state.charas[EIRIN];
  if (!eirin || eirin.location !== state.master.location) {
    return { ok: false, reason: { kind: "precondition", message: "永琳が診察室にいない。" } };
  }
  return { ok: true };
}

function buildPrompt(ctx: CommandContext): PromptSpec {
  const options: PromptOption[] = [
    { id: 0, label: "体力を診てもらう", detail: `${TREATMENT_COST} 円` },
    { id: 1, label: "気力を診てもらう", detail: `${TREATMENT_COST} 円` },
  ];

  for (const item of CLINIC_SHOP_ITEMS) {
    if (itemCount(ctx.state, item.id) > 0) continue;
    options.push({
      id: SHOP_ID_OFFSET + item.id,
      label: `購入：${item.name}`,
      detail: `${item.price} 円`,
      disabled: !canAfford(ctx.state, item.price),
    });
  }

  if ((ctx.state.master.state.TALENT[TALENT_ID.清掃中毒] ?? 0) !== 0) {
    const count = ctx.state.flagStore[CLEANING_CURE_COUNT_FLAG] ?? 0;
    const price = count === 0 ? 0 : count * 10000;
    options.push({
      id: 4,
      label: "清掃中毒を治療する",
      detail: price === 0 ? "初回無料" : `${price} 円`,
      disabled: price > 0 && !canAfford(ctx.state, price),
    });
  }

  options.push({ id: 100, label: "やめる" });
  return pickOne("永琳の診察を受ける。", options);
}

function clampRecover(slot: CharaSlot, statId: number, amount: number): void {
  recoverBase(slot, statId, amount);
}

function setFull(slot: CharaSlot, statId: number): void {
  const max = slot.state.MAXBASE[statId] ?? 0;
  if (max > 0) slot.state.BASE[statId] = max;
}

function remedy(slot: CharaSlot, variant: number): void {
  switch (variant) {
    case 0:
      clampRecover(slot, BASE_ID.体力, 500);
      break;
    case 1:
      clampRecover(slot, BASE_ID.体力, 750);
      break;
    case 2:
      setFull(slot, BASE_ID.体力);
      break;
    case 3:
      clampRecover(slot, BASE_ID.気力, 500);
      break;
    case 4:
      clampRecover(slot, BASE_ID.気力, 750);
      break;
    case 5:
      clampRecover(slot, BASE_ID.気力, 900);
      break;
    default:
      clampRecover(slot, BASE_ID.気力, 1000);
      break;
  }
}

function applyTreatmentCost(next: ReturnType<typeof cloneGameState>): void {
  if (canAfford(next, TREATMENT_COST)) {
    pay(next, TREATMENT_COST);
    return;
  }
  next.master.state.BASE[BASE_ID.体力] = (next.master.state.BASE[BASE_ID.体力] ?? 0) - 100;
  next.master.state.BASE[BASE_ID.気力] = (next.master.state.BASE[BASE_ID.気力] ?? 0) - 200;
  advanceTimeTicks(next, 180);
  setTflag(next, TFLAG_ID.SELECTCOM的分岐, 1);
}

function finishClinicVisit(next: ReturnType<typeof cloneGameState>): void {
  setOncePerDay(next);
  advanceTimeTicks(next, 30);
}

export const clinic616HandlerEntry: HandlerEntry = {
  commandNo: 616,
  execCheck: check616,
  prompt: buildPrompt,
  handler: (ctx) => {
    const spec = buildPrompt(ctx);
    const picked = requirePickOne(spec, ctx.promptAnswer);
    if (picked === null) {
      return {
        state: cloneGameState(ctx.state),
        events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text: "診察内容をまだ選んでいない。" }],
        outcome: "blocked" as const,
      };
    }

    const next = cloneGameState(ctx.state);
    if (picked === 100) {
      return {
        state: next,
        events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text: "診察を受けずに戻った。" }],
        outcome: "noop" as const,
      };
    }

    if (picked === 0 || picked === 1) {
      if (picked === 0) {
        remedy(next.master, ctx.rng.int(3));
      } else {
        const eirin = next.charas[EIRIN];
        const talentBonus =
          (eirin?.state.TALENT[TALENT_ID.恋慕] ? 2 : 0) +
          (eirin?.state.TALENT[TALENT_ID.思慕] ? 1 : 0);
        remedy(next.master, ctx.rng.int(2) + 3 + talentBonus);
      }
      applyTreatmentCost(next);
      finishClinicVisit(next);
      return {
        state: next,
        events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text: "永琳の診察を受けた。" }],
        outcome: "ok" as const,
      };
    }

    if (picked === 4) {
      const count = next.flagStore[CLEANING_CURE_COUNT_FLAG] ?? 0;
      const price = count === 0 ? 0 : count * 10000;
      let cured = false;
      if (price === 0 || canAfford(next, price)) {
        pay(next, price);
        next.master.state.TALENT[TALENT_ID.清掃中毒] = 0;
        next.flagStore[CLEANING_CURE_COUNT_FLAG] = count + 1;
        cured = true;
      }
      finishClinicVisit(next);
      return {
        state: next,
        events: [{
          kind: "NARRATION" as const,
          timestamp: ctx.now(),
          text: cured ? "清掃中毒の治療を受けた。" : "治療費が足りなかった。",
        }],
        outcome: cured ? "ok" as const : "noop" as const,
      };
    }

    if (typeof picked === "number" && picked >= SHOP_ID_OFFSET) {
      const itemId = picked - SHOP_ID_OFFSET;
      const item = CLINIC_SHOP_ITEMS.find((i) => i.id === itemId);
      if (!item || itemCount(next, item.id) > 0 || !canAfford(next, item.price)) {
        return {
          state: next,
          events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text: "購入できなかった。" }],
          outcome: "noop" as const,
        };
      }
      pay(next, item.price);
      addItem(next, item.id, 1);
      finishClinicVisit(next);
      return {
        state: next,
        events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text: `${item.name}を購入した。` }],
        outcome: "ok" as const,
      };
    }

    return {
      state: next,
      events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text: "診察内容を選び直した。" }],
      outcome: "blocked" as const,
    };
  },
};
