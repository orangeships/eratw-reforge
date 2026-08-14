/**
 * Phase 5A — Command runtime type contracts.
 *
 * This file is types-only: no runtime exports, no side effects. Every
 * later Phase 5/6/7 slice that writes a handler, runs an exec check,
 * or interprets a `CommandResult` conforms to the shapes locked here.
 *
 * Architectural commitment (phase-5-spec.md D5): eraTW modernization
 * is runtime modernization, not gameplay redesign. Handlers receive
 * `Readonly<GameState>` and return a cloned + mutated `GameState` —
 * they do not mutate the input. This makes every handler a pure
 * function and keeps settlement testable (CLAUDE.md §设计约束).
 *
 * The locked outcome is intentionally narrow: a handler never throws,
 * never references external state, never I/O's. All side effects flow
 * through the `CommandResult.events` array and the cloned `state`.
 */

import type { GameState } from "../state/index.js";
import type { ObservationEvent } from "../../schemas/types.js";
import type { DialogueRouter } from "../kojo/types.js";
import type { DomainTransition } from "../state/domain-transition.js";

export interface CommandKojoChoiceSession {
  kind: "command";
  charaNum: number;
  commandNo: number;
  seed: number;
  choices: readonly number[];
  options: readonly { label: string }[];
  /** Opaque in-memory KojoVM continuation. It is deliberately not part of
   * saved GameState and is cancelled when its owning dialogue session closes. */
  continuationId?: string;
  continuationValues?: readonly (number | string)[];
  continuationInputMode?: "number" | "string";
}

/** Result classification for `resolveCommand` and every `CommandHandler`. */
export type Outcome = "ok" | "blocked" | "noop";

/**
 * Read-only context passed to every `CommandHandler`, `ExecCheck`, and
 * `DisplayCheck`. Handlers receive a `Readonly<GameState>` and must
 * return a NEW `GameState` in `CommandResult.state`. Mutating the
 * input is a type-system violation (the `Readonly` is structural).
 */
export interface CommandContext {
  readonly state: Readonly<GameState>;
  /** Issuer of the command. 0 = MASTER (player). */
  readonly actor: number;
  /**
   * Focused chara the command targets (e.g. the `TARGET` in `COMF300
   * 会話` — the chara the player is talking to). For commands without
   * an explicit target (e.g. `移動` toward a location), the resolver
   * defaults this to `actor` (player targeting self / the world).
   * IssueCommandIntent does not carry a `target` field at 5A; 5B+ may
   * add it as a schema change.
   */
  readonly target: number;
  /** The command number from `commands.json`. */
  readonly commandNo: number;
  /**
   * Deterministic seeded RNG. Same seed → byte-identical sequence,
   * so 5B+ hand-traced ERB fixtures stay reproducible. Replaces ERA
   * BASIC `RAND n` semantics: `int(max)` returns `[0, max)`.
   */
  readonly rng: Rng;
  /** Stable seed used to replay an interactive authored-kojo choice. */
  readonly rngSeed?: number;
  /**
   * Wall-clock source for `ObservationEvent.timestamp` fields. The
   * resolver forwards its `ResolverDeps.now` here (defaulting to
   * `Date.now`). Tests pass a fixed value for snapshot stability;
   * production uses real wall-clock time.
   *
   * Added in 5B so handlers can emit deterministic timestamps in
   * their emitted events (the resolver only stamps its OWN events
   * — handlers must stamp their own).
   */
  readonly now: () => number;
  /**
   * Optional kojo router (Phase 6.4). The resolver forwards whatever
   * `ResolverDeps.dialogueRouter` was set to. Handlers call
   * `ctx.dialogueRouter?.collect(target, commandNo, state, rng)` to
   * get the chara's reaction lines. If the resolver wasn't given a
   * router (legacy / unit-test paths) this is `undefined` and the
   * handler falls back to its canned NARRATION.
   */
  readonly dialogueRouter?: DialogueRouter;
  /**
   * Optional B9 prompt answer (Phase 7 Wave 2c). When a `HandlerEntry`
   * declares a `prompt`, the UI captures the player's choice and attaches
   * it to the `IssueCommandIntent`; the resolver forwards it here. The
   * handler reads it via `requirePickOne` / `requireYesNo` (see
   * `prompt.ts`). Absent ⇒ the handler blocks (a B9 command can't settle
   * without its input) or auto-defaults per its own design.
   */
  readonly promptAnswer?: import("./prompt.js").PromptAnswer;
}

/** Seedable RNG surface. See `rng.ts` for the implementation. */
export interface Rng {
  /** Float in `[0, 1)`. */
  next(): number;
  /** Integer in `[0, max)` — matches ERA BASIC `RAND n` (inclusive-exclusive). */
  int(max: number): number;
  /** One element of `arr`, chosen uniformly. */
  pick<T>(arr: readonly T[]): T;
}

/**
 * Handler return type. `state` is a fresh `GameState` (handlers clone
 * + mutate); `events` is the list of `ObservationEvent`s the handler
 * produced (the resolver prepends its own events, e.g. `WARN`, around
 * the handler's output). `outcome` discriminates ok / blocked / noop.
 */
export interface CommandResult {
  readonly state: GameState;
  readonly events: readonly ObservationEvent[];
  readonly outcome: Outcome;
  readonly failReason?: FailReason;
  readonly pendingKojoChoice?: CommandKojoChoiceSession;
  /** The handler already dispatched the command's personal-kojo route (or
   * deliberately owns a deferred scene-specific dispatch such as fishing).
   * The resolver uses this to avoid duplicate dialogue/effect commits. */
  readonly kojoHandled?: boolean;
  readonly transitions?: readonly DomainTransition[];
}

/**
 * Discriminated union describing WHY a command did not run. The
 * resolver emits one of these in `CommandResult.failReason` for the
 * `blocked` and `noop` outcomes; handlers may also return one.
 */
export type FailReason =
  | { kind: "com_able"; code: number; message: string }
  | { kind: "precondition"; message: string }
  | { kind: "unknown_command"; commandNo: number };

/**
 * Pre-execution check — runs BEFORE the handler. If `ok: false`, the
 * resolver returns `outcome: "blocked"` without calling the handler.
 * Ports the ERB `@COM_ABLExxx` function family.
 */
export type ExecCheck = (
  ctx: CommandContext,
) => { ok: true } | { ok: false; reason: FailReason };

/**
 * UI display check — decides whether the command should appear in the
 * command grid at all, and what tone (normal / disabled / hidden) the
 * UI should render it with. Ports the ERB `@COMxxx_DISPLAY` family.
 * 5A defines the shape; 5B+ handlers attach concrete implementations.
 */
export type DisplayCheck = (
  ctx: CommandContext,
) => { shown: boolean; tone?: "normal" | "disabled" | "hidden"; labelOverride?: string };

/** Fidelity status of a command's upstream `@COM_ABLE` implementation. */
export type GateStatus = "complete" | "unsupported" | "missing";

/** A handler is a pure function: `(ctx) => newState + events + outcome`. */
export type CommandHandler = (ctx: CommandContext) => CommandResult;

/**
 * Bundle of all the catalog-tracked parts of a single command. The
 * catalog (`catalog.ts`) registers `HandlerEntry`s, not bare handlers.
 *
 * `execCheck` and `displayCheck` are optional. The resolver treats a missing
 * `execCheck` as no additional dynamic predicate, but normal command
 * availability still requires a `complete` generated/manual gate audit.
 * `displayCheck` can further hide or relabel an audited command.
 */
export interface HandlerEntry {
  commandNo: number;
  handler: CommandHandler;
  execCheck?: ExecCheck;
  /**
   * Command-specific Act_COM state gate for non-baseline H commands.
   *
   * A clean training session exposes only the upstream baseline actions.
   * Positions, insertions, and equipment-dependent commands must opt in here
   * once their TEQUIP/TCVAR/pose state has a canonical runtime model. Missing
   * checks fail closed instead of inheriting visibility from the whole H
   * family. This is a menu gate; `canExecute` remains the later CAN_COM wall.
   */
  hModeMenuCheck?: ExecCheck;
  /** Execution-only CAN_COM predicate. Menu availability still uses
   * `execCheck`/`displayCheck`; the resolver runs this after the menu gate. */
  canExecute?: ExecCheck;
  displayCheck?: DisplayCheck;
  /**
   * Optional manual gate-audit override. Without one, command availability
   * uses the generated upstream `@COM_ABLE` audit for this command number.
   * `unsupported` and `missing` commands are hidden in normal play.
   */
  gateStatus?: GateStatus;
  gateDiagnostics?: readonly string[];
  /**
   * Optional B9 prompt (Phase 7 Wave 2c). A pure function of state that
   * returns the {@link PromptSpec} the UI must answer before the command
   * settles (ERA `ASK_YN` / `INPUT` / `ASK_M`). `null` / absent ⇒ no
   * prompt, issue immediately. The UI calls this BEFORE issuing the
   * intent, captures the choice as `IssueCommandIntent.promptAnswer`,
   * and the resolver forwards it to `CommandContext.promptAnswer`. The
   * handler then reads it via `requirePickOne` / `requireYesNo`. See
   * `prompt.ts`.
   */
  prompt?: (ctx: CommandContext) => import("./prompt.js").PromptSpec | null;
  /**
   * Opt in to prompt continuation. The store re-enters `prompt` with the
   * prior choices as a `pick_sequence` until it returns null, then settles
   * the command once. This keeps multi-screen ERA menus out of saved state.
   */
  stagedPrompt?: boolean;
  /**
   * Optional Parity QA P-7 marker: this command's `@COM_ABLE` passes
   * (it is faithfully usable upstream) but its `@COM` body is a deferred
   * stub — the handler returns `outcome: "blocked"` with a "not yet
   * modeled" NARRATION rather than settling. The UI greys these + labels
   * 「未实现」 so the player isn't lured into a clickable-but-ineffective
   * button. Distinct from execCheck-blocked commands (those are hidden
   * entirely, faithfully). Leave unset for real handlers.
   */
  deferred?: boolean;
}
