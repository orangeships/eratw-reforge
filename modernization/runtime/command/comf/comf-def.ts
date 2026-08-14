/**
 * Phase 7.0 — `ComfDef`: the parameterized command-settlement schema.
 *
 * Two independent ERB surveys (2026-06-17) found ~95% of eraTW's daily
 * commands share ONE settlement skeleton — they differ only in
 * coefficients. `ComfDef` captures that skeleton's variable parts so a
 * single factory (`makeComfHandler`) can express the bulk of Phase 7
 * as data + small builder lambdas instead of bespoke handlers.
 *
 * The skeleton the factory runs (see `make-comf-handler.ts`):
 *   1. precondition (present target)
 *   2. outcome roll: `roll = RAND:maxRoll`; `< greatThreshold` → 大成功(1),
 *      `>= failThreshold` → 失敗(-1), else 通常(0)
 *   3. `buildSources(c)` → transient SOURCE quanta
 *   4. per-SOURCE outcome multiplier (大成功/失敗 scaling)
 *   5. optional master-ability scaling (e.g. 話術技能 on 会話's sources)
 *   6. optional TEQUIP (equipment) TIMES modifiers on SOURCE quanta
 *   7. `advanceTimeTicks(timeCost)`
 *   8. optional DOWNBASE (BASE drain on master 体力/気力 etc.)
 *   9. `body(c)` — persisted side writes (EXP / TCVAR markers / 累計)
 *  10. `applySourceCheck(sources, favorBias)` → PALAM + CFLAG:好感度
 *  11. NARRATION + kojo `DIALOGUE_LINE`s
 *
 * What stays DEFERRED (uniformly, same as the hand-written 5D/5E ports):
 * the FAVOR_CALC 日常時 BASE/情緒/理性 block, TRUST_CALC, TALENT/MARK/DLC
 * personality modifiers, and every flag-gated arm off in a clean state —
 * all live in `source-check.ts` and are deferred there, not per-command.
 */

import type { GameState, CharaSlot } from "../../state/game-state.js";
import type { CommandContext, ExecCheck } from "../types.js";

/** ERB outcome flag (TFLAG:193): 1 大成功 / 0 通常 / -1 失敗. */
export type ComfOutcome = 1 | 0 | -1;

/**
 * The context every `ComfDef` builder lambda receives. Readers default
 * missing slots to 0 (the additive-slot convention, 5C Issue 3). `t` is
 * the (cloned, mutable) target slot, `master` the player; `favor` is the
 * target's `CFLAG:好感度` read BEFORE settlement (converters and the
 * favor brackets both read the pre-command value).
 */
export interface ComfCtx {
  readonly ctx: CommandContext;
  /** The cloned, mutable next-state (body lambdas write persisted slots here). */
  readonly next: GameState;
  /** Target slot (mutable). */
  readonly t: CharaSlot;
  /** Master/player slot (mutable). */
  readonly master: CharaSlot;
  /** Rolled outcome (great/normal/fail). */
  readonly outcome: ComfOutcome;
  /**
   * Whether a real present target slot exists. Always `true` for
   * `requiresTarget` commands. For master-centric commands
   * (`requiresTarget: false`, e.g. the chore family) this is `false`
   * when the player acted with no helping chara present — in that case
   * the target accessors all return 0 and `buildSources` should return
   * `{}` (no SOURCE settlement fires).
   */
  readonly hasTarget: boolean;
  /** Target ABL reader (default 0; returns 0 when `!hasTarget`). */
  tAbl(id: number): number;
  /** Master ABL reader (default 0). */
  mAbl(id: number): number;
  /** Target CFLAG reader (default 0). */
  tCflag(id: number): number;
  /** Target TALENT reader (default 0). */
  tTalent(id: number): number;
  /** Target `CFLAG:好感度` read before settlement. */
  readonly favor: number;
}

/** Per-SOURCE outcome scaling: `great` on 大成功, `fail` on 失敗 (×1 on 通常). */
export interface OutcomeMul {
  great: number;
  fail: number;
}

/** 歓楽 / 各種快感 — boosted hard on success, gutted on fail. */
export const MUL_PLEASURE: OutcomeMul = { great: 2.0, fail: 0.1 };
/** 情愛 / 受動 / 征服 / 欲情 … — the common positive-source scaling. */
export const MUL_POSITIVE: OutcomeMul = { great: 2.0, fail: 0.5 };
/** 反感 / 苦痛 … — INVERTED: damped on success, amplified on fail. */
export const MUL_NEGATIVE: OutcomeMul = { great: 0.75, fail: 1.5 };
/** No outcome scaling. */
export const MUL_NONE: OutcomeMul = { great: 1.0, fail: 1.0 };

/** Master-ability scaling applied to a set of SOURCE ids after the outcome multiplier. */
export interface MasterAbilityScale {
  /** The ABL id read off the master (e.g. ABL_ID.話術技能). */
  ablId: number;
  /** Multiplier table indexed by ability level (clamped to last entry). */
  table: number[];
  /** The SOURCE ids this scaling applies to. */
  sourceIds: number[];
}

/**
 * Phase 8 (Slice 7) — declarative `@COM_ABLE` gate spec.
 *
 * An ERB survey of the 130 ComfDef `@COM_ABLE<NNN>` blocks found the
 * *modelable* guards (the ones whose state we actually track) recur as a
 * small fixed cluster; the factory compiles this spec into the command's
 * `execCheck`. Everything else (`TEQUIP:*` equipment, `ASSI:*` assistant,
 * `ITEM:*`/`NOITEM`, `INROOM`/`BATHROOM`/`BEDROOM`, `挿入不可`,
 * `GLOBAL_COMABLE`, `IS_DATING_WITH_PLAYER`) stays DEFERRED — list those in
 * `deferredGates` so the omission is documented, not silent.
 *
 * Every field is optional and defaults to "no gate". A command with no
 * `gate` keeps the factory's legacy behavior (no-target check only). The
 * compiled check runs the requested guards in upstream order and returns
 * the first failure's reason.
 */
export interface ComfGate {
  /**
   * Exact blocking expressions from upstream `SIF <expr> / RETURN 0`.
   * Each expression blocks when it evaluates true. This preserves compound
   * polarity that cannot be represented by the legacy boolean fields.
   */
  semanticBlockers?: readonly import("./semantic-gate.js").SemanticGateExpression[];
  /** `SIF CFLAG:睡眠 → RETURN 0` — target asleep blocks. */
  notWhileTargetSleeping?: boolean;
  /** `SIF CFLAG:陪睡中 → RETURN 0` — target co-sleeping blocks. */
  notWhileCoSleeping?: boolean;
  /** `SIF CFLAG:恶作剧 → RETURN 0` — target in sleep-prank mode blocks. */
  notWhilePranking?: boolean;
  /** `SIF CFLAG:行動 == 5 → RETURN 0` — target working blocks. */
  notWhileTargetWorking?: boolean;
  /** `SIF BASE:MASTER:気力 <= 0 → RETURN 0` — master 気力 exhausted blocks. */
  requiresMasterStamina?: boolean;
  /** `SIF FLAG:70 → RETURN 0` — time-stop active blocks (most daily cmds). */
  notWhileTimeStopped?: boolean;
  /** `SIF CFLAG:MASTER:诶嘿嘿 → RETURN 0` — master cannot use this in H-mode. */
  notWhileMasterHMode?: boolean;
  /** `SIF !(TALENT:2 & 1) → RETURN 0` — target must be female (bit0 of 性別). */
  requiresFemaleTarget?: boolean;
  /** `SIF TCVAR:MASTER:亲热 < n → RETURN 0` — minimum 亲热 (skinship) level. */
  minIntimacy?: number;
  /**
   * `SIF TIME_PROGRESS(TCVAR:<id>) < <minutes> → RETURN 0` — per-target
   * cooldown: the command can't re-fire until `minutes` of game-time have
   * passed since the timestamp stored in `TCVAR:<tcvarId>`. `{ tcvarId,
   * minutes }`.
   */
  cooldown?: { tcvarId: number; minutes: number };
  /** `SIF !INROOM(現在位置) → RETURN 0` — indoors only (膝枕/索求膝枕 等). */
  requiresIndoor?: boolean;
  /** `SIF BATHROOM()/BATHCHECK(現在位置) → RETURN 0` — not in a bath. */
  notWhileBath?: boolean;
  /** `SIF 現在位置 != 私室 && !休憩可(現在位置) → RETURN 0` — private/rest room
   *  only (休憩/昼寝). Approximated by the room's `private` property. */
  requiresPrivateRoom?: boolean;
  /** `SIF CFLAG:MASTER:現在位置 != CFLAG:MASTER:311 → RETURN 0` — master
   *  must be in their own initial room (`CFLAG:初期位置`, the modern
   *  `state.homeLocation`). Stricter than `requiresPrivateRoom`: blocks
   *  naps at any private room except the player's own. Used by 417 昼寝
   *  (faithful to `COMF417 昼寝する.ERB:119`). */
  atMasterHome?: boolean;
  /** `SIF !戦闘訓練可(現在位置) → RETURN 0` — a training-capable place only
   *  (戦闘訓練). Approximated by the room's `training` property. */
  requiresTrainingRoom?: boolean;
  /** `SIF !勉強可(現在位置) → RETURN 0` — a study-capable place only
   *  (勉強). Modeled by the room's `場所_学习` bit. */
  requiresStudyRoom?: boolean;
  /** `@COM_ABLE440` wait location gate — only base entrances and selected
   *  public field-map spots. */
  requiresWaitSpot?: boolean;
  /** `SIF CFLAG:職種 != JOB_酔いつぶれる → RETURN 0` — the target must be
   *  passed-out drunk (照料/介抱). Modeled via `CFLAG:職種`/`酔いつぶれ`. */
  requiresDrunkTarget?: boolean;
  /** `SIF CFLAG:職種 != JOB_宴会参加 → RETURN 0` — the target must be a
   *  banquet participant (碰杯/杯を交わす). The banquet/job subsystem isn't
   *  modeled → 職種 is never 49 → this gate blocks faithfully (碰杯 only
   *  appears during a banquet, which our runtime never hosts). */
  requiresBanquetParticipant?: boolean;
  /** `SIF CFLAG:诶嘿嘿 == 2 → RETURN 0` — block while the target is in
   *  partner-led (逆推) H-mode (戦闘訓練). */
  notWhilePartnerLedH?: boolean;
  /** `NEMUKE()` sleepiness bounds — block unless `min <= NEMUKE(state)`
   *  and `NEMUKE(state) <= max` (either bound optional). 403 休憩
   *  `NEMUKE >= 960 → RETURN 0` ⇒ `{ max: 959 }`; 417 昼寝
   *  `180 ≤ NEMUKE ≤ 720` ⇒ `{ min: 180, max: 720 }`. Parity QA Wave 7. */
  nemuke?: { min?: number; max?: number };
  /** `SIF TFLAG:<id> > 0 → RETURN 0` — block while a TFLAG entry is
   *  set (nonzero). Used by 417 昼寝's 1/day gate (`TFLAG:昼寝(198) > 0`,
   *  set to 90 in the @COM body, reset at day-end). */
  blocksIfTflagSet?: number;
  /**
   * Modelable gates this command has that the spec above doesn't yet cover
   * (free-form notes, e.g. a bespoke favor threshold) — informational.
   * AND the unmodelable upstream gates we deliberately skip (TEQUIP/ASSI/
   * ITEM/room/挿入不可). Documents the omission; not executed.
   */
  deferredGates?: string;
}

/**
 * One command's settlement definition. `buildSources` and `narration`
 * are required; everything else is optional with faithful defaults
 * (maxRoll 100, greatThreshold 5, failThreshold 90, requiresTarget true,
 * per-source multiplier MUL_POSITIVE).
 */
export interface ComfDef {
  commandNo: number;
  /** Human label for the blocked message + default narration. */
  label: string;
  /** Optional execution-only CAN_COM predicate. It must not hide the menu
   * entry; the resolver checks it immediately before settlement. */
  canExecute?: ExecCheck;
  /** Opt-in Act_COM state gate for a non-baseline H command. See HandlerEntry. */
  hModeMenuCheck?: ExecCheck;
  /**
   * Phase 8 Slice 7 — declarative `@COM_ABLE` gate. Compiled by the factory
   * into the entry's `execCheck` (the upstream command-availability test).
   * Absent ⇒ no gate beyond the no-target check (legacy behavior). The
   * always-present `SIF !TFLAG:100` / `SIF GLOBAL_COMABLE(N)` preamble is
   * the command-system master switch / per-save override — both default to
   * "enabled" in our runtime, so they're intentionally not modeled here.
   */
  gate?: ComfGate;
  /**
   * Minutes the command costs (ERB `TIME += …`). Either a constant or a
   * function of the context — the latter for state-dependent costs (e.g.
   * `412 勉強`'s weather-gated 30/45/60 min, `304`'s per-jobType TIME).
   */
  timeCost: number | ((c: ComfCtx) => number);
  /** Outcome-roll upper bound (`RAND:maxRoll`). Default 100. */
  maxRoll?: 100 | 110;
  /** `roll < greatThreshold` → 大成功. Default 5. */
  greatThreshold?: number;
  /** `roll >= failThreshold` → 失敗. Default 90 (GET_SUCCESS_RATE deferred → 0). */
  failThreshold?: number;
  /** Whether a present target is required. Default true. */
  requiresTarget?: boolean;
  /** Build the transient SOURCE quanta (id → value) before scaling. */
  buildSources(c: ComfCtx): Record<number, number>;
  /**
   * Build the MASTER's own SOURCE quanta (`SOURCE:PLAYER:*`) for
   * dual-participant commands (intercourse etc.). Settled into the
   * master's PALAM WITHOUT the 好感度 machinery. Omit for single-
   * participant commands. (B1b)
   */
  buildMasterSources?(c: ComfCtx): Record<number, number>;
  /** Per-SOURCE outcome multipliers. Missing ids default to MUL_POSITIVE. */
  outcomeMul?: Record<number, OutcomeMul>;
  /** Optional `TFLAG:97` pre-seed (e.g. 親密/好感 penalty brackets). */
  favorBias?(c: ComfCtx): number;
  /**
   * Optional `TFLAG:信頼度管理` seed for TRUST_CALC (Parity QA P-15 ③). When a
   * command drives 信頼度 (positive = trust up on success, negative = down on a
   * failed command), return the seed here; `applySourceCheck` runs TRUST_CALC
   * with it (gated on awake / not 诶嘿嘿, faithful to SOURCE.ERB:1251). Most
   * commands return 0/omit — trust is only moved by commands that set
   * `TFLAG:信頼度管理` upstream. */
  trustSeed?(c: ComfCtx): number;
  /** Optional master-ability scaling (e.g. 会話's 話術技能). */
  masterAbility?: MasterAbilityScale;
  /**
   * Equipment-gated SOURCE TIMES modifiers. Called after buildSources
   * and masterAbility, before outcomeMul. Receives the mutable SOURCE
   * map — modify `sources[id]` in place. An empty/no-op function means
   * no equipment effect (most non-touch commands).
   */
  tequipMul?(c: ComfCtx, sources: Record<number, number>): void;
  /**
   * Master BASE drain (e.g. 体力/気力 consumed by the action).
   * Applied after time-advance, before body. Positive values = drain
   * (e.g. `{ 0: 40 }` → `master.BASE[0] -= 40` = 体力 -40),
   * matching Emuera's `DOWNBASE:体力 += 40` convention. A function form
   * supports state-dependent drain (e.g. `412 勉強`'s furniture-gated
   * 体力/気力 cost).
   */
  downbase?: Record<number, number> | ((c: ComfCtx) => Record<number, number>);
  /**
   * Slice B — the item this command consumes (id + qty, default 1). The
   * factory gates `execCheck` on holding ≥ qty and `removeItem`s it before
   * settlement. E.g. 181 媚薬 consumes 41.
   */
  consumeItem?: { id: number; qty?: number };
  /**
   * Slice C — an item the command requires HOLDING (not consumed), e.g.
   * 调教装备 跳蛋(0)/按摩棒(1)/阴蒂夹(2). Gates `execCheck` on `hasItem`.
   */
  requiresItem?: number;
  /**
   * Slice C — equipment-toggle: the TEQUIP slot this command flips.
   * When already equipped → clear it and exit (no settlement); when free →
   * set it and run the normal settlement. Faithful to `TEQUIP:x = !TEQUIP:x`
   * toggle commands (COMF42 阴蒂夹 etc.).
   */
  toggleTequip?: number;
  /**
   * 浴室PLAY 地垫门 (原版 `IF TEQUIP:31; SIF ITEM:20 == 0 RETURN 0`):
   * while the TARGET is in 浴室PLAY, holding 塑料地墊 (ITEM 20) is required.
   * Applied by the factory to `execCheck`.
   */
  bathMatRequired?: boolean;
  /** Persisted side writes (EXP / TCVAR markers / 累計). Runs after time-advance. */
  body?(c: ComfCtx): void;
  /**
   * P1-d: auto-strip the target's clothing after the body hook executes
   * (mirrors upstream DATUI_LATE called from SOURCE.ERB:125). "top" =
   * stripTop mode 0 (target side, sets TEQUIP:5), "bottom" = stripBottom
   * mode 0, "both" = both. No-op when the command has no target
   * (`!hasTarget`). The factory captures strip return values into
   * `c.next` (the strip functions clone internally).
   */
  datui?: "top" | "bottom" | "both";
  /**
   * Optional gate on whether the personal-kojo `collect` fires for this
   * command. Most commands collect kojo whenever a target is present
   * (default true). A command whose kojo is itself gated upstream by an
   * extra condition (e.g. 417 昼寝 only emits the "nap together" kojo when
   * the target is actually napping along, `CFLAG:6 態度 > 0`) declares it
   * here so solo/non-qualifying runs don't surface kojo that upstream would
   * never have dispatched. Evaluated only when `hasTarget` is already true.
   */
  kojoGate?(c: ComfCtx): boolean;
  /** Player-visible NARRATION line (may carry `%CALLNAME:…%` tokens). */
  narration(c: ComfCtx, favorDelta: number): string;
}
