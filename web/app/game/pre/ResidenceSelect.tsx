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

import { usePreGameStore } from "../../state/pre-game-store.js";
import ResidencePicker from "./ResidencePicker.js";

export interface ResidenceSelectProps {
  /** Build the state from the draft and enter the game. */
  onConfirm: () => void;
  onBack?: () => void;
}

export default function ResidenceSelect(props: ResidenceSelectProps) {
  const draft = usePreGameStore((s) => s.draft);
  const setDraft = usePreGameStore((s) => s.setDraft);

  return (
    <section className="pre-screen pre-screen--residence" data-testid="screen-residence">
      <p className="pre-screen__lead">「住在哪里都随你喜欢。反正，真正想去的地方，总会有办法到达的。」</p>
      <ResidencePicker
        currentLocation={draft.homeLocation}
        onSelect={(homeLocation) => setDraft({ homeLocation })}
      />

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
