import { useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { SUBTITLE_FORMATS, SubtitleFormat, defaultExportName, exportSubtitles } from "../lib/export";
import { fileName } from "../lib/video";
import { useEditor } from "../store/editor";

export function ExportMenu({ onStatus }: { onStatus: (message: string) => void }) {
  const menu = useRef<HTMLDetailsElement>(null);
  const [busy, setBusy] = useState(false);

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
      const written = await exportSubtitles(path, format, project.segments, project.style);
      onStatus(`Exported ${fileName(written)}`);
    } catch (e) {
      onStatus(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="menu" ref={menu}>
      <summary className="button secondary" aria-disabled={busy}>
        Export ▾
      </summary>
      <div className="menu-items">
        {(Object.keys(SUBTITLE_FORMATS) as SubtitleFormat[]).map((format) => (
          <button key={format} type="button" onClick={() => exportAs(format)}>
            {SUBTITLE_FORMATS[format].label}
          </button>
        ))}
      </div>
    </details>
  );
}
