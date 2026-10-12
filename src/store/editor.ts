import { create } from "zustand";
import {
  deleteSegment,
  editText,
  editTimes,
  mergeWithNext,
  splitSegment,
} from "../lib/captions";
import { DEFAULT_STYLE } from "../lib/project";
import type { Transcript, WhisperModel } from "../lib/transcribe";
import type { Project, Segment } from "../lib/types";

export function projectFromTranscript(
  videoPath: string,
  transcript: Transcript,
  model: WhisperModel,
): Project {
  return {
    version: 1,
    video_path: videoPath,
    language: transcript.language,
    model,
    segments: transcript.segments,
    style: DEFAULT_STYLE,
  };
}

interface EditorState {
  project: Project | null;
  /** Where the project was last saved; null for a new, unsaved project. */
  path: string | null;
  /** Unsaved changes. */
  dirty: boolean;
  /** Playback position of the video. */
  currentMs: number;
  /** Length of the video, once the player has loaded it (0 before). */
  durationMs: number;
  setDurationMs(ms: number): void;
  /** Moves the video to `ms`; provided by the mounted player. */
  seek(ms: number): void;
  setSeekHandler(handler: (ms: number) => void): void;

  open(project: Project, path: string | null): void;
  close(): void;
  setCurrentMs(ms: number): void;
  markSaved(path: string): void;

  split(index: number, wordIndex: number): void;
  merge(index: number): void;
  remove(index: number): void;
  setText(index: number, text: string): void;
  /** Returns an error message if the times are rejected. */
  setTimes(index: number, startMs: number, endMs: number): string | null;
}

export const useEditor = create<EditorState>()((set, get) => {
  /** Applies an edit to the segments and marks the project dirty. */
  const edit = (change: (segments: Segment[]) => Segment[]) => {
    const { project } = get();
    if (!project) return;
    const segments = change(project.segments);
    if (segments !== project.segments) set({ project: { ...project, segments }, dirty: true });
  };

  return {
    project: null,
    path: null,
    dirty: false,
    currentMs: 0,
    durationMs: 0,
    setDurationMs: (durationMs) => set({ durationMs }),
    seek: () => {},
    setSeekHandler: (seek) => set({ seek }),

    open: (project, path) =>
      set({ project, path, dirty: path === null, currentMs: 0, durationMs: 0 }),
    close: () => set({ project: null, path: null, dirty: false, currentMs: 0, durationMs: 0 }),
    setCurrentMs: (currentMs) => set({ currentMs }),
    markSaved: (path) => set({ path, dirty: false }),

    split: (index, wordIndex) => edit((s) => splitSegment(s, index, wordIndex)),
    merge: (index) => edit((s) => mergeWithNext(s, index)),
    remove: (index) => edit((s) => deleteSegment(s, index)),
    setText: (index, text) =>
      edit((s) =>
        s[index] && s[index].text !== text ? s.map((seg, i) => (i === index ? editText(seg, text) : seg)) : s,
      ),
    setTimes: (index, startMs, endMs) => {
      const { project } = get();
      if (!project) return null;
      const result = editTimes(project.segments, index, startMs, endMs);
      if (typeof result === "string") return result;
      edit(() => result);
      return null;
    },
  };
});
