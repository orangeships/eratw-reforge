/**
 * Phase 4.5B — DISPOSABLE mock command tables.
 *
 * These stand in for the real `CommandResolver` (Phase 5). They let
 * the 4.5 prototype demonstrate the承重 path —
 *   UI button → ISSUE_COMMAND intent → applyIntent → GameState change
 *   → scene re-render —
 * without any real settlement. **Phase 5 deletes this whole file** and
 * replaces the `applyIntent` branches that read it with the resolver.
 *
 * Three tables:
 *   - MOVE: commandNo -> target location (sets `master.location`, S1).
 *     The numbers match the scene `exits` authored in each
 *     `modernization/scenes/<id>/scene.json` (10701-10703, the +10000
 *     SYNTHETIC navigation range — kept OUT of the real COMF id space so
 *     the real COMF700-749 自慰系 commands can register live; see the
 *     namespace-debt resolution in room-move.ts / phase-7-family-map.md).
 *   - ACTION: commandNo → canned narration + one kojo line. These
 *     stand in for `COMF`/`SCOMF` action commands (S4); the UI opens
 *     the interaction box for them.
 *   - LOOP-EXIT: which commandNos end the interaction sub-loop (S4,
 *     data-driven exit). Mock = a single escape number; Phase 5 can
 *     drive this from real settlement state (体力/気絶/end-of-session).
 *
 * Routing note: the 4.5 UI treats "is this an action command" as
 * `isMockActionCommand`. Phase 5 swaps that for a `commands.json`
 * `kind === "COMF" | "SCOMF"` lookup with the same numbers.
 */

/** commandNo → location string. Mirrors the scene `exits` (S1/S2). */
export const MOCK_MOVE_TABLE: Readonly<Record<number, string>> = {
  10701: "神社",
  10702: "人間之里",
  10703: "自宅",
};

/** Canned output for one mock action command. */
export interface MockActionOutput {
  /** In-world narration (→ NARRATION event). */
  narration: string;
  /** One kojo line (→ DIALOGUE_LINE event). */
  dialogue: { charaNum: number; text: string };
}

/**
 * commandNo → canned action output. **Phase 5F:** these placeholders were
 * renumbered out of the real COMF range (was 301-312) to 9301-9312 so the
 * resolver never intercepts a disposable 4.5 mock button — the real
 * handlers live at 300/304/309/400/402, and 304/309 used to collide.
 * charaNum 1 = 霊夢. Phase 5/7 replaces this whole table with real COMF
 * commands issued by the UI (the resolver then settles them).
 */
export const MOCK_ACTION_TABLE: Readonly<Record<number, MockActionOutput>> = {
  9301: {
    narration: "你与霊夢攀谈起来，她抬眼看了过来。",
    dialogue: { charaNum: 1, text: "……だから、何の用だ？" },
  },
  9302: {
    narration: "你递上一份在里中买的小点心。",
    dialogue: { charaNum: 1, text: "ふん、まあ……悪くないな。" },
  },
  9303: { narration: "你轻轻摸了摸霊夢的头。", dialogue: { charaNum: 1, text: "っ……子供扱いするな。" } },
  9304: { narration: "你称赞了霊夢的巫女装束。", dialogue: { charaNum: 1, text: "……別に、いつも通りだ。" } },
  9305: { narration: "你提议一起去喝杯茶。", dialogue: { charaNum: 1, text: "茶か。まあ、付き合ってやる。" } },
  9306: { narration: "你帮霊夢整理了散落的赛钱箱。", dialogue: { charaNum: 1, text: "……お、悪いな。助かる。" } },
  9307: { narration: "你递上一瓶御神酒。", dialogue: { charaNum: 1, text: "ほう、気が利くじゃないか。" } },
  9308: { narration: "你和霊夢聊起最近的异变。", dialogue: { charaNum: 1, text: "また面倒事か……はぁ。" } },
  9309: { narration: "你陪霊夢一起晒太阳发呆。", dialogue: { charaNum: 1, text: "……たまには、こういうのも悪くない。" } },
  9310: { narration: "你帮霊夢扫了扫神社的落叶。", dialogue: { charaNum: 1, text: "ふぅん、案外まめなんだな。" } },
  9311: { narration: "你给霊夢看了今天钓到的鱼。", dialogue: { charaNum: 1, text: "へえ、なかなかの大物だな。" } },
  9312: { narration: "你向霊夢道别。", dialogue: { charaNum: 1, text: "ああ、またな。" } },
};

/** One action button in the interaction box's sub-grid. */
export interface MockActionMenuItem {
  commandNo: number;
  label: string;
}

/** The action sub-grid shown inside the interaction box (S4). */
export const MOCK_ACTION_MENU: ReadonlyArray<MockActionMenuItem> = [
  { commandNo: 9301, label: "搭话" },
  { commandNo: 9302, label: "递点心" },
  { commandNo: 9303, label: "摸头" },
  { commandNo: 9304, label: "称赞装束" },
  { commandNo: 9305, label: "邀去喝茶" },
  { commandNo: 9306, label: "整理赛钱箱" },
  { commandNo: 9307, label: "递御神酒" },
  { commandNo: 9308, label: "闲谈异变" },
  { commandNo: 9309, label: "一起晒太阳" },
  { commandNo: 9310, label: "扫落叶" },
  { commandNo: 9311, label: "展示渔获" },
  { commandNo: 9312, label: "道别" },
];

/** Reserved escape commandNo (era's escape = 850). UI-only; never settled. */
export const MOCK_ESCAPE_COMMAND_NO = 850;

/**
 * Which commandNos terminate the interaction sub-loop and return to
 * the scene (S4, dynamic exit). Mock = just escape; the set is the
 * extension point Phase 5 grows with state-driven exit triggers.
 */
export const MOCK_LOOP_EXIT_COMMANDS: ReadonlySet<number> = new Set([
  MOCK_ESCAPE_COMMAND_NO,
]);

/** Target location for a move commandNo, or `undefined` if not a move. */
export function moveTargetFor(commandNo: number): string | undefined {
  return MOCK_MOVE_TABLE[commandNo];
}

/** Canned output for an action commandNo, or `undefined` if not an action. */
export function mockActionFor(commandNo: number): MockActionOutput | undefined {
  return MOCK_ACTION_TABLE[commandNo];
}

/** True if this commandNo opens the interaction box (mock proxy for COMF/SCOMF). */
export function isMockActionCommand(commandNo: number): boolean {
  return Object.prototype.hasOwnProperty.call(MOCK_ACTION_TABLE, commandNo);
}

/** True if this commandNo ends the interaction sub-loop (S4 exit). */
export function isLoopExitCommand(commandNo: number): boolean {
  return MOCK_LOOP_EXIT_COMMANDS.has(commandNo);
}
