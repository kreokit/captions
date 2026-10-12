import { Channel, invoke } from "@tauri-apps/api/core";
import type { Segment } from "./types";

/** Mirrors `WhisperModel` in src-tauri/src/models.rs. */
export type WhisperModel = "base" | "small" | "large-v3-turbo";

export interface ModelInfo {
  id: WhisperModel;
  size_bytes: number;
  downloaded: boolean;
}

export interface DownloadProgress {
  downloaded_bytes: number;
  total_bytes: number;
}

export type TranscribeProgress =
  | { stage: "extracting" }
  | { stage: "loading_model" }
  | { stage: "transcribing"; percent: number };

export interface Transcript {
  language: string;
  segments: Segment[];
}

/** Error message the backend uses when a run is cancelled. */
export const CANCELLED = "cancelled";

export const MODEL_LABELS: Record<WhisperModel, string> = {
  base: "Base (fast)",
  small: "Small (balanced)",
  "large-v3-turbo": "Large v3 Turbo (most accurate, especially for non-English)",
};

/** Base keeps development fast; releases default to Small (CLAUDE.md). */
export const DEFAULT_MODEL: WhisperModel = import.meta.env.DEV ? "base" : "small";

/** "auto" (the default) means detect; the others are Whisper language codes.
 * English first, then alphabetical. */
export const LANGUAGES: { code: string; label: string }[] = [
  { code: "auto", label: "Detect automatically" },
  { code: "en", label: "English" },
  { code: "sq", label: "Albanian" },
  { code: "ar", label: "Arabic" },
  { code: "bs", label: "Bosnian" },
  { code: "bg", label: "Bulgarian" },
  { code: "zh", label: "Chinese" },
  { code: "hr", label: "Croatian" },
  { code: "nl", label: "Dutch" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "el", label: "Greek" },
  { code: "hi", label: "Hindi" },
  { code: "id", label: "Indonesian" },
  { code: "it", label: "Italian" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "mk", label: "Macedonian" },
  { code: "pl", label: "Polish" },
  { code: "pt", label: "Portuguese" },
  { code: "ro", label: "Romanian" },
  { code: "ru", label: "Russian" },
  { code: "sr", label: "Serbian" },
  { code: "es", label: "Spanish" },
  { code: "tr", label: "Turkish" },
  { code: "uk", label: "Ukrainian" },
  { code: "vi", label: "Vietnamese" },
];

export function listModels(): Promise<ModelInfo[]> {
  return invoke<ModelInfo[]>("list_models");
}

export function downloadModel(
  model: WhisperModel,
  onProgress: (p: DownloadProgress) => void,
): Promise<void> {
  const channel = new Channel<DownloadProgress>();
  channel.onmessage = onProgress;
  return invoke("download_model", { model, onProgress: channel });
}

export function transcribe(
  path: string,
  language: string,
  model: WhisperModel,
  hideNonSpeech: boolean,
  onProgress: (p: TranscribeProgress) => void,
): Promise<Transcript> {
  const channel = new Channel<TranscribeProgress>();
  channel.onmessage = onProgress;
  return invoke<Transcript>("transcribe", {
    path,
    language: language === "auto" ? null : language,
    model,
    hideNonSpeech,
    onProgress: channel,
  });
}

export function cancelTranscription(): Promise<void> {
  return invoke("cancel_transcription");
}

/** 147_951_465 → "148 MB", 1_624_555_275 → "1.6 GB" */
export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  return `${Math.round(bytes / 1e6)} MB`;
}

/** Status line and 0–100 bar value for a progress update. */
export function describeProgress(p: TranscribeProgress): { label: string; percent: number | null } {
  switch (p.stage) {
    case "extracting":
      return { label: "Extracting audio…", percent: null };
    case "loading_model":
      return { label: "Loading model…", percent: null };
    case "transcribing":
      return { label: `Transcribing… ${p.percent}%`, percent: p.percent };
  }
}
