/**
 * Caption editing operations. All are pure: they return new arrays/objects.
 *
 * Invariant kept by every edit: a segment's text is its words joined by single spaces,
 * and its words lie within [start_ms, end_ms] in order.
 */
import type { Segment, Word } from "./types";

/** Shortest segment the editor allows, so a caption is always visible for a moment. */
export const MIN_SEGMENT_MS = 100;

/**
 * Parses a typed time: "1:23.456", "1:02:03.5", "83.4", "1:23", or with a comma
 * ("1:23,456"). Returns milliseconds, or null if the text isn't a time.
 */
export function parseTime(text: string): number | null {
  const match = /^\s*(?:(?:(\d+):)?(\d{1,2}):)?(\d+)(?:[.,](\d{1,3}))?\s*$/.exec(text);
  if (!match) return null;
  const [, h, m, s, frac] = match;
  if (h === undefined && m === undefined && frac === undefined && text.trim() === "") return null;
  const seconds = Number(s);
  if ((m !== undefined || h !== undefined) && seconds >= 60) return null;
  if (h !== undefined && Number(m) >= 60) return null;
  const millis = frac ? Number(frac.padEnd(3, "0")) : 0;
  return ((Number(h ?? 0) * 60 + Number(m ?? 0)) * 60 + seconds) * 1000 + millis;
}

/** Index of the segment showing at `ms`, or -1 in a gap. Segments are sorted by start. */
export function findSegmentAt(segments: Segment[], ms: number): number {
  let lo = 0;
  let hi = segments.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segments[mid].start_ms > ms) hi = mid - 1;
    else if (segments[mid].end_ms <= ms) lo = mid + 1;
    else return mid;
  }
  return -1;
}

/** Index of the word being spoken at `ms`, or -1 between words. */
export function findWordAt(segment: Segment, ms: number): number {
  return segment.words.findIndex((w) => w.start_ms <= ms && ms < w.end_ms);
}

/** Which word a text caret sits in or before: the number of words fully before it. */
export function wordIndexAtCaret(text: string, caret: number): number {
  return text.slice(0, caret).trim().split(/\s+/).filter(Boolean).length;
}

function nextId(segments: Segment[]): number {
  return segments.reduce((max, s) => Math.max(max, s.id), -1) + 1;
}

function joinWords(words: Word[]): string {
  return words.map((w) => w.text).join(" ");
}

/** Splits segment `index` before word `wordIndex`. Returns the input unchanged if that
 * would leave either half empty. */
export function splitSegment(segments: Segment[], index: number, wordIndex: number): Segment[] {
  const seg = segments[index];
  if (!seg || wordIndex <= 0 || wordIndex >= seg.words.length) return segments;
  const before = seg.words.slice(0, wordIndex);
  const after = seg.words.slice(wordIndex);
  const first: Segment = {
    ...seg,
    end_ms: before[before.length - 1].end_ms,
    text: joinWords(before),
    words: before,
  };
  const second: Segment = {
    id: nextId(segments),
    start_ms: after[0].start_ms,
    end_ms: seg.end_ms,
    text: joinWords(after),
    words: after,
  };
  return [...segments.slice(0, index), first, second, ...segments.slice(index + 1)];
}

/** Merges segment `index` with the one after it. */
export function mergeWithNext(segments: Segment[], index: number): Segment[] {
  const a = segments[index];
  const b = segments[index + 1];
  if (!a || !b) return segments;
  const words = [...a.words, ...b.words];
  const merged: Segment = {
    ...a,
    end_ms: b.end_ms,
    text: [a.text, b.text].filter(Boolean).join(" "),
    words,
  };
  return [...segments.slice(0, index), merged, ...segments.slice(index + 2)];
}

export function deleteSegment(segments: Segment[], index: number): Segment[] {
  return segments.filter((_, i) => i !== index);
}

/**
 * Replaces a segment's text. With the same number of words, each word keeps its timing;
 * otherwise the segment's time is shared out by word length.
 */
export function editText(segment: Segment, text: string): Segment {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === segment.words.length) {
    const words = segment.words.map((w, i) => ({ ...w, text: tokens[i] }));
    return { ...segment, text: joinWords(words), words };
  }
  const total = tokens.reduce((sum, t) => sum + t.length, 0);
  const span = segment.end_ms - segment.start_ms;
  let acc = 0;
  const words = tokens.map((t) => {
    const start_ms = segment.start_ms + Math.round((span * acc) / total);
    acc += t.length;
    const end_ms = segment.start_ms + Math.round((span * acc) / total);
    return { start_ms, end_ms, text: t };
  });
  return { ...segment, text: tokens.join(" "), words };
}

/**
 * Sets a segment's start and end, rescaling its word timings to fit. Returns an error
 * message instead if the times are invalid or overlap a neighbour.
 */
export function editTimes(
  segments: Segment[],
  index: number,
  start_ms: number,
  end_ms: number,
): Segment[] | string {
  const seg = segments[index];
  if (end_ms - start_ms < MIN_SEGMENT_MS) {
    return `The end must be at least ${MIN_SEGMENT_MS} ms after the start.`;
  }
  const prev = segments[index - 1];
  const next = segments[index + 1];
  if (prev && start_ms < prev.end_ms) return "The start overlaps the previous caption.";
  if (next && end_ms > next.start_ms) return "The end overlaps the next caption.";

  const updated = retime(seg, start_ms, end_ms);
  return segments.map((s, i) => (i === index ? updated : s));
}

/** The segment moved/stretched to [start_ms, end_ms], its words scaled along with it. */
export function retime(seg: Segment, start_ms: number, end_ms: number): Segment {
  const oldSpan = Math.max(seg.end_ms - seg.start_ms, 1);
  const scale = (t: number) =>
    start_ms + Math.round(((t - seg.start_ms) * (end_ms - start_ms)) / oldSpan);
  const words = seg.words.map((w) => ({ ...w, start_ms: scale(w.start_ms), end_ms: scale(w.end_ms) }));
  return { ...seg, start_ms, end_ms, words };
}

/** How close to a caption's start counts as "at" it when jumping back. */
const AT_START_MS = 300;

/**
 * Where "previous caption" jumps from `ms`: the start of the caption playing (or the last
 * one before a gap), unless already within 300 ms of it; then the one before that.
 */
export function previousCaptionStart(segments: Segment[], ms: number): number {
  let i = segments.length - 1;
  while (i >= 0 && segments[i].start_ms > ms) i--;
  if (i >= 0 && ms - segments[i].start_ms <= AT_START_MS) i--;
  return i >= 0 ? segments[i].start_ms : 0;
}

/** Where "next caption" jumps from `ms`: the next caption's start, or null at the end. */
export function nextCaptionStart(segments: Segment[], ms: number): number | null {
  const next = segments.find((s) => s.start_ms > ms);
  return next ? next.start_ms : null;
}

/**
 * Where "split at playhead" cuts a segment: after every word that has started by `ms`
 * (so a word being spoken stays in the first part). When the playhead is outside the
 * segment or at its edges, splits in the middle instead. Returns a word index for
 * splitSegment, or 0 when the segment can't be split.
 */
export function splitPointAt(segment: Segment, ms: number): number {
  const count = segment.words.length;
  if (count < 2) return 0;
  const started = segment.words.filter((w) => w.start_ms < ms).length;
  return started > 0 && started < count ? started : Math.round(count / 2);
}
