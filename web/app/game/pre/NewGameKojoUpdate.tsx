import { useState } from "react";
import type {
  NewGameKojoUpdateCandidate,
  NewGameKojoUpdateResult,
} from "../../../../modernization/runtime/index.js";

export interface NewGameKojoUpdateProps {
  candidates: readonly NewGameKojoUpdateCandidate[];
  onResolve: (
    charaNum: number,
    choices: readonly number[],
  ) => NewGameKojoUpdateResult | null;
  onDone: () => void;
}

type RowStatus = "waiting" | "active" | "done" | "skipped" | "unsupported";

interface HistoryEntry {
  charaNum: number;
  callName: string;
  lines: string[];
}

const STATUS_LABEL: Record<RowStatus, string> = {
  waiting: "等待",
  active: "调整中",
  done: "完成",
  skipped: "已跳过",
  unsupported: "未支持，未写入",
};

export default function NewGameKojoUpdate(props: NewGameKojoUpdateProps) {
  const [started, setStarted] = useState(false);
  const [index, setIndex] = useState(0);
  const [choices, setChoices] = useState<number[]>([]);
  const [current, setCurrent] = useState<NewGameKojoUpdateResult | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [statuses, setStatuses] = useState<Record<number, RowStatus>>({});

  const setRowStatus = (charaNum: number, status: RowStatus): void => {
    setStatuses((previous) => ({ ...previous, [charaNum]: status }));
  };

  const finishEntry = (
    candidate: NewGameKojoUpdateCandidate,
    result: NewGameKojoUpdateResult,
  ): void => {
    if (result.lines.length > 0) {
      setHistory((previous) => [
        ...previous,
        {
          charaNum: candidate.charaNum,
          callName: candidate.callName,
          lines: result.lines.map((line) => line.text),
        },
      ]);
    }
  };

  const advanceFrom = (startIndex: number): void => {
    let cursor = startIndex;
    while (cursor < props.candidates.length) {
      const candidate = props.candidates[cursor]!;
      setRowStatus(candidate.charaNum, "active");
      const result = props.onResolve(candidate.charaNum, []);
      if (!result) {
        setRowStatus(candidate.charaNum, "unsupported");
        cursor += 1;
        continue;
      }
      if (result.status === "pending") {
        setIndex(cursor);
        setChoices([]);
        setCurrent(result);
        return;
      }

      finishEntry(candidate, result);
      setRowStatus(
        candidate.charaNum,
        result.status === "unsupported" ? "unsupported" :
          result.status === "not-authored" || result.status === "gated" ? "skipped" : "done",
      );
      cursor += 1;
    }

    setIndex(props.candidates.length);
    setChoices([]);
    setCurrent(null);
  };

  const choose = (choiceIndex: number): void => {
    const candidate = props.candidates[index];
    if (!candidate) return;
    const nextChoices = [...choices, choiceIndex];
    const result = props.onResolve(candidate.charaNum, nextChoices);
    if (!result) {
      setRowStatus(candidate.charaNum, "unsupported");
      advanceFrom(index + 1);
      return;
    }
    if (result.status === "pending") {
      setChoices(nextChoices);
      setCurrent(result);
      return;
    }

    finishEntry(candidate, result);
    setRowStatus(candidate.charaNum, result.status === "unsupported" ? "unsupported" : "done");
    setCurrent(null);
    setChoices([]);
    advanceFrom(index + 1);
  };

  const skipCurrent = (): void => {
    const candidate = props.candidates[index];
    if (candidate) setRowStatus(candidate.charaNum, "skipped");
    setCurrent(null);
    setChoices([]);
    advanceFrom(index + 1);
  };

  const skipRemaining = (): void => {
    setStatuses((previous) => {
      const next = { ...previous };
      for (let cursor = index; cursor < props.candidates.length; cursor += 1) {
        next[props.candidates[cursor]!.charaNum] = "skipped";
      }
      return next;
    });
    setIndex(props.candidates.length);
    setCurrent(null);
    setChoices([]);
  };

  const complete = started && index >= props.candidates.length;
  const candidate = props.candidates[index];
  const pendingChoices = current?.pending?.options.length
    ? current.pending.options.map((option, choiceIndex) => ({
        choiceIndex,
        label: option.label,
      }))
    : (current?.pending?.values ?? []).map((value, choiceIndex) => ({
        choiceIndex,
        label: String(value),
      }));

  return (
    <section className="pre-screen pre-screen--kojo-update" data-testid="screen-kojo-update">
      <h2>角色剧本初始化</h2>
      <p className="pre-screen__lead">
        现在按所选口上逐一执行角色的开局调整。没有问题的角色会自动通过，只有作者留下的选择才会停下来。
      </p>

      <div className="kojo-update__layout">
        <ol className="kojo-update__roster" aria-label="角色初始化进度">
          {props.candidates.map((entry) => {
            const status = statuses[entry.charaNum] ?? "waiting";
            return (
              <li key={entry.charaNum} data-status={status}>
                <span>#{entry.charaNum}　{entry.callName}</span>
                <small>{STATUS_LABEL[status]}</small>
              </li>
            );
          })}
          {props.candidates.length === 0 && <li>当前启用的角色剧本没有开局调整。</li>}
        </ol>

        <div className="kojo-update__dialogue" aria-live="polite">
          {history.map((entry) => (
            <div key={`${entry.charaNum}-${history.indexOf(entry)}`} className="kojo-update__entry">
              <strong>{entry.callName}</strong>
              {entry.lines.map((line, lineIndex) => <p key={lineIndex}>{line}</p>)}
            </div>
          ))}

          {candidate && current?.status === "pending" && (
            <div className="kojo-update__entry kojo-update__entry--active">
              <strong>{candidate.callName}</strong>
              {current.lines.map((line, lineIndex) => <p key={lineIndex}>{line.text}</p>)}
              <div className="pre-screen__menu pre-screen__menu--stack">
                {pendingChoices.map((option) => (
                  <button
                    type="button"
                    key={option.choiceIndex}
                    data-testid="kojo-update-choice"
                    onClick={() => choose(option.choiceIndex)}
                  >
                    {option.label}
                  </button>
                ))}
                {pendingChoices.length === 0 && (
                  <p className="kojo-update__warning">这个输入还不能安全转换为现代选项，请跳过该角色。</p>
                )}
              </div>
            </div>
          )}

          {!started && <p>按“开始检查”后执行。过程中可以跳过当前角色或全部剩余角色。</p>}
          {complete && <p className="kojo-update__complete">角色剧本初始化完成，可以进入游戏。</p>}
        </div>
      </div>

      <div className="pre-screen__menu pre-screen__menu--nav">
        {!started && (
          <button
            type="button"
            className="pre-screen__primary"
            data-testid="kojo-update-start"
            onClick={() => {
              setStarted(true);
              advanceFrom(0);
            }}
          >
            开始检查
          </button>
        )}
        {started && !complete && current?.pending && (
          <button type="button" data-testid="kojo-update-skip" onClick={skipCurrent}>
            跳过此角色
          </button>
        )}
        {started && !complete && (
          <button type="button" data-testid="kojo-update-skip-all" onClick={skipRemaining}>
            跳过剩余
          </button>
        )}
        {complete && (
          <button
            type="button"
            className="pre-screen__primary"
            data-testid="kojo-update-done"
            onClick={props.onDone}
          >
            进入游戏 →
          </button>
        )}
      </div>
    </section>
  );
}
