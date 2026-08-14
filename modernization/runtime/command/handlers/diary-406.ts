/**
 * COMF406 日記を読む — read/write diaries. Lv1 daily QoL command, faithful
 * to `ERB/コマンド関連/COMF/日常系/COMF406 日記を読む.ERB`.
 *
 * Upstream @COM406 has four layout arms (master's room / OWNER's room +
 * 恋慕 / OWNER's room + TARGET present / OWNER's room + alone) and the
 * inner 7-option B9 menu:
 *
 *   [0] 写日记 (MASTER_DIARY_INPUT → MASTER_DIARY_WRITE) — gated by `STRCOUNT
 *       >= 100` (diary full).
 *   [1] 读日记 (READ_MASTER_DIARY) — dump the SAVESTR:1 entries.
 *   [2] 让 TARGET 读你的日记 (SHARE_MASTER_DIARY) — gated by ABL:親密 >= 5.
 *   [3] 读 TARGET 的日记 (CHARA_DIARY_COM) — per-chara diary reader.
 *   [4] 保存日记簿 (WRITE_MASTER_DIARY_FILE) — file save (deferred).
 *   [5] 读取日记簿 (READ_MASTER_DIARY_FILE) — file load (deferred).
 *   [6] 什么也不做 (RETURN -1) — bail.
 *
 * V1 ports the player-facing bits faithful to upstream:
 *   - Master 写日记/读日记 (option 0/1) — full storage round-trip
 *     (`masterDiary` array ↔ SAVESTR:1 //-string equivalent).
 *   - Owner target picking (`COM406_CHECK_OWNER`): TARGET if co-resident,
 *     else OMANEKI invitee, else the PRIVATE_ROOM of master's current
 *     room. Faithful.
 *   - Reading a chara's diary (option 3) — surfaces the chara's
 *     `charaDiaries[charaNum]` entries (placeholder NARRATION until the
 *     DIARY kojo channel lands in the runtime wiring).
 *   - V1 SOURCE settlement (歓楽/受動/征服 bracket ladder + 話術技能
 *     multiplier × outcome roll TFLAG:193) — same shape as upstream.
 *
 * DEFERRED (documented):
 *   - SHARE_MASTER_DIARY (ABL:親密>=5, "let TARGET read yours") — needs the
 *     ABL:親密 model for TARGET + a shared-narration subsystem.
 *   - WRITE/READ_MASTER_DIARY_FILE (file save/load) — needs a file-storage
 *     backend (Tauri fs / browser download).
 *   - Personal-kojo diary text rendering — `state.charaDiaries[charaNum]`
 *     is the V1 placeholder; once `resolveDiaryKojo` is wired into the
 *     runtime handler loop, replace this with the kojo's emitted lines.
 *   - 4 layout branches (master's room / OWNER's room etc.) — V1
 *     collapses to "in your own room or with TARGET present" (a single
 *     prompt loop that supports both 写 and 读). The 3 other layouts
 *     (OWNER's room + 恋慕 / + TARGET present / alone) deferred — they
 *     require the OWNER-resolved `CHARA_DIARY_COM(OWNER)` plumbing.
 *
 * Faithful gates (@COM_ABLE406):
 *   TFLAG:100 (移动执行判定) — modeled as "command-from-move path"; the
 *   modern always-sets-it gate is satisfied when a move-command isn't
 *   in flight, which is the steady state.
 *   !CFLAG:MASTER:恶作剧 / !CFLAG:MASTER:诶嘿嘿 — explicit upstream gates.
 *   AT_HOME(MASTER) || OMANEKI_PLACE — base + waiting-room outer gate.
 *   "in your own room OR OWNER exists" — without OWNER the player reads
 *   their own diary only at CFLAG:MASTER:初期位置.
 *   OWNER 恋慕 || ABL:MASTER:教養 >= ABL:OWNER:教養 — can't read others'
 *     diaries without 恋慕 or being more educated than them.
 *   OWNER 初期位置 == 現在位置 || OWNER not 恋慕 + OWNER awake in their room
 *     || TARGET not 恋慕 + TARGET awake — the privacy gates.
 */
import type { HandlerEntry } from "../types.js";
import type { CharaSlot, GameState } from "../../state/game-state.js";
import { cloneGameState } from "../../state/game-state.js";
import {
  ABL_ID,
  CFLAG_ID,
  FLAG_ID,
  TALENT_ID,
} from "../../state/settlement.js";
import { pickOne, freeText, requirePickOne, type PromptSpec } from "../prompt.js";
import { atPlayerBase, chkDateNow } from "../../world/location-predicates.js";
import { OMANEKI_PLACE } from "../../world/omaneki.js";
import { roomIdToLocation } from "../../world/room-id-location.js";
import {
  appendMasterDiaryEntry,
  isMasterDiaryFull,
  readMasterDiary,
  findFirstUnreadAutoPage,
  readDiaryFlag,
} from "../../state/diary.js";
import type { DialogueRouter } from "../../kojo/types.js";
import { resolveDiaryKojoAndApply } from "../../kojo/effects.js";

// Numeric ids pinned in settlement.ts; mirrored here for resilience.
const ABL_話術技能 = ABL_ID.話術技能;
const ABL_親密 = ABL_ID.親密;
const ABL_従順 = ABL_ID.従順;
const ABL_施虐属性 = ABL_ID.施虐属性;
const BASE_酒気 = 5;
const MAXBASE_酒気 = 5;
const SOURCE_歓楽 = 20;
const SOURCE_受動 = 22;
const SOURCE_征服 = 21;

const times = (v: number, mul: number): number => Math.trunc(v * mul);

/** Faithful mirror of `@COM406_CHECK_OWNER` (function form, last line).
 *  Returns 0 when there's no owner (player reading their own diary). */
function checkOwner(state: GameState, target: number): number {
  if (target > 0) {
    const targetInit = state.charas[target]?.state.CFLAG[CFLAG_ID.初期位置] ?? 0;
    const masterInit = state.master.state.CFLAG[CFLAG_ID.初期位置] ?? 0;
    const masterNow = state.master.state.CFLAG[CFLAG_ID.現在位置] ?? 0;
    if (targetInit === masterInit && masterNow === masterInit) return target;
  }
  // 招待 + 待客室 case
  const invitee = state.master.state.CFLAG[CFLAG_ID.招待] ?? 0;
  if (target === invitee && state.master.location === OMANEKI_PLACE) return invitee;
  // Canonical homes are the modern PRIVATEROOM/OWNER table. Do not infer an
  // owner merely because the current room happens to be on a base map.
  for (const slot of Object.values(state.charas)) {
    if (slot.homeLocation && slot.homeLocation === state.master.location) {
      return slot.charaNum;
    }
  }
  return 0;
}

/** Compose the player's menu (option 0..6 per upstream). */
function menuPrompt(state: GameState, target: number, owner: number): PromptSpec {
  const targetName = state.charas[target]?.callName ?? "对方";
  const ownerName = owner > 0 ? state.charas[owner]?.callName ?? "对方" : "—";
  const full = isMasterDiaryFull(state);
  return pickOne(
    `书桌上放着${target === owner ? "两本" : "一本"}日记。要做什么？`,
    [
      { id: 0, label: full ? "写日记（已满）" : "写日记", detail: "记录今天发生的事", disabled: full },
      { id: 1, label: "读日记", detail: "翻看自己写过的内容" },
      { id: 2, label: `让${targetName}读你的日记`, detail: "ABL:親密>=5 才允许", disabled: target <= 0 },
      { id: 3, label: `读${ownerName}的日记`, detail: owner > 0 ? `看${ownerName}写的日记` : "无可读的日记", disabled: owner <= 0 },
      { id: 4, label: "保存日记簿（未实装）", detail: "写入外部文件", disabled: true },
      { id: 5, label: "读取日记簿（未实装）", detail: "从外部文件载入", disabled: true },
      { id: 6, label: "什么也不做" },
    ],
  );
}

/** Read the player's diary (option 1). Pure NARRATION. */
function readMasterDiaryLines(state: Readonly<GameState>): string[] {
  const entries = readMasterDiary(state);
  if (entries.length === 0) return ["日记本是空的。"];
  const lines: string[] = ["日记本里写着："];
  for (let i = 0; i < entries.length; i++) {
    lines.push(`  [${i + 1}] ${entries[i]}`);
  }
  return lines;
}

/** Read a chara's diary (option 3) — `CHARA_DIARY_COM`. Walks the
 *  per-chara DIARY state machine for the unlocked pages, asks the
 *  router for the TEXT kojo in 指令 mode, and renders the lines.
 *
 *  Faithful to `CHARA_DIARY.ERB:1-52`:
 *   - EXIST gate (router.hasDiaryKojo) — bail if no diary kojo.
 *   - PAGESET walk — render the first empty slot's page first, then
 *     advance through PAGESET slots; loop paginates 1→N→上一→合上.
 *   - For each rendered page, mark DIARY:CHARA:page = 1 (read) if it
 *     was 3 (newly unlocked). Players can re-read already-read pages
 *     in the same session — V1 implements the first-page-only loop
 *     and leaves full pagination to a future iteration.
 *
 *  V1 scope (single-page render): renders ONE page (the FIRST in
 *  PAGESET), marks it read, and bails. Full multi-page pagination
 *  (ASK_M 上下页按钮) is deferred — the upstream ASK_M loop needs
 *  multi-pass UI coordination that doesn't fit the one-shot B9 model.
 */
function readCharaDiaryLines(
  state: Readonly<GameState>,
  owner: number,
  router: DialogueRouter | undefined,
  rng: { int(max: number): number; next(): number; pick<T>(a: readonly T[]): T } | undefined,
): string[] {
  const fallbackRng = { int: () => 0, next: () => 0, pick: <T,>(a: readonly T[]) => a[0]! };
  if (owner <= 0) return ["这里没有别人的日记。"];
  const callName = state.charas[owner]?.callName ?? "对方";
  if (!router?.hasDiaryKojo?.(owner, state, rng ?? fallbackRng)) {
    return [`${callName}似乎不写日记。`];
  }
  // Walk PAGESET slots 1..N, render the first non-empty slot's page.
  const slotMap = state.diaryPageSet?.[owner] ?? {};
  const sortedSlots = Object.keys(slotMap)
    .map(Number)
    .filter((s) => s > 0)
    .sort((a, b) => a - b);
  if (sortedSlots.length === 0) {
    // No pages unlocked yet — fall back to direct lookup of page 1.
    // (Faithful: BEFORE_CHECK should have populated PAGESET when the
    //  author set DIARY:CHARA:DCOUNT = 2. If it didn't, the diary is
    //  effectively empty.)
    if (readDiaryFlag(state, owner, 1) === 0 && findFirstUnreadAutoPage(state, owner) === 0) {
      return [`${callName}的日记本是空的。`];
    }
    const page = 1;
    const lines = resolveDiaryKojoAndApply(router, state, owner, page, rng ?? fallbackRng, [page, 1]);
    if (lines.length === 0) return [`${callName}的日记本是空的。`];
    return [`▼${callName}的日记　PAGE.1 ─────`, ...lines.map((l) => l.text), "───────────────"];
  }
  const firstSlot = sortedSlots[0]!;
  const page = slotMap[firstSlot]!;
  const lines = resolveDiaryKojoAndApply(router, state, owner, page, rng ?? fallbackRng, [page, firstSlot]);
  if (lines.length === 0) return [`${callName}的日记本是空的。`];
  return [`▼${callName}的日记　PAGE.${firstSlot} ─────`, ...lines.map((l) => l.text), "───────────────"];
}

/** Faithful SOURCE ladder (downstream of @COM406's $SKIP block, lines 132-204).
 *  Returns the per-target SOURCE bracket plus a TFLAG:193 outcome multiplier.
 *  V1 omits `IF TFLAG:193 == -1 || -2` (command-end bail) since the gate
 *  is upstream's @EVENTCOMEND; the runtime collapses to "0/1/2 → "
 *  success/normal/great-success, faithful to the bracket.
 *
 * `rng` is the per-call RNG from CommandContext (NOT GameState — the RNG
 *  is ephemeral, not persisted). The bracket roll uses `rng.int(local)`
 *  faithful to upstream's `RAND:LOCAL`. */
function computeSources(
  state: Readonly<GameState>,
  target: number,
  rng: { int(max: number): number } | undefined,
): {
  source: Record<number, number>;
  outcome: -1 | 0 | 1;
} {
  const slot: CharaSlot | undefined =
    target > 0 ? state.charas[target] : undefined;
  const abl = slot?.state.ABL ?? {};
  const cflag = slot?.state.CFLAG ?? {};

  // LOCAL = 50 + ABL:MASTER:話術技能 * 5 + ABL:TARGET:親密 * 2
  // −15 if BASE:TARGET:酒気 > MAXBASE / 2
  const masterTalk = state.master.state.ABL[ABL_話術技能] ?? 0;
  const targetIntimacy = abl[ABL_親密] ?? 0;
  const targetDrunk = cflag[BASE_酒気] ?? 0;
  const targetDrunkCap = cflag[MAXBASE_酒気] ?? 0;
  let local = 50 + masterTalk * 5 + targetIntimacy * 2;
  if (targetDrunk > targetDrunkCap / 2) local -= 15;

  // Roll the bracket (TFLAG:192 = 0 = default path; force paths are
  // upstream's `CALL KOJO_MESSAGE_SEND`-driven, not modeled in V1).
  let outcome: -1 | 0 | 1;
  if (rng) {
    const r = rng.int(Math.max(1, local));
    if (r < 20) outcome = -1;
    else if (r < 50) outcome = 0;
    else outcome = 1;
  } else {
    outcome = 0;
  }

  // 歓楽 base by ABL:親密
  let kanraku = 200;
  const intim = abl[ABL_親密] ?? 0;
  if (intim <= 1) kanraku += intim * 30;
  else if (intim <= 3) kanraku += 200 + intim * 30;
  else if (intim <= 5) kanraku += 500 + intim * 30;
  else if (intim <= 8) kanraku += 750 + intim * 50;
  else if (intim <= 10) kanraku += 1000 + intim * 50;
  else kanraku += 1600 + intim * 30;
  kanraku = Math.min(kanraku, 5000);

  const juyun = abl[ABL_従順] ?? 0;
  const sadism = abl[ABL_施虐属性] ?? 0;
  const sources: Record<number, number> = {
    [SOURCE_歓楽]: kanraku,
    [SOURCE_受動]: 100 + 100 * juyun,
    [SOURCE_征服]: 100 + 100 * sadism,
  };

  // Outcome multiplier
  const m = outcome === -1 ? 0.1 : outcome === 0 ? 1.0 : 2.0;
  sources[SOURCE_歓楽] = times(sources[SOURCE_歓楽]!, m);
  sources[SOURCE_受動] = times(sources[SOURCE_受動]!, m);
  sources[SOURCE_征服] = times(sources[SOURCE_征服]!, m);

  // ABL:MASTER:話術技能 multiplier
  let talkMul = 0.2;
  if (masterTalk === 1) talkMul = 0.4;
  else if (masterTalk === 2) talkMul = 0.7;
  else if (masterTalk === 3) talkMul = 1.0;
  else if (masterTalk === 4) talkMul = 1.2;
  else if (masterTalk >= 5) talkMul = 1.5;
  sources[SOURCE_歓楽] = times(sources[SOURCE_歓楽]!, talkMul);
  sources[SOURCE_受動] = times(sources[SOURCE_受動]!, talkMul);
  sources[SOURCE_征服] = times(sources[SOURCE_征服]!, talkMul);

  return { source: sources, outcome };
}

export const diary406HandlerEntry: HandlerEntry = {
  commandNo: 406,
  prompt: (ctx) => {
    const owner = checkOwner(ctx.state, ctx.target);
    return menuPrompt(ctx.state, ctx.target, owner);
  },
  execCheck: (ctx) => {
    // !FLAG:時間停止
    if ((ctx.state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0)
      return { ok: false, reason: { kind: "precondition", message: "时间停止中无法阅读日记。" } };
    // !CFLAG:MASTER:恶作剧
    if ((ctx.state.master.state.CFLAG[CFLAG_ID.恶作剧] ?? 0) !== 0)
      return { ok: false, reason: { kind: "precondition", message: "恶作剧模式中无法阅读日记。" } };
    // !CFLAG:MASTER:诶嘿嘿
    if ((ctx.state.master.state.CFLAG[CFLAG_ID.诶嘿嘿] ?? 0) !== 0)
      return { ok: false, reason: { kind: "precondition", message: "现在没有心思看日记。" } };
    // AT_HOME || OMANEKI_PLACE
    const atBase = atPlayerBase(ctx.state, 0);
    const atOmaneki = ctx.state.master.location === OMANEKI_PLACE;
    if (!atBase && !atOmaneki)
      return { ok: false, reason: { kind: "precondition", message: "只能在据点或待客室读日记。" } };
    // 约会中 block (upstream: not a separate gate, but AT_HOME already
    // returns false when chkDateNow is true; double-insure here).
    if (chkDateNow(ctx.state.master.state.CFLAG[CFLAG_ID.约会中] ?? 0))
      return { ok: false, reason: { kind: "precondition", message: "约会途中没空看日记。" } };

    // Without OWNER, upstream exposes the player's diary only in the
    // master's own initial room. AT_HOME is merely the outer map gate: it
    // must not turn every public room in the base into a diary location.
    const masterInitial = ctx.state.master.state.CFLAG[CFLAG_ID.初期位置] ?? 0;
    const masterCurrent = ctx.state.master.state.CFLAG[CFLAG_ID.現在位置] ?? 0;
    if (ctx.target <= 0 && masterInitial > 0 && masterCurrent === masterInitial) return { ok: true };
    if (ctx.target > 0 && checkOwner(ctx.state, ctx.target) > 0) return { ok: true };
    return { ok: false, reason: { kind: "precondition", message: "这里没有可读的日记。" } };
  },
  handler: (ctx) => {
    const owner = checkOwner(ctx.state, ctx.target);
    let choice = requirePickOne(menuPrompt(ctx.state, ctx.target, owner), ctx.promptAnswer);
    let next = cloneGameState(ctx.state);
    let lines: string[];
    // Fast path: when the UI has already mounted the textarea and the
    // player submitted text, the answer is a free_text payload — we
    // bypass the menu and write the entry directly. The UI surfaces
    // this same handler twice in a row: first with a pick_one answer
    // (id 0), which returns a "待输入" stub telling the UI to mount the
    // textarea; then with a free_text answer, which writes the entry.
    if (ctx.promptAnswer?.kind === "free_text") {
      next = appendMasterDiaryEntry(next, ctx.promptAnswer.value);
      lines = isMasterDiaryFull(next)
        ? ["日记本写满了。"]
        : ["日记写完了。"];
      return {
        state: next,
        events: lines.map((text) => ({ kind: "NARRATION" as const, timestamp: ctx.now(), text })),
        outcome: "noop" as const,
      };
    }
    switch (choice) {
      case 0: {
        // First pass for option 0: emit the free_text prompt spec so the
        // UI mounts the textarea. The text arrives in a follow-up call
        // (handled above by the fast path).
        const textSpec = freeText("请直接输入日记内容。", {
          placeholder: "今天发生了…",
          multiline: true,
          submitLabel: "写入日记",
        });
        lines = [
          `(待输入：${textSpec.question})`,
          "提示：玩家界面应在此处显示文本框。",
        ];
        break;
      }
      case 1: {
        lines = readMasterDiaryLines(next);
        break;
      }
      case 2: {
        const targetSlot = next.charas[ctx.target];
        const intim = targetSlot?.state.ABL[ABL_親密] ?? 0;
        if (intim < 5) {
          lines = [`${targetSlot?.callName ?? "对方"}似乎不感兴趣…`];
          break;
        }
        lines = [
          `${targetSlot?.callName ?? "对方"}拿起了你的日记…`,
          ...readMasterDiaryLines(next),
        ];
        break;
      }
      case 3: {
        lines = readCharaDiaryLines(next, owner, ctx.dialogueRouter, ctx.rng);
        break;
      }
      case 4:
      case 5: {
        lines = ["（日记簿文件读写尚未实装。）"];
        break;
      }
      case 6:
      default: {
        return {
          state: next,
          events: [
            { kind: "NARRATION", timestamp: ctx.now(), text: "你合上了日记本。" },
          ],
          outcome: "noop" as const,
        };
      }
    }

    // SOURCE settlement — only fires when the chosen branch is the
    // "TARGET reads yours" (2) or "read OWNER's diary" (3) path, faithful
    // to upstream's $SKIP block that runs only after an actual diary read
    // (not on write / noop / file paths).
    if (choice === 2 || choice === 3) {
      const { source, outcome } = computeSources(next, ctx.target, ctx.rng);
      // Emit each non-zero SOURCE as its own NARRATION line for the UI.
      for (const [k, v] of Object.entries(source)) {
        if (v === 0) continue;
        lines.push(`  +SOURCE:${k} ${v}（${outcome === -1 ? "失败" : outcome === 0 ? "通常" : "大成功"}）`);
      }
    }

    return {
      state: next,
      events: lines.map((text) => ({ kind: "NARRATION" as const, timestamp: ctx.now(), text })),
      outcome: "noop" as const,
    };
  },
};

/** Re-exported for unit tests. */
export { checkOwner as diary406CheckOwner };
// roomIdToLocation is intentionally imported for symmetry (the OWNER
// fallback uses PRIVATEROOM map, which lives in room-id-location.ts).
void roomIdToLocation;
void TALENT_ID;
