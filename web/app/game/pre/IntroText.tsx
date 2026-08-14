/**
 * #13 原版开场流程 — animated intro text.
 *
 * Renders a stack of lines that fade/rise in one after another (staggered
 * `animation-delay`), each line free to carry its own color or emphasis.
 * The animation is pure CSS (`.intro-text__line`, styles.css) so it is
 * deterministic and jsdom-safe (no timers). The background stays pure black
 * — color lives only in the text, per the opening's mood.
 *
 * Mirrors the upstream era `DQPRINT` cadence (one revealed line at a time,
 * NEWGAME_MAKE_SPECIAL / TITLE intro), without driving real `PRINTW` waits.
 */

export interface IntroLine {
  text: string;
  /** Optional per-line color (hex). Defaults to the muted intro color. */
  color?: string;
  /** Larger, glowing emphasis line (e.g. the world's name). */
  emphasis?: boolean;
}

export interface IntroTextProps {
  lines: IntroLine[];
  testId?: string;
  /** Seconds between each line's reveal (default 0.45s). */
  stagger?: number;
}

export default function IntroText({ lines, testId, stagger = 0.45 }: IntroTextProps) {
  return (
    <div className="intro-text" data-testid={testId}>
      {lines.map((line, i) => (
        <p
          key={`${i}-${line.text}`}
          className={`intro-text__line${line.emphasis ? " intro-text__line--emph" : ""}`}
          style={{ animationDelay: `${i * stagger}s`, color: line.color }}
        >
          {line.text}
        </p>
      ))}
    </div>
  );
}
