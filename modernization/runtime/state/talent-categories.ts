/**
 * 素质6分类 (PAGE 0 PRINT_STATE_TALENT) — category membership + the
 * GET_TALENTNAME value→name table.
 *
 * Faithfulness anchors:
 *  - `@QOL_PRINT_STATE_TALENT` (HTML_TALENTS.ERB:81): iterate the 5 named
 *    category lists (TALENT_MAP.ERH ordered arrays) then OTHER = every other
 *    named talent the chara holds (`@MAKE_TALENT_MAP` PRINT_STATE.ERB:401).
 *  - Per-id filters (HTML_TALENTS.ERB:125-141): 処女 needs 性別 bit0;
 *    非童貞 needs 性別 bit1; 胸围 hidden for 男性 with 絶壁(-2); 掃除係 only
 *    while 神社在住; 昨日重现 is MAGIC_DLC (modern: always hidden).
 *  - `@GET_TALENTNAME` (PRINT_TALENTNAME.ERB:18): multi-valued talents map
 *    value→name via the transcribed table below; every other talent shows its
 *    Talent.csv name when value ≠ 0 (CASEELSE arm). Value slots mapping to ""
 *    (e.g. 態度 0) produce NO tag — faithful.
 *  - Highlight tint (HTML_TALENTS.ERB:152-158): 処女/性別/自慰狂/淫壺/
 *    尻穴狂/淫乳/接吻魔/子宮口性感/精愛味覚/風騷/恋慕/キス未経験/淫乱/恋人
 *    (+ female 風俗嬢) render hot-pink bold; 思慕/風俗嬢 pale pink.
 *
 * Data: `talent-catalog.bundle.json` (build-talent-catalog.ts) injected via
 * `setTalentCatalog` — names translated through tw_csv_chs.xml, categories
 * resolved to ids at build time.
 */

import type { CharaSlot } from "./game-state.js";
import { CFLAG_ID, TALENT_ID } from "./settlement.js";

export interface TalentCatalog {
  names: Record<string, string>;
  categories: Record<string, number[]>;
}

let catalog: TalentCatalog = { names: {}, categories: {} };

/** Inject the built talent catalog (from `talent-catalog.bundle.json`). */
export function setTalentCatalog(c: TalentCatalog | null | undefined): void {
  catalog = c ?? { names: {}, categories: {} };
}

export function talentCatalogLoaded(): boolean {
  return Object.keys(catalog.names).length > 0;
}

/**
 * GET_TALENTNAME value→name table (PRINT_TALENTNAME.ERB:43-341). Key = talent
 * id; value = map of talent VALUE → display name ("" = no tag for that value).
 * Talents not listed fall to the CASEELSE arm (nonzero ⇒ csv name).
 */
const VALUE_NAMES: Readonly<Record<number, Readonly<Record<number, string>>>> = {
  0: { [-1]: "无自觉非处女", 1: "处女", 2: "再生处女" },
  1: { 0: "童贞" }, // 非童貞: 0 = 童贞; nonzero = no tag from this arm
  2: { 0: "※性别不存在※", 1: "女性", 2: "男性", 3: "扶她" },
  3: { 1: "恋慕", 2: "爱恋" },
  6: { [-1]: "无接吻经验？", 1: "无接吻经验" },
  10: { [-1]: "胆怯", 1: "坚强" },
  11: { [-1]: "坦率", 1: "叛逆" },
  12: { [-1]: "老实", 1: "傲慢" },
  13: { [-1]: "自尊心低", 1: "自尊心高" },
  15: { [-1]: "心情不快", 1: "心情愉快" },
  16: { [-1]: "丑陋", 1: "俊美" },
  17: { [-1]: "儿童", 1: "中年", 2: "老人" },
  23: { [-1]: "保守的", 1: "好奇心" },
  24: { [-1]: "阴郁", 1: "开朗" },
  30: { [-1]: "不在乎贞操", 1: "贞操重视" },
  31: { [-1]: "圧抑", 1: "解放" },
  33: { [-1]: "不知羞耻", 1: "害羞" },
  40: { [-1]: "不怕痛", 1: "怕痛" },
  41: { [-1]: "不易湿", 1: "容易湿" },
  50: { [-1]: "学习慢", 1: "学习快" },
  61: { [-2]: "洁癖症", [-1]: "污臭敏感", 1: "污臭钝感", 2: "污臭无视" },
  70: { [-1]: "否定快感", 1: "接受快感" },
  81: { [-1]: "两面通吃", 1: "讨厌男人", 2: "讨厌女人", 3: "不信任人类" },
  100: { [-5]: "小人", [-2]: "幼儿体型", [-1]: "矮小体型", 0: "普通体型", 1: "高大", 2: "巨躯", 5: "巨人" },
  101: { [-1]: "Ｃ钝感", 1: "Ｃ敏感" },
  102: { [-1]: "Ｖ钝感", 1: "Ｖ敏感" },
  103: { [-1]: "Ａ钝感", 1: "Ａ敏感" },
  104: { [-1]: "Ｂ钝感", 1: "Ｂ敏感" },
  105: { [-2]: "绝壁", [-1]: "贫乳", 0: "纤乳", 1: "巨乳", 2: "爆乳" },
  106: { [-1]: "Ｍ钝感", 1: "Ｍ敏感", 2: "Ｍ超敏感" },
  108: { [-2]: "幼臀", [-1]: "小臀", 0: "纤臀", 1: "翘臀", 2: "丰臀" },
  121: { [-2]: "不会喝酒", [-1]: "不擅喝酒", 1: "擅于喝酒", 2: "酒豪", 3: "海量" },
  130: { [-1]: "恢复慢", 1: "恢复快" },
  143: { 1: "兽耳", 2: "兔耳", 3: "犬耳", 4: "猫耳" },
  149: { 1: "可以哺乳", 2: "泌乳体质" },
  161: { 1: "乐器知识", 2: "歌唱知识", 3: "舞蹈知识" },
  162: { [-1]: "音痴", 1: "音感", 2: "绝对音感" },
  164: { 1: "冰精", 2: "雪女" },
  185: { 1: "炮友", 2: "情人" },
  190: { 1: "人类", 2: "仙人", 3: "天人", 4: "月人", 5: "外界人" },
  191: {
    1: "妖怪", 2: "鬼", 3: "吸血鬼", 4: "河童", 5: "天狗", 6: "妖兽",
    7: "妖鸟", 8: "妖虫", 9: "恶魔", 10: "小人", 11: "座敷童子", 12: "山童",
  },
  192: { 1: "妖精" },
  193: { 1: "神灵", 2: "死神", 3: "阎魔", 4: "道祖神", 5: "古神人", 6: "天使" },
  194: { 1: "幽灵", 2: "骚灵", 3: "亡灵", 4: "恶灵" },
  195: { 1: "付丧神" },
  196: { 1: "人偶", 2: "机械", 3: "魔像", 4: "埴轮", 5: "僵尸", 99: "人偶少女" },
  197: { 1: "巫女", 2: "魔法使", 3: "女仆", 4: "蓬莱人" },
  198: { 1: "人妻", 2: "未亡人" },
  199: { 1: "风俗娘", 2: "娼妇", 3: "熟悉的风俗娘", 4: "熟悉的娼妇" },
  200: { 1: "魔界人" },
  221: { 1: "未婚妻", 2: "妻子" }, // 上游还按 MASTER 性别切换 未婚夫/丈夫 — modern master 固定男性
  222: { 1: "侧室" },
  225: { 1: "酿酒师", 2: "杜氏" },
  250: { 1: "小鸡鸡", 2: "短鸡鸡", 4: "萤光屌", 5: "疣凸屌", 6: "巨屌", 10: "驴屌" },
  274: { 1: "叠石外行", 2: "叠石新手", 3: "叠石精英", 4: "叠石老手", 5: "叠石大师", 6: "叠石王者" },
  278: { [-2]: "朽愚", [-1]: "愚笨", 1: "聪慧", 2: "灵性" },
  285: { 6: "圣者", 7: "天使", 8: "天使之王", 9: "真神", 10: "旧日" },
};

/** 伐採46/釣り47/採集48/調合49: name = `<csv名>Lv{N}` (C_ABILITY_MAX=6 non-DLC). */
const LEVEL_TALENTS = new Set([46, 47, 48, 49]);

/** `@GET_TALENTNAME(id, value)` — display name for a talent value ("" = none). */
export function talentDisplayName(id: number, value: number): string {
  if (LEVEL_TALENTS.has(id)) {
    // Ladder names include Lv0 (`伐採Lv0`) — the upstream dense TALENT array
    // means every chara always shows the four Lv rows, 0 included.
    const base = catalog.names[String(id)] ?? `素质${id}`;
    return `${base}${value}`;
  }
  const table = VALUE_NAMES[id];
  if (table) return table[value] ?? "";
  if (value === 0) return "";
  return catalog.names[String(id)] ?? "";
}

export const CATEGORY_LABELS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "RACE", label: "种族" },
  { key: "SEXUAL", label: "性的特征" },
  { key: "PHYSICAL", label: "身体的特征" },
  { key: "MENTAL", label: "精神的特征" },
  { key: "PRACTICAL", label: "技术的特征" },
  { key: "OTHER", label: "其他" },
];

export interface TalentTag {
  id: number;
  name: string;
  /** 0 = normal, 1 = pale pink (思慕/風俗嬢), 2 = hot pink bold. */
  highlight: 0 | 1 | 2;
}

export interface TalentCategoryRow {
  key: string;
  label: string;
  tags: TalentTag[];
}

/** Hot-pink-bold ids (HTML_TALENTS.ERB:152-155). */
const HOT_IDS = new Set<number>([
  0, 2, 73, 74, 75, 76, 77, 78, 122, TALENT_ID.風騷, TALENT_ID.恋慕,
  TALENT_ID.キス未経験, 4 /* 淫乱 */, TALENT_ID.恋人,
]);

function isFemale(slot: CharaSlot): boolean {
  return ((slot.state.TALENT[TALENT_ID.性別] ?? 0) & 1) !== 0;
}

/**
 * Build the 6-category talent rows for a chara. Rows with no tags are
 * dropped (upstream prints the header regardless, but empty categories add
 * pure noise in the modern layout — header-only rows carry no information).
 */
export function buildTalentCategories(slot: CharaSlot): TalentCategoryRow[] {
  const st = slot.state;
  const claimed = new Set<number>();
  const rows: TalentCategoryRow[] = [];

  const tagFor = (id: number): TalentTag | null => {
    const value = st.TALENT[id] ?? 0;
    const name = talentDisplayName(id, value);
    if (!name) return null;
    // Per-id filters (HTML_TALENTS.ERB:125-141)
    if (id === 0 && !(((st.TALENT[TALENT_ID.性別] ?? 0) & 1))) return null; // 処女 needs bit0
    if (id === 1 && !(((st.TALENT[TALENT_ID.性別] ?? 0) & 2))) return null; // 非童貞 arm needs bit1
    if (id === 105 && (st.TALENT[TALENT_ID.性別] ?? 0) === 2 && value === -2) return null; // 男絶壁
    if (id === TALENT_ID.掃除係 && !(st.CFLAG[CFLAG_ID.神社在住] ?? 0)) return null;
    if (id === 280) return null; // 昨日重现 — MAGIC_DLC only
    const highlight: 0 | 1 | 2 =
      HOT_IDS.has(id) || (id === 199 && isFemale(slot))
        ? 2
        : id === TALENT_ID.思慕 || id === 199
          ? 1
          : 0;
    return { id, name, highlight };
  };

  for (const { key, label } of CATEGORY_LABELS) {
    if (key === "OTHER") continue;
    const ids = catalog.categories[key] ?? [];
    const tags: TalentTag[] = [];
    for (const id of ids) {
      claimed.add(id);
      // (Lv talents 46-49 always yield a tag, 0 included — dense upstream.)
      const tag = tagFor(id);
      if (tag) tags.push(tag);
    }
    if (tags.length > 0) rows.push({ key, label, tags });
  }

  // OTHER — every named talent the chara holds that no category claimed.
  const otherTags: TalentTag[] = [];
  const heldIds = Object.keys(st.TALENT)
    .map(Number)
    .sort((a, b) => a - b);
  for (const id of heldIds) {
    if (claimed.has(id)) continue;
    if (!(catalog.names[String(id)] || VALUE_NAMES[id])) continue;
    if (id === 300) continue; // 路人 (汎用角色) — upstream never displays it
    const tag = tagFor(id);
    if (tag) otherTags.push(tag);
  }
  if (otherTags.length > 0) rows.push({ key: "OTHER", label: "其他", tags: otherTags });

  return rows;
}
