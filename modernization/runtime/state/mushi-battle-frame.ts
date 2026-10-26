/**
 * 宝可梦式斗虫战画面 — full-screen ASCII battle frames.
 *
 * Upstream redraws the whole field after every message
 * (`MUSHI_BATTLE_MSG` → `MUSHI_BATTLE_FIELD`, MUSHI_BATTLE.ERB:218-219), so a
 * battle reads as a sequence of complete frames rather than a scrolling log.
 * This module keeps that behaviour and renders each frame in the Pokémon
 * layout the era house style implies:
 *
 *     ┌─ enemy status panel ──────────┐   ┌ enemy sprite ┐
 *     │ name · rank stars · HP bar    │   │  (top right) │
 *     └───────────────────────────────┘   └──────────────┘
 *            ( field line )
 *     ┌ your sprite ────────┐   ┌─ player status panel ──┐
 *     │  (bottom left)      │   │ name · rank · HP bar   │
 *     └─────────────────────┘   └────────────────────────┘
 *     ┌─ message log ────────────────────────────────────┐
 *
 * Everything is emitted as plain text so it travels through the existing
 * NARRATION pipeline and inherits `--era-*` styling from `ascii-ui.css` with no
 * new UI surface to wire.
 */

import { bugSprite } from "./bug-sprite.js";
import { nameFieldType } from "./bug-battle.js";
import type { BattleBattler, BattleBug, BattleLine, BattleSnapshot } from "./bug-battle.js";

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/**
 * Total frame width, in character cells (8px each at the house font size).
 *
 * Sized to the in-game text column, not the window: the immersive layout gives
 * the interaction box `clamp(32ch, 30%, 58ch)`, so 58 cells is the hard ceiling
 * before the frame scrolls sideways. The upstream field box was 40 columns, so
 * this is still roomier than eraTW itself.
 */
export const FRAME_WIDTH = 58;
/**
 * Sprite column. The archetype canvas and the hand-drawn hero sheets are 21-29
 * cells wide, so this keeps them uncropped; the panel takes what is left.
 */
const SPRITE_INDENT = 14;

const HP_FULL = "█";
const HP_EMPTY = "░";

/** 属性 → the house palette. Keeps type colour inside the era token set. */
export const TYPE_COLOR: Readonly<Record<string, string>> = {
  赤: "赤",
  青: "青",
  緑: "緑",
  白: "白",
  黒: "黒",
  無: "無",
};

/** Status glyphs, one column each, mirroring the upstream `MUSHI_STATUS` set. */
export const STATUS_GLYPH: Readonly<Record<string, string>> = {
  得意地形: "地",
  得意季節: "季",
  大将: "将",
  高揚: "揚",
  逆襲: "逆",
  陽炎: "炎",
  睡眠: "眠",
  麻痹: "痺",
  緩慢: "缓",
  混乱: "乱",
  毒: "毒",
  猛毒: "猛",
  悪臭: "臭",
};

export function statusText(statuses: readonly string[]): string {
  return statuses.map((status) => STATUS_GLYPH[status] ?? status[0] ?? "?").join(" ");
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/**
 * Place `text` starting at display column `startColumn`.
 *
 * The row array is indexed by **display cell**, not by UTF-16 unit: a CJK glyph
 * occupies two cells and therefore consumes two array slots (the second is left
 * empty so `join("")` reassembles the original text). Getting this wrong
 * silently shifts everything to its right — which is how a right-hand sprite
 * ends up drawn on top of a left-hand panel.
 */
/**
 * Pad / clip to an exact number of **display cells**.
 *
 * `String.padEnd` counts UTF-16 units, so a name of 4 CJK characters pads to a
 * different width than 4 Latin ones — which silently breaks every box rule in
 * the frame. Every aligned field in this module goes through here instead.
 */
export function padCells(text: string, cells: number, fill = " "): string {
  let used = 0;
  let out = "";
  for (const ch of text) {
    const cost = charCells(ch);
    if (used + cost > cells) break;
    out += ch;
    used += cost;
  }
  while (used < cells) {
    out += fill;
    used += charCells(fill);
  }
  return out;
}

/**
 * A fixed-width left-gutter panel.
 *
 * **No right border, on purpose.** Box-drawing glyphs are East-Asian Ambiguous
 * width: measured in the game font stack `─ │ ★ ● ◆ 虫` all render at 16px while
 * `A` is 8px and `░` is 8px, and which of those a given machine picks depends on
 * the installed font. A right-hand `│` therefore lands at a different column on
 * every machine. Left-gutter rows plus horizontal rules always align, because
 * every row starts at column 0.
 */
function panel(rows: readonly string[]): string[] {
  const out: string[] = [];
  for (const row of rows) out.push("│" + padCells(row, FRAME_WIDTH - 1));
  return out;
}

/** A horizontal rule, width-independent by construction (no right cap). */
function rule(indent = 0): string {
  return "├" + "─".repeat(Math.max(0, FRAME_WIDTH - 1 - indent));
}

/** HP bar with a half-cell so small deltas stay visible. */
function hpBar(hp: number, maxHp: number, width: number): string {
  if (maxHp <= 0) return HP_EMPTY.repeat(width);
  const ratio = Math.max(0, Math.min(1, hp / maxHp));
  const exact = ratio * width;
  const full = Math.floor(exact);
  const partial = exact - full >= 0.5 ? 1 : 0;
  const filled = Math.min(width, full + partial);
  return HP_FULL.repeat(filled) + HP_EMPTY.repeat(Math.max(0, width - filled));
}

/** Rank as filled/hollow stars, capped at the visible width. */
function rankStars(rank: number, width: number): string {
  const filled = Math.max(0, Math.min(width, Math.round(rank / 12)));
  return "★".repeat(filled) + "☆".repeat(Math.max(0, width - filled));
}

function standingBug(battler: BattleBattler): BattleBug | undefined {
  return battler.bugs[battler.standIndex];
}

// ---------------------------------------------------------------------------
// Status panel — rendered from an immutable snapshot, never from live battlers
// ---------------------------------------------------------------------------

/**
 * Status lines for one battler. `side` is the era-style 我 / 敌 marker.
 *
 * Rows are left-gutter lines; the caller stacks them above or below the sprite.
 */
function statusPanel(snapshot: BattleSnapshot, side: string): string[] {
  const fallen = snapshot.bugNum == null;
  const name = fallen ? "（此格已倒下）" : (snapshot.bugName ?? "（空）");
  const mut = `${snapshot.gType ? "G" : ""}${snapshot.xType ? "X" : ""}`;
  const rest = snapshot.forfeited
    ? "敗退"
    : "●".repeat(snapshot.remaining) + "○".repeat(Math.max(0, 3 - snapshot.remaining));
  const barWidth = 18;
  return panel([
    `【${side}】` + padCells(snapshot.name, 8),
    " " + padCells(name, 12) + " " +
      padCells(rankStars(snapshot.rank, 6) + " " + (snapshot.type || "—") + (mut ? " " + mut : ""), 12) +
      " " + rest,
    " HP " + hpBar(snapshot.hp, snapshot.maxHp, barWidth) +
      " " + `${snapshot.hp}/${snapshot.maxHp}`,
    " 状态 " + padCells(statusText(snapshot.statuses) || "—", 12),
  ]);
}

export interface BattleFrameInput {
  /** Immutable per-battler state for this frame. */
  snapshots: readonly BattleSnapshot[];
  field: number;
  /** Upstream `MUSHI_CHARANUM` ordering: index 0 is MASTER. */
  turnOrder?: readonly number[];
  round: number;
  /** Most recent message, shown large under the field. */
  message?: string;
  /** Rolling log shown beneath the message. */
  log?: readonly string[];
  /** Banner shown at the very top (VS card, result card…). */
  banner?: string;
}

/**
 * Sprite rows for one battler. The hand-drawn sheets and the archetype canvas are
 * 21-29 ASCII cells wide, so they are only lightly trimmed here.
 *
 * Returns an empty block when the standing slot is spent: a KO'd insect swaps in
 * during ENDSTEP, so mid-round the slot really is empty and reserving a
 * full-height blank band just made the frame look broken.
 */
function spriteColumn(snapshot: BattleSnapshot | undefined, left: boolean): string[] {
  if (snapshot?.bugNum == null) return [];
  const rows = bugSprite(snapshot.bugNum).rows;
  const trimmed = rows.map((row) => row.replace(/\s+$/, ""));
  while (trimmed.length > 0 && trimmed[trimmed.length - 1]!.length === 0) trimmed.pop();
  return trimmed.map((row) => (left ? row : mirrorRow(row)));
}

function mirrorRow(row: string): string {
  return [...row].reverse().join("");
}

/**
 * Compose one complete battle frame.
 *
 * Layout note — this is left-aligned and indentation-only on purpose. Box-drawing
 * and symbol glyphs are East-Asian Ambiguous width: in the game font stack
 * `─ │ ★ ● ◆ 虫` measure 16px while `A` and `░` measure 8px, and which one a
 * given machine picks depends on its installed font. Any scheme that relies on
 * a *right* border therefore lands at a different column per machine. Leading
 * indentation uses plain ASCII spaces, whose width is unambiguous, so the
 * frame holds together everywhere.
 *
 * The enemy reads top-right and the player bottom-left, keeping the classic
 * battle staging without depending on right-edge measurement.
 */
export function renderBattleFrame(input: BattleFrameInput): string[] {
  const player = input.snapshots[0];
  const opponent = input.snapshots[1];
  const out: string[] = [];

  if (input.banner) {
    for (const line of input.banner.split("\n")) out.push(padCells(line, FRAME_WIDTH));
    return out;
  }

  out.push(padCells("◆回合 " + input.round + "　＜场地：" + nameFieldType(input.field) + "＞", FRAME_WIDTH));
  out.push(rule());

  // Enemy block: status lines, then its sprite indented toward the right.
  for (const line of statusPanel(opponent ?? emptySnapshot(2), "敌")) out.push(line);
  out.push(...indentBlock(spriteColumn(opponent, false), SPRITE_INDENT));
  out.push("");

  // Player block: sprite first (left), then status lines.
  out.push(...indentBlock(spriteColumn(player, true), 2));
  for (const line of statusPanel(player ?? emptySnapshot(1), "我")) out.push(line);

  out.push(rule());
  for (const line of wrap(input.message ?? "", FRAME_WIDTH - 3)) {
    out.push("│" + padCells(" " + line, FRAME_WIDTH - 1));
  }
  out.push(rule());
  for (const entry of (input.log ?? []).slice(-6)) {
    for (const line of wrap(entry, FRAME_WIDTH - 3)) {
      out.push("│" + padCells(" " + line, FRAME_WIDTH - 1));
    }
  }
  out.push("└" + "─".repeat(Math.max(0, FRAME_WIDTH - 1)));

  return out.map((row) => padCells(row, FRAME_WIDTH));
}

/** ASCII-only indentation; sprite glyphs are ASCII too, so columns stay exact. */
function indentBlock(rows: readonly string[], spaces: number): string[] {
  const pad = " ".repeat(spaces);
  return rows.map((row) => padCells(pad + row.replace(/\s+$/, ""), FRAME_WIDTH));
}

function emptySnapshot(player: number): BattleSnapshot {
  return {
    player, name: "—", bugNum: null, bugName: null, hp: 0, maxHp: 0, atk: 0, spd: 0,
    rank: 0, gType: false, xType: false, type: "", statuses: [], remaining: 0, forfeited: false,
  };
}

/** Wrap text on character cells, CJK-aware (2 cells wide). */
export function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  let current = "";
  let used = 0;
  for (const ch of text) {
    const cells = charCells(ch);
    if (used + cells > width) {
      out.push(current);
      current = "";
      used = 0;
    }
    current += ch;
    used += cells;
  }
  if (current.length > 0) out.push(current);
  return out.length > 0 ? out : [""];
}

/** Display width of one character: CJK and full-width forms take two cells. */
export function charCells(ch: string): number {
  const code = ch.codePointAt(0) ?? 0;
  if (code < 0x1100) return 1;
  if (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    // Box drawing, blocks, geometric shapes and dingbats (─ █ ★ ● ◯) all render
    // FULL width in the era font stack — measured: `─` is 16px, the same as 汉字,
    // while ASCII is 8px. Counting them as one cell makes every rule in the
    // frame overflow its column, so the whole U+2500..U+2BFF run is two cells.
    (code >= 0x2500 && code <= 0x2bff) ||
    (code >= 0x20000 && code <= 0x3fffd)
  ) {
    return 2;
  }
  return 1;
}

// ---------------------------------------------------------------------------
// Frame sequencing
// ---------------------------------------------------------------------------

/**
 * Turn a finished battle into a replayable frame sequence: one frame per
 * round plus a final result card. `replay()` steps through them the way the
 * player clicks through the message box.
 */
export function battleFrameSequence(options: {
  /** Opening roster, used only for the VS card. */
  battlers: readonly BattleBattler[];
  /** Per-round immutable state from `runBugBattle`. */
  snapshots: readonly (readonly BattleSnapshot[])[];
  field: number;
  rounds: readonly (readonly BattleLine[])[];
  finish: readonly number[];
  winner: number;
}): BattleFrameInput[] {
  const frames: BattleFrameInput[] = [];

  frames.push({
    snapshots: options.snapshots[0] ?? [],
    field: options.field,
    round: 0,
    banner: vsCard(options.snapshots[0] ?? [], options.field),
  });

  for (let i = 0; i < options.rounds.length; i++) {
    const lines = options.rounds[i] ?? [];
    if (lines.length === 0) continue;
    // The snapshot taken at the END of round i shows the post-damage state.
    const after = options.snapshots[i + 1] ?? options.snapshots[i] ?? [];
    const before = options.snapshots[i] ?? after;
    const last = lines[lines.length - 1]!;
    frames.push({
      snapshots: after,
      field: options.field,
      round: i + 1,
      message: last.text,
      log: lines.slice(0, -1).map((line) => line.text),
    });
    void before;
  }

  frames.push({
    snapshots: options.snapshots[options.snapshots.length - 1] ?? [],
    field: options.field,
    round: options.rounds.length,
    banner: resultCard(options),
  });
  return frames;
}

/**
 * Closing result card. Reads live battlers, so it must run before the slots the
 * player fielded have been consumed — `battleFrameSequence` calls it last but
 * the battlers were already advanced by the engine; use the final snapshot for
 * names when that matters.
 */
function resultCard(options: {
  battlers: readonly BattleBattler[];
  finish: readonly number[];
  winner: number;
}): string {
  const winner = options.battlers.find((b) => b.player === options.winner);
  const out: string[] = ["◆ 比 试 结 果", rule()];
  for (const battler of options.battlers) {
    const bug = standingBug(battler);
    const verdict = battler.player === options.winner ? "胜利" : battler.forfeited ? "败退" : "—";
    out.push(padCells(padCells(battler.name, 10) + padCells(bug?.name ?? "—", 14) + verdict, FRAME_WIDTH - 1));
  }
  out.push(rule());
  out.push("胜者　" + (winner?.name ?? "—"));
  out.push("└" + "─".repeat(Math.max(0, FRAME_WIDTH - 1)));
  return out.join("\n");
}

/**
 * The opening VS card.
 *
 * Built from the *opening* snapshot, never from the live battlers: the engine
 * runs to completion before this is rendered, so by now every slot the player
 * fielded may already be spent.
 */
function vsCard(snapshots: readonly BattleSnapshot[], field: number): string {
  const block = (side: string, snapshot: BattleSnapshot | undefined): string[] => {
    const rest = snapshot ? "●".repeat(snapshot.remaining) + "○".repeat(Math.max(0, 3 - snapshot.remaining)) : "";
    return [
      padCells(`【${side}】` + (snapshot?.name ?? "—"), 12),
      padCells("  " + (snapshot?.bugName ?? "—"), 14) +
        padCells((snapshot?.type || "—") + " " + (snapshot ? rankStars(snapshot.rank, 6) : ""), 10) + rest,
    ];
  };
  return [
    "斗 虫 对 战",
    rule(),
    ...block("我", snapshots[0]),
    ...block("敌", snapshots[1]),
    rule(),
    "场地　" + nameFieldType(field),
    "└" + "─".repeat(Math.max(0, FRAME_WIDTH - 1)),
  ].join("\n");
}
