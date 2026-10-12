import { describe, expect, it } from "vitest";
import {
  deleteSegment,
  editText,
  editTimes,
  findSegmentAt,
  findWordAt,
  mergeWithNext,
  parseTime,
  splitSegment,
  wordIndexAtCaret,
} from "./captions";
import type { Segment } from "./types";

function seg(id: number, words: [string, number, number][]): Segment {
  return {
    id,
    start_ms: words[0][1],
    end_ms: words[words.length - 1][2],
    text: words.map((w) => w[0]).join(" "),
    words: words.map(([text, start_ms, end_ms]) => ({ text, start_ms, end_ms })),
  };
}

const segments: Segment[] = [
  seg(0, [["Welcome", 1040, 1340], ["to", 1400, 1560], ["the", 1560, 1650], ["test,", 1650, 2650]]),
  seg(1, [["the", 2890, 3020], ["quick", 3020, 3200], ["fox.", 3200, 3960]]),
];

describe("parseTime", () => {
  it("parses the editor's formats", () => {
    expect(parseTime("1:23.456")).toBe(83_456);
    expect(parseTime("0:05.007")).toBe(5_007);
    expect(parseTime("1:02:03.5")).toBe(3_723_500);
    expect(parseTime("83.4")).toBe(83_400);
    expect(parseTime("1:23")).toBe(83_000);
    expect(parseTime(" 1:23,456 ")).toBe(83_456);
  });

  it("rejects non-times", () => {
    for (const bad of ["", "abc", "1:60", "1:75:00", "1:2:3:4", "-1", "1.2.3"]) {
      expect(parseTime(bad), bad).toBeNull();
    }
  });
});

describe("findSegmentAt / findWordAt", () => {
  it("finds the segment and word playing", () => {
    expect(findSegmentAt(segments, 1040)).toBe(0);
    expect(findSegmentAt(segments, 3500)).toBe(1);
    expect(findWordAt(segments[1], 3500)).toBe(2);
  });

  it("returns -1 in gaps and outside", () => {
    expect(findSegmentAt(segments, 0)).toBe(-1);
    expect(findSegmentAt(segments, 2650)).toBe(-1); // end is exclusive
    expect(findSegmentAt(segments, 9000)).toBe(-1);
    expect(findSegmentAt([], 100)).toBe(-1);
    expect(findWordAt(segments[0], 1360)).toBe(-1); // between "Welcome" and "to"
  });
});

describe("wordIndexAtCaret", () => {
  it("counts the words before the caret", () => {
    const text = "Welcome to the test,";
    expect(wordIndexAtCaret(text, 0)).toBe(0);
    expect(wordIndexAtCaret(text, 8)).toBe(1); // just before "to"
    expect(wordIndexAtCaret(text, 11)).toBe(2); // just before "the"
    expect(wordIndexAtCaret(text, text.length)).toBe(4);
  });
});

describe("splitSegment", () => {
  it("splits before a word, using word times", () => {
    const result = splitSegment(segments, 0, 2);
    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({ id: 0, start_ms: 1040, end_ms: 1560, text: "Welcome to" });
    expect(result[1]).toMatchObject({ id: 2, start_ms: 1560, end_ms: 2650, text: "the test," });
    expect(result[2]).toBe(segments[1]);
  });

  it("does nothing at the edges", () => {
    expect(splitSegment(segments, 0, 0)).toBe(segments);
    expect(splitSegment(segments, 0, 4)).toBe(segments);
    expect(splitSegment(segments, 5, 1)).toBe(segments);
  });
});

describe("mergeWithNext", () => {
  it("joins words, text and times", () => {
    const [merged] = mergeWithNext(segments, 0);
    expect(merged).toMatchObject({ id: 0, start_ms: 1040, end_ms: 3960 });
    expect(merged.text).toBe("Welcome to the test, the quick fox.");
    expect(merged.words).toHaveLength(7);
  });

  it("does nothing for the last segment", () => {
    expect(mergeWithNext(segments, 1)).toBe(segments);
  });

  it("is undone by a split at the same word", () => {
    expect(splitSegment(mergeWithNext(segments, 0), 0, 4)[1].words).toEqual(segments[1].words);
  });
});

describe("deleteSegment", () => {
  it("removes one segment", () => {
    expect(deleteSegment(segments, 0)).toEqual([segments[1]]);
  });
});

describe("editText", () => {
  it("keeps word timings when the word count is unchanged", () => {
    const edited = editText(segments[1], "The  quick fox!");
    expect(edited.text).toBe("The quick fox!");
    expect(edited.words.map((w) => [w.text, w.start_ms, w.end_ms])).toEqual([
      ["The", 2890, 3020],
      ["quick", 3020, 3200],
      ["fox!", 3200, 3960],
    ]);
  });

  it("shares the time out by word length otherwise", () => {
    const edited = editText(seg(0, [["hi", 0, 1000]]), "ab abcd ab");
    expect(edited.words.map((w) => [w.text, w.start_ms, w.end_ms])).toEqual([
      ["ab", 0, 250],
      ["abcd", 250, 750],
      ["ab", 750, 1000],
    ]);
  });

  it("allows clearing the text", () => {
    expect(editText(segments[0], "   ")).toMatchObject({ text: "", words: [] });
  });
});

describe("editTimes", () => {
  it("moves the segment and rescales its words", () => {
    const result = editTimes(segments, 1, 2800, 4000) as Segment[];
    expect(result[1]).toMatchObject({ start_ms: 2800, end_ms: 4000 });
    expect(result[1].words[0]).toMatchObject({ start_ms: 2800, end_ms: 2946 });
    expect(result[1].words[2].end_ms).toBe(4000);
    expect(result[0]).toBe(segments[0]);
  });

  it("rejects overlaps and too-short captions", () => {
    expect(editTimes(segments, 1, 2600, 3960)).toMatch(/previous/);
    expect(editTimes(segments, 0, 1040, 3000)).toMatch(/next/);
    expect(editTimes(segments, 0, 1040, 1100)).toMatch(/at least/);
  });
});
