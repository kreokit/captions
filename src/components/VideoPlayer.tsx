import { useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { REFERENCE_HEIGHT, overlayWords } from "../lib/overlay";
import { formatDuration } from "../lib/video";
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
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    };
    const onPause = () => {
      setPlaying(false);
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
  }, [setCurrentMs]);

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
              if (videoWidth && videoHeight) setAspect(videoWidth / videoHeight);
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
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function PlayerControls({ playing, onTogglePlay }: { playing: boolean; onTogglePlay: () => void }) {
  const currentMs = useEditor((s) => s.currentMs);
  const durationMs = useEditor((s) => s.durationMs);
  const seek = useEditor((s) => s.seek);
  return (
    <div className="controls-bar">
      <button
        type="button"
        className="play"
        onClick={onTogglePlay}
        aria-label={playing ? "Pause" : "Play"}
        title={playing ? "Pause (Space)" : "Play (Space)"}
      >
        {playing ? "❚❚" : "▶"}
      </button>
      <input
        type="range"
        className="seek"
        aria-label="Seek"
        min={0}
        max={durationMs || 0}
        step={10}
        value={Math.min(currentMs, durationMs)}
        onChange={(e) => seek(Number(e.target.value))}
        disabled={!durationMs}
      />
      <span className="clock">
        {formatDuration(Math.min(currentMs, durationMs))} / {formatDuration(durationMs)}
      </span>
    </div>
  );
}

function CaptionOverlay({ scale }: { scale: number }) {
  const segments = useEditor((s) => s.project?.segments ?? NO_SEGMENTS);
  const style = useEditor((s) => s.project?.style);
  const currentMs = useEditor((s) => s.currentMs);
  if (!style) return null;
  const words = overlayWords(segments, currentMs, style.mode);
  if (!words) return null;

  return (
    <div className={`overlay overlay-${style.position}`} style={overlayStyle(style, scale)}>
      <span>
        {words.map((w, i) => (
          <span key={i} style={w.active ? { color: style.highlight_color } : undefined}>
            {w.text}
            {i < words.length - 1 ? " " : ""}
          </span>
        ))}
      </span>
    </div>
  );
}

const NO_SEGMENTS: Segment[] = [];

function overlayStyle(style: Style, scale: number): React.CSSProperties {
  const px = (n: number) => `${n * scale}px`;
  return {
    fontFamily: style.font_family,
    fontSize: px(style.font_size),
    color: style.color,
    // The stroke is centred on the glyph edge, so double it; paint it under the fill.
    WebkitTextStroke: `${px(style.outline_width * 2)} ${style.outline_color}`,
    paintOrder: "stroke fill",
    maxWidth: `${style.max_chars_per_line}ch`,
  };
}
