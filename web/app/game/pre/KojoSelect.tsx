/**
 * #13 原版开场流程 — 口上加载 / 选择 (`UPDATE_AND_SELECTION_OF_KOJO_MODDING`).
 *
 * Upstream lets the player confirm each character's personal-kojo pack, and
 * characters may have more than one pack (`口上セレクタ` chooser flag). The modern
 * browser build pre-bakes those packs into `kojo.catalog.bundle.json`; this
 * screen is the opening-time selector that writes:
 *
 *   - disabledKojo[chara]         — do not use that character's personal kojo.
 *   - selectedKojoVariants[chara] — choose a non-default bundled variant.
 *
 * The router consumes both fields at runtime, so the selected pack is the one
 * that actually speaks in command/event/special-event kojo.
 *
 * Layout (实玩反馈 2026-06-29, master-detail): the LEFT side is a scrollable
 * list of characters × their variant chips (the things the player hovers over
 * and clicks). The RIGHT side is a FIXED detail panel showing the currently
 * hovered (or default) variant's label, narrative description (RESULTS:2), and
 * the three count chips (指令 / 事件 / 特殊事件). Hovering a different chip on
 * the left updates the right panel live.
 *
 * Catalog note: each variant is keyed by its NUMERIC selector index
 * ("0".."4" = the upstream 口上セレクタ selector flag), derived authoritatively from the upstream
 * dispatch func `@M_KOJO_K{n}_{i}` (UpdateMenus.ERB UPDATE_PAGE_2). Variant 0
 * is the default pack; its label/description come from that func's
 * `RESULTS:1`/`RESULTS:2`. There is no synthetic `default:N` pointer anymore.
 * 灵梦 → 4 variants (初始 / 无个性版 / 《少女之梦》版 / YURI百合); 依姫 → 2
 * (不坠之月 / …). The UI lists characters with ≥2 variants.
 */

import { useState } from "react";
import IntroText, { type IntroLine } from "./IntroText.js";
import kojoCatalog from "../kojo.catalog.bundle.json";
import charasBundle from "../charas.bundle.json";
import { usePreGameStore } from "../../state/pre-game-store.js";

interface BundleVariant {
  variantId?: string;
  variantCode?: string;
  label?: string;
  description?: string;
  commandCount?: number;
  eventCount?: number;
  spEventCount?: number;
  byCommand?: Record<string, unknown>;
  byEventArm?: Record<string, unknown>;
  bySpEvent?: Record<string, unknown>;
}

interface BundleChara extends BundleVariant {
  callName?: string;
  defaultVariantId?: string;
  variants?: Record<string, BundleVariant>;
}

export interface LoadedKojoVariant {
  variantId: string;
  variantCode: string;
  label: string;
  description: string;
  commandCount: number;
  eventCount: number;
  spEventCount: number;
}

export interface LoadedKojo {
  charaNum: number;
  name: string;
  defaultVariantId: string;
  variants: LoadedKojoVariant[];
}

export interface LoadedKojoInput {
  charaNum: number;
  name: string;
  defaultVariantId?: string;
  variants?: LoadedKojoVariant[];
}

function countMap(value: Record<string, unknown> | undefined): number {
  return value ? Object.keys(value).length : 0;
}

function normalizeVariant(
  id: string,
  variant: BundleVariant,
  fallbackName: string,
): LoadedKojoVariant {
  const label =
    variant.label?.trim() ||
    (variant.variantCode ? `${fallbackName} · 选择值 ${variant.variantCode}` : `${fallbackName} 口上`);
  const commandCount = variant.commandCount ?? countMap(variant.byCommand);
  const eventCount = variant.eventCount ?? countMap(variant.byEventArm);
  const spEventCount = variant.spEventCount ?? countMap(variant.bySpEvent);
  // RESULTS:2 narrative description (the upstream shows it on hover/focus
  // for every variant). Falls back to a deterministic counts line so the
  // panel never renders empty.
  const description =
    variant.description?.trim() ||
    `指令口上 ${commandCount} 条；事件口上 ${eventCount} 个；特殊事件口上 ${spEventCount} 个。`;
  return {
    variantId: variant.variantId ?? id,
    variantCode: variant.variantCode ?? "",
    label,
    description,
    commandCount,
    eventCount,
    spEventCount,
  };
}

/** Roster with baked kojo packs: byChara keys × their callName + variants. */
function computeLoaded(): LoadedKojo[] {
  const byChara = (kojoCatalog as { byChara: Record<string, BundleChara> }).byChara;
  const charas = charasBundle as Record<string, { callName?: string }>;
  return Object.entries(byChara)
    .map(([id, entry]) => {
      const name = entry.callName ?? charas[id]?.callName ?? `#${id}`;
      // Each catalog variant is a real numeric-indexed selector pack
      // ("0".."4"). De-dupe defensively by variantId.
      const variants = Object.entries(entry.variants ?? {})
        .map(([variantId, variant]) => normalizeVariant(variantId, variant, name))
        .filter((variant, idx, arr) => arr.findIndex((v) => v.variantId === variant.variantId) === idx)
        .sort((a, b) => a.variantId.localeCompare(b.variantId, undefined, { numeric: true }));
      const defaultVariantId =
        entry.defaultVariantId ?? variants[0]?.variantId ?? "0";
      return {
        charaNum: Number(id),
        name,
        defaultVariantId,
        variants,
      };
    })
    .sort((a, b) => a.charaNum - b.charaNum);
}

function normalizeLoaded(loaded: LoadedKojoInput[]): LoadedKojo[] {
  return loaded.map((entry) => {
    // De-dupe by variantId (test injection path may repeat one).
    const seen = new Set<string>();
    const deduped = (entry.variants ?? []).filter((v) => {
      if (seen.has(v.variantId)) return false;
      seen.add(v.variantId);
      return true;
    });
    const variantId = entry.defaultVariantId ?? deduped[0]?.variantId ?? "0";
    if (deduped.length > 0) {
      return { ...entry, defaultVariantId: variantId, variants: deduped };
    }
    return {
      ...entry,
      defaultVariantId: variantId,
      variants: [
        {
          variantId,
          variantCode: "",
          label: `${entry.name} 口上`,
          description: `${entry.name} 的默认口上包。`,
          commandCount: 0,
          eventCount: 0,
          spEventCount: 0,
        },
      ],
    };
  });
}

const CATALOG = computeLoaded();

const INTRO: IntroLine[] = [
  { text: "「幻想乡里住着各种各样的人。妖怪也好，人类也好……麻烦的家伙尤其多呢。」", color: "#c9a4ff" },
  { text: "「想先去见谁，就由你决定吧。」", color: "#b388ff" },
];

export interface KojoSelectProps {
  /** Override the loaded roster (tests inject a small list). */
  loaded?: LoadedKojoInput[];
  onNext: () => void;
  onBack?: () => void;
}

export default function KojoSelect(props: KojoSelectProps) {
  const allLoaded = normalizeLoaded(props.loaded ?? CATALOG);
  const loaded = allLoaded.filter((entry) => entry.variants.length > 1);
  const draft = usePreGameStore((s) => s.draft);
  const setDraft = usePreGameStore((s) => s.setDraft);

  // Master-detail: hover state tracks which variant is shown on the right
  // panel. Falls back to the player's currently-selected variant for that
  // character, and finally to the character's default variant.
  const [hovered, setHovered] = useState<{ charaNum: number; variantId: string } | null>(null);

  const detailChara =
    loaded.find((c) => c.charaNum === hovered?.charaNum) ?? loaded[0];
  const detailVariant = detailChara
    ? detailChara.variants.find(
        (v) => v.variantId === (hovered?.charaNum === detailChara.charaNum ? hovered?.variantId : undefined),
      ) ?? detailChara.variants.find(
        (v) => v.variantId === (draft.selectedKojoVariants?.[detailChara.charaNum] ?? detailChara.defaultVariantId),
      ) ?? detailChara.variants[0]
    : null;

  const setOne = (charaNum: number, enabled: boolean): void => {
    const next = { ...draft.disabledKojo };
    if (enabled) {
      delete next[charaNum];
    } else {
      next[charaNum] = true;
    }
    setDraft({ disabledKojo: next });
  };

  const setAll = (enabled: boolean): void => {
    if (enabled) {
      setDraft({ disabledKojo: {} });
      return;
    }
    setDraft({
      disabledKojo: Object.fromEntries(loaded.map((c) => [c.charaNum, true])),
    });
  };

  const selectVariant = (chara: LoadedKojo, variantId: string): void => {
    const next = { ...(draft.selectedKojoVariants ?? {}) };
    if (variantId === chara.defaultVariantId) {
      delete next[chara.charaNum];
    } else {
      next[chara.charaNum] = variantId;
    }
    setDraft({ selectedKojoVariants: next });
  };

  return (
    <section className="pre-screen pre-screen--kojo" data-testid="screen-kojo">
      <IntroText lines={INTRO} testId="kojo-intro" />

      <p className="pre-screen__lead">
        已接入 <strong data-testid="kojo-total-count">{allLoaded.length}</strong> 位角色的个人口上；
        其中 <strong data-testid="kojo-count">{loaded.length}</strong> 位拥有多个候选剧本。
      </p>

      <div className="pre-screen__menu">
        <button type="button" data-testid="kojo-enable-all" onClick={() => setAll(true)}>
          全部启用
        </button>
        <button type="button" data-testid="kojo-disable-all" onClick={() => setAll(false)}>
          全部停用
        </button>
      </div>

      <div className="pre-screen__kojo-layout" data-testid="kojo-roster">
        {/* LEFT: scrollable character + variant chips. */}
        <ul className="pre-screen__kojo-list" data-testid="kojo-list">
          {loaded.length === 0 && (
            <li className="kojo-row kojo-row--empty" data-testid="kojo-empty">
              当前没有需要选择的多版本口上。
            </li>
          )}
          {loaded.map((c, i) => {
            const disabled = Boolean(draft.disabledKojo[c.charaNum]);
            const selectedVariantId =
              draft.selectedKojoVariants?.[c.charaNum] ?? c.defaultVariantId;
            return (
              <li
                key={c.charaNum}
                className={`kojo-row${disabled ? " kojo-row--disabled" : ""}`}
                data-testid="kojo-row"
                data-chara={c.charaNum}
                style={{ animationDelay: `${Math.min(i, 20) * 0.025}s` }}
              >
                <div className="kojo-row__head">
                  <span className="kojo-row__num">[{c.charaNum}]</span>
                  <span className="kojo-row__name">{c.name}</span>
                  <button
                    type="button"
                    data-testid="kojo-toggle"
                    data-chara={c.charaNum}
                    aria-pressed={!disabled}
                    onClick={() => setOne(c.charaNum, disabled)}
                  >
                    {disabled ? "停用中" : "启用中"}
                  </button>
                </div>
                <div className="kojo-row__variants">
                  {c.variants.map((variant) => {
                    const selected = selectedVariantId === variant.variantId;
                    const isHovered =
                      hovered?.charaNum === c.charaNum && hovered.variantId === variant.variantId;
                    return (
                      <button
                        key={variant.variantId}
                        type="button"
                        className={
                          "kojo-variant" +
                          (selected ? " kojo-variant--selected" : "") +
                          (isHovered ? " kojo-variant--hovered" : "")
                        }
                        data-testid="kojo-variant"
                        data-chara={c.charaNum}
                        data-variant={variant.variantId}
                        aria-pressed={selected}
                        onMouseEnter={() =>
                          setHovered({ charaNum: c.charaNum, variantId: variant.variantId })
                        }
                        onFocus={() =>
                          setHovered({ charaNum: c.charaNum, variantId: variant.variantId })
                        }
                        onClick={() => selectVariant(c, variant.variantId)}
                      >
                        {variant.label}
                      </button>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ul>

        {/* RIGHT: fixed detail panel showing the hovered/selected variant. */}
        <aside
          className="pre-screen__kojo-detail"
          data-testid="kojo-detail"
          aria-live="polite"
        >
          {detailChara && detailVariant ? (
            <>
              <p className="kojo-detail__name" data-testid="kojo-detail-name">
                {detailChara.name}
                <span className="kojo-detail__name-sep">·</span>
                <span className="kojo-detail__variant-label">{detailVariant.label}</span>
              </p>
              <p className="kojo-detail__description" data-testid="kojo-detail-description">
                {detailVariant.description}
              </p>
              <ul className="kojo-detail__counts" data-testid="kojo-detail-counts">
                <li>
                  <span className="kojo-detail__count-key">指令口上</span>
                  <span className="kojo-detail__count-val">{detailVariant.commandCount}</span>
                </li>
                <li>
                  <span className="kojo-detail__count-key">事件口上</span>
                  <span className="kojo-detail__count-val">{detailVariant.eventCount}</span>
                </li>
                <li>
                  <span className="kojo-detail__count-key">特殊事件口上</span>
                  <span className="kojo-detail__count-val">{detailVariant.spEventCount}</span>
                </li>
              </ul>
            </>
          ) : (
            <p className="kojo-detail__empty">当前没有需要选择的多版本口上。</p>
          )}
        </aside>
      </div>

      <div className="pre-screen__menu pre-screen__menu--nav">
        <button
          type="button"
          data-testid="kojo-done"
          className="pre-screen__primary"
          onClick={props.onNext}
        >
          口上加载完毕 →
        </button>
        {props.onBack && (
          <button type="button" data-testid="kojo-back" onClick={props.onBack}>
            返回
          </button>
        )}
      </div>
    </section>
  );
}
