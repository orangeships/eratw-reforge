import { usePreGameStore } from "../../state/pre-game-store.js";
import IntroText from "./IntroText.js";
import PlayerTalentSetup from "./PlayerTalentSetup.js";

export interface MinimalNewGameScreenProps {
  /** Commit the default draft + entered name/player traits and enter the game
   *  (App: setDraft({ homeLocation: "神社:居間" }) → newGame → kojoUpdate). */
  onStart: () => void;
  onBack: () => void;
}

/**
 * Minimal-mode new-game opening: collect the protagonist's name and the compact
 * player-facing TALENT projection. Other identity fields, abilities, kojo packs
 * and residence keep their defaults (residence = 神社:居間, set by the App
 * handler); the deterministic UPDATE_K 角色初始化 still runs afterwards.
 */
export default function MinimalNewGameScreen(props: MinimalNewGameScreenProps) {
  const draft = usePreGameStore((s) => s.draft);
  const setDraft = usePreGameStore((s) => s.setDraft);
  const canStart = draft.callName.trim().length > 0;

  return (
    <section
      className="pre-screen pre-screen--setup pre-screen--minimal"
      data-testid="screen-minimal-newgame"
    >
      <h2 className="pre-screen__field-title">开始游戏</h2>
      {/* 紫色开场白，与完整开场的八云紫语气一致；stagger 0 = 立即显示。 */}
      <IntroText
        lines={[{ text: "告诉我该怎么称呼你，再挑几项最像你的素质吧。", color: "#c9a4ff" }]}
        testId="minimal-newgame-intro"
        stagger={0}
      />

      <div className="pre-screen__field" data-testid="minimal-newgame-page">
        <h3 className="pre-screen__field-title">称呼</h3>
        <input
          className="pre-screen__input"
          data-testid="callname-input"
          value={draft.callName}
          maxLength={16}
          onChange={(e) => setDraft({ callName: e.target.value })}
          placeholder="主人公"
        />
      </div>

      <div
        className="pre-screen__field pre-screen__field--talents"
        data-testid="newgame-page-talent"
      >
        <h3 className="pre-screen__field-title">玩家角色素质</h3>
        <PlayerTalentSetup />
      </div>

      <div className="pre-screen__menu pre-screen__menu--nav">
        <button
          type="button"
          data-testid="minimal-newgame-start"
          className="pre-screen__primary"
          disabled={!canStart}
          onClick={props.onStart}
        >
          开始游戏 →
        </button>
        <button type="button" data-testid="minimal-newgame-back" onClick={props.onBack}>
          返回标题
        </button>
      </div>
    </section>
  );
}
