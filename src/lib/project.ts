import { invoke } from "@tauri-apps/api/core";
import type { Project } from "./types";

export const PROJECT_EXTENSION = "kreocap";

export { DEFAULT_STYLE } from "./presets";

/** Saves and returns the final path (".kreocap" is added if missing). */
export function saveProject(path: string, project: Project): Promise<string> {
  return invoke<string>("save_project", { path, project });
}

export function loadProject(path: string): Promise<Project> {
  return invoke<Project>("load_project", { path });
}
