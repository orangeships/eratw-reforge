/**
 * H 场景的长期身体概况投影（`body_profile`）。
 *
 * 与 `physical_state`（此刻的身体状态）严格分开：高经验不代表当前精力充沛，
 * 长期能力也不代表本轮已经发生某项事件。两者不能互相替代。
 *
 * 设计约束（`H-L1-CONTEXT-DESIGN.md` §7）：
 *   - 每根轴各有**独立来源**，绝不把同一个数值复制成三种 high。
 *   - 上游没有来源的轴（`adaptation` / `preferred_stimulation`）保持 unknown，
 *     不为填满形状而编造。
 *   - 对模型只给中性分档 + evidence，**不给原始 ABL 数值**——`ABL:某项=3` 对模型
 *     没有意义，档位才是。
 */

import type { GameState } from "../state/game-state.js";
import { ABL_ID, CFLAG_ID, EXP_ID, TALENT_ID, TCVAR_ID } from "../state/settlement.js";

/** 分档表版本。改动 `H_BODY_PROFILE_THRESHOLDS` 必须同步 bump。 */
export const H_BODY_PROFILE_VERSION = 1;

export type HBodyProfileLevel = "none" | "low" | "some" | "high" | "unknown";

/** 只有从明确字段读出数值的轴才出现在这里。 */
export type HBodyProfileAxis = "experience" | "sensitivity";

/** domain 就是上游感官通道本身。Ｃ/Ｖ/Ａ/Ｂ/Ｍ 的语意在仓库里从来没有展开过
 *  （`Palam.als`/`Abl.als` 只给字母），所以这里也不替它们编造名称。 */
export type HBodyProfileDomain = "Ｃ" | "Ｖ" | "Ａ" | "Ｂ" | "Ｍ" | "unconscious";

export interface HBodyProfileTier {
  level: HBodyProfileLevel;
  /** 原始计数值；`null` = 完全没有读数。**不进 prompt**（见 `hBodyProfileForPrompt`）。 */
  raw: number | null;
  /** 产出这一档的 canonical 字段，让模型知道这条有多可信。 */
  evidence: string;
}

export interface HBodyProfile {
  version: number;
  experience: Partial<Record<HBodyProfileDomain, HBodyProfileTier>>;
  sensitivity: Partial<Record<HBodyProfileDomain, HBodyProfileTier>>;
  /** 有**正面证据**表明尚未经历过的 domain。与「经验计数器读数为 0」不同：
   *  这里只接受明确的处子/未破瓜标记，不接受「没有记录」的推断。 */
  unfamiliar: HBodyProfileDomain[];
  /** 上游无来源 ⇒ 恒 unknown。保留字段以免模型自行推断。 */
  adaptation: "unknown";
  preferred_stimulation: "unknown";
}

/** 每根轴的来源族。测试断言两轴不同源，防止「一个数值复制成多种高档位」。 */
export const H_BODY_PROFILE_SOURCES: Readonly<Record<HBodyProfileAxis, string>> = Object.freeze({
  experience: "EXP.{Ｃ,Ｖ,Ａ,Ｂ,Ｍ}経験 / EXP.無自覚絶頂経験",
  sensitivity: "ABL.{Ｃ,Ｖ,Ａ,Ｂ,Ｍ}感覚",
});

const CHANNELS = ["Ｃ", "Ｖ", "Ａ", "Ｂ", "Ｍ"] as const;

const EXPERIENCE_IDS: Readonly<Record<(typeof CHANNELS)[number], number>> = Object.freeze({
  "Ｃ": EXP_ID.Ｃ経験,
  "Ｖ": EXP_ID.Ｖ経験,
  "Ａ": EXP_ID.Ａ経験,
  "Ｂ": EXP_ID.Ｂ経験,
  "Ｍ": EXP_ID.Ｍ経験,
});

const SENSITIVITY_IDS: Readonly<Record<(typeof CHANNELS)[number], number>> = Object.freeze({
  "Ｃ": ABL_ID.Ｃ感覚,
  "Ｖ": ABL_ID.Ｖ感覚,
  "Ａ": ABL_ID.Ａ感覚,
  "Ｂ": ABL_ID.Ｂ感覚,
  "Ｍ": ABL_ID.Ｍ感覚,
});

/**
 * 每轴 × 每 domain 各自的 `[low, some, high]` 下界（含）。**刻意不共用一张表**：
 * `EXP:*経験` 每次行为只加个位数到几十（`COMF141` 给 `EXP:Ｖ経験` +24），而
 * `ABL:*感覚` 是游戏自带的 0-5 有界能力刻度——同一组数字在两根轴上含义不同。
 *
 * **数值是临时的**（2026-09-30 拍板「先给可调默认值，后续再校」）：取保守值，
 * 并连同版本一起记录，重新校准只改这一张表。
 */
export const H_BODY_PROFILE_THRESHOLDS = Object.freeze({
  experience: Object.freeze({
    "Ｃ": [1, 20, 100],
    "Ｖ": [1, 20, 100],
    "Ａ": [1, 20, 100],
    "Ｂ": [1, 20, 100],
    "Ｍ": [1, 20, 100],
    unconscious: [1, 5, 20],
  } satisfies Record<HBodyProfileDomain, readonly [number, number, number]>),
  sensitivity: Object.freeze({
    "Ｃ": [1, 3, 5],
    "Ｖ": [1, 3, 5],
    "Ａ": [1, 3, 5],
    "Ｂ": [1, 3, 5],
    "Ｍ": [1, 3, 5],
  } satisfies Partial<Record<HBodyProfileDomain, readonly [number, number, number]>>),
});

function tierFrom(
  raw: number | null,
  thresholds: readonly [number, number, number],
  field: string,
): HBodyProfileTier {
  if (raw === null) return { level: "unknown", raw: null, evidence: `${field} 无读数` };
  const [low, some, high] = thresholds;
  const level: HBodyProfileLevel = raw >= high ? "high" : raw >= some ? "some" : raw >= low ? "low" : "none";
  return { level, raw, evidence: field };
}

/** Sparse namespace read. A missing entry mirrors ERA's zero-initialized
 *  variables, so absent means **0**, not "no reading" — treating every unset
 *  counter as unknown would make the whole profile unknown for every character
 *  that has never trained. Only a present-but-non-numeric value is unknown. */
function numeric(namespace: Record<number, number>, id: number): number | null {
  const value = namespace[id];
  if (value === undefined) return 0;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * 长期身体概况。没有任何证据时返回 `undefined` 而不是一堆 unknown 空壳——
 * 调用方据此省略整块，避免往 prompt 里塞噪音。
 */
export function projectHBodyProfile(
  state: Readonly<GameState>,
  target: number,
): HBodyProfile | undefined {
  const slot = state.charas[target];
  if (!slot) return undefined;

  const experience: HBodyProfile["experience"] = {};
  for (const channel of CHANNELS) {
    experience[channel] = tierFrom(
      numeric(slot.state.EXP, EXPERIENCE_IDS[channel]),
      H_BODY_PROFILE_THRESHOLDS.experience[channel],
      `EXP.${channel}経験`,
    );
  }
  experience.unconscious = tierFrom(
    numeric(slot.state.EXP, EXP_ID.無自覚絶頂経験),
    H_BODY_PROFILE_THRESHOLDS.experience.unconscious,
    "EXP.無自覚絶頂経験",
  );

  const sensitivity: HBodyProfile["sensitivity"] = {};
  for (const channel of CHANNELS) {
    sensitivity[channel] = tierFrom(
      numeric(slot.state.ABL, SENSITIVITY_IDS[channel]),
      H_BODY_PROFILE_THRESHOLDS.sensitivity[channel]!,
      `ABL.${channel}感覚`,
    );
  }

  // 正面证据，不是「没有记录」的推断：
  //   処女 ∈ {1,2} = 仍是处女；-1 = 已失去但无记录（**不是**首次）。
  //   Ａ破瓜 与 尻穴処女喪失記念日 都还是 0 = 从未记录过肛门插入。
  const unfamiliar: HBodyProfileDomain[] = [];
  const virgin = slot.state.TALENT[TALENT_ID.処女] ?? 0;
  if (virgin === 1 || virgin === 2) unfamiliar.push("Ｖ");
  const analBroken = (slot.state.TCVAR[TCVAR_ID.Ａ破瓜] ?? 0) !== 0;
  const analAnniversary = (slot.state.CFLAG[CFLAG_ID.尻穴処女喪失記念日] ?? 0) !== 0;
  if (!analBroken && !analAnniversary) unfamiliar.push("Ａ");

  return {
    version: H_BODY_PROFILE_VERSION,
    experience,
    sensitivity,
    unfamiliar,
    adaptation: "unknown",
    preferred_stimulation: "unknown",
  };
}

/** 模型侧形状：丢掉 `raw`，只留档位与来源。 */
export function hBodyProfileForPrompt(profile: HBodyProfile): unknown {
  const tiers = (axis: Partial<Record<HBodyProfileDomain, HBodyProfileTier>>) =>
    Object.fromEntries(
      Object.entries(axis).map(([domain, tier]) => [domain, { level: tier!.level, evidence: tier!.evidence }]),
    );
  return {
    version: profile.version,
    experience: tiers(profile.experience),
    sensitivity: tiers(profile.sensitivity),
    ...(profile.unfamiliar.length > 0 ? { unfamiliar: profile.unfamiliar } : {}),
    adaptation: profile.adaptation,
    preferred_stimulation: profile.preferred_stimulation,
  };
}
