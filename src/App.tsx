import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  VIDEO_EXTENSIONS,
  VideoInfo,
  fileName,
  formatDuration,
  formatFps,
  probeVideo,
} from "./lib/video";
import { PROJECT_EXTENSION, loadProject } from "./lib/project";
import { Editor } from "./components/Editor";
import { TranscribePanel } from "./components/TranscribePanel";
import { useEditor } from "./store/editor";
import "./App.css";

type ProbeState =
  | { status: "idle" }
  | { status: "probing"; path: string }
  | { status: "done"; path: string; info: VideoInfo }
  | { status: "error"; path: string; message: string };

function App() {
  const hasProject = useEditor((s) => s.project !== null);
  return hasProject ? <Editor /> : <Home />;
}

function Home() {
  const [probe, setProbe] = useState<ProbeState>({ status: "idle" });
  const [openError, setOpenError] = useState<string | null>(null);

  async function openProject() {
    const path = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "KreoKit Captions project", extensions: [PROJECT_EXTENSION] }],
    });
    if (!path) return;
    try {
      useEditor.getState().open(await loadProject(path), path);
    } catch (e) {
      setOpenError(String(e));
    }
  }

  async function chooseVideo() {
    const path = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "Video", extensions: VIDEO_EXTENSIONS }],
    });
    if (!path) return;

    setProbe({ status: "probing", path });
    try {
      const info = await probeVideo(path);
      setProbe({ status: "done", path, info });
    } catch (e) {
      setProbe({ status: "error", path, message: String(e) });
    }
  }

  return (
    <main className="home">
      <header>
        <h1>KreoKit Captions</h1>
        <p className="tagline">Free, offline auto-captions for your videos.</p>
      </header>

      <section className="picker">
        <button
          type="button"
          onClick={chooseVideo}
          disabled={probe.status === "probing"}
        >
          Choose video
        </button>
        <button type="button" className="secondary" onClick={openProject}>
          Open project…
        </button>
        <p className="hint">MP4, MOV, MKV, WebM or AVI. Nothing leaves your computer.</p>
        {openError && <p className="error">{openError}</p>}
      </section>

      {probe.status !== "idle" && (
        <section className="panel result" aria-live="polite">
          <h2 title={probe.path}>{fileName(probe.path)}</h2>
          {probe.status === "probing" && <p>Reading video…</p>}
          {probe.status === "error" && <p className="error">{probe.message}</p>}
          {probe.status === "done" && (
            <dl>
              <dt>Duration</dt>
              <dd>{formatDuration(probe.info.duration_ms)}</dd>
              <dt>Resolution</dt>
              <dd>
                {probe.info.width} × {probe.info.height}
              </dd>
              <dt>Frame rate</dt>
              <dd>{formatFps(probe.info.fps)} fps</dd>
            </dl>
          )}
        </section>
      )}

      {/* Transcription only needs ffmpeg, so a failed probe doesn't block it. */}
      {(probe.status === "done" || probe.status === "error") && (
        <TranscribePanel videoPath={probe.path} />
      )}
    </main>
  );
}

export default App;
