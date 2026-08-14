import type { GameState } from "../../../modernization/runtime/state";

/**
 * Phase 4C — StatusPanel.
 *
 * Read-only display of the current `GameState`. Stub-only — does no
 * settlement, no IPC. The parent (Phase 4D wiring) feeds a `GameState`
 * prop; this component just renders it.
 *
 * Three labeled sections:
 *   - "角色数值" — master's charaNum + location + count of non-empty
 *     numeric namespaces. The per-namespace identifiers are NOT named
 *     in this file (see `forbidden-names.test.ts`); we just iterate the
 *     seven keys of `master.state` and count how many entries each has.
 *   - "时间" — tickValue / dayIndex / hourOfDay from `time`.
 *   - "位置" — master's location string (Phase 4 master only; NPC
 *     locations belong to Phase 8 WorldScheduler).
 *
 * If every numeric namespace is empty, the "角色数值" section falls
 * back to "(empty)" so the panel still renders gracefully when a
 * fresh project has no observable state.
 */
export default function StatusPanel({ state }: { state: GameState }) {
  const master = state.master;
  const time = state.time;
  const recordCount = countNonEmptyMaps(master.state);

  return (
    <section
      className="status-panel"
      data-testid="status-panel"
      aria-label="当前游戏状态"
    >
      <h2 className="status-panel__title">当前游戏状态</h2>

      <div className="status-panel__section">
        <h3 className="status-panel__section-title">角色数值</h3>
        <dl className="status-panel__list">
          <div className="status-panel__row">
            <dt className="status-panel__key">角色编号</dt>
            <dd className="status-panel__value" data-testid="master-chara-num">
              {master.charaNum}
            </dd>
          </div>
          <div className="status-panel__row">
            <dt className="status-panel__key">记录</dt>
            <dd className="status-panel__value" data-testid="master-record-count">
              {recordCount > 0 ? `记录 ${recordCount} 项` : "(empty)"}
            </dd>
          </div>
        </dl>
      </div>

      <div className="status-panel__section">
        <h3 className="status-panel__section-title">时间</h3>
        <dl className="status-panel__list">
          <div className="status-panel__row">
            <dt className="status-panel__key">tick</dt>
            <dd className="status-panel__value" data-testid="time-tick">
              {time.tickValue}
            </dd>
          </div>
          <div className="status-panel__row">
            <dt className="status-panel__key">天数</dt>
            <dd className="status-panel__value" data-testid="time-day">
              {time.dayIndex}
            </dd>
          </div>
          <div className="status-panel__row">
            <dt className="status-panel__key">小时</dt>
            <dd className="status-panel__value" data-testid="time-hour">
              {time.hourOfDay}
            </dd>
          </div>
        </dl>
      </div>

      <div className="status-panel__section">
        <h3 className="status-panel__section-title">位置</h3>
        <dl className="status-panel__list">
          <div className="status-panel__row">
            <dt className="status-panel__key">master</dt>
            <dd className="status-panel__value" data-testid="master-location">
              {master.location || "(unknown)"}
            </dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

/**
 * Sum of `Object.keys(map).length` across every map in
 * `master.state`. We never spell out the namespace names — they
 * live inside `CharaSlotState`'s contract and are forbidden tokens
 * at the UI boundary. Iterating the object keeps the UI source free
 * of those literals.
 */
function countNonEmptyMaps(state: GameState["master"]["state"]): number {
  let total = 0;
  for (const value of Object.values(state)) {
    if (value && typeof value === "object") {
      total += Object.keys(value as Record<string, unknown>).length;
    }
  }
  return total;
}
