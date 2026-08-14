/**
 * #13 原版开场流程 — 居住地选择 (`@SET_MAINHOME` / `QOL_SET_MAINHOME`).
 *
 * 复刻原版 SET_MAINHOME 页面的丰富内容（不是捏造，全部来自源系统）：
 *   彩色地图(字符画) → ■地图名 → 设施 → 居民 → 采集点 → 简介(斜体) → 私室候補列表。
 * 数据来源见 `residence-data.ts`（逐字 Map紹介 / ROOMSETTING 设施 / CSV 自宅位置
 * 居民 / ForagePlaceName 采集点）；地图复用 `colored-maps.bundle.json`。
 *
 * 玩家先选地区（博丽神社 / 人間の里），再在该地区的私室候補里挑一间住下。每个候补
 * 是真实场景房间，由家主 + 居住必要信赖度决定（首日免判定）。
 */

import { useState } from "react";
import { usePreGameStore } from "../../state/pre-game-store.js";
import { RESIDENCE_OPTIONS } from "./newgame-draft.js";
import { RESIDENCE_REGIONS, regionByMapName } from "./residence-data.js";
import ColoredMapPreview from "./ColoredMapPreview.js";
import charasBundle from "../charas.bundle.json";

const CHARAS = charasBundle as Record<string, { callName?: string }>;

function callNameOf(charaNum: number): string {
  return CHARAS[String(charaNum)]?.callName ?? `角色${charaNum}`;
}

export interface ResidenceSelectProps {
  /** Build the state from the draft and enter the game. */
  onConfirm: () => void;
  onBack?: () => void;
}

export default function ResidenceSelect(props: ResidenceSelectProps) {
  const draft = usePreGameStore((s) => s.draft);
  const setDraft = usePreGameStore((s) => s.setDraft);

  // Default to the region the current 自宅 belongs to (the 私室候補's mapName).
  const currentOption = RESIDENCE_OPTIONS.find((o) => o.value === draft.homeLocation);
  const initialMap = currentOption?.mapName ?? RESIDENCE_REGIONS[0]!.mapName;
  const [mapName, setMapName] = useState(initialMap);

  const region = regionByMapName(mapName) ?? RESIDENCE_REGIONS[0]!;
  const candidates = RESIDENCE_OPTIONS.filter((o) => o.mapName === region.mapName);

  return (
    <section className="pre-screen pre-screen--residence" data-testid="screen-residence">
      <p className="pre-screen__lead">「住在哪里都随你喜欢。反正，真正想去的地方，总会有办法到达的。」</p>

      {/* 地区切换 (原版选地图) */}
      <div className="residence-tabs" data-testid="residence-tabs">
        {RESIDENCE_REGIONS.map((r) => (
          <button
            key={r.mapName}
            type="button"
            data-testid="residence-region-tab"
            data-map={r.mapName}
            aria-pressed={r.mapName === region.mapName}
            className={`residence-tab${r.mapName === region.mapName ? " residence-tab--active" : ""}`}
            onClick={() => setMapName(r.mapName)}
          >
            ■{r.displayName}
          </button>
        ))}
      </div>

      <div className="residence-map-ui" data-testid="residence-map-ui">
        {/* 字符画：复用真实彩色地图 */}
        <ColoredMapPreview mapKey={region.mapKey} testId="residence-mappreview" />

        {/* ■地图名 + 设施 + 居民 + 采集点 + 简介 (物件データ / Map紹介) */}
        <div className="residence-info" data-testid="residence-info">
          <p className="residence-info__name">■{region.displayName}</p>
          <p className="residence-info__row">
            <span className="residence-info__key">设施：</span>
            {region.facilities.map((f) => (
              <span key={f} className="residence-info__tag">【{f}】</span>
            ))}
          </p>
          <p className="residence-info__row">
            <span className="residence-info__key">居民：</span>
            {region.residentCharas.map((n) => callNameOf(n)).join("、")}
          </p>
          <p className="residence-info__row">
            <span className="residence-info__key">采集点：</span>
            {region.gathering ? region.gathering.join("　") : "无"}
          </p>
          <div className="residence-info__intro">
            {region.intro.map((line, i) => (
              <p key={i} className="residence-info__introline">{line}</p>
            ))}
          </div>
        </div>

        <div className="residence-map-ui__rule" />
        <p className="residence-map-ui__title">可以设定住处。想住在哪里呢？</p>
        <p className="residence-map-ui__note">
          第一天限定：可无视必要信赖度选择住的地点。之后搬家会按家主信赖度判定。
        </p>

        {/* 私室候補列表 */}
        <div className="pre-screen__cards pre-screen__cards--residence">
          {candidates.map((opt) => (
            <button
              key={opt.value}
              type="button"
              data-testid="residence-option"
              data-location={opt.value}
              aria-pressed={draft.homeLocation === opt.value}
              className={`pre-card${draft.homeLocation === opt.value ? " pre-card--active" : ""}`}
              onClick={() => setDraft({ homeLocation: opt.value })}
            >
              <span className="pre-card__label">{opt.label}</span>
              <span className="pre-card__meta">
                [{String(opt.roomCode).padStart(3, " ")}] - {opt.roomName}
              </span>
              <span className="pre-card__meta">
                家主:{opt.ownerName}　必要信赖度:{opt.requiredTrust}
              </span>
              <span className="pre-card__blurb">{opt.blurb}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="pre-screen__menu pre-screen__menu--nav">
        <button
          type="button"
          data-testid="residence-confirm"
          className="pre-screen__primary"
          onClick={props.onConfirm}
        >
          完成
        </button>
        {props.onBack && (
          <button type="button" data-testid="residence-back" onClick={props.onBack}>
            返回
          </button>
        )}
      </div>
    </section>
  );
}
