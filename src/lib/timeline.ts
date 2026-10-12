/**
 * Timeline maths: the visible window, zoom, ruler ticks, and retiming captions by dragging.
 * Pure functions; the Timeline component only handles pointers and drawing.
 */
import { MIN_SEGMENT_MS, retime } from "./captions";
import type { Segment } from "./types";

/** The visible part of the timeline: its left edge and zoom. */
export interface View {
  startMs: number;
  msPerPx: number;
}

/** Most zoomed in: 2 ms per pixel (a 100 ms word is 50 px wide). */
export const MIN_MS_PER_PX = 2;
/** Edges snap when within this many pixels. */
export const SNAP_PX = 6;

export const xAt = (ms: number, view: View) => (ms - view.startMs) / view.msPerPx;
export const msAt = (x: number, view: View) => view.startMs + x * view.msPerPx;

/** The whole video in `width` pixels. */
export function fitView(durationMs: number, width: number): View {
  return { startMs: 0, msPerPx: Math.max(MIN_MS_PER_PX, durationMs / Math.max(width, 1)) };
}

/** Keeps the window inside [0, duration], no wider than "fit". */
export function clampView(view: View, durationMs: number, width: number): View {
  const fit = fitView(durationMs, width).msPerPx;
  const msPerPx = Math.min(Math.max(view.msPerPx, MIN_MS_PER_PX), fit);
  const maxStart = Math.max(0, durationMs - width * msPerPx);
  return { msPerPx, startMs: Math.min(Math.max(view.startMs, 0), maxStart) };
}

/** Zooms by `factor` (>1 zooms in), keeping the time under pixel `anchorX` in place. */
export function zoomAt(view: View, factor: number, anchorX: number, durationMs: number, width: number): View {
  const anchorMs = msAt(anchorX, view);
  const msPerPx = view.msPerPx / factor;
  return clampView({ msPerPx, startMs: anchorMs - anchorX * msPerPx }, durationMs, width);
}

/**
 * While playing, keeps the playhead in view: when it passes 90% of the width (or leaves
 * the window), the window pages so the playhead sits at 10%.
 */
export function follow(view: View, ms: number, durationMs: number, width: number): View {
  const x = xAt(ms, view);
  if (x >= 0 && x <= width * 0.9) return view;
  return clampView({ ...view, startMs: ms - width * 0.1 * view.msPerPx }, durationMs, width);
}

const TICK_STEPS = [100, 200, 500, 1000, 2000, 5000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000];

/** Ruler spacing: the smallest step that keeps labels at least `minPx` apart. */
export function tickStep(msPerPx: number, minPx = 72): number {
  return TICK_STEPS.find((step) => step / msPerPx >= minPx) ?? TICK_STEPS[TICK_STEPS.length - 1];
}

/** Ruler label: "0:05", "1:02", "1:00:00"; tenths when the step is under a second. */
export function tickLabel(ms: number, step: number): string {
  const total = Math.round(ms / 100) / 10;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const sec = step < 1000 ? s.toFixed(1).padStart(4, "0") : String(Math.floor(s)).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

export type DragKind = "move" | "start" | "end";

/**
 * The nearest of `targets` within `threshold` of `ms`, as an offset to add, or 0.
 */
function snapOffset(ms: number, targets: number[], threshold: number): number {
  let best = 0;
  let bestDistance = threshold + 1;
  for (const t of targets) {
    const d = Math.abs(t - ms);
    if (d <= threshold && d < bestDistance) {
      best = t - ms;
      bestDistance = d;
    }
  }
  return best;
}

export interface DragOptions {
  durationMs: number;
  /** Times edges snap to (e.g. the playhead); neighbours' edges and 0 / end always do. */
  snapTargets?: number[];
  /** Snap distance in ms (SNAP_PX × msPerPx); 0 turns snapping off. */
  snapMs?: number;
}

/**
 * Segment `index` after dragging by `deltaMs` from its original position in `segments`:
 * - move: the whole caption and its words shift
 * - start / end: that edge moves and the words are stretched to the new span
 * Captions never overlap their neighbours, never leave [0, duration], and stay at least
 * MIN_SEGMENT_MS long. Edges snap to neighbours' edges, the video's ends and
 * `snapTargets` within `snapMs`. Returns a new list (or the same one if nothing moved).
 */
export function dragSegment(
  segments: Segment[],
  index: number,
  kind: DragKind,
  deltaMs: number,
  { durationMs, snapTargets = [], snapMs = 0 }: DragOptions,
): Segment[] {
  const seg = segments[index];
  if (!seg) return segments;
  const lo = segments[index - 1]?.end_ms ?? 0;
  const hi = segments[index + 1]?.start_ms ?? Math.max(durationMs, seg.end_ms);
  const targets = [lo, hi, 0, durationMs, ...snapTargets];
  const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

  let start = seg.start_ms;
  let end = seg.end_ms;
  if (kind === "move") {
    const length = seg.end_ms - seg.start_ms;
    start = seg.start_ms + deltaMs;
    if (snapMs > 0) {
      const byStart = snapOffset(start, targets, snapMs);
      const byEnd = snapOffset(start + length, targets, snapMs);
      const offset =
        byStart !== 0 && (byEnd === 0 || Math.abs(byStart) <= Math.abs(byEnd)) ? byStart : byEnd;
      start += offset;
    }
    start = clamp(start, lo, hi - length);
    end = start + length;
  } else if (kind === "start") {
    start = seg.start_ms + deltaMs;
    if (snapMs > 0) start += snapOffset(start, targets, snapMs);
    start = clamp(start, lo, seg.end_ms - MIN_SEGMENT_MS);
  } else {
    end = seg.end_ms + deltaMs;
    if (snapMs > 0) end += snapOffset(end, targets, snapMs);
    end = clamp(end, seg.start_ms + MIN_SEGMENT_MS, hi);
  }

  start = Math.round(start);
  end = Math.round(end);
  if (start === seg.start_ms && end === seg.end_ms) return segments;
  const moved =
    kind === "move"
      ? {
          ...seg,
          start_ms: start,
          end_ms: end,
          words: seg.words.map((w) => ({
            ...w,
            start_ms: w.start_ms + (start - seg.start_ms),
            end_ms: w.end_ms + (start - seg.start_ms),
          })),
        }
      : retime(seg, start, end);
  return segments.map((s, i) => (i === index ? moved : s));
}

/** Which part of a block a pointer at `x` grabs: its edges (6 px) or the body. */
export function hitKind(x: number, blockLeft: number, blockWidth: number, edgePx = 6): DragKind {
  const edge = Math.min(edgePx, blockWidth / 3);
  if (x - blockLeft <= edge) return "start";
  if (blockLeft + blockWidth - x <= edge) return "end";
  return "move";
}
