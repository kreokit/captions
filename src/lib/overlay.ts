import { findSegmentAt, findWordAt } from "./captions";
import type { CaptionMode, Segment } from "./types";

/** Style sizes are defined for a frame this tall (the ASS export will use the same). */
export const REFERENCE_HEIGHT = 1080;

export interface OverlayWord {
  text: string;
  /** Being spoken now (highlighted in word_highlight mode). */
  active: boolean;
}

/**
 * The words the caption overlay shows at `ms`, or null when no caption is on screen.
 * - line: the whole segment, nothing highlighted
 * - word_highlight: the whole segment, the spoken word highlighted
 * - one_word: only the spoken word (between words, the last one spoken stays up)
 */
export function overlayWords(segments: Segment[], ms: number, mode: CaptionMode): OverlayWord[] | null {
  const index = findSegmentAt(segments, ms);
  if (index < 0) return null;
  const segment = segments[index];
  if (segment.words.length === 0) {
    return segment.text ? [{ text: segment.text, active: false }] : null;
  }
  const spoken = findWordAt(segment, ms);
  switch (mode) {
    case "line":
      return segment.words.map((w) => ({ text: w.text, active: false }));
    case "word_highlight":
      return segment.words.map((w, i) => ({ text: w.text, active: i === spoken }));
    case "one_word": {
      const last = spoken >= 0 ? spoken : lastStartedBefore(segment, ms);
      return last >= 0 ? [{ text: segment.words[last].text, active: true }] : null;
    }
  }
}

function lastStartedBefore(segment: Segment, ms: number): number {
  for (let i = segment.words.length - 1; i >= 0; i--) {
    if (segment.words[i].start_ms <= ms) return i;
  }
  return -1;
}
