import { beforeEach, describe, expect, it } from "vitest";
import { projectFromTranscript, useEditor } from "./editor";

const transcript = {
  language: "en",
  segments: [
    {
      id: 0,
      start_ms: 1000,
      end_ms: 2000,
      text: "Hello there",
      words: [
        { start_ms: 1000, end_ms: 1400, text: "Hello" },
        { start_ms: 1400, end_ms: 2000, text: "there" },
      ],
    },
  ],
};

describe("editor store", () => {
  beforeEach(() => useEditor.getState().close());

  it("starts a new project from a transcript as unsaved", () => {
    useEditor.getState().open(projectFromTranscript("/v.mp4", transcript, "base"), null);
    const { project, dirty, path } = useEditor.getState();
    expect(project?.video_path).toBe("/v.mp4");
    expect(project?.style.mode).toBe("word_highlight");
    expect(dirty).toBe(true);
    expect(path).toBeNull();
  });

  it("tracks unsaved edits", () => {
    const store = useEditor.getState();
    store.open(projectFromTranscript("/v.mp4", transcript, "base"), "/p.kreocap");
    expect(useEditor.getState().dirty).toBe(false);

    store.split(0, 1);
    expect(useEditor.getState().project?.segments.map((s) => s.text)).toEqual(["Hello", "there"]);
    expect(useEditor.getState().dirty).toBe(true);

    store.markSaved("/p.kreocap");
    expect(useEditor.getState().dirty).toBe(false);
  });

  it("ignores edits that change nothing", () => {
    const store = useEditor.getState();
    store.open(projectFromTranscript("/v.mp4", transcript, "base"), "/p.kreocap");
    store.setText(0, "Hello there");
    store.merge(0); // no next segment
    expect(useEditor.getState().dirty).toBe(false);
  });

  it("changes the style and marks the project dirty only on real changes", () => {
    const store = useEditor.getState();
    store.open(projectFromTranscript("/v.mp4", transcript, "base"), "/p.kreocap");
    store.setStyle({ font_size: useEditor.getState().project!.style.font_size });
    expect(useEditor.getState().dirty).toBe(false);
    store.setStyle({ position: "top" });
    expect(useEditor.getState().project?.style.position).toBe("top");
    expect(useEditor.getState().dirty).toBe(true);
  });

  it("keeps the selection inside the list after deleting", () => {
    const store = useEditor.getState();
    store.open(projectFromTranscript("/v.mp4", transcript, "base"), "/p.kreocap");
    store.split(0, 1);
    store.select(1);
    store.remove(1);
    expect(useEditor.getState().selected).toBe(0);
    store.remove(0);
    expect(useEditor.getState().selected).toBeNull();
  });

  it("reports rejected times without changing anything", () => {
    const store = useEditor.getState();
    store.open(projectFromTranscript("/v.mp4", transcript, "base"), "/p.kreocap");
    expect(store.setTimes(0, 2000, 1000)).toMatch(/at least/);
    expect(useEditor.getState().dirty).toBe(false);
    expect(store.setTimes(0, 900, 2100)).toBeNull();
    expect(useEditor.getState().project?.segments[0].start_ms).toBe(900);
  });
});
