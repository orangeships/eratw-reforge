/**
 * Phase 5A — `CommandCatalog`: keyed registry of `HandlerEntry`s.
 *
 * Backed by a `Map<commandNo, HandlerEntry>` for O(1) lookup and to
 * preserve insertion order. `list()` returns a sorted-by-commandNo
 * snapshot so tests can pin the deterministic ordering.
 *
 * 5A ships an empty catalog by intent: the resolver is wired but no
 * real command has been hand-ported yet. 5B registers the first entry
 * (`COMF400 移動`), and the catalog stays a thin pass-through
 * thereafter.
 *
 * Constraint: `register` throws on duplicate `commandNo` because a
 * silent overwrite would let a 5D `会話` handler accidentally mask a
 * 5B `移動` handler — a class of bug that's painful to debug from a
 * diff. Loud failure at registration time is cheap.
 */

import type { HandlerEntry } from "./types.js";

export class CommandCatalog {
  private readonly entries = new Map<number, HandlerEntry>();

  /**
   * Register a handler entry. Throws if `commandNo` is already
   * registered — duplicates indicate a programmer error (two slices
   * claiming the same `commandNo`).
   */
  register(entry: HandlerEntry): void {
    if (this.entries.has(entry.commandNo)) {
      throw new Error(
        `duplicate commandNo: ${entry.commandNo} (already registered)`,
      );
    }
    this.entries.set(entry.commandNo, entry);
  }

  /** Lookup by `commandNo`. Returns `undefined` for unknown ids. */
  get(commandNo: number): HandlerEntry | undefined {
    return this.entries.get(commandNo);
  }

  /** O(1) membership test. */
  has(commandNo: number): boolean {
    return this.entries.has(commandNo);
  }

  /**
   * Snapshot of all registered entries, sorted ascending by
   * `commandNo`. Sorting (rather than insertion-order) makes test
   * snapshots stable across registration orderings, which matters
   * when 5B+ register commands in feature-development order rather
   * than numeric order.
   */
  list(): ReadonlyArray<HandlerEntry> {
    return [...this.entries.values()].sort(
      (a, b) => a.commandNo - b.commandNo,
    );
  }

  /** Count of registered entries. Useful for diagnostics. */
  get size(): number {
    return this.entries.size;
  }
}