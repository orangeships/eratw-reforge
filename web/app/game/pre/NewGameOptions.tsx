/**
 * #13 原版开场流程 — NEWGAME_OPTION skeleton.
 *
 * The original loops this menu after residence selection. This modern page
 * keeps the same numbered surface, implements the opening toggles that already
 * have runtime support, and marks broader body/clothes/farmer editors as
 * unavailable instead of fabricating systems.
 */

import { useState } from "react";
import { usePreGameStore } from "../../state/pre-game-store.js";
import {
  hasPenis,
  PENIS_SHAPE_OPTIONS,
  penisShapeLabel,
  RESIDENCE_OPTIONS,
} from "./newgame-draft.js";
import IntroText, { type IntroLine } from "./IntroText.js";

const INTRO: IntroLine[] = [
  { text: "「差不多准备好了呢。剩下这些，不过是些无伤大雅的小规矩。」", color: "#c9a4ff" },
  { text: "「决定好了吗？那就这样吧。之后会发生什么——我可就不保证了哦。」", color: "#ffd36e", emphasis: true },
];

export interface NewGameOptionsProps {
  onDone: () => void;
  onEditIdentity: () => void;
  onEditResidence: () => void;
  onBack?: () => void;
}

function homeLabel(value: string): string {
  return RESIDENCE_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

export default function NewGameOptions(props: NewGameOptionsProps) {
  const draft = usePreGameStore((s) => s.draft);
  const setDraft = usePreGameStore((s) => s.setDraft);
  const [editingPenis, setEditingPenis] = useState(false);
  const name = draft.callName.trim() || "主人公";
  const hasMaleOrgan = hasPenis(draft.gender);
  const gutsText = draft.noGuts ? "没有告白的胆量" : "有告白的胆量";

  return (
    <section className="pre-screen pre-screen--options" data-testid="screen-newgame-options">
      <IntroText lines={INTRO} testId="newgame-options-intro" />

      <p className="pre-screen__lead">「不用想得太认真。就算弄错了些什么……那也未必是坏事，不是吗？」</p>

      <div className="pre-screen__menu pre-screen__menu--stack">
        <button type="button" data-testid="newgame-option-0" onClick={props.onEditIdentity}>
          [0] {name}进行自定义角色
        </button>
        <button
          type="button"
          data-testid="newgame-option-1"
          disabled={!hasMaleOrgan}
          title={hasMaleOrgan ? undefined : "当前身体没有男性器"}
          onClick={() => setEditingPenis((value) => !value)}
        >
          [1] {name}的男性器为：{hasMaleOrgan ? penisShapeLabel(draft.penisShape) : "无"}
        </button>
        {editingPenis && hasMaleOrgan && (
          <div className="pre-screen__menu pre-screen__menu--stack" data-testid="newgame-penis-shapes">
            {PENIS_SHAPE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                data-testid="newgame-penis-shape"
                data-value={option.value}
                aria-pressed={draft.penisShape === option.value}
                onClick={() => {
                  setDraft({ penisShape: option.value });
                  setEditingPenis(false);
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          data-testid="newgame-option-3"
          onClick={() => setDraft({ noGuts: !draft.noGuts })}
        >
          [3] {name}{gutsText}
        </button>
        <button type="button" data-testid="newgame-option-5" onClick={props.onEditResidence}>
          [5] {name}居住在{homeLabel(draft.homeLocation)}
        </button>
      </div>

      <div className="pre-screen__menu pre-screen__menu--nav">
        <button
          type="button"
          data-testid="newgame-options-done"
          className="pre-screen__primary"
          onClick={props.onDone}
        >
          [100] 完成自定义并检查角色剧本 →
        </button>
        {props.onBack && (
          <button type="button" data-testid="newgame-options-back" onClick={props.onBack}>
            返回
          </button>
        )}
      </div>
    </section>
  );
}
