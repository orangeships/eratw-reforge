/**
 * UI review (2026-06-20) — command grouping, faithful to the upstream taxonomy.
 *
 * The original eraTW command panel has exactly TWO groups (see
 * `USERCOM_コマンド表示処理.ERB` + `QOL_USERCOM.ERB`):
 *
 *   1. **Act_COM** — the main command grid. `QOL_SHOW_USERCOM` walks
 *      `FOR 0..800`, shows only `@COM_ABLE`-passing commands, and the player
 *      filters it by COM_TAGS class via the 过滤器 row: Ｖ / Ａ / ＳＭ / 侍奉 /
 *      性骚扰 / 家务 / 剧本. It force-wraps at 200/300/350/400.
 *   2. **Ex_COM** — a collapsible utility row (toggle id 3002): 移动[400] /
 *      外出[405] / 散步[604] + 污渍显示 / 变更对象 / 能力显示 / 道具 / 存档 /
 *      锁门 / 日历 … (utilities, NOT settlement commands).
 *
 * Crucially 400/405/604 are `GROUPMATCH(LOCAL,400,405,604) CONTINUE`-skipped
 * from Act_COM (QOL_USERCOM.ERB:38) — they live in Ex_COM / the map, NOT the
 * command grid. So "移动[400]" must never appear as a daily command.
 *
 * The category of each Act_COM command is the faithful COM_TAGS bitfield
 * (`command-tags.bundle.json`, built by `build-command-tags.ts`): Ｖ系/Ａ系/
 * ＳＭ系/侍奉/性骚扰/家务. Commands with no filter tag fall into a small set of
 * range-based families (愛撫前戯/玩具/H入口/自慰/剧本/日常) — the upstream
 * force-wrap groups for the untagged remainder.
 */

import commandTags from "./command-tags.bundle.json";

const TAG_CATEGORY: Record<string, { tags: string[]; category: string }> =
  commandTags as Record<string, { tags: string[]; category: string }>;

export interface CommandFamily {
  id: string;
  /** Player-facing group label (Chinese, matching the upstream filter row). */
  label: string;
  /** Core families show by default; extra (intimate) families live under Ex_COM. */
  core: boolean;
}

/**
 * Family definitions, in display order. Core = everyday page (always shown);
 * extra = うふふ/調教 families behind the Ex_COM collapse. Order mirrors the
 * upstream filter row (交流→日常→外出 first, then 收藏→Ｖ→Ａ→ＳＭ→侍奉→性骚扰).
 */
export const COMMAND_FAMILIES: ReadonlyArray<CommandFamily> = [
  { id: "comm", label: "交流", core: true }, // 会話 / お茶 / 頭撫 等 日常コミュ
  { id: "daily", label: "日常", core: true }, // 仕事手伝 / 家事 / 活動
  { id: "kaji", label: "家务", core: true }, // BIT_家事コマンド
  { id: "sekuhara", label: "性骚扰", core: true }, // BIT_セクハラコマンド (日常 page, 关系-gated)
  { id: "kojo", label: "剧本", core: false }, // 270-299 个人口上 custom
  { id: "foreplay", label: "爱抚前戏", core: false }, // 收藏: 愛撫/キス/前戯 (no filter tag)
  { id: "toy", label: "道具", core: false }, // ローター/玩具/避妊具
  { id: "v", label: "Ｖ系", core: false }, // BIT_V使用コマンド
  { id: "a", label: "Ａ系", core: false }, // BIT_A使用コマンド
  { id: "service", label: "侍奉", core: false }, // BIT_奉仕コマンド
  { id: "sm", label: "ＳＭ", core: false }, // BIT_SMコマンド
  { id: "hmode", label: "H・特殊", core: false }, // 350-368 H入口/状态机 + 特殊
  { id: "solo", label: "自慰", core: false }, // 700-751
  { id: "other", label: "其他", core: false },
];

const FAMILY_BY_ID = new Map(COMMAND_FAMILIES.map((f) => [f.id, f]));

/** Map a commandNo to its family id. The faithful COM_TAGS category wins;
 *  untagged commands fall back to the upstream force-wrap ranges. */
export function familyIdOf(n: number): string {
  // 1) Faithful COM_TAGS category (V/A/SM/侍奉/性骚扰/家务) — the authority.
  const tagged = TAG_CATEGORY[String(n)];
  if (tagged) {
    // Map the extractor's category codes to family ids.
    switch (tagged.category) {
      case "v": return "v";
      case "a": return "a";
      case "sm": return "sm";
      case "service": return "service";
      case "sekuhara": return "sekuhara";
      case "kaji": return "kaji";
    }
  }

  // 2) Untagged remainder → upstream force-wrap ranges.
  if (n >= 270 && n <= 299) return "kojo"; // 个人口上 custom commands (剧本)
  if (n === 304) return "daily"; // 仕事を手伝う (before the 300-309 comm range)
  // Everyday communication / daily activity (300-349 minus tagged sekuhara).
  if (n >= 300 && n <= 309) return "comm"; // 会話/お茶/膝枕/お腹/頬/頭撫…
  if (n >= 330 && n <= 349) return "comm"; // 食事/お酒/酌 等 (untagged daily touch)
  if (n >= 400 && n <= 499) return "daily"; // 日常活動 (勉強/採集/風呂…) — note 400/405 are Ex_COM, filtered out upstream
  if (n >= 603 && n <= 699) return "daily"; // 外出系 (散策/店/デート) — 604 is Ex_COM
  // Intimate untagged families.
  if (n >= 0 && n <= 26) return "foreplay"; // 愛撫/キス/前戯 root (收藏)
  if (n >= 40 && n <= 51) return "toy"; // ローター/玩具/避妊具
  if (n >= 60 && n <= 79) return "v"; // 体位 (most are V-tagged; untagged → V系)
  if (n >= 80 && n <= 89) return "service"; // 奉仕系; 86-89 omit filter tags upstream
  if (n >= 90 && n <= 99) return "hmode"; // 被〜/疑似挿入; untagged but 調教-only
  if (n >= 100 && n <= 150) return "sm"; // SM (most are SM-tagged; untagged → SM)
  if (n >= 151 && n <= 199) return "hmode"; // 被〜体位/特殊装备/特殊PLAY (润滑/媚药/视频/野外/羞恥…) — all うふふ-only
  if (n >= 310 && n <= 316) return "sekuhara"; // 日常 touch 亲密尾段 (胸/尻/愛撫…)
  if (n >= 317 && n <= 323) return "hmode"; // 腰を動かす / 对方主导体位 (うふふ-only)
  // 368 自由行動に付き合う is an everyday 日常系 command (accompany an NPC's free
  // action), NOT an H act — group it as 日常 even though it sits in the 350-368
  // H-cluster号段. (It's already exempt from H-gating via H_MODE_ENTRY_COMMANDS.)
  if (n === 368) return "daily";
  if (n >= 350 && n <= 368) return "hmode"; // H入口/状态机
  if (n === 233 || n === 270 || n === 511 || n === 850) return "hmode";
  if (n >= 700 && n <= 751) return "solo"; // 自慰系
  return "other";
}

/** Resolve a commandNo to its CommandFamily (default "其他"). */
export function familyOf(n: number): CommandFamily {
  return FAMILY_BY_ID.get(familyIdOf(n)) ?? FAMILY_BY_ID.get("other")!;
}

/** Families that are sex acts → only shown during うふふ (H-mode). Mirrors the
 *  upstream QUICKFILTER: V/A/SM/侍奉 + the untagged intimate families
 *  (爱抚前戏/道具/H/自慰) are うふふ-only; 交流/日常/家务/性骚扰/剧本 are everyday. */
const H_MODE_FAMILY_IDS: ReadonlySet<string> = new Set([
  "foreplay", "toy", "v", "a", "service", "sm", "hmode", "solo",
]);

/** The H-mode ENTRY commands — how you ENTER うふふ. These MUST stay visible on
 *  the everyday page (their own execCheck decides when), otherwise うふふ would
 *  be unreachable and no sex act could ever fire. Faithful to the entry cluster:
 *  350 押し倒す / 351 連れ出す / 353 イタズラ / 354 添い寝 / 355 時間停止 /
 *  356 物陰に誘う / 357 セフレ契約 / 358 他者変身. (360/361 身を任せる/抵抗する
 *  are partner-led IN-うふふ acts, so they stay gated.) */
const H_MODE_ENTRY_COMMANDS: ReadonlySet<number> = new Set([
  // 368 is the everyday "join current free action" command, not an H-only act.
  350, 351, 353, 354, 355, 356, 357, 358, 368,
]);

/** Whether a command is a うふふ-only sex act (by its faithful tag/family).
 *  This is the authority the UI uses to hide sex acts outside 調教 — it
 *  subsumes the runtime range-based `requiresHMode` and also catches the
 *  tagged V/A acts (314/316) and partner-led positions (317-323) the ranges
 *  missed. 性骚扰 (sekuhara) is everyday-page, so NOT gated; the H-mode ENTRY
 *  commands are NOT gated (they're how you enter うふふ). */
export function familyRequiresHMode(commandNo: number): boolean {
  if (H_MODE_ENTRY_COMMANDS.has(commandNo)) return false;
  return H_MODE_FAMILY_IDS.has(familyIdOf(commandNo));
}

/** General utility retained beside the H action grid. The upstream H panel
 * keeps the item picker (490), while ordinary daily commands stay on the
 * normal page. */
const H_MODE_TOOL_COMMANDS: ReadonlySet<number> = new Set([490]);

/** Whether a command belongs on the H-mode Act_COM page. */
export function familyVisibleInHMode(commandNo: number): boolean {
  return familyRequiresHMode(commandNo) || H_MODE_TOOL_COMMANDS.has(commandNo);
}
