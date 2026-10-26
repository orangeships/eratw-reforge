import type { GameState } from "../../../modernization/runtime/state/game-state.js";
import { portraitKindOf } from "../../../modernization/runtime/state/portrait-kind.js";
import { portraitVariantOf } from "../../../modernization/runtime/state/portrait-variant.js";
import portraits from "./portraits.bundle.json";
import SpriteCrop from "./SpriteCrop.js";
import {
  dimensionForKind,
  portraitForClothing,
  portraitForExpression,
  portraitForOutfitInPack,
  portraitForVariant,
  portraitVariantIds,
  portraitSourceForState,
  statePortraitExpression,
  type PortraitSource,
} from "./portrait-expression.js";
import { currentOutfitToken } from "./portrait-special-outfit-runtime.js";
import { checkNude } from "../../../modernization/runtime/state/portrait-outfit-context.js";

const PORTRAITS = portraits as unknown as Record<string, PortraitSource>;

export interface PortraitVariantPickerProps {
  state: GameState;
  charaNum: number;
  onSelect: (variantId: number) => void;
  compact?: boolean;
}

function charaLabel(state: GameState, charaNum: number): string {
  return state.charas[charaNum]?.callName ?? `角色${charaNum}`;
}

/** Shared selector used by the left target panel and the Shop UPDATE page. */
export default function PortraitVariantPicker({
  state,
  charaNum,
  onSelect,
  compact = false,
}: PortraitVariantPickerProps) {
  const source = portraitSourceForState(state, charaNum, PORTRAITS);
  if (!source) {
    return (
      <div className="portrait-variant-picker portrait-variant-picker--empty" data-testid="portrait-variant-picker">
        当前角色没有可用的静态立绘资源。
      </div>
    );
  }

  const kind = portraitKindOf(state);
  const saved = portraitVariantOf(state, charaNum);
  const expression = statePortraitExpression(state, charaNum);
  // Only ids that own art in this dimension are offered, so the raw save value
  // can land on a hole (a pack with no 立絵) and must be snapped for display.
  const ids = portraitVariantIds(source, kind);
  const current =
    ids.find((id) => id === saved) ??
    ids.reduce((best, id) => (Math.abs(id - saved) < Math.abs(best - saved) ? id : best), ids[0]);
  const max = ids[ids.length - 1];

  return (
    <div
      className={`portrait-variant-picker${compact ? " portrait-variant-picker--compact" : ""}`}
      data-testid="portrait-variant-picker"
      data-chara={charaNum}
      data-kind={kind}
    >
      <div className="portrait-variant-picker__heading">
        <span>{charaLabel(state, charaNum)} · {kind === "face" ? "颜绘" : "立绘"}</span>
        <span className="portrait-variant-picker__current">当前：{current} / {max}</span>
      </div>
      <div className="portrait-variant-picker__options">
        {ids.map((id) => {
          // ⚠️ 这里**不能**调 `portraitWithOutfit`：它内部用
          // `portraitVariantOf(state, charaNum)` 取**玩家当前选中**的包，而
          // 选择器要渲染的是**每个候选包**。对非当前包调用会画出别的包的图。
          // 所以直接走底层 `portraitForOutfitInPack`，显式传候选包。
          const pack = source.packs?.find((p) => p.id === id);
          const pickNaked = checkNude(state, charaNum);
          const pickBase = portraitForClothing(dimensionForKind(portraitForVariant(source, id), kind), pickNaked);
          const token = currentOutfitToken(state, charaNum);
          const outfitDim = token
            ? portraitForOutfitInPack(source, pack, token, kind, pickNaked)
            : undefined;
          const dimension = outfitDim ?? pickBase;
          const preview = portraitForExpression(dimension, expression);
          return (
            <button
              type="button"
              key={id}
              className={`portrait-variant-picker__option${current === id ? " portrait-variant-picker__option--active" : ""}`}
              data-testid="portrait-variant-option"
              data-variant={id}
              aria-pressed={current === id}
              title={`切换到立绘包 ${id}`}
              onClick={() => onSelect(id)}
            >
              {preview ? (
                <SpriteCrop
                  className="portrait-variant-picker__preview"
                  source={preview}
                  alt={`${charaLabel(state, charaNum)} 立绘包 ${id}`}
                  frameWidth={compact ? 56 : 76}
                  frameHeight={compact ? 76 : 100}
                  cropTestId="portrait-variant-preview-crop"
                />
              ) : (
                <span className="portrait-variant-picker__preview portrait-variant-picker__preview--empty" />
              )}
              <span>{id === 0 ? "初始" : `包 ${id}`}</span>
            </button>
          );
        })}
      </div>
      <p className="portrait-variant-picker__note">
        {current !== saved
          ? `存档选择为 ${saved}，此显示类型下没有这套资源，已按最近可用包 ${current} 显示。`
          : `状态差分：${expression}`}
      </p>
    </div>
  );
}
