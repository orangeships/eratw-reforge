import { useEffect, useMemo, useState } from "react";
import type { ObservationEvent } from "../../../modernization/schemas/types.js";

type DiaryNarration = Extract<ObservationEvent, { kind: "NARRATION" }> & {
  diary: NonNullable<Extract<ObservationEvent, { kind: "NARRATION" }>["diary"]>;
};

export interface DiaryBookProps {
  events: ReadonlyArray<ObservationEvent>;
  onClose: () => void;
}

const SEASON_NAMES = ["春之月", "夏之月", "秋之月", "冬之月"] as const;
const DAYS_PER_SEASON = 31;
const DAYS_PER_YEAR = DAYS_PER_SEASON * SEASON_NAMES.length;

function chineseNumber(value: number): string {
  if (value <= 0 || value > 99) return String(value);
  const digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  if (value < 10) return digits[value]!;
  const tens = Math.floor(value / 10);
  const ones = value % 10;
  return `${tens === 1 ? "" : digits[tens]}十${ones === 0 ? "" : digits[ones]}`;
}

/** New games begin on first-year spring day one; Agent diaries retain this
 * monotonic day index even though the live clock also keeps season/date. */
export function formatDiaryCalendarDate(dayIndex: number): {
  era: string;
  day: string;
  full: string;
} {
  const safeDay = Math.max(0, Math.trunc(dayIndex));
  const year = Math.floor(safeDay / DAYS_PER_YEAR) + 1;
  const dayWithinYear = safeDay % DAYS_PER_YEAR;
  const season = Math.floor(dayWithinYear / DAYS_PER_SEASON);
  const date = dayWithinYear % DAYS_PER_SEASON + 1;
  const era = `第${chineseNumber(year)}年 · ${SEASON_NAMES[season]}`;
  const day = `${chineseNumber(date)}日`;
  return { era, day, full: `${era} · ${day}` };
}

function pageLabels(page: DiaryNarration["diary"]): { primary: string; secondary: string } {
  if (page.dayIndex !== undefined) {
    const date = formatDiaryCalendarDate(page.dayIndex);
    return { primary: date.era, secondary: date.day };
  }
  if (page.kind === "authored") {
    return { primary: "特别篇", secondary: `第${chineseNumber(page.authoredSlot ?? page.sequence ?? 1)}页` };
  }
  return { primary: "无日期记录", secondary: `第${chineseNumber(page.sequence ?? 1)}篇` };
}

export function diaryPages(events: ReadonlyArray<ObservationEvent>): DiaryNarration[] {
  return events.filter((event): event is DiaryNarration =>
    event.kind === "NARRATION" && event.surface === "diary" && event.diary !== undefined,
  );
}

export default function DiaryBook({ events, onClose }: DiaryBookProps) {
  const pages = useMemo(() => diaryPages(events), [events]);
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    setSelected((index) => Math.min(index, Math.max(0, pages.length - 1)));
  }, [pages.length]);

  if (pages.length === 0) return null;
  const current = pages[selected] ?? pages[0]!;
  const labels = pageLabels(current.diary);
  const extras = events.filter((event) =>
    event.kind === "NARRATION" && !(event.surface === "diary" && event.diary),
  );

  return (
    <div className="diary-book__scrim" data-testid="diary-book" onClick={onClose}>
      <section
        className="diary-book"
        role="dialog"
        aria-modal="true"
        aria-label={current.diary.bookTitle}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="diary-book__header">
          <div>
            <span className="diary-book__eyebrow">日记记录</span>
            <h2>{current.diary.bookTitle}</h2>
          </div>
          <span className="diary-book__counter">{selected + 1} / {pages.length}</span>
          <button type="button" className="diary-book__close" aria-label="关闭日记本" onClick={onClose}>×</button>
        </header>

        <div className="diary-book__spread">
          <nav className="diary-book__index" aria-label="日记目录">
            <div className="diary-book__index-title">目录</div>
            <div className="diary-book__index-list">
              {pages.map((page, index) => {
                const item = pageLabels(page.diary);
                return (
                  <button
                    type="button"
                    key={page.diary.pageId}
                    className={`diary-book__index-entry${selected === index ? " is-active" : ""}`}
                    aria-current={selected === index ? "page" : undefined}
                    data-testid={`diary-book-index-${index}`}
                    onClick={() => setSelected(index)}
                  >
                    <span>{item.primary}</span>
                    <small>{item.secondary}</small>
                    {page.diary.unread && <i aria-label="新解锁">新</i>}
                  </button>
                );
              })}
            </div>
          </nav>

          <article className="diary-book__page" data-testid="diary-book-page">
            <div className="diary-book__date">
              <span>{labels.primary}</span>
              <strong>{labels.secondary}</strong>
            </div>
            {current.diary.unread && <span className="diary-book__stamp">初读</span>}
            <div className="diary-book__rule" />
            <div className="diary-book__prose">
              {current.diary.body.split("\n").map((line, index) => <p key={index}>{line || "\u00a0"}</p>)}
            </div>
            <footer className="diary-book__page-footer">
              <span>{selected + 1}</span>
            </footer>
          </article>
        </div>

        <footer className="diary-book__controls">
          <div className="diary-book__aside-note">
            {extras.map((event, index) => <span key={index}>{event.kind === "NARRATION" ? event.text : ""}</span>)}
          </div>
          <button type="button" disabled={selected === 0} onClick={() => setSelected((value) => value - 1)}>← 上一篇</button>
          <button type="button" disabled={selected === pages.length - 1} onClick={() => setSelected((value) => value + 1)}>下一篇 →</button>
          <button type="button" className="diary-book__shut" onClick={onClose}>合上日记</button>
        </footer>
      </section>
    </div>
  );
}
