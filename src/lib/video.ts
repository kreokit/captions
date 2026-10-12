import { invoke } from "@tauri-apps/api/core";

/** Mirrors `VideoInfo` in src-tauri/src/probe.rs. */
export interface VideoInfo {
  duration_ms: number;
  width: number;
  height: number;
  fps: number;
}

export const VIDEO_EXTENSIONS = ["mp4", "mov", "m4v", "mkv", "webm", "avi"];

export function probeVideo(path: string): Promise<VideoInfo> {
  return invoke<VideoInfo>("probe_video", { path });
}

/** 83_456 → "1:23.456", 3_723_000 → "1:02:03.000" */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const millis = String(ms % 1000).padStart(3, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${ss}.${millis}`
    : `${m}:${ss}.${millis}`;
}

/** 29.97002997 → "29.97", 25 → "25" */
export function formatFps(fps: number): string {
  return String(Math.round(fps * 100) / 100);
}

export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}
