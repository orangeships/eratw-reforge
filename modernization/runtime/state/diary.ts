/**
 * COMF406 日記を読む — player's diary (`SAVESTR:1`) storage + per-chara diary.
 *
 * Upstream uses a single string variable `SAVESTR:1` with entries joined
 * by `//`. The "diary full" gate is `STRCOUNT(SAVESTR:1, "//") >= 100`.
 * The modern equivalent stores entries as an ordered `string[]` (one
 * entry per element) — JSON-safe, diff-friendly, easier to test.
 *
 * Per-chara diaries (the NPC-side of `CHARA_DIARY_COM`) live on
 * `state.charaDiaries[charaNum]` as the same shape. Faithful: a chara
 * "has a diary" iff the array is non-empty.
 *
 * This module exposes four operations:
 *   - `readMasterDiary(state)` / `writeMasterDiaryEntry(state, text)`
 *   - `readCharaDiary(state, charaNum)` / `writeCharaDiaryEntry(...)`
 *   - `isMasterDiaryFull(state)` (upstream's 100-entry gate)
 *   - `masterDiaryCount(state)` / `charaDiaryCount(state, charaNum)`
 *
 * Pure helpers; handlers must `cloneGameState` before mutating.
 */

import type { GameState } from "./game-state.js";

/** Upstream's "diary full" gate (COMF406 case 0: `STRCOUNT >= 100`). */
export const MASTER_DIARY_MAX_ENTRIES = 100;

/** Separator (kept for serialization if we ever round-trip to a SAVESTR string). */
export const DIARY_ENTRY_SEPARATOR = "//";

/** Player's diary entries (immutable read). */
export function readMasterDiary(state: Readonly<GameState>): readonly string[] {
  return state.masterDiary ?? [];
}

/** Number of entries (mirrors upstream's `STRCOUNT(SAVESTR:1, "//") + 1`). */
export function masterDiaryCount(state: Readonly<GameState>): number {
  return readMasterDiary(state).length;
}

/** Faithful "diary full" gate. Upstream bails when entry count >= 100. */
export function isMasterDiaryFull(state: Readonly<GameState>): boolean {
  return masterDiaryCount(state) >= MASTER_DIARY_MAX_ENTRIES;
}

/**
 * Append one entry to the player's diary. Caller must `cloneGameState`
 * first — this helper only allocates the new array.
 *
 * `text` is the raw user input (upstream's `RESULTS` from `INPUTS`).
 * Empty/whitespace entries are dropped (upstream's `SIF RESULTS != ""`).
 */
export function appendMasterDiaryEntry(
  state: GameState,
  text: string,
): GameState {
  const trimmed = text.trim();
  if (trimmed.length === 0) return state;
  if (isMasterDiaryFull(state)) return state; // upstream silences overwrites
  return {
    ...state,
    masterDiary: [...(state.masterDiary ?? []), trimmed],
  };
}

/** Per-chara diary (NPC-side). Empty array = no diary. */
export function readCharaDiary(
  state: Readonly<GameState>,
  charaNum: number,
): readonly string[] {
  return state.charaDiaries?.[charaNum] ?? [];
}

export function charaDiaryCount(
  state: Readonly<GameState>,
  charaNum: number,
): number {
  return readCharaDiary(state, charaNum).length;
}

/**
 * Append one entry to a chara's diary. Caller must `cloneGameState` first.
 * Used by `CHARA_DIARY_COM` (upstream) — modern runtime writes through here
 * when a chara has no personal DIARY kojo body (otherwise the kojo text
 * IS the diary page and the runtime renders it directly without persisting).
 */
export function appendCharaDiaryEntry(
  state: GameState,
  charaNum: number,
  text: string,
): GameState {
  const trimmed = text.trim();
  if (trimmed.length === 0) return state;
  const current = state.charaDiaries?.[charaNum] ?? [];
  return {
    ...state,
    charaDiaries: {
      ...(state.charaDiaries ?? {}),
      [charaNum]: [...current, trimmed],
    },
  };
}

// ── DIARY status state machine (faithful to upstream `DIARY:CHARA:DCOUNT` +
//   `PAGESET:CHARA:SLOT` + `MAX_DIARY_PAGE:CHARA:0`) ──────────────────────

/** DIARY page status (per `DIARY:CHARA:DCOUNT`). */
export type DiaryPageStatus = 0 | 1 | 2 | 3;

/** Sentinel: page 0 is unused upstream (FOR LOCAL, 1, MAX+1). */
export const DIARY_PAGE_UNUSED = 0;

/** Read a single page flag (missing key → 0 = 未解锁). */
export function readDiaryFlag(
  state: Readonly<GameState>,
  charaNum: number,
  page: number,
): DiaryPageStatus {
  return state.diaryFlags?.[charaNum]?.[page] ?? 0;
}

/** Write a single page flag (caller must `cloneGameState` first). */
export function writeDiaryFlag(
  state: GameState,
  charaNum: number,
  page: number,
  status: DiaryPageStatus,
): GameState {
  if (page <= 0) return state; // upstream convention: page 0 unused
  const cur = state.diaryFlags?.[charaNum] ?? {};
  return {
    ...state,
    diaryFlags: {
      ...(state.diaryFlags ?? {}),
      [charaNum]: { ...cur, [page]: status },
    },
  };
}

/** Read the author's max-page count (0 if not set). */
export function readMaxDiaryPage(
  state: Readonly<GameState>,
  charaNum: number,
): number {
  return state.diaryMaxPage?.[charaNum] ?? 0;
}

/** Write the max-page count (called from BEFORE_CHECK body, which knows the
 *  page count from its bundle). Caller must `cloneGameState` first. */
export function writeMaxDiaryPage(
  state: GameState,
  charaNum: number,
  max: number,
): GameState {
  if (max <= 0) return state;
  return {
    ...state,
    diaryMaxPage: { ...(state.diaryMaxPage ?? {}), [charaNum]: max },
  };
}

/** Read the PAGESET mapping (slot → pageNum). Missing → empty. */
export function readPageSet(
  state: Readonly<GameState>,
  charaNum: number,
): Record<number, number> {
  return state.diaryPageSet?.[charaNum] ?? {};
}

/**
 * Find the first unfilled slot for a chara and write `pageNum` into it.
 * Faithful to `CHARA_DIARY_PAGESETTING(CHARA, PAGENUM)` (upstream
 * `@CHARA_DIARY.ERB:241`) which iterates 1..MAX_DIARY_PAGE+1 and
 * returns the first slot with `!PAGESET:CHARA:LOCAL`. The returned
 * slot is the rendered "page index" (1-based) the TEXT kojo receives
 * via PAGECOUNT.
 */
export function pickPageSetting(
  state: GameState,
  charaNum: number,
  pageNum: number,
): { state: GameState; slot: number } {
  const max = readMaxDiaryPage(state, charaNum);
  if (max <= 0 || pageNum <= 0) return { state, slot: 0 };
  const current = state.diaryPageSet?.[charaNum] ?? {};
  for (let slot = 1; slot <= max; slot++) {
    if (!current[slot]) {
      return {
        state: {
          ...state,
          diaryPageSet: {
            ...(state.diaryPageSet ?? {}),
            [charaNum]: { ...current, [slot]: pageNum },
          },
        },
        slot,
      };
    }
  }
  return { state, slot: 0 }; // all slots filled — no-op
}

/**
 * Find the FIRST page flagged `2` (nightly auto-fire) for a chara.
 * Faithful to `@CHARA_DIARY_AFTERTRAIN` line 70: `IF DIARY:CHARA:DCOUNT == 2`.
 */
export function findFirstUnreadAutoPage(
  state: Readonly<GameState>,
  charaNum: number,
): number {
  const max = readMaxDiaryPage(state, charaNum);
  const flags = state.diaryFlags?.[charaNum] ?? {};
  for (let page = 1; page <= max; page++) {
    if (flags[page] === 2) return page;
  }
  return 0;
}

/**
 * Faithful to upstream lines 87-91: any remaining `2`-flagged pages after
 * the chosen page was rendered are RESET to `0` (the night only fires one
 * page per chara, no matter how many queued up). Used by AFTERTRAIN after
 * a successful TEXT render.
 */
export function resetOtherAutoPages(
  state: GameState,
  charaNum: number,
  exceptPage: number,
): GameState {
  const max = readMaxDiaryPage(state, charaNum);
  const flags = state.diaryFlags?.[charaNum] ?? {};
  const next: Record<number, DiaryPageStatus> = {};
  for (let page = 1; page <= max; page++) {
    const cur = flags[page] ?? 0;
    if (cur === 2 && page !== exceptPage) next[page] = 0;
    else if (cur !== undefined) next[page] = cur;
  }
  return {
    ...state,
    diaryFlags: {
      ...(state.diaryFlags ?? {}),
      [charaNum]: next,
    },
  };
}