import { REGIONS, currentMapIdForLocation, regionByMapId } from "../regions.js";

export interface MinimalOutingListProps {
  currentLocation: string;
  /** Cross-map travel (handleWorldTravel — resolves 约会/外出/直接跨图
   *  commandNo and closes the surface). */
  onTravel: (commandNo: number) => void;
  onClose: () => void;
  /** movementBlocked || trainingMovementLocked: disable every destination. */
  blocked?: boolean;
}

/**
 * Minimal-mode 外出 surface: instead of the FIELD world character map, list
 * the 12 region destinations directly (built ones clickable, current region
 * and unbuilt 魔界 disabled — same semantics as WorldMapView).
 */
export default function MinimalOutingList(props: MinimalOutingListProps) {
  const { currentLocation, onTravel, onClose, blocked } = props;
  const currentMapId = currentMapIdForLocation(currentLocation);
  const currentRegion = currentMapId === null ? undefined : regionByMapId(currentMapId);

  return (
    <section className="minimal-outing-list" data-testid="minimal-outing-list" aria-label="外出（区域列表）">
      <header className="minimal-outing-list__header">
        <strong>外出</strong>
        <span className="minimal-outing-list__current" data-testid="minimal-outing-current">
          当前位置：{currentRegion?.label ?? "未知区域"}
        </span>
        <button type="button" className="minimal-outing-list__close" data-testid="minimal-outing-close" onClick={onClose}>
          [返回场景]
        </button>
      </header>
      <ul>
        {REGIONS.map((region) => {
          const isCurrent = region.mapId === currentMapId;
          const disabled = !region.built || isCurrent || blocked;
          return (
            <li key={region.mapId}>
              <button
                type="button"
                className="minimal-outing-list__btn"
                data-testid="minimal-outing-region"
                data-region={region.mapId}
                disabled={disabled}
                title={region.built ? (isCurrent ? "当前区域" : `前往${region.label}`) : "未实装"}
                onClick={() => region.commandNo != null && onTravel(region.commandNo)}
              >
                <strong>[{String(region.mapId).padStart(2, "0")}] {region.label}</strong>
                <span>{isCurrent ? "（当前）" : region.built ? "前往" : "（未实装）"}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
