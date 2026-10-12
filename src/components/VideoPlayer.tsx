import { useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { REFERENCE_HEIGHT, overlayWords } from "../lib/overlay";
import type { Segment, Style } from "../lib/types";
import { useEditor } from "../store/editor";

/** Video with the live caption overlay. Publishes the playback position to the store. */
export function VideoPlayer({ path }: { path: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [aspect, setAspect] = useState(16 / 9);
  const [scale, setScale] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const setCurrentMs = useEditor((s) => s.setCurrentMs);
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
    const start = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    };
    el.addEventListener("play", start);
    el.addEventListener("seeked", tick);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("play", start);
      el.removeEventListener("seeked", tick);
    };
  }, [setCurrentMs]);

  // Caption sizes are defined for a 1080 px frame; scale to the displayed frame.
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) =>
      setScale(entry.contentRect.height / REFERENCE_HEIGHT),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="player">
      <div className="frame" ref={frame} style={{ aspectRatio: aspect }}>
        <video
          ref={video}
          src={convertFileSrc(path)}
          controls
          playsInline
          onLoadedMetadata={(e) => {
            const { videoWidth, videoHeight } = e.currentTarget;
            if (videoWidth && videoHeight) setAspect(videoWidth / videoHeight);
            setError(null);
          }}
          onError={() =>
            setError(
              "This video can't be previewed here. MP4 and MOV (H.264) play best; " +
                "other formats will get a preview copy in a later version.",
            )
          }
        />
        <CaptionOverlay scale={scale} />
      </div>
      {error && <p className="error">{error}</p>}
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
