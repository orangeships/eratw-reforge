/**
 * 鈴奈庵 book rental (`COMF620 鈴奈庵.ERB`). 小鈴's lending library.
 *
 * Books are item ids `100 + N` for N = 1..10 (`BookTitles`, Item.csv 101-110:
 * 戦術指南書/調理指南書/字典/御伽草子/演奏指南書/紙芝居/百鱼图鑑/採集指南/
 * 薬学教本/伐木心得). Rental is 3000 円 (cash) per book. State:
 *   - `FLAG:借书借出` (1011) — bitmask of which titles are checked out (bit N).
 *   - `ITEM:(100+N)` — the master currently holds book N.
 *   - `FLAG:借书返还期限` (1012) — the held book's deadline (8 = just borrowed).
 *
 * Faithful mechanic (`@COM620`): only ONE book at a time — borrowing a new one
 * returns the currently-held one first (upstream ASK_YN; the modern single-shot
 * B9 picker auto-returns, note deferred). Re-picking the held book extends the
 * loan (pay again, deadline→8). TFLAG:成功分岐(193)=1 on a fresh borrow.
 *
 * **Faithful DEFER:** no auto-decrement / overdue auto-return (base game has no
 * writer for `借书返还期限` — the loan holds until you borrow another); the
 * CHARISMA chip-payment mode (魔界 currency); the nested「先归还当前书吗?」ASK
 * (auto-returned here); 紙芝居 (index 6) 借阅-skip quirk in `@BOOKLEND`.
 */

import type { GameState } from "./game-state.js";
import { FLAG_ID } from "./settlement.js";
import { itemCount, addItem, removeItem } from "./items.js";
import { canAfford, pay } from "./money.js";
import { TFLAG_ID, setTflag } from "./tflag.js";

export const BOOK_RENTAL_FEE = 3000;
/** 借书返还期限 initial value on borrow (8 → PRINT_STATE2 shows「-2 日后」). */
export const BOOK_LOAN_DEADLINE = 8;
/** `BookTitles` — 10 lendable titles (item 101..110). */
export const BOOK_TITLES = 10;

/** Book title display names, index 1..10 (Item.csv 101-110). */
export const BOOK_NAMES: Readonly<Record<number, string>> = {
  1: "戦術指南書",
  2: "調理指南書",
  3: "字典",
  4: "御伽草子",
  5: "演奏指南書",
  6: "紙芝居",
  7: "百鱼图鑑",
  8: "採集指南",
  9: "薬学教本",
  10: "伐木心得",
};

/** Item id of book title N (1-based). */
export function bookItemId(index: number): number {
  return 100 + index;
}

/** All lendable book indexes (1..BookTitles). */
export function bookIndexes(): number[] {
  return Array.from({ length: BOOK_TITLES }, (_, i) => i + 1);
}

/** Is title N checked out (by anyone) — `GETBIT(FLAG:借书借出, N)`. */
export function isBookOut(state: GameState, index: number): boolean {
  const bits = state.flagStore[FLAG_ID.借书借出] ?? 0;
  return (bits & (1 << index)) !== 0;
}

/** The title index the master currently holds (`ITEM:(100+N) > 0`), or null. */
export function heldBookIndex(state: GameState): number | null {
  for (const n of bookIndexes()) {
    if (itemCount(state, bookItemId(n)) > 0) return n;
  }
  return null;
}

function setBookBit(state: GameState, index: number, on: boolean): void {
  const bits = state.flagStore[FLAG_ID.借书借出] ?? 0;
  state.flagStore[FLAG_ID.借书借出] = on ? bits | (1 << index) : bits & ~(1 << index);
}

/** Return the master's currently-held book (`ITEM=0` + CLEARBIT). No-op if none. */
export function returnHeldBook(state: GameState): void {
  const held = heldBookIndex(state);
  if (held === null) return;
  removeItem(state, bookItemId(held), itemCount(state, bookItemId(held)));
  setBookBit(state, held, false);
}

/**
 * Borrow title N: returns any currently-held book first, pays the fee, grants
 * the book, sets the checkout bit + deadline, and TFLAG:成功分岐=1. Caller must
 * ensure `canBorrow`. Mutates in place.
 */
export function borrowBook(state: GameState, index: number): void {
  returnHeldBook(state); // 1-book limit — return current first
  pay(state, BOOK_RENTAL_FEE);
  addItem(state, bookItemId(index), 1);
  setBookBit(state, index, true);
  state.flagStore[FLAG_ID.借书返还期限] = BOOK_LOAN_DEADLINE;
  setTflag(state, TFLAG_ID.SELECTCOM的分岐, 1);
}

/** Extend the held book's loan (pay again, deadline→8). No-op if already 8. */
export function extendLoan(state: GameState): boolean {
  if ((state.flagStore[FLAG_ID.借书返还期限] ?? 0) === BOOK_LOAN_DEADLINE) return false;
  if (!canAfford(state, BOOK_RENTAL_FEE)) return false;
  pay(state, BOOK_RENTAL_FEE);
  state.flagStore[FLAG_ID.借书返还期限] = BOOK_LOAN_DEADLINE;
  return true;
}

/** Can the master afford to rent (cash path; chip mode deferred)? */
export function canRent(state: GameState): boolean {
  return canAfford(state, BOOK_RENTAL_FEE);
}
