/**
 * Personal History 38 类元数据 — 直抄上游 `QoL_DetailedInfo.ERH:11-48`
 * + `Qol_Info_Reset_Category` lock validators（`QoL_DetailedInfo.ERB:621-650`）。
 *
 * 现代端在 `charaInfo[N]` 上挂长度为 `HISTORY_CATEGORIES.length` 的 `number[]` 数组，
 * `category => dayIndex` 语义（-1 = 未触发，>=0 = 第 (dayIndex+1) 天首次触发）。
 * **注意 dayIndex 是 0-based**，day 0 是合法的记录值，所以"未记录"哨兵用 -1 而非 0
 * （否则第一天的记录会与"空"混淆，被反复覆盖 / 永不显示）。
 *
 * `lockHolds(state, charaNum, category)` 是单个类别的 "lock validator" — 跟上游
 * `Qol_Info_Reset_Category(CHARA, CATEGORY, VALID_CONDITION)` 里第三参数完全等价。
 *
 * `Why:` 让 `computePersonalHistory` 跟 `runPersonalHistoryReconciliation`（在 morning
 * pipeline 中调）都用同一份事实来源，避免现代端零散拼凑。
 */

import type { CharaSlot } from "./game-state.js";
import { CFLAG_ID, EXP_ID, TALENT_ID } from "./settlement.js";

export const HISTORY_CATEGORY_COUNT = 34; // 上游 `Qol_Info_Dates_Size` (L7)

export const Qol_Dates = {
  Meet: 0,
  Yearn: 1,
  Love: 2,
  GF: 3,
  SFriend: 4,
  Lust: 5,
  Orgasm: 6,
  Ejac: 7,
  Semen: 8,
  Creampie: 9,
  ACreampie: 10,
  Bj: 11,
  Lactation: 12,
  DeflowerOrgasm: 13,
  LewdLips: 14,
  Masturb: 15,
  LewdCervix: 16,
  Musicality: 17,
  Sound: 18,
  Mixing: 19,
  Finger: 20,
  Tongue: 21,
  LewdChest: 22,
  LewdVagina: 23,
  LewdAnus: 24,
  Quad: 25,
  Quint: 26,
  FirstPeriod: 27,
  LoveSemen: 28,
  SexKnow: 29,
  Mirada: 30,
  DeepLove: 31,
  Engagement: 32,
  Marriage: 33,
  Concubine: 34, // 上游注释说 size=34，实际 0..33，所以 34 实际是 out-of-range — 但若上游用到也保留。
} as const;

export type QolDatesKey = keyof typeof Qol_Dates;
export type QolDatesId = (typeof Qol_Dates)[QolDatesKey];

/** 中文 label — 短句。给玩家在 BASIC_STATE 头部下方显示"何时第一..."。 */
export const HISTORY_LABEL: Readonly<Record<number, string>> = {
  [Qol_Dates.Meet]: "初次见面",
  [Qol_Dates.Yearn]: "初次思慕",
  [Qol_Dates.Love]: "初次恋慕",
  [Qol_Dates.GF]: "初次成为恋人",
  [Qol_Dates.SFriend]: "初次成为炮友",
  [Qol_Dates.Lust]: "初次成为爱欲对象",
  [Qol_Dates.Orgasm]: "初次被让绝顶",
  [Qol_Dates.Ejac]: "初次射精",
  [Qol_Dates.Semen]: "初次品尝精液",
  [Qol_Dates.Creampie]: "初次中出",
  [Qol_Dates.ACreampie]: "初次肛门中出",
  [Qol_Dates.Bj]: "初次口交",
  [Qol_Dates.Lactation]: "初次喷乳",
  [Qol_Dates.DeflowerOrgasm]: "初次破处即绝顶",
  [Qol_Dates.LewdLips]: "开始渴望亲吻",
  [Qol_Dates.Masturb]: "成为自慰狂",
  [Qol_Dates.LewdCervix]: "子宫口变性感",
  [Qol_Dates.Musicality]: "习得音乐知识",
  [Qol_Dates.Sound]: "习得绝对音感",
  [Qol_Dates.Mixing]: "习得调合知识",
  [Qol_Dates.Finger]: "手指灵活度+5",
  [Qol_Dates.Tongue]: "舌头灵活度+5",
  [Qol_Dates.LewdChest]: "胸部变性感",
  [Qol_Dates.LewdVagina]: "蜜壶变性感",
  [Qol_Dates.LewdAnus]: "肛门变性感",
  [Qol_Dates.Quad]: "初次四重绝顶",
  [Qol_Dates.Quint]: "初次五重绝顶",
  [Qol_Dates.FirstPeriod]: "初次来月经",
  [Qol_Dates.LoveSemen]: "嗜精成瘾",
  [Qol_Dates.SexKnow]: "习得性知识（破无知）",
  [Qol_Dates.Mirada]: "初次使用魅惑石",
  [Qol_Dates.DeepLove]: "初次爱恋（深恋）",
  [Qol_Dates.Engagement]: "初次订婚",
  [Qol_Dates.Marriage]: "初次结婚",
  [Qol_Dates.Concubine]: "初次纳妾",
};

/** 单一类别的 lock validator — 跟上游 `Qol_Info_Reset_Category` 第三参数等价。 */
export type LockValidator = (slot: CharaSlot) => boolean;

function exp(id: number): (slot: CharaSlot) => number {
  return (slot: CharaSlot) => slot.state.EXP[id] ?? 0;
}

function talent(id: number): LockValidator {
  return (slot: CharaSlot) => (slot.state.TALENT[id] ?? 0) !== 0;
}

function cflagGe(id: number, threshold: number): LockValidator {
  return (slot) => (slot.state.CFLAG[id] ?? 0) >= threshold;
}

/** 38 类 lock validator 表（按 `Qol_Dates_*` 顺序）。 */
export const HISTORY_LOCK: Readonly<Record<number, LockValidator>> = {
  [Qol_Dates.Meet]: cflagGe(CFLAG_ID.认识, 1),
  [Qol_Dates.Yearn]: (slot) => talent(TALENT_ID.思慕)(slot) || talent(TALENT_ID.恋慕)(slot),
  [Qol_Dates.Love]: talent(TALENT_ID.恋慕),
  [Qol_Dates.GF]: talent(TALENT_ID.恋人),
  [Qol_Dates.SFriend]: (slot) =>
    talent(TALENT_ID.セフレ)(slot) || talent(TALENT_ID.愛欲)(slot),
  [Qol_Dates.Lust]: talent(TALENT_ID.愛欲),
  [Qol_Dates.Orgasm]: (slot) => exp(EXP_ID.絶頂経験)(slot) > 0,
  [Qol_Dates.Ejac]: (slot) => exp(EXP_ID.射精経験)(slot) > 0,
  [Qol_Dates.Semen]: (slot) => exp(EXP_ID.精飲経験)(slot) > 0,
  [Qol_Dates.Creampie]: (slot) => exp(EXP_ID.膣射経験)(slot) > 0,
  [Qol_Dates.ACreampie]: (slot) => exp(EXP_ID.肛射経験)(slot) > 0,
  [Qol_Dates.Bj]: (slot) => exp(EXP_ID.口淫経験)(slot) > 0,
  [Qol_Dates.Lactation]: (slot) => exp(EXP_ID.噴乳経験)(slot) > 0,
  [Qol_Dates.LewdLips]: talent(TALENT_ID.キス魔),
  [Qol_Dates.Masturb]: talent(TALENT_ID.自慰狂),
  [Qol_Dates.LewdCervix]: talent(TALENT_ID.ポルチオ性感),
  [Qol_Dates.Musicality]: talent(TALENT_ID.音楽知識),
  [Qol_Dates.Sound]: talent(TALENT_ID.音感),
  [Qol_Dates.Mixing]: talent(TALENT_ID.調合知識),
  [Qol_Dates.Finger]: talent(TALENT_ID.器用な指),
  [Qol_Dates.Tongue]: talent(TALENT_ID.舌使い),
  [Qol_Dates.LewdChest]: talent(TALENT_ID.淫乳),
  [Qol_Dates.LewdVagina]: talent(TALENT_ID.淫壺),
  [Qol_Dates.LewdAnus]: talent(TALENT_ID.尻穴狂い),
  [Qol_Dates.FirstPeriod]: talent(TALENT_ID.初潮),
  [Qol_Dates.LoveSemen]: talent(TALENT_ID.精愛味覚),
  [Qol_Dates.SexKnow]: (slot) => (slot.state.TALENT[TALENT_ID.無知] ?? 0) === 0,
};

/** Qol_Dates_DeepLove/Engagement/Marriage/Concubine — 不在 `Qol_Info_Reset` 范围里，
 *  改用更直接的 Talent 检测（与上游 `EVENTTURNEND.ERB:174` 注释保持一致）。 */
HISTORY_LOCK; // (TS6133 静默)

/** DeflowerOrgasm / Quad / Quint / Mirada — 命令路径显式写，
 *  lockValidator 在这里显式 false（必须命令钩子写，不自动）。
 *  SexKnow（破无知）也归此类：它是 `無知` 被移除的**转变事件**，而晨间对账只能看
 *  当前状态谓词 `無知===0`——该谓词对"从来就不是無知"的角色恒真，会误记全体角色。
 *  转变检测只能靠命令钩子，故排除出自动对账。 */
export const HISTORY_LOCK_NOAUTO: Readonly<Record<number, true>> = {
  [Qol_Dates.DeflowerOrgasm]: true,
  [Qol_Dates.Quad]: true,
  [Qol_Dates.Quint]: true,
  [Qol_Dates.Mirada]: true,
  [Qol_Dates.SexKnow]: true,
};

/** 跑 lock validator。 */
export function lockHolds(stateLike: CharaSlot, category: number): boolean {
  const validator = HISTORY_LOCK[category];
  if (!validator) return false;
  return validator(stateLike);
}

/** 空数组（全 -1 = 未记录哨兵；见文件头 dayIndex 0-based 说明）。 */
export function emptyHistoryArray(): number[] {
  return Array.from({ length: HISTORY_CATEGORY_COUNT }, () => -1);
}