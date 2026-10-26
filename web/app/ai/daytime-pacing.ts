/**
 * Cost pacing for the optional daytime cognition sidecar.
 *
 * The sidecar is observation-driven: every command that projects new facts for
 * a character used to start a provider batch for that character, capped only by
 * a concurrency limit. A busy scene therefore fired several calls per command,
 * and nothing spaced them out. This pacer turns that into a bounded, evenly
 * distributed rate:
 *
 *  - a hard per-character ceiling per game day;
 *  - a minimum game-tick gap between two batches of the same character,
 *    derived from the day length so the ceiling is spread evenly instead of
 *    being spent in the first hour;
 *  - a global minimum gap so a crowd of characters does not fire on one tick.
 *
 * Deferral is never failure: the evidence stays in the queue and the next
 * projection re-offers it, so a deferred batch is simply served later. The
 * counters are intentionally ephemeral, matching every other guard on this
 * sidecar (best-effort presentation, never authoritative). The day roll is
 * driven by the game clock, so a stale budget cannot leak into the next day
 * even if the feature is toggled or a save is reloaded mid-day.
 */

/** One game day is 1440 ticks; one tick is one game minute. */
const TICKS_PER_DAY = 1_440;

/** Hard ceiling of provider batches per character per game day. */
export const DAYTIME_DAILY_BATCH_LIMIT = 6;

/** Even spacing of that ceiling across the day (4 game hours at the default). */
export const DAYTIME_MIN_GAP_TICKS = Math.floor(TICKS_PER_DAY / DAYTIME_DAILY_BATCH_LIMIT);

/** Global minimum gap between two batch starts, so simultaneous arrivals fan out. */
export const DAYTIME_GLOBAL_GAP_TICKS = 15;

export interface DaytimePacingSnapshot {
  dayIndex: number | null;
  startedToday: Record<number, number>;
  remainingToday: Record<number, number>;
}

export class DaytimeBatchPacer {
  private dayIndex: number | null = null;
  private readonly startedToday = new Map<number, number>();
  private readonly lastStartTick = new Map<number, number>();
  private lastStartTickAny: number | null = null;

  /**
   * Admit at most `limit` candidates and record every admission. Ordering is
   * longest-waiting-first so a crowded scene cannot starve one character while
   * it repeatedly serves the same few.
   */
  admit(
    candidates: readonly number[],
    dayIndex: number,
    tick: number,
    limit: number,
  ): number[] {
    this.rollDay(dayIndex);
    if (limit <= 0) return [];
    const now = Math.max(0, Math.trunc(tick));
    const ordered = [...new Set(candidates)].sort(
      (left, right) =>
        (this.lastStartTick.get(left) ?? -1) - (this.lastStartTick.get(right) ?? -1) || left - right,
    );
    // The global gap is stricter than the concurrency limit on purpose: two
    // batches may run in parallel only when they were started 15+ ticks apart.
    let globalFloor = this.lastStartTickAny === null
      ? Number.NEGATIVE_INFINITY
      : this.lastStartTickAny + DAYTIME_GLOBAL_GAP_TICKS;
    const admitted: number[] = [];
    for (const charaNum of ordered) {
      if (admitted.length >= limit || globalFloor > now) break;
      if ((this.startedToday.get(charaNum) ?? 0) >= DAYTIME_DAILY_BATCH_LIMIT) continue;
      const last = this.lastStartTick.get(charaNum);
      if (last !== undefined && now - last < DAYTIME_MIN_GAP_TICKS) continue;
      admitted.push(charaNum);
      this.startedToday.set(charaNum, (this.startedToday.get(charaNum) ?? 0) + 1);
      this.lastStartTick.set(charaNum, now);
      this.lastStartTickAny = now;
      globalFloor = now + DAYTIME_GLOBAL_GAP_TICKS;
    }
    return admitted;
  }

  /** Batches this character may still start today (0 once the ceiling is spent). */
  remainingToday(charaNum: number): number {
    return Math.max(0, DAYTIME_DAILY_BATCH_LIMIT - (this.startedToday.get(charaNum) ?? 0));
  }

  snapshot(): DaytimePacingSnapshot {
    const startedToday: Record<number, number> = {};
    const remainingToday: Record<number, number> = {};
    for (const [charaNum, count] of this.startedToday) {
      startedToday[charaNum] = count;
      remainingToday[charaNum] = this.remainingToday(charaNum);
    }
    return { dayIndex: this.dayIndex, startedToday, remainingToday };
  }

  reset(): void {
    this.dayIndex = null;
    this.startedToday.clear();
    this.lastStartTick.clear();
    this.lastStartTickAny = null;
  }

  private rollDay(dayIndex: number): void {
    if (this.dayIndex === dayIndex) return;
    this.dayIndex = dayIndex;
    this.startedToday.clear();
    this.lastStartTick.clear();
    this.lastStartTickAny = null;
  }
}
