import { describe, expect, it } from "vitest";
import { overlayWords } from "./overlay";
import type { Segment } from "./types";

const segments: Segment[] = [
  {
    id: 0,
    start_ms: 1000,
    end_ms: 2000,
    text: "Hello there friend",
    words: [
      { start_ms: 1000, end_ms: 1300, text: "Hello" },
      { start_ms: 1400, end_ms: 1700, text: "there" },
      { start_ms: 1700, end_ms: 2000, text: "friend" },
    ],
  },
];

const shown = (ms: number, mode: "line" | "word_highlight" | "one_word") =>
  overlayWords(segments, ms, mode)?.map((w) => (w.active ? `[${w.text}]` : w.text)).join(" ") ?? null;

describe("overlayWords", () => {
  it("shows nothing outside captions", () => {
    expect(shown(500, "line")).toBeNull();
    expect(shown(2000, "word_highlight")).toBeNull();
  });

  it("line mode shows the whole caption", () => {
    expect(shown(1500, "line")).toBe("Hello there friend");
  });

  it("word_highlight marks the spoken word, none between words", () => {
    expect(shown(1500, "word_highlight")).toBe("Hello [there] friend");
    expect(shown(1350, "word_highlight")).toBe("Hello there friend");
  });

  it("one_word shows the spoken word and holds it between words", () => {
    expect(shown(1100, "one_word")).toBe("[Hello]");
    expect(shown(1350, "one_word")).toBe("[Hello]");
    expect(shown(1800, "one_word")).toBe("[friend]");
  });

  it("falls back to the text when a segment has no words", () => {
    const noWords: Segment[] = [{ ...segments[0], words: [] }];
    expect(overlayWords(noWords, 1500, "one_word")).toEqual([
      { text: "Hello there friend", active: false },
    ]);
  });
});
