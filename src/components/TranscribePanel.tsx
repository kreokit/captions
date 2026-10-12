import { useEffect, useRef, useState } from "react";
import {
  CANCELLED,
  DEFAULT_MODEL,
  LANGUAGES,
  MODEL_LABELS,
  ModelInfo,
  WhisperModel,
  cancelTranscription,
  describeProgress,
  downloadModel,
  formatBytes,
  listModels,
  transcribe,
} from "../lib/transcribe";
import { projectFromTranscript, useEditor } from "../store/editor";

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string; percent: number | null }
  | { status: "error"; message: string };

export function TranscribePanel({ videoPath }: { videoPath: string }) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [model, setModel] = useState<WhisperModel>(DEFAULT_MODEL);
  const [language, setLanguage] = useState("auto");
  const [hideNonSpeech, setHideNonSpeech] = useState(true);
  const [run, setRun] = useState<RunState>({ status: "idle" });
  // Progress messages can arrive after a run has ended; only the active run may update.
  const runId = useRef(0);

  useEffect(() => {
    listModels().then(setModels, (e) => setRun({ status: "error", message: String(e) }));
  }, []);

  // A new video starts fresh; stop any run still going for the previous one.
  useEffect(() => {
    runId.current++;
    setRun({ status: "idle" });
    return () => void cancelTranscription();
  }, [videoPath]);

  const selected = models.find((m) => m.id === model);
  const running = run.status === "running";

  async function start() {
    const id = ++runId.current;
    const update = (next: RunState) => {
      if (runId.current === id) setRun(next);
    };
    try {
      if (selected && !selected.downloaded) {
        setRun({ status: "running", label: "Downloading model…", percent: 0 });
        await downloadModel(model, (p) =>
          update({
            status: "running",
            label: `Downloading model… ${formatBytes(p.downloaded_bytes)} of ${formatBytes(p.total_bytes)}`,
            percent: Math.floor((p.downloaded_bytes / p.total_bytes) * 100),
          }),
        );
        setModels(await listModels());
      }
      update({ status: "running", label: "Starting…", percent: null });
      const transcript = await transcribe(videoPath, language, model, hideNonSpeech, (p) =>
        update({ status: "running", ...describeProgress(p) }),
      );
      if (runId.current === id) {
        useEditor.getState().open(projectFromTranscript(videoPath, transcript, model), null);
      }
    } catch (e) {
      update(
        String(e) === CANCELLED ? { status: "idle" } : { status: "error", message: String(e) },
      );
    } finally {
      if (runId.current === id) runId.current++;
    }
  }

  return (
    <section className="panel transcribe">
      <div className="controls">
        <label>
          Language
          <select value={language} onChange={(e) => setLanguage(e.target.value)} disabled={running}>
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Model
          <select
            value={model}
            onChange={(e) => setModel(e.target.value as WhisperModel)}
            disabled={running}
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {MODEL_LABELS[m.id]}
                {m.downloaded ? "" : ` · ${formatBytes(m.size_bytes)} download`}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="checkbox">
        <input
          type="checkbox"
          checked={hideNonSpeech}
          onChange={(e) => setHideNonSpeech(e.target.checked)}
          disabled={running}
        />
        Hide sound tags like [MUSIC] or (applause)
      </label>

      {running ? (
        <div className="progress">
          <progress max={100} value={run.percent ?? undefined} />
          <span>{run.label}</span>
          <button type="button" className="secondary" onClick={() => cancelTranscription()}>
            Cancel
          </button>
        </div>
      ) : (
        <button type="button" onClick={start} disabled={!selected}>
          Transcribe
        </button>
      )}

      {run.status === "error" && <p className="error">{run.message}</p>}

    </section>
  );
}
