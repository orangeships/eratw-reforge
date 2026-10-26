/**
 * COMF490 `アイテム` — the usable-item picker.
 *
 * `@COM_ABLE490` is not an upstream disabled stub: after the normal movement
 * gate it returns 1. This slice ports the consumables whose recovery/fullness
 * effects are deterministic, faithful to `@COM490`'s `SELECTCASE 使用道具`
 * (COMF490 アイテム.ERB:108-710).
 *
 * Coverage (all also purchasable from the gap shop `SHOP_CATALOG` — acquire →
 * consume closed loop):
 *   - 甜点 6: 黑雷神巧克力 120 / 巧克力 121 / 高級 122 / 本命 123 / 槲葉糕 212 / 冰淇淋 213
 *   - 恢复药 12: 青汁 500 / 营养饮料 501 / 精力剤 502 / 大回復薬 503 / 流星群Ｘ 505 /
 *     天元凸破 506 / 薬水 507 / 魔法薬水 508 / 破眠薬水 509 / 姜黄飲料 510 / 万能药 511 / 仙丹 512
 *   - 食品果物 9: 草莓 352 / 西瓜 364 / 八目鰻烤串 550 / 灰汁卷 576 / 树莓 626 /
 *     木通果 628 / 仙桃 630 / 山葡萄 665 / 墨西哥卷饼 669
 *   - 其他 4: 紅茶 215 / 糖 216 / 仙香玉兎 514 / 神奇蘑菇 721
 *
 * Effects are faithful to the upstream `SELECTCASE` arms with two documented
 * approximations: `薬の知識(x)` (調合Lv+禁断的知識+調合知識 ×1.1^ per level —
 * 調合 not implemented → the 1.1 ladder reduces to base for a clean chara) and
 * the 対象-only (MASTER) use (upstream can also hand food/drugs to TARGET).
 * The per-item `ITEM_TASTE` flavor correction (角色料理味道 ±10/匹配 + 季节
 * 倍数) IS modelled — `charaDataOf` exposes the raw foodLike/foodDislike.
 */
import type { CommandContext, HandlerEntry } from "../types.js";
import type { ObservationEvent } from "../../../schemas/types.js";
import { cloneGameState, type GameState } from "../../state/game-state.js";
import { itemCount, removeItem } from "../../state/items.js";
import {
  BASE_ID,
  CFLAG_ID,
  FLAG_ID,
  TALENT_ID,
  TCVAR_ID,
  advanceTimeTicks,
  recoverBase,
  recoverPermil,
} from "../../state/settlement.js";
import { buffBase } from "../../state/buff.js";
import { riseFullness } from "../../state/dish.js";
import { TFLAG_ID, getTflag, setTflag } from "../../state/tflag.js";
import { itemExplanation } from "../../state/item-explanation.js";
import { charaDataOf } from "../../state/chara-data.js";
import { pickOne, requirePickOne, type PromptSpec } from "../prompt.js";

export interface MasterConsumable {
  id: number;
  name: string;
  /** One-line UI detail (prompt option + InventoryPanel). */
  detail: string;
  /**
   * Faithful `@COM490` effect on the effective user slot. Target use aliases
   * the focused NPC into that slot before invoking the same effect.
   * Mutates the cloned state.
   * `ok:false` → the item is NOT consumed (upstream `GOTO LOOP`, e.g. 精力剤
   * without a penis).
   */
  apply(state: GameState): { ok: boolean; text: string };
}

// ---------------------------------------------------------------------------
// Effect helpers
// ---------------------------------------------------------------------------

/**
 * `STR_MULTI_COUNT(good, features)` — how many `features` tokens appear in
 * the chara's taste string (`foodLike`/`foodDislike`). ITEM_TASTE adds ±10
 * per matched token.
 */
function multiCount(haystack: string, features: string): number {
  let n = 0;
  for (const token of features.split("/")) {
    if (token !== "" && haystack.includes(token)) n += 1;
  }
  return n;
}

/** `@GET_MONTH` 季节倍数 (season 1-4 = 春/夏/秋/冬, calendar.ts). */
function seasonalMultiplier(features: string, season: number | undefined): number {
  switch (season) {
    case 1:
      return features.includes("春物/") ? 1.3 : 1;
    case 2:
      return features.includes("冰淇淋/") ? 2.0
        : features.includes("西瓜/") ? 1.3 : 1;
    case 3:
      return features.includes("木通果/") ? 1.3 : 1;
    case 4:
      return features.includes("冰淇淋/") ? 0.5 : 1;
    default:
      return 1;
  }
}

/**
 * `@ITEM_TASTE(CHARA, 基準値, 食品特徴)` — base + (liked − disliked matches)*10,
 * then the season multiplier (TIMES truncation). Chara = MASTER (0); missing
 * chara-data (uncollected character) degrades to base.
 */
function itemTaste(state: Readonly<GameState>, base: number, features: string): number {
  // During target use the effect runner aliases the focused NPC as the
  // effective master slot, so taste data follows the recipient as upstream
  // ITEM_TASTE(対象) does.
  const data = charaDataOf(state.master.charaNum);
  const good = data?.foodLike ?? "";
  const bad = data?.foodDislike ?? "";
  let value = base + (multiCount(good, features) - multiCount(bad, features)) * 10;
  const mult = seasonalMultiplier(features, state.time.season);
  if (mult !== 1) value = Math.trunc(value * mult);
  return value;
}

/**
 * `@薬の知識(ARG)` — base × 1.1^(調合Lv + 禁断的知識 + 調合知識), TIMES truncating
 * per level. 調合/禁断的知識 are unmodeled in the modern runtime (clean chara
 * → 0), so this reduces to base; the ladder stays for when 調合 is ported.
 */
function drugKnowledge(state: Readonly<GameState>, base: number): number {
  const lv = (state.master.state.TALENT[TALENT_ID.調合Lv] ?? 0)
    + (state.master.state.TALENT[TALENT_ID.調合知識] ?? 0);
  let value = base;
  for (let i = 0; i < lv; i += 1) value = Math.trunc(value * 1.1);
  return value;
}

function hasPenis(state: Readonly<GameState>): boolean {
  return ((state.master.state.TALENT[TALENT_ID.性別] ?? 0) & 2) !== 0;
}

/** 体力/気力/精力/TSP flat restore + 清醒剂 MAX + 徹夜 + 今日服薬 marker. */
function drugRestore(
  state: GameState,
  o: {
    body?: number;
    will?: number;
    energy?: number;
    tsp?: number;
    clarity?: number;
    overnight?: boolean;
  },
): void {
  if (o.body !== undefined) recoverBase(state.master, BASE_ID.体力, o.body);
  if (o.will !== undefined) recoverBase(state.master, BASE_ID.気力, o.will);
  if (o.energy !== undefined) recoverBase(state.master, BASE_ID.精力, o.energy);
  if (o.tsp !== undefined) recoverBase(state.master, BASE_ID.TSP, o.tsp);
  if (o.clarity !== undefined) {
    state.master.state.CFLAG[CFLAG_ID.清醒劑] = Math.max(
      state.master.state.CFLAG[CFLAG_ID.清醒劑] ?? 0,
      o.clarity,
    );
  }
  if (o.overnight) state.master.state.CFLAG[CFLAG_ID.徹夜] = 1;
  state.master.state.TCVAR[TCVAR_ID.薬] = 1; // 今日服薬 marker (fidelity; gate commented upstream)
}

// ---------------------------------------------------------------------------
// The consumable table (id → def), faithful to @COM490 SELECTCASE.
// ---------------------------------------------------------------------------

export const MASTER_CONSUMABLES: Readonly<Record<number, MasterConsumable>> = {
  120: {
    id: 120, name: "黑雷神巧克力", detail: "恢复 体力50/气力50 甜点60",
    apply: (state) => {
      recoverBase(state.master, BASE_ID.体力, 50);
      recoverBase(state.master, BASE_ID.気力, 50);
      riseFullness(state, 0, "甜点", 60);
      return { ok: true, text: "吃黑雷神巧克力。……一股廉价的味道" };
    },
  },
  121: {
    id: 121, name: "巧克力", detail: "恢复 体力300/气力300",
    apply: (state) => {
      recoverBase(state.master, BASE_ID.体力, itemTaste(state, 300, "巧克力/甜/"));
      recoverBase(state.master, BASE_ID.気力, itemTaste(state, 300, "巧克力/甜/"));
      riseFullness(state, 0, "甜点", 180);
      return { ok: true, text: "吃巧克力。" };
    },
  },
  122: {
    id: 122, name: "高级巧克力", detail: "恢复 体力500/气力500",
    apply: (state) => {
      recoverBase(state.master, BASE_ID.体力, itemTaste(state, 500, "高級巧克力/甜/上品/豪華/高级食材/"));
      recoverBase(state.master, BASE_ID.気力, itemTaste(state, 500, "高級巧克力/甜/上品/豪華/高级食材/"));
      riseFullness(state, 0, "甜点", 180);
      return { ok: true, text: "吃高级巧克力。好吃！" };
    },
  },
  123: {
    id: 123, name: "本命巧克力", detail: "恢复 体力1000/气力1000",
    apply: (state) => {
      recoverBase(state.master, BASE_ID.体力, itemTaste(state, 1000, "本命巧克力/愛情/甜/"));
      recoverBase(state.master, BASE_ID.気力, itemTaste(state, 1000, "本命巧克力/愛情/甜/"));
      riseFullness(state, 0, "甜点", 180);
      return { ok: true, text: "吃本命巧克力。可以感受到爱！" };
    },
  },
  212: {
    id: 212, name: "槲葉糕", detail: "恢复 体力100",
    apply: (state) => {
      recoverBase(state.master, BASE_ID.体力, itemTaste(state, 100, "槲葉糕/甜/"));
      riseFullness(state, 0, "甜点", 180);
      return { ok: true, text: "吃槲葉糕。" };
    },
  },
  213: {
    id: 213, name: "冰淇淋", detail: "恢复 气力150",
    apply: (state) => {
      recoverBase(state.master, BASE_ID.気力, itemTaste(state, 150, "冰淇淋/冷/甜/"));
      riseFullness(state, 0, "甜点", 180);
      return { ok: true, text: "吃冰淇淋。" };
    },
  },
  500: {
    id: 500, name: "青汁", detail: "恢复 体力100 气力200",
    apply: (state) => {
      recoverBase(state.master, BASE_ID.体力, 100);
      recoverBase(state.master, BASE_ID.気力, itemTaste(state, 200, "青汁/苦/苦/苦/健康/野菜/葉物/野趣/"));
      return { ok: true, text: "喝青汁。不好喝！再来一杯！" };
    },
  },
  501: {
    id: 501, name: "营养饮料", detail: "恢复 体力200 气力100",
    apply: (state) => {
      drugRestore(state, {
        body: drugKnowledge(state, 200),
        will: drugKnowledge(state, 100),
        clarity: drugKnowledge(state, 20),
      });
      return { ok: true, text: "喝营养饮料。" };
    },
  },
  502: {
    id: 502, name: "精力剤", detail: "恢复 精力300",
    apply: (state) => {
      if (!hasPenis(state)) return { ok: false, text: "好像不属于精力剂的使用对象" };
      recoverBase(state.master, BASE_ID.精力, drugKnowledge(state, 300));
      state.master.state.TCVAR[TCVAR_ID.薬] = 1;
      return { ok: true, text: "喝精力剤。" };
    },
  },
  503: {
    id: 503, name: "大回復薬", detail: "恢复 体力500 气力300",
    apply: (state) => {
      drugRestore(state, {
        body: drugKnowledge(state, 500),
        will: drugKnowledge(state, 300),
        clarity: drugKnowledge(state, 60),
      });
      return { ok: true, text: "喝大回復薬。干劲满满、状态十足！" };
    },
  },
  505: {
    id: 505, name: "流星群Ｘ", detail: "恢复 体力800 气力600",
    apply: (state) => {
      drugRestore(state, {
        body: drugKnowledge(state, 800),
        will: drugKnowledge(state, 600),
        clarity: drugKnowledge(state, 180),
        overnight: true,
      });
      return { ok: true, text: "喝流星群Ｘ。感觉还能再战24小时…！" };
    },
  },
  506: {
    id: 506, name: "精力剤『天元凸破』", detail: "恢复 体力400 气力300 精力800",
    apply: (state) => {
      drugRestore(state, {
        body: drugKnowledge(state, 400),
        will: drugKnowledge(state, 300),
        energy: drugKnowledge(state, 800),
      });
      return { ok: true, text: "喝精力剤『天元凸破』。劳资的×××可是突破天际的！" };
    },
  },
  507: {
    id: 507, name: "薬水", detail: "恢复 气力150 TSP150",
    apply: (state) => {
      drugRestore(state, {
        will: drugKnowledge(state, 150),
        tsp: drugKnowledge(state, 150),
      });
      return { ok: true, text: "喝薬水。" };
    },
  },
  508: {
    id: 508, name: "魔法薬水", detail: "恢复 气力300 TSP600",
    apply: (state) => {
      drugRestore(state, {
        will: drugKnowledge(state, 300),
        tsp: drugKnowledge(state, 600),
      });
      return { ok: true, text: "喝魔法薬水。充盈着魔力…" };
    },
  },
  509: {
    id: 509, name: "破眠薬水", detail: "恢复 气力200",
    apply: (state) => {
      drugRestore(state, {
        will: drugKnowledge(state, 200),
        clarity: drugKnowledge(state, 240),
        overnight: true,
      });
      return { ok: true, text: "喝破眠薬水。" };
    },
  },
  510: {
    id: 510, name: "姜黄飲料", detail: "醒酒药",
    apply: (state) => {
      setTflag(state, TFLAG_ID.醒酒药, 1);
      return { ok: true, text: "喝姜黄飲料。肝机能增强了、变得不容易醉了" };
    },
  },
  511: {
    id: 511, name: "万能药", detail: "全恢复",
    apply: (state) => {
      const cap = (s: number) => Math.max(9999, state.master.state.MAXBASE[s] ?? 0);
      drugRestore(state, {
        body: cap(BASE_ID.体力),
        will: cap(BASE_ID.気力),
        energy: cap(BASE_ID.精力),
        tsp: cap(BASE_ID.TSP),
        clarity: 300,
      });
      return { ok: true, text: "喝万能药。疲劳被吹飞到另一个世界了…！" };
    },
  },
  512: {
    id: 512, name: "仙丹", detail: "体力/气力/精力 BUFF",
    apply: (state) => {
      for (const stat of [BASE_ID.体力, BASE_ID.気力, BASE_ID.精力]) {
        const delta = Math.max(Math.trunc((state.master.state.MAXBASE[stat] ?? 0) / 5), 500);
        buffBase(state.master, stat, delta);
      }
      return { ok: true, text: "吃下仙丹。非同寻常的力量……！" };
    },
  },
  352: {
    id: 352, name: "草莓", detail: "恢复 气力50",
    apply: (state) => {
      recoverBase(state.master, BASE_ID.気力, itemTaste(state, 50, "草莓/野菜/果物/甜/"));
      return { ok: true, text: "吃草莓。" };
    },
  },
  364: {
    id: 364, name: "西瓜", detail: "恢复 气力100",
    apply: (state) => {
      recoverBase(state.master, BASE_ID.気力, itemTaste(state, 100, "西瓜/野菜/果物/甜/"));
      return { ok: true, text: "吃西瓜。" };
    },
  },
  550: {
    id: 550, name: "八目鰻烤串", detail: "恢复 体力/气力/精力 4%/8%/5%",
    apply: (state) => {
      const features = "八目鰻烤串/魚料理/下酒菜/";
      recoverPermil(state.master, BASE_ID.体力, itemTaste(state, 40, features));
      recoverPermil(state.master, BASE_ID.気力, itemTaste(state, 80, features));
      recoverPermil(state.master, BASE_ID.精力, itemTaste(state, 50, features));
      riseFullness(state, 0, "軽食", 180);
      return { ok: true, text: "吃八目鰻烤串。" };
    },
  },
  576: {
    id: 576, name: "灰汁卷", detail: "恢复 体力150 气力150",
    apply: (state) => {
      recoverBase(state.master, BASE_ID.体力, itemTaste(state, 150, "灰汁卷/和食/米/団子/甜/软糯的/家庭的/春物/"));
      recoverBase(state.master, BASE_ID.気力, itemTaste(state, 150, "灰汁卷/和食/米/団子/甜/软糯的/家庭的/春物/"));
      riseFullness(state, 0, "主食", 180);
      return { ok: true, text: "吃灰汁卷。" };
    },
  },
  626: {
    id: 626, name: "树莓", detail: "恢复 气力50",
    apply: (state) => {
      recoverBase(state.master, BASE_ID.気力, itemTaste(state, 50, "树莓/果物/甜/酸/野趣/"));
      return { ok: true, text: "吃树莓。" };
    },
  },
  628: {
    id: 628, name: "木通果", detail: "恢复 体力80 气力80",
    apply: (state) => {
      recoverBase(state.master, BASE_ID.体力, 80);
      recoverBase(state.master, BASE_ID.気力, itemTaste(state, 80, "木通果/果物/甜/野趣/"));
      return { ok: true, text: "吃木通果。" };
    },
  },
  630: {
    id: 630, name: "仙桃", detail: "体力/气力/精力 BUFF",
    apply: (state) => {
      for (const stat of [BASE_ID.体力, BASE_ID.気力, BASE_ID.精力]) {
        const delta = Math.max(Math.trunc((state.master.state.MAXBASE[stat] ?? 0) / 10), 500);
        buffBase(state.master, stat, delta);
      }
      return { ok: true, text: "吃仙桃。非同寻常的力量……！" };
    },
  },
  665: {
    id: 665, name: "山葡萄", detail: "恢复 气力50",
    apply: (state) => {
      recoverBase(state.master, BASE_ID.気力, itemTaste(state, 50, "山葡萄/果物/甜/酸/野趣/"));
      return { ok: true, text: "吃山葡萄。" };
    },
  },
  669: {
    id: 669, name: "墨西哥卷饼", detail: "恢复 体力120 气力120",
    apply: (state) => {
      const features = "墨西哥卷饼/洋葱/番茄/卷心菜/洋食/野菜/獣肉/香料/乳酪/辣/丰盛/濃厚/機能的/野趣/新鲜/サクサク/";
      recoverBase(state.master, BASE_ID.体力, itemTaste(state, 120, features));
      recoverBase(state.master, BASE_ID.気力, itemTaste(state, 120, features));
      riseFullness(state, 0, "軽食", 180);
      return { ok: true, text: "吃墨西哥卷饼。" };
    },
  },
  215: {
    id: 215, name: "紅茶", detail: "特别的茶水（效果未建模）",
    apply: () => {
      // Upstream: SETBIT TCVAR:MASTER:特別的茶水, 0. 特別的茶水 has no modern
      // consumer — approximate as use+consume with upstream text.
      return { ok: true, text: "使用红茶。" };
    },
  },
  216: {
    id: 216, name: "糖", detail: "糖分 20（效果未建模）",
    apply: (state) => {
      state.master.state.TCVAR[TCVAR_ID.糖] = 20;
      return { ok: true, text: "剥开一颗硬糖含着。可以感受到丝丝甜味！" };
    },
  },
  514: {
    id: 514, name: "仙香玉兎", detail: "幻惑薰香 240（消费方未接）",
    apply: (state) => {
      if (getTflag(state, TFLAG_ID.仙香玉兎) > 0) return { ok: false, text: "已经用过了" };
      setTflag(state, TFLAG_ID.仙香玉兎, 240);
      return { ok: true, text: "把仙香玉兎插在了香炉上。周围漂浮着幻惑的薰香……" };
    },
  },
  721: {
    id: 721, name: "神奇蘑菇", detail: "体力/气力 BUFF",
    apply: (state) => {
      for (const stat of [BASE_ID.体力, BASE_ID.気力]) {
        buffBase(state.master, stat, state.master.state.MAXBASE[stat] ?? 0);
      }
      state.master.state.CFLAG[CFLAG_ID.清醒劑] = Math.max(state.master.state.CFLAG[CFLAG_ID.清醒劑] ?? 0, 200);
      state.master.state.TCVAR[TCVAR_ID.薬] = 1;
      return { ok: true, text: "吃神奇蘑菇。一股莫名的力量涌上全身…！" };
    },
  },
};

/**
 * `@使用可能道具` returns 1 for these modeled items: they remain
 * master-only even when an NPC is focused. The other modeled entries are
 * target-capable, with item 502 retaining its anatomy check.
 */
const MASTER_ONLY_CONSUMABLE_IDS = new Set([121, 122, 123, 215, 500, 510, 514]);

function canUseConsumableOnTarget(
  state: Readonly<GameState>,
  itemId: number,
  targetCharaNum: number,
): boolean {
  const item = MASTER_CONSUMABLES[itemId];
  if (targetCharaNum <= 0 || !item || !state.charas[targetCharaNum]) return false;
  if (MASTER_ONLY_CONSUMABLE_IDS.has(itemId)) return false;
  if (itemId === 502) {
    const target = state.charas[targetCharaNum]!;
    return ((target.state.TALENT[TALENT_ID.性別] ?? 0) & 2) !== 0;
  }
  return true;
}

/** Apply an existing table entry with an NPC as its effective target slot. */
function applyWithTargetAlias(
  state: GameState,
  item: MasterConsumable,
  targetCharaNum: number,
): { ok: boolean; text: string } {
  const target = state.charas[targetCharaNum];
  if (!target) return { ok: false, text: "没有找到可以使用道具的角色。" };
  const originalMaster = state.master;
  state.master = target;
  try {
    return item.apply(state);
  } finally {
    state.master = originalMaster;
  }
}

/**
 * Item 213 is authored as a shared dessert: with a focused target the
 * upstream command restores both the player and that target. Keep that one
 * special branch while the remaining items affect the selected target only.
 */
function applyConsumableEffect(
  state: GameState,
  item: MasterConsumable,
  targetCharaNum: number,
): { ok: boolean; text: string } {
  if (targetCharaNum <= 0) return item.apply(state);
  const masterResult = item.id === 213 ? item.apply(state) : undefined;
  const targetResult = applyWithTargetAlias(state, item, targetCharaNum);
  if (masterResult && !masterResult.ok) return masterResult;
  return targetResult;
}

/** Held COMF490 items whose deterministic effects are implemented. */
export function usableMasterConsumables(state: Readonly<GameState>): MasterConsumable[] {
  return Object.values(MASTER_CONSUMABLES)
    .filter((item) => itemCount(state, item.id) > 0)
    .sort((a, b) => a.id - b.id);
}

/** Items held by the player that the focused NPC may receive. */
export function usableTargetConsumables(
  state: Readonly<GameState>,
  targetCharaNum: number,
): MasterConsumable[] {
  return Object.values(MASTER_CONSUMABLES)
    .filter((item) => itemCount(state, item.id) > 0 && canUseConsumableOnTarget(state, item.id, targetCharaNum))
    .sort((a, b) => a.id - b.id);
}

/**
 * Authoritative COMF490 effect, shared by the command handler and SHOP [104].
 * Mutates the supplied cloned state. A successful use consumes one item and
 * advances five minutes, matching the upstream command's common tail.
 */
export function applyConsumable(state: GameState, itemId: number, targetCharaNum = 0): {
  ok: boolean;
  message: string;
  clockEvents: ReturnType<typeof advanceTimeTicks>;
} {
  const item = MASTER_CONSUMABLES[itemId];
  if ((state.flagStore[FLAG_ID.時間停止] ?? 0) !== 0) {
    return { ok: false, message: "时间停止中不能使用道具。", clockEvents: [] };
  }
  if (!item || itemCount(state, itemId) <= 0) {
    return { ok: false, message: "该道具尚未建模为可直接使用，或已经没有库存。", clockEvents: [] };
  }
  if (targetCharaNum > 0 && !canUseConsumableOnTarget(state, itemId, targetCharaNum)) {
    return { ok: false, message: "该道具不能对当前角色使用。", clockEvents: [] };
  }
  const applied = applyConsumableEffect(state, item, targetCharaNum);
  if (!applied.ok) {
    return { ok: false, message: applied.text, clockEvents: [] };
  }
  removeItem(state, itemId, 1);
  const clockEvents = advanceTimeTicks(state, 5);
  return { ok: true, message: applied.text, clockEvents };
}

/** Backward-compatible self-use entry point used by SHOP [104]. */
export function applyMasterConsumable(state: GameState, itemId: number): {
  ok: boolean;
  message: string;
  clockEvents: ReturnType<typeof advanceTimeTicks>;
} {
  return applyConsumable(state, itemId, 0);
}

function promptForItems(state: Readonly<GameState>, targetCharaNum = 0): PromptSpec | null {
  const items = targetCharaNum > 0
    ? usableTargetConsumables(state, targetCharaNum)
    : usableMasterConsumables(state);
  const options = items
    .map((item) => ({
      id: `use:${item.id}`,
      label: `${item.name} ×${itemCount(state, item.id)}`,
      detail: item.detail,
    }));
  return options.length > 0 ? pickOne("要使用什么道具？", options) : null;
}

function pickedItem(state: Readonly<GameState>, ctx: CommandContext, targetCharaNum: number): number | null {
  const spec = promptForItems(state, targetCharaNum);
  if (!spec) return null;
  const picked = requirePickOne(spec, ctx.promptAnswer);
  if (typeof picked !== "string" || !picked.startsWith("use:")) return null;
  const itemId = Number(picked.slice(4));
  return Number.isInteger(itemId) && MASTER_CONSUMABLES[itemId] && itemCount(state, itemId) > 0 &&
    (targetCharaNum <= 0 || canUseConsumableOnTarget(state, itemId, targetCharaNum))
    ? itemId
    : null;
}

export const itemUse490HandlerEntry: HandlerEntry = {
  commandNo: 490,
  // `TFLAG:100` is the old menu-reach marker. Reaching a catalog command is
  // its browser equivalent; retain the actionable global time-stop gate.
  execCheck: (ctx) => (ctx.state.flagStore[FLAG_ID.時間停止] ?? 0) === 0
    ? { ok: true }
    : { ok: false, reason: { kind: "precondition", message: "时间停止中不能使用道具。" } },
  prompt: (ctx) => promptForItems(ctx.state, ctx.target),
  handler: (ctx) => {
    const next = cloneGameState(ctx.state);
    const targetCharaNum = ctx.target > 0 ? ctx.target : 0;
    const itemId = pickedItem(next, ctx, targetCharaNum);
    if (itemId === null) {
      return {
        state: next,
        events: [{ kind: "NARRATION" as const, timestamp: ctx.now(), text: "没有选择可直接使用的道具。" }],
        outcome: "noop" as const,
      };
    }
    const applied = applyConsumable(next, itemId, targetCharaNum);
    const item = MASTER_CONSUMABLES[itemId]!;
    if (applied.ok) {
      // COMF490 アイテム.ERB:106-107 — `TFLAG:193 = 使用道具`（used item id）
      // and `TFLAG:194 = 対象 == MASTER ? MASTER # 1`（self use → 0, NPC use
      // → 1）. Written on the result state so `withCommandKojo`'s
      // collectCommandKojo evaluates the authored COM490 routes (22 characters
      // ship them) against the same transient flags the upstream kojo reads.
      setTflag(next, TFLAG_ID.SELECTCOM的分岐, itemId);
      setTflag(next, TFLAG_ID.SOURCEなどに影響しないSELECTCOMの分岐, targetCharaNum === 0 ? 0 : 1);
    }
    const events: ObservationEvent[] = [
      ...applied.clockEvents.map((event) => ({ ...event, timestamp: ctx.now() })),
    ];
    if (applied.ok && targetCharaNum > 0) {
      const receiver = next.charas[targetCharaNum];
      events.push({
        kind: "NARRATION" as const,
        timestamp: ctx.now(),
        text: `给${receiver?.callName ?? `角色#${targetCharaNum}`}使用了${item.name}。`,
        surface: "item-use" as const,
        tone: "plain" as const,
      });
    }
    events.push({
      kind: "NARRATION" as const,
      timestamp: ctx.now(),
      text: applied.message,
      ...(applied.ok ? { surface: "item-use" as const, tone: "plain" as const } : {}),
    });
    if (applied.ok) {
      // Same convention as 採集 (@MESSAGE_COM445 prints the item's 地文
      // introduction): the upstream `"??????"` no-explanation fallback is
      // omitted rather than printed.
      const explanation = itemExplanation(next, itemId);
      if (explanation !== null) {
        events.push({
          kind: "NARRATION" as const,
          timestamp: ctx.now(),
          text: `${item.name}：${explanation}`,
          surface: "item-use" as const,
          tone: "plain" as const,
        });
      }
    }
    return {
      state: next,
      events,
      outcome: applied.ok ? "ok" as const : "noop" as const,
    };
  },
};
