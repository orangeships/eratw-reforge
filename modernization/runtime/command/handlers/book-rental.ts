/**
 * COMF620 鈴奈庵 — 小鈴's book-rental library. Faithful to `COMF620 鈴奈庵.ERB`
 * (`@COM620`). A B9 pickOne over the lendable titles; picking an available book
 * borrows it (3000 円, returns any held book first — the 1-book limit), picking
 * the held book extends the loan a week. State + rules live in
 * `runtime/state/book-rental.ts`.
 *
 * DEFER (faithful, in book-rental.ts): CHARISMA chip payment, the nested
 * 「先归还当前书吗?」ASK (auto-returned), overdue auto-return (no upstream
 * writer), 紙芝居 借阅-skip quirk.
 */

import type { GameState } from "../../state/game-state.js";
import type { HandlerEntry } from "../types.js";
import { cloneGameState } from "../../state/game-state.js";
import { CFLAG_ID, FLAG_ID, advanceTimeTicks } from "../../state/settlement.js";
import { pickOne, requirePickOne, type PromptSpec } from "../prompt.js";
import {
  BOOK_NAMES,
  BOOK_RENTAL_FEE,
  BOOK_LOAN_DEADLINE,
  bookIndexes,
  isBookOut,
  heldBookIndex,
  borrowBook,
  extendLoan,
  canRent,
} from "../../state/book-rental.js";

const SHOP_LOCATION = "人間之里:鈴奈庵";
const RENTAL_TIME = 30; // TIME += 30 on a rental action.

function bookName(index: number): string {
  return BOOK_NAMES[index] ?? `书${index}`;
}

/** pickOne over lendable titles: held → 续借, out-by-others → hidden, else borrow. */
function rentalPrompt(state: GameState): PromptSpec {
  const held = heldBookIndex(state);
  const options = bookIndexes()
    .map((n) => {
      if (n === held) return { id: n, label: `《${bookName(n)}》（续借）`, detail: `${BOOK_RENTAL_FEE} 円` };
      if (isBookOut(state, n)) return null; // 外借中 — someone else has it
      return { id: n, label: `《${bookName(n)}》`, detail: `${BOOK_RENTAL_FEE} 円` };
    })
    .filter((o): o is { id: number; label: string; detail: string } => o !== null);
  return pickOne("鈴奈庵：借哪本书？", options);
}

function checkEligible(
  state: GameState,
): { ok: true } | { ok: false; reason: { kind: "precondition"; message: string } } {
  if ((state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "时间停止中。" } };
  }
  if (state.master.location !== SHOP_LOCATION) {
    return { ok: false, reason: { kind: "precondition", message: "不在鈴奈庵。" } };
  }
  if ((state.master.state.CFLAG[CFLAG_ID.睡眠] ?? 0) !== 0) {
    return { ok: false, reason: { kind: "precondition", message: "睡眠中。" } };
  }
  return { ok: true };
}

export const bookRental620HandlerEntry: HandlerEntry = {
  commandNo: 620,
  prompt: (ctx) => rentalPrompt(ctx.state),
  execCheck: (ctx) => {
    const r = checkEligible(ctx.state);
    return r.ok ? { ok: true } : { ok: false, reason: r.reason };
  },
  handler: (ctx) => {
    const next: GameState = cloneGameState(ctx.state);
    const picked = requirePickOne(rentalPrompt(next), ctx.promptAnswer);

    // [0] 放弃 — bare RETURN -1, no TIME.
    if (picked == null) {
      return {
        state: next,
        events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text: "离开了鈴奈庵。" }],
        outcome: "noop" as const,
      };
    }
    const index = picked as number;
    const held = heldBookIndex(next);

    // Re-picking the held book → extend the loan a week.
    if (index === held) {
      if ((next.flagStore[FLAG_ID.借书返还期限] ?? 0) === BOOK_LOAN_DEADLINE) {
        return {
          state: next,
          events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text: "「您不是正在借着吗？」" }],
          outcome: "noop" as const,
        };
      }
      if (!canRent(next)) {
        return {
          state: next,
          events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text: "钱不够…" }],
          outcome: "noop" as const,
        };
      }
      extendLoan(next);
      advanceTimeTicks(next, RENTAL_TIME);
      return {
        state: next,
        events: [
          { kind: "NARRATION" as const, timestamp: ctx.now(), text: `将《${bookName(index)}》的借阅期限延长了一周。` },
        ],
        outcome: "ok" as const,
      };
    }

    // Borrowing an available book (returns any currently-held book first).
    if (!canRent(next)) {
      return {
        state: next,
        events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text: "钱不够…" }],
        outcome: "noop" as const,
      };
    }
    const returned = held !== null ? bookName(held) : null;
    borrowBook(next, index);
    advanceTimeTicks(next, RENTAL_TIME);
    const prefix = returned ? `归还了《${returned}》，` : "";
    return {
      state: next,
      events: [
        { kind: "NARRATION" as const, timestamp: ctx.now(), text: `${prefix}借走了《${bookName(index)}》。还书期限是一周。` },
      ],
      outcome: "ok" as const,
    };
  },
};
