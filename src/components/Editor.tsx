import { useCallback, useEffect, useState } from "react";
import { confirm, save } from "@tauri-apps/plugin-dialog";
import { PROJECT_EXTENSION, saveProject } from "../lib/project";
import { fileName } from "../lib/video";
import { useEditor } from "../store/editor";
import { ExportMenu } from "./ExportMenu";
import { SegmentList } from "./SegmentList";
import { StylePanel } from "./StylePanel";
import { VideoPlayer } from "./VideoPlayer";

export function Editor() {
  const project = useEditor((s) => s.project);
  const path = useEditor((s) => s.path);
  const dirty = useEditor((s) => s.dirty);
  const [status, setStatus] = useState<string | null>(null);
  const [tab, setTab] = useState<"captions" | "style">("captions");

  const saveTo = useCallback(async (saveAs: boolean) => {
    const { project, path, markSaved } = useEditor.getState();
    if (!project) return;
    let target = saveAs ? null : path;
    if (!target) {
      target = await save({
        defaultPath: fileName(project.video_path).replace(/\.[^.]+$/, "") + "." + PROJECT_EXTENSION,
        filters: [{ name: "KreoKit Captions project", extensions: [PROJECT_EXTENSION] }],
      });
      if (!target) return;
    }
    try {
      const saved = await saveProject(target, project);
      markSaved(saved);
      setStatus(`Saved ${fileName(saved)}`);
    } catch (e) {
      setStatus(String(e));
    }
  }, []);

  // ⌘S / Ctrl+S saves, with Shift for Save As.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        // Let a focused text box commit its edit first.
        (document.activeElement as HTMLElement | null)?.blur();
        void saveTo(e.shiftKey);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saveTo]);

  async function close() {
    if (
      useEditor.getState().dirty &&
      !(await confirm("Close without saving? Your caption edits will be lost.", {
        title: "Unsaved changes",
        kind: "warning",
      }))
    ) {
      return;
    }
    useEditor.getState().close();
  }

  if (!project) return null;
  return (
    <main className="editor">
      <header className="editor-bar">
        <button type="button" className="secondary" onClick={close}>
          ← Home
        </button>
        <h1 title={path ?? project.video_path}>
          {path ? fileName(path) : fileName(project.video_path)}
          {dirty && <span className="dirty" title="Unsaved changes"> •</span>}
        </h1>
        {status && <span className="hint">{status}</span>}
        <ExportMenu onStatus={setStatus} />
        <button type="button" className="secondary" onClick={() => saveTo(true)}>
          Save As…
        </button>
        <button type="button" onClick={() => saveTo(false)}>
          Save
        </button>
      </header>
      <div className="editor-body">
        <VideoPlayer path={project.video_path} />
        <section className="editor-side">
          <div className="tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "captions"}
              onClick={() => setTab("captions")}
            >
              Captions
            </button>
            <button type="button" role="tab" aria-selected={tab === "style"} onClick={() => setTab("style")}>
              Style
            </button>
          </div>
          <div className="editor-list">{tab === "captions" ? <SegmentList /> : <StylePanel />}</div>
        </section>
      </div>
    </main>
  );
}
