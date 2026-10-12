import { useCallback, useEffect, useState } from "react";
import { confirm, open as openDialog, save } from "@tauri-apps/plugin-dialog";
import { Ellipsis, FolderOpen, House, Save } from "lucide-react";
import mark from "../assets/kreokit-mark.png";
import { PROJECT_EXTENSION, loadProject, saveProject } from "../lib/project";
import { fileName } from "../lib/video";
import { useEditor } from "../store/editor";
import { Menu, Tabs, toast } from "../ui";
import { ExportMenu } from "./ExportMenu";
import { Scrubber } from "./Scrubber";
import { SegmentList } from "./SegmentList";
import { StylePanel } from "./StylePanel";
import { VideoPlayer } from "./VideoPlayer";
import "../styles/editor.css";

type Tab = "captions" | "style";

/** Asks before throwing away unsaved edits. True when it's fine to continue. */
async function okToDiscard(): Promise<boolean> {
  if (!useEditor.getState().dirty) return true;
  return confirm("Your caption edits haven't been saved and will be lost.", {
    title: "Discard unsaved changes?",
    kind: "warning",
    okLabel: "Discard",
    cancelLabel: "Keep editing",
  });
}

export function Editor() {
  const project = useEditor((s) => s.project);
  const path = useEditor((s) => s.path);
  const dirty = useEditor((s) => s.dirty);
  const [tab, setTab] = useState<Tab>("captions");

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
      toast(`Saved ${fileName(saved)}`, "success");
    } catch (e) {
      toast(String(e), "error");
    }
  }, []);

  const openProject = useCallback(async () => {
    if (!(await okToDiscard())) return;
    const chosen = await openDialog({
      multiple: false,
      directory: false,
      filters: [{ name: "KreoKit Captions project", extensions: [PROJECT_EXTENSION] }],
    });
    if (!chosen) return;
    try {
      useEditor.getState().open(await loadProject(chosen), chosen);
    } catch (e) {
      toast(String(e), "error");
    }
  }, []);

  const goHome = useCallback(async () => {
    if (await okToDiscard()) useEditor.getState().close();
  }, []);

  // ⌘S saves, ⇧⌘S saves as, ⌘O opens.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (key === "s") {
        e.preventDefault();
        // Let a focused text box commit its edit first.
        (document.activeElement as HTMLElement | null)?.blur();
        void saveTo(e.shiftKey);
      } else if (key === "o") {
        e.preventDefault();
        void openProject();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saveTo, openProject]);

  if (!project) return null;
  const name = path ? fileName(path) : fileName(project.video_path);

  return (
    <div className="editor">
      <header className="topbar" data-tauri-drag-region>
        <img src={mark} alt="" className="topbar-mark" width={24} height={24} data-tauri-drag-region />
        <div className="topbar-title" data-tauri-drag-region>
          <span className="topbar-name" title={path ?? project.video_path} data-tauri-drag-region>
            {name}
          </span>
          {dirty && <span className="topbar-dirty" role="img" aria-label="Unsaved changes" title="Unsaved changes" />}
        </div>
        <div className="topbar-actions">
          <Menu
            buttonLabel="Project menu"
            icon={Ellipsis}
            variant="ghost"
            align="end"
            items={[
              { label: "Save", icon: Save, shortcut: "⌘S", onSelect: () => void saveTo(false) },
              { label: "Save As…", shortcut: "⇧⌘S", onSelect: () => void saveTo(true) },
              "separator",
              { label: "Open project…", icon: FolderOpen, shortcut: "⌘O", onSelect: () => void openProject() },
              { label: "Back to Home", icon: House, onSelect: () => void goHome() },
            ]}
          />
          <ExportMenu />
        </div>
      </header>

      <div className="editor-main">
        <VideoPlayer path={project.video_path} />
        <aside className="inspector" aria-label="Inspector">
          <Tabs
            label="Inspector"
            value={tab}
            onChange={setTab}
            tabs={[
              { value: "captions", label: "Captions" },
              { value: "style", label: "Style" },
            ]}
          />
          <div
            className="inspector-body"
            role="tabpanel"
            id={`tabpanel-${tab}`}
            aria-labelledby={`tab-${tab}`}
          >
            {tab === "captions" ? <SegmentList /> : <StylePanel />}
          </div>
        </aside>
      </div>

      <Scrubber />
    </div>
  );
}
