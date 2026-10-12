import { useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import {
  SUBTITLE_FORMATS,
  SubtitleFormat,
  defaultExportName,
  exportSubtitles,
  exportVideo,
} from "../lib/export";
import { CANCELLED, cancelTranscription } from "../lib/transcribe";
import { fileName } from "../lib/video";
import { useEditor } from "../store/editor";

export function ExportMenu({ onStatus }: { onStatus: (message: string) => void }) {
  const menu = useRef<HTMLDetailsElement>(null);
  const [busy, setBusy] = useState(false);
  /** Burn-in progress 0–100 while a video export runs. */
  const [videoProgress, setVideoProgress] = useState<number | null>(null);

  async function exportAs(format: SubtitleFormat) {
    menu.current?.removeAttribute("open");
    const { project } = useEditor.getState();
    if (!project) return;
    const { label, extension } = SUBTITLE_FORMATS[format];
    const path = await save({
      defaultPath: defaultExportName(project.video_path, extension),
      filters: [{ name: label, extensions: [extension] }],
    });
    if (!path) return;
    setBusy(true);
    try {
      const written = await exportSubtitles(
        path,
        format,
        project.video_path,
        project.segments,
        project.style,
      );
      onStatus(`Exported ${fileName(written)}`);
    } catch (e) {
      onStatus(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function exportMp4() {
    menu.current?.removeAttribute("open");
    const { project } = useEditor.getState();
    if (!project) return;
    const path = await save({
      defaultPath: defaultExportName(project.video_path, "captioned.mp4"),
      filters: [{ name: "MP4 video", extensions: ["mp4"] }],
    });
    if (!path) return;
    setBusy(true);
    setVideoProgress(0);
    try {
      const written = await exportVideo(
        project.video_path,
        path,
        project.segments,
        project.style,
        setVideoProgress,
      );
      onStatus(`Exported ${fileName(written)}`);
    } catch (e) {
      onStatus(String(e) === CANCELLED ? "Export cancelled" : String(e));
    } finally {
      setBusy(false);
      setVideoProgress(null);
    }
  }

  return (
    <>
      <details className="menu" ref={menu}>
        <summary className="button secondary" aria-disabled={busy}>
          Export ▾
        </summary>
        <div className="menu-items">
          <button type="button" onClick={exportMp4}>
            Video with captions (.mp4)
          </button>
          {(Object.keys(SUBTITLE_FORMATS) as SubtitleFormat[]).map((format) => (
            <button key={format} type="button" onClick={() => exportAs(format)}>
              {SUBTITLE_FORMATS[format].label}
            </button>
          ))}
        </div>
      </details>
      {videoProgress !== null && (
        <div className="modal-backdrop">
          <div className="modal" role="dialog" aria-modal="true" aria-label="Exporting video">
            <h2>Exporting video…</h2>
            <progress max={100} value={videoProgress} />
            <p className="hint">{videoProgress}%</p>
            <button type="button" className="secondary" onClick={() => cancelTranscription()}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}
