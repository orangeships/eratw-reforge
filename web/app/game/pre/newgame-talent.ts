/**
 * #13 原版开场流程 Slice 3b — ANATA 素质(性格档位 + on/off + 性器门控) data.
 *
 * All 素质 a fresh MASTER can edit in the 扮演模式 custom terminal. Faithful
 * to `@CUSTOM_TALENT_MENU` / `@CUSTOM_TALENT` / `@CUSTOM_選べない素質`
 * (NEWGAME_CUSTOM.ERB:583-887) for **MASTER, non-debug, `FLAG:周回数 == 0`**:
 * only ids the 選べない素質 predicate leaves selectable (RETURNF 0).
 *
 * Numeric ladders mirror `@GET_TALENTNAME`
 * (ステータス表示関連/PRINT_TALENTNAME.ERB:43-119). Player-facing copy has
 * three intentional presentation overrides: 年龄 0=青年, 性的兴趣 1=开放的,
 * and 目立ちたがり=爱出风头. Other empty labels render as 「中立」 for
 * `kind:"level"` and 「无」 for `kind:"toggle"`.
 *
 * The `requires` + `needsTalent` fields capture `@CUSTOM_選べない素質` (line
 * 799-887) **MASTER** arms:
 *   - `requires:"female"`        : 処女/胸围/Ｖ感度/風騷/初潮 — 需 `性別 & 1`
 *   - `requires:"hasPenis"`      : 非童貞 — 需 `性別 & 2` (男/扶她)
 *   - `requires:"noPenis"`       : 具現 — 需 `!(性別 & 2)` (女)
 *   - `needsTalent:[150,151]`    : 初潮 — 需 幼児(150) 或 幼稚(151)
 *
 * **Deferred to 3c+ (not in this slice):** 种族(164/166/190-197 周回0 灰显),
 * 90/91/143 种族外观, CUSTOM_RACE_MENU (需 MAGIC_DLC), CUSTOM_INIT 里 CSTR 履历
 * /记念日重置、处女↔V经验 的 经验 联动（经验 编辑归 Slice 4）。
 *
 * No upstream file mutation. No LLM. See `CLAUDE.md`.
 */

export interface AnataTalent {
  id: number;
  /** Display name (TALENT_TR, simplified Chinese). */
  name: string;
  /** "level" = ladder of values, "toggle" = on/off 0/1. */
  kind: "level" | "toggle";
  /** Selectable values in ladder order (toggle: [0, 1]). */
  values: number[];
  /** Parallel labels; "" = the neutral (level) / off (toggle) middle. */
  labels: string[];
  /** Gate from `@CUSTOM_選べない素質`. Undefined = always selectable. */
  requires?: "female" | "hasPenis" | "noPenis";
  /** AND-combine with `requires` — 初潮 also needs 幼児/幼稚. */
  needsTalent?: number[];
}

/** Default label for a value's "" slot, per kind. */
const NEUTRAL = "中立";
const OFF = "无";

/** Fresh-MASTER selectable 素质 (3a 性格 + 3b-i on/off + 3b-ii 档位 + 3b-iii 门控). */
export const ANATA_TALENT: AnataTalent[] = [
  // 3a — 有序档位 性格 (无门控, 不触发 CUSTOM_INIT 归一化)
  { id: 10, kind: "level", name: "胆量", values: [-1, 0, 1], labels: ["胆怯", "", "坚强"] },
  { id: 11, kind: "level", name: "态度", values: [-1, 0, 1], labels: ["坦率", "", "叛逆"] },
  { id: 12, kind: "level", name: "回应", values: [-1, 0, 1], labels: ["老实", "", "傲慢"] },
  { id: 13, kind: "level", name: "自尊心", values: [-1, 0, 1], labels: ["自尊心低", "", "自尊心高"] },
  { id: 17, kind: "level", name: "年龄", values: [-1, 0, 1, 2], labels: ["儿童", "青年", "中年", "老人"] },
  { id: 23, kind: "level", name: "性的兴趣", values: [-1, 0, 1], labels: ["保守的", "", "开放的"] },
  { id: 24, kind: "level", name: "开朗／阴郁", values: [-1, 0, 1], labels: ["阴郁", "", "开朗"] },
  { id: 30, kind: "level", name: "贞操", values: [-1, 0, 1], labels: ["不在乎贞操", "", "贞操重视"] },
  { id: 31, kind: "level", name: "自己爱", values: [-1, 0, 1], labels: ["压抑", "", "解放"] },
  { id: 33, kind: "level", name: "羞耻心", values: [-1, 0, 1], labels: ["不知羞耻", "", "害羞"] },
  { id: 40, kind: "level", name: "痛觉", values: [-1, 0, 1], labels: ["不怕痛", "", "怕痛"] },
  { id: 41, kind: "level", name: "弄湿难易", values: [-1, 0, 1], labels: ["不易湿", "", "容易湿"] },

  // 3b-i — on/off (无门控, 不触发 CUSTOM_INIT 归一化)
  { id: 14, kind: "toggle", name: "傲娇", values: [0, 1], labels: [OFF, "傲娇"] },
  { id: 18, kind: "toggle", name: "懒散", values: [0, 1], labels: [OFF, "懒散"] },
  { id: 19, kind: "toggle", name: "性情不定", values: [0, 1], labels: [OFF, "性情不定"] },
  { id: 20, kind: "toggle", name: "自制心", values: [0, 1], labels: [OFF, "自制心"] },
  { id: 21, kind: "toggle", name: "冷漠", values: [0, 1], labels: [OFF, "冷漠"] },
  { id: 22, kind: "toggle", name: "感情缺乏", values: [0, 1], labels: [OFF, "感情缺乏"] },
  { id: 25, kind: "toggle", name: "一線越えない", values: [0, 1], labels: [OFF, "一線越えない"] },
  { id: 26, kind: "toggle", name: "爱出风头", values: [0, 1], labels: [OFF, "爱出风头"] },
  { id: 27, kind: "toggle", name: "无知", values: [0, 1], labels: [OFF, "无知"] },
  { id: 32, kind: "toggle", name: "抵抗", values: [0, 1], labels: [OFF, "抵抗"] },
  { id: 54, kind: "toggle", name: "猫舌", values: [0, 1], labels: [OFF, "猫舌"] },
  { id: 57, kind: "toggle", name: "漏尿癖", values: [0, 1], labels: [OFF, "漏尿癖"] },
  { id: 60, kind: "toggle", name: "自慰しやすい", values: [0, 1], labels: [OFF, "自慰しやすい"] },
  { id: 62, kind: "toggle", name: "献身的", values: [0, 1], labels: [OFF, "献身的"] },
  { id: 71, kind: "toggle", name: "容易中毒", values: [0, 1], labels: [OFF, "容易中毒"] },
  { id: 80, kind: "toggle", name: "倒错的", values: [0, 1], labels: [OFF, "倒错的"] },
  { id: 82, kind: "toggle", name: "施虐狂", values: [0, 1], labels: [OFF, "施虐狂"] },
  { id: 83, kind: "toggle", name: "受虐狂", values: [0, 1], labels: [OFF, "受虐狂"] },
  { id: 150, kind: "toggle", name: "幼儿／幼儿退行", values: [0, 1], labels: [OFF, "幼儿／幼儿退行"] },
  { id: 151, kind: "toggle", name: "幼稚", values: [0, 1], labels: [OFF, "幼稚"] },

  // 3b-ii — 有序档位 体质 (无门控)
  { id: 61, kind: "level", name: "污臭耐性", values: [-2, -1, 0, 1, 2], labels: ["洁癖症", "污臭敏感", "", "污臭钝感", "污臭无视"] },
  { id: 70, kind: "level", name: "快感応答", values: [-1, 0, 1], labels: ["否定快感", "", "接受快感"] },
  { id: 81, kind: "level", name: "性别嗜好", values: [-1, 0, 1, 2, 3], labels: ["两面通吃", "", "讨厌男人", "讨厌女人", "不信任人类"] },
  { id: 100, kind: "level", name: "体型", values: [-5, -2, -1, 0, 1, 2, 5], labels: ["小人", "幼儿体型", "矮小体型", "普通体型", "高大", "巨躯", "巨人"] },
  { id: 101, kind: "level", name: "Ｃ感度", values: [-1, 0, 1], labels: ["Ｃ钝感", "", "Ｃ敏感"] },
  { id: 103, kind: "level", name: "Ａ感度", values: [-1, 0, 1], labels: ["Ａ钝感", "", "Ａ敏感"] },
  { id: 104, kind: "level", name: "Ｂ感度", values: [-1, 0, 1], labels: ["Ｂ钝感", "", "Ｂ敏感"] },
  { id: 106, kind: "level", name: "Ｍ感度", values: [-1, 0, 1, 2], labels: ["Ｍ钝感", "", "Ｍ敏感", "Ｍ超敏感"] },
  { id: 108, kind: "level", name: "臀围", values: [-2, -1, 0, 1, 2], labels: ["幼臀", "小臀", "纤臀", "翘臀", "丰臀"] },
  { id: 121, kind: "level", name: "酒耐性", values: [-2, -1, 0, 1, 2, 3], labels: ["不会喝酒", "不擅喝酒", "", "擅于喝酒", "酒豪", "海量"] },

  // 3b-iii — 性器门控 (须配 CUSTOM_INIT 归一化, 见 normalizeMasterTalentByGender)
  { id: 0, kind: "level", name: "处女", requires: "female", values: [-1, 0, 1, 2], labels: ["无自觉非处女", "", "处女", "再生处女"] },
  { id: 102, kind: "level", name: "Ｖ感度", requires: "female", values: [-1, 0, 1], labels: ["Ｖ钝感", "", "Ｖ敏感"] },
  { id: 105, kind: "level", name: "胸围", requires: "female", values: [-2, -1, 0, 1, 2], labels: ["绝壁", "贫乳", "纤乳", "巨乳", "爆乳"] },
  { id: 142, kind: "toggle", name: "风骚", requires: "female", values: [0, 1], labels: [OFF, "风骚"] },
  { id: 156, kind: "toggle", name: "初潮", requires: "female", needsTalent: [150, 151], values: [0, 1], labels: [OFF, "初潮"] },
  { id: 1, kind: "toggle", name: "非童贞", requires: "hasPenis", values: [0, 1], labels: [OFF, "非童贞"] },
  { id: 146, kind: "toggle", name: "具现", requires: "noPenis", values: [0, 1], labels: [OFF, "具现"] },
];

/**
 * Player-facing identity traits. This is deliberately a presentation
 * projection, not a reduced TALENT catalog: hidden entries remain available
 * to deterministic initialization, normalization and gameplay rules.
 *
 * The same ordered projection is also the sole TALENT source exposed to L1 as
 * protagonist.traits, keeping the opening screen and prompt contract in
 * sync without granting AI any state authority.
 */
export const PLAYER_TALENT_DISPLAY_IDS = [
  10, 11, 12, 17, 23, 24, 33,
  14, 18, 19, 20, 21, 26, 27, 151,
  81, 100,
] as const;

export const PLAYER_TALENT: readonly AnataTalent[] = PLAYER_TALENT_DISPLAY_IDS.map((id) => {
  const talent = ANATA_TALENT.find((candidate) => candidate.id === id);
  if (!talent) throw new Error(`Missing player-facing TALENT definition: ${id}`);
  return talent;
});

/** The label shown for `value` on `talent` ("" neutral → 中立/无 by kind). */
export function talentLevelLabel(talent: AnataTalent, value: number): string {
  const i = talent.values.indexOf(value);
  if (i < 0) return talent.kind === "toggle" ? OFF : NEUTRAL;
  return talent.labels[i] === ""
    ? talent.kind === "toggle" ? OFF : NEUTRAL
    : talent.labels[i]!;
}

/** Structured player-trait values for L1; no hidden TALENT is included. */
export function playerTalentSummaryForL1(
  state: Readonly<GameState>,
): Record<string, string | boolean> {
  const entries: [string, string | boolean][] = [];
  for (const talent of PLAYER_TALENT) {
    const value = state.master.state.TALENT[talent.id] ?? 0;
    if (talent.kind === "toggle") {
      if (value !== 0) entries.push([talent.name, true]);
      continue;
    }
    const label = talentLevelLabel(talent, value);
    if (label !== NEUTRAL) entries.push([talent.name, label]);
  }
  return Object.fromEntries(entries);
}

/** Whether the talent is selectable given the chosen 性别 and current 依赖 talent picks. */
export function anataTalentSelectable(
  t: AnataTalent,
  gender: 1 | 2 | 3,
  draftTalent: Record<number, number>,
): boolean {
  if (t.requires === "female" && (gender & 1) === 0) return false;
  if (t.requires === "hasPenis" && (gender & 2) === 0) return false;
  if (t.requires === "noPenis" && (gender & 2) !== 0) return false;
  if (t.needsTalent && t.needsTalent.length > 0) {
    const has = t.needsTalent.some((id) => (draftTalent[id] ?? 0) !== 0);
    if (!has) return false;
  }
  return true;
}

/** Remove the gated ids from `draftTalent` that no longer match `gender` (used on 性别 switch). */
export function filterDraftTalentForGender(
  draftTalent: Record<number, number>,
  gender: 1 | 2 | 3,
): Record<number, number> {
  const out: Record<number, number> = {};
  for (const t of ANATA_TALENT) {
    const v = draftTalent[t.id];
    if (v === undefined) continue;
    if (anataTalentSelectable(t, gender, draftTalent)) out[t.id] = v;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 归一化 (@CUSTOM_INIT, NEWGAME_CUSTOM.ERB:94-145, 性格+能力 arms only).
// Faithful to the upstream gender/性器 clearing rules. 经验 联动 / CSTR 履历 /
// 记念日重置 归 Slice 4 (经验 editor) — 3b 不编辑 经验, 种子 经验 多数为 0.
// ---------------------------------------------------------------------------

/** `@CUSTOM_選べない素質`-style 性別 arms.  */
import { getMasterTalent, setMasterAbl, setMasterTalent } from "../../../../modernization/runtime/state/settlement.js";
import type { GameState } from "../../../../modernization/runtime/state/index.js";

/** Non-`ABL_ID` abl ids (sexuality-axis `ABL_百合属性`/`断袖属性`/`百合中毒`/
 *  `断袖中毒` — line 17/18/32/33 of `CSV/Abl.csv`; not used by the runtime yet
 *  so they live here as raw constants with the source file pointer). */
const ABL_YURI = 17;
const ABL_YURI_ADDICT = 32;
const ABL_FUDAN = 18;
const ABL_FUDAN_ADDICT = 33;
const ABL_V_SENSE = 1;
const ABL_VIRGIN_LV = 0; // ABL: V感覚, mirrored here for normalize

/**
 * Apply `@CUSTOM_INIT` gender/性器 clearing rules to the master, after the
 * `draft.talent` has been written. Only 性格+能力 arms are ported in 3b;
 * 经验/CSTR/记念日 sides stay untouched.
 */
export function normalizeMasterTalentByGender(
  state: GameState,
  gender: 1 | 2 | 3,
): void {
  const abl = state.master.state.ABL;

  // 女体 (性別 & 1) — 清 断袖系; 扶她 (性別 != 1) — 清 具現 (CUSTOM_INIT:107)
  if ((gender & 1) !== 0) {
    abl[ABL_FUDAN] = 0;
    abl[ABL_FUDAN_ADDICT] = 0;
    if (gender !== 1) setMasterTalent(state, 146, 0);
  } else {
    // 男体 — 清 Ｖ系/女系/处女/母乳/胸围/風騷/初潮/具現
    setMasterAbl(state, ABL_V_SENSE, 0);
    abl[ABL_YURI] = 0;
    abl[ABL_YURI_ADDICT] = 0;
    setMasterTalent(state, 102, 0); // Ｖ感度
    setMasterTalent(state, 0, 0); // 処女
    setMasterTalent(state, 149, 0); // 母乳体質
    setMasterTalent(state, 105, -2); // 胸围 = -2 (CUSTOM_INIT:124)
    setMasterTalent(state, 142, 0); // 風騷
    setMasterTalent(state, 156, 0); // 初潮
    setMasterTalent(state, 146, 0); // 具現
  }
  // 无男器 — 清 非童貞/形状 (CUSTOM_INIT:140-144)
  if ((gender & 2) === 0) {
    setMasterTalent(state, 1, 0); // 非童貞
    setMasterTalent(state, 250, 0); // 形状
  }
  // 処女==1 → 清 Ｖ感覚 (CUSTOM_INIT:147-149)
  if (getMasterTalent(state, 0) === 1) {
    setMasterAbl(state, ABL_VIRGIN_LV, 0);
  }
}
