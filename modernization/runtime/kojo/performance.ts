export type KojoPerformanceStage = "read" | "parse" | "resolve" | "clone";
export type KojoPerformanceTotals = Record<KojoPerformanceStage, number>;

const totals: KojoPerformanceTotals = { read: 0, parse: 0, resolve: 0, clone: 0 };

/** Main-thread elapsed time only. Resolve includes its nested clone cost. */
export function recordKojoPerformance(stage: KojoPerformanceStage, ms: number): void {
  totals[stage] += Math.max(0, ms);
}

export function kojoPerformanceTotals(): KojoPerformanceTotals {
  return { ...totals };
}
