/**
 * 角色情报看板数据层（纯函数） — PAGE 0..5 + Personal History 的纯数据视图。
 *
 * 设计原则：
 *   - 每个导出函数都是纯函数（输入 GameState/charaNum，输出结构化对象）。
 *   - UI 层 (`web/app/game/CharacterInfoPopup.tsx`) 只读 `buildCharaInfoSnapshot`
 *     的结果，禁止直接读 `state.charas[N].state.CFLAG[…]` 等命名空间。
 *   - 命名空间访问集中在 snapshot 构造里，forbidden-names 守卫豁免 modernization 路径。
 *
 * 涵盖：
 *   1. `buildCharaInfoSnapshot`   BASIC_STATE 头部所有字段
 *   2. `computePersonalHistory`    38 类 Personal History 已解锁条目
 *   3. `evaluateFallRequirements` PAGE 5 NPC 5 阶段条件表
 *   4. `evaluateSkillTrack`        PAGE 5 MASTER 技能习得轨迹
 *   5. `recordPersonalHistory`      写点（上层钩子调用）
 */

import {
  emptyCharaSlotState,
  type CharaSlot,
  type CharaSlotState,
  type GameState,
} from "./game-state.js";
import {
  ABL_ID,
  BASE_ID,
  CFLAG_ID,
  EXP_ID,
  EX_ID,
  FLAG_ID,
  PALAM_ID,
  TALENT_ID,
} from "./settlement.js";
import {
  charaCstrOf,
  charaDataOf,
  charaIntroParagraphs,
  foldTasteTags,
  specialtyOf,
  type TasteTag,
} from "./chara-data.js";
import { buildSizePanel, type SizePanel } from "./make-size.js";
import { buildTalentCategories, type TalentCategoryRow } from "./talent-categories.js";
import { buildBodyInfo, type BodyInfo } from "./body-info.js";
import { buildUwakiRows, type UwakiRow } from "./uwaki.js";
import { buildGiftHistory, type GiftHistoryRow } from "./gifts.js";
import { relationOf } from "../world/relation.js";
import { isTrainingTarget } from "../command/training-session.js";
import { FALL_THRESHOLDS, FALL_STAGES, type FallStageKey } from "./fall-constants.js";
import {
  HISTORY_CATEGORY_COUNT,
  HISTORY_LABEL,
  HISTORY_LOCK_NOAUTO,
  Qol_Dates,
  emptyHistoryArray,
  lockHolds,
} from "./personal-history.js";
import { getBattleAbilityDisplay, getFortune, getRebellionBrand } from "./named-stats.js";
import { ABILITY_GRID_ROWS, genderHideAbility } from "./ability-grid.js";
import { describeClothing, type ClothingDescription } from "./clothing.js";

// ---------------------------------------------------------------------------
// BASIC_STATE 头部 snapshot
// ---------------------------------------------------------------------------

export type HModeChip =
  | "dangerous-day-raw"
  | "raw-ok"
  | "consent"
  | "none";

export interface RelationRow {
  key: "好感度" | "信頼度" | "情緒" | "理性" | "憤怒";
  value: number;
  /** 上游 PRINT_RANK 文字片段（如 `MAX_50000`）；现代用 5 档内联文字。 */
  rankLabel: string;
}

export interface NamedBar {
  key: "体力" | "気力" | "酒" | "TSP" | "精力";
  value: number;
  max: number;
}

export interface VictoryStar {
  key: "弹数" | "斗虫" | "料理";
  value: number;
}

export interface BasicHeader {
  isMaster: boolean;
  /** MASTER 才显示。 */
  money?: { current: number; chips: number; talisman: number };
  /** NPC 才显示。 */
  favor?: { value: number; trust: number; id?: number };
  hModeChip: HModeChip;
  hModeChipText: string;
  /** BASE bars — MASTER 全 5 个；NPC 4 个（无 TSP/精力）。 */
  named: NamedBar[];
  relations: RelationRow[];
  victory: VictoryStar[];
  /** 欲求不満度，仅 NPC。 */
  lust?: { value: number; tier: "calm" | "want" | "frustrated" | "restless" | "burning" };
  /** 反発刻印（MARK:3）品牌阶 0..3 — kuchiku-mark-rescue (2026-07-09).
   *  仅 NPC。`undefined` 表示没有该值（例如 MASTER 路径）。 */
  brand?: { tier: number; max: number };
  fortune: number;
  /** 「▼〜的呢喃」 — modern 端暂无 呢喃 数据，空数组。 */
  whispers: { header: string; lines: string[] }[];
}

function rankLabel(value: number, max: number): string {
  if (value >= max) return "MAX";
  if (value >= max * 0.8) return "SSS";
  if (value >= max * 0.6) return "SS";
  if (value >= max * 0.4) return "S";
  if (value >= max * 0.2) return "A";
  if (value > 0) return "B";
  return "G";
}

function hModeChipOf(slot: CharaSlot): { chip: HModeChip; text: string } {
  const allow = slot.state.CFLAG[CFLAG_ID.允许无套] ?? 0;
  const fact = (slot.state.CFLAG[CFLAG_ID.既成事實] ?? 0) & 1;
  if (allow === 2) return { chip: "dangerous-day-raw", text: "危险日生Ｈ解禁" };
  if (allow === 1) return { chip: "raw-ok", text: "生Ｈ解禁" };
  if (fact) return { chip: "consent", text: "合意取得" };
  return { chip: "none", text: "" };
}

function lustOf(slot: CharaSlot): NonNullable<BasicHeader["lust"]> {
  const v = slot.state.CFLAG[CFLAG_ID.溜まってる度] ?? 0;
  if (v >= 1000) return { value: v, tier: "burning" };
  if (v >= 800) return { value: v, tier: "restless" };
  if (v >= 500) return { value: v, tier: "frustrated" };
  if (v >= 200) return { value: v, tier: "want" };
  return { value: v, tier: "calm" };
}

function buildHeaderFor(slot: CharaSlot, state: GameState): BasicHeader {
  const isMaster = slot.charaNum === 0;
  const st = slot.state;
  const chip = hModeChipOf(slot);
  const named: NamedBar[] = [];
  if (isMaster) {
    named.push(
      { key: "体力", value: st.BASE[BASE_ID.体力] ?? 0, max: st.MAXBASE[BASE_ID.体力] ?? 2000 },
      { key: "気力", value: st.BASE[BASE_ID.気力] ?? 0, max: st.MAXBASE[BASE_ID.気力] ?? 2000 },
      { key: "酒", value: st.BASE[BASE_ID.酒気] ?? 0, max: st.MAXBASE[BASE_ID.酒気] ?? 1000 },
      { key: "TSP", value: st.BASE[BASE_ID.TSP] ?? 0, max: st.MAXBASE[BASE_ID.TSP] ?? 100 },
      { key: "精力", value: st.BASE[BASE_ID.精力] ?? 0, max: st.MAXBASE[BASE_ID.精力] ?? 100 },
    );
  } else {
    named.push(
      { key: "体力", value: st.BASE[BASE_ID.体力] ?? 0, max: st.MAXBASE[BASE_ID.体力] ?? 2000 },
      { key: "気力", value: st.BASE[BASE_ID.気力] ?? 0, max: st.MAXBASE[BASE_ID.気力] ?? 2000 },
      { key: "酒", value: st.BASE[BASE_ID.酒気] ?? 0, max: st.MAXBASE[BASE_ID.酒気] ?? 1000 },
    );
  }

  const getRel = (key: RelationRow["key"]): number => {
    switch (key) {
      case "好感度":
        return st.CFLAG[CFLAG_ID.好感度] ?? 0;
      case "信頼度":
        return st.CFLAG[CFLAG_ID.信頼度] ?? 0;
      case "情緒":
        return st.BASE[BASE_ID.情緒] ?? 0;
      case "理性":
        return st.BASE[BASE_ID.理性] ?? 0;
      case "憤怒":
        return st.BASE[BASE_ID.憤怒] ?? 0;
    }
  };
  const relations: RelationRow[] = (["好感度", "信頼度", "情緒", "理性", "憤怒"] as const).map(
    (key) => {
      const value = getRel(key);
      const max = key === "好感度" ? 50000 : key === "信頼度" ? 20000 : 100;
      return { key, value, rankLabel: rankLabel(value, max) };
    },
  );

  const victory: VictoryStar[] = [
    { key: "弹数", value: st.CFLAG[CFLAG_ID.弾幕勝負勝利] ?? 0 },
    { key: "斗虫", value: st.CFLAG[CFLAG_ID.斗虫直接勝利] ?? 0 },
    { key: "料理", value: st.CFLAG[CFLAG_ID.料理勝負勝利] ?? 0 },
  ];

  const header: BasicHeader = {
    isMaster,
    hModeChip: chip.chip,
    hModeChipText: chip.text,
    named,
    relations,
    victory,
    fortune: getFortune(slot.state),
    whispers: [],
  };

  if (isMaster) {
    const items = state.items ?? {};
    header.money = {
      current: state.money,
      chips: state.money, // modern 没拆筹码槽，暂用 money；后续若引入 `money:2` 可改。
      talisman: items[131] ?? 0,
    };
  } else {
    header.favor = {
      value: st.CFLAG[CFLAG_ID.好感度] ?? 0,
      trust: st.CFLAG[CFLAG_ID.信頼度] ?? 0,
      id: slot.charaNum,
    };
    const lust = lustOf(slot);
    if (lust.tier !== "calm" || lust.value > 0) {
      header.lust = lust;
    } else {
      // 即使 calm + 0 也保留 lust 字段（测试期望 'calm' tier）
      header.lust = lust;
    }
    // kuchiku-mark-rescue (2026-07-09): surface the rebellion-brand tier so
    // the player can see how hostile this NPC is. Hidden when tier==0 so
    // the chip never leaks info about unriled NPCs.
    header.brand = getRebellionBrand(st);
  }

  return header;
}

// ---------------------------------------------------------------------------
// Personality / lifestyle / preferences 解锁段（PAGE 2）
// ---------------------------------------------------------------------------

export interface CharaPersonality {
  /** 性格傾向 (CFLAG:560)。上游有 8+ 种分支，modern 端输出 1-2 段最长 prose 即可。 */
  type: string;
  /** 作息表 — 起床/就寝/来訪/帰宅时间。 */
  schedule: {
    wakeMin: number | null;
    sleepMin: number | null;
    visitMin: number | null;
    returnMin: number | null;
  };
  /** 自宅位置 — 面識后才有。 */
  homeLocation: string | null;
  /** よく行く地域 — 平时出现地图。 */
  favoriteMapId: number | null;
  /** 工作（工作名 + 職場）。 */
  jobLabel: string | null;
  workLocation: string | null;
  /** 角色介绍段落（CSV CSTR 10..19，PRINT_STATE2.ERB:167-170）。空数组 = 无介绍。 */
  introduction: string[];
  /** 工作情报（CSTR:工作情報）。 */
  workInfo: string;
  /** 面識前的占位（"■■■■■"）。 */
  homeLocationMasked: boolean;
}

const HHMM_RE = /^-?(\d{1,4})$/;
function minToHHMM(v: number | null | undefined): number | null {
  if (v === null || v === undefined || !HHMM_RE.test(String(v))) return null;
  const n = Number(v);
  if (n < 0) return null;
  return Math.min(1439, n);
}

/** `@PERSONALITY_TYPE`（PRINT_STATE2.ERB:870）— 5 分支性格文本。0/未判明=""。 */
const PERSONALITY_TYPE: Readonly<Record<number, string>> = {
  1: "弱势系",
  2: "强势系",
  3: "坦率系",
  4: "认真系",
  5: "其他",
};

export function buildCharaPersonality(slot: CharaSlot, _state: GameState): CharaPersonality {
  const st = slot.state;
  // 工作地点 (PRINT_STATE2.ERB:140-147): 風俗嬢→旧地狱温泉；否则 CSTR:2 (職場)；空→"？？？"
  const workPlace =
    (st.TALENT[TALENT_ID.風俗嬢] ?? 0) !== 0
      ? "旧地狱温泉"
      : charaCstrOf(slot.charaNum, "職場") || charaCstrOf(slot.charaNum, "2") || null;
  return {
    type: PERSONALITY_TYPE[st.CFLAG[CFLAG_ID.性格傾向] ?? 0] ?? "",
    schedule: {
      wakeMin: minToHHMM(st.CFLAG[CFLAG_ID.起床時間]),
      sleepMin: minToHHMM(st.CFLAG[CFLAG_ID.就寝時間]),
      visitMin: minToHHMM(st.CFLAG[CFLAG_ID.来訪時間]),
      returnMin: minToHHMM(st.CFLAG[CFLAG_ID.帰宅時間]),
    },
    homeLocation: slot.homeLocation ?? null,
    favoriteMapId: st.CFLAG[CFLAG_ID.よく行く地域] ?? null,
    jobLabel: st.CFLAG[CFLAG_ID.职场] != null ? `职场${st.CFLAG[CFLAG_ID.职场]}` : null,
    workLocation: workPlace,
    introduction: charaIntroParagraphs(slot.charaNum),
    workInfo: charaCstrOf(slot.charaNum, "工作情報"),
    homeLocationMasked: (st.CFLAG[CFLAG_ID.认识] ?? 0) === 0 || !slot.homeLocation,
  };
}

// ---------------------------------------------------------------------------
// Personal narrative 解锁段（PAGE 2，位置在 个人情报 列表下方）
// ---------------------------------------------------------------------------

export interface NarrativeParagraph {
  /** 唯一 id，给 React key 用。 */
  id: string;
  /** "合意取得" / "恋慕" / "妊娠願望" 等段头。 */
  label: string;
  /** 上游 prose 文本。 */
  text: string;
}

/**
 * 解锁段集合（PAGE 2 下方）。
 * 命名空间访问集中在 `evaluateNarrativeParagraphs` 内，UI 层调用此函数即可。
 */
export function evaluateNarrativeParagraphs(
  slot: CharaSlot,
  state: GameState,
): NarrativeParagraph[] {
  const st = slot.state;
  const out: NarrativeParagraph[] = [];

  // 危险日生Ｈ — 允许无套 / 合意 4 档
  const allow = st.CFLAG[CFLAG_ID.允许无套] ?? 0;
  const fact = (st.CFLAG[CFLAG_ID.既成事實] ?? 0) & 1;
  if (allow === 2) out.push({ id: "npc-raw-ok-danger", label: "危险日", text: "是你的话…危险日生Ｈ❤也OK哦" });
  else if (allow === 1) out.push({ id: "npc-raw-ok", label: "生解禁", text: "如果你非要求的话…无套Ｈ❤也不是不行呢" });
  else if (fact) out.push({ id: "npc-consent", label: "合意", text: "和你Ｈ也是可以的❤" });

  // 風騷
  if ((st.TALENT[TALENT_ID.風騷] ?? 0) !== 0) {
    out.push({ id: "npc-frisky", label: "風騷", text: "是个已经觉醒的喜欢搔首弄姿的人" });
  }

  // 恋慕 (×無知 / ×貞操 / ×合意_诶嘿嘿) — 3 档
  // 上游 PRINT_STATE2.ERB:278-288：恋慕 永远显示，按 3 档分支。
  if ((st.TALENT[TALENT_ID.恋慕] ?? 0) !== 0) {
    if ((st.TALENT[TALENT_ID.無知] ?? 0) !== 0) {
      out.push({ id: "npc-love-ignorant", label: "恋慕", text: `${slot.callName ?? `角色${slot.charaNum}`}暗自决定成为主人的新娘` });
    } else if ((st.TALENT[TALENT_ID.貞操] ?? 0) > 0) {
      out.push({ id: "npc-love-virgin", label: "恋慕", text: "明明认为肉体上的关系很不检点，却在内心里渴求与主人进行身体上的交流" });
    } else {
      out.push({ id: "npc-love-anxious", label: "恋慕", text: "因为主人至今还没有碰触自己而感到焦虑不安" });
    }
  }

  // 妊娠願望 × 面識
  if ((st.TALENT[TALENT_ID.妊娠願望] ?? 0) !== 0) {
    const met = (st.CFLAG[CFLAG_ID.认识] ?? 0) !== 0;
    const date = state.time.dayIndex;
    const last = st.CFLAG[CFLAG_ID.最后见面的日子] ?? -9999;
    if (!met) {
      out.push({ id: "npc-preg-unmet", label: "妊娠願望", text: "无论谁都好...想要孩子..." });
    } else if (allow === 2) {
      out.push({ id: "npc-preg-danger", label: "妊娠願望", text: `幻想着有一天主人能让自己怀孕` });
    } else {
      out.push({
        id: "npc-preg-default",
        label: "妊娠願望",
        text: `虽然没有明确的意识到自己的心意，但还是感觉有点想要主人的孩子（距上次见面 ${date - last} 天）`,
      });
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// 个人好恶 (PAGE 3) — 真实 キャラデータ (chara-data.bundle) + SHOW_TASTE 语义
// ---------------------------------------------------------------------------

/** 一组味/感性标签视图。`masked=true` 时 UI 显示 `[？？？？]LvN`（親密不足），
 *  权重仍可见 — 忠实 SHOW_TASTE 的 INVISIBLE 行为（COOKING_UI.ERB:456-458）。 */
export interface TasteView {
  masked: boolean;
  tags: TasteTag[];
}

export interface CharaPreference {
  /** 得意料理（`＊料理系＊` 段，助手効果内）。上游在 mask 之前打印 — 永远可见。 */
  specialty: string | null;
  /** 感性：好き。数据缺失（未收录角色）= null；有数据时 `ABL:親密 < 5` → masked。 */
  likes: TasteView | null;
  /** 感性：嫌い。 */
  dislikes: TasteView | null;
  /** 料理：喜欢的味道。`ABL:親密 < 3` → masked。 */
  foodLikes: TasteView | null;
  /** 料理：讨厌的味道。 */
  foodDislikes: TasteView | null;
  /** 料理：助手効果 — 无 mask 门（上游 ASSIDATA 分支不遮罩）。 */
  assistEffects: TasteTag[];
  /** 喜欢的体位 — `CFLAG:喜欢的体位` 1..10。 */
  preferredPosition: { tier: number; text: string } | null;
}

const POSITION_TEXTS: Readonly<Record<number, string>> = {
  1: "被主人从正面压制着抽插蜜穴❤很容易就投降了",
  2: "让主人从后面狠狠进攻蜜穴❤根本就忍耐不了嘛",
  3: "骑在主人身上动❤能用蜜穴把他榨干兴奋到不行",
  4: "和主人面对面做❤没有比这样更让蜜穴舒服的了",
  5: "背对着主人做爱❤简直就像玩具一样被玩弄蜜穴",
  6: "被主人从正面压制着抽插菊穴❤很容易就投降了",
  7: "让主人从后面狠狠进攻菊穴❤根本就忍耐不了嘛",
  8: "骑在主人身上动❤能用菊穴把他榨干兴奋到不行",
  9: "和主人面对面做❤没有比这样更让菊穴舒服的了",
  10: "背对着主人做爱❤简直就像玩具一样被玩弄菊穴",
};

export function buildCharaPreference(slot: CharaSlot, _state: GameState): CharaPreference {
  const st = slot.state;
  const aff = st.ABL[ABL_ID.親密] ?? 0;
  const tier = st.CFLAG[CFLAG_ID.喜欢的体位] ?? 0;
  const tierNum = tier >= 1 && tier <= 10 ? tier : 0;
  const data = charaDataOf(slot.charaNum);
  const view = (raw: string | undefined, minAff: number): TasteView | null => {
    if (!raw) return null;
    return { masked: aff < minAff, tags: foldTasteTags(raw) };
  };
  return {
    specialty: specialtyOf(data?.assistEffect),
    likes: view(data?.senseLike, 5),
    dislikes: view(data?.senseDislike, 5),
    foodLikes: view(data?.foodLike, 3),
    foodDislikes: view(data?.foodDislike, 3),
    assistEffects: foldTasteTags(data?.assistEffect),
    preferredPosition: tierNum > 0 ? { tier: tierNum, text: POSITION_TEXTS[tierNum]! } : null,
  };
}

// ---------------------------------------------------------------------------
// Snapshot 顶层
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// PAGE 0 — ABL 7×7 网格（带真实数值）
// ---------------------------------------------------------------------------

export interface AbilityGridValueCell {
  /** 中文标签。占位/隐藏格为空串。 */
  name: string;
  /** 实际数值；占位或性别隐藏格为 null。 */
  value: number | null;
  kind: "abl" | "mark" | "placeholder" | "hidden";
  maxRank: 6 | 99;
}

/**
 * 解析 ABL 7×7 网格的实际数值 — 直接读命名空间（modernization 路径豁免守卫）。
 *   - MASTER 抹除 6 个 MARK 格（上游 `能力表示.ERB:1664-1665`）。
 *   - 性别门控：百合/断袖 属性按 `TALENT:性別` bit0 隐藏。
 */
export function buildAbilityGrid(state: GameState, charaNum: number): AbilityGridValueCell[][] {
  const slot = charaNum === 0 ? state.master : state.charas[charaNum];
  const isMaster = charaNum === 0;
  const st = slot?.state;
  const gender = st?.TALENT[TALENT_ID.性別] ?? 0;
  return ABILITY_GRID_ROWS.map((row) =>
    row.map((cell): AbilityGridValueCell => {
      if (cell.source === "placeholder") {
        return { name: "", value: null, kind: "placeholder", maxRank: cell.maxRank };
      }
      if (genderHideAbility(cell.name, gender)) {
        return { name: cell.name, value: null, kind: "hidden", maxRank: cell.maxRank };
      }
      if (cell.source === "mark") {
        if (isMaster) return { name: "", value: null, kind: "placeholder", maxRank: cell.maxRank };
        return { name: cell.name, value: st?.MARK[cell.ablOrMarkId] ?? 0, kind: "mark", maxRank: cell.maxRank };
      }
      return { name: cell.name, value: st?.ABL[cell.ablOrMarkId] ?? 0, kind: "abl", maxRank: cell.maxRank };
    }),
  );
}

// ---------------------------------------------------------------------------
// PAGE 1 — 经验高亮（精选非零经验项）
// ---------------------------------------------------------------------------

export interface ExpEntry {
  label: string;
  value: number;
}

/** 精选一组有意义的经验项，只列非零的（避免 99 项噪声）。 */
const EXP_HIGHLIGHT: ReadonlyArray<{ label: string; id: number }> = [
  { label: "绝顶经验", id: EXP_ID.絶頂経験 },
  { label: "约会经验", id: EXP_ID.約會経験 },
  { label: "爱情经验", id: EXP_ID.愛情経験 },
  { label: "接吻经验", id: EXP_ID.キス経験 },
  { label: "会话经验", id: EXP_ID.会話経験 },
  { label: "料理经验", id: EXP_ID.料理経験 },
  { label: "学习经验", id: EXP_ID.学習経験 },
  { label: "战斗经验", id: EXP_ID.戦闘経験 },
  { label: "采集经验", id: EXP_ID.採集経験 },
  { label: "钓鱼经验", id: EXP_ID.釣り経験 },
];

export function buildExpHighlights(state: GameState, charaNum: number): ExpEntry[] {
  const slot = charaNum === 0 ? state.master : state.charas[charaNum];
  if (!slot) return [];
  const st = slot.state;
  const out: ExpEntry[] = [];
  for (const { label, id } of EXP_HIGHLIGHT) {
    const value = st.EXP[id] ?? 0;
    if (value > 0) out.push({ label, value });
  }
  return out;
}

// ---------------------------------------------------------------------------
// PAGE 1 — 宝珠板（QOL_PRINT_STATE_JUEL, PRINT_STATE2.ERB:30）
// ---------------------------------------------------------------------------

export interface JuelEntry {
  label: string;
  value: number;
  /** 已按上游 1000000/1000000000 单位缩写的显示串。 */
  display: string;
}

/**
 * 固定宝珠板 id 顺序 — 上游 `FOR LOCAL,0,22` 的有名 PALAM（0..21 内）+ 末尾否定珠(100)。
 * 名字取 `PALAMNAME` 中文（PALAM_ID 键），显示时缀「之珠」。
 */
const JUEL_BOARD: ReadonlyArray<{ id: number; name: string }> = [
  { id: PALAM_ID.快Ｃ, name: "快Ｃ" },
  { id: PALAM_ID.快Ｖ, name: "快Ｖ" },
  { id: PALAM_ID.快Ａ, name: "快Ａ" },
  { id: PALAM_ID.快Ｂ, name: "快Ｂ" },
  { id: PALAM_ID.快Ｍ, name: "快Ｍ" },
  { id: PALAM_ID.潤滑, name: "潤滑" },
  { id: PALAM_ID.恭順, name: "恭順" },
  { id: PALAM_ID.欲情, name: "欲情" },
  { id: PALAM_ID.屈服, name: "屈服" },
  { id: PALAM_ID.習得, name: "習得" },
  { id: PALAM_ID.恥情, name: "恥情" },
  { id: PALAM_ID.苦痛, name: "苦痛" },
  { id: PALAM_ID.恐怖, name: "恐怖" },
  { id: PALAM_ID.好意, name: "好意" },
  { id: PALAM_ID.優越, name: "優越" },
  { id: 100, name: "否定" },
];

/** 上游单位缩写：>1e9→m、>1e6→k。 */
function juelDisplay(v: number): string {
  if (v > 1000000000) return `${Math.trunc(v / 1000000)}m`;
  if (v > 1000000) return `${Math.trunc(v / 1000)}k`;
  return String(v);
}

export function buildJuelBoard(state: GameState, charaNum: number): JuelEntry[] {
  const slot = charaNum === 0 ? state.master : state.charas[charaNum];
  if (!slot) return [];
  const st = slot.state;
  return JUEL_BOARD.map(({ id, name }) => {
    const value = st.JUEL[id] ?? 0;
    return { label: `${name}之珠`, value, display: juelDisplay(value) };
  });
}

// ---------------------------------------------------------------------------
// 相性表 (PAGE 2) — Qol_SHOW_RELATION (QoL_ShowRelation.ERB:1-62)
// ---------------------------------------------------------------------------

export interface CompatRow {
  charaNum: number;
  callName: string;
  value: number;
  /** 上游 SETCOLOR 档位：<60 red / <100 salmon / ==100 yellow / <130 pale / <200 green / else aqua。 */
  tier: "red" | "salmon" | "yellow" | "pale" | "green" | "aqua";
}

function compatTier(v: number): CompatRow["tier"] {
  if (v < 60) return "red";
  if (v < 100) return "salmon";
  if (v === 100) return "yellow";
  if (v < 130) return "pale";
  if (v < 200) return "green";
  return "aqua";
}

/** 相性表 — RELATION:chara:* 降序（默认 qol_Relation_AscendingOrder=0），跳过 0。 */
export function buildCompatTable(state: GameState, charaNum: number): CompatRow[] {
  const rows: CompatRow[] = [];
  const consider = (other: number, callName: string) => {
    if (other === charaNum) return;
    const v = relationOf(charaNum, other);
    if (!v) return; // SIF !RELATION → CONTINUE
    rows.push({ charaNum: other, callName, value: v, tier: compatTier(v) });
  };
  consider(0, state.master.callName ?? "主人");
  for (const slot of Object.values(state.charas)) {
    consider(slot.charaNum, slot.callName ?? `#${slot.charaNum}`);
  }
  rows.sort((a, b) => b.value - a.value || a.charaNum - b.charaNum);
  return rows;
}

// ---------------------------------------------------------------------------
// PAGE 1 — 絶頂回数板 (调教中 PRINT_STATE_EX) + 妊娠関連
// ---------------------------------------------------------------------------

export interface ExEntry {
  label: string;
  value: number;
}

/** `@PRINT_STATE_EX` (PRINT_STATE2.ERB:61) — 8 项非零绝顶回数；全零 → null（上游 RETURN 0）。 */
export function buildExBoard(state: GameState, charaNum: number): ExEntry[] | null {
  const slot = charaNum === 0 ? state.master : state.charas[charaNum];
  if (!slot) return null;
  const st = slot.state;
  const board: ReadonlyArray<{ label: string; id: number }> = [
    { label: "Ｃ絶頂", id: EX_ID.Ｃ絶頂 },
    { label: "Ｖ絶頂", id: EX_ID.Ｖ絶頂 },
    { label: "Ａ絶頂", id: EX_ID.Ａ絶頂 },
    { label: "Ｂ絶頂", id: EX_ID.Ｂ絶頂 },
    { label: "Ｍ絶頂", id: EX_ID.Ｍ絶頂 },
    { label: "噴乳", id: EX_ID.噴乳 },
    { label: "射精", id: EX_ID.射精 },
    { label: "放尿", id: EX_ID.放尿 },
  ];
  const out: ExEntry[] = [];
  for (const { label, id } of board) {
    const v = st.EX[id] ?? 0;
    if (v > 0) out.push({ label, value: v });
  }
  return out.length > 0 ? out : null;
}

export interface PregnancyInfo {
  lastCreampieVolume: number;
  pregnancyDays: number;
  nursingCount: number;
  nursingDays: number;
  childCount: number;
}

/** 妊娠関連 (PRINT_STATE2.ERB:566)，门 = `TALENT:妊娠 || CFLAG:兒童人数>0`（能力表示.ERB:1573）。 */
export function buildPregnancyInfo(state: GameState, charaNum: number): PregnancyInfo | null {
  const slot = charaNum === 0 ? state.master : state.charas[charaNum];
  if (!slot) return null;
  const st = slot.state;
  const pregnant = (st.TALENT[TALENT_ID.妊娠] ?? 0) !== 0;
  const children = st.CFLAG[CFLAG_ID.兒童人数] ?? 0;
  if (!pregnant && children <= 0) return null;
  return {
    lastCreampieVolume: st.EX[EX_ID.膣内精液] ?? 0,
    pregnancyDays: st.CFLAG[CFLAG_ID.妊娠経過日数] ?? 0,
    nursingCount: st.CFLAG[CFLAG_ID.育児人数] ?? 0,
    nursingDays: st.CFLAG[CFLAG_ID.出産経過日] ?? 0,
    childCount: children,
  };
}

// ---------------------------------------------------------------------------
// Snapshot 顶层
// ---------------------------------------------------------------------------

export interface CharaInfoSnapshot {
  charaNum: number;
  callName: string;
  location: string;
  homeLocation: string | null;
  header: BasicHeader;
  personality: CharaPersonality;
  narrative: NarrativeParagraph[];
  preference: CharaPreference;
  battleAbilityDisplay: string;
  abilityGrid: AbilityGridValueCell[][];
  clothing: ClothingDescription;
  expHighlights: ExpEntry[];
  juels: JuelEntry[];
  personalHistory: PersonalHistoryEntry[];
  /** PAGE 0 尺寸（SHOW_SIZE — 未测定时 measured=false）。 */
  size: SizePanel;
  /** PAGE 0 素质 6 分类。 */
  talentCategories: TalentCategoryRow[];
  /** PAGE 1 — 调教中（うふふ 会话中查看该角色）？决定 EX 板 vs 宝珠板。 */
  inTraining: boolean;
  /** PAGE 1 絶頂回数板（调教中显示；全零 = null）。 */
  exBoard: ExEntry[] | null;
  /** PAGE 1 妊娠関連（门 = 妊娠素质 or 兒童人数 > 0；未孕 = null）。 */
  pregnancy: PregnancyInfo | null;
  /** PAGE 2 相性表。 */
  compat: CompatRow[];
  /** PAGE 3 礼物历史（收到的礼物，最爱置顶；空 = 没收到过）。 */
  giftHistory: GiftHistoryRow[];
  /** PAGE 4 肉体情報 表/里 双面板。 */
  bodyInfo: BodyInfo | null;
  /** PAGE 5 浮気把握（该角色掌握的 master 肉体关系）。 */
  uwaki: UwakiRow[];
  /** A6 — agent cognitive state snapshot (null when agent disabled or no data). */
  agentSnapshot: AgentInfoSnapshot | null;
}

export interface AgentInfoSnapshot {
  goals: { text: string; status: string }[];
  planSelections: { label: string; windowStart: number; windowEnd: number }[];
  latestDiary: string | null;
  topMemories: { text: string; importance: number }[];
  latestReflection: string | null;
}

export function buildCharaInfoSnapshot(state: GameState, charaNum: number): CharaInfoSnapshot | null {
  const slot = charaNum === 0 ? state.master : state.charas[charaNum];
  if (!slot) return null;
  const st: CharaSlotState = slot.state;
  return {
    charaNum: slot.charaNum,
    callName: slot.callName ?? `角色${slot.charaNum}`,
    location: slot.location,
    homeLocation: slot.homeLocation ?? null,
    header: buildHeaderFor(slot, state),
    personality: buildCharaPersonality(slot, state),
    narrative: evaluateNarrativeParagraphs(slot, state),
    preference: buildCharaPreference(slot, state),
    battleAbilityDisplay: getBattleAbilityDisplay(st),
    abilityGrid: buildAbilityGrid(state, charaNum),
    clothing: describeClothing(slot),
    expHighlights: buildExpHighlights(state, charaNum),
    juels: buildJuelBoard(state, charaNum),
    personalHistory: computePersonalHistory(state, charaNum),
    size: buildSizePanel(slot),
    talentCategories: buildTalentCategories(slot),
    inTraining: charaNum !== 0 && isTrainingTarget(state, charaNum),
    exBoard: buildExBoard(state, charaNum),
    pregnancy: buildPregnancyInfo(state, charaNum),
    compat: buildCompatTable(state, charaNum),
    giftHistory: buildGiftHistory(state, charaNum),
    bodyInfo: buildBodyInfo(state, charaNum),
    uwaki: buildUwakiRows(state, charaNum),
    agentSnapshot: buildAgentInfoSnapshot(state, charaNum),
  };
}

function buildAgentInfoSnapshot(state: GameState, charaNum: number): AgentInfoSnapshot | null {
  const runtime = state.agentRuntime;
  if (!runtime || !runtime.settings.masterEnabled) return null;
  const cog = runtime.cognitions[charaNum];
  if (!cog) return null;

  const goals = cog.goals
    .filter((g) => g.status === "active")
    .slice(0, 4)
    .map((g) => ({ text: g.text, status: g.status }));

  const plan = cog.currentPlan;
  const planSelections = plan
    ? plan.selections.slice(0, 6).map((sel) => ({
        label: sel.candidateId,
        windowStart: sel.windowStart,
        windowEnd: sel.windowEnd,
      }))
    : [];

  const latestDiary = cog.diaries.slice(-1)[0]?.text ?? null;

  const topMemories = [...cog.memories]
    .sort((a, b) => b.importance - a.importance)
    .slice(0, 5)
    .map((m) => ({ text: m.text.slice(0, 120), importance: m.importance }));

  const latestReflection = cog.reflections.slice(-1)[0]?.text.slice(0, 200) ?? null;

  // Return null if everything is empty (no agent data worth showing)
  if (
    goals.length === 0 &&
    planSelections.length === 0 &&
    !latestDiary &&
    topMemories.length === 0 &&
    !latestReflection
  ) {
    return null;
  }

  return { goals, planSelections, latestDiary, topMemories, latestReflection };
}

// ---------------------------------------------------------------------------
// Personal History
// ---------------------------------------------------------------------------

export interface PersonalHistoryEntry {
  category: number;
  label: string;
  dayIndex: number | null; // null = 已发生但 dayIndex 未记录（兼容未来）
}

/**
 * 列出已解锁的 Personal History（按 `lockHolds` + 已记录日期过滤）。
 *  - 仅当 lock validator 当前为真 **AND** `charaInfo[charaNum][cat] > 0`（已记录 dayIndex）才显示。
 *  - 这样保证 `runPersonalHistoryReconciliation` 还没跑过的新角色，history 是空的。
 */
export function computePersonalHistory(state: GameState, charaNum: number): PersonalHistoryEntry[] {
  const slot = charaNum === 0 ? state.master : state.charas[charaNum];
  if (!slot) return [];
  const arr = state.charasInfo?.[charaNum];
  const out: PersonalHistoryEntry[] = [];
  for (let c = 0; c < HISTORY_CATEGORY_COUNT; c++) {
    if (HISTORY_LOCK_NOAUTO[c]) continue;
    if (!lockHolds(slot, c)) continue;
    const dayIndex = arr?.[c];
    if (dayIndex === undefined || dayIndex < 0) continue; // 未记录过 = 未解锁
    out.push({
      category: c,
      label: HISTORY_LABEL[c] ?? `类别${c}`,
      dayIndex,
    });
  }
  return out;
}

/**
 * 写点 — 把某类别在某 dayIndex 首次发生的记录存入 `state.charasInfo`。
 * - 若 `arr[cat] === 0`：写入新值；
 * - 若已 > 0：保留首次值（不覆盖）；
 * - 上游还会写 `Qol_Info_World_Array`（周回数），modern 端先省略。
 */
export function recordPersonalHistory(
  state: GameState,
  charaNum: number,
  category: number,
  dayIndex: number,
): void {
  if (category < 0 || category >= HISTORY_CATEGORY_COUNT) return;
  if (!state.charasInfo) state.charasInfo = {};
  const arr = state.charasInfo[charaNum] ?? emptyHistoryArray();
  if (arr[category] < 0) arr[category] = dayIndex; // -1 哨兵 = 未记录（first-write-wins）
  state.charasInfo[charaNum] = arr;
}

/** morning pipeline 钩子：遍历每角色 + 每类别，按 lockHolds 写当前 dayIndex。 */
export function runPersonalHistoryReconciliation(state: GameState): void {
  const day = state.time.dayIndex;
  for (const slot of Object.values(state.charas)) {
    for (let c = 0; c < HISTORY_CATEGORY_COUNT; c++) {
      if (HISTORY_LOCK_NOAUTO[c]) continue;
      if (!lockHolds(slot, c)) continue;
      recordPersonalHistory(state, slot.charaNum, c, day);
    }
  }
  // Master (charaNum 0) 也跑一遍
  runPersonalHistoryReconciliationFor(state, state.master, day);
}

function runPersonalHistoryReconciliationFor(state: GameState, slot: CharaSlot, day: number): void {
  for (let c = 0; c < HISTORY_CATEGORY_COUNT; c++) {
    if (HISTORY_LOCK_NOAUTO[c]) continue;
    if (!lockHolds(slot, c)) continue;
    recordPersonalHistory(state, slot.charaNum, c, day);
  }
}

// ---------------------------------------------------------------------------
// PAGE 5 — Fall requirements (NPC) + Skill track (MASTER)
// ---------------------------------------------------------------------------

export interface FallRequirement {
  stage: FallStageKey;
  label: string;
  status: "achieved" | "infeasible" | "pending";
  rows: Array<{ key: string; current: number; threshold: number; passed: boolean }>;
}

const FALL_LABELS: Readonly<Record<FallStageKey, string>> = {
  yearning: "思慕",
  love: "恋慕",
  deepLove: "爱恋",
  sexFriend: "炮友",
  lust: "爱欲",
  concubineLove: "侧室（爱恋线）",
  concubineLust: "侧室（爱欲线）",
};

function row(label: string, current: number, threshold: number): { key: string; current: number; threshold: number; passed: boolean } {
  return { key: label, current, threshold, passed: current >= threshold };
}

export function evaluateFallRequirements(state: GameState, charaNum: number): FallRequirement[] {
  const slot = charaNum === 0 ? state.master : state.charas[charaNum];
  if (!slot) return [];
  const st = slot.state;
  const favor = st.CFLAG[CFLAG_ID.好感度] ?? 0;
  const trust = st.CFLAG[CFLAG_ID.信頼度] ?? 0;
  const affection = st.ABL[ABL_ID.親密] ?? 0;
  const desire = st.ABL[ABL_ID.欲望] ?? 0;
  // upstream uses `EXP:絶頂経験 - EXP:無自覚絶頂経験` but 無自覚 is split into C/V/A/B/M
// sub-counters and not yet modeled in modern. Use 絶頂経験 directly as approximation.
const consciousEcstasy = st.EXP[EXP_ID.絶頂経験] ?? 0;
  const dateXp = st.EXP[EXP_ID.約會経験] ?? 0;
  const loveXp = st.EXP[EXP_ID.愛情経験] ?? 0;
  const hasLove = (st.TALENT[TALENT_ID.恋慕] ?? 0) !== 0;
  const hasYearn = (st.TALENT[TALENT_ID.思慕] ?? 0) !== 0;
  const hasLust = (st.TALENT[TALENT_ID.愛欲] ?? 0) !== 0;
  const hasSexFriend = (st.TALENT[TALENT_ID.セフレ] ?? 0) !== 0 || (st.TALENT[TALENT_ID.愛欲] ?? 0) !== 0;
  const flagRoute = (state.flagStore[FLAG_ID.陥落路線変化] ?? 0) !== 0;

  const out: FallRequirement[] = [];

  // 思慕
  {
    const t = FALL_THRESHOLDS.yearning;
    const status: FallRequirement["status"] =
      hasYearn || hasLove || hasLust
        ? "achieved"
        : hasSexFriend && !flagRoute
          ? "infeasible"
          : "pending";
    out.push({
      stage: "yearning",
      label: FALL_LABELS.yearning,
      status,
      rows: [
        row("好感度", favor, t.favor),
        row("信頼度", trust, t.trust),
        row("亲密", affection, t.affection),
      ],
    });
  }

  // 恋慕 — 上游 ADD_CHECK_FALL_STATES 41: 恋慕 infeasible 若 (炮友 && !FLAG:陥落路線変化)
  {
    const t = FALL_THRESHOLDS.love;
    const status: FallRequirement["status"] =
      hasLove
        ? "achieved"
        : (hasLust || (st.TALENT[TALENT_ID.セフレ] ?? 0) > 0) && !flagRoute
          ? "infeasible"
          : "pending";
    out.push({
      stage: "love",
      label: FALL_LABELS.love,
      status,
      rows: [
        row("好感度", favor, t.favor),
        row("信頼度", trust, t.trust),
        row("亲密", affection, t.affection),
      ],
    });
  }

  // 爱恋
  {
    const t = FALL_THRESHOLDS.deepLove;
    if (hasLove) {
      out.push({
        stage: "deepLove",
        label: FALL_LABELS.deepLove,
        status: (st.TALENT[TALENT_ID.恋慕] ?? 0) > 1 ? "achieved" : "pending",
        rows: [
          row("好感度", favor, t.favor),
          row("信頼度", trust, t.trust),
          row("亲密", affection, t.affection),
          row("约会经验", dateXp, t.dateXp),
          row("爱情经验", loveXp, t.loveXp),
          row("约会+爱情经验", dateXp + loveXp, t.dateAndLoveXp),
        ],
      });
    }
  }

  // 炮友 — 上游用 <= not < (EVENTTURNEND.ERB:411)
  {
    const t = FALL_THRESHOLDS.sexFriend;
    const status: FallRequirement["status"] =
      (st.TALENT[TALENT_ID.セフレ] ?? 0) > 0 || hasLust
        ? "achieved"
        : hasLove
          ? "infeasible"
          : "pending";
    out.push({
      stage: "sexFriend",
      label: FALL_LABELS.sexFriend,
      status,
      rows: [
        row("好感度 ≤", favor, t.favor),
        row("欲望", desire, t.desire),
        row("有意识绝顶", consciousEcstasy, t.consciousEcstasy),
      ],
    });
  }

  // 爱欲
  {
    const t = FALL_THRESHOLDS.lust;
    const status: FallRequirement["status"] =
      hasLust
        ? "achieved"
        : !hasSexFriend
          ? "infeasible"
          : "pending";
    out.push({
      stage: "lust",
      label: FALL_LABELS.lust,
      status,
      rows: [
        row("好感度", favor, t.favor),
        row("欲望", desire, t.desire),
        row("有意识绝顶", consciousEcstasy, t.consciousEcstasy),
      ],
    });
  }

  // 侧室 — 只对有 恋慕 / 愛欲 + 已达一定好感的人显示
  if (hasLove && favor >= FALL_THRESHOLDS.concubineLove.favor) {
    const t = FALL_THRESHOLDS.concubineLove;
    out.push({
      stage: "concubineLove",
      label: FALL_LABELS.concubineLove,
      status: "pending",
      rows: [
        row("好感度", favor, t.favor),
        row("信頼度", trust, t.trust),
        row("亲密", affection, t.affection),
      ],
    });
  }
  if (hasLust && favor >= FALL_THRESHOLDS.concubineLust.favor) {
    const t = FALL_THRESHOLDS.concubineLust;
    out.push({
      stage: "concubineLust",
      label: FALL_LABELS.concubineLust,
      status: "pending",
      rows: [
        row("好感度", favor, t.favor),
        row("信頼度", trust, t.trust),
      ],
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// PAGE 5 MASTER — 技能习得轨迹
// ---------------------------------------------------------------------------

export interface SkillCondition {
  label: string;
  current: number;
  threshold: number;
  passed: boolean;
}

export interface SkillTrackEntry {
  talentId: number;
  name: string;
  achieved: boolean;
  conditions: SkillCondition[];
}

export function evaluateSkillTrack(state: GameState, charaNum: number): SkillTrackEntry[] {
  const slot = charaNum === 0 ? state.master : state.charas[charaNum];
  if (!slot) return [];
  const st = slot.state;
  const isFemale = (st.TALENT[TALENT_ID.性別] ?? 0) === 0;
  const hasVagina = isFemale; // modern 简化：女性=女、扶她也走女线

  const c = (id: number) => st.ABL[id] ?? 0;
  const t = (id: number) => st.TALENT[id] ?? 0;
  const e = (id: number) => st.EXP[id] ?? 0;

  const out: SkillTrackEntry[] = [];

  // 接吻魔
  out.push({
    talentId: 77,
    name: "接吻魔",
    achieved: t(77) !== 0,
    conditions: [
      { label: "接吻经验 > 300", current: e(27), threshold: 300, passed: e(27) > 300 },
      { label: "Ｍ感觉 > 5", current: c(4), threshold: 5, passed: c(4) > 5 },
    ],
  });

  // 自慰狂
  out.push({
    talentId: 73,
    name: "自慰狂",
    achieved: t(73) !== 0,
    conditions: [
      { label: "诶嘿嘿自慰经验 > 200", current: e(23), threshold: 200, passed: e(23) > 200 },
      { label: "自慰经验 > 500", current: e(22), threshold: 500, passed: e(22) > 500 },
    ],
  });

  // 子宫口性感
  if (hasVagina) {
    out.push({
      talentId: 78,
      name: "子宫口性感",
      achieved: t(78) !== 0,
      conditions: [{ label: "子宫口开发经验 > 50", current: e(57), threshold: 50, passed: e(57) > 50 }],
    });
  }

  // 音乐知识
  out.push({
    talentId: 161,
    name: "音乐知识",
    achieved: t(161) !== 0,
    conditions: [
      { label: "演奏经验 ≥ 1000", current: e(79), threshold: 1000, passed: e(79) >= 1000 },
      { label: "技巧 ≥ 3", current: c(12), threshold: 3, passed: c(12) >= 3 },
    ],
  });

  // 音感
  out.push({
    talentId: 162,
    name: "绝对音感",
    achieved: t(162) !== 0,
    conditions: [{ label: "演奏经验 ≥ 5000", current: e(79), threshold: 5000, passed: e(79) >= 5000 }],
  });

  // 器用な指
  out.push({
    talentId: 51,
    name: "器用な指",
    achieved: t(51) !== 0,
    conditions: [{ label: "指技 ≥ 5", current: c(50), threshold: 5, passed: c(50) >= 5 }],
  });

  // 舌使い
  out.push({
    talentId: 52,
    name: "舌使い",
    achieved: t(52) !== 0,
    conditions: [{ label: "舌技 ≥ 5", current: c(51), threshold: 5, passed: c(51) >= 5 }],
  });

  // 淫乳
  if (isFemale) {
    out.push({
      talentId: 0, // 现代无 淫乳 TALENT id 占位
      name: "淫乳",
      achieved: false,
      conditions: [{ label: "胸技 ≥ 5", current: c(52), threshold: 5, passed: c(52) >= 5 }],
    });
  }

  // 淫壶
  if (hasVagina) {
    out.push({
      talentId: 0,
      name: "淫壶",
      achieved: false,
      conditions: [{ label: "膣技 ≥ 5", current: c(54), threshold: 5, passed: c(54) >= 5 }],
    });
  }

  // 尻穴狂
  out.push({
    talentId: 0,
    name: "尻穴狂",
    achieved: false,
    conditions: [{ label: "尻技 ≥ 5", current: c(55), threshold: 5, passed: c(55) >= 5 }],
  });

  // 调合知识
  out.push({
    talentId: 55,
    name: "调合知识",
    achieved: t(55) !== 0,
    conditions: [
      { label: "调合 ≥ 3", current: st.TALENT[48] ?? 0, threshold: 3, passed: (st.TALENT[48] ?? 0) >= 3 },
      { label: "教养 ≥ 3", current: c(43), threshold: 3, passed: c(43) >= 3 },
    ],
  });

  return out;
}

// ---------------------------------------------------------------------------
// PAGE 6 剧本设置 — 探针（运行时检查）
// ---------------------------------------------------------------------------

export interface KojoOptionProbe {
  hasOptionPage: boolean;
  /** 实际 kojo 文件中声明过 `_OPTION_K{N}` 的变体名（用于诊断）。 */
  declaredVariants: string[];
}

export function probeKojoOption(state: GameState, charaNum: number): KojoOptionProbe {
  const map = state.readOnlyMetadata.kojoMap.find((k) => k.charaNum === charaNum);
  if (!map) return { hasOptionPage: false, declaredVariants: [] };
  const variants: string[] = [];
  let found = false;
  for (const v of map.variants) {
    const opt = v.files.some((f) => /OPTION/.test(f.topic));
    if (opt) {
      found = true;
      variants.push(v.variantCode ?? "default");
    }
  }
  return { hasOptionPage: found, declaredVariants: variants };
}

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export { FALL_THRESHOLDS, FALL_STAGES };
export { HISTORY_CATEGORY_COUNT, HISTORY_LABEL, Qol_Dates, emptyHistoryArray };
export { ABILITY_GRID_ROWS, ABILITY_GRID_COLUMNS, genderHideAbility } from "./ability-grid.js";

void emptyCharaSlotState; // re-exported for downstream
