import { useEffect, useRef, useState } from "react";
import type { GameState } from "../../../modernization/runtime/state/index.js";
import type { ObservationEvent } from "../../../modernization/schemas/types.js";
import type { PromptAnswer } from "../../../modernization/runtime/command/prompt.js";
import { formatGameEvent } from "./event-format.js";
import { dailyEventPromptView } from "../../../modernization/runtime/world/daily-event.js";

interface Props {
  state: GameState;
  onSettleSleep: () => void;
  onResolveDailyEvent?: (answer: boolean | PromptAnswer) => void;
  onContinue: () => void;
}

interface DisplayLine {
  text: string;
  kind: string;
}

/**
 * A per-character 小剧场 block, revealed one at a time. `charaNum` 0/undefined
 * is the global block (night DAYEVENT scene + farm/brew results); everything
 * else is a single character's day-end block (呢喃 → 自慰 → 陷落事件 → 属性
 * 升级), grouped by `charaNum` from the runtime's night report. Blocks carry NO
 * added title text — every line shown is verbatim game/kojo output (each names
 * its own character; the 呢喃 keeps its upstream `▼〜的呢喃` header). Blocks are
 * only separated visually so a click reveals one character at a time.
 */
interface Block {
  key: string;
  lines: DisplayLine[];
}

function clockText(state: GameState): string {
  const minuteOfDay = ((state.time.tickValue % 1440) + 1440) % 1440;
  const hh = String(Math.floor(minuteOfDay / 60)).padStart(2, "0");
  const mm = String(minuteOfDay % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

type NightEvent = Extract<ObservationEvent, { kind: "NARRATION" | "DIALOGUE_LINE" }>;

function charaNumOf(e: NightEvent): number {
  // DIALOGUE_LINE always carries charaNum; NARRATION carries an optional one
  // (tagged by the ABLUP / ONANISM / fall-state producers). 0 = global.
  return "charaNum" in e && typeof e.charaNum === "number" ? e.charaNum : 0;
}

/**
 * Group the runtime's flat `nightReport` into ordered per-character blocks.
 * Blocks appear in first-seen order (global untagged lines first when present);
 * lines inside a block keep their producer order (呢喃 → 自慰 → 陷落 → 升级).
 */
function buildBlocks(state: GameState): Block[] {
  const stream = (state.nightReport ?? []).filter(
    (e): e is NightEvent => e.kind === "NARRATION" || e.kind === "DIALOGUE_LINE",
  );

  const order: number[] = [];
  const byChara = new Map<number, DisplayLine[]>();
  for (const e of stream) {
    const text = formatGameEvent(e, state);
    if (text.trim().length === 0) continue;
    const key = charaNumOf(e);
    let bucket = byChara.get(key);
    if (!bucket) {
      bucket = [];
      byChara.set(key, bucket);
      order.push(key);
    }
    bucket.push({ text, kind: e.kind });
  }

  const blocks: Block[] = [];
  for (const key of order) {
    const lines = byChara.get(key)!;
    if (lines.length === 0) continue;
    blocks.push({ key: String(key), lines });
  }
  return blocks;
}

export default function NightSettlementScreen({
  state,
  onSettleSleep,
  onResolveDailyEvent = () => undefined,
  onContinue,
}: Props) {
  const streamRef = useRef<HTMLDivElement | null>(null);
  const settledSessionKey = useRef<string | null>(null);
  // App-level store updates can recreate this callback while the sleep screen
  // is fading in. Keep the 720ms settlement timer tied to the sleep session,
  // not to that render-only callback identity; otherwise each parent rerender
  // cancels and restarts it forever.
  const settleSleepRef = useRef(onSettleSleep);
  useEffect(() => {
    settleSleepRef.current = onSettleSleep;
  }, [onSettleSleep]);
  const pending = state.sleepSession ?? null;
  const dailyPrompt = state.dailyEventSession
    ? dailyEventPromptView(state, state.dailyEventSession)
    : null;
  const [settling, setSettling] = useState(pending !== null && dailyPrompt === null);
  const blocks = buildBlocks(state);
  const hasContent = blocks.length > 0;
  const [revealed, setRevealed] = useState(1);
  const shownCount = Math.min(revealed, Math.max(1, blocks.length));
  const more = !pending && shownCount < blocks.length;

  useEffect(() => {
    setRevealed(1);
  }, [pending, blocks.length]);

  useEffect(() => {
    if (!pending) {
      settledSessionKey.current = null;
      setSettling(false);
      return;
    }
    if (dailyPrompt) {
      setSettling(false);
      return;
    }
    const key = [
      pending.startedAtTick,
      pending.requestedWakeMinute ?? "",
      pending.forced ? 1 : 0,
    ].join(":");
    if (settledSessionKey.current === key) return;
    setSettling(true);
    // The state transition used to happen in the first effect frame, making
    // a voluntary sleep and an exhaustion collapse visually indistinguishable.
    // Mark the session only when the callback really fires. React StrictMode
    // intentionally mounts, cleans up and remounts effects in development;
    // marking before the timer fires would let the first cleanup cancel the
    // only timer while the second pass incorrectly believes work is complete.
    const timer = window.setTimeout(() => {
      settledSessionKey.current = key;
      settleSleepRef.current();
    }, 720);
    return () => window.clearTimeout(timer);
  }, [
    pending?.startedAtTick,
    pending?.requestedWakeMinute,
    pending?.forced,
    state.dailyEventSession?.eventDay,
  ]);

  useEffect(() => {
    const el = streamRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shownCount]);

  const advance = (): void => {
    if (more) setRevealed((v) => v + 1);
  };

  return (
    <section className={`night-settlement${settling ? " night-settlement--settling" : ""}`} data-testid="screen-night-settlement">
      <div className="night-settlement__fade" aria-hidden="true" />
      <div className="night-settlement__panel">
        <p className="night-settlement__eyebrow">
          第 {state.time.dayIndex + 1} 日 · {clockText(state)} · 当日结算
        </p>
        <h1>{dailyPrompt ? "夜间事件" : pending ? "入睡" : "一天结束"}</h1>

        {pending ? (
          <div className="night-settlement__pending" data-testid="night-pending">
            {dailyPrompt ? (
              <div data-testid="daily-event-prompt">
                {dailyPrompt.lines.map((text, index) => <p key={index}>{text}</p>)}
                <p>{dailyPrompt.prompt.question}</p>
                <div className="night-settlement__actions">
                  {dailyPrompt.prompt.options.map((option, index) => (
                    <button
                      key={String(option.id)}
                      type="button"
                      disabled={option.disabled}
                      data-testid={index === 0 ? "daily-event-yes" : index === 1 ? "daily-event-no" : `daily-event-option-${String(option.id)}`}
                      onClick={() => onResolveDailyEvent(state.dailyEventSession?.kind === "ev0-fairy-punishment"
                        ? index === 0
                        : { kind: "pick_one", value: option.id })}
                    >
                      {option.label}{option.detail ? `（${option.detail}）` : ""}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                <p>
                  {pending.forced
                    ? "体力已经耗尽，你失去了意识。夜晚会替你完成余下的日替处理。"
                    : "你合上眼睛，夜色渐渐吞没了房间。"}
                </p>
                <small data-testid="night-settling-hint">正在结算今晚……</small>
              </>
            )}
          </div>
        ) : (
          <>
            <p className="night-settlement__summary" data-testid="night-report-summary">
              一天结束了。
            </p>
            <div
              ref={streamRef}
              className="night-settlement__stream"
              data-testid="night-stream"
              onClick={advance}
              role={more ? "button" : undefined}
              title={more ? "点击继续" : undefined}
            >
              {!hasContent ? (
                <p
                  className="night-settlement__line night-settlement__line--empty"
                  data-event-kind="empty"
                >
                  今天平静无事，没有特别的变化。
                </p>
              ) : (
                blocks.slice(0, shownCount).map((block, blockIndex) => (
                  <div
                    key={block.key}
                    className={`night-settlement__block${
                      blockIndex === shownCount - 1
                        ? " night-settlement__block--entering"
                        : ""
                    }`}
                    data-testid="night-block"
                    data-chara={block.key}
                  >
                    {block.lines.map((line, index) => (
                      <p
                        key={`${block.key}-${index}`}
                        className={`night-settlement__line night-settlement__line--${line.kind}`}
                        data-event-kind={line.kind}
                      >
                        {line.text}
                      </p>
                    ))}
                  </div>
                ))
              )}
            </div>
            <div className="night-settlement__actions">
              {more ? (
                <button
                  type="button"
                  data-testid="night-more"
                  onClick={advance}
                >
                  ▼ 继续（{shownCount}/{blocks.length}）
                </button>
              ) : (
                <button
                  type="button"
                  data-testid="night-continue-menu"
                  onClick={onContinue}
                >
                  前往起床前主菜单
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
