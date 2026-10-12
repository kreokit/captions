import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Magnet, Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import { findSegmentAt, splitPointAt } from "../lib/captions";
import {
  DragKind,
  SNAP_PX,
  View,
  clampView,
  dragSegment,
  fitView,
  follow,
  hitKind,
  msAt,
  tickLabel,
  tickStep,
  xAt,
  zoomAt,
} from "../lib/timeline";
import type { Segment } from "../lib/types";
import { PEAKS_PER_SECOND, getWaveform } from "../lib/waveform";
import { useEditor } from "../store/editor";
import { IconButton, Slider } from "../ui";

const NO_SEGMENTS: Segment[] = [];
/** A press that moves less than this is a click, not a drag. */
const CLICK_PX = 3;

interface Drag {
  index: number;
  kind: DragKind;
  startX: number;
  original: Segment[];
  moved: boolean;
}

/**
 * The editor's timeline: ruler, audio waveform and caption blocks with a lime playhead.
 * Click to seek; drag a block to move it, its edges to resize (snaps to the playhead and
 * neighbours; Alt turns snapping off). Cmd/Ctrl + scroll zooms, scroll pans.
 */
export function Timeline() {
  const videoPath = useEditor((s) => s.project?.video_path ?? "");
  const segments = useEditor((s) => s.project?.segments ?? NO_SEGMENTS);
  const durationMs = useEditor((s) => s.durationMs);
  const currentMs = useEditor((s) => s.currentMs);
  const playing = useEditor((s) => s.playing);
  const selected = useEditor((s) => s.selected);

  const body = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [view, setView] = useState<View>({ startMs: 0, msPerPx: 10 });
  const [peaks, setPeaks] = useState<Uint8Array>(new Uint8Array());
  const [snapping, setSnapping] = useState(true);
  const [preview, setPreview] = useState<Segment[] | null>(null);
  const drag = useRef<Drag | null>(null);
  const scrubbing = useRef(false);
  const fitted = useRef(false);

  const shown = preview ?? segments;
  const playingIndex = findSegmentAt(shown, currentMs);

  useEffect(() => {
    let live = true;
    setPeaks(new Uint8Array());
    if (videoPath) getWaveform(videoPath).then((p) => live && setPeaks(p), () => {});
    return () => {
      live = false;
    };
  }, [videoPath]);

  // Track the body's width; start fitted to the whole video.
  useLayoutEffect(() => {
    const el = body.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!width || !durationMs) return;
    setView((v) => (fitted.current ? clampView(v, durationMs, width) : ((fitted.current = true), fitView(durationMs, width))));
  }, [width, durationMs]);

  // Follow the playhead while playing.
  useEffect(() => {
    if (playing && width && durationMs) setView((v) => follow(v, currentMs, durationMs, width));
  }, [playing, currentMs, width, durationMs]);

  // Wheel: Cmd/Ctrl (or pinch) zooms around the pointer, otherwise pans. Needs a
  // non-passive listener to stop the page from scrolling.
  useEffect(() => {
    const el = body.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!durationMs || !width) return;
      e.preventDefault();
      const x = e.clientX - el.getBoundingClientRect().left;
      if (e.ctrlKey || e.metaKey) {
        setView((v) => zoomAt(v, Math.exp(-e.deltaY * 0.01), x, durationMs, width));
      } else {
        const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        setView((v) => clampView({ ...v, startMs: v.startMs + delta * v.msPerPx }, durationMs, width));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [durationMs, width]);

  const localX = (clientX: number) => clientX - (body.current?.getBoundingClientRect().left ?? 0);
  const seekToX = (x: number) => {
    const { seek } = useEditor.getState();
    seek(Math.round(Math.min(Math.max(msAt(x, view), 0), durationMs)));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || !durationMs) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    body.current?.focus();
    const x = localX(e.clientX);
    const block = (e.target as HTMLElement).closest<HTMLElement>("[data-block]");
    if (block) {
      const index = Number(block.dataset.block);
      const left = xAt(segments[index].start_ms, view);
      const blockWidth = (segments[index].end_ms - segments[index].start_ms) / view.msPerPx;
      drag.current = { index, kind: hitKind(x, left, blockWidth), startX: x, original: segments, moved: false };
      useEditor.getState().select(index);
    } else {
      scrubbing.current = true;
      seekToX(x);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const x = localX(e.clientX);
    if (scrubbing.current) return seekToX(x);
    const d = drag.current;
    if (!d) return;
    if (!d.moved && Math.abs(x - d.startX) < CLICK_PX) return;
    d.moved = true;
    setPreview(
      dragSegment(d.original, d.index, d.kind, (x - d.startX) * view.msPerPx, {
        durationMs,
        snapTargets: [useEditor.getState().currentMs],
        snapMs: snapping && !e.altKey ? SNAP_PX * view.msPerPx : 0,
      }),
    );
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    scrubbing.current = false;
    if (!d) return;
    const { replaceSegments, seek } = useEditor.getState();
    if (d.moved && preview) replaceSegments(preview);
    else seek(d.original[d.index].start_ms);
    setPreview(null);
  };

  // S / M / Delete act on the selected caption, as in the list.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const { split, merge, remove, project, currentMs: now } = useEditor.getState();
    if (selected === null || !project || e.metaKey || e.ctrlKey) return;
    const seg = project.segments[selected];
    const key = e.key.toLowerCase();
    if (key === "s" && seg?.words.length >= 2) split(selected, splitPointAt(seg, now));
    else if (key === "m") merge(selected);
    else if (key === "delete" || key === "backspace") remove(selected);
    else return;
    e.preventDefault();
  };

  const zoomBy = useCallback(
    (factor: number) => setView((v) => zoomAt(v, factor, xAt(useEditor.getState().currentMs, v), durationMs, width)),
    [durationMs, width],
  );

  // Zoom slider: 0 = whole video, 100 = most zoomed in (log scale).
  const fit = fitView(durationMs, width || 1).msPerPx;
  const minMs = Math.min(2, fit);
  const zoomValue = fit > minMs ? Math.round((Math.log(fit / view.msPerPx) / Math.log(fit / minMs)) * 100) : 0;
  const setZoom = (value: number) =>
    setView((v) =>
      zoomAt(v, v.msPerPx / (fit * Math.pow(minMs / fit, value / 100)), xAt(currentMs, v), durationMs, width),
    );

  const step = tickStep(view.msPerPx);
  const ticks: number[] = [];
  for (let t = Math.floor(view.startMs / step) * step; t <= view.startMs + width * view.msPerPx; t += step) {
    if (t >= 0) ticks.push(t);
  }
  const playheadX = xAt(currentMs, view);

  return (
    <section className="timeline" aria-label="Timeline">
      <div className="timeline-toolbar">
        <IconButton icon={Maximize2} label="Fit whole video" size="sm" onClick={() => setView(fitView(durationMs, width))} />
        <IconButton icon={ZoomOut} label="Zoom out" shortcut="⌘ scroll" size="sm" onClick={() => zoomBy(1 / 1.5)} />
        <div className="timeline-zoom">
          <Slider label="Zoom" value={zoomValue} min={0} max={100} onChange={setZoom} format={(v) => `${v}%`} />
        </div>
        <IconButton icon={ZoomIn} label="Zoom in" shortcut="⌘ scroll" size="sm" onClick={() => zoomBy(1.5)} />
        <span className="timeline-divider" />
        <IconButton
          icon={Magnet}
          label={snapping ? "Snapping on (hold ⌥ to drag freely)" : "Snapping off"}
          size="sm"
          pressed={snapping}
          onClick={() => setSnapping((s) => !s)}
        />
        <span className="timeline-hint">Drag captions to move · drag edges to resize</span>
      </div>

      <div
        ref={body}
        className="timeline-body"
        tabIndex={0}
        aria-label="Timeline: click to seek, drag captions to retime"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
      >
        <div className="timeline-ruler">
          {ticks.map((t) => (
            <span key={t} className="timeline-tick" style={{ left: xAt(t, view) }}>
              {tickLabel(t, step)}
            </span>
          ))}
        </div>

        <Waveform peaks={peaks} view={view} width={width} highlight={selected !== null ? shown[selected] : undefined} />

        <div className="timeline-track">
          {shown.map((seg, i) => {
            const left = xAt(seg.start_ms, view);
            const w = (seg.end_ms - seg.start_ms) / view.msPerPx;
            if (left > width || left + w < 0) return null;
            const cls = ["timeline-block", i === selected && "selected", i === playingIndex && "playing"]
              .filter(Boolean)
              .join(" ");
            return (
              <div key={seg.id} data-block={i} className={cls} style={{ left, width: Math.max(w, 2) }} title={seg.text}>
                <span className="timeline-block-edge start" />
                <span className="timeline-block-text">{seg.text}</span>
                <span className="timeline-block-edge end" />
              </div>
            );
          })}
        </div>

        {playheadX >= 0 && playheadX <= width && <div className="timeline-playhead" style={{ left: playheadX }} />}
      </div>
    </section>
  );
}

/** The audio peaks for the visible window, drawn crisp on high-DPI screens. */
function Waveform({
  peaks,
  view,
  width,
  highlight,
}: {
  peaks: Uint8Array;
  view: View;
  width: number;
  highlight?: Segment;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const HEIGHT = 56;

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx || !width) return;
    const dpr = window.devicePixelRatio || 1;
    el.width = Math.round(width * dpr);
    el.height = HEIGHT * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, HEIGHT);
    const css = getComputedStyle(el);
    const base = css.getPropertyValue("--color-waveform").trim();
    const active = css.getPropertyValue("--color-waveform-active").trim();
    const perMs = PEAKS_PER_SECOND / 1000;
    const mid = HEIGHT / 2;
    for (let x = 0; x < width; x++) {
      const from = Math.floor(msAt(x, view) * perMs);
      const to = Math.max(from + 1, Math.floor(msAt(x + 1, view) * perMs));
      let level = 0;
      for (let i = Math.max(from, 0); i < Math.min(to, peaks.length); i++) level = Math.max(level, peaks[i]);
      if (level === 0) continue;
      const h = Math.max(1, (level / 255) * (HEIGHT - 4));
      const t = msAt(x, view);
      ctx.fillStyle = highlight && t >= highlight.start_ms && t < highlight.end_ms ? active : base;
      ctx.fillRect(x, mid - h / 2, 1, h);
    }
  }, [peaks, view, width, highlight]);

  return <canvas ref={canvas} className="timeline-waveform" style={{ width, height: HEIGHT }} aria-hidden />;
}
