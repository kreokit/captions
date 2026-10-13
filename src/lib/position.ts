/**
 * Caption placement: where a caption's anchor sits in the frame. Mirrors `placement` in
 * src-tauri/src/ass.rs, and both are tested against fixtures/position-cases.json, so the
 * preview and the exports put captions in exactly the same place.
 */
import type { Position, Style } from "./types";

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
