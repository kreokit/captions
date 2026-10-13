import { useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { POP_MS, POP_SCALE, REFERENCE_HEIGHT, ghostFrame, outlineShadow, overlayFrame } from "../lib/overlay";
import { Anchor, Guides, anchorPoint, dragAnchor, placement, playResX } from "../lib/position";
import { emPerFontSize, useFittedStyle } from "../lib/textMetrics";
import { GripHorizontal, Pause, Play, SkipBack, SkipForward } from "lucide-react";
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
  const [hovering, setHovering] = useState(false);
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
        <div
          className="frame"
          style={{ width: frameWidth, height: frameHeight }}
          onMouseEnter={() => setHovering(true)}
          onMouseLeave={() => setHovering(false)}
        >
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
          <CaptionOverlay
            scale={frameHeight / REFERENCE_HEIGHT}
            frameWidth={frameWidth}
            frameHeight={frameHeight}
            hovering={hovering}
          />
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

/** Snap distance while dragging a caption, in screen pixels. */
const SNAP_PX = 8;

interface DragStart {
  pointerX: number;
  pointerY: number;
  anchor: Anchor;
  box: { w: number; h: number };
}

/**
 * The live caption, placed like the export. It can be dragged anywhere on the frame
 * (snapping to the centres and the old Top / Bottom spots with lime guides; Alt drags
 * freely) and double-clicked to go back to bottom centre. When nothing is on screen but
 * the Style tab is open or the pointer is over the video, the nearest caption shows as a
 * dimmed ghost so it can still be placed.
 */
function CaptionOverlay({
  scale,
  frameWidth,
  frameHeight,
  hovering,
}: {
  scale: number;
  frameWidth: number;
  frameHeight: number;
  hovering: boolean;
}) {
  const segments = useEditor((s) => s.project?.segments ?? NO_SEGMENTS);
  const videoSize = useEditor((s) => s.videoSize);
  const saved = useEditor((s) => s.project?.style);
  const currentMs = useEditor((s) => s.currentMs);
  const styleTab = useEditor((s) => s.inspectorTab === "style");
  const box = useRef<HTMLDivElement>(null);
  const start = useRef<DragStart | null>(null);
  const [drag, setDrag] = useState<(Anchor & { guides: Guides }) | null>(null);

  // While dragging, the caption follows the draft position; the project changes on drop.
  const live =
    saved && drag ? { ...saved, position: drag.position, pos_x: drag.x, pos_y: drag.y } : saved;
  const style = useFittedStyle(segments, live, videoSize);
  if (!style || !videoSize) return null;

  let frame = overlayFrame(segments, currentMs, style);
  const ghost = !frame && (styleTab || hovering || drag !== null);
  if (ghost) frame = ghostFrame(segments, currentMs, style);
  if (!frame) return null;

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = box.current!.getBoundingClientRect();
    const { x, y } = anchorPoint(style);
    start.current = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      anchor: { x, y, position: style.position },
      box: { w: rect.width / frameWidth, h: rect.height / frameHeight },
    };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = start.current;
    if (!s) return;
    const dx = (e.clientX - s.pointerX) / frameWidth;
    const dy = (e.clientY - s.pointerY) / frameHeight;
    if (!drag && Math.hypot(e.clientX - s.pointerX, e.clientY - s.pointerY) < 3) return;
    const snap = e.altKey ? null : { x: SNAP_PX / frameWidth, y: SNAP_PX / frameHeight };
    setDrag(dragAnchor(s.anchor, dx, dy, s.box, snap));
  };
  const onPointerUp = () => {
    if (drag) useEditor.getState().setStyle({ position: drag.position, pos_x: drag.x, pos_y: drag.y });
    start.current = null;
    setDrag(null);
  };

  // The same anchor, in script pixels, as the ASS export (placement in position.ts).
  const place = placement(style, playResX(videoSize.width, videoSize.height));
  const classes = [
    "overlay",
    `overlay-${style.position}`,
    style.animation === "pop" && !ghost && !drag && "pop",
    "draggable",
    ghost && "ghost",
    drag && "dragging",
  ];
  return (
    <>
      {drag?.guides.vertical !== undefined && (
        <div className="caption-guide caption-guide-v" style={{ left: drag.guides.vertical * frameWidth }} />
      )}
      {drag?.guides.horizontal !== undefined && (
        <div className="caption-guide caption-guide-h" style={{ top: drag.guides.horizontal * frameHeight }} />
      )}
      <div
        ref={box}
        // A new key per caption restarts the pop animation, like a new ASS event.
        key={style.animation === "pop" ? frame.key : undefined}
        className={classes.filter(Boolean).join(" ")}
        style={{ ...overlayStyle(style, scale), left: place.x * scale, top: place.y * scale }}
        title="Drag to move · double-click for bottom centre · hold ⌥ to move freely"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => {
          e.stopPropagation();
          useEditor.getState().setStyle({ position: "bottom", pos_x: null, pos_y: null });
        }}
      >
        <span className="overlay-grip" aria-hidden>
          <GripHorizontal size={14} strokeWidth={2} />
        </span>
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
    </>
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
