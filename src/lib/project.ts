import { invoke } from "@tauri-apps/api/core";
import type { Project, Style } from "./types";

export const PROJECT_EXTENSION = "kreocap";

/** Mirrors `Style::default()` in src-tauri/src/model.rs. */
export const DEFAULT_STYLE: Style = {
  font_family: "Arial",
  font_size: 64,
  color: "#FFFFFF",
  highlight_color: "#FFD400",
  outline_color: "#000000",
  outline_width: 4,
  position: "bottom",
  max_chars_per_line: 32,
  max_lines: 2,
  mode: "word_highlight",
};

/** Saves and returns the final path (".kreocap" is added if missing). */
export function saveProject(path: string, project: Project): Promise<string> {
  return invoke<string>("save_project", { path, project });
}

export function loadProject(path: string): Promise<Project> {
  return invoke<Project>("load_project", { path });
}
