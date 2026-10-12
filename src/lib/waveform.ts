import { invoke } from "@tauri-apps/api/core";

/** Peak levels per second (src-tauri/src/waveform.rs). */
export const PEAKS_PER_SECOND = 100;

/** One byte (0–255, dB scale) per 10 ms of the video's audio; empty without audio. */
export async function getWaveform(path: string): Promise<Uint8Array> {
  const buffer = await invoke<ArrayBuffer>("get_waveform", { path });
  return new Uint8Array(buffer);
}
