import { usePreGameStore } from "../../state/pre-game-store.js";
import {
  PLAYER_TALENT,
  anataTalentSelectable,
  talentLevelLabel,
} from "./newgame-talent.js";

/** Compact, shared player-facing TALENT editor for both opening modes. */
export default function PlayerTalentSetup() {
  const draft = usePreGameStore((state) => state.draft);
  const setDraft = usePreGameStore((state) => state.setDraft);
  const talents = PLAYER_TALENT.filter((talent) =>
    anataTalentSelectable(talent, draft.gender, draft.talent));
  const levels = talents.filter((talent) => talent.kind === "level");
  const toggles = talents.filter((talent) => talent.kind === "toggle");

  const setTalent = (id: number, value: number): void => {
    setDraft({ talent: { ...draft.talent, [id]: value } });
  };

  return (
    <div className="player-talent-editor" data-testid="talent-list">
      <div className="pre-screen__talent-list">
        {levels.map((talent) => {
          const current = draft.talent[talent.id] ?? 0;
          return (
            <div
              key={talent.id}
              className="talent-row"
              data-testid="talent-row"
              data-talent={talent.id}
            >
              <span className="talent-row__name">{talent.name}</span>
              <span className="talent-row__chips">
                {talent.values.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={`talent-chip${current === value ? " talent-chip--active" : ""}`}
                    data-testid="talent-chip"
                    data-value={value}
                    aria-pressed={current === value}
                    onClick={() => setTalent(talent.id, value)}
                  >
                    {talentLevelLabel(talent, value)}
                  </button>
                ))}
              </span>
            </div>
          );
        })}
      </div>

      <div className="pre-screen__talent-toggles" aria-label="可选性格标签">
        {toggles.map((talent) => {
          const active = (draft.talent[talent.id] ?? 0) !== 0;
          return (
            <button
              key={talent.id}
              type="button"
              className={`talent-toggle${active ? " talent-toggle--active" : ""}`}
              data-testid="talent-toggle"
              data-talent={talent.id}
              aria-pressed={active}
              onClick={() => setTalent(talent.id, active ? 0 : 1)}
            >
              {talentLevelLabel(talent, 1)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
