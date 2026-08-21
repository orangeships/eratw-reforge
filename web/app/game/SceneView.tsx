/**
 * Phase 4.5D — SceneView (middle zone, VN composition S3).
 *
 * Back-to-front layers:
 *   1. scene ASCII art — full-bleed dimmed backdrop (`<pre>`).
 *   2. present立绘 — at most seven portraits at this location (S2); the
 *      roster strip still exposes every present NPC for target switching.
 *   3. narrative band — the recent eventLog tail, color-coded by kind
 *      (S3). Reuses `formatEvent` from the TextWindow.
 *
 * Presentation-only: no store reads, no intent dispatch. The parent
 * (GameClient) passes the scene, the computed present charas, and the
 * band events.
 */

import type { SceneAsset } from "../../../modernization/runtime/scene/index.js";
import { useState } from "react";
import type { CharaSlot } from "../../../modernization/runtime/state/index.js";
import type { ObservationEvent } from "../../../modernization/schemas/types.js";
import kojoColors from "./kojo-colors.bundle.json";
import portraits from "./portraits.bundle.json";
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
import { portraitForDynamicCharacter } from "../../../modernization/runtime/world/dynamic-portraits.js";
import MobPortrait from "./MobPortrait.js";
import type { SceneAmbientEntry } from "../ai/types.js";
import { SceneHistoryPanel } from "./SceneSidebar.js";

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
  /** Disposable AI scene prose. This is never sourced from eventLog. */
  ambientEntry?: SceneAmbientEntry | null;
  /** Classic-compatible inline history. Immersive three-column callers turn
   * this off and render the same history component in the right column. */
  showInlineHistory?: boolean;
  /** Classic-compatible inline scene-interaction presentation. When false it
   * also hides portrait dialogue unless `showPortraitAmbient` overrides it. */
  showInlineAmbient?: boolean;
  /** Character-dialogue presentation above the participating portrait. This
   * lets the three-column shell keep speech over the character while moving
   * scene-interaction prose into the right column. */
  showPortraitAmbient?: boolean;
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

const MAX_STAGE_NPCS = 7;

/**
 * Resolve a chara's display name. Live slots carry `callName` (from
 * `CSV/Chara/*.csv` via `buildCharaSlot`); test fixtures may omit it,
 * in which case we fall back to `#<charaNum>`.
 */
function charaName(chara: CharaSlot): string {
  return chara.callName ?? `#${chara.charaNum}`;
}

function hasAuthoredIntro(intro: string): boolean {
  return intro.trim().length > 0 && !intro.startsWith("[not-authored:");
}

function stagedNpcOrder(
  npcsPresent: readonly CharaSlot[],
  selectedChara: number | undefined,
  ambientEntry: SceneAmbientEntry | null | undefined,
): CharaSlot[] {
  const byId = new Map(npcsPresent.map((chara) => [chara.charaNum, chara]));
  const requiredIds: number[] = [];
  if (selectedChara !== undefined && byId.has(selectedChara)) requiredIds.push(selectedChara);
  for (const participantId of ambientEntry?.participantIds ?? []) {
    if (byId.has(participantId) && !requiredIds.includes(participantId)) requiredIds.push(participantId);
  }
  const displayed = requiredIds
    .map((charaNum) => byId.get(charaNum))
    .filter((chara): chara is CharaSlot => chara !== undefined);
  for (const chara of npcsPresent) {
    if (displayed.length >= MAX_STAGE_NPCS) break;
    if (!displayed.some((entry) => entry.charaNum === chara.charaNum)) displayed.push(chara);
  }

  const selectedNpc = displayed.find((chara) => chara.charaNum === selectedChara);
  if (!selectedNpc) return displayed;
  const otherNpcs = displayed.filter((chara) => chara.charaNum !== selectedNpc.charaNum);
  const selectedInsertAt = Math.floor(otherNpcs.length / 2);
  return [
    ...otherNpcs.slice(0, selectedInsertAt),
    selectedNpc,
    ...otherNpcs.slice(selectedInsertAt),
  ];
}

export default function SceneView(props: SceneViewProps) {
  const [clickedExpressions, setClickedExpressions] = useState<Record<number, PortraitExpression>>({});
  const { scene, present } = props;
  // Parity QA P-30a — the master (charaNum 0) is never drawn on stage. Filter
  // it out so the portrait row only ever shows NPCs.
  const npcsPresent = present.filter((c) => c.charaNum !== 0);
  // The roster is unbounded, but the stage is deliberately capped at seven
  // slots. Selection and current ambient participants are reserved first;
  // remaining slots follow the stable present-roster order.
  const stagedNpcs = stagedNpcOrder(npcsPresent, props.selectedChara, props.ambientEntry);
  if (!scene) {
    return (
      <div className="scene-view scene-view--empty" data-testid="scene-view">
        <p className="scene-view__missing" data-testid="scene-missing">
          （此处没有场景）
        </p>
      </div>
    );
  }

  const authoredIntro = hasAuthoredIntro(scene.intro);

  return (
    <div className="scene-view" data-testid="scene-view" data-scene-id={scene.id}>
      {/* The authored scene intro belongs to the room, not to its current NPC
          occupancy. ASCII art remains hidden per the compact UI policy. */}
      {authoredIntro && (
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
        {npcsPresent.length > 0 && (
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
                disabled={!props.onSelectChara}
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
              const showPortraitAmbient = props.showPortraitAmbient ?? (props.showInlineAmbient !== false);
              const portraitDialogueLines = showPortraitAmbient &&
                props.ambientEntry?.mode === "character-dialogue" &&
                props.ambientEntry.participantIds.includes(chara.charaNum)
                ? props.ambientEntry.lines.filter((line) => line.participantId === chara.charaNum)
                : [];
              const dialogueColor = KOJO_COLORS[String(chara.charaNum)];
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
                  {portraitDialogueLines.length > 0 && (
                    <div
                      className="scene-view__portrait-dialogue"
                      data-testid="scene-portrait-dialogue"
                      data-chara={chara.charaNum}
                      aria-live="polite"
                    >
                      <span
                        className="scene-view__portrait-dialogue-name"
                        style={dialogueColor ? { color: dialogueColor } : undefined}
                      >
                        {charaName(chara)}
                      </span>
                      {portraitDialogueLines.map((line, index) => (
                        <span
                          className="scene-view__portrait-dialogue-line"
                          key={`${line.participantId}:${index}`}
                        >
                          {line.text}
                        </span>
                      ))}
                    </div>
                  )}
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

      {props.showInlineAmbient !== false && props.ambientEntry?.mode === "scene-interaction" && props.ambientEntry.lines.length > 0 && (
        <div
          className="scene-view__initiative"
          data-testid="scene-ambient-initiative"
          data-mode="scene-interaction"
          data-complete={props.ambientEntry.complete ? "true" : "false"}
          aria-live="polite"
        >
          {props.ambientEntry.lines.map((line, index) => {
            const speaker = props.state?.charas[line.participantId];
            const color = line.form === "speech" ? KOJO_COLORS[String(line.participantId)] : undefined;
            return (
              <p
                key={`${line.participantId}:${line.form}:${index}`}
                className={`scene-view__initiative-line scene-view__initiative-line--${line.form}`}
                style={color ? { color } : undefined}
              >
                {line.form === "speech" && (
                  <span className="scene-view__initiative-speaker">
                    {speaker ? charaName(speaker) : `#${line.participantId}`}
                  </span>
                )}
                {line.text}
              </p>
            );
          })}
        </div>
      )}

      {props.showInlineHistory !== false && (
        <SceneHistoryPanel
          events={props.bandEvents}
          state={props.state}
          max={props.bandMax}
          placement="inline"
        />
      )}
    </div>
  );
}
