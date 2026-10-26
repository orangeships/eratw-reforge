import specialOutfitTables from "./special-outfit.bundle.json";
import { buildOutfitContext } from "../../../modernization/runtime/state/portrait-outfit-context.js";
import {
  outfitTokenOf,
  type OutfitContext,
  type SpecialOutfitTable,
} from "../../../modernization/runtime/state/portrait-special-outfit.js";
import {
  portraitForOutfitInPack,
  type PortraitImageSource,
  type PortraitSource,
  type PortraitVariantPack,
} from "./portrait-expression.js";
import { portraitKindOf, type PortraitKind } from "../../../modernization/runtime/state/portrait-kind.js";
import { portraitVariantOf } from "../../../modernization/runtime/state/portrait-variant.js";
import type { GameState } from "../../../modernization/runtime/state/game-state.js";

/**
 * 特殊服装的运行期总入口。
 *
 * 上游的顺序是 `QOL_IMAGE.ERB:945-950`：先按 `CHECK_NUDE` 定 `裸`/`服`，
 * 再把 `@IMAGE_In_特殊服装` 返回的词**追加**到服装段，最后拼
 * `表示形式_服装_表情_号`。所以 token 必须在「选服装分支」之后、
 * 「选表情」之前套上 —— 表情裁切是跟着服装走的。
 *
 * 全流程 fail-closed：任何一步不确定都返回 `undefined`，调用方退回普通立绘。
 * 绝不允许「猜一个 token」—— 那会画出另一个服装角色的图。
 */

const TABLES = specialOutfitTables as unknown as readonly SpecialOutfitTable[];

const BY_CHARA = new Map<number, SpecialOutfitTable>();
for (const table of TABLES) BY_CHARA.set(table.charaNum, table);

/** 该角色的换装判定表；上游没有这个角色时是 undefined。 */
export function specialOutfitTable(charaNum: number): SpecialOutfitTable | undefined {
  return BY_CHARA.get(charaNum);
}

/** 该角色这一帧的换装词；上游没设置 RESULTS 时是 undefined。 */
export function currentOutfitToken(
  state: GameState,
  charaNum: number,
  ctx: OutfitContext = buildOutfitContext(state, charaNum),
): string | undefined {
  const table = BY_CHARA.get(charaNum);
  if (!table) return undefined;
  return outfitTokenOf(table, ctx);
}

/** 暴露给测试：直接注入上下文。 */
export function outfitTokenWith(
  state: GameState,
  charaNum: number,
  ctx: OutfitContext,
): string | undefined {
  void state;
  return outfitTokenOf(BY_CHARA.get(charaNum), ctx);
}

/** 玩家当前选中的替换包（0 = 基包）。 */
function activePack(source: PortraitSource | undefined, variantId: number): PortraitVariantPack | undefined {
  if (!source || variantId <= 0) return undefined;
  return source.packs?.find((pack) => pack.id === variantId);
}

/**
 * 把换装套到已选好「服装分支」的立绘上。
 *
 * `dimension` 是**已经套好替换包、并按裸/服选过分支**的那张图。返回
 * undefined 表示「这一帧没有换装，或这个包里没有这套服装的图」，
 * 调用方继续用 `dimension` 即可 —— 那正是上游缺图时的行为
 * （`QOL_IMAGE.ERB:510` 回退到 `%表示形式%_服_通常_NO`）。
 *
 * ⚠️ 查图走 `portraitForOutfitInPack` 而**不是** `portraitForOutfit`：
 * 换装图挂在表示形式上，基包没有的服装不能借替换包的图。
 */
export function portraitWithOutfit(
  state: GameState,
  charaNum: number,
  source: PortraitSource | undefined,
  dimension: PortraitImageSource | undefined,
  naked: boolean,
  kind?: PortraitKind,
): PortraitImageSource | undefined {
  if (!source || !dimension) return dimension;
  const token = currentOutfitToken(state, charaNum);
  if (!token) return dimension;
  const pack = activePack(source, portraitVariantOf(state, charaNum));
  const outfit = portraitForOutfitInPack(
    source,
    pack,
    token,
    kind ?? portraitKindOf(state),
    naked,
  );
  return outfit ?? dimension;
}

/** 调试用：某角色这一帧的 token + 该包下是否真有图。 */
export function outfitDebug(
  state: GameState,
  charaNum: number,
  source: PortraitSource | undefined,
  naked: boolean,
): { token: string | undefined; hasArt: boolean; pack: number } {
  const token = currentOutfitToken(state, charaNum);
  const variant = portraitVariantOf(state, charaNum);
  const pack = activePack(source, variant);
  return {
    token,
    pack: variant,
    hasArt: !!token && !!portraitForOutfitInPack(source, pack, token, portraitKindOf(state), naked),
  };
}
