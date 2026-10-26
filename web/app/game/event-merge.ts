import type { ObservationEvent } from "../../../modernization/schemas/types.js";

/**
 * Stable identity for cross-source dedup: the persistent eventLog and the
 * transient dialogue transcripts carry overlapping lines that must render
 * exactly once in a merged history (问题1 — immersive history merge; the
 * minimal stream is the reference implementation).
 */
export function eventKey(event: ObservationEvent): string {
  const charaNum = "charaNum" in event && event.charaNum !== undefined ? event.charaNum : "";
  const text = "text" in event ? event.text : "";
  return `${event.kind}:${String(charaNum)}:${text}`;
}

/** Identity for suppressing one concrete event instance. Unlike eventKey,
 * this includes its timestamp so a later command that happens to emit the
 * same authored sentence is not hidden by an earlier successful AI replace. */
export function eventInstanceKey(event: ObservationEvent): string {
  return `${event.timestamp}:${eventKey(event)}`;
}

/** H command transcripts also echo narration separated by settlement events.
 * Keep settled events in order without collapsing genuine repeated
 * lines, including two equal lines emitted at the same timestamp. */
export function mergeCommandTranscript(
  log: ReadonlyArray<ObservationEvent>,
  transcript: ReadonlyArray<ObservationEvent>,
): ObservationEvent[] {
  const remaining = new Map<string, number>();
  for (const event of log) {
    const key = eventInstanceKey(event);
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }
  const unmatched = transcript.filter((event) => {
    const key = eventInstanceKey(event);
    const count = remaining.get(key) ?? 0;
    if (!count) return true;
    remaining.set(key, count - 1);
    return false;
  });
  return [...log, ...unmatched];
}

/**
 * The eventLog (`band`) and the live session transcript overlap for ordinary
 * command kojo (both carry the same lines), while AI chat / AI-replaced lines /
 * kojo choice branches exist ONLY in the transcript. Trim the band's suffix
 * that exactly matches the transcript prefix (the transcript renders that
 * segment once).
 */
export function trimSuffixOverlap(
  band: ReadonlyArray<ObservationEvent>,
  sessionPart: ReadonlyArray<ObservationEvent>,
): ReadonlyArray<ObservationEvent> {
  const maxOverlap = Math.min(band.length, sessionPart.length);
  for (let m = maxOverlap; m >= 0; m -= 1) {
    let matches = true;
    for (let i = 0; i < m; i += 1) {
      if (eventKey(band[band.length - m + i]!) !== eventKey(sessionPart[i]!)) {
        matches = false;
        break;
      }
    }
    if (matches) return m > 0 ? band.slice(0, band.length - m) : band;
  }
  return band;
}
