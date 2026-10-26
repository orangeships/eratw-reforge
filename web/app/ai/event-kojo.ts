/**
 * EVENT kojo AI fallback support (潜入/被赶出等世界事件场景).
 *
 * These events fire from runtime world logic (sneak-in.ts, kick-out.ts,
 * scheduler.ts) rather than command settlement. This module provides the
 * shell-layer wrapper to check for missing EVENT kojo and trigger L1 AI
 * completion when needed.
 *
 * Architecture: runtime stays AI-agnostic; EVENT kojo resolution happens
 * inside runtime with dialogueRouter, but the AI fallback detection and
 * generation happens here in the shell layer after events are produced.
 */

import type { GameState } from "../../../modernization/runtime/state/index.js";
import type { DialogueRouter } from "../../../modernization/runtime/kojo/types.js";
import { createRng } from "../../../modernization/runtime/command/rng.js";
import { isKojoAiFallbackEligible } from "../../../modernization/runtime/kojo/ai-fallback.js";
import type { EventKojoContext, PrepareAiEventKojoInput } from "./types.js";
import { prepareRealtimeAiEventKojo, generateRealtimeAiKojo } from "./kojo-runtime.js";

export interface CheckEventKojoInput {
  target: number;
  eventArm: number;
  eventSub: number[];
  state: Readonly<GameState>;
  router: DialogueRouter;
  seed: number;
}

export interface EventKojoCheckResult {
  needsAi: boolean;
  context?: EventKojoContext;
  description?: string;
}

/**
 * Check if an EVENT kojo route needs AI fallback.
 *
 * This is called from shell layer after runtime produces events with
 * resolveEventKojoAndApply. If the route was not-authored, we return
 * true so the shell can trigger AI generation.
 */
export function checkEventKojoNeedsAi(
  input: CheckEventKojoInput,
): EventKojoCheckResult {
  if (!input.router.resolveEventKojoDetailed) {
    return { needsAi: false };
  }

  const resolution = input.router.resolveEventKojoDetailed(
    input.target,
    input.eventArm,
    input.state,
    createRng(input.seed),
    input.eventSub,
  );

  if (!isKojoAiFallbackEligible(resolution.status)) {
    return { needsAi: false };
  }

  // Map EVENT arm + sub to context and description
  const { context, description } = identifyEventContext(
    input.eventArm,
    input.eventSub,
    input.state,
    input.target,
  );

  return {
    needsAi: true,
    context,
    description,
  };
}

/**
 * Identify the context and description for an EVENT kojo.
 * This helps build appropriate AI prompts for different event scenarios.
 */
function identifyEventContext(
  eventArm: number,
  eventSub: number[],
  state: Readonly<GameState>,
  target: number,
): { context: EventKojoContext; description: string } {
  const targetName = state.charas[target]?.callName ?? `角色${target}`;

  // EVENT 12: 潜入相关
  if (eventArm === 12) {
    const [sub1, sub2] = eventSub;
    if (sub1 === 1 && sub2 === 2) {
      return {
        context: "sneak-in-allowed",
        description: `${targetName}醒来后允许你留下`,
      };
    }
    if (sub1 === 1 && sub2 === 4) {
      return {
        context: "sneak-in-refused",
        description: `${targetName}醒来后拒绝你进入，把你赶了出去`,
      };
    }
    if (sub1 === 2 && sub2 === 1) {
      return {
        context: "sneak-in-rage",
        description: `${targetName}愤怒地拒绝你的潜入`,
      };
    }
  }

  // EVENT 3 sub 7,1: 被从卧室赶出
  if (eventArm === 3 && eventSub[0] === 7 && eventSub[1] === 1) {
    return {
      context: "kick-out-bedroom",
      description: `${targetName}犯困回到房间，发现你在这里，把你赶了出去`,
    };
  }

  // 其他 EVENT（未来扩展）
  return {
    context: "other",
    description: `EVENT ${eventArm} sub [${eventSub.join(",")}] 场景`,
  };
}

/**
 * Generate AI kojo for an EVENT that has no authored content.
 *
 * Returns the generated lines if AI generation succeeded, null otherwise.
 * The caller is responsible for adding these lines to the event log or
 * dialogue session as appropriate.
 */
export async function generateEventKojoIfNeeded(
  input: CheckEventKojoInput & { context: EventKojoContext; description: string },
): Promise<{ requestId: string; lines: Array<{ text: string; form: "PRINTFORML" | "PRINTFORMDL" }> } | null> {
  const prepareInput: PrepareAiEventKojoInput = {
    target: input.target,
    eventArm: input.eventArm,
    eventSub: input.eventSub,
    state: input.state,
    router: input.router,
    seed: input.seed,
    context: input.context,
    contextDescription: input.description,
  };

  const prepared = prepareRealtimeAiEventKojo(prepareInput);
  if (!prepared) return null;

  try {
    // Generate AI kojo (streaming)
    // Note: We don't provide partial callbacks here since EVENT kojo
    // happens during world events, not user commands
    const lines = await generateRealtimeAiKojo(prepared);
    return {
      requestId: prepared.requestId,
      lines,
    };
  } catch (error) {
    console.warn("[EVENT-KOJO] AI generation failed:", error);
    return null;
  }
}
