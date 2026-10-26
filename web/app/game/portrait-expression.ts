import type { CharaSlot } from "../../../modernization/runtime/state/index.js";
import {
  calcExpressionCore,
  type CoreExpression,
} from "../../../modernization/runtime/state/portrait-expression-core.js";
import { portraitKindOf, type PortraitKind } from "../../../modernization/runtime/state/portrait-kind.js";
import {
  effectivePortraitCharaNum,
  renderedPortraitVariant,
  type PortraitVariantAvailability,
} from "../../../modernization/runtime/state/portrait-variant.js";
import type { GameState } from "../../../modernization/runtime/state/game-state.js";
import type { SpriteCropSource } from "./SpriteCrop.js";

export type PortraitExpression = CoreExpression;
export type PortraitRenderExpression = PortraitExpression | "lust";

export interface PortraitVariantPack {
  id: number;
  label: string;
  standing?: PortraitImageSource;
  face?: PortraitImageSource;
  /** 该包独有的换装图。 */
  outfits?: PortraitOutfitMap;
}

export interface PortraitCommandImageSet {
  clothed?: SpriteCropSource;
  naked?: SpriteCropSource;
}

/** QOL_IMAGE's command and clothing lookup, when that resource exists upstream. */
export interface PortraitImageSource extends SpriteCropSource {
  variants?: Partial<Record<PortraitRenderExpression, SpriteCropSource>>;
  commandImages?: Record<string, PortraitCommandImageSet>;
  nude?: PortraitImageSource;
}

/**
 * 某个服装词在一种穿衣状态下的裁切。
 *
 * clothed / naked **分栏**，不能像基包那样把裸体版塞进 clothed 槽：换装判定
 * 常发生在裸体状态下（`_浴袍` 只在 `IF CHECK_NUDE` 分支里判），这类服装
 * 只有 `_裸_` 命名的图。合成一栏会把裸体图登记成穿衣图。
 */
export interface PortraitOutfitClothingSet {
  clothed?: PortraitImageSource;
  naked?: PortraitImageSource;
}

/**
 * 某个服装词在**一个表示形式**下的全部裁切。键是上游 `RESULTS = _xxx` 的
 * `xxx`（不带前导下划线）。
 *
 * 挂在表示形式（基包 / 替换包）上而不是角色上：换装图绝大多数只存在于
 * 替换包里 —— 萃香的 `_下着` 在 `EN_IMG/327/10_別立.webp`
 * （`別立ち_服_下着_通常_10`），基包 `立絵` 下根本没有。混在一起会让玩家
 * 选了 1 号包却画出别的包的图。
 */
export interface PortraitOutfitSet {
  standing?: PortraitOutfitClothingSet;
  face?: PortraitOutfitClothingSet;
}

export type PortraitOutfitMap = Record<string, PortraitOutfitSet>;

export interface PortraitSource extends PortraitImageSource {
  /** 顔絵 (face-only) dimension — the same char on a different sheet. Absent
   *  → the render layer falls back to the standing 立絵. */
  face?: PortraitImageSource;
  variantCount?: PortraitVariantAvailability;
  packs?: PortraitVariantPack[];
  /** 基包（`立絵` / `顔絵`）下的换装图。 */
  outfits?: PortraitOutfitMap;
}

const CLICK_EXPRESSIONS: readonly PortraitExpression[] = ["normal", "smile", "angry"];

/** Pick the portrait dimension for the current 立絵種類. `face` falls back to
 *  the standing sheet when the char has no face asset (fail-closed). */
export function dimensionForKind(
  source: PortraitSource | undefined,
  kind: PortraitKind,
): PortraitImageSource | undefined {
  if (!source) return undefined;
  if (kind === "face") return source.face ?? source;
  return source;
}

/** Resolve the persisted per-character package without mutating GameState. */
export function portraitForVariant(
  source: PortraitSource | undefined,
  variantId: number,
): PortraitSource | undefined {
  if (!source || variantId <= 0) return source;
  const pack = source.packs?.find((candidate) => candidate.id === variantId);
  if (!pack) return source;
  // A package may intentionally only provide one dimension. Keep the
  // default dimension as the fail-closed fallback for the other one.
  const face = pack.face ?? source.face;
  // `nude` is NOT inherited by the object spread: a pack that ships no 裸 art
  // would otherwise drop the default's 裸 branch entirely, and the naked
  // render path would fall back to the pack's CLOTHED art. Upstream instead
  // degrades a missing 裸 resource to the DEFAULT package's 裸 resource
  // (GET表情体形完整 returns 0 → generic lookup), so keep the default 裸.
  return {
    ...source,
    ...(pack.standing ?? {}),
    nude: pack.standing?.nude ?? source.nude,
    ...(face ? { face: { ...face, nude: face.nude ?? source.face?.nude } } : {}),
    packs: source.packs,
    variantCount: source.variantCount,
  };
}

/** Resolve the state-selected package for one authored character. */
export function portraitForState(
  state: GameState,
  charaNum: number,
  source: PortraitSource | undefined,
): PortraitSource | undefined {
  if (!source) return undefined;
  const kind = portraitKindOf(state);
  const variantId = renderedPortraitVariant(
    state,
    charaNum,
    kind,
    source.variantCount,
    portraitVariantIds(source, kind),
  );
  return portraitForVariant(source, variantId);
}

/**
 * Resolve the authored resource for a character after an upstream-style
 * transformation.  The displayed slot keeps its own identity, but the
 * portrait package, face sheet, and expression assets come from `変化先` when
 * that target is present.  Callers can pass the normal bundle map and retain
 * the original source as a safe fallback.
 */
export function portraitSourceForState(
  state: GameState,
  charaNum: number,
  sources: Record<string, PortraitSource | undefined>,
): PortraitSource | undefined {
  const effective = effectivePortraitCharaNum(state, charaNum);
  const direct = sources[String(effective)] ?? sources[String(charaNum)];
  if (direct) return direct;
  const meta = state.dynamicCharacters?.[charaNum];
  return meta?.origin === "authored" ? sources[`role:${meta.role}`] : undefined;
}

/**
 * Package ids that actually own art in one dimension, `0` (the default set)
 * first, then the real pack ids ascending.
 *
 * The declared range is NOT contiguous. Upstream can attach a package that
 * ships only a 顔絵 or only a 立絵, and a package can be dropped entirely when
 * it has no 裸 art to inherit. Listing `0..max` would therefore render empty
 * buttons that select a package that has nothing to show. When a source ships
 * no `packs` at all we keep the legacy range so old bundles still work.
 */
export function portraitVariantIds(
  source: PortraitSource | undefined,
  kind: PortraitKind,
): number[] {
  if (!source) return [0];
  const packs = source.packs;
  if (!packs || packs.length === 0) {
    const max = Math.max(0, Math.trunc(source.variantCount?.[kind] ?? 0));
    return Array.from({ length: max + 1 }, (_, id) => id);
  }
  const has = (pack: PortraitVariantPack): boolean =>
    kind === "face" ? !!pack.face : !!pack.standing;
  return [0, ...packs.filter(has).map((pack) => pack.id).sort((a, b) => a - b)];
}

/**
 * State-driven expression — `@CALC_EXPRESSION_CORE` (QOL_IMAGE.ERB:1392-1530)
 * deterministic port. Returns the candidate base expression for `charaNum`
 * from the state; the render layer then degrades a missing sprite to normal.
 * Signature takes the full GameState (the core reads turn-context / flags).
 */
export function statePortraitExpression(
  state: GameState,
  charaNum: number,
): PortraitExpression {
  return calcExpressionCore(state, charaNum).base;
}

/** Choose only from upstream-indexed portraits (missing variant → base). */
export function portraitForExpression(
  source: SpriteCropSource | undefined,
  expression: PortraitRenderExpression,
): SpriteCropSource | undefined {
  if (!source) return undefined;
  if ("variants" in source) {
    const variants = (source as PortraitSource).variants;
    if (expression === "climax") return variants?.climax ?? variants?.aroused ?? source;
    return variants?.[expression] ?? source;
  }
  return source;
}

/** Select the resource branch QOL_IMAGE would use for the current clothing state. */
export function portraitForClothing(
  source: PortraitImageSource | undefined,
  naked: boolean,
): PortraitImageSource | undefined {
  return naked ? source?.nude ?? source : source;
}

/** All outfit tokens this character has art for, across base and packs. */
export function portraitOutfitTokens(
  source: PortraitSource | undefined,
): readonly string[] {
  if (!source) return [];
  return [...new Set([
    ...Object.keys(source.outfits ?? {}),
    ...(source.packs ?? []).flatMap((pack) => Object.keys(pack.outfits ?? {})),
  ])];
}

/**
 * Resolve the art for one special-outfit token, or `undefined` when this
 * package has no such artwork.
 *
 * **No cross-package fallback is intentional.** Upstream addresses exactly one
 * 表示形式 and its missing-image fallback is
 * `%表示形式%_服_通常_NO` (`QOL_IMAGE.ERB:510`) — the *normal* art of the
 * same package, not another package's outfit art. Searching `packs` here
 * would let a base-package token borrow pack 3's bunny sheet, which upstream
 * can never produce.
 *
 * `undefined` means "fall back to the normal portrait" and is the correct
 * answer for every token whose art does not exist in this package — the
 * fail-closed direction. It must never become a guessed sprite name.
 */
export function portraitForOutfit(
  source: PortraitSource | undefined,
  token: string | undefined,
  kind: PortraitKind,
  naked: boolean,
): PortraitImageSource | undefined {
  if (!source || !token) return undefined;
  const set = source.outfits?.[token];
  const dimension = kind === "face" ? set?.face : set?.standing;
  if (!dimension) return undefined;
  return naked ? dimension.naked : dimension.clothed;
}

/**
 * Resolve the outfit art inside an ALREADY-RESOLVED package.
 *
 * `portraitForVariant` returns a flattened source whose top-level art is the
 * selected package's, but it deliberately preserves `packs` for the picker.
 * The outfit table is per-package, so callers that already resolved the
 * package must hand the matching one here — otherwise a base-package token
 * could be painted with replacement-pack art.
 */
export function portraitForOutfitInPack(
  source: PortraitSource | undefined,
  pack: PortraitVariantPack | undefined,
  token: string | undefined,
  kind: PortraitKind,
  naked: boolean,
): PortraitImageSource | undefined {
  const map = pack ? pack.outfits : source?.outfits;
  if (!map || !token) return undefined;
  const set = map[token];
  const dimension = kind === "face" ? set?.face : set?.standing;
  if (!dimension) return undefined;
  return naked ? dimension.naked : dimension.clothed;
}

/** Resolve the `DISPLAY_COM_IMAGE(COMNO)` still for this package/clothing state. */
export function portraitForCommand(
  source: PortraitImageSource | undefined,
  commandNo: number,
  naked: boolean,
): SpriteCropSource | undefined {
  const imageSet = source?.commandImages?.[String(commandNo)];
  return naked ? imageSet?.naked : imageSet?.clothed;
}

export function nextClickExpression(
  source: PortraitSource | undefined,
  current: PortraitExpression | undefined,
): PortraitExpression {
  const available = CLICK_EXPRESSIONS.filter((expression) =>
    expression === "normal" || source?.variants?.[expression],
  );
  const index = available.indexOf(current ?? "normal");
  return available[(index + 1) % available.length] ?? "normal";
}

/** Resolve an authored DISPLAY_COM_IMAGE sprite name across BOTH the standing
 *  and face dimensions of the ALREADY-RESOLVED package. Callers must pass the
 *  output of `portraitForState`, so the search stays inside the package the
 *  player selected: walking `packs` here would let a sprite name belonging to
 *  another package switch the visible art set, which upstream cannot do
 *  because it addresses exactly one 表示形式. The normal portrait remains the
 *  fail-closed fallback. */
export function portraitForSpriteName(
  source: PortraitSource | undefined,
  spriteName: unknown,
): SpriteCropSource | undefined {
  if (!source || typeof spriteName !== "string") return source;
  const match = (dim: SpriteCropSource | undefined): SpriteCropSource | undefined => {
    if (!dim) return undefined;
    if (dim.sprite === spriteName) return dim;
    if ("variants" in dim) {
      return Object.values((dim as PortraitSource).variants ?? {}).find(
        (variant) => variant?.sprite === spriteName,
      );
    }
    return undefined;
  };
  return match(source) ?? match(source.face) ?? source;
}

/** Current 立絵種類 (namespace-free, runtime authority). */
export function portraitKind(state: GameState): PortraitKind {
  return portraitKindOf(state);
}

// Keep a type-level alias so callers can name the char slot shape without
// importing runtime internals.
export type { CharaSlot };
