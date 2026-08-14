/**
 * Phase 7 (Wave 2c) — B9 interactive-prompt abstraction.
 *
 * ERA's `ASK_YN` / `INPUT` / `ASK_M` block for player input mid-command.
 * The modern runtime's resolver is **synchronous** (`handler(ctx) →
 * CommandResult`, no pause-for-input), so a B9 command is modeled as a
 * **prompt spec + pre-attached answer**:
 *
 *   1. The UI calls `entry.prompt(ctx)` (a pure function of state) to get
 *      a `PromptSpec` (question + options). `null` ⇒ no prompt needed,
 *      issue immediately.
 *   2. The UI renders the picker (reusing the InteractionBox sub-loop),
 *      captures the player's choice, and attaches it as
 *      `IssueCommandIntent.promptAnswer`.
 *   3. The resolver forwards `promptAnswer` into `CommandContext`; the
 *      handler reads it via {@link requirePickOne} / {@link requireYesNo}
 *      and settles synchronously.
 *
 * No LLM, no async, fully deterministic. Tests pin settlement by passing
 * `promptAnswer` directly to the context (the UI is never exercised).
 *
 * The handler is the single source of truth for what the chosen option
 * *means* — the prompt only carries an opaque option `id`. This keeps the
 * prompt a pure presentation concern and the settlement a pure function,
 * matching the rest of the command runtime.
 */

/** The four ERA input shapes this abstraction covers. */
export type PromptKind = "ask_yn" | "pick_one" | "pick_many" | "free_text";

/** One selectable choice. `id` is opaque to the prompt layer. */
export interface PromptOption {
  id: number | string;
  label: string;
  /** Optional flavor / price / detail shown under the label. */
  detail?: string;
  /** Present + true ⇒ shown greyed, not selectable (ERA `PRINTLC … disabled`). */
  disabled?: boolean;
}

/** A prompt the UI must answer before the command settles. */
export interface PromptSpec {
  kind: PromptKind;
  question: string;
  options: PromptOption[];
}

/**
 * The player's answer. Discriminated by `kind` so a handler can narrow
 * without runtime checks. Mirrors {@link PromptKind}.
 */
export type PromptAnswer =
  | { kind: "ask_yn"; value: boolean }
  | { kind: "pick_one"; value: number | string }
  | { kind: "pick_many"; value: (number | string)[] }
  | { kind: "free_text"; value: string }
  /**
   * Internal continuation payload for a staged prompt. It is never rendered
   * directly and deliberately cannot validate against a PromptSpec; the
   * owning handler interprets the accumulated selections.
   */
  | { kind: "pick_sequence"; values: (number | string)[] };

// ---------------------------------------------------------------------------
// Spec builders (handlers / prompt functions use these to declare a prompt)
// ---------------------------------------------------------------------------

/** ERA `ASK_YN("はい","いいえ")` — a two-option yes/no. */
export function askYn(
  question: string,
  yesLabel = "はい",
  noLabel = "いいえ",
): PromptSpec {
  return {
    kind: "ask_yn",
    question,
    // ids 1/0 mirror ERA ASK_YN's RESULT (1=yes, 0=no); the `yesno`
    // answer carries a boolean, so these ids are display-only.
    options: [
      { id: 1, label: yesLabel },
      { id: 0, label: noLabel },
    ],
  };
}

/** ERA `INPUT` over a fixed option list (single select). */
export function pickOne(question: string, options: PromptOption[]): PromptSpec {
  return { kind: "pick_one", question, options };
}

/** ERA multi-select `INPUT` (e.g. buy several items at once). */
export function pickMany(question: string, options: PromptOption[]): PromptSpec {
  return { kind: "pick_many", question, options };
}

/**
 * Free-text input — ERA `INPUTS` (single-line raw text from the player).
 * Faithful to COMF406 日記を書く / diary-text entry. `placeholder` is shown
 * in the input box when empty; `multiline` flips between INPUTS (single
 * line) and the modern textarea widget (multi-line). Empty `options` —
 * the value is the text itself, not an option id.
 */
export function freeText(
  question: string,
  options: { placeholder?: string; multiline?: boolean; submitLabel?: string } = {},
): PromptSpec {
  return {
    kind: "free_text",
    question,
    options: [],
    // The text-input controls ride along on the spec but don't participate
    // in option-id validation (free_text value is the raw string).
    ...(options.placeholder ? { placeholder: options.placeholder } : {}),
    ...(options.multiline ? { multiline: true } : {}),
    ...(options.submitLabel ? { submitLabel: options.submitLabel } : {}),
  } as PromptSpec;
}

// ---------------------------------------------------------------------------
// Answer builders (tests / UI use these to construct a `PromptAnswer`)
// ---------------------------------------------------------------------------

export function yesNoAnswer(value: boolean): PromptAnswer {
  return { kind: "ask_yn", value };
}
export function pickOneAnswer(value: number | string): PromptAnswer {
  return { kind: "pick_one", value };
}
export function pickManyAnswer(value: (number | string)[]): PromptAnswer {
  return { kind: "pick_many", value };
}
export function freeTextAnswer(value: string): PromptAnswer {
  return { kind: "free_text", value };
}

// ---------------------------------------------------------------------------
// Validation (the only real logic — keep it pure + tested)
// ---------------------------------------------------------------------------

/** Find a non-disabled option by id, else `undefined`. */
export function findOption(
  spec: PromptSpec,
  id: number | string,
): PromptOption | undefined {
  return spec.options.find((o) => o.id === id && !o.disabled);
}

/**
 * Validate `answer` against `spec`: kind matches, every chosen id exists
 * and is enabled. Returns the resolved value(s) on success, or `null` if
 * the answer is missing / wrong kind / selects a disabled or absent
 * option. Handlers treat `null` as "no valid answer → block" (a B9
 * command cannot settle without its input).
 */
export function resolveAnswer(
  spec: PromptSpec,
  answer: PromptAnswer | undefined,
): { ok: true; value: boolean | number | string | (number | string)[] } | {
  ok: false;
} {
  if (!answer || answer.kind !== spec.kind) return { ok: false };
  // Switch on `answer.kind` (narrowed to match `spec.kind` above) so TS
  // narrows the discriminated `value` per case.
  switch (answer.kind) {
    case "ask_yn":
      return { ok: true, value: answer.value };
    case "pick_one": {
      const opt = findOption(spec, answer.value);
      return opt ? { ok: true, value: opt.id } : { ok: false };
    }
    case "pick_many": {
      const resolved: (number | string)[] = [];
      for (const id of answer.value) {
        const opt = findOption(spec, id);
        if (!opt) return { ok: false };
        resolved.push(opt.id);
      }
      return { ok: true, value: resolved };
    }
    case "free_text": {
      // Free-text always succeeds — the string is the answer, even if empty
      // (the handler decides whether empty text means "skip" or "block").
      return { ok: true, value: answer.value };
    }
  }
}

// ---------------------------------------------------------------------------
// Handler-side readers (the ergonomic surface handlers call)
// ---------------------------------------------------------------------------

/**
 * Read & validate a single-select answer from the context's promptAnswer.
 * Returns the chosen option `id`, or `null` if absent/invalid (handler
 * should then `return blocked` — the player must pick first).
 */
export function requirePickOne(
  spec: PromptSpec,
  answer: PromptAnswer | undefined,
): number | string | null {
  const r = resolveAnswer(spec, answer);
  if (!r.ok) return null;
  return r.value as number | string;
}

/**
 * Read & validate a yes/no answer. `null` if absent/invalid (handler
 * should treat as "not confirmed" → block or noop per the command).
 */
export function requireYesNo(
  answer: PromptAnswer | undefined,
): boolean | null {
  if (!answer || answer.kind !== "ask_yn") return null;
  return answer.value;
}
