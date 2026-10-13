import { describe, expect, it } from "vitest";
import shared from "../../fixtures/position-cases.json";
import { DEFAULT_STYLE } from "./presets";
import { anchorForY, anchorPoint, placement, playResX } from "./position";
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
