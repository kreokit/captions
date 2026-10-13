/**
 * Caption placement: where a caption's anchor sits in the frame. Mirrors `placement` in
 * src-tauri/src/ass.rs, and both are tested against fixtures/position-cases.json, so the
 * preview and the exports put captions in exactly the same place.
 */
import { layout } from "./layout";
import { transformed } from "./overlay";
import type { Position, Segment, Style } from "./types";

/** Style sizes and ASS scripts use a frame this tall (ass.rs REFERENCE_HEIGHT). */
export const REFERENCE_HEIGHT = 1080;
/** The Top / Bottom preset spots: 86 px of a 1080 px frame from the edge. */
export const PRESET_MARGIN = 86 / REFERENCE_HEIGHT;

export const PRESET_Y: Record<Position, number> = {
  top: PRESET_MARGIN,
  middle: 0.5,
  bottom: 1 - PRESET_MARGIN,
};

/** ASS alignment of each anchor: horizontally centred, top / middle / bottom edge. */
export const ANCHOR_CODE: Record<Position, 8 | 5 | 2> = { top: 8, middle: 5, bottom: 2 };

const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);

/** The anchor as fractions of the frame (0–1); presets when no free position is set. */
export function anchorPoint(style: Style): { x: number; y: number } {
  return {
    x: clamp01(style.pos_x ?? 0.5),
    y: clamp01(style.pos_y ?? PRESET_Y[style.position]),
  };
}

/** The ASS script width for a video: 1080 high, as wide as the video's shape. */
export function playResX(width: number, height: number): number {
  return Math.max(1, Math.round((REFERENCE_HEIGHT * width) / Math.max(height, 1)));
}

/** The ASS alignment and the anchor in script coordinates, rounded like ass.rs. */
export function placement(style: Style, playRes: number): { an: 8 | 5 | 2; x: number; y: number } {
  const { x, y } = anchorPoint(style);
  return {
    an: ANCHOR_CODE[style.position],
    x: Math.round(x * playRes),
    y: Math.round(y * REFERENCE_HEIGHT),
  };
}

/** Which edge anchors a caption placed at height `y`: thirds of the frame. */
export function anchorForY(y: number): Position {
  if (y < 1 / 3) return "top";
  if (y > 2 / 3) return "bottom";
  return "middle";
}

/** The largest caption box the project will show, in script pixels (1080-high frame),
 * outline included. */
export interface Extents {
  width: number;
  height: number;
}

/**
 * Measures every caption page the exports will produce (same text transforms and line
 * layout; each word in one_word mode). `measure` gives a line's width in script pixels
 * for the style's font at its size.
 */
export function captionExtents(
  segments: Segment[],
  style: Style,
  measure: (text: string) => number,
): Extents {
  let width = 0;
  let lines = 0;
  for (const segment of segments) {
    const seg = transformed(segment, style);
    const { words, pages } = layout(seg, style.max_chars_per_line, style.max_lines);
    if (style.mode === "one_word") {
      for (const w of words) width = Math.max(width, measure(w.text));
      if (words.length) lines = Math.max(lines, 1);
      continue;
    }
    for (const page of pages) {
      lines = Math.max(lines, page.lines.length);
      for (const line of page.lines) {
        width = Math.max(width, measure(line.map((i) => words[i].text).join(" ")));
      }
    }
  }
  const outline = 2 * style.outline_width;
  return lines === 0 ? { width: 0, height: 0 } : { width: width + outline, height: lines * style.font_size + outline };
}

/**
 * The anchor moved just enough that a caption box of `extents` stays inside the frame
 * (horizontally centred on the anchor; vertically below, around or above it for top /
 * middle / bottom). A box larger than the frame is centred. Returns fractions (0–1).
 */
export function fitAnchor(style: Style, extents: Extents, playRes: number): { x: number; y: number } {
  const { x, y } = anchorPoint(style);
  const halfW = Math.min(extents.width, playRes) / 2;
  const h = Math.min(extents.height, REFERENCE_HEIGHT);
  const [minY, maxY] = {
    top: [0, REFERENCE_HEIGHT - h],
    middle: [h / 2, REFERENCE_HEIGHT - h / 2],
    bottom: [h, REFERENCE_HEIGHT],
  }[style.position];
  const px = Math.min(Math.max(x * playRes, halfW), playRes - halfW);
  const py = Math.min(Math.max(y * REFERENCE_HEIGHT, minY), maxY);
  return { x: px / playRes, y: py / REFERENCE_HEIGHT };
}

/** The style with its position fitted inside the frame: what preview and exports use. */
export function fittedStyle(style: Style, extents: Extents, playRes: number): Style {
  const { x, y } = fitAnchor(style, extents, playRes);
  return { ...style, pos_x: x, pos_y: y };
}
