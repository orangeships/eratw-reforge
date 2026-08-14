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
import { removeItem } from "../../state/items.js";
import {
  CFLAG_ID,
  TEQUIP_ID,
  advanceTimeTicks,
  times,
} from "../../state/settlement.js";
import { applySourceCheck, settleSourcePalam } from "../source-check.js";
import { stripBottom, stripTop } from "../../state/clothing-write.js";
import { isEquipped, setEquipped } from "../../state/tequip.js";
import { applyKojoEffects } from "../../kojo/effects.js";
import { kojoHostEventsToObservationEvents } from "../command-kojo.js";
import { setTflag, snapshotKojoSource } from "../../state/tflag.js";
import { compileGate, mergedGateFor } from "./compile-gate.js";
import {
  MUL_POSITIVE,
  type ComfCtx,
  type ComfDef,
  type ComfOutcome,
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
function stripSettlement(text: string): string {
  return text
    .replace(/\s*[；;]\s*好感度\s*[+-]?\d+\s*\.?\s*$/u, "")
    .replace(/\s*好感度\s*[+-]?\d+\s*\.?\s*$/u, "")
    .replace(/\s+$/u, "");
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
  const baseExecCheck = compileGate(mergedGateFor(def.commandNo, def.gate), requiresTarget, def.label);
  // Slice B/C: an item-gated command (consume or require) gates on holding
  // ≥ qty of the item. 浴室PLAY 地垫门 (bathMatRequired) 同样组合.
  const needsItem = def.consumeItem?.id ?? def.requiresItem;
  const needsGate = needsItem !== undefined || def.bathMatRequired;
  const execCheck: ExecCheck | undefined = needsGate
    ? ((ctx: CommandContext) => {
        const qty = def.consumeItem?.qty ?? 1;
        if (needsItem !== undefined && (ctx.state.items?.[needsItem] ?? 0) < qty) {
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
        return baseExecCheck ? baseExecCheck(ctx) : { ok: true as const };
      }) as ExecCheck
    : baseExecCheck;

  return {
    commandNo: def.commandNo,
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
              events: [{ kind: "NARRATION", timestamp: ctx.now(), text: "解除了装备。" }],
              outcome: "noop",
            };
          }
          setEquipped(targetSlot, def.toggleTequip, true);
        }
      }

      // 2. Outcome roll (通常 arm; GET_SUCCESS_RATE deferred → 0).
      const roll = ctx.rng.int(maxRoll);
      const outcome: ComfOutcome = roll < greatThreshold ? 1 : roll >= failThreshold ? -1 : 0;
      setTflag(next, 193, outcome);
      if (next.turnContext?.frame) next.turnContext.frame.outcome = outcome;

      // A present, real target slot. For `requiresTarget` commands this
      // is always true (the precondition above guaranteed it). For
      // master-centric commands (`requiresTarget: false`, the chore
      // family) it is false when the player acted alone — the SOURCE
      // settlement + dialogue are then skipped, but time/downbase/body
      // still run.
      const c = buildComfCtx(ctx, next, ctx.target, outcome);
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
      const timeCost = typeof def.timeCost === "function" ? def.timeCost(c) : def.timeCost;
      const dayEndEvents = advanceTimeTicks(next, timeCost);

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
        // Parity QA P-15 ③ — pass the TRUST_CALC seed when the command drives
        // 信頼度 (most omit → 0 → TRUST_CALC skipped, faithful).
        const trustSeed = def.trustSeed?.(c) ?? 0;
        const settled = applySourceCheck(next, ctx.target, sources, favorBias, trustSeed);
        favorDelta = settled.favorDelta;
        favorEvents = settled.events;

        // 9b. Master's own SOURCE (`SOURCE:PLAYER:*`) for dual-participant
        //     commands — settled into the master's PALAM without 好感度
        //     (B1b). EraTW pre-scales the master's pleasure by the master's
        //     own state; we settle it with the master as subject.
        if (masterSources) {
          settleSourcePalam(next, master, master, masterSources);
        }

        // 10. Chara reaction lines (kojo, Phase 6). Suppressed when the
        //     def declares a `kojoGate` that the current context fails
        //     (e.g. 417 昼寝's nap-together kojo only fires when the target
        //     actually naps along — `CFLAG:6 態度 > 0`; a solo / non-qualifying
        //     nap must NOT surface the nap-together kojo upstream gates on
        //     the SOURCE path).
        const kojoAllowed = def.kojoGate ? def.kojoGate(c) : true;
        const kojoResolution =
          ctx.dialogueRouter && kojoAllowed
            ? ctx.dialogueRouter.collectDetailed?.(ctx.target, ctx.commandNo, next, ctx.rng)
            : undefined;
        const kojoLines = kojoResolution?.lines ??
          (ctx.dialogueRouter && kojoAllowed
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
      }

      const events: ObservationEvent[] = [
        {
          kind: "NARRATION",
          timestamp: ctx.now(),
          text: stripSettlement(def.narration(c, favorDelta)),
        },
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
