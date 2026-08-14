/**
 * 陷落 5 阶段达成阈值 — 直抄上游 `ERB/DIM.ERH:10-24` + `Add_Marriage.ERH:69-83`。
 *
 * 现代端 PAGE 5 「陷落状态」页面的阈值表 + 等级字符串优先级链。
 * 字段值与上游完全一致；以下两处上游真实存在的"小坑"被保留（不修）：
 *   - `REQUIRED_FAVOR_炮友` 在上游 `EVENTTURNEND.ERB:411` 用的是 `<=` 而非 `<`（其它 4 阶段用 `<`）。
 *   - 旧补丁（`Omogatari.ERH:437-448`）曾用 20000/10000；当前活跃值是下方这些。
 *
 * `Why:` 现代 `buildCharaInfoSnapshot`/`evaluateFallRequirements` 用这些常量来给玩家
 * 显示"还差多少 → 达成阶段"，与上游 `@陥落条件表示` 完全等价。
 */

export const FALL_THRESHOLDS = {
  // 思慕 — `DIM.ERH:14-16`
  yearning: {
    favor: 1500,
    trust: 250,
    affection: 5,
  },
  // 恋慕 — `DIM.ERH:10-12`
  love: {
    favor: 3000,
    trust: 700,
    affection: 10,
  },
  // 爱恋（TRUE_LOVE/深恋） — `Add_Marriage.ERH:69-74`
  deepLove: {
    favor: 40000,
    trust: 5000,
    affection: 20,
    dateXp: 500,
    loveXp: 150,
    dateAndLoveXp: 1000,
  },
  // 炮友 — `DIM.ERH:18-20`
  sexFriend: {
    // 注：上游比较符是 `<=`（见 EVENTTURNEND.ERB:411）。其它 4 阶段用 `<`。
    favor: 1500,
    desire: 5,
    consciousEcstasy: 100,
  },
  // 爱欲 — `DIM.ERH:22-24`
  lust: {
    favor: 3000,
    desire: 10,
    consciousEcstasy: 500,
  },
  // 侧室（CONCUBINE） — `Add_Marriage.ERH:76-79`（爱恋侧）
  concubineLove: {
    favor: 40000,
    trust: 5000,
    affection: 25,
    affinity: 200,
  },
  // 侧室（CONCUBINE） — `Add_Marriage.ERH:81-83`（爱欲侧）
  concubineLust: {
    favor: 30000,
    trust: 1500,
    lust: 30,
  },
} as const;

/** 5 阶段 + 侧室的顺序枚举 — 给 `evaluateFallRequirements` 输出固定顺序。 */
export type FallStageKey =
  | "yearning"
  | "love"
  | "deepLove"
  | "sexFriend"
  | "lust"
  | "concubineLove"
  | "concubineLust";

export const FALL_STAGES: readonly FallStageKey[] = [
  "yearning",
  "love",
  "deepLove",
  "sexFriend",
  "lust",
  "concubineLove",
  "concubineLust",
] as const;

/** `GET_FALLEN_STR` 优先级链（`QOL_能力表示.ERB:189-213`）— 中文标签。 */
export const FALLEN_LABEL_PRIORITY: ReadonlyArray<{
  talentId: number;
  label: string;
  color: string;
}> = [
  // 注：妻/妾 在 modern 端还没有对应 CFLAG/TALENT id 留空，跳过。
  // 上游顺序是 妻 → 妾 → 恋人 → 恋慕>1 → 恋慕==1 → 愛欲==1 → セフレ==1 → セフレ==2 → 思慕==1
  // 复刻时只输出 modern 已建模的部分。
] as const;