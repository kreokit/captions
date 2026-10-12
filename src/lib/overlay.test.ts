import { describe, expect, it } from "vitest";
import { displayText, overlayFrame } from "./overlay";
import { DEFAULT_STYLE } from "./presets";
import type { CaptionMode, Segment, Style } from "./types";

// Same captions as the ASS snapshot tests in src-tauri/src/ass.rs.
const segments: Segment[] = [
  {
    id: 0,
    start_ms: 1000,
    end_ms: 2500,
    text: "Hello there friend",
    words: [
      { start_ms: 1000, end_ms: 1400, text: "Hello" },
      { start_ms: 1500, end_ms: 1800, text: "there" },
      { start_ms: 1800, end_ms: 2300, text: "friend" },
    ],
  },
];

function style(mode: CaptionMode, extra: Partial<Style> = {}): Style {
  return { ...DEFAULT_STYLE, mode, uppercase: false, max_chars_per_line: 11, max_lines: 2, ...extra };
}

/** Lines joined with " / ", the active word in [brackets]. */
const shown = (ms: number, s: Style) =>
  overlayFrame(segments, ms, s)
    ?.lines.map((line) => line.map((w) => (w.active ? `[${w.text}]` : w.text)).join(" "))
    .join(" / ") ?? null;

describe("overlayFrame", () => {
  it("shows nothing outside captions", () => {
    expect(shown(500, style("line"))).toBeNull();
    expect(shown(2500, style("word_highlight"))).toBeNull();
  });

  it("line mode: the page with the layout's line breaks", () => {
    expect(shown(1200, style("line"))).toBe("Hello there / friend");
  });

  it("word_highlight follows the ASS events", () => {
    const s = style("word_highlight");
    expect(shown(1000, s)).toBe("[Hello] there / friend");
    expect(shown(1450, s)).toBe("Hello there / friend");
    expect(shown(1500, s)).toBe("Hello [there] / friend");
    expect(shown(2300, s)).toBe("Hello there / friend");
  });

  it("one_word shows each word until the next starts", () => {
    const s = style("one_word", { uppercase: true });
    expect(shown(1000, s)).toBe("[HELLO]");
    expect(shown(1450, s)).toBe("[HELLO]");
    expect(shown(1800, s)).toBe("[FRIEND]");
    expect(shown(2400, s)).toBe("[FRIEND]");
  });

  it("changes key when a new caption appears", () => {
    const s = style("one_word");
    expect(overlayFrame(segments, 1000, s)?.key).not.toBe(overlayFrame(segments, 1500, s)?.key);
    expect(overlayFrame(segments, 1000, s)?.key).toBe(overlayFrame(segments, 1450, s)?.key);
  });

  it("uses the layout's single word for segments without timings", () => {
    const noWords: Segment[] = [{ ...segments[0], words: [] }];
    expect(overlayFrame(noWords, 1200, style("one_word"))?.lines).toEqual([
      [{ text: "Hello there friend", active: true }],
    ]);
  });
});

describe("displayText", () => {
  it("swaps ASS override characters like ass.rs", () => {
    expect(displayText("{\\b1}hi")).toBe("｛＼b1｝hi");
  });
});
