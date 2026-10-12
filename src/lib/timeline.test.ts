import { describe, expect, it } from "vitest";
import {
  clampView,
  dragSegment,
  fitView,
  follow,
  hitKind,
  msAt,
  tickLabel,
  tickStep,
  xAt,
  zoomAt,
} from "./timeline";
import type { Segment } from "./types";

function seg(id: number, start_ms: number, end_ms: number): Segment {
  const mid = Math.round((start_ms + end_ms) / 2);
  return {
    id,
    start_ms,
    end_ms,
    text: "a b",
    words: [
      { start_ms, end_ms: mid, text: "a" },
      { start_ms: mid, end_ms, text: "b" },
    ],
  };
}

// Three captions in a 10 s video: [1000–2000] [3000–4000] [6000–8000]
const segments = [seg(0, 1000, 2000), seg(1, 3000, 4000), seg(2, 6000, 8000)];
const opts = { durationMs: 10_000 };
const times = (s: { start_ms: number; end_ms: number }) => [s.start_ms, s.end_ms];

describe("view", () => {
  it("converts between time and pixels", () => {
    const view = { startMs: 1000, msPerPx: 10 };
    expect(xAt(1500, view)).toBe(50);
    expect(msAt(50, view)).toBe(1500);
  });

  it("fits the video and stays inside it", () => {
    expect(fitView(10_000, 1000)).toEqual({ startMs: 0, msPerPx: 10 });
    expect(clampView({ startMs: -500, msPerPx: 5 }, 10_000, 1000)).toEqual({ startMs: 0, msPerPx: 5 });
    expect(clampView({ startMs: 9000, msPerPx: 5 }, 10_000, 1000)).toEqual({ startMs: 5000, msPerPx: 5 });
    expect(clampView({ startMs: 0, msPerPx: 50 }, 10_000, 1000).msPerPx).toBe(10);
    expect(clampView({ startMs: 0, msPerPx: 0.5 }, 10_000, 1000).msPerPx).toBe(2);
  });

  it("zooms around the pointer", () => {
    const view = zoomAt({ startMs: 0, msPerPx: 10 }, 2, 400, 10_000, 1000);
    expect(view.msPerPx).toBe(5);
    expect(msAt(400, view)).toBe(4000); // the time under the pointer stays put
  });

  it("pages to follow the playhead", () => {
    const view = { startMs: 0, msPerPx: 5 }; // shows 0–5000 in 1000 px
    expect(follow(view, 4000, 10_000, 1000)).toBe(view);
    expect(follow(view, 4600, 10_000, 1000).startMs).toBe(4100);
  });

  it("picks readable ruler steps and labels", () => {
    expect(tickStep(10)).toBe(1000); // 100 px per second
    expect(tickStep(100)).toBe(10_000);
    expect(tickStep(1)).toBe(100);
    expect(tickLabel(65_000, 5000)).toBe("1:05");
    expect(tickLabel(1500, 500)).toBe("0:01.5");
    expect(tickLabel(3_723_000, 60_000)).toBe("1:02:03");
  });
});

describe("dragSegment", () => {
  it("moves a caption and its words", () => {
    const moved = dragSegment(segments, 1, "move", 500, opts)[1];
    expect(times(moved)).toEqual([3500, 4500]);
    expect(moved.words.map(times)).toEqual([[3500, 4000], [4000, 4500]]);
  });

  it("stops at the neighbours and the video's ends", () => {
    expect(times(dragSegment(segments, 1, "move", -5000, opts)[1])).toEqual([2000, 3000]);
    expect(times(dragSegment(segments, 1, "move", 5000, opts)[1])).toEqual([5000, 6000]);
    expect(times(dragSegment(segments, 0, "move", -5000, opts)[0])).toEqual([0, 1000]);
    expect(times(dragSegment(segments, 2, "move", 5000, opts)[2])).toEqual([8000, 10_000]);
  });

  it("resizes either edge and stretches the words", () => {
    const longer = dragSegment(segments, 1, "end", 1000, opts)[1];
    expect(times(longer)).toEqual([3000, 5000]);
    expect(longer.words.map(times)).toEqual([[3000, 4000], [4000, 5000]]);
    expect(times(dragSegment(segments, 1, "start", -500, opts)[1])).toEqual([2500, 4000]);
  });

  it("keeps captions at least 100 ms long and inside their neighbours", () => {
    expect(times(dragSegment(segments, 1, "start", 5000, opts)[1])).toEqual([3900, 4000]);
    expect(times(dragSegment(segments, 1, "end", -5000, opts)[1])).toEqual([3000, 3100]);
    expect(times(dragSegment(segments, 1, "end", 5000, opts)[1])).toEqual([3000, 6000]);
  });

  it("snaps edges to targets within the threshold", () => {
    const snap = { ...opts, snapTargets: [4700], snapMs: 60 };
    // End lands 40 ms from the playhead at 4700: snaps.
    expect(times(dragSegment(segments, 1, "end", 660, snap)[1])).toEqual([3000, 4700]);
    // Moving: the start lands 50 ms after the previous caption's end: snaps to it.
    expect(times(dragSegment(segments, 1, "move", -950, snap)[1])).toEqual([2000, 3000]);
    // Without snapping it stays where dropped.
    expect(times(dragSegment(segments, 1, "end", 660, opts)[1])).toEqual([3000, 4660]);
  });

  it("returns the same list when nothing moves", () => {
    expect(dragSegment(segments, 1, "move", 0, opts)).toBe(segments);
    expect(dragSegment(segments, 9, "move", 100, opts)).toBe(segments);
  });
});

describe("hitKind", () => {
  it("grabs edges within 6 px, the body otherwise", () => {
    expect(hitKind(102, 100, 200)).toBe("start");
    expect(hitKind(296, 100, 200)).toBe("end");
    expect(hitKind(200, 100, 200)).toBe("move");
    // Tiny blocks keep a grabbable middle.
    expect(hitKind(105, 100, 12)).toBe("move");
  });
});
