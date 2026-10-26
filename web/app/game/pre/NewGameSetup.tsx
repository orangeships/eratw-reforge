/**
 * #13 原版开场流程 — identity setup (`@NEWGAME_MAKE`, 扮演模式 only).
 *
 * Faithful to the 原版 ANATA identity step:
 *   - the DQPRINT intro (NEWGAME_MAKE_SPECIAL, verbatim) sets the scene;
 *   - 称呼 = `CALLNAME:MASTER`;
 *   - 性別 = `@NEWGAME_MAKE_INIT` 身体设定 (性別 1/2/3);
 *   - 能力 = `@CUSTOM_TERMINAL` → `@CUSTOM_ABL` (each ability 0..2, gender-gated
 *     百合/断袖 per `@CUSTOM_選べない能力`);
 *   - 素质 = `@CUSTOM_TALENT` (slice 3a: leveled 性格 ladders, 中立 default);
 *   - 经验/基础 use their deterministic defaults and are deliberately not
 *     exposed by the player-facing setup flow.
 *
 * 魔法版 (NARIKIRI) is dropped per user. All choices write the `pre-game-store`
 * draft.
 */

import { useState } from "react";
import { usePreGameStore } from "../../state/pre-game-store.js";
import {
  ANATA_ABL,
  ANATA_ABL_MAX,
  anataAblSelectable,
  GENDER_OPTIONS,
  type Gender,
} from "./newgame-draft.js";
import { filterDraftTalentForGender } from "./newgame-talent.js";
import IntroText, { type IntroLine } from "./IntroText.js";
import PlayerTalentSetup from "./PlayerTalentSetup.js";

// #13 — opening narration in the voice of 八雲紫 (Yukari Yakumo): the gap
// youkai who draws outsiders across the border into 幻想郷. Languid, teasing,
// fond of「境界」metaphors. Her signature violet tints the lines; the closing
// question is the golden emphasis. (Background stays pure black.)
const INTRO: IntroLine[] = [
  { text: "「啊啦，醒了吗？比我想的还要早一点呢。」", color: "#c9a4ff" },
  { text: "「这里是幻想乡。至于你为什么会在这里……呵呵，这种小事就先别在意了。」", color: "#c9a4ff" },
  { text: "「毕竟，把你带过来的人是我。放心吧，我暂时还没有把你送回去的打算。」", color: "#b388ff" },
  { text: "「既然都已经来了——至少先告诉我，我该怎么称呼你？」", color: "#ffd36e", emphasis: true },
];

const SETUP_PAGES = [
  { id: "profile", label: "称呼" },
  { id: "ability", label: "能力" },
  { id: "talent", label: "素质" },
] as const;

export interface NewGameSetupProps {
  onNext: () => void;
  onBack: () => void;
}

export default function NewGameSetup(props: NewGameSetupProps) {
  const draft = usePreGameStore((s) => s.draft);
  const setDraft = usePreGameStore((s) => s.setDraft);
  const [pageIndex, setPageIndex] = useState(0);
  const page = SETUP_PAGES[pageIndex]!;
  const isFirstPage = pageIndex === 0;
  const isLastPage = pageIndex === SETUP_PAGES.length - 1;

  const setAbl = (id: number, level: number): void => {
    setDraft({ abl: { ...draft.abl, [id]: level } });
  };
  /** 性别切换 → 剔除被门控失效的 talent 项. */
  const pickGender = (next: Gender): void => {
    setDraft({
      gender: next,
      talent: filterDraftTalentForGender(draft.talent, next),
    });
  };

  const goBack = (): void => {
    if (isFirstPage) {
      props.onBack();
      return;
    }
    setPageIndex((i) => Math.max(0, i - 1));
  };

  const goNext = (): void => {
    if (isLastPage) {
      props.onNext();
      return;
    }
    setPageIndex((i) => Math.min(SETUP_PAGES.length - 1, i + 1));
  };

  return (
    <section className="pre-screen pre-screen--setup" data-testid="screen-newgame">
      <IntroText lines={INTRO} testId="newgame-intro" />

      {page.id === "profile" && (
        <>
          <div className="pre-screen__field" data-testid="newgame-page-profile">
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

          <div className="pre-screen__field">
            <h3 className="pre-screen__field-title">想要一副怎样的身躯呢？❤</h3>
            <div className="pre-screen__menu">
              {GENDER_OPTIONS.map((opt) => (
                <button
                  key={opt.gender}
                  type="button"
                  data-testid="gender-option"
                  data-gender={opt.gender}
                  aria-pressed={draft.gender === opt.gender}
                  className={draft.gender === opt.gender ? "is-active" : undefined}
                  onClick={() => pickGender(opt.gender as Gender)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {page.id === "ability" && (
        <div className="pre-screen__field" data-testid="newgame-page-ability">
          <h3 className="pre-screen__field-title">能力</h3>
          <div className="pre-screen__abl-grid" data-testid="abl-grid">
            {ANATA_ABL.filter((a) => anataAblSelectable(a, draft.gender)).map((a) => {
              const lv = draft.abl[a.id] ?? 0;
              return (
                <div key={a.id} className="abl-row" data-testid="abl-row" data-abl={a.id}>
                  <span className="abl-row__name">{a.name}</span>
                  <button
                    type="button"
                    className="abl-row__step"
                    data-testid="abl-dec"
                    aria-label={`${a.name} 减少`}
                    disabled={lv <= 0}
                    onClick={() => setAbl(a.id, lv - 1)}
                  >
                    －
                  </button>
                  <span className="abl-row__lv" data-testid="abl-level">
                    {lv}
                  </span>
                  <button
                    type="button"
                    className="abl-row__step"
                    data-testid="abl-inc"
                    aria-label={`${a.name} 增加`}
                    disabled={lv >= ANATA_ABL_MAX}
                    onClick={() => setAbl(a.id, lv + 1)}
                  >
                    ＋
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {page.id === "talent" && (
        <div className="pre-screen__field pre-screen__field--talents" data-testid="newgame-page-talent">
          <h3 className="pre-screen__field-title">玩家角色素质</h3>
          <PlayerTalentSetup />
        </div>
      )}

      <div className="pre-screen__menu pre-screen__menu--nav">
        <button
          type="button"
          data-testid="newgame-done"
          className="pre-screen__primary"
          disabled={draft.callName.trim().length === 0}
          onClick={goNext}
        >
          {isLastPage ? "确定，前往下一步 →" : `继续：${SETUP_PAGES[pageIndex + 1]?.label ?? ""} →`}
        </button>
        <button type="button" data-testid="newgame-back" onClick={goBack}>
          {isFirstPage ? "返回标题" : "← 返回上一项"}
        </button>
      </div>
    </section>
  );
}
