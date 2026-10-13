import { describe, expect, it } from "vitest";
import shared from "../../fixtures/position-cases.json";
import { DEFAULT_STYLE } from "./presets";
import { anchorForY, anchorPoint, captionExtents, fitAnchor, fittedStyle, placement, playResX } from "./position";
import type { Style } from "./types";

describe("placement (shared cases with ass.rs)", () => {
  for (const c of shared.cases) {
    it(c.name, () => {
      const style: Style = { ...DEFAULT_STYLE, pos_x: null, pos_y: null, ...(c.style as Partial<Style>) };
      const res = playResX(c.frame.width, c.frame.height);
      expect(res).toBe(c.play_res_x);
      expect(placement(style, res)).toEqual({ an: c.an, x: c.pos[0], y: c.pos[1] });
    });
  }
});

describe("anchors", () => {
  it("uses the preset spot until a free position is set", () => {
    expect(anchorPoint({ ...DEFAULT_STYLE, position: "bottom" })).toEqual({ x: 0.5, y: 1 - 86 / 1080 });
    expect(anchorPoint({ ...DEFAULT_STYLE, pos_x: 0.2, pos_y: 0.4 })).toEqual({ x: 0.2, y: 0.4 });
  });

  it("anchors by thirds of the frame", () => {
    expect(anchorForY(0.1)).toBe("top");
    expect(anchorForY(0.5)).toBe("middle");
    expect(anchorForY(0.9)).toBe("bottom");
  });
});

describe("keeping captions inside the frame", () => {
  // A fake font: every character is 10 script pixels wide.
  const measure = (text: string) => [...text].length * 10;
  const seg = (text: string, start = 0) => ({
    id: start,
    start_ms: start,
    end_ms: start + 1000,
    text,
    words: text.split(" ").map((t, i) => ({ start_ms: start + i * 100, end_ms: start + i * 100 + 100, text: t })),
  });
  const style: Style = {
    ...DEFAULT_STYLE,
    uppercase: false,
    max_chars_per_line: 20,
    max_lines: 2,
    font_size: 60,
    outline_width: 5,
    mode: "line",
  };

  it("measures the widest line and the most lines, outline included", () => {
    const ext = captionExtents([seg("short"), seg("a much longer line here and more words", 2000)], style, measure);
    // Lines "a much longer line" (18) and "here and more words" (19): the widest is 19
    // characters; two lines of 60 px.
    expect(ext).toEqual({ width: 190 + 10, height: 120 + 10 });
  });

  it("measures single words in one_word mode", () => {
    expect(captionExtents([seg("hi wonderful")], { ...style, mode: "one_word" }, measure)).toEqual({
      width: 90 + 10,
      height: 60 + 10,
    });
  });

  it("pulls a caption back inside the frame", () => {
    const ext = { width: 400, height: 130 };
    // Dragged to the bottom-right corner of a 608-wide (9:16) frame.
    const corner = fitAnchor({ ...style, position: "bottom", pos_x: 1, pos_y: 1 }, ext, 608);
    expect(corner.x * 608).toBe(408); // 608 - 200
    expect(corner.y * 1080).toBe(1080); // bottom edge on the frame edge
    // Top-anchored at the very top stays; middle-anchored too high comes down by half.
    expect(fitAnchor({ ...style, position: "top", pos_x: 0.5, pos_y: 0 }, ext, 608).y).toBe(0);
    expect(fitAnchor({ ...style, position: "middle", pos_x: 0.5, pos_y: 0 }, ext, 608).y * 1080).toBe(65);
  });

  it("leaves captions that fit where they are, and centres oversized ones", () => {
    const placed = { ...style, position: "bottom" as const, pos_x: 0.3, pos_y: 0.8 };
    expect(fitAnchor(placed, { width: 100, height: 60 }, 1920)).toEqual({ x: 0.3, y: 0.8 });
    expect(fitAnchor(placed, { width: 5000, height: 60 }, 1920).x).toBe(0.5);
    expect(fittedStyle(placed, { width: 100, height: 60 }, 1920)).toMatchObject({ pos_x: 0.3, pos_y: 0.8 });
  });
});
