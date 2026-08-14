import { createRng } from "../command/rng.js";
import type {
  DynamicCharacterPortrait,
  GameState,
} from "../state/game-state.js";

const FRONT_HAIR = [
  "お嬢様",
  "ぱっつん",
  "ウェーブ",
  "クセ毛",
  "ナチュラル",
  "ワイルド",
  "中分け1",
  "中分け2",
  "横分け",
  "無造作",
] as const;

const BACK_HAIR = [
  "ウェーブショート",
  "ウェーブセミロング",
  "ウェーブロング",
  "サイドテール",
  "ショート",
  "セミロング",
  "ツインテール(短)",
  "ツインテール(長)",
  "ツインドリル",
  "ボブカット",
  "ポニーテール",
  "ロング",
  "三つ編み",
  "無造作",
] as const;

const EYE_TYPES = ["普通な目", "だる目", "ワル目", "丸釣り目", "垂れ目", "釣り目"] as const;

type PortraitExpression = keyof Pick<DynamicCharacterPortrait, "normal" | "smile" | "angry">;

interface RaceRecipe {
  cloth: string;
  /** Some upstream race outfits only define a CN15 skin/body layer; keep a
   * generic CN12 cloth layer underneath the race-specific accessories. */
  skin?: string;
  accessories?: readonly string[];
  poses?: readonly number[];
  eyeTypes?: readonly string[];
  backHair?: readonly string[];
}

const RACE_RECIPES: Readonly<Record<string, RaceRecipe>> = {
  // The modern generator uses the Chinese display name, while the upstream
  // resource branch is named 因幡. Keep both aliases on the same recipe.
  因幡: { cloth: "灯笼裤", accessories: ["CN01_他_装飾_兔耳"], backHair: BACK_HAIR },
  售货员: { cloth: "灯笼裤", accessories: ["CN01_他_装飾_兔耳"], backHair: BACK_HAIR },
  妖精: { cloth: "妖精服", accessories: ["CN18_他_装飾_妖精の羽"] },
  女仆妖精: { cloth: "女僕服", accessories: ["CN18_他_装飾_妖精の羽", "CN01_他_装飾_女僕髮箍"] },
  僵尸妖精: { cloth: "ゴスロリ", accessories: ["CN18_他_装飾_妖精の羽"] },
  兔女郎妖精: { cloth: "下着", accessories: ["CN01_他_装飾_兔耳", "CN01_他_装飾_バニープリム"], backHair: BACK_HAIR },
  河童: { cloth: "私服A", skin: "河童服(色固定)", accessories: ["CN18_他_装飾_河童帽子"] },
  死库水河童: { cloth: "死库水", accessories: ["CN18_他_装飾_河童帽子", "CN01_乗_装飾_照れ"] },
  山童: { cloth: "私服A", skin: "山童服(色固定)", accessories: ["CN01_他_装飾_山童帽子"], poses: [1, 3] },
  白狼天狗: { cloth: "私服A", skin: "白狼天狗服(色固定)", accessories: ["CN18_耳_装飾_獣耳(耳)", "CN18_尾_装飾_獣尾巴(尾)", "CN18_他_装飾_白浪天狗帽子"] },
  鴉天狗: { cloth: "私服A", skin: "天狗服(色固定)", accessories: ["CN18_他_装飾_天狗帽子", "CN18_他_装飾_黒い羽根"] },
  鸦天狗: { cloth: "私服A", skin: "天狗服(色固定)", accessories: ["CN18_他_装飾_天狗帽子", "CN18_他_装飾_黒い羽根"] },
  玉兎: { cloth: "私服A", skin: "玉兎服(色固定)", accessories: ["CN01_他_装飾_玉兎ヘルメット"], backHair: ["ウェーブショート", "ウェーブセミロング", "ショート", "セミロング", "三つ編み"] },
  妖怪狸: { cloth: "和服", accessories: ["CN18_他_装飾_狸猫耳", "CN18_他_装飾_狸猫尾巴", "CN18_他_装飾_狸猫叶子"], eyeTypes: ["だる目", "ワル目"] },
  妖怪狐: { cloth: "和服", accessories: ["CN18_他_装飾_狐耳", "CN18_他_装飾_狐尾巴"] },
  妖怪猫: { cloth: "私服D", accessories: ["CN18_耳_装飾_ネコ耳(耳)", "CN18_他_装飾_猫尾"] },
  鬼: { cloth: "和服", accessories: ["CN18_他_装飾_鬼の角"] },
  尼: { cloth: "和服", accessories: ["CN01_他_装飾_尼頭巾"], backHair: ["ショート"] },
  玉兔: { cloth: "玉兎服(色固定)", accessories: ["CN01_他_装飾_玉兎ヘルメット"], backHair: ["ウェーブショート", "ウェーブセミロング", "ショート", "セミロング", "三つ編み"] },
};

function speciesKey(species: string): string {
  return species === "销售员" ? "售货员" : species;
}

function recipeForSpecies(species: string): RaceRecipe {
  return RACE_RECIPES[speciesKey(species)] ?? { cloth: "私服A" };
}

function suffixForExpression(expression: PortraitExpression, eyeType: string): string {
  if (expression === "smile") return "CN02_瞳_目瞳_閉じ目2";
  return `CN02_瞳_目瞳_${eyeType}${expression === "angry" ? "2" : "1"}`;
}

function layersFor(
  recipe: RaceRecipe,
  pose: number,
  frontHair: string,
  backHair: string,
  eyeType: string,
  expression: PortraitExpression,
  accessories: readonly string[],
): string[] {
  const mouth = expression === "angry"
    ? "CN04_無_表情_憤怒(口開き)"
    : expression === "smile"
      ? "CN04_無_表情_笑い(口開き)"
      : "CN04_無_表情_笑い(口閉じ)";
  const layers = [
    `CN15_肌_身体_${recipe.skin ?? recipe.cloth}${pose}`,
    `CN12_服_身体_${recipe.cloth}${pose}`,
    `CN17_髪_後髪_${backHair}`,
    "CN09_肌_頭部_普通な顔",
    `CN06_髪_前髪_${frontHair}`,
    suffixForExpression(expression, eyeType),
    mouth,
    ...accessories,
  ];
  if (expression === "angry") layers.push("CN01_他_装飾_マーク(憤怒)");
  return layers;
}

/** Deterministic counterpart of upstream `SET_MOB_IMAGE_STR` selection. */
export function generateMobPortrait(seed: number, species: string): DynamicCharacterPortrait {
  const rng = createRng(seed ^ 0x4d4f4250);
  const recipe = recipeForSpecies(species);
  const pose = rng.pick(recipe.poses ?? [1, 2, 3]);
  const frontHair = rng.pick(FRONT_HAIR);
  const backHair = rng.pick(recipe.backHair ?? BACK_HAIR);
  const eyeType = rng.pick(recipe.eyeTypes ?? EYE_TYPES);
  const accessories = recipe.accessories ?? [];
  return {
    template: "upstream-mob",
    normal: layersFor(recipe, pose, frontHair, backHair, eyeType, "normal", accessories),
    smile: layersFor(recipe, pose, frontHair, backHair, eyeType, "smile", accessories),
    angry: layersFor(recipe, pose, frontHair, backHair, eyeType, "angry", accessories),
  };
}

/** Read a persisted recipe, deriving one for old saves that predate portraits. */
export function portraitForDynamicCharacter(
  state: Readonly<GameState>,
  charaNum: number,
): DynamicCharacterPortrait | undefined {
  const meta = state.dynamicCharacters?.[charaNum];
  if (!meta || meta.origin !== "generated") return undefined;
  return meta.portrait ?? generateMobPortrait(meta.seed, meta.species);
}
