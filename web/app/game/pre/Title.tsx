/**
 * Phase 4.5E — Title screen (era-style, single centered stream).
 *
 * The original eraTW title renders `resources/title.webp` (a ~1041×560
 * banner the ERB displays as 35 stacked 16px strips — an era HTML-workaround;
 * here we just show the whole image). Below it sit the centered menu and the
 * demoted dev entry. `继续游戏` is enabled only when a game state is
 * available; `开发者工具` reaches the demoted Mod Studio surfaces.
 */

import { useState } from "react";
import type { SaveSlot, SlotInfo } from "../../ipc/tauri-bridge.js";

export interface TitleProps {
  onStart: () => void;
  /** Enter the game after a selected slot has loaded successfully. */
  onContinue?: () => void;
  /** Load one of the three persisted slots. When present, 读取存档 opens a picker. */
  onLoadSlot?: (slot: SaveSlot) => void | boolean | Promise<void | boolean>;
  onRefreshSlots?: () => void | Promise<void>;
  saveSlots?: SlotInfo[] | null;
  /** Defined only outside a PLAYER_BUILD; when omitted, the dev entry is hidden. */
  onDev?: () => void;
}

export default function Title(props: TitleProps) {
  const [showLoadSlots, setShowLoadSlots] = useState(false);
  const [loadingSlot, setLoadingSlot] = useState<SaveSlot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const hasReadableSlot = props.onLoadSlot
    ? Boolean(props.saveSlots?.some((slot) => slot.exists))
    : Boolean(props.onContinue);

  const openLoadSlots = async (): Promise<void> => {
    if (!props.onLoadSlot) {
      props.onContinue?.();
      return;
    }
    setShowLoadSlots((open) => !open);
    setLoadError(null);
    await props.onRefreshSlots?.();
  };

  const loadSlot = async (slot: SaveSlot): Promise<void> => {
    if (!props.onLoadSlot || loadingSlot !== null) return;
    setLoadingSlot(slot);
    setLoadError(null);
    try {
      const loaded = await props.onLoadSlot(slot);
      if (loaded === false) {
        setLoadError(`槽位 ${slot} 读取失败。`);
        return;
      }
      props.onContinue?.();
    } catch (error) {
      setLoadError(`槽位 ${slot} 读取失败：${String(error)}`);
    } finally {
      setLoadingSlot(null);
    }
  };

  return (
    <section className="pre-screen pre-screen--title" data-testid="screen-title">
      <img
        className="pre-screen__title-img"
        src="title.webp"
        alt="eraTW"
        data-testid="title-image"
      />
      <div className="pre-screen__menu pre-screen__menu--title">
        <button type="button" data-testid="title-start" onClick={props.onStart}>
          [0] 开始游戏
        </button>
        <button
          type="button"
          data-testid="title-continue"
          onClick={() => void openLoadSlots()}
          disabled={!props.onContinue || !hasReadableSlot}
        >
          [1] 读取存档
        </button>
        <button type="button" data-testid="title-demo" disabled>
          [2] DEMO
        </button>
      </div>
      {showLoadSlots && props.onLoadSlot && (
        <div className="pre-screen__load-panel" data-testid="title-load-panel">
          <p>选择要读取的存档：</p>
          <div className="pre-screen__menu">
            {([1, 2, 3] as const).map((slot) => {
              const info = props.saveSlots?.find((candidate) => candidate.slot === slot);
              const summary = info?.summary;
              return (
                <button
                  type="button"
                  key={slot}
                  data-testid={`title-load-slot-${slot}`}
                  disabled={!info?.exists || loadingSlot !== null}
                  onClick={() => void loadSlot(slot)}
                >
                  {loadingSlot === slot
                    ? `槽位 ${slot}：读取中……`
                    : info?.exists
                      ? `槽位 ${slot}：${summary ? `第${summary.day}日 · ${summary.place} · ${summary.name}` : "有存档"}`
                      : `槽位 ${slot}：空`}
                </button>
              );
            })}
          </div>
          {loadError && <p className="pre-screen__load-error" role="alert">{loadError}</p>}
          <button type="button" onClick={() => setShowLoadSlots(false)}>返回</button>
        </div>
      )}
      {props.onDev && (
        <button
          type="button"
          className="pre-screen__dev"
          data-testid="title-dev"
          onClick={props.onDev}
        >
          开发者工具
        </button>
      )}
    </section>
  );
}
