/**
 * Shared runtime projection for the three FREE_ACT/MESSAGE_TALK activities
 * that used to stop at the scheduler boundary.
 *
 *   FREE_ACT_16 -> MESSAGE_TALK(17) (pitfall)
 *   MESSAGE_TALK(18)                  (old-capital sento sign)
 *   FREE_ACT_17 -> MESSAGE_TALK(19) (snow object)
 *
 * State transitions stay deterministic and UI-independent here. No LLM or
 * presentation adapter is allowed to own these effects.
 */

import type { ObservationEvent } from "../../schemas/types.js";
import type { Rng } from "../command/types.js";
import { createRng } from "../command/rng.js";
import type { CharaSlot, GameState } from "../state/game-state.js";
import { ABL_ID, BASE_ID, TALENT_ID, advanceTimeTicks } from "../state/settlement.js";
import { getTflag, TFLAG_ID } from "../state/tflag.js";

const PITFALL_PRANKSTERS = new Set([5, 6, 7, 14, 53, 111]);
const OLD_CAPITAL_SENTO = "旧都:温泉";

export interface PitfallArrivalResult {
  outcome: "none" | "avoided" | "fallen";
  lines: string[];
}

export interface SnowObjectDescription {
  name: string;
  suffix: string;
}

function currentPitfall(state: Readonly<GameState>): NonNullable<GameState["freeActionMeta"]>["pitfall"] | undefined {
  const pitfall = state.freeActionMeta?.pitfall;
  return pitfall?.dayIndex === state.time.dayIndex ? pitfall : undefined;
}

function currentSnow(state: Readonly<GameState>): NonNullable<GameState["freeActionMeta"]>["snow"] | undefined {
  const snow = state.freeActionMeta?.snow;
  return snow?.dayIndex === state.time.dayIndex ? snow : undefined;
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function charaName(slot: CharaSlot | undefined, fallback: string): string {
  return slot?.callName ?? fallback;
}

/**
 * COMF400's player-arrival branch. The caller must place MASTER in the
 * destination and settle the ordinary movement time before calling this.
 */
export function resolvePitfallArrival(
  state: GameState,
  location: string,
  rng: Rng = createRng((state.time.tickValue ^ stableHash(location)) | 0),
): PitfallArrivalResult {
  const pitfall = currentPitfall(state);
  if (
    !pitfall ||
    pitfall.location !== location ||
    pitfall.fallenAtTick !== undefined ||
    pitfall.avoidedAtTick !== undefined
  ) {
    return { outcome: "none", lines: [] };
  }

  const battleAbility = state.master.state.ABL[ABL_ID.战斗能力] ?? 0;
  if (50 - battleAbility * 7 < rng.int(100)) {
    pitfall.avoidedAtTick = state.time.tickValue;
    return {
      outcome: "avoided",
      lines: [`……脚下有一个落穴、但${charaName(state.master, "主人")}毫不费力地避开了。`],
    };
  }

  const lines = [`${charaName(state.master, "主人")}掉进了一个落穴中！！`];
  const accident = rng.int(15) + getTflag(state, TFLAG_ID.幸運補正);
  if (accident < 2) {
    const current = state.master.state.BASE[BASE_ID.体力] ?? 0;
    state.master.state.BASE[BASE_ID.体力] = Math.max(0, current - 50);
    lines.push("好痛！！　这么想着的时候屁股已经落地了……");
  } else if (accident > 12) {
    state.money += 100;
    lines.push("……在穴底发现了100円。");
  }

  // COMF400 writes FA16_HOLE:2 after TIME += 3.
  advanceTimeTicks(state, 3);
  pitfall.fallenAtTick = state.time.tickValue;
  pitfall.masterFell = true;
  return { outcome: "fallen", lines };
}

function visiblePranksters(state: Readonly<GameState>, location: string): number[] {
  return [...PITFALL_PRANKSTERS].filter((charaNum) => {
    const slot = state.charas[charaNum];
    const action = state.freeActions?.[charaNum];
    return slot?.location === location && action?.type === 16 && action.remainingMinutes > 0;
  });
}

/** MESSAGE_TALK(17), including the immediate player-fall reaction. */
export function pitfallSceneLines(state: Readonly<GameState>, location: string): string[] {
  const pitfall = currentPitfall(state);
  if (!pitfall || pitfall.location !== location) return [];

  const pranksters = visiblePranksters(state, location);
  if (pitfall.fallenAtTick === state.time.tickValue && pitfall.masterFell) {
    if (pranksters.length > 0) return ["喜欢恶作剧的妖精们指着这边笑得很大声……"];
    return ["落穴一定是妖精们的恶作剧……和一些其他的。"];
  }
  if (pranksters.length > 0) return ["喜欢恶作剧的妖精们在做些什么……"];

  const clues = [
    "地面有些不自然的隆起……应该可以看到一些有趣的东西。",
    "土壤上有轻微的挖开的痕迹……应该可以看到一些有趣的东西。",
    "落穴被雪和落叶盖住了……看来有些事要发生。",
  ];
  return [clues[stableHash(`${location}:${state.time.tickValue}`) % clues.length]!];
}

/** MESSAGE_TALK(18). The modern player intentionally sees this in week one. */
export function sentoSceneLines(state: Readonly<GameState>, location: string): string[] {
  if (location !== OLD_CAPITAL_SENTO) return [];
  const date = state.time.date ?? ((state.time.dayIndex % 31) + 1);
  if (date < 8) return ["钱汤前立起了看板……『New-Plan 盛大开幕』"];
  const choices = ["『90分钟　10000円～』", "『有新人的哦』", "『绝不欺诈』"];
  return [`钱汤前立起了看板……${choices[stableHash(String(state.time.tickValue)) % choices.length]}`];
}

function deriveSnowObjectDescription(creator: CharaSlot | undefined, creatorNum: number): SnowObjectDescription {
  const special: Readonly<Record<number, SnowObjectDescription>> = {
    127: { name: "超多段雪人", suffix: "耸立着" }, // 瓔花
    68: { name: "冰晶花", suffix: "装饰在那里" }, // 幽香
    41: { name: "雪宇宙人", suffix: "正在看着这边…" }, // 鵺
    137: { name: "雪狸", suffix: "的上面放了一个叶子" }, // 猯藏
    135: { name: "招雪猫", suffix: "装饰在那里" }, // 三花
    138: { name: "阴阳雪玉", suffix: "蓬松地飘浮着" }, // 魅須丸
    131: { name: "雪埴轮", suffix: "排成了一队" }, // 磨弓
    132: { name: "雪埴轮", suffix: "正在四处走动…" }, // 袿姫
    47: { name: "雪战车", suffix: "已就位" }, // 里香
  };
  // Upstream indexes FA17_OBJNAME by CHARA % 1000, then applies the
  // "very large/cute" prefix to dynamically materialized characters.
  const baseCreatorNum = creatorNum > 1000 ? creatorNum % 1000 : creatorNum;
  const fixed = special[baseCreatorNum];
  if (fixed) {
    return creatorNum > 1000 ? { ...fixed, name: `可爱的${fixed.name}` } : fixed;
  }

  const rabbit =
    (creator?.state.TALENT[TALENT_ID.動物耳] ?? 0) === 2 ||
    // TALENT:人类 is the upstream race selector: 4 = 月人.
    (creator?.state.TALENT[TALENT_ID.人类] ?? 0) === 4 ||
    (creator?.state.ABL[ABL_ID.教養] ?? 0) >= 3;
  const base = rabbit ? "雪兔" : "雪人";
  const name = creatorNum > 1000 ? `${base === "雪人" ? "很大的" : "可爱的"}${base}` : base;
  return { name, suffix: base === "雪人" ? "站立着" : "装饰在那里" };
}

/** Snapshot FA17_OBJNAME when an object is created. */
export function snowObjectDescription(creator: CharaSlot | undefined, creatorNum: number): SnowObjectDescription {
  return deriveSnowObjectDescription(creator, creatorNum);
}

export function addSnowVisibility(state: GameState, location: string, amount: number): void {
  const snow = currentSnow(state);
  const object = snow?.objects[location];
  if (!object || amount <= 0) return;
  object.visibilityUnits = (object.visibilityUnits ?? 0) + amount;
}

/** MESSAGE_TALK(19), preserving the upstream unknown-maker branch. */
export function snowSceneLines(state: Readonly<GameState>, location: string): string[] {
  const object = currentSnow(state)?.objects[location];
  if (!object) return [];
  const creator = state.charas[object.creator];
  const description = object.name && object.suffix
    ? { name: object.name, suffix: object.suffix }
    : deriveSnowObjectDescription(creator, object.creator);
  if (!object.completed) return [`看到了还未完成的${description.name}`];
  if ((object.visibilityUnits ?? 0) < 10 && /大|可爱/.test(description.name)) {
    return [`不知是谁制作的${description.name}${description.suffix}`];
  }
  return [`${charaName(creator, "不知名的人")}制作的${description.name}${description.suffix}`];
}

/** Convert a state mutation into the normal player-facing movement events. */
export function pitfallArrivalEvents(
  state: GameState,
  location: string,
  timestamp: number,
  rng?: Rng,
): ObservationEvent[] {
  return resolvePitfallArrival(state, location, rng).lines.map((text) => ({
    kind: "NARRATION" as const,
    timestamp,
    text,
  }));
}
