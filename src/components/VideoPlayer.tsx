import { useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { POP_MS, POP_SCALE, REFERENCE_HEIGHT, outlineShadow, overlayFrame } from "../lib/overlay";
import { placement, playResX } from "../lib/position";
import { emPerFontSize, useFittedStyle } from "../lib/textMetrics";
import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { nextCaptionStart, previousCaptionStart } from "../lib/captions";
import { formatDuration } from "../lib/video";
import { IconButton } from "../ui";
import type { Segment, Style } from "../lib/types";
import { useEditor } from "../store/editor";

/** Video with the live caption overlay and playback controls. Publishes the playback
 * position to the store. */
export function VideoPlayer({ path }: { path: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [aspect, setAspect] = useState(16 / 9);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setCurrentMs = useEditor((s) => s.setCurrentMs);
  const setDurationMs = useEditor((s) => s.setDurationMs);
  const setVideoSize = useEditor((s) => s.setVideoSize);
  const setPlayingInStore = useEditor((s) => s.setPlaying);
  const setSeekHandler = useEditor((s) => s.setSeekHandler);

  useEffect(() => {
    setSeekHandler((ms) => {
      if (video.current) video.current.currentTime = ms / 1000;
      setCurrentMs(ms);
    });
    return () => setSeekHandler(() => {});
  }, [setSeekHandler, setCurrentMs]);

  // timeupdate fires only ~4x per second; follow playback per animation frame instead.
  useEffect(() => {
    const el = video.current;
    if (!el) return;
    let raf = 0;
    const tick = () => {
      setCurrentMs(Math.round(el.currentTime * 1000));
      if (!el.paused) raf = requestAnimationFrame(tick);
    };
    const onPlay = () => {
      setPlaying(true);
      setPlayingInStore(true);
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    };
    const onPause = () => {
      setPlaying(false);
      setPlayingInStore(false);
      tick();
    };
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("seeked", tick);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("seeked", tick);
    };
  }, [setCurrentMs, setPlayingInStore]);

  // The frame is the largest box of the video's aspect ratio that fits the stage.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) =>
      setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height }),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const frameWidth = Math.min(stageSize.width, stageSize.height * aspect);
  const frameHeight = frameWidth / aspect;

  // Space toggles playback, unless the user is typing or on a button.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select, button, [contenteditable]")) return;
      e.preventDefault();
      togglePlay();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function togglePlay() {
    const el = video.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  }

  return (
    <div className="player">
      <div className="stage" ref={stage}>
        <div className="frame" style={{ width: frameWidth, height: frameHeight }}>
          <video
            ref={video}
            src={convertFileSrc(path)}
            playsInline
            onClick={togglePlay}
            onLoadedMetadata={(e) => {
              const { videoWidth, videoHeight, duration } = e.currentTarget;
              if (videoWidth && videoHeight) {
                setAspect(videoWidth / videoHeight);
                setVideoSize({ width: videoWidth, height: videoHeight });
              }
              if (Number.isFinite(duration)) setDurationMs(Math.round(duration * 1000));
              setError(null);
            }}
            onError={() =>
              setError(
                "This video can't be previewed here. MP4 and MOV (H.264) play best; " +
                  "other formats will get a preview copy in a later version.",
              )
            }
          />
          <CaptionOverlay scale={frameHeight / REFERENCE_HEIGHT} />
        </div>
      </div>
      <PlayerControls playing={playing} onTogglePlay={togglePlay} />
      {error && <p className="player-error">{error}</p>}
    </div>
  );
}

function PlayerControls({ playing, onTogglePlay }: { playing: boolean; onTogglePlay: () => void }) {
  const currentMs = useEditor((s) => s.currentMs);
  const durationMs = useEditor((s) => s.durationMs);
  const seek = useEditor((s) => s.seek);
  const segments = useEditor((s) => s.project?.segments ?? NO_SEGMENTS);
  const next = nextCaptionStart(segments, currentMs);
  return (
    <div className="player-controls">
      <span className="player-time tabular">
        <span>{formatDuration(Math.min(currentMs, durationMs))}</span>
        <span className="player-time-total"> / {formatDuration(durationMs)}</span>
      </span>
      <div className="player-buttons">
      <IconButton
        icon={SkipBack}
        label="Previous caption"
        onClick={() => seek(previousCaptionStart(segments, currentMs))}
      />
      <IconButton
        icon={playing ? Pause : Play}
        label={playing ? "Pause" : "Play"}
        shortcut="Space"
        variant="primary"
        className="player-play"
        onClick={onTogglePlay}
      />
      <IconButton
        icon={SkipForward}
        label="Next caption"
        disabled={next === null}
        onClick={() => next !== null && seek(next)}
      />
      </div>
    </div>
  );
}

function CaptionOverlay({ scale }: { scale: number }) {
  const segments = useEditor((s) => s.project?.segments ?? NO_SEGMENTS);
  const videoSize = useEditor((s) => s.videoSize);
  const style = useFittedStyle(segments, useEditor((s) => s.project?.style), videoSize);
  const currentMs = useEditor((s) => s.currentMs);
  if (!style || !videoSize) return null;
  const frame = overlayFrame(segments, currentMs, style);
  if (!frame) return null;

  // The same anchor, in script pixels, as the ASS export (placement in position.ts).
  const place = placement(style, playResX(videoSize.width, videoSize.height));
  return (
    <div
      // A new key per caption restarts the pop animation, like a new ASS event.
      key={style.animation === "pop" ? frame.key : undefined}
      className={`overlay overlay-${style.position}${style.animation === "pop" ? " pop" : ""}`}
      style={{ ...overlayStyle(style, scale), left: place.x * scale, top: place.y * scale }}
    >
      {frame.lines.map((line, l) => (
        <div key={l} className="overlay-line">
          {line.map((w, i) => (
            <span key={i} style={w.active ? { color: style.highlight_color } : undefined}>
              {w.text}
              {i < line.length - 1 ? " " : ""}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

const NO_SEGMENTS: Segment[] = [];

/** Font, size, colour and outline from the same reference values as the export. */
function overlayStyle(style: Style, scale: number): React.CSSProperties {
  const size = style.font_size * scale;
  return {
    fontFamily: `"${style.font_family}"`,
    fontWeight: style.bold ? 700 : 400,
    fontSize: `${size * emPerFontSize(style.font_family, style.bold)}px`,
    // One line is exactly the ASS font size tall, as in libass.
    lineHeight: `${size}px`,
    color: style.color,
    // Outline outside the fill with round corners, like libass (see outlineShadow).
    textShadow: outlineShadow(style.outline_width * scale, style.outline_color),
    ["--pop-from" as string]: POP_SCALE,
    ["--pop-ms" as string]: `${POP_MS}ms`,
  };
}
