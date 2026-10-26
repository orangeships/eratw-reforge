/** P0 探针（AI-PREPARE-PERF-PLAN.md §4）：kojo 树求值与 GameState clone
 * 的调用计数/耗时。模块级、无锁；读数方负责 reset/read 配对窗口
 * （prepare 入口 reset、采样完成后 read，窗口内同步执行无交叠）。
 * 只记单次窗口，不做平均聚合。 */

import { recordKojoPerformance } from "./performance.js";

export interface KojoResolveStats {
  resolveCalls: number;
  resolveMs: number;
  cloneCalls: number;
}

let resolveCalls = 0;
let resolveMs = 0;
let cloneCalls = 0;

export function recordKojoResolve(ms: number): void {
  recordKojoPerformance("resolve", ms);
  resolveCalls += 1;
  resolveMs += ms;
}

export function recordKojoClone(ms = 0): void {
  recordKojoPerformance("clone", ms);
  cloneCalls += 1;
}

export function resetKojoResolveStats(): void {
  resolveCalls = 0;
  resolveMs = 0;
  cloneCalls = 0;
}

export function readKojoResolveStats(): KojoResolveStats {
  return { resolveCalls, resolveMs, cloneCalls };
}
