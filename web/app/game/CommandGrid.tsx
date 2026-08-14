/**
 * Phase 4.5D — CommandGrid (bottom zone, scene hub).
 *
 * Player-facing command grid. Internal IDs stay in data attributes and
 * dispatch payloads, but are not included in visible labels. Two button kinds:
 *   - exits → move to another location (dispatched as ISSUE_COMMAND by
 *     the parent; S1).
 *   - actions → COMF/SCOMF commands that open the interaction box (S4).
 *
 * Presentation-only: the parent owns the intent dispatch.
 */

import type { SceneExit } from "../../../modernization/runtime/scene/index.js";

/**
 * One action button. `usable` reflects the runtime `@COM_ABLE`/execCheck
 * gate (Phase 8 Slice 6); a blocked command is rendered greyed + disabled
 * with `reason` as its tooltip (the upstream behavior is "not shown", but
 * we let the parent decide via the `showBlocked` toggle).
 */
export interface CommandGridAction {
  commandNo: number;
  label: string;
  usable: boolean;
  reason?: string;
  /** Parity QA P-7 — @COM_ABLE passes but the @COM body is a deferred stub.
   *  Rendered greyed + labeled 「未实现」 (still clickable: clicking surfaces
   *  the "not yet modeled" NARRATION so the player gets feedback). */
  deferred?: boolean;
  /** A deliberately prominent, currently relevant action (COM351: take
   * the focused character along). */
  highlighted?: boolean;
}

/** A labeled group of actions (one command family). */
export interface CommandGridGroup {
  label: string;
  items: ReadonlyArray<CommandGridAction>;
}

export interface CommandGridProps {
  exits: ReadonlyArray<SceneExit>;
  /** Flat action list (legacy / single "行动" group). */
  actions?: ReadonlyArray<CommandGridAction>;
  /** Family-grouped actions; each renders under its own label header. When
   *  present, takes precedence over `actions`. */
  actionGroups?: ReadonlyArray<CommandGridGroup>;
  onExit: (commandNo: number) => void;
  onAction: (commandNo: number) => void;
  /** Parity QA P-22 — when a colored map exists for the current location,
   *  the 移動 group's PRIMARY entry is a "🗺 移动" button that opens the map
   *  menu (click → map → click destination), instead of flat-listing every
   *  reachable room below. `exits` then carries only the CROSS-MAP destinations
   *  (外出 to another map root) the map can't render as a clickable cell.
   *  When omitted (no map / unmapped area), the group falls back to the
   *  flat exit-button list. */
  onOpenMap?: () => void;
  /** Whether the map is currently shown (flips the entry's label to
   *  「返回场景」). */
  mapOpen?: boolean;
  /** Whether to render the 移动/外出 group at all (default true). The game
   *  client sets this `false` so the bottom zone is PURE Act_COM (settlement
   *  actions) and 移动/外出 live in the Ex_COM row instead — faithful to the
   *  original Act_COM / Ex_COM split (eratw_ui_mock.html). Standalone callers
   *  (and CommandGrid's own tests) keep the default exit group. */
  showExits?: boolean;
}

function ActionButtons(props: {
  items: ReadonlyArray<CommandGridAction>;
  onAction: (commandNo: number) => void;
}) {
  return (
    <>
      {props.items.map((action) => (
        <button
          key={action.commandNo}
          type="button"
          className={
            "command-grid__btn command-grid__btn--action" +
            (action.usable ? "" : " command-grid__btn--blocked") +
            (action.deferred ? " command-grid__btn--deferred" : "") +
            (action.highlighted ? " command-grid__btn--highlighted" : "")
          }
          data-testid="action-button"
          data-command-no={action.commandNo}
          data-usable={action.usable}
          data-deferred={action.deferred ? "true" : "false"}
          data-highlighted={action.highlighted ? "true" : "false"}
          disabled={!action.usable}
          title={action.usable ? (action.deferred ? "尚未建模（未实现）" : undefined) : action.reason}
          onClick={() => props.onAction(action.commandNo)}
        >
          {action.label}{action.deferred ? "（未实现）" : ""}
        </button>
      ))}
    </>
  );
}

export default function CommandGrid(props: CommandGridProps) {
  const groups: ReadonlyArray<CommandGridGroup> =
    props.actionGroups ??
    (props.actions && props.actions.length > 0
      ? [{ label: "Act_COM", items: props.actions }]
      : []);
  return (
    <div className="command-grid" data-testid="command-grid">
      {groups.map((g) => (
        <div className="command-grid__group" data-testid="command-actions" key={g.label}>
          <span className="command-grid__label">{g.label}</span>
          <ActionButtons items={g.items} onAction={props.onAction} />
        </div>
      ))}

      {props.showExits !== false && (
      <div className="command-grid__group" data-testid="command-exits">
        <span className="command-grid__label">移动</span>
        {props.onOpenMap && (
          <button
            type="button"
            className="command-grid__btn command-grid__btn--exit command-grid__btn--map"
            data-testid="open-map-button"
            onClick={props.onOpenMap}
          >
            {props.mapOpen ? "[返回场景]" : "[🗺 移动]"}
          </button>
        )}
        {/* When the map is the primary move interface (onOpenMap set), `exits`
            holds only the CROSS-MAP 外出 destinations the map can't render.
            When no map exists, `exits` is the full within-scene list (fallback). */}
        {props.exits.length === 0 && !props.onOpenMap ? (
          <span className="command-grid__empty">（无去处）</span>
        ) : (
          props.exits.map((exit) => (
            <button
              key={exit.commandNo}
              type="button"
              className="command-grid__btn command-grid__btn--exit"
              data-testid="exit-button"
              data-command-no={exit.commandNo}
              onClick={() => props.onExit(exit.commandNo)}
            >
              {exit.label}
            </button>
          ))
        )}
      </div>
      )}
    </div>
  );
}
