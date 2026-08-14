/**
 * Faithful port of `@CHARA_DIARY_BEFORE_CHECK_K{N}` (per chara, in their
 * own DIARY file) + `@CHARA_DIARY_AFTERTRAIN` (AFTERTRA.ERB:650, the
 * nightly auto-render).
 *
 * Upstream flow (CHARA_DIARY.ERB:54-93):
 *   1. EXIST gate — chara has DIARY kojo? If not, skip.
 *   2. BEFORE_CHECK — author writes: `MAX_DIARY_PAGE = N` +
 *      `FOR LOCAL, 1, N+1: TRYCALLFORM DIARY_K{CHARA}_{LOCAL}_HAPPEN;
 *      IF RESULT: DIARY:CHARA:LOCAL = RESULT:1 (2=auto/3=player-only)`.
 *      If RESULT:1==3 (player-only) AND first time, CALL
 *      CHARA_DIARY_PAGESETTING to reserve a slot.
 *   3. AFTERTRAIN (nightly): for each chara with DIARY kojo, find the
 *      FIRST page with DIARY:CHARA:DCOUNT == 2, page-set, render TEXT,
 *      mark DIARY:CHARA:DCOUNT = 1 (read). Then reset any other
 *      `==2` pages to `0` so the night fires only once.
 *   4. AFTER_CHECK — author cleanup (rare, flag maintenance).
 *
 * HAPPEN functions return three values:
 *   - RESULT: non-zero means the authored condition fired.
 *   - RESULT:1 = 2 queues nightly auto-read; = 3 unlocks player-only reading.
 *   - RESULT:2 = 1 permits an already-written page to be queued again.
 * Player-only pages reserve PAGESET immediately; auto pages reserve their
 * slot only when AFTERTRAIN selects the nightly page.
 *   - The runtime call site is `runCharaDiaryBeforeTrain(state, router,
 *     rng)` (BEFORE_CHECK + AFTERTRAIN combined) — wired by the
 *     night-settlement orchestrator AFTER ONANISM (AFTERTRA.ERB:650).
 */
import type { GameState } from "../state/game-state.js";
import type { DialogueRouter } from "../kojo/types.js";
import type { Rng } from "../command/types.js";
import {
  applyKojoEffects,
  resolveDiaryKojoAndApply,
} from "../kojo/effects.js";
import type { ObservationEvent } from "../../schemas/types.js";
import {
  readDiaryFlag,
  writeDiaryFlag,
  readMaxDiaryPage,
  writeMaxDiaryPage,
  findFirstUnreadAutoPage,
  pickPageSetting,
  resetOtherAutoPages,
  type DiaryPageStatus,
} from "../state/diary.js";

/**
 * Iterate every chara; for each, if they have DIARY kojo, run their
 * BEFORE_CHECK body to update MAX_DIARY_PAGE + DIARY status flags.
 *
 * Faithful to AFTERTRA.ERB:650 `CALL CHARA_DIARY_AFTERTRAIN` — but
 * AFTERTRAIN does the BEFORE_CHECK AND the night render together; we
 * split them so the night-settlement orchestrator can render TEXT
 * between BEFORE_CHECK and AFTER_CHECK.
 */
export function runCharaDiaryBeforeCheck(
  state: GameState,
  router: Pick<DialogueRouter, "hasDiaryKojo" | "resolveDiaryHook" | "resolveDiaryHappen" | "resolveDiaryKojo">,
  rng: Rng,
  charas: ReadonlyArray<number>,
): GameState {
  let next = state;
  for (const charaNum of charas) {
    if (!router.hasDiaryKojo?.(charaNum, next, rng)) continue;

    const before = router.resolveDiaryHook?.(charaNum, "before-check", next, rng);
    if (before?.status === "resolved" && before.effects.length > 0) {
      next = applyKojoEffects(next, before.effects);
    }

    // Walk pages 1..MAX, ask router.resolveDiaryHappen(page) → if
    // fired, write DIARY flag and reserve a PAGESET slot.
    const max = readMaxDiaryPage(next, charaNum);
    if (max <= 0) continue;
    for (let page = 1; page <= max; page++) {
      const out = router.resolveDiaryHappen?.(charaNum, page, next, rng);
      if (out?.effects?.length) {
        next = applyKojoEffects(next, out.effects);
      }
      if (!out?.fired) continue;
      if (out.resultSlot1 !== 2 && out.resultSlot1 !== 3) continue;
      const current = readDiaryFlag(next, charaNum, page);
      if (current !== 0 && out.resultSlot2 !== 1) continue;
      const status: DiaryPageStatus = out.resultSlot1;
      next = writeDiaryFlag(next, charaNum, page, status);
      if (
        status === 3 &&
        !Object.values(next.diaryPageSet?.[charaNum] ?? {}).includes(page)
      ) {
        const picked = pickPageSetting(next, charaNum, page);
        next = picked.state;
      }
    }
  }
  return next;
}

/**
 * Run nightly AFTERTRAIN: for each chara with DIARY kojo, find the
 * FIRST page flagged `2` (auto-fire) → set its PAGESET slot → render
 * TEXT → mark `1` (read) → reset other `==2` pages to `0`.
 *
 * Returns `{ state, events }`. The events list carries the rendered
 * TEXT lines (one per chara who fired), tagged with the charaNum so
 * the night-settlement screen can group them per character.
 */
export function runCharaDiaryAfterTrain(
  state: GameState,
  router: Pick<DialogueRouter, "hasDiaryKojo" | "resolveDiaryHook" | "resolveDiaryKojo" | "resolveDiaryKojoDetailed">,
  rng: Rng,
  charas: ReadonlyArray<number>,
  now: () => number,
): { state: GameState; events: ObservationEvent[] } {
  let next = state;
  const events: ObservationEvent[] = [];

  for (const charaNum of charas) {
    if (!router.hasDiaryKojo?.(charaNum, next, rng)) continue;

    // Find the FIRST page flagged 2 (auto-fire).
    const page = findFirstUnreadAutoPage(next, charaNum);
    if (page === 0) continue;

    // PAGESET — pick a slot if not already reserved.
    if (!next.diaryPageSet?.[charaNum]?.[page]) {
      const picked = pickPageSetting(next, charaNum, page);
      next = picked.state;
    }

    // Find the slot for this page (PAGESET mapping).
    const slot =
      Object.entries(next.diaryPageSet?.[charaNum] ?? {}).find(
        ([, p]) => p === page,
      )?.[0] ?? "0";
    const slotNum = Number(slot) || 0;

    // Render TEXT kojo with mode="デイリー".
    const lines = resolveDiaryKojoAndApply(
      router,
      next,
      charaNum,
      page,
      rng,
      [page, slotNum],
      "デイリー",
    );

    // Header: "%CALLNAME:CHARA%的日记" (faithful CHARA_DIARY.ERB:64)
    const charaName = next.charas[charaNum]?.callName ?? `#${charaNum}`;
    events.push({
      kind: "NARRATION" as const,
      timestamp: now(),
      text: `▼${charaName}的日记　PAGE.${slotNum} ─────`,
    });
    for (const line of lines) {
      events.push({
        kind: "NARRATION" as const,
        timestamp: now(),
        text: line.text,
      });
    }
    events.push({
      kind: "NARRATION" as const,
      timestamp: now(),
      text: "───────────────",
    });

    // Mark the page as read (DIARY == 1), reset other queued pages.
    next = writeDiaryFlag(next, charaNum, page, 1);
    next = resetOtherAutoPages(next, charaNum, page);
    const after = router.resolveDiaryHook?.(charaNum, "after-check", next, rng);
    if (after?.status === "resolved" && after.effects.length > 0) {
      next = applyKojoEffects(next, after.effects);
    }
  }

  return { state: next, events };
}

/**
 * Set the per-chara max page count (called by the orchestrator with
 * the value baked from the build-time index). V1 keeps this simple —
 * `MAX_DIARY_PAGE` lives outside the state machine but is read by
 * BEFORE_CHECK's iteration bound.
 */
export function setDiaryMaxPage(
  state: GameState,
  charaNum: number,
  max: number,
): GameState {
  return writeMaxDiaryPage(state, charaNum, max);
}

// Re-export the state-machine helpers for callers that want the raw API.
export { readDiaryFlag, writeDiaryFlag, readMaxDiaryPage, findFirstUnreadAutoPage };
