import { useCallback, useEffect, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { ChevronDown, FileText, Film } from "lucide-react";
import {
  SUBTITLE_FORMATS,
  SubtitleFormat,
  defaultExportName,
  exportSubtitles,
  exportVideo,
} from "../lib/export";
import { CANCELLED, cancelTranscription } from "../lib/transcribe";
import { fileName } from "../lib/video";
import { fitStyle } from "../lib/textMetrics";
import { useEditor } from "../store/editor";
import { Button, Dialog, Menu, MenuEntry, ProgressBar, toast } from "../ui";

/** The editor's one primary action: Export ▾ (MP4 with captions, or subtitle files). */
export function ExportMenu() {
  const [busy, setBusy] = useState(false);
  /** Burn-in progress 0–100 while a video export runs. */
  const [videoProgress, setVideoProgress] = useState<number | null>(null);

  const exportAs = async (format: SubtitleFormat) => {
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
      // The position fitted inside the frame, exactly as the preview shows it.
      const style = fitStyle(project.segments, project.style, useEditor.getState().videoSize);
      const written = await exportSubtitles(path, format, project.video_path, project.segments, style);
      toast(`Exported ${fileName(written)}`, "success");
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const exportMp4 = useCallback(async () => {
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
      const style = fitStyle(project.segments, project.style, useEditor.getState().videoSize);
      const written = await exportVideo(project.video_path, path, project.segments, style, setVideoProgress);
      toast(`Exported ${fileName(written)}`, "success");
    } catch (e) {
      toast(String(e) === CANCELLED ? "Export cancelled" : String(e), String(e) === CANCELLED ? "info" : "error");
    } finally {
      setBusy(false);
      setVideoProgress(null);
    }
  }, []);

  // ⌘E exports the video.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "e" && !busy) {
        e.preventDefault();
        void exportMp4();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, exportMp4]);

  const items: MenuEntry[] = [
    { label: "Video with captions (.mp4)", icon: Film, shortcut: "⌘E", onSelect: exportMp4 },
    "separator",
    ...(Object.keys(SUBTITLE_FORMATS) as SubtitleFormat[]).map((format) => ({
      label: SUBTITLE_FORMATS[format].label,
      icon: FileText,
      onSelect: () => void exportAs(format),
    })),
  ];

  return (
    <>
      <Menu label="Export" variant="primary" trailingIcon={ChevronDown} align="end" items={items} />
      {videoProgress !== null && (
        <Dialog
          title="Exporting video"
          dismissible={false}
          onClose={() => {}}
          width={420}
          footer={
            <Button variant="secondary" onClick={() => cancelTranscription()}>
              Cancel
            </Button>
          }
        >
          <div className="export-progress">
            <ProgressBar value={videoProgress} label="Export progress" />
            <span className="tabular">{videoProgress}%</span>
          </div>
        </Dialog>
      )}
    </>
  );
}
