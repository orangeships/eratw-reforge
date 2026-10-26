/**
 * 採集中 progress overlay — the `COMF445` gathering pre-phase.
 *
 * Faithful in shape to `ERB/コマンド関連/COMF/日常系/COMF445 採集する.ERB:81-84`,
 * which runs before the draw:
 *
 *     REPEAT 5
 *         REUSELASTLINE \@ CHARA ? 和%CALLNAME:CHARA%一起 # \@采集中.%"." * COUNT%
 *         TWAIT 40, 1
 *     REND
 *
 * `REUSELASTLINE` overwrites the same console line each pass and `%"." * COUNT%`
 * appends one dot per iteration, so the player sees 采集中. → 采集中.. → … →
 * 采集中..... as five discrete frames. The `CHARA ?` arm prefixes 和<名字>一起
 * when gathering with a companion — carried here as {@link companionName}, even
 * though the current handler is solo-only, so the presentation is already right
 * when the participant arm lands.
 *
 * **Deliberate timing deviation:** upstream waits `TWAIT 40` (40 ms) per frame,
 * i.e. 200 ms for the whole sequence. That is imperceptible in a browser
 * (roughly 12 frames at 60 Hz for the entire animation), so this uses
 * {@link FRAME_MS} ≈ 180 ms per frame instead. The frame *count* (5), the dot
 * progression, and the single-line overwrite are all exact; only the dwell is
 * slowed to something a player can actually read.
 *
 * This is a UI-only overlay (A1/S1: not GameState, not persisted). The runtime
 * resolver is synchronous, so the command has not been issued yet while this
 * is on screen — `onDone` is what actually issues it.
 */

import { useEffect, useState } from "react";

/** Upstream `REPEAT 5` — five dot frames. */
export const FRAME_COUNT = 5;
/**
 * Per-frame dwell. Upstream is `TWAIT 40, 1` (40 ms); see the module doc for
 * why the modern surface slows this to a readable pace.
 */
export const FRAME_MS = 180;

export interface GatheringProgressProps {
  /** `CHARA ?` arm: 和%CALLNAME:CHARA%一起. Omitted for a solo gather. */
  companionName?: string;
  /** Called once the five frames have elapsed — the caller then issues COMF445. */
  onDone: () => void;
}

export default function GatheringProgress(props: GatheringProgressProps) {
  // Upstream's COUNT is 0-based, and `%"." * COUNT%` is evaluated BEFORE the
  // wait, so the first visible frame already carries one dot (COUNT=0 prints
  // 采集中 then the REUSELASTLINE on COUNT=1 replaces it). Start at 1 dot so
  // the overlay never flashes a bare "采集中" with no progress indicator.
  const [frame, setFrame] = useState(1);

  useEffect(() => {
    if (frame >= FRAME_COUNT) {
      const timer = window.setTimeout(props.onDone, FRAME_MS);
      return () => window.clearTimeout(timer);
    }
    const timer = window.setTimeout(() => setFrame((f) => f + 1), FRAME_MS);
    return () => window.clearTimeout(timer);
    // `onDone` is intentionally excluded: it is a fresh closure every render
    // and re-running this effect would restart the timer and stall the frames.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame]);

  const prefix = props.companionName ? `和${props.companionName}一起` : "";

  return (
    <div className="gathering-progress__scrim" data-testid="gathering-progress">
      <div
        className="gathering-progress"
        role="status"
        aria-live="polite"
        aria-label="采集中"
      >
        <span className="gathering-progress__text" data-testid="gathering-progress-text">
          {prefix}采集中{".".repeat(frame)}
        </span>
      </div>
    </div>
  );
}
