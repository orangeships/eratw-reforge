/**
 * Phase 7.5 (§3E follow-up) — `alcohol.ts`: the 酒/飲酒 subsystem, parallel
 * to `dish.ts` (the eat half of B7). Unlocks COMF332 お酒をふるまう (serve
 * alcohol) without waiting on the 酒造 brewing minigame. Faithful to the
 * **non-DLC** path of `ERB/コマンド関連/COMF/日常系/酒関連.ERB`
 * (`@酒データ{N}` object system / `@DRUNKEN` / `@ALCOHOL_TASTE` /
 * `@EFFECT_酒データ{N}`) + `COMF332.ERB` (`@COM332_1` SOURCE formula).
 *
 * **Registry (FARM-BREW B4: now the FULL drinkable table).** All drinkable
 * `@酒データ{N}` terminals are encoded: the canonical 51-59 (== Item.csv id),
 * the 一夜奇稻田 special (513), and the 酒造パッチ brewed drinks 560-592
 * (烧酒/朗姆/白兰地/贵酿/吟酿-熟成-古酒/苦艾酒/etc.) that COMF450 fermentation
 * produces. Each is a 名前 / 酒気増加量 / TASTE triple; brewing intermediates
 * (waters / juices / mashes with `変化先` but no `酒気増加量`) are NOT alcohol
 * and stay out. The registry is keyed by **item id** (itemnum) — the
 * `ALC_ID`/`BOOZE_MAP` name→id indirection folds away (the same id map is in
 * `brewing.ts::BREW_ITEM_ID`, shared with the extraction path).
 *
 * **Faithfully ported:**
 *   - `@DRUNKEN(C_ID, itemnum)` (ERB 2545-2580): per-alcohol 酒気増加量 from
 *     the data fn (alcohol-specific mults: 鬼×3 鬼杀酒, 酒耐性<=-1 甜酒,
 *     non-master mult 一夜奇稻田), then the **central** 酒耐性 multiplier
 *     (-1×1.2 / 1×0.9 / 2×0.75 / 3×0.5 / -2 tiers 2.0/1.5/1.0) — **skipped
 *     for 一夜奇稻田** (its mult is in the data fn instead) — then MASTER
 *     `÷(1+TFLAG:醒酒药)`, capped at `MAXBASE:酒気`.
 *   - `@ALCOHOL_TASTE(ARG)` (ERB 2634-2645): data-fn TASTE (per-chara, branches
 *     on 酒耐性/神霊/調合知識/薬毒耐性/教養/体型/幼児) + `TFLAG:口上特殊補正`.
 *   - `@EFFECT_酒データ{N}` (ERB 921-925 / 997-1001): 甜酒/药酒 flat RECOVER
 *     of master+target 体力/気力.
 *   - `@COM332_1` (ERB 101-206): DOWNBASE 気力+10, SOURCE 歓楽=500 + 従順
 *     ladder + 好感度 ladder, 受動/征服, TFLAG:193 ×0.10/1.00/2.00, 味補正
 *     (taste/10) final scale, taste<10 / taste>=15 arms (不會喝酒 counter +
 *     `@KIGEN_CHANGE(40,1)`), TFLAG:信頼度管理.
 *
 * **DEFERRED (documented; off in this slice):**
 *   - The COM332 handler owns the interactive picker and 说服 INPUT flow;
 *     this state module remains the deterministic alcohol calculation layer.
 *   - `PREVCOM == SELECTCOM` 反感=100 (no PREVCOM tracking).
 *   - 鬼 race (`CHECK_CHARA"鬼"`) — `isOni` returns false pending a race map;
 *     鬼杀酒's ×3 / TASTE=30 鬼 arms are structural-but-inert. 神霊/調合知識/
 *     薬毒耐性/体型/幼児 TALENT arms ARE faithful (plain TALENT reads).
 *   - `TFLAG:信頼度管理` consumer, `M_TFLAG:时间因子类型` — set-but-unconsumed.
 *   - The ~44 un-encoded `@酒データ{N}` terminals (same pattern; full import
 *     deferred). `酒造` brewing minigame, 醸造数/変化先, MAGIC_DLC arms.
 *   - `IS_DATING_WITH_PLAYER` / `AT_HOME` / `BATHCHECK` execCheck gates — no
 *     dating/ROOMDATA layer; documented in the handler.
 */

import type { CharaSlot, GameState } from "./game-state.js";
import {
  ABL_ID,
  BASE_ID,
  CFLAG_ID,
  SOURCE_ID,
  TCVAR_ID,
  TALENT_ID,
  recoverBase,
  times,
} from "./settlement.js";
import { kigenChange } from "./dish.js";
import { TFLAG_ID, getTflag, setTflag } from "./tflag.js";

/**
 * The eraBASIC `RAND` surface this module needs — a slice of
 * `CommandContext.rng` (`int(max)` → `RAND:max` ∈ [0, max)). Defined locally
 * (like `DishRng`/`GatherRng`) so `state/` does not depend on `command/`.
 * Structurally identical to `DishRng`, so `kigenChange` accepts it.
 */
export interface AlcoholRng {
  int(max: number): number;
}

// ---------------------------------------------------------------------------
// Registry — `@酒データ{N}` (drinkable terminals), keyed by item id
// ---------------------------------------------------------------------------

interface AlcoholEntry {
  /** `名前` (ITEMNAME). */
  name: string;
  /** `酒気増加量` data fn (alcohol-specific mults applied here). `charaNum`
   *  is the drinker (ARG); for 一夜奇稻田 the mult is non-master only. */
  sake: (state: GameState, charaNum: number, rng: AlcoholRng) => number;
  /** `TASTE` data fn (per-drinker; reads the drinker's TALENT/ABL). */
  taste: (state: GameState, charaNum: number) => number;
  /** `EFFECT_酒データ{N}` (甜酒/药酒 flat RECOVER master+target). Optional. */
  effect?: (state: GameState, charaNum: number) => void;
}

/** TALENT read helper (defaults 0). */
function talent(slot: CharaSlot | undefined, id: number): number {
  return slot?.state.TALENT[id] ?? 0;
}

/**
 * `CHECK_CHARA(ARG, "鬼")` — oni race check. **Deferred** (no race map
 * imported); always returns false. 鬼杀酒's ×3 酒気 / TASTE=30 鬼 arms are
 * structural-but-inert until a race layer lands. A non-鬼 drinker gets the
 * plain 300+RAND:100 / TASTE 5|12 path — faithful for a human trial chara.
 */
function isOni(_state: GameState, _charaNum: number): boolean {
  return false;
}

/** The drinker's slot (0 = master). */
function slotOf(state: GameState, charaNum: number): CharaSlot | undefined {
  return charaNum === 0 ? state.master : state.charas[charaNum];
}

/** 酒耐性 of the drinker (defaults 0). Most brewed TASTE ladders key off it. */
function tol(state: GameState, c: number): number {
  return talent(slotOf(state, c), TALENT_ID.酒耐性);
}

/** ABL:教養 of the drinker (defaults 0) — several 貴酿/白兰地 tastes +bonus at >=3. */
function eduAbl(state: GameState, c: number): number {
  return slotOf(state, c)?.state.ABL[ABL_ID.教養] ?? 0;
}

// `@酒データ51` 浊酒 (item 51). sake 300+RAND:100; TASTE 酒耐性>0→7 else 10.
// `@酒データ52` 清酒 (item 52). sake 400+RAND:300; TASTE 酒耐性<0→8 else 15.
// `@酒データ53` 鬼杀酒 (item 53). sake 300+RAND:100 (鬼×3); TASTE 鬼→30 /
//   酒耐性<=0→5 / else 12.
// `@酒データ54` 红酒 (item 54). sake 200+RAND:300; TASTE 酒耐性<0→7 else 10.
// `@酒データ55` 神酒 (item 55). sake 300+RAND:600; TASTE 神霊→30 /
//   酒耐性>0→7 / 酒耐性<0→8 / else 10.
// `@酒データ56` 甜酒 (item 56). sake 1 (酒耐性<=-1→20+RAND:30); TASTE
//   体型<=-1||幼児／幼児退行||幼稚→15 / 酒耐性>0→9 / else 10; EFFECT flat RECOVER.
// `@酒データ58` 蒸馏酒 (item 58). sake 700+RAND:200; TASTE 酒耐性<0→3 /
//   <2→9 / else 20.
// `@酒データ59` 药酒 (item 59). sake 200+RAND:300; TASTE 調合知識||薬毒耐性||
//   教養>=3→20 / 酒耐性<0→7 / else 9; EFFECT flat RECOVER.
// `@酒データ50` 一夜奇稻田 (item 513). sake 500+RAND:200 (non-master: 酒耐性
//   -1×1.1 / 1×1.2 / 2×1.7 / 3×2.5 / -2 tiers); TASTE 酒耐性<0→8 else 25.
const ALCOHOL: Record<number, AlcoholEntry> = {
  51: {
    name: "浊酒",
    sake: (_s, _c, rng) => 300 + rng.int(100),
    taste: (s, c) => (talent(slotOf(s, c), TALENT_ID.酒耐性) > 0 ? 7 : 10),
  },
  52: {
    name: "清酒",
    sake: (_s, _c, rng) => 400 + rng.int(300),
    taste: (s, c) => (talent(slotOf(s, c), TALENT_ID.酒耐性) < 0 ? 8 : 15),
  },
  53: {
    name: "鬼杀酒",
    sake: (s, c, rng) => {
      const base = 300 + rng.int(100);
      return isOni(s, c) ? base * 3 : base;
    },
    taste: (s, c) => {
      if (isOni(s, c)) return 30;
      return talent(slotOf(s, c), TALENT_ID.酒耐性) <= 0 ? 5 : 12;
    },
  },
  54: {
    name: "红酒",
    sake: (_s, _c, rng) => 200 + rng.int(300),
    taste: (s, c) => (talent(slotOf(s, c), TALENT_ID.酒耐性) < 0 ? 7 : 10),
  },
  55: {
    name: "神酒",
    sake: (_s, _c, rng) => 300 + rng.int(600),
    taste: (s, c) => {
      const t = slotOf(s, c);
      if (talent(t, TALENT_ID.神霊)) return 30;
      if (talent(t, TALENT_ID.酒耐性) > 0) return 7;
      if (talent(t, TALENT_ID.酒耐性) < 0) return 8;
      return 10;
    },
  },
  56: {
    name: "甜酒",
    sake: (s, c, rng) => {
      const t = slotOf(s, c);
      return talent(t, TALENT_ID.酒耐性) <= -1 ? 20 + rng.int(30) : 1;
    },
    taste: (s, c) => {
      const t = slotOf(s, c);
      if (
        talent(t, TALENT_ID.体型) <= -1 ||
        talent(t, TALENT_ID["幼児／幼児退行"]) ||
        talent(t, TALENT_ID.幼稚)
      )
        return 15;
      return talent(t, TALENT_ID.酒耐性) > 0 ? 9 : 10;
    },
    effect: (s, c) => {
      // @EFFECT_酒データ56 — RECOVER master+ARG 体力50 / 気力80.
      recoverBase(s.master, BASE_ID.体力, 50);
      recoverBase(s.master, BASE_ID.気力, 80);
      const t = slotOf(s, c);
      if (t) {
        recoverBase(t, BASE_ID.体力, 50);
        recoverBase(t, BASE_ID.気力, 80);
      }
    },
  },
  58: {
    name: "蒸馏酒",
    sake: (_s, _c, rng) => 700 + rng.int(200),
    taste: (s, c) => {
      const tol = talent(slotOf(s, c), TALENT_ID.酒耐性);
      if (tol < 0) return 3;
      if (tol < 2) return 9;
      return 20;
    },
  },
  59: {
    name: "药酒",
    sake: (_s, _c, rng) => 200 + rng.int(300),
    taste: (s, c) => {
      const t = slotOf(s, c);
      if (
        talent(t, TALENT_ID.調合知識) ||
        talent(t, TALENT_ID.薬毒耐性) ||
        (t?.state.ABL[ABL_ID.教養] ?? 0) >= 3
      )
        return 20;
      if (talent(t, TALENT_ID.酒耐性) < 0) return 7;
      return 9;
    },
    effect: (s, c) => {
      // @EFFECT_酒データ59 — RECOVER master+ARG 体力150 / 気力200.
      recoverBase(s.master, BASE_ID.体力, 150);
      recoverBase(s.master, BASE_ID.気力, 200);
      const t = slotOf(s, c);
      if (t) {
        recoverBase(t, BASE_ID.体力, 150);
        recoverBase(t, BASE_ID.気力, 200);
      }
    },
  },
  513: {
    name: "一夜奇稻田",
    sake: (s, c, rng) => {
      // @酒データ50 — base 500+RAND:200; non-master mult inside the data fn.
      let local = 500 + rng.int(200);
      if (c !== 0) {
        const t = slotOf(s, c);
        const tol = talent(t, TALENT_ID.酒耐性);
        const wontDrink = t?.state.CFLAG[CFLAG_ID.不會喝酒] ?? 0;
        if (tol === -1) local = times(local, 1.1);
        else if (tol === 1) local = times(local, 1.2);
        else if (tol === 2) local = times(local, 1.7);
        else if (tol === 3) local = times(local, 2.5);
        else if (tol === -2) {
          if (wontDrink >= 5) local = times(local, 2.0);
          else if (wontDrink >= 2) local = times(local, 1.5);
          // else ×1.0
        }
      }
      return local;
    },
    taste: (s, c) => (talent(slotOf(s, c), TALENT_ID.酒耐性) < 0 ? 8 : 25),
  },

  // -- FARM-BREW B4: the 酒造パッチ brewed terminals (酒データ49/61-100, item
  //    ids 560-592). 醸造 produces these; adding them here lets COMF332 serve
  //    them. sake = 酒気増加量, taste = TASTE ladder (酒耐性/教養/採集Lv/神霊).
  //    夢美 (草莓酒/草莓白兰地) is a chara-specific TASTE arm — deferred (obscure
  //    chara, likely unbundled); the non-夢美 ladder is faithful otherwise. --
  560: { name: "烧酒", sake: (_s, _c, r) => 700 + r.int(300), taste: (s, c) => (tol(s, c) < 0 ? 2 : tol(s, c) < 2 ? 8 : 22) },
  561: { name: "蜂蜜酒", sake: (_s, _c, r) => 200 + r.int(200), taste: (s, c) => (tol(s, c) > 1 ? 7 : tol(s, c) < 0 ? 10 : 20) },
  562: { name: "果酒", sake: (_s, _c, r) => 200 + r.int(200), taste: (s, c) => (tol(s, c) > 1 ? 8 : tol(s, c) < 0 ? 9 : 20) },
  563: { name: "莓子酒", sake: (_s, _c, r) => 900 + r.int(300), taste: (s, c) => (tol(s, c) < 1 ? 1 : tol(s, c) < 2 ? 6 : tol(s, c) < 3 ? 20 : 25) },
  564: { name: "白朗姆酒", sake: (_s, _c, r) => 900 + r.int(300), taste: (s, c) => (tol(s, c) < 1 ? 3 : tol(s, c) < 2 ? 10 : tol(s, c) < 3 ? 20 : 22) },
  565: { name: "金朗姆酒", sake: (_s, _c, r) => 900 + r.int(300), taste: (s, c) => (tol(s, c) < 1 ? 3 : tol(s, c) < 2 ? 10 : tol(s, c) < 3 ? 22 : 25) },
  566: { name: "黑朗姆酒", sake: (_s, _c, r) => 900 + r.int(300), taste: (s, c) => (tol(s, c) < 1 ? 1 : tol(s, c) < 2 ? 6 : tol(s, c) < 3 ? 25 : 30) },
  567: { name: "强化红酒", sake: (_s, _c, r) => 400 + r.int(300), taste: (s, c) => (tol(s, c) < 0 ? 10 : tol(s, c) < 3 ? 20 : 15) },
  568: { name: "贵腐红酒", sake: (_s, _c, r) => 400 + r.int(300), taste: (s, c) => (eduAbl(s, c) >= 3 ? 25 : tol(s, c) < -1 ? 10 : tol(s, c) < 0 ? 15 : tol(s, c) < 3 ? 25 : 20) },
  569: { name: "陈酿红酒", sake: (_s, _c, r) => 200 + r.int(300), taste: (s, c) => (tol(s, c) < 0 ? 8 : 15) },
  570: { name: "优质陈酿红酒", sake: (_s, _c, r) => 200 + r.int(300), taste: (s, c) => (eduAbl(s, c) >= 3 ? 25 : tol(s, c) < 0 ? 9 : 15) },
  571: { name: "白兰地VS", sake: (_s, _c, r) => 900 + r.int(300), taste: (s, c) => (tol(s, c) < 1 ? 1 : tol(s, c) < 2 ? 6 : tol(s, c) < 3 ? 18 : 22) },
  572: { name: "白兰地VSOP", sake: (_s, _c, r) => 900 + r.int(300), taste: (s, c) => (tol(s, c) < 1 ? 2 : tol(s, c) < 2 ? 8 : tol(s, c) < 3 ? 20 : 25) },
  573: { name: "白兰地XO", sake: (_s, _c, r) => 900 + r.int(300), taste: (s, c) => (eduAbl(s, c) >= 3 ? 30 : tol(s, c) < 1 ? 3 : tol(s, c) < 2 ? 10 : tol(s, c) < 3 ? 20 : 25) },
  574: { name: "灰持酒", sake: (_s, _c, r) => 300 + r.int(400), taste: (s, c) => (talent(slotOf(s, c), TALENT_ID.神霊) ? 20 : tol(s, c) < 0 ? 10 : tol(s, c) < 2 ? 15 : 8) },
  575: { name: "果渣白兰地", sake: (_s, _c, r) => 900 + r.int(300), taste: (s, c) => (tol(s, c) < 1 ? 1 : tol(s, c) < 2 ? 6 : tol(s, c) < 3 ? 18 : 22) },
  577: { name: "云浊酒", sake: (_s, _c, r) => 400 + r.int(200), taste: (s, c) => (tol(s, c) < 0 ? 12 : tol(s, c) < 3 ? 17 : 10) },
  578: { name: "吟酿酒", sake: (_s, _c, r) => 500 + r.int(100), taste: (s, c) => (tol(s, c) < 0 ? 9 : tol(s, c) < 4 ? 17 : 12) },
  579: { name: "熟成酒", sake: (_s, _c, r) => 450 + r.int(100), taste: (s, c) => (tol(s, c) < 0 ? 9 : tol(s, c) < 2 ? 15 : tol(s, c) < 4 ? 20 : 15) },
  580: { name: "古酒", sake: (_s, _c, r) => 400 + r.int(100), taste: (s, c) => (tol(s, c) < 0 ? 10 : tol(s, c) < 2 ? 12 : tol(s, c) < 4 ? 25 : 20) },
  581: { name: "酒粕烧酒", sake: (_s, _c, r) => 700 + r.int(200), taste: (s, c) => (tol(s, c) < 0 ? 3 : tol(s, c) < 1 ? 10 : tol(s, c) < 2 ? 12 : 20) },
  582: { name: "贵酿云浊酒", sake: (_s, _c, r) => 400 + r.int(300), taste: (s, c) => (tol(s, c) < 0 ? 17 : tol(s, c) < 3 ? 25 : 8) + (eduAbl(s, c) >= 3 ? 5 : 0) },
  583: { name: "贵酿酒", sake: (_s, _c, r) => 500 + r.int(200), taste: (s, c) => (tol(s, c) < 0 ? 12 : tol(s, c) < 4 ? 25 : 10) + (eduAbl(s, c) >= 3 ? 5 : 0) },
  584: { name: "贵酿熟成酒", sake: (_s, _c, r) => 450 + r.int(200), taste: (s, c) => (tol(s, c) < 0 ? 12 : tol(s, c) < 1 ? 20 : tol(s, c) < 4 ? 25 : 15) + (eduAbl(s, c) >= 3 ? 7 : 0) },
  585: { name: "贵酿古酒", sake: (_s, _c, r) => 400 + r.int(200), taste: (s, c) => (tol(s, c) < 0 ? 12 : tol(s, c) < 1 ? 20 : tol(s, c) < 4 ? 25 : 17) + (eduAbl(s, c) >= 3 ? 10 : 0) },
  586: { name: "三增酒", sake: (_s, _c, r) => 300 + r.int(500), taste: (s, c) => (tol(s, c) < 1 ? 5 : tol(s, c) < 3 ? 8 : 10) },
  587: { name: "草莓酒", sake: (_s, _c, r) => 200 + r.int(100), taste: (s, c) => (tol(s, c) > 1 ? 6 : tol(s, c) < 0 ? 14 : 18) },
  588: { name: "草莓白兰地", sake: (_s, _c, r) => 900 + r.int(300), taste: (s, c) => (tol(s, c) < 1 ? 2 : tol(s, c) < 2 ? 8 : tol(s, c) < 3 ? 20 : 21) },
  589: { name: "木通果酒", sake: (_s, _c, r) => 200 + r.int(100), taste: (s, c) => (talent(slotOf(s, c), TALENT_ID.採集Lv) >= 3 ? 25 : tol(s, c) > 1 ? 8 : tol(s, c) < 0 ? 9 : 18) },
  590: { name: "西瓜家酿酒", sake: (_s, _c, r) => 100 + r.int(100), taste: (s, c) => (tol(s, c) > 1 ? 4 : tol(s, c) < 0 ? 15 : 12) },
  591: { name: "南瓜烧酒", sake: (_s, _c, r) => 600 + r.int(300), taste: (s, c) => (tol(s, c) < 0 ? 2 : tol(s, c) < 2 ? 8 : 21) },
  592: { name: "苦艾酒", sake: (_s, _c, r) => 1100 + r.int(200), taste: (s, c) => (tol(s, c) < 2 ? 1 : tol(s, c) < 3 ? 4 : 25) },
  // 酒データ102 啤酒 (item 593) — typo-fixed drinkable terminal (see brewing.ts).
  593: { name: "啤酒", sake: (_s, _c, r) => 200 + r.int(200), taste: (s, c) => (tol(s, c) > 0 ? 9 : 15) },
};

/** `IS_ALC(itemnum)` — is this item id a drinkable alcohol? */
export function isAlcohol(itemId: number): boolean {
  return itemId in ALCOHOL;
}

/** `ALC_NAME` — the alcohol's display name (ITEMNAME). */
export function alcoholName(itemId: number): string {
  return ALCOHOL[itemId]?.name ?? "";
}

/** Return every drinkable alcohol currently available, in stable item order. */
export function drinkableAlcoholIds(state: GameState): number[] {
  const items = state.items;
  if (!items) return [];
  return Object.keys(items)
    .map(Number)
    .filter((id) => isAlcohol(id) && (items[id] ?? 0) >= 1)
    .sort((a, b) => a - b);
}

/**
 * Compatibility helper for callers that only need the first available item.
 * COM332 now exposes the full `drinkableAlcoholIds` list through its prompt.
 */
export function firstDrinkableAlcohol(state: GameState): number | null {
  return drinkableAlcoholIds(state)[0] ?? null;
}

// ---------------------------------------------------------------------------
// `@DRUNKEN(C_ID, itemnum)` (ERB 2545-2580)
// ---------------------------------------------------------------------------

/**
 * The alcohol's 酒気増加量 from its data fn (`GETMETH_INT(C_ID, "酒データ",
 * 酒ID, "酒気増加量")`), with alcohol-specific mults applied (鬼×3 鬼杀酒,
 * 酒耐性<=-1 甜酒, non-master mult 一夜奇稻田). The **central** 酒耐性
 * multiplier is NOT applied here — that is `drunken`'s job (and is skipped
 * for 一夜奇稻田, whose mult lives in this data fn instead).
 */
export function sakeIncrease(
  state: GameState,
  charaNum: number,
  itemId: number,
  rng: AlcoholRng,
): number {
  const entry = ALCOHOL[itemId];
  if (!entry) return 0;
  return entry.sake(state, charaNum, rng);
}

/**
 * `@DRUNKEN(C_ID, itemnum)` (ERB 2545-2580). Raises `BASE:酒気` by the
 * alcohol's 酒気増加量 (data-fn value), applies the **central** 酒耐性
 * multiplier (skipped for 一夜奇稻田 — its mult is in the data fn), divides
 * the MASTER's gain by `(1 + TFLAG:醒酒药)`, and caps at `MAXBASE:酒気`.
 * Mutates `state` in place.
 */
export function drunken(
  state: GameState,
  charaNum: number,
  itemId: number,
  rng: AlcoholRng,
): void {
  const slot = slotOf(state, charaNum);
  if (!slot) return;
  let gain = sakeIncrease(state, charaNum, itemId, rng);

  // Central 酒耐性 mult — skipped for 一夜奇稻田 (ERB 2559).
  if (alcoholName(itemId) !== "一夜奇稻田") {
    const tol = talent(slot, TALENT_ID.酒耐性);
    if (tol === -1) gain = times(gain, 1.2);
    else if (tol === 1) gain = times(gain, 0.9);
    else if (tol === 2) gain = times(gain, 0.75);
    else if (tol === 3) gain = times(gain, 0.5);
    else if (tol === -2) {
      const wontDrink = slot.state.CFLAG[CFLAG_ID.不會喝酒] ?? 0;
      if (wontDrink >= 5) gain = times(gain, 2.0);
      else if (wontDrink >= 2) gain = times(gain, 1.5);
      // else ×1.0
    }
  }

  // MASTER only: ÷(1 + TFLAG:醒酒药) (ERB 2578-2579).
  if (charaNum === 0) {
    const sober = getTflag(state, TFLAG_ID.醒酒药);
    gain = Math.trunc(gain / (1 + sober));
  }

  const max = slot.state.MAXBASE[BASE_ID.酒気] ?? 0;
  const cur = slot.state.BASE[BASE_ID.酒気] ?? 0;
  // ERA `MIN(BASE+gain, MAXBASE)` — if MAXBASE unset/0, still add (no ceiling);
  // matches the ERB which only caps when MAXBASE is a real ceiling. To be safe
  // and faithful (MAXBASE:酒気 is a real stat), cap only when max>0.
  slot.state.BASE[BASE_ID.酒気] = max > 0 ? Math.min(max, cur + gain) : cur + gain;
}

export interface DrunkennessTransition {
  charaNum: number;
  kind: "became-drunk" | "recovered";
}

/**
 * Mirror `@CHARA_ACTION_DRUNK` for NPCs. `BASE:酒気` is the continuously
 * visible gauge; `TCVAR:泥酔` is the gameplay lock used by movement and
 * command gates. Keeping the two in sync is what makes crossing the 80%
 * threshold actually affect the next turn, and lets the 40% recovery branch
 * release the character again.
 */
export function syncDrunkenness(
  state: GameState,
  charaNum?: number,
): DrunkennessTransition[] {
  const slots = charaNum === undefined
    ? Object.values(state.charas)
    : state.charas[charaNum]
      ? [state.charas[charaNum]!]
    : [];
  const transitions: DrunkennessTransition[] = [];
  for (const slot of slots) {
    const max = slot.state.MAXBASE[BASE_ID.酒気] ?? 0;
    const current = slot.state.BASE[BASE_ID.酒気] ?? 0;
    const drunk = (slot.state.TCVAR[TCVAR_ID.泥酔] ?? 0) !== 0;
    if (!drunk && current > Math.trunc(max / 10) * 8) {
      slot.state.TCVAR[TCVAR_ID.泥酔] = 1;
      if (talent(slot, TALENT_ID.酒耐性) === -2) {
        const wontDrink = slot.state.CFLAG[CFLAG_ID.不會喝酒] ?? 0;
        slot.state.CFLAG[CFLAG_ID.不會喝酒] = wontDrink - 3;
      }
      transitions.push({ charaNum: slot.charaNum, kind: "became-drunk" });
    } else if (
      drunk &&
      current < Math.trunc(max / 10) * 4 &&
      (slot.state.CFLAG[CFLAG_ID.诶嘿嘿] ?? 0) === 0
    ) {
      slot.state.TCVAR[TCVAR_ID.泥酔] = 0;
      transitions.push({ charaNum: slot.charaNum, kind: "recovered" });
    }
  }
  return transitions;
}

// ---------------------------------------------------------------------------
// `@ALCOHOL_TASTE(ARG)` (ERB 2634-2645) + `@CAN_DRINK` (2624-2632)
// ---------------------------------------------------------------------------

/**
 * `@ALCOHOL_TASTE(ARG)` — the alcohol's TASTE value for the TARGET (the
 * drinker), = data-fn TASTE + `TFLAG:口上特殊補正`. `ARG` is TARGET in the
 * ERB (the served chara). Returns 0 for a non-alcohol item.
 */
export function alcoholTaste(
  state: GameState,
  charaNum: number,
  itemId: number,
): number {
  const entry = ALCOHOL[itemId];
  if (!entry) return 0;
  const taste = entry.taste(state, charaNum);
  return taste + getTflag(state, TFLAG_ID.口上特殊補正);
}

/**
 * `@IS_DRUNK(CHARA)` (COMMON.ERB 1392-1404): return 0 for sober, 1 for
 * tipsy, 2 for drunk, and 3 for wasted. The thresholds intentionally read
 * the live BASE/MAXBASE pair instead of persisting a derived status.
 */
export function alcoholIntoxication(state: GameState, charaNum: number): number {
  const slot = slotOf(state, charaNum);
  if (!slot) return 0;
  const current = slot.state.BASE[BASE_ID.酒気] ?? 0;
  if (current <= 2) return 0;
  const max = slot.state.MAXBASE[BASE_ID.酒気] ?? 0;
  if (current > Math.trunc(max / 10) * 8) return 3;
  if (current > Math.trunc(max / 10) * 5) return 2;
  return 1;
}

/** `@ALCOHOL_FACE(ARG)` (COMMON.ERB 1376-1389). */
export function alcoholFace(state: GameState, charaNum: number): "清醒" | "微醺" | "醉酒" | "不省人事" {
  switch (alcoholIntoxication(state, charaNum)) {
    case 1:
      return "微醺";
    case 2:
      return "醉酒";
    case 3:
      return "不省人事";
    default:
      return "清醒";
  }
}

/**
 * `@CAN_DRINK(ARG)` (ERB 2624-2632): a 下戸 (酒耐性==-2) cannot drink, nor
 * can a chara already `>= 2/3` drunk. (The COM332 handler reaches this only
 * on the non-refusal path; the 酒気>2/3 case is also a handler refusal arm.)
 */
export function canDrink(state: GameState, charaNum: number): boolean {
  const slot = slotOf(state, charaNum);
  if (!slot) return false;
  if (talent(slot, TALENT_ID.酒耐性) === -2) return false;
  const max = slot.state.MAXBASE[BASE_ID.酒気] ?? 0;
  const cur = slot.state.BASE[BASE_ID.酒気] ?? 0;
  if (max > 0 && cur >= Math.trunc((max * 2) / 3)) return false;
  return true;
}

/**
 * `TRYCALLFORM EFFECT_酒データ{酒ID}(TARGET)` (ERB 87). Runs the alcohol's
 * EFFECT arm (甜酒/药酒 flat RECOVER of master+target) if it has one.
 */
export function applyAlcoholEffect(
  state: GameState,
  charaNum: number,
  itemId: number,
): void {
  ALCOHOL[itemId]?.effect?.(state, charaNum);
}

// ---------------------------------------------------------------------------
// `@COM332_1` SOURCE assembly (ERB 101-206)
// ---------------------------------------------------------------------------

/** 従順→歓楽 ladder (ERB 116-128). */
function juujunPleasure(juujun: number): number {
  if (juujun <= 1) return juujun * 30;
  if (juujun <= 3) return 400 + juujun * 30;
  if (juujun <= 5) return 600 + juujun * 30;
  if (juujun <= 8) return 800 + juujun * 50;
  if (juujun <= 11) return 1000 + juujun * 70;
  return 1500 + juujun * 40;
}

/** 好感度→歓楽 ladder (ERB 131-137). CFLAG:2 = 好感度. */
function favorPleasure(favor: number): number {
  if (favor <= 500) return favor;
  if (favor <= 5000) return 700 + Math.trunc((favor - 500) / 3);
  return 2500 + Math.trunc((favor - 5000) / 5);
}

export interface DrinkSources {
  /** SOURCE map (歓楽/受動/征服). */
  readonly sources: Record<number, number>;
  /** The alcohol's TASTE value (post-口上特殊補正) for the served chara. */
  readonly taste: number;
  /** `TFLAG:信頼度管理` value (= taste/10, or -1 on the taste<10 下戸 arm). */
  readonly trust: number;
  /** `TFLAG:好感度减少` favorBias to pass `applySourceCheck` (0 on success). */
  readonly favorBias: number;
}

/**
 * `@COM332_1` SOURCE assembly (ERB 101-206). **Caller must have already run
 * `drunken(TARGET, …)`** (ERB 109) — this fn does not. Computes the SOURCE
 * set (歓楽/受動/征服, scaled by TFLAG:193 then 味補正/10), sets
 * `TFLAG:信頼度管理`, and runs the taste<10 / taste>=15 arms (不會喝酒
 * counter + `@KIGEN_CHANGE(40,1)`). Mutates `state` (the served chara's
 * TALENT:心情 + CFLAG:不會喝酒 + flagStore).
 *
 * `tflag193` is read from `flagStore` (ERB sets it 0 at COM332:24, then the
 * 说服 arm may set 1). The 下戸 taste correction at ERB 160-170 is applied
 * before the SOURCE scaling so persuaded drinkers still follow upstream.
 */
export function computeDrinkSources(
  state: GameState,
  charaNum: number,
  itemId: number,
  rng: AlcoholRng,
): DrinkSources {
  const slot = slotOf(state, charaNum);
  if (!slot) return { sources: {}, taste: 0, trust: 0, favorBias: 0 };

  // DOWNBASE:気力 += 10 (ERB 104).
  const will = slot.state.BASE[BASE_ID.気力] ?? 0;
  slot.state.BASE[BASE_ID.気力] = Math.max(0, will - 10);

  const juujun = slot.state.ABL[ABL_ID.従順] ?? 0;
  const favor = slot.state.CFLAG[CFLAG_ID.好感度] ?? 0;
  const sadism = slot.state.ABL[ABL_ID.施虐属性] ?? 0;

  // SOURCE:歓楽 = 500 + 従順 ladder + 好感度 ladder (ERB 107-139).
  let karaku = 500 + juujunPleasure(juujun) + favorPleasure(favor);
  if (karaku < 0) karaku = 0;

  let judou = 200 + 100 * juujun; // 受動 (ERB 141)
  let seifuku = 200 + 100 * sadism; // 征服 (ERB 142)

  // TFLAG:193 multiplier (ERB 144-156): 歓楽 ×0.10 / 征服·受動 ×0.50 on -1;
  // ×1.00 on 0; ×2.00 on else (the 说服-success =1 case). MVP: 193==0 → ×1.
  // (193 is a per-command transient; read raw — no named enum, defaults 0.)
  const tflag193 = getTflag(state, TFLAG_ID.SELECTCOM的分岐);
  if (tflag193 === -1) {
    karaku = times(karaku, 0.1);
    seifuku = times(seifuku, 0.5);
    judou = times(judou, 0.5);
  } else if (tflag193 === 0) {
    // ×1.00 — no-op.
  } else {
    karaku = times(karaku, 2);
    seifuku = times(seifuku, 2);
    judou = times(judou, 2);
  }

  // 味補正 = ALCOHOL_TASTE (ERB 159-170). 下戸 who has been persuaded still
  // gets the upstream small-sip correction; the counter value is read after
  // the persuasion success increment from COM332.
  let taste = alcoholTaste(state, charaNum, itemId);
  if (talent(slot, TALENT_ID.酒耐性) === -2 && taste < 15) {
    const wontDrink = slot.state.CFLAG[CFLAG_ID.不會喝酒] ?? 0;
    if (wontDrink < 3) taste = Math.trunc(taste / 2);
    else if (wontDrink < 5) taste = Math.trunc(taste / 3) * 2;
  }

  // SOURCE *= 味補正/10 (ERB 172-174, int division).
  karaku = Math.trunc((karaku * taste) / 10);
  seifuku = Math.trunc((seifuku * taste) / 10);
  judou = Math.trunc((judou * taste) / 10);

  // TFLAG:信頼度管理 = taste/10 (ERB 177).
  let trust = Math.trunc(taste / 10);
  let favorBias = 0;

  // taste<10 arm (ERB 179-185): 下戸 (酒耐性==-2) → 不會喝酒--, 好感度减少=1,
  //   信頼度管理=-1. Dead for non-下戸 (the ERB gates on 酒耐性==-2). For a
  //   non-下戸 drinker with taste<10 (e.g. 鬼杀酒 TASTE=5) only the flavor
  //   text fires — no counter change. We model the 下戸 sub-arm faithfully
  //   (it is reachable if a -2 chara ever reaches here via future 说服).
  if (taste < 10) {
    if (talent(slot, TALENT_ID.酒耐性) === -2) {
      const w = slot.state.CFLAG[CFLAG_ID.不會喝酒] ?? 0;
      slot.state.CFLAG[CFLAG_ID.不會喝酒] = w - 1;
      setTflag(state, TFLAG_ID.好感度减少, 1);
      trust = -1;
      favorBias = 1; // TFLAG:好感度减少 → applySourceCheck favorBias
    }
  } else if (taste >= 15) {
    // taste>=15 arm (ERB 186-206): 不會喝酒<5 → ++, KIGEN_CHANGE(40,1).
    //   (513 一夜奇稻田 special text — flavor only, no mechanical difference.)
    const w = slot.state.CFLAG[CFLAG_ID.不會喝酒] ?? 0;
    if (w < 5) slot.state.CFLAG[CFLAG_ID.不會喝酒] = w + 1;
    kigenChange(slot, 40, 1, rng);
  }

  const sources: Record<number, number> = {};
  if (karaku) sources[SOURCE_ID.歓楽] = karaku;
  if (judou) sources[SOURCE_ID.受動] = judou;
  if (seifuku) sources[SOURCE_ID.征服] = seifuku;

  return { sources, taste, trust, favorBias };
}
