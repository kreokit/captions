import type { Style } from "./types";
import presetData from "./presets.json";

export interface Preset {
  id: string;
  name: string;
  description: string;
  style: Style;
}

/** KreoKit's own caption looks. */
/** KreoKit's own caption looks. Stored as JSON so model.rs can test that
 * `Style::default()` equals "Bold highlight". */
export const PRESETS: Preset[] = presetData as Preset[];

/** The style new projects start with. Mirrors `Style::default()` in model.rs. */
export const DEFAULT_STYLE: Style = PRESETS[1].style;

/** The preset `style` is exactly, if any. */
export function matchingPreset(style: Style): Preset | undefined {
  return PRESETS.find((p) =>
    (Object.keys(p.style) as (keyof Style)[]).every((k) => p.style[k] === style[k]),
  );
}

/** Fonts available on both macOS and Windows, so exports render with the chosen font. */
export const FONTS = ["Arial", "Helvetica", "Verdana", "Georgia", "Trebuchet MS", "Impact", "Courier New"];
