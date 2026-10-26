import {
  getNamedStat,
  type GameState,
} from "../../../modernization/runtime/index.js";

export interface ImmersiveHudProps {
  state: GameState;
  target?: number;
  onOpenCharaInfo?: (charaNum: number) => void;
}

function locationLabel(location: string): string {
  const separator = location.indexOf(":");
  return separator < 0 ? location : location.slice(separator + 1);
}

function StatPill(props: { label: string; value: number; max: number; tone: "health" | "stamina" }) {
  const fill = props.max > 0 ? Math.max(0, Math.min(100, (props.value / props.max) * 100)) : 0;
  return (
    <span className={`immersive-hud__stat immersive-hud__stat--${props.tone}`}>
      <span className="immersive-hud__stat-label">{props.label}</span>
      <span className="immersive-hud__stat-track" aria-hidden="true">
        <span className="immersive-hud__stat-fill" style={{ width: `${fill}%` }} />
      </span>
      <span className="immersive-hud__stat-value">{props.value}/{props.max}</span>
    </span>
  );
}

/**
 * Player-facing HUD for the compact presentation mode. It deliberately
 * exposes only facts needed to make the next decision; the existing
 * GameStatusBar remains the full status surface.
 */
export default function ImmersiveHud(props: ImmersiveHudProps) {
  const { state } = props;
  const master = state.master;
  const targetSlot = props.target !== undefined && props.target > 0
    ? state.charas[props.target]
    : undefined;
  const minutes = String(state.time.tickValue % 60).padStart(2, "0");
  const hour = String(state.time.hourOfDay).padStart(2, "0");
  const masterHealth = getNamedStat(master.state, "体力");
  const masterStamina = getNamedStat(master.state, "気力");

  return (
    <header className="immersive-hud" data-testid="immersive-hud">
      <div className="immersive-hud__primary">
        <span className="immersive-hud__day">第 {state.time.dayIndex + 1} 天</span>
        <span className="immersive-hud__time" data-testid="immersive-hud-time">{hour}:{minutes}</span>
        <span className="immersive-hud__location" data-testid="immersive-hud-location">
          {locationLabel(master.location)}
        </span>
      </div>

      <div className="immersive-hud__secondary">
        <div className="immersive-hud__vitals" aria-label="玩家状态">
          <StatPill label="体力" value={masterHealth.value} max={masterHealth.max} tone="health" />
          <StatPill label="气力" value={masterStamina.value} max={masterStamina.max} tone="stamina" />
        </div>

        {targetSlot ? (
          <button
            type="button"
            className="immersive-hud__target"
            data-testid="immersive-target-info"
            onClick={() => props.onOpenCharaInfo?.(targetSlot.charaNum)}
            title="打开人物详情"
          >
            <span className="immersive-hud__target-name">
              {targetSlot.callName ?? `角色 ${targetSlot.charaNum}`}
            </span>
          </button>
        ) : null}
      </div>
    </header>
  );
}
