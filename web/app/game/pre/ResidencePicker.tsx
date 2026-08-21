import { useState, type ReactNode } from "react";
import { RESIDENCE_OPTIONS, type ResidenceOption } from "./newgame-draft.js";
import { RESIDENCE_REGIONS, regionByMapName } from "./residence-data.js";
import ColoredMapPreview from "./ColoredMapPreview.js";
import charasBundle from "../charas.bundle.json";

const CHARAS = charasBundle as Record<string, { callName?: string }>;

function callNameOf(charaNum: number): string {
  return CHARAS[String(charaNum)]?.callName ?? `角色${charaNum}`;
}

export interface ResidenceOptionState {
  disabled?: boolean;
  title?: string;
  status?: ReactNode;
}

export interface ResidencePickerProps {
  currentLocation?: string;
  onSelect?: (location: string) => void;
  optionState?: (option: ResidenceOption) => ResidenceOptionState | undefined;
  testIdPrefix?: string;
  optionTestId?: string;
  note?: ReactNode;
}

/**
 * The upstream SET_MAINHOME scene shared by the new-game picker and SHOP
 * [120]. Keep the map/region/candidate presentation in one place so the
 * in-game move page cannot regress to a flat duplicate of [102].
 */
export default function ResidencePicker({
  currentLocation,
  onSelect,
  optionState,
  testIdPrefix = "",
  optionTestId,
  note,
}: ResidencePickerProps) {
  const currentOption = RESIDENCE_OPTIONS.find((option) => option.value === currentLocation);
  const initialMap = currentOption?.mapName ?? RESIDENCE_REGIONS[0]!.mapName;
  const [mapName, setMapName] = useState(initialMap);
  const region = regionByMapName(mapName) ?? RESIDENCE_REGIONS[0]!;
  const candidates = RESIDENCE_OPTIONS.filter((option) => option.mapName === region.mapName);
  const testId = (suffix: string) => `${testIdPrefix}${suffix}`;

  return (
    <div className="residence-map-ui" data-testid={testId("residence-map-ui")}>
      <div className="residence-tabs" data-testid={testId("residence-tabs")}>
        {RESIDENCE_REGIONS.map((candidateRegion) => (
          <button
            key={candidateRegion.mapName}
            type="button"
            data-testid={testId("residence-region-tab")}
            data-map={candidateRegion.mapName}
            aria-pressed={candidateRegion.mapName === region.mapName}
            className={`residence-tab${candidateRegion.mapName === region.mapName ? " residence-tab--active" : ""}`}
            onClick={() => setMapName(candidateRegion.mapName)}
          >
            ■{candidateRegion.displayName}
          </button>
        ))}
      </div>

      <ColoredMapPreview mapKey={region.mapKey} testId={testId("residence-mappreview")} />

      <div className="residence-info" data-testid={testId("residence-info")}>
        <p className="residence-info__name">■{region.displayName}</p>
        <p className="residence-info__row">
          <span className="residence-info__key">设施：</span>
          {region.facilities.map((facility) => (
            <span key={facility} className="residence-info__tag">【{facility}】</span>
          ))}
        </p>
        <p className="residence-info__row">
          <span className="residence-info__key">居民：</span>
          {region.residentCharas.map((charaNum) => callNameOf(charaNum)).join("、")}
        </p>
        <p className="residence-info__row">
          <span className="residence-info__key">采集点：</span>
          {region.gathering ? region.gathering.join("　") : "无"}
        </p>
        <div className="residence-info__intro">
          {region.intro.map((line, index) => (
            <p key={index} className="residence-info__introline">{line}</p>
          ))}
        </div>
      </div>

      <div className="residence-map-ui__rule" />
      <p className="residence-map-ui__title">可以设定住处。想住在哪里呢？</p>
      {note ?? (
        <p className="residence-map-ui__note">
          第一天限定：可无视必要信赖度选择住的地点。之后搬家会按家主信赖度判定。
        </p>
      )}

      <div className="pre-screen__cards pre-screen__cards--residence">
        {candidates.map((option) => {
          const state = optionState?.(option);
          const active = option.value === currentLocation;
          return (
            <button
              key={option.value}
              type="button"
              data-testid={optionTestId ?? testId("residence-option")}
              data-location={option.value}
              aria-pressed={active}
              className={`pre-card${active ? " pre-card--active" : ""}`}
              disabled={state?.disabled || !onSelect}
              title={state?.title}
              onClick={() => onSelect?.(option.value)}
            >
              <span className="pre-card__label">{option.label}</span>
              <span className="pre-card__meta">
                [{String(option.roomCode).padStart(3, " ")}] - {option.roomName}
              </span>
              <span className="pre-card__meta">
                家主:{option.ownerName}　必要信赖度:{option.requiredTrust}
              </span>
              {state?.status && <span className="pre-card__meta">{state.status}</span>}
              <span className="pre-card__blurb">{option.blurb}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
