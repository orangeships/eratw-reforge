import {
  buildCharacterSoftExperiences,
  parseLazyMaterializationResponse,
  type LazyMaterializationContext,
} from "../../../modernization/runtime/agent/index.js";
import type { AcceptedExperience } from "../../../modernization/runtime/experience.js";
import type { GameState } from "../../../modernization/runtime/state/game-state.js";
import { createOpenAiCompatibleProvider, estimateAiTokenUsage } from "./provider.js";
import { useAiStore } from "./store.js";
import type { AiProvider, AiSettings, AiTokenUsage } from "./types.js";

export type LazyMaterializationTrigger = "encounter" | "debug";

export interface LazyMaterializationReservation {
  requestId: string;
  generation: number;
  characterId: number;
  trigger: LazyMaterializationTrigger;
  context: LazyMaterializationContext;
  stateSnapshot: GameState;
  settings: AiSettings;
  /** Serialized growth from the synchronous reservation bookkeeping only. */
  reservationSaveBytesDelta?: number;
}

export type LazyMaterializationReserveResult =
  | { reservation: LazyMaterializationReservation }
  | { skipped: string; requestId: string; gameDayIndex?: number; gameTick?: number };

export interface LazyMaterializationCommitMetrics {
  acceptedCount: number;
  experienceBytesDelta: number;
  saveBytesDelta: number;
}

export interface LazyMaterializationHost {
  reserve(
    characterId: number,
    trigger: LazyMaterializationTrigger,
    generation: number,
  ): LazyMaterializationReserveResult;
  commit(
    reservation: LazyMaterializationReservation,
    signal: AbortSignal,
    experiences: AcceptedExperience[],
  ): number | LazyMaterializationCommitMetrics | null;
}

interface QueuedTask {
  reservation: LazyMaterializationReservation;
  controller: AbortController;
  host: LazyMaterializationHost;
  queuedAt: number;
}

let providerOverride: AiProvider | null = null;
let generation = 0;
let queue: QueuedTask[] = [];
let active: QueuedTask | null = null;

export function configureLazyMaterializationProviderForTests(provider: AiProvider | null): void {
  providerOverride = provider;
}

function patchCancelled(task: QueuedTask, reason: string): void {
  useAiStore.getState().patchDebugEntry(task.reservation.requestId, {
    status: "cancelled",
    durationMs: Date.now() - task.queuedAt,
    error: reason,
  });
}

/** Cancel both the provider call and already-reserved FIFO entries. */
export function cancelLazyMaterialization(reason = "cancelled"): void {
  generation += 1;
  if (active) {
    active.controller.abort();
    patchCancelled(active, reason);
  }
  for (const task of queue) patchCancelled(task, reason);
  queue = [];
  // Keep the aborted provider as the active slot until its promise settles.
  // This preserves the strict peak-concurrency=1 contract even for providers
  // that do not react to AbortSignal synchronously.
}

function pump(): void {
  if (active || queue.length === 0) return;
  const task = queue.shift()!;
  active = task;
  const { reservation } = task;
  const startedAt = Date.now();
  useAiStore.getState().patchDebugEntry(reservation.requestId, {
    providerStarted: true,
    queueWaitMs: Math.max(0, startedAt - task.queuedAt),
  });
  const provider = providerOverride ?? createOpenAiCompatibleProvider(reservation.settings);
  const timeoutMs = Math.max(5_000, Math.min(reservation.settings.timeoutMs, 60_000));
  let timedOut = false;
  const timeout = window.setTimeout(() => {
    timedOut = true;
    task.controller.abort();
  }, timeoutMs);
  const completion = {
    system: reservation.context.system,
    user: reservation.context.user,
    temperature: Math.min(reservation.settings.temperature, 0.7),
    maxTokens: Math.min(reservation.settings.maxTokens, 640),
    jsonMode: true,
  };
  let tokenUsage: AiTokenUsage | undefined;
  void provider.complete(completion, task.controller.signal, undefined, (usage) => {
    tokenUsage = usage;
  })
    .then((raw) => {
      if (task.controller.signal.aborted || reservation.generation !== generation) {
        useAiStore.getState().patchDebugEntry(reservation.requestId, {
          tokenUsage: tokenUsage ?? estimateAiTokenUsage(completion, raw),
        });
        if (timedOut && reservation.generation === generation) {
          useAiStore.getState().patchDebugEntry(reservation.requestId, {
            status: "error",
            durationMs: Date.now() - startedAt,
            error: `materialization timed out after ${timeoutMs}ms`,
          });
        }
        return;
      }
      const parsed = parseLazyMaterializationResponse(raw, reservation.context);
      const experiences = buildCharacterSoftExperiences(
        reservation.stateSnapshot,
        reservation.context,
        parsed,
      );
      const commitResult = task.host.commit(reservation, task.controller.signal, experiences);
      if (commitResult === null) {
        useAiStore.getState().patchDebugEntry(reservation.requestId, {
          status: "cancelled",
          durationMs: Date.now() - startedAt,
          response: raw,
          tokenUsage: tokenUsage ?? estimateAiTokenUsage(completion, raw),
          error: "stale materialization proposal",
        });
        return;
      }
      const metrics = typeof commitResult === "number"
        ? { acceptedCount: commitResult, experienceBytesDelta: 0, saveBytesDelta: 0 }
        : commitResult;
      useAiStore.getState().patchDebugEntry(reservation.requestId, {
        status: "success",
        durationMs: Date.now() - startedAt,
        response: raw,
        acceptedCount: metrics.acceptedCount,
        tokenUsage: tokenUsage ?? estimateAiTokenUsage(completion, raw),
        experienceBytesDelta: metrics.experienceBytesDelta,
        saveBytesDelta: metrics.saveBytesDelta,
      });
    })
    .catch((error: unknown) => {
      if (reservation.generation !== generation) {
        if (tokenUsage) useAiStore.getState().patchDebugEntry(reservation.requestId, { tokenUsage });
        return;
      }
      useAiStore.getState().patchDebugEntry(reservation.requestId, {
        status: timedOut ? "error" : task.controller.signal.aborted ? "cancelled" : "error",
        durationMs: Date.now() - startedAt,
        tokenUsage,
        error: timedOut
          ? `materialization timed out after ${timeoutMs}ms`
          : error instanceof Error ? error.message : String(error),
      });
    })
    .finally(() => {
      window.clearTimeout(timeout);
      if (active === task) active = null;
      pump();
    });
}

/**
 * The only production entry. It returns immediately and performs reservation
 * in a microtask after the authoritative encounter state has committed.
 */
export function prepareCharacterForEncounter(
  characterId: number,
  trigger: LazyMaterializationTrigger,
  host: LazyMaterializationHost,
): void {
  const scheduledGeneration = generation;
  queueMicrotask(() => {
    if (scheduledGeneration !== generation) return;
    const result = host.reserve(characterId, trigger, scheduledGeneration);
    if ("skipped" in result) {
      useAiStore.getState().addDebugEntry({
        requestId: result.requestId,
        createdAt: Date.now(),
        feature: "agent-materialization",
        target: characterId,
        gameDayIndex: result.gameDayIndex,
        gameTick: result.gameTick,
        lazyTrigger: trigger,
        status: "skipped",
        durationMs: 0,
        skipReason: result.skipped,
      });
      return;
    }
    const task: QueuedTask = {
      reservation: result.reservation,
      controller: new AbortController(),
      host,
      queuedAt: Date.now(),
    };
    useAiStore.getState().addDebugEntry({
      requestId: result.reservation.requestId,
      createdAt: Date.now(),
      feature: "agent-materialization",
      target: characterId,
      gameDayIndex: result.reservation.stateSnapshot.time.dayIndex,
      gameTick: result.reservation.stateSnapshot.time.tickValue,
      lazyTrigger: trigger,
      status: "pending",
      saveBytesDelta: result.reservation.reservationSaveBytesDelta,
      prompt: `${result.reservation.context.system}\n\n${result.reservation.context.user}`,
    });
    queue.push(task);
    pump();
  });
}

export function lazyMaterializationGenerationForTests(): number {
  return generation;
}
