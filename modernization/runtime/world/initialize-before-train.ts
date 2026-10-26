/**
 * P1-#5 Slice E — `@InitializeBeforeTrain` (BEFORETRAIN.ERB:829-1015) port.
 *
 * eraTW's per-chara day-start reset block. The original ~200 lines run
 * once per character when the day ticks over (BEFORETRAIN wakes up,
 * fires `@InitializeBeforeTrain(ARG)` for every chara, then runs
 * `@BEFORETRAIN`).
 *
 * Faithful coverage of the **unconditional** resets only. The
 * conditional / DLC arms (殘留精液 / 種付け自覚 / RESET_STAIN /
 * `IN_HOME(初期位置) != 1` SET_SLEEP trigger / `zzz1min` 起床時間
 * override) are deferred per the P1-PLAN §2.1.2 plan and documented
 * inline; the upstream calls them but the modern runtime has no
 * 殘留精液 subsystem (defer), no 種付け自覚 consumer (defer), and the
 * SET_SLEEP trigger is already covered by `clearSleepTransient` in
 * sleep.ts (the master path is the one that matters; per-chara
 * sleeping is currently a no-op stub).
 *
 * **`CALL SETTING_PERSONALITY(ARG)`** — the personality-clique
 * computation (PRINT_STATE2.ERB:870) is deferred; the runtime uses
 * `性格傾向` defaults to 0 ("other"). CFLAG personality reading
 * consumers (chara-info hard-bone PAGE 0) read 0 → fall through to
 * "other" until SETTING_PERSONALITY lands.
 *
 * **`CALL 生活時間設定(ARG)`** (BEFORETRAIN.ERB:965) — the per-chara
 * 生活時間 table. Defer until the scheduler needs it.
 *
 * **`CALL SET_SLEEP(0,ARG,0)`** conditional (BEFORETRAIN.ERB:966-967)
 * — only fires when the chara is sleeping but NOT in their 初期位置
 * (i.e. fell asleep somewhere foreign; the upstream clears the sleep
 * flag and forces the 起床時間/就寝時間/来訪時間 timestamps to wake).
 * Modern sleep.ts already handles master wake; per-chara is deferred
 * until P1-#5 Slice B (CHARA_SLEEP).
 *
 * **Slot mutation** — like every other runtime/world/* module, this
 * mutates `state.charas[charaNum].state` in place and returns the
 * events emitted (currently none, the upstream has no user-facing
 * output here either).
 */

import type { CharaSlot, GameState } from "../state/index.js";
import { BASE_ID, CFLAG_ID, TCVAR_ID } from "../state/settlement.js";
import { restoreTemporaryStayovers } from "./temporary-stay.js";

/** Id list of the CFLAG bits that `@InitializeBeforeTrain` clears on
 *  every character every morning. Faithful to BEFORETRAIN.ERB:840-859. */
const CFLAG_RESETS = [
  CFLAG_ID.前一次的位置,
  CFLAG_ID.约会中,
  CFLAG_ID.清醒劑,
  CFLAG_ID.今日の運勢,
  CFLAG_ID.勃起度,
  CFLAG_ID.行动,
] as const;

/** Id list of the BASE counters that `@InitializeBeforeTrain` zeroes
 *  on every character every morning. Faithful to BEFORETRAIN.ERB:846-854. */
const BASE_RESETS_TO_ZERO: ReadonlyArray<number> = [
  BASE_ID.射精,
  BASE_ID.勃起,
  BASE_ID.情緒,
  BASE_ID.憤怒,
  BASE_ID.深度,
  BASE_ID.酒気,
];

/** Id list of the TCVAR counters that `@InitializeBeforeTrain` resets
 *  on every character every morning. Faithful to BEFORETRAIN.ERB:866-877. */
// (the actual resets are inlined in the dedicated helpers below)

/** The upstream 経験表示用 loop (BEFORETRAIN.ERB:861-863) copies
 *  EXP:0..99 → TCVAR:400..499 every morning. We model this as a single
 *  function rather than a TCVAR reservation because the modern slot
 *  doesn't carry 100 TCVAR slots just for this snapshot; the
 *  snapshot-at-day-start lives in `state.daySnapshot.EXP` already
 *  (chara-info STATE diff uses it). This is a no-op stub. */
function snapshotExpForDisplay(state: GameState, slot: CharaSlot): void {
  // No-op: `state.daySnapshot[charaNum].EXP` already serves as the
  // per-day-EXP snapshot for the daily-report diff (daily-report.ts).
  // Recording the original TCVAR:400..499 buffer would double the
  // memory and provide no observable difference downstream.
  void state;
  void slot;
}

/** Clear the 経験表示用 TCVAR slots (400..499) that upstream writes to
 *  each morning. The modern slot schema doesn't model these 100 slots;
 *  they're a display-side cache that the modern UI rebuilds on demand
 *  from the live `state.EXP` table. Documented as a no-op. */
function clearExperienceDisplayBuffer(slot: CharaSlot): void {
  // No-op: TCVAR:400..499 is not modeled in the modern slot schema.
  void slot;
}

/** 夜這い侵入リセット — BEFORETRAIN.ERB:859 `CLEARBIT CFLAG:ARG:42,8`.
 *  Bit 8 of CFLAG:夜這い (=42) marks "in the middle of a 夜這い intrusion";
 *  clearing it signals "no 夜這い pending". */
function clearYobaiIntrusion(slot: CharaSlot): void {
  const cur = slot.state.CFLAG[CFLAG_ID.夜這い] ?? 0;
  slot.state.CFLAG[CFLAG_ID.夜這い] = cur & ~(1 << 8);
}

/** Set BASE:理性 = MAXBASE:理性 (BEFORETRAIN.ERB:850). When MAXBASE is
 *  0 (uninitialized slot), default to 0 — same as the upstream which
 *  would also see 0. */
function resetReason(slot: CharaSlot): void {
  const cap = slot.state.MAXBASE[BASE_ID.理性] ?? 0;
  slot.state.BASE[BASE_ID.理性] = cap;
}

/** Set TCVAR:100/101/103/105 to -1 (BEFORETRAIN.ERB:866-871). The -1
 *  sentinel signals "not set this morning" for the consumer code. */
function resetInsertionFlags(slot: CharaSlot): void {
  slot.state.TCVAR[TCVAR_ID.V挿入管理] = -1;
  slot.state.TCVAR[TCVAR_ID.A挿入管理] = -1;
}

/** TCVAR:103 / TCVAR:105 = -1 — 中出し表示用フラグ (BEFORETRAIN.ERB:871-872).
 *  These are the display-only "中出し" markers; the modern runtime
 *  doesn't model them as named TCVAR slots (the corresponding display
 *  logic lives in the upstream PR and is deferred with the H-mode
 *  port). We do best-effort: if the slot already has them, clear. */
function resetNakaDashiFlags(slot: CharaSlot): void {
  for (const id of [103, 105]) {
    if (id in slot.state.TCVAR) {
      slot.state.TCVAR[id] = -1;
    }
  }
}

/** TCVAR:睡眠薬茶使用 = 0 (BEFORETRAIN.ERB:874). Clear the morning's
 *  drug-via-drink marker so the next dish can re-set it cleanly. */
function resetSleepDrugTeaMarker(slot: CharaSlot): void {
  slot.state.TCVAR[TCVAR_ID.睡眠薬茶使用] = 0;
}

/** CSTR:10 / CSTR:11 = "/" (BEFORETRAIN.ERB:876-877). The CSTR slot
 *  isn't part of the modern state schema (CSTR data lives in
 *  charas.bundle.json as fixed text, not runtime-modifiable per-day).
 *  No-op stub. */
function resetCumProcessingStrings(slot: CharaSlot): void {
  // No-op: CSTR:10/11 are upstream display strings (射精処理用) and
  // the modern runtime renders the equivalent output from
  // `slot.state.PALAM` / `BASE:射精` on demand.
  void slot;
}

/** Apply `@InitializeBeforeTrain` to a single character slot. */
export function initializeBeforeTrain(
  state: GameState,
  charaNum: number,
): void {
  const slot = charaNum === 0 ? state.master : state.charas[charaNum];
  if (!slot) return;

  // CFLAG resets — BEFORETRAIN.ERB:840-859 (excludes the 殘留精液 block
  // which is DLC-deferred).
  for (const id of CFLAG_RESETS) {
    slot.state.CFLAG[id] = 0;
  }
  // 今日の運勢 = RAND:1000 — BEFORETRAIN.ERB:844. We use a deterministic
  // per-day seed: dayIndex + charaNum + 7 (a small prime to spread).
  slot.state.CFLAG[CFLAG_ID.今日の運勢] =
    (state.time.dayIndex * 31 + charaNum * 17 + 7) % 1000;
  // 约会中 = MAIN_MAP (0) — already covered by the CFLAG_RESETS loop.

  // 経験表示用 — BEFORETRAIN.ERB:861-863. Snapshot + clear.
  snapshotExpForDisplay(state, slot);
  clearExperienceDisplayBuffer(slot);

  // 夜這い侵入リセット — BEFORETRAIN.ERB:859.
  clearYobaiIntrusion(slot);

  // BASE resets — BEFORETRAIN.ERB:846-854.
  for (const id of BASE_RESETS_TO_ZERO) {
    slot.state.BASE[id] = 0;
  }
  resetReason(slot); // 理性 = MAXBASE:理性

  // TCVAR resets — BEFORETRAIN.ERB:866-877.
  resetInsertionFlags(slot);
  resetNakaDashiFlags(slot);
  resetSleepDrugTeaMarker(slot);
  resetCumProcessingStrings(slot);
}

/** Apply `@InitializeBeforeTrain` to every character + master. */
export function runInitializeBeforeTrain(state: GameState): void {
  restoreTemporaryStayovers(state);
  initializeBeforeTrain(state, 0);
  for (const num of Object.keys(state.charas)) {
    initializeBeforeTrain(state, Number(num));
  }
}
