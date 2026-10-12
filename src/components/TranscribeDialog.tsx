import { useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Film } from "lucide-react";
import {
  CANCELLED,
  DEFAULT_MODEL,
  LANGUAGES,
  ModelInfo,
  WhisperModel,
  cancelTranscription,
  describeProgress,
  downloadModel,
  formatBytes,
  listModels,
  loadCustomWords,
  saveCustomWords,
  transcribe,
} from "../lib/transcribe";
import { VideoInfo, fileName, formatDuration, formatFps } from "../lib/video";
import { projectFromTranscript, useEditor } from "../store/editor";
import { Button, Checkbox, Dialog, Field, ProgressBar, Segmented, Select, TextInput } from "../ui";

type RunState =
  | { status: "idle" }
  | { status: "running"; label: string; percent: number | null }
  | { status: "error"; message: string };

const MODEL_NAMES: Record<WhisperModel, { label: string; speed: string }> = {
  base: { label: "Base", speed: "fast" },
  small: { label: "Small", speed: "balanced" },
  "large-v3-turbo": { label: "Large", speed: "most accurate" },
};

/**
 * The transcribe step: language, model, custom words and sound tags for one video, then
 * progress (download if needed, then transcription). Opens the editor when done.
 */
export function TranscribeDialog({
  videoPath,
  info,
  thumbnail,
  onClose,
}: {
  videoPath: string;
  /** null when the video couldn't be probed (transcription only needs ffmpeg). */
  info: VideoInfo | null;
  thumbnail: string | null;
  onClose: () => void;
}) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [model, setModel] = useState<WhisperModel>(DEFAULT_MODEL);
  const [language, setLanguage] = useState("auto");
  const [hideNonSpeech, setHideNonSpeech] = useState(true);
  const [customWords, setCustomWords] = useState(loadCustomWords);
  const [run, setRun] = useState<RunState>({ status: "idle" });
  const startButton = useRef<HTMLButtonElement>(null);
  // Progress messages can arrive after a run has ended; only the active run may update.
  const runId = useRef(0);

  useEffect(() => {
    listModels().then(setModels, (e) => setRun({ status: "error", message: String(e) }));
    return () => {
      runId.current++;
      void cancelTranscription();
    };
  }, []);

  const selected = models.find((m) => m.id === model);
  const running = run.status === "running";

  async function start() {
    const id = ++runId.current;
    const update = (next: RunState) => {
      if (runId.current === id) setRun(next);
    };
    try {
      if (selected && !selected.downloaded) {
        update({ status: "running", label: "Downloading model…", percent: 0 });
        await downloadModel(model, (p) =>
          update({
            status: "running",
            label: `Downloading model · ${formatBytes(p.downloaded_bytes)} of ${formatBytes(p.total_bytes)}`,
            percent: Math.floor((p.downloaded_bytes / p.total_bytes) * 100),
          }),
        );
        setModels(await listModels());
      }
      update({ status: "running", label: "Starting…", percent: null });
      saveCustomWords(customWords);
      const transcript = await transcribe(videoPath, language, model, hideNonSpeech, customWords, (p) =>
        update({ status: "running", ...describeProgress(p) }),
      );
      if (runId.current === id) {
        useEditor.getState().open(projectFromTranscript(videoPath, transcript, model), null);
      }
    } catch (e) {
      update(String(e) === CANCELLED ? { status: "idle" } : { status: "error", message: String(e) });
    } finally {
      if (runId.current === id) runId.current++;
    }
  }

  const meta = info
    ? `${formatDuration(info.duration_ms).replace(/\.\d+$/, "")} · ${info.width}×${info.height} · ${formatFps(info.fps)} fps`
    : "Video details unavailable";

  return (
    <Dialog
      title="Transcribe"
      onClose={onClose}
      dismissible={!running}
      initialFocus={startButton}
      width={480}
      footer={
        running ? (
          <Button variant="secondary" onClick={() => cancelTranscription()}>
            Cancel
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button ref={startButton} variant="primary" onClick={start} disabled={!selected}>
              Transcribe
            </Button>
          </>
        )
      }
    >
      <div className="transcribe">
        <div className="transcribe-video">
          <div className="transcribe-thumb">
            {thumbnail ? <img src={convertFileSrc(thumbnail)} alt="" /> : <Film size={20} strokeWidth={1.75} />}
          </div>
          <div className="transcribe-video-text">
            <span className="transcribe-name" title={videoPath}>
              {fileName(videoPath)}
            </span>
            <span className="transcribe-meta tabular">{meta}</span>
          </div>
        </div>

        {running ? (
          <div className="transcribe-progress" aria-live="polite">
            <ProgressBar value={run.percent} label="Transcription progress" />
            <span>{run.label}</span>
          </div>
        ) : (
          <>
            <Field label="Language">
              <Select
                label="Language"
                value={language}
                onChange={setLanguage}
                options={LANGUAGES.map((l) => ({ value: l.code, label: l.label }))}
              />
            </Field>
            <Field label="Model">
              <Segmented
                label="Model"
                value={model}
                onChange={setModel}
                options={(models.length ? models : []).map((m) => ({
                  value: m.id,
                  label: MODEL_NAMES[m.id].label,
                  hint: `${MODEL_NAMES[m.id].speed} · ${m.downloaded ? "ready" : formatBytes(m.size_bytes)}`,
                }))}
              />
            </Field>
            <Field label="Custom words" hint="Names, brands or jargon, separated by commas. Helps Whisper spell them right.">
              <TextInput
                value={customWords}
                onChange={(e) => setCustomWords(e.target.value)}
                placeholder="e.g. KreoKit, Dr. Okafor, TypeScript"
                spellCheck={false}
              />
            </Field>
            <Checkbox label="Hide sound tags like [MUSIC]" checked={hideNonSpeech} onChange={setHideNonSpeech} />
            {selected && !selected.downloaded && (
              <p className="transcribe-note">
                The {MODEL_NAMES[model].label} model ({formatBytes(selected.size_bytes)}) downloads once, then works offline.
              </p>
            )}
          </>
        )}
        {run.status === "error" && <p className="transcribe-error">{run.message}</p>}
      </div>
    </Dialog>
  );
}
