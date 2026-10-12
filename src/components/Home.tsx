import { useCallback, useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { Film, FolderOpen, TriangleAlert, Trash2, Upload } from "lucide-react";
import mark from "../assets/kreokit-mark.png";
import { PROJECT_EXTENSION, openProjectFile } from "../lib/project";
import { RecentEntry, allowDroppedVideo, listRecent, relativeTime, removeRecent, videoThumbnail } from "../lib/recent";
import { VIDEO_EXTENSIONS, VideoInfo, fileName, probeVideo } from "../lib/video";
import { Button, MenuEntry, toast, useContextMenu } from "../ui";
import { TranscribeDialog } from "./TranscribeDialog";
import "../styles/home.css";

interface Pending {
  path: string;
  info: VideoInfo | null;
  thumbnail: string | null;
}

const extensionOf = (path: string) => path.split(".").pop()?.toLowerCase() ?? "";

/** Home: drop or choose a video, or reopen a recent project. */
export function Home() {
  const [recent, setRecent] = useState<RecentEntry[] | null>(null);
  const [dragging, setDragging] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    listRecent().then(setRecent, () => setRecent([]));
  }, []);
  useEffect(refresh, [refresh]);

  const startVideo = useCallback(async (path: string) => {
    setBusy(true);
    try {
      const [info, thumbnail] = await Promise.all([
        probeVideo(path).catch(() => null),
        videoThumbnail(path).catch(() => null),
      ]);
      setPending({ path, info, thumbnail });
    } finally {
      setBusy(false);
    }
  }, []);

  const openProject = useCallback(
    async (path: string) => {
      try {
        await openProjectFile(path);
      } catch (e) {
        toast(String(e), "error");
        refresh();
      }
    },
    [refresh],
  );

  // Dropping a video starts it; dropping a .kreocap opens it.
  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent(async (event) => {
      const { type } = event.payload;
      if (type === "enter" || type === "over") return setDragging(true);
      setDragging(false);
      if (type !== "drop" || pending) return;
      const path = event.payload.paths[0];
      if (!path) return;
      if (extensionOf(path) === PROJECT_EXTENSION) return void openProject(path);
      try {
        await allowDroppedVideo(path);
        await startVideo(path);
      } catch (e) {
        toast(String(e), "error");
      }
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [pending, startVideo, openProject]);

  async function chooseVideo() {
    const path = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "Video", extensions: VIDEO_EXTENSIONS }],
    });
    if (path) await startVideo(path);
  }

  async function chooseProject() {
    const path = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "KreoKit Captions project", extensions: [PROJECT_EXTENSION] }],
    });
    if (path) await openProject(path);
  }

  return (
    <div className="home">
      <header className="topbar" data-tauri-drag-region>
        <img src={mark} alt="" className="topbar-mark" width={24} height={24} data-tauri-drag-region />
        <span className="home-brand" data-tauri-drag-region>
          KreoKit Captions
        </span>
        <div className="topbar-actions">
          <Button variant="ghost" icon={FolderOpen} onClick={chooseProject}>
            Open project…
          </Button>
        </div>
      </header>

      <main className="home-main">
        <section className={dragging ? "dropzone dragging" : "dropzone"} aria-label="Add a video">
          <div className="dropzone-icon">
            <Upload size={22} strokeWidth={1.75} aria-hidden />
          </div>
          <h1 className="dropzone-title">{dragging ? "Drop to caption it" : "Drop a video to caption it"}</h1>
          <p className="dropzone-text">Captions are made on this computer. Your video never leaves it.</p>
          <Button variant="primary" onClick={chooseVideo} disabled={busy}>
            Choose video
          </Button>
          <p className="dropzone-formats">MP4 · MOV · M4V · WebM · MKV · AVI</p>
        </section>

        <section className="recent" aria-labelledby="recent-title">
          <h2 id="recent-title" className="recent-title">
            Recent projects
          </h2>
          {recent === null ? null : recent.length === 0 ? (
            <p className="recent-empty">Projects you save appear here.</p>
          ) : (
            <div className="recent-grid">
              {recent.map((entry) => (
                <ProjectCard
                  key={entry.path}
                  entry={entry}
                  onOpen={() => openProject(entry.path)}
                  onRemove={() => void removeRecent(entry.path).then(refresh)}
                />
              ))}
            </div>
          )}
        </section>
      </main>

      {pending && (
        <TranscribeDialog
          videoPath={pending.path}
          info={pending.info}
          thumbnail={pending.thumbnail}
          onClose={() => setPending(null)}
        />
      )}
    </div>
  );
}

function ProjectCard({ entry, onOpen, onRemove }: { entry: RecentEntry; onOpen: () => void; onRemove: () => void }) {
  const { onContextMenu, menu } = useContextMenu(
    (): MenuEntry[] => [
      { label: "Open", icon: FolderOpen, disabled: !entry.exists, onSelect: onOpen },
      { label: "Remove from list", icon: Trash2, onSelect: onRemove },
    ],
    "Project actions",
  );
  const name = fileName(entry.path).replace(/\.kreocap$/, "");
  return (
    <>
      <button
        type="button"
        className={entry.exists ? "project-card" : "project-card missing"}
        onClick={entry.exists ? onOpen : undefined}
        onContextMenu={onContextMenu}
        aria-disabled={!entry.exists}
        title={entry.path}
      >
        <span className="project-thumb">
          {entry.thumbnail ? (
            <img src={convertFileSrc(entry.thumbnail)} alt="" loading="lazy" />
          ) : (
            <Film size={22} strokeWidth={1.75} aria-hidden />
          )}
        </span>
        <span className="project-info">
          <span className="project-name">{name}</span>
          {entry.exists ? (
            <span className="project-time">{relativeTime(entry.opened_at, Date.now())}</span>
          ) : (
            <span className="project-missing">
              <TriangleAlert size={12} strokeWidth={2} aria-hidden /> Moved or deleted
            </span>
          )}
        </span>
      </button>
      {menu}
    </>
  );
}
