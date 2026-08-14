/**
 * Phase 4.5D — SceneView (middle zone, VN composition S3).
 *
 * Back-to-front layers:
 *   1. scene ASCII art — full-bleed dimmed backdrop (`<pre>`).
 *   2. present立绘 — one portrait per chara at this location (S2).
 *      4.5 renders placeholder boxes; real sprite wiring is a later
 *      cosmetic pass (Phase 2.2 resources manifest).
 *   3. narrative band — the recent eventLog tail, color-coded by kind
 *      (S3). Reuses `formatEvent` from the TextWindow.
 *
 * Presentation-only: no store reads, no intent dispatch. The parent
 * (GameClient) passes the scene, the computed present charas, and the
 * band events.
 */

import type { SceneAsset } from "../../../modernization/runtime/scene/index.js";
import { useEffect, useRef, useState } from "react";
import type { CharaSlot } from "../../../modernization/runtime/state/index.js";
import type { ObservationEvent } from "../../../modernization/schemas/types.js";
import { formatEvent } from "../components/TextWindow.js";
import kojoColors from "./kojo-colors.bundle.json";
import portraits from "./portraits.bundle.json";
import { isMovementNarration, isPlayerVisibleEvent } from "./player-visible-events.js";
import SpriteCrop from "./SpriteCrop.js";
import {
  dimensionForKind,
  nextClickExpression,
  portraitForExpression,
  portraitKind,
  statePortraitExpression,
  type PortraitExpression,
  type PortraitSource,
} from "./portrait-expression.js";
import PortraitCommissionBadge from "./PortraitCommissionBadge.js";
import type { GameState } from "../../../modernization/runtime/state/game-state.js";
import { formatGameEvent } from "./event-format.js";
import { portraitForDynamicCharacter } from "../../../modernization/runtime/world/dynamic-portraits.js";
import MobPortrait from "./MobPortrait.js";

/** Parity QA P-25 — per-chara dialogue color (charaNum → "#RRGGBB"), built
 *  from each character's `@M_KOJO..._COLOR_K{N}` SETCOLOR by
 *  `build-kojo-colors.ts`. Charas without a color fall back to the default. */
const KOJO_COLORS = kojoColors as Record<string, string>;

/** Parity QA P-30b — per-chara default sprite metadata, resolved from eraTW's
 *  `初期立绘/立ち絵.xml` by `build-portraits.ts`. The rect is the source-system
 *  `SPRITECREATE` crop. Outfit/face/expression selection is still deferred. */
const PORTRAITS = portraits as unknown as Record<string, PortraitSource>;

export interface SceneViewProps {
  scene: SceneAsset | null;
  present: CharaSlot[];
  /** The eventLog; the band shows the last `bandMax` entries. */
  bandEvents: ReadonlyArray<ObservationEvent>;
  bandMax?: number;
  /**
   * Phase 8.6 — the currently-selected target charaNum (for interaction).
   * The matching portrait is highlighted. When omitted, no portrait is
   * highlighted.
   */
  selectedChara?: number;
  /** Phase 8.6 — click a present NPC portrait to make it the target. */
  onSelectChara?: (charaNum: number) => void;
  /** Commission popup wiring — the parent (GameClient) provides state so the
   *  SceneView can read commissionStatus() and surface a "?" badge. Click on
   *  the badge opens the popup; this callback receives the charaNum. */
  state?: Readonly<GameState>;
  onCommissionClick?: (charaNum: number) => void;
  /** Parity QA — flip 立絵種類 (立絵↔顔絵) when the player clicks the CURRENT
   *  TARGET's portrait (eraTW USERCOM.ERB:433-436). Optional; when absent the
   *  TARGET click falls back to the select-only behavior. */
  onTogglePortraitKind?: () => void;
}

const DEFAULT_BAND_MAX = 20;

/**
 * Resolve a chara's display name. Live slots carry `callName` (from
 * `CSV/Chara/*.csv` via `buildCharaSlot`); test fixtures may omit it,
 * in which case we fall back to `#<charaNum>`.
 */
function charaName(chara: CharaSlot): string {
  return chara.callName ?? `#${chara.charaNum}`;
}

export default function SceneView(props: SceneViewProps) {
  const bandRef = useRef<HTMLDivElement | null>(null);
  const [clickedExpressions, setClickedExpressions] = useState<Record<number, PortraitExpression>>({});
  const { scene, present } = props;
  // Parity QA P-30a — the master (charaNum 0) is never drawn on stage. Filter
  // it out so the portrait row only ever shows NPCs.
  const npcsPresent = present.filter((c) => c.charaNum !== 0);
  const selectedNpc = npcsPresent.find((chara) => chara.charaNum === props.selectedChara);
  // Keep every present NPC visible. Place the selected target in the middle of
  // the render order so flex centering keeps it visually central; crowded
  // scenes deliberately overflow like the original rather than shrinking art.
  const otherNpcs = selectedNpc
    ? npcsPresent.filter((chara) => chara.charaNum !== selectedNpc.charaNum)
    : npcsPresent;
  const selectedInsertAt = Math.floor(otherNpcs.length / 2);
  const stagedNpcs = selectedNpc
    ? [...otherNpcs.slice(0, selectedInsertAt), selectedNpc, ...otherNpcs.slice(selectedInsertAt)]
    : npcsPresent;
  const bandMax = props.bandMax ?? DEFAULT_BAND_MAX;
  const playerVisibleBandEvents = props.bandEvents.filter(isPlayerVisibleEvent);
  const band =
    playerVisibleBandEvents.length > bandMax
      ? playerVisibleBandEvents.slice(playerVisibleBandEvents.length - bandMax)
      : playerVisibleBandEvents;

  useEffect(() => {
    const el = bandRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [band.length]);

  if (!scene) {
    return (
      <div className="scene-view scene-view--empty" data-testid="scene-view">
        <p className="scene-view__missing" data-testid="scene-missing">
          （此处没有场景）
        </p>
      </div>
    );
  }

  return (
    <div className="scene-view" data-testid="scene-view" data-scene-id={scene.id}>
      {/* The authored scene intro belongs to the room, not to its current NPC
          occupancy. ASCII art remains hidden per the compact UI policy. */}
      {scene.intro && (
        <div className="scene-view__ascii" data-testid="scene-ascii">
          <p className="scene-view__intro">{scene.intro}</p>
        </div>
      )}
      {/* `@LOOK_AT` 动态场景散文 (MAP_UNIQUEMESSAGE / MESSAGE_TALK) — a lighter
          layer under the intro: what is happening here right now. */}
      {scene.ambientProse && (
        <div className="scene-view__ambient" data-testid="scene-ambient">
          <p>{scene.ambientProse}</p>
        </div>
      )}

      <div className="scene-view__stage" data-testid="scene-stage">
        <div className="scene-view__place">{scene.displayName}</div>
        {npcsPresent.length > 0 && props.onSelectChara && (
          <div className="scene-view__roster" data-testid="scene-roster" aria-label="在场人物">
            {npcsPresent.map((chara) => (
              <button
                key={chara.charaNum}
                type="button"
                className={
                  "scene-view__roster-name" +
                  (props.selectedChara === chara.charaNum ? " scene-view__roster-name--selected" : "")
                }
                data-testid="scene-roster-name"
                data-chara={chara.charaNum}
                aria-pressed={props.selectedChara === chara.charaNum}
                onClick={() => props.onSelectChara?.(chara.charaNum)}
              >
                {charaName(chara)}
              </button>
            ))}
          </div>
        )}
        <div className="scene-view__portraits" data-testid="scene-portraits">
          {/* Parity QA P-30a — the MASTER (charaNum 0) has NO portrait (and no
              placeholder box): the player-character is never drawn on stage,
              faithful to eraTW. Only NPCs get立绘. "Empty" means no NPC is
              present (the master being here doesn't count). */}
          {npcsPresent.length === 0 ? (
            <div className="scene-view__portrait scene-view__portrait--empty">（无人）</div>
          ) : (
            stagedNpcs.map((chara) => {
              const selected = props.selectedChara === chara.charaNum;
              const selectable = !!props.onSelectChara;
              const portrait = PORTRAITS[String(chara.charaNum)];
              // 立絵種類: face dimension when 顔絵 is active (needs state;
              // presentation-only calls without state default to 立絵).
              const kind = props.state ? portraitKind(props.state) : "standing";
              const dimension = dimensionForKind(portrait, kind);
              const stateExpression = props.state
                ? statePortraitExpression(props.state, chara.charaNum)
                : "normal";
              const expression = stateExpression === "normal"
                ? clickedExpressions[chara.charaNum] ?? "normal"
                : stateExpression;
              const portraitSource = portraitForExpression(dimension, expression);
              const dynamicPortrait = props.state
                ? portraitForDynamicCharacter(props.state, chara.charaNum)
                : undefined;
              // eraTW USERCOM.ERB:433-436: clicking the CURRENT TARGET's
              // portrait flips 立絵種類; clicking another chara selects it as
              // the target. The old cosmetic click-expression cycle is gone
              // (upstream has no such behavior).
              const selectPortrait = (): void => {
                if (!selectable) return;
                if (selected && props.onTogglePortraitKind) {
                  props.onTogglePortraitKind();
                  return;
                }
                if (stateExpression === "normal") {
                  setClickedExpressions((current) => ({
                    ...current,
                    [chara.charaNum]: nextClickExpression(dimension, current[chara.charaNum]),
                  }));
                }
                props.onSelectChara?.(chara.charaNum);
              };
              return (
                <button
                  type="button"
                  key={chara.charaNum}
                  className={
                    "scene-view__portrait" +
                    (selected ? " scene-view__portrait--selected" : "") +
                    (selectable ? " scene-view__portrait--selectable" : "")
                  }
                  data-testid="scene-portrait"
                  data-chara={chara.charaNum}
                  data-selected={selected ? "true" : undefined}
                  disabled={!selectable}
                  onClick={selectable ? selectPortrait : undefined}
                >
                  {/* P-30b — real立绘 when we have one (charaNum → webp from
                      初期立绘), else the P-30a silhouette fallback. The master
                      is filtered out above so this never renders for the player. */}
                  {dynamicPortrait ? (
                    <MobPortrait
                      className="scene-view__portrait-img scene-view__portrait-img--real scene-view__portrait-img--mob"
                      portrait={dynamicPortrait}
                      expression={expression === "angry" || expression === "smile" ? expression : "normal"}
                      alt={charaName(chara)}
                      testId="scene-mob-portrait"
                    />
                  ) : portraitSource ? (
                    <SpriteCrop
                      className="scene-view__portrait-img scene-view__portrait-img--real"
                      source={portraitSource}
                      alt={charaName(chara)}
                      cropTestId="scene-portrait-crop"
                      imageTestId="scene-portrait-img"
                    />
                  ) : (
                    <span className="scene-view__portrait-img" aria-hidden="true" />
                  )}
                  <span className="scene-view__portrait-name">{charaName(chara)}</span>
                  {/* Commission badge — sits in the top-right corner of the
                      portrait cell. Only renders when the parent supplied
                      `state` and the chara has commission-related state. The
                      badge stops propagation so it doesn't also select the
                      portrait. */}
                  {props.state && props.onCommissionClick && (
                    <PortraitCommissionBadge
                      state={props.state}
                      charaNum={chara.charaNum}
                      onClick={props.onCommissionClick}
                    />
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>

      <div className="scene-view__band" data-testid="scene-band" ref={bandRef}>
        {band.length === 0 ? (
          <p className="scene-view__band-empty">……</p>
        ) : (
          band.map((event, i) => {
            // P-25 — tint spoken lines by the speaker's color.
            const color =
              event.kind === "DIALOGUE_LINE"
                ? KOJO_COLORS[String(event.charaNum)]
                : undefined;
            return (
              <p
                key={i}
                className={`scene-view__line scene-view__line--${event.kind}${isMovementNarration(event) ? " scene-view__line--movement" : ""}`}
                data-event-kind={event.kind}
                style={color ? { color } : undefined}
              >
                {props.state ? formatGameEvent(event, props.state) : formatEvent(event)}
              </p>
            );
          })
        )}
      </div>
    </div>
  );
}
