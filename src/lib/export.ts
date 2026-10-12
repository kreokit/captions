import { invoke } from "@tauri-apps/api/core";
import type { Segment, Style } from "./types";

export type SubtitleFormat = "srt" | "vtt" | "ass";

export const SUBTITLE_FORMATS: Record<SubtitleFormat, { label: string; extension: string }> = {
  srt: { label: "SubRip subtitles (.srt)", extension: "srt" },
  vtt: { label: "WebVTT subtitles (.vtt)", extension: "vtt" },
  ass: { label: "Styled subtitles (.ass)", extension: "ass" },
};

/** Writes the captions as SRT, WebVTT or styled ASS; returns the path written. */
export function exportSubtitles(
  path: string,
  format: SubtitleFormat,
  videoPath: string,
  segments: Segment[],
  style: Style,
): Promise<string> {
  return invoke<string>("export_subtitles", { path, format, videoPath, segments, style });
}

/** "/a/b/clip.mov" + "srt" → "clip.srt" */
export function defaultExportName(videoPath: string, extension: string): string {
  const name = videoPath.split(/[\\/]/).pop() ?? "captions";
  return `${name.replace(/\.[^.]+$/, "")}.${extension}`;
}
