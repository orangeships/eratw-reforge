/**
 * P2-02 — `家庭菜園` (kitchen garden) dedicated surface.
 *
 * Replaces the B9 picker InteractionBox when the player issues COM418 in a
 * PLACE_GARDEN room. The screen reads the live `state.farm` (5 plots), the
 * player's inventory (owned 苗, 肥料, 打水) and the current weather, then
 * renders a per-plot grid where each tile carries its own action buttons.
 * A per-plot action dispatches `applyIntentAction({commandNo: 418,
 * promptAnswer})` — the farm handler (`farm418HandlerEntry`) settles it,
 * mutating `state.farm` and advancing time exactly as before. When the
 * store's `pendingPrompt` is null again, the screen re-issues a bare
 * COM418 so the store regenerates the option spec from the updated plots;
 * the screen stays open across many actions and only closes on an explicit
 * 退出 button.
 *
 * This is a presentation-only upgrade: the settlement is byte-identical
 * to the legacy flat picker's (same handler, same `runAction` decode).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { GameState } from "../../../modernization/runtime/state/index.js";
import {
  FARM_ITEM,
  SEEDLINGS,
  canHarvest,
  getFarm,
  growthStage,
  isWithered,
  plotCount,
  uprootNeedsConfirm,
  type FarmPlot,
} from "../../../modernization/runtime/state/index.js";
import { hasItem, itemCount } from "../../../modernization/runtime/state/items.js";
import { weatherIndexNow, weatherName } from "../../../modernization/runtime/state/weather.js";
import { useGameStateStore } from "../state/game-state-store.js";
import { useSceneStore } from "../state/scene-store.js";
import { pickOneAnswer } from "../../../modernization/runtime/command/prompt.js";

/** The COMF470 weather gate the handler applies to plant/water/fertilize. */
const WEATHER_GATE_OK = new Set([0, 1, 2, 3, 4, 6, 7]);

function isBadWeather(index: number): boolean {
  return !WEATHER_GATE_OK.has(index);
}

const STAGE_LABEL: Record<string, string> = {
  "": "空闲",
  苗: "苗",
  叶: "叶",
  花: "花",
  果: "果",
  熟: "熟",
  枯: "枯",
};

const STAGE_GLYPH: Record<string, string> = {
  "": "·",
  苗: "✿",
  叶: "❀",
  花: "❀",
  果: "❀",
  熟: "★",
  枯: "✕",
};

interface PlotCardProps {
  index: number;
  plot: FarmPlot;
  seedlingCounts: ReadonlyMap<number, number>;
  hasWater: boolean;
  hasFertilizer: boolean;
  dryWeather: boolean;
  enabled: boolean;
  onPlant: (plotIndex: number, seedlingId: number) => void;
  onWater: (plotIndex: number) => void;
  onHarvest: (plotIndex: number) => void;
  onUproot: (plotIndex: number) => void;
  onFertilize: (plotIndex: number) => void;
}

function PlotCard(props: PlotCardProps) {
  const { index, plot, seedlingCounts, hasWater, hasFertilizer, dryWeather, enabled } = props;
  const stage = growthStage(plot);
  const isEmpty = plot.type <= 0;
  const withered = !isEmpty && isWithered(plot);
  const harvestable = !isEmpty && canHarvest(plot);
  const needsWater = !isEmpty && plot.dry > 0;
  const [pickerOpen, setPickerOpen] = useState(false);

  if (!enabled) {
    return (
      <article
        className="farm-plot farm-plot--locked"
        data-testid={`farm-plot-${index}`}
        data-plot-index={index}
        aria-disabled="true"
      >
        <header>
          <h3>畑{index}</h3>
          <span className="farm-plot__status">未开垦</span>
        </header>
        <p className="farm-plot__hint">採集Lv 不足</p>
      </article>
    );
  }

  return (
    <article
      className={`farm-plot${isEmpty ? " farm-plot--empty" : ""}${withered ? " farm-plot--withered" : ""}${harvestable ? " farm-plot--ripe" : ""}`}
      data-testid={`farm-plot-${index}`}
      data-plot-index={index}
      data-stage={stage}
    >
      <header>
        <h3>畑{index}</h3>
        <span className="farm-plot__visual" aria-hidden="true">{STAGE_GLYPH[stage] ?? "·"}</span>
      </header>
      <div className="farm-plot__body">
        <strong className="farm-plot__crop">{isEmpty ? "空地" : plot.name}</strong>
        <span className="farm-plot__stage">{STAGE_LABEL[stage] ?? stage}</span>
        {!isEmpty && (
          <ul className="farm-plot__stats">
            <li>生長 {plot.grow}</li>
            <li>乾燥 {plot.dry}{needsWater ? " ⚠" : ""}</li>
            <li>経過 {plot.days} 日</li>
            <li>肥料 {plot.food ? "✓" : "—"}</li>
          </ul>
        )}
        {withered && <p className="farm-plot__warning">枯萎了 — 仍可拔除</p>}
        {harvestable && <p className="farm-plot__ready">可以收获了</p>}
      </div>

      <div className="farm-plot__actions">
        {isEmpty ? (
          <button
            type="button"
            className="farm-plot__btn farm-plot__btn--plant"
            data-testid={`farm-plant-${index}`}
            disabled={dryWeather}
            title={dryWeather ? "恶劣天气无法种植" : undefined}
            onClick={() => setPickerOpen((value) => !value)}
          >
            种苗
          </button>
        ) : (
          <>
            {needsWater && (
              <button
                type="button"
                className="farm-plot__btn farm-plot__btn--water"
                data-testid={`farm-water-${index}`}
                disabled={!hasWater || dryWeather}
                title={!hasWater ? "还没有打水" : dryWeather ? "恶劣天气无法浇水" : undefined}
                onClick={() => props.onWater(index)}
              >
                浇水
              </button>
            )}
            {harvestable && (
              <button
                type="button"
                className="farm-plot__btn farm-plot__btn--harvest"
                data-testid={`farm-harvest-${index}`}
                onClick={() => props.onHarvest(index)}
              >
                收获
              </button>
            )}
            <button
              type="button"
              className="farm-plot__btn farm-plot__btn--uproot"
              data-testid={`farm-uproot-${index}`}
              title={uprootNeedsConfirm(plot) ? `放弃未成熟的${plot.name}` : undefined}
              onClick={() => props.onUproot(index)}
            >
              拔除
            </button>
            {plot.food === 0 && (
              <button
                type="button"
                className="farm-plot__btn farm-plot__btn--fertilize"
                data-testid={`farm-fertilize-${index}`}
                disabled={!hasFertilizer || dryWeather}
                title={!hasFertilizer ? "没有肥料" : dryWeather ? "恶劣天气无法施肥" : undefined}
                onClick={() => props.onFertilize(index)}
              >
                施肥
              </button>
            )}
          </>
        )}
      </div>

      {pickerOpen && isEmpty && (
        <div className="farm-plot__picker" role="menu" data-testid={`farm-picker-${index}`}>
          {seedlingCounts.size === 0 ? (
            <p className="farm-plot__picker-empty">暂无可种苗</p>
          ) : (
            [...seedlingCounts.entries()].map(([seedlingId, count]) => {
              const entry = SEEDLINGS.find((e) => e.seedlingId === seedlingId);
              if (!entry) return null;
              return (
                <button
                  key={seedlingId}
                  type="button"
                  className="farm-plot__picker-btn"
                  data-testid={`farm-seedling-${index}-${seedlingId}`}
                  disabled={dryWeather}
                  onClick={() => {
                    props.onPlant(index, seedlingId);
                    setPickerOpen(false);
                  }}
                >
                  {entry.seedlingName}
                  <small>×{count}</small>
                </button>
              );
            })
          )}
          <button
            type="button"
            className="farm-plot__picker-cancel"
            onClick={() => setPickerOpen(false)}
          >
            取消
          </button>
        </div>
      )}
    </article>
  );
}

function summarizeEvent(event: { kind: string; text?: string }): string | null {
  if (event.kind !== "NARRATION" && event.kind !== "STATUS_MESSAGE") return null;
  const text = event.text;
  if (!text || !text.trim()) return null;
  return text;
}

function FarmScreen({ state }: { state: GameState }) {
  const applyIntentAction = useGameStateStore((s) => s.applyIntentAction);
  const pendingPrompt = useGameStateStore((s) => s.pendingPrompt);
  const setFarmScreenOpen = useGameStateStore((s) => s.setFarmScreenOpen);
  const setScreen = useSceneStore((s) => s.setScreen);

  const farm = getFarm(state);
  const enabled = plotCount(state);
  const hasWater = Boolean(state.varWater);
  const hasFertilizer = hasItem(state, FARM_ITEM.肥料);
  const hasGardenKit = hasItem(state, FARM_ITEM.園芸用品一式);
  const weatherIndex = weatherIndexNow(state.time);
  const dryWeather = isBadWeather(weatherIndex);
  const weatherLabel = weatherName(weatherIndex);

  const seedlingCounts = useMemo(() => {
    const map = new Map<number, number>();
    for (const entry of SEEDLINGS) {
      const count = itemCount(state, entry.seedlingId);
      if (count > 0) map.set(entry.seedlingId, count);
    }
    return map;
  }, [state]);

  // The store keeps a live 418 prompt spec only while a bare COM418 is
  // pending. The screen uses its OWN option ids (`water:N` etc.) so the
  // handler's `runAction` decode is the single authority on settlement;
  // the spec is only a liveness signal + the harvest-all availability flag.
  const spec = pendingPrompt?.commandNo === 418 ? pendingPrompt.spec : null;
  const hasHarvestAll =
    spec?.options.some((o) => o.id === "harvestall") ?? false;

  const dispatch = useCallback(
    (optionId: string) => {
      applyIntentAction({
        kind: "ISSUE_COMMAND",
        actor: 0,
        commandNo: 418,
        promptAnswer: pickOneAnswer(optionId),
      });
    },
    [applyIntentAction],
  );

  const exit = useCallback(() => {
    setFarmScreenOpen(false);
    setScreen("mainGame");
  }, [setFarmScreenOpen, setScreen]);

  // When the store has no pending 418 spec (an action just settled), re-issue
  // a bare COM418 so the picker regenerates from the updated plots. This is
  // the same intercept the first opening used; it never settles (no answer),
  // so no time passes.
  const farmScreenOpen = useGameStateStore((s) => s.farmScreenOpen);
  useEffect(() => {
    if (spec || !farmScreenOpen) return;
    applyIntentAction({ kind: "ISSUE_COMMAND", actor: 0, commandNo: 418 });
  }, [spec, farmScreenOpen, applyIntentAction]);

  const narrationTail = useMemo(() => {
    const lines: string[] = [];
    for (let i = state.eventLog.length - 1; i >= 0 && lines.length < 6; i--) {
      const text = summarizeEvent(state.eventLog[i]!);
      if (text) lines.unshift(text);
    }
    return lines;
  }, [state.eventLog]);

  if (!hasGardenKit) {
    return (
      <main className="farm-screen" data-testid="farm-screen">
        <header className="farm-screen__header">
          <h1>家庭菜園</h1>
          <button type="button" onClick={exit}>退出</button>
        </header>
        <p className="farm-screen__blocked">需要 園芸用品一式 才能耕种。</p>
      </main>
    );
  }

  return (
    <main
      className={`farm-screen${dryWeather ? " farm-screen--bad-weather" : ""}`}
      data-testid="farm-screen"
      data-weather-index={weatherIndex}
    >
      <header className="farm-screen__header">
        <div>
          <small>家庭菜園 / {state.master.location}</small>
          <h1>5 块田地 · {enabled} 块可用</h1>
        </div>
        <div className="farm-screen__weather">
          <span data-testid="farm-weather-label">天气：{weatherLabel}</span>
          {dryWeather && <em className="farm-screen__weather-warn">恶劣天气 · 暂缓种/浇/肥</em>}
        </div>
        <button type="button" onClick={exit} data-testid="farm-exit">退出</button>
      </header>

      <section className="farm-screen__grid" data-testid="farm-grid">
        {Array.from({ length: 5 }, (_, index) => (
          <PlotCard
            key={index}
            index={index}
            plot={farm[index] ?? { type: 0, days: 0, grow: 0, dry: 0, food: 0, name: "" }}
            seedlingCounts={seedlingCounts}
            hasWater={hasWater}
            hasFertilizer={hasFertilizer}
            dryWeather={dryWeather}
            enabled={index < enabled}
            onPlant={(plotIndex, seedlingId) => dispatch(`plant:${plotIndex}:${seedlingId}`)}
            onWater={(plotIndex) => dispatch(`water:${plotIndex}`)}
            onHarvest={(plotIndex) => dispatch(`harvest:${plotIndex}`)}
            onUproot={(plotIndex) => dispatch(`uproot:${plotIndex}`)}
            onFertilize={(plotIndex) => dispatch(`fertilize:${plotIndex}`)}
          />
        ))}
      </section>

      <footer className="farm-screen__footer">
        <div className="farm-screen__resources">
          <span data-testid="farm-resource-water">打水：{hasWater ? "✓" : "—"}</span>
          <span data-testid="farm-resource-fertilizer">肥料：{hasFertilizer ? "✓" : "—"}</span>
          <span>苗：{seedlingCounts.size > 0 ? [...seedlingCounts.keys()].map((id) => SEEDLINGS.find((e) => e.seedlingId === id)?.seedlingName).join("、") : "—"}</span>
        </div>
        {hasHarvestAll && (
          <button
            type="button"
            className="farm-screen__harvestall"
            data-testid="farm-harvest-all"
            onClick={() => dispatch("harvestall")}
          >
            全部收获
          </button>
        )}
        <ol className="farm-screen__log" data-testid="farm-narration">
          {narrationTail.length === 0
            ? <li className="farm-screen__log-empty">还没有动作</li>
            : narrationTail.map((line, idx) => <li key={`${idx}-${line}`}>{line}</li>)}
        </ol>
      </footer>
    </main>
  );
}

export default FarmScreen;

/** Test seam — the compact read-only summary the screen derives from state.
 *  Kept module-level (no React) so unit tests can assert the rendering
 *  contract without mounting the component. */
export interface FarmSpec {
  enabledPlots: number;
  hasWater: boolean;
  hasFertilizer: boolean;
  ownedSeedlings: number;
  weatherIndex: number;
  dryWeather: boolean;
  canHarvestAll: boolean;
}

export function deriveFarmSpec(state: GameState): FarmSpec {
  const enabled = plotCount(state);
  const farm = getFarm(state);
  const canHarvestAll = farm.slice(0, enabled).some((p) => p.type > 0 && canHarvest(p));
  const weatherIndex = weatherIndexNow(state.time);
  return {
    enabledPlots: enabled,
    hasWater: Boolean(state.varWater),
    hasFertilizer: hasItem(state, FARM_ITEM.肥料),
    ownedSeedlings: SEEDLINGS.filter((e) => hasItem(state, e.seedlingId)).length,
    weatherIndex,
    dryWeather: isBadWeather(weatherIndex),
    canHarvestAll,
  };
}
