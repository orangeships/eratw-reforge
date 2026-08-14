import { useState } from "react";
import {
  defaultFishingGear,
  FISHING_LINES,
  FISHING_RODS,
  type GameState,
} from "../../../modernization/runtime/state/index.js";
import { useGameStateStore } from "../state/game-state-store.js";
import { useSceneStore } from "../state/scene-store.js";

export default function FishingTackleShop({ state, onClose }: { state: GameState; onClose: () => void }) {
  const buy = useGameStateStore((store) => store.buyFishingGearAction);
  const setScreen = useSceneStore((store) => store.setScreen);
  const [message, setMessage] = useState("霖之助把几件用途明确的钓具摆到了柜台上。");
  const gear = state.fishingGear ?? defaultFishingGear((state.items?.[37] ?? 0) > 0);
  const returnToTitle = () => {
    onClose();
    setScreen("title");
  };
  return <div className="tackle-shop__scrim" role="dialog" aria-label="香霖堂钓具柜台">
    <section className="tackle-shop">
      <header><div><small>KOURINDOU / TACKLE</small><h2>香霖堂钓具柜台</h2></div><strong>{state.money.toLocaleString()} 円</strong></header>
      <p className="tackle-shop__message">{message}</p>
      <div className="tackle-shop__columns">
        <div><h3>ROD / 鱼竿</h3>{FISHING_RODS.map((rod) => {
          const owned = gear.ownedRods[rod.id] === true;
          const equipped = gear.equippedRod === rod.id && owned;
          return <button key={rod.id} type="button" className={equipped ? "is-equipped" : ""} onClick={() => setMessage(buy("rod", rod.id).message)}>
            <span><b>{rod.name}</b><small>{rod.description}</small><em>POWER +{rod.power} / CONTROL ×{rod.control.toFixed(2)}</em></span>
            <strong>{equipped ? "EQUIPPED" : owned ? "装备" : `${rod.price.toLocaleString()} 円`}</strong>
          </button>;
        })}</div>
        <div><h3>LINE / 鱼线</h3>{FISHING_LINES.map((line) => {
          const durability = gear.lineSpools[line.id] ?? 0;
          const equipped = gear.equippedLine === line.id && durability > 0;
          return <button key={line.id} type="button" className={equipped ? "is-equipped" : ""} onClick={() => setMessage(buy("line", line.id).message)}>
            <span><b>{line.name}</b><small>{line.description}</small><em>LIMIT ×{line.tension.toFixed(2)} / DURABILITY {line.maxDurability}</em></span>
            <strong>{equipped ? `${durability} / 补充 ${line.price.toLocaleString()} 円` : `${line.price.toLocaleString()} 円`}</strong>
          </button>;
        })}</div>
      </div>
      <footer>
        <button type="button" onClick={returnToTitle} data-testid="tackle-shop-return-title">返回标题</button>
      </footer>
    </section>
  </div>;
}
