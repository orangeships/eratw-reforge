/**
 * PAGE 0 「服装&能力」ABL 7×7 网格 — 直抄上游 `能力表示.ERB:1619-1689`。
 *
 * `DISP_NAME` 与 `DISP_ID` 双表平行：
 *   - row 0..1 左 6 格 = MARK id（苦痛/快乐/屈服/反感/履历/时奸），
 *   - row 0..6 中 4 列 + 右 1 列 = ABL id；
 *   - 百合属性/百合中毒 + 断袖属性/断袖中毒 走性别门控；
 *   - MASTER 抹除 row 0..1 的 6 个 MARK（强制空白）。
 *
 * 空格（DISP_ID === 0）渲染时显示为占位符 `────────`。
 * 性别门控：`(TALENT[性別] & 1) === 0` → 百合（女）才显示；
 *            `(TALENT[性別] & 1) === 1` → 断袖（男/扶她）才显示。
 *
 * `Why:` 让 `CharaInfoPage0` 直接拿 `ABILITY_GRID.flat()` 输出，不重复上游字符串。
 */

import { ABL_ID, MARK_ID, TALENT_ID } from "./settlement.js";

export interface AbilityCell {
  /** 中文标签。空字符串 = 占位格。 */
  name: string;
  /**
   * 取值来源：
   *   - 大于 1000 = MARK id（MARK_OFFSET）；
   *   - 0..99     = ABL id；
   *   - 0         = 占位格；
   *   - -1        = 性别门控隐藏（实际不出现，由 `genderGateHide` 字段判断）。
   */
  source: "mark" | "abl" | "placeholder" | "gender-hidden";
  ablOrMarkId: number;
  /** 渲染时排序上限（上游 PRINT_RANK MAX_6 / MAX_99）。 */
  maxRank: 6 | 99;
  /** 上游特别说明：六技术行的 ABL 用 MAX_6，其它 ABL 用 MAX_99。 */
}

export const ABILITY_GRID_ROWS: readonly (readonly AbilityCell[])[] = [
  // 上游 `DISP_NAME` 行 0: 苦痛 / 亲密 / 教养 / Ｃ感觉 / 指技术 / 受虐属性 / 自慰中毒
  [
    { name: "苦痛", source: "mark", ablOrMarkId: MARK_ID.苦痛, maxRank: 99 },
    { name: "亲密", source: "abl", ablOrMarkId: ABL_ID.親密, maxRank: 99 },
    { name: "教养", source: "abl", ablOrMarkId: ABL_ID.教養, maxRank: 99 },
    { name: "Ｃ感觉", source: "abl", ablOrMarkId: ABL_ID.Ｃ感覚, maxRank: 99 },
    { name: "指技术", source: "abl", ablOrMarkId: ABL_ID.指, maxRank: 6 },
    { name: "受虐属性", source: "abl", ablOrMarkId: ABL_ID.受虐属性, maxRank: 99 },
    { name: "自慰中毒", source: "abl", ablOrMarkId: ABL_ID.自慰中毒, maxRank: 99 },
  ],
  // 行 1: 快乐 / 顺从 / 话术技能 / Ｖ感觉 / 膣技术 / 施虐属性 / 精液中毒
  [
    { name: "快乐", source: "mark", ablOrMarkId: MARK_ID.快乐, maxRank: 99 },
    { name: "顺从", source: "abl", ablOrMarkId: ABL_ID.従順, maxRank: 99 },
    { name: "话术技能", source: "abl", ablOrMarkId: ABL_ID.話術技能, maxRank: 99 },
    { name: "Ｖ感觉", source: "abl", ablOrMarkId: ABL_ID.Ｖ感覚, maxRank: 99 },
    { name: "膣技术", source: "abl", ablOrMarkId: ABL_ID.膣, maxRank: 6 },
    { name: "施虐属性", source: "abl", ablOrMarkId: ABL_ID.施虐属性, maxRank: 99 },
    { name: "精液中毒", source: "abl", ablOrMarkId: ABL_ID.精液中毒, maxRank: 99 },
  ],
  // 行 2: 屈服 / 欲望 / 战斗能力 / Ａ感觉 / Ａ技术 / 百合属性 / 百合中毒
  [
    { name: "不埒", source: "mark", ablOrMarkId: MARK_ID.不埒, maxRank: 99 },
    { name: "欲望", source: "abl", ablOrMarkId: ABL_ID.欲望, maxRank: 99 },
    { name: "战斗能力", source: "abl", ablOrMarkId: ABL_ID.战斗能力, maxRank: 99 },
    { name: "Ａ感觉", source: "abl", ablOrMarkId: ABL_ID.Ａ感覚, maxRank: 99 },
    { name: "Ａ技术", source: "abl", ablOrMarkId: ABL_ID.肛門, maxRank: 6 },
    { name: "百合属性", source: "abl", ablOrMarkId: ABL_ID.百合属性, maxRank: 99 },
    { name: "百合中毒", source: "abl", ablOrMarkId: ABL_ID.百合中毒, maxRank: 99 },
  ],
  // 行 3: 反感 / 技巧 / 清扫技能 / Ｂ感觉 / 胸技术 / 断袖属性 / 断袖中毒
  [
    { name: "反感", source: "mark", ablOrMarkId: MARK_ID.反感, maxRank: 99 },
    { name: "技巧", source: "abl", ablOrMarkId: ABL_ID.技巧, maxRank: 99 },
    { name: "清扫技能", source: "abl", ablOrMarkId: ABL_ID.清扫技能, maxRank: 99 },
    { name: "Ｂ感觉", source: "abl", ablOrMarkId: ABL_ID.Ｂ感覚, maxRank: 99 },
    { name: "胸技术", source: "abl", ablOrMarkId: ABL_ID.胸, maxRank: 6 },
    { name: "断袖属性", source: "abl", ablOrMarkId: ABL_ID.断袖属性, maxRank: 99 },
    { name: "断袖中毒", source: "abl", ablOrMarkId: ABL_ID.断袖中毒, maxRank: 99 },
  ],
  // 行 4: 履历 / 侍奉精神 / 料理技能 / Ｍ感觉 / 舌技术 / "" / 膣射中毒
  [
    { name: "履历", source: "mark", ablOrMarkId: MARK_ID.履历, maxRank: 99 },
    { name: "侍奉精神", source: "abl", ablOrMarkId: ABL_ID.奉仕精神, maxRank: 99 },
    { name: "料理技能", source: "abl", ablOrMarkId: ABL_ID.料理技能, maxRank: 99 },
    { name: "Ｍ感觉", source: "abl", ablOrMarkId: ABL_ID.Ｍ感覚, maxRank: 99 },
    { name: "舌技术", source: "abl", ablOrMarkId: ABL_ID.舌, maxRank: 6 },
    { name: "", source: "placeholder", ablOrMarkId: 0, maxRank: 99 },
    { name: "膣射中毒", source: "abl", ablOrMarkId: ABL_ID.膣射中毒, maxRank: 99 },
  ],
  // 行 5: 时奸 / 露出癖 / 音乐技能 / "" / 腰技术 / "" / 肛射中毒
  [
    { name: "时奸", source: "mark", ablOrMarkId: MARK_ID.时奸, maxRank: 99 },
    { name: "露出癖", source: "abl", ablOrMarkId: ABL_ID.露出癖, maxRank: 99 },
    { name: "音乐技能", source: "abl", ablOrMarkId: ABL_ID.音楽技能, maxRank: 99 },
    { name: "", source: "placeholder", ablOrMarkId: 0, maxRank: 99 },
    { name: "腰技术", source: "abl", ablOrMarkId: ABL_ID.腰, maxRank: 6 },
    { name: "", source: "placeholder", ablOrMarkId: 0, maxRank: 99 },
    { name: "肛射中毒", source: "abl", ablOrMarkId: ABL_ID.肛射中毒, maxRank: 99 },
  ],
  // 行 6: "" / "" / "" / "" / 足技术 / "" / ""
  [
    { name: "", source: "placeholder", ablOrMarkId: 0, maxRank: 99 },
    { name: "", source: "placeholder", ablOrMarkId: 0, maxRank: 99 },
    { name: "", source: "placeholder", ablOrMarkId: 0, maxRank: 99 },
    { name: "", source: "placeholder", ablOrMarkId: 0, maxRank: 99 },
    { name: "足技术", source: "abl", ablOrMarkId: ABL_ID.足, maxRank: 6 },
    { name: "", source: "placeholder", ablOrMarkId: 0, maxRank: 99 },
    { name: "", source: "placeholder", ablOrMarkId: 0, maxRank: 99 },
  ],
];

export const ABILITY_GRID_COLUMNS = 7;

/**
 * 上游 `PRINT_ABILITY` 性别门控（`能力表示.ERB:1682-1685`）：
 *   - 百合属性/百合中毒：仅女性（bit 0 = 0）显示；
 *   - 断袖属性/断袖中毒：仅非女性显示。
 *  `TALENT:性別` 用 `bit 0` 区分：bit=0 女、bit=1 男/扶她。
 */
export function genderHideAbility(name: string, genderTalent: number): boolean {
  if (name === "百合属性" || name === "百合中毒") {
    return (genderTalent & 1) !== 0; // 非女性隐藏
  }
  if (name === "断袖属性" || name === "断袖中毒") {
    return (genderTalent & 1) === 0; // 女性隐藏
  }
  return false;
}

/** MASTER 抹除 row 0..1 的 6 个 MARK（`能力表示.ERB:1664-1665`）。 */
export function masterBlankMarkRows(): readonly AbilityCell[] {
  return ABILITY_GRID_ROWS.flat().filter(
    (cell) => !(cell.source === "mark"),
  );
}

void TALENT_ID; // re-exported for downstream consumers
