/**
 * Phase 7.0 — `makeComfHandler`: the shared command-settlement factory.
 *
 * Turns a `ComfDef` (coefficients + small builder lambdas) into a
 * `HandlerEntry` that runs the canonical settlement skeleton. This is
 * the leverage point for Phase 7: ~74% of remaining commands are pure
 * coefficient differences, expressible as a `ComfDef` + this factory,
 * with NO bespoke handler code.
 *
 * Faithfulness contract: the factory reproduces the exact arithmetic
 * and ordering of the hand-written 5D/5E ports (`talk.ts` 300 /
 * `headpat.ts` 309), which are now defined as `ComfDef`s. Their pinned
 * tests (PALAM / 好感度 / EXP / TCVAR / time) are the regression net.
 *
 * Ordering note (matters for fidelity): time advances BEFORE `body`, so
 * a body lambda that records a time marker (e.g. 309's 摸頭時刻) sees the
 * post-advance tick — matching upstream. Bodies that don't read time
 * (e.g. 300's 会話累計 / EXP) are order-insensitive.
 */

import type { CommandContext, CommandResult, ExecCheck, HandlerEntry } from "../types.js";
import type { ObservationEvent } from "../../../schemas/types.js";
import { cloneGameState, type CharaSlot, type GameState } from "../../state/game-state.js";
import { publishHookFallback, selectNarrativeHook } from "../../story/dialogue-hook.js";
import { removeItem } from "../../state/items.js";
import {
  CFLAG_ID,
  TEQUIP_ID,
  applyCommandTimeCost,
  times,
} from "../../state/settlement.js";
import {
  finalizeTrainingMarkAcquisitionChecks,
  applyOneMinuteHCommandTimeCorrection,
  applySourceCheck,
  settleSourcePalam,
} from "../source-check.js";
import { stripBottom, stripTop } from "../../state/clothing-write.js";
import { isEquipped, setEquipped } from "../../state/tequip.js";
import { applyKojoEffects } from "../../kojo/effects.js";
import { kojoHostEventsToObservationEvents } from "../command-kojo.js";
import { setTflag, snapshotKojoSource, TFLAG_ID } from "../../state/tflag.js";
import { compileGate, mergedGateFor } from "./compile-gate.js";
import { resolveCommandDisplayName } from "../display-name.js";
import { requiresHMode } from "../h-mode.js";
import {
  checkHBaseResourceAvailability,
  type HBaseResourceCheckResult,
} from "../h-base-resources.js";
import {
  MUL_POSITIVE,
  type ComfCtx,
  type ComfDef,
  type ComfOutcome,
  type ComfOutcomeResolution,
} from "./comf-def.js";

/**
 * Strip a trailing settlement marker (`; 好感度 +N.` / `好感度 -N`) from a
 * placeholder NARRATION line. The settlement delta is ALREADY recorded as a
 * background `STATUS_MESSAGE` (favorEvents from applySourceCheck) — the
 * player-facing NARRATION should carry the prose/reaction only, not the
 * numbers ("不要在用户界面上显示结算结果，后面记录就行"). ComfDef narration
 * helpers historically appended `好感度 ±N` for dev visibility; this removes
 * it at the emission boundary so individual defs need not change.
 */
export function stripSettlement(text: string, label: string): string {
  const prose = text
    .replace(/\s*[；;]\s*好感度\s*[+-]?\d+\s*\.?\s*$/u, "")
    .replace(/\s*好感度\s*[+-]?\d+\s*\.?\s*$/u, "")
    .replace(/\s+$/u, "");
  // Migration summaries append the internal ERB command label as a gloss.
  // This is diagnostic metadata, not authored prose or a translation route.
  const gloss = ` — ${label}`;
  if (prose.endsWith(gloss)) return prose.slice(0, -gloss.length);
  // Several migrated defs use a shortened internal gloss (for example the
  // COM123 definition says 足コキする while its fallback ends in 足コキ). The
  // separator appears only in these ComfDef summaries, never in authored
  // TRAIN_MESSAGE text, so remove that trailing metadata here as well.
  return prose.replace(/\s+—\s+[^—；;。.!?！？]+$/u, "");
}

/**
 * Build the `ComfCtx` a ComfDef's builder lambdas receive, against a
 * (cloned, mutable) `next` state and a chosen target. Extracted from the
 * factory so multi-target orchestrators (e.g. 演奏 416's band loop) can
 * construct the SAME context per target and reuse a def's `buildSources`/
 * `body`/scaling without re-deriving the readers. Behavior identical to the
 * factory's former inline construction.
 */
export function buildComfCtx(
  ctx: CommandContext,
  next: GameState,
  targetNum: number,
  outcome: ComfOutcome,
  branch?: string,
): ComfCtx {
  const master = next.master;
  const hasTarget = targetNum > 0 && !!next.charas[targetNum];
  const t = (hasTarget ? next.charas[targetNum] : undefined) as
    | CharaSlot
    | undefined;
  return {
    ctx,
    next,
    t: t as CharaSlot,
    master,
    outcome,
    ...(branch === undefined ? {} : { branch }),
    hasTarget,
    tAbl: (id) => t?.state.ABL[id] ?? 0,
    mAbl: (id) => master.state.ABL[id] ?? 0,
    tCflag: (id) => t?.state.CFLAG[id] ?? 0,
    tTalent: (id) => t?.state.TALENT[id] ?? 0,
    favor: t?.state.CFLAG[CFLAG_ID.好感度] ?? 0,
  };
}

/**
 * Apply the standard SOURCE scaling chain (steps 4-6 of the skeleton) to a
 * mutable `sources` map, in the factory's exact order:
 *   1. per-SOURCE outcome multiplier (大成功/失敗),
 *   2. master-ability scaling (`masterAbility`),
 *   3. TEQUIP/talent modifiers (`tequipMul`).
 * Extracted so an orchestrator can scale each target's SOURCE identically
 * to `makeComfHandler` before applying any cross-target (band) adjustment.
 */
export function applyComfScaling(
  def: ComfDef,
  c: ComfCtx,
  sources: Record<number, number>,
): void {
  if (c.outcome !== 0) {
    for (const idStr of Object.keys(sources)) {
      const id = Number(idStr);
      const mul = def.outcomeMul?.[id] ?? MUL_POSITIVE;
      sources[id] = times(sources[id]!, c.outcome === 1 ? mul.great : mul.fail);
    }
  }
  if (def.masterAbility) {
    const { ablId, table, sourceIds } = def.masterAbility;
    const lvl = c.master.state.ABL[ablId] ?? 0;
    const mul = table[Math.min(lvl, table.length - 1)] ?? 1;
    for (const sid of sourceIds) {
      if (sources[sid] !== undefined) sources[sid] = times(sources[sid]!, mul);
    }
  }
  def.tequipMul?.(c, sources);
}

export function makeComfHandler(def: ComfDef): HandlerEntry {
  const maxRoll = def.maxRoll ?? 100;
  const greatThreshold = def.greatThreshold ?? 5;
  const failThreshold = def.failThreshold ?? 90;
  const requiresTarget = def.requiresTarget ?? true;
  // Merge the faithfully-extracted @COM_ABLE gate (generated from the ERBs)
  // under any gate the ComfDef declares explicitly (the def's fields win).
  const baseExecCheck = def.gateOverride ??
    compileGate(mergedGateFor(def.commandNo, def.gate), requiresTarget, def.label);
  // Slice B/C: an item-gated command (consume or require) gates on holding
  // ≥ qty of the item. 浴室PLAY 地垫门 (bathMatRequired) 同样组合.
  const needsItem = def.consumeItem?.id ?? def.requiresItem;
  const checksHBaseResources =
    requiresHMode(def.commandNo) &&
    (def.downbase !== undefined || def.targetDownbase !== undefined);
  const needsGate = needsItem !== undefined || def.bathMatRequired || checksHBaseResources;

  const checkHBaseResources = (ctx: CommandContext): HBaseResourceCheckResult => {
    if (!requiresHMode(def.commandNo)) return { ok: true };

    const target = ctx.target > 0 ? ctx.state.charas[ctx.target] : undefined;
    if (requiresTarget && !target) return { ok: true };

    const toggleOwner = requiresTarget
      ? target
      : ctx.state.master;
    // An equipped toggle is a removal arm: makeComfHandler returns before
    // DOWNBASE/body/SOURCE, so removal has no resource cost either.
    if (def.toggleTequip !== undefined && toggleOwner && isEquipped(toggleOwner, def.toggleTequip)) {
      return { ok: true };
    }

    const preview = buildComfCtx(ctx, ctx.state, ctx.target, 0);
    const masterCosts = typeof def.downbase === "function"
      ? def.downbase(preview)
      : def.downbase ?? {};
    const targetCosts = def.targetDownbase === undefined || !target
      ? {}
      : typeof def.targetDownbase === "function"
        ? def.targetDownbase(preview)
        : def.targetDownbase;

    return checkHBaseResourceAvailability(ctx, {
      master: masterCosts,
      target: targetCosts,
    });
  };

  const execCheck: ExecCheck | undefined = needsGate
      ? ((ctx: CommandContext) => {
        const qty = def.consumeItem?.qty ?? 1;
        const toggleOwner = requiresTarget
          ? ctx.state.charas[ctx.target]
          : ctx.state.master;
        const isRemovingEquippedItem =
          def.consumeItem === undefined &&
          def.requiresItem !== undefined &&
          def.toggleTequip !== undefined &&
          toggleOwner !== undefined &&
          isEquipped(toggleOwner, def.toggleTequip);
        if (
          needsItem !== undefined &&
          (ctx.state.items?.[needsItem] ?? 0) < qty &&
          !isRemovingEquippedItem
        ) {
          return {
            ok: false as const,
            reason: { kind: "precondition" as const, message: `缺少道具（id ${needsItem}）。` },
          };
        }
        // 浴室PLAY (TEQUIP:31) 中, 塑料地墊 (ITEM 20) 必须 (原版 ERB 286-288).
        if (def.bathMatRequired) {
          const t = ctx.state.charas[ctx.target];
          if (t && isEquipped(t, TEQUIP_ID.浴室PLAY) && (ctx.state.items?.[20] ?? 0) <= 0) {
            return {
              ok: false as const,
              reason: { kind: "precondition" as const, message: "浴室PLAY中，没有塑料地垫。", },
            };
          }
        }
        const baseResult = baseExecCheck ? baseExecCheck(ctx) : { ok: true as const };
        if (!baseResult.ok) return baseResult;
        return checksHBaseResources ? checkHBaseResources(ctx) : { ok: true as const };
      }) as ExecCheck
    : baseExecCheck;

  return {
    commandNo: def.commandNo,
    // Upstream renders each button through `@COM{n}_DISPLAY` — a per-state
    // name (抜く（Ｖ）, 解除跳蛋, 结束接吻…). The shared resolver supplies it for
    // every ComfDef, so a hand-written handler only needs its own displayCheck
    // when it has no upstream `_DISPLAY` (none overlap).
    displayCheck: (ctx: CommandContext) => {
      const label = resolveCommandDisplayName(def.commandNo, ctx.state, ctx.target);
      return label === undefined ? { shown: true } : { shown: true, labelOverride: label };
    },
    ...(execCheck ? { execCheck } : {}),
    ...(def.canExecute ? { canExecute: def.canExecute } : {}),
    ...(def.hModeMenuCheck ? { hModeMenuCheck: def.hModeMenuCheck } : {}),
    handler: (ctx: CommandContext): CommandResult => {
      // 1. Precondition — a present target (default; some commands self-target).
      if (requiresTarget && (ctx.target <= 0 || !ctx.state.charas[ctx.target])) {
        return {
          state: ctx.state as never,
          events: [
            {
              kind: "STATUS_MESSAGE",
              timestamp: ctx.now(),
              source: "system",
              text: `${def.label} requires a present target.`,
            },
          ],
          outcome: "blocked",
          failReason: { kind: "precondition", message: `no target for ${def.label}` },
        };
      }

      const resourceResult = checkHBaseResources(ctx);
      if (!resourceResult.ok) {
        return {
          state: ctx.state as never,
          events: [{
            kind: "STATUS_MESSAGE",
            timestamp: ctx.now(),
            source: "system",
            text: resourceResult.reason.message,
          }],
          outcome: "blocked",
          failReason: resourceResult.reason,
        };
      }

      let next = cloneGameState(ctx.state);
      const master = next.master;

      // Slice C: equipment-toggle command — flip the TEQUIP slot on the
      // target. Already equipped → clear + exit (no settlement), faithful to
      // `TEQUIP:x = !TEQUIP:x` (COMF42 阴蒂夹 etc.). Equipment state lives in
      // the per-chara `state.TEQUIP` namespace (see `state/tequip.ts`) — never
      // in EQUIP, whose slots 11-22 are clothing pieces.
      if (def.toggleTequip !== undefined) {
        const targetSlot = requiresTarget ? next.charas[ctx.target] : next.master;
        if (targetSlot) {
          if (isEquipped(targetSlot, def.toggleTequip)) {
            setEquipped(targetSlot, def.toggleTequip, false);
            return {
              state: next,
              events: [{ kind: "NARRATION", timestamp: ctx.now(), text: def.toggleOffNarration ?? "解除了装备。" }],
              outcome: "noop",
            };
          }
          setEquipped(targetSlot, def.toggleTequip, true);
        }
      }

      // 2. Outcome roll (通常 arm; GET_SUCCESS_RATE deferred → 0).
      const selected = def.resolveOutcome?.(ctx, next);
      const resolution: ComfOutcomeResolution | undefined =
        typeof selected === "object" ? selected : undefined;
      let outcome = resolution?.outcome ?? (typeof selected === "number" ? selected : undefined);
      if (outcome === undefined) {
        const roll = ctx.rng.int(maxRoll);
        outcome = roll < greatThreshold ? 1 : roll >= failThreshold ? -1 : 0;
      }
      for (const [id, value] of Object.entries(resolution?.tflags ?? {})) {
        setTflag(next, Number(id), value);
      }
      if (!resolution || resolution.outcomeFlag === undefined) {
        setTflag(next, TFLAG_ID.SELECTCOM的分岐, outcome);
      } else if (resolution.outcomeFlag !== null) {
        setTflag(next, TFLAG_ID.SELECTCOM的分岐, resolution.outcomeFlag);
      }
      if (next.turnContext?.frame) {
        if (!resolution || resolution.frameOutcome === undefined) {
          next.turnContext.frame.outcome = outcome;
        } else if (resolution.frameOutcome !== null) {
          next.turnContext.frame.outcome = resolution.frameOutcome;
        }
      }
      if (resolution?.returnEarly === "noop") {
        return { state: next, events: [], outcome: "noop" };
      }

      // A present, real target slot. For `requiresTarget` commands this
      // is always true (the precondition above guaranteed it). For
      // master-centric commands (`requiresTarget: false`, the chore
      // family) it is false when the player acted alone — the SOURCE
      // settlement + dialogue are then skipped, but time/downbase/body
      // still run.
      // Self SOURCE ownership is explicit. An incidental focused NPC must not
      // redirect a master-only action into target settlement or personal kojo.
      const c = buildComfCtx(ctx, next, def.settleSourcesOnMaster ? 0 : ctx.target, outcome, resolution?.branch);
      const hasTarget = c.hasTarget;

      // 3. SOURCE build, then 4-6: outcome / master-ability / TEQUIP scaling.
      const sources = def.buildSources(c);
      applyComfScaling(def, c, sources);
      if (hasTarget) snapshotKojoSource(next, ctx.target, sources);
      const masterSources = def.buildMasterSources?.(c);
      if (masterSources) snapshotKojoSource(next, 0, masterSources);

      // 6. Favor pre-bias (e.g. 親密/好感 penalty brackets). Read pre-settlement.
      const favorBias = def.favorBias?.(c) ?? 0;

      // 6.5 Slice B — consume the command's required item before settlement.
      if (def.consumeItem) {
        const { id, qty = 1 } = def.consumeItem;
        removeItem(next, id, qty);
      }

      // 7. Time advance (constant or state-dependent). Capture any day-end
      //    NARRATION the advance produces if it crosses midnight (R1, Phase
      //    8 两图收口) — a command run late at night narrates the wage/
      //    cleaning cashout the same way sleep does. Usually [].
      const baseTimeCost = typeof def.timeCost === "function" ? def.timeCost(c) : def.timeCost;
      const timeCost = applyOneMinuteHCommandTimeCorrection(
        next,
        def.commandNo,
        ctx.target,
        baseTimeCost,
      );
      const dayEndEvents = applyCommandTimeCost(next, timeCost);

      // 7b. DOWNBASE — master BASE drain (体力/気力 consumed by the action).
      //     Positive values = drain (match Emuera's DOWNBASE convention).
      //     Constant or state-dependent (e.g. furniture-gated study cost).
      const downbase =
        typeof def.downbase === "function" ? def.downbase(c) : def.downbase;
      if (downbase) {
        for (const [id, v] of Object.entries(downbase)) {
          const i = Number(id);
          master.state.BASE[i] = (master.state.BASE[i] ?? 0) - v;
        }
      }

      // 7c. Target-side DOWNBASE uses the same declared cost that the H menu
      //     and resolver preflight checked, avoiding a second body-local value.
      const targetDownbase = def.targetDownbase === undefined
        ? undefined
        : typeof def.targetDownbase === "function"
          ? def.targetDownbase(c)
          : def.targetDownbase;
      if (hasTarget && targetDownbase) {
        for (const [id, value] of Object.entries(targetDownbase)) {
          const i = Number(id);
          c.t.state.BASE[i] = (c.t.state.BASE[i] ?? 0) - value;
        }
      }

      // 8. Persisted side writes (EXP / TCVAR markers).
      def.body?.(c);

      // 8b. P1-d: auto-undress the target (mirrors upstream DATUI_LATE).
      //     stripTop/stripBottom return a new GameState (they clone
      //     internally); patch the stripped chara back into local `next`.
      //     No-op when !hasTarget or datui unset.
      if (def.datui && hasTarget && c.t.charaNum !== 0) {
        if (def.datui === "bottom" || def.datui === "both") {
          const stripped = stripBottom(next, c.t.charaNum, 0);
          next.charas[c.t.charaNum] = stripped.charas[c.t.charaNum]!;
        }
        if (def.datui === "top" || def.datui === "both") {
          const stripped = stripTop(next, c.t.charaNum, 0, "target");
          next.charas[c.t.charaNum] = stripped.charas[c.t.charaNum]!;
        }
      }

      // 9. SOURCE settlement → PALAM + CFLAG:好感度. Only when a real
      //    target is present; master-centric commands acting alone
      //    produce no SOURCE quanta to settle.
      let favorDelta = 0;
      let favorEvents: readonly ObservationEvent[] = [];
      let dialogueEvents: ObservationEvent[] = [];
      let kojoHostEvents: ObservationEvent[] = [];
      if (hasTarget) {
        // Settle the master first so target ORGASM_ADD can observe the
        // master's current-turn NOWEX for SYNCED_ORGASM.
        if (masterSources) {
          settleSourcePalam(next, master, master, masterSources);
        }

        // Parity QA P-15 ③ — pass the TRUST_CALC seed when the command drives
        // 信頼度 (most omit → 0 → TRUST_CALC skipped, faithful).
        const trustSeed = def.trustSeed?.(c) ?? 0;
        const settled = applySourceCheck(next, ctx.target, sources, favorBias, trustSeed);
        finalizeTrainingMarkAcquisitionChecks(next, ctx.target);
        favorDelta = settled.favorDelta;
        favorEvents = settled.events;

        // 10. Chara reaction lines (kojo, Phase 6). Suppressed when the
        //     def declares a `kojoGate` that the current context fails
        //     (e.g. 417 昼寝's nap-together kojo only fires when the target
        //     actually naps along — `CFLAG:6 態度 > 0`; a solo / non-qualifying
        //     nap must NOT surface the nap-together kojo upstream gates on
        //     the SOURCE path).
        const kojoAllowed = def.kojoGate ? def.kojoGate(c) : true;
        const generatedHook = ctx.commandNo === 300 && kojoAllowed && ctx.narrativeHookGeneration
          ? selectNarrativeHook(next, ctx.target, ctx.commandNo) : undefined;
        const hookLines = !generatedHook && ctx.commandNo === 300 && kojoAllowed
          ? publishHookFallback(next, ctx.target, ctx.commandNo, `command:${ctx.commandNo}:${ctx.target}:${next.time.tickValue}`)
          : null;
        const kojoResolution =
          ctx.dialogueRouter && kojoAllowed && !hookLines && !generatedHook
            ? ctx.dialogueRouter.collectDetailed?.(ctx.target, ctx.commandNo, next, ctx.rng)
            : undefined;
        const kojoLines = hookLines?.map((text, line) => ({ text, line, form: "PRINTL" as const })) ?? kojoResolution?.lines ??
          (ctx.dialogueRouter && kojoAllowed && !generatedHook
            ? ctx.dialogueRouter.collect(ctx.target, ctx.commandNo, next, ctx.rng)
            : []);
        if (kojoResolution?.effects.length) {
          next = applyKojoEffects(next, kojoResolution.effects);
        }
        dialogueEvents = kojoLines.map((l) => ({
          kind: "DIALOGUE_LINE",
          timestamp: ctx.now(),
          charaNum: ctx.target,
          text: l.text,
          form: l.form,
        }));
        kojoHostEvents = kojoHostEventsToObservationEvents(kojoResolution?.hostEvents, ctx.target, ctx.now);
      } else if (def.settleSourcesOnMaster && Object.keys(sources).length > 0) {
        // Self-pleasure commands have no NPC target, but they still traverse
        // SOURCE_CHECK's converter/ORGASM/afterglow path on MASTER. Do not
        // call applySourceCheck with target 0: chara 0 is the player slot,
        // not an entry in `state.charas`, and it would also run target-only
        // favor/reaction semantics.
        settleSourcePalam(next, master, master, sources);
      }

      const postSettlementNarration = def.afterSettlement?.(c);

      const events: ObservationEvent[] = [
        {
          kind: "NARRATION",
          timestamp: ctx.now(),
          text: stripSettlement(def.narration(c, favorDelta), def.label),
          // Migration-fallback marker: when the authored TRAIN_MESSAGE route
          // produced prose this turn, `withTrainMessage` drops this line so
          // the upstream common narration is not doubled.
          origin: "comf-fallback",
        },
        ...(postSettlementNarration
          ? [{
              kind: "NARRATION" as const,
              timestamp: ctx.now(),
              text: postSettlementNarration,
            }]
          : []),
        ...favorEvents.map((e) => ({ ...e, timestamp: ctx.now() })),
        ...dialogueEvents,
        ...kojoHostEvents,
        // Day-end cashout NARRATION(s) if this command crossed midnight (R1).
        ...dayEndEvents.map((e) => ({ ...e, timestamp: ctx.now() })),
      ];

      return { state: next, events, outcome: "ok", kojoHandled: true };
    },
  };
}
