import { useRef } from "react";
import { findSegmentAt } from "../lib/captions";
import { clamp } from "../ui/logic";
import { useEditor } from "../store/editor";
import type { Segment } from "../lib/types";

const NO_SEGMENTS: Segment[] = [];

/**
 * A slim seek strip under the editor: caption positions as blocks and a lime playhead.
 * Click or drag to seek. Stand-in until the full timeline (waveform, drag to retime).
 */
export function Scrubber() {
  const track = useRef<HTMLDivElement>(null);
  const segments = useEditor((s) => s.project?.segments ?? NO_SEGMENTS);
  const durationMs = useEditor((s) => s.durationMs);
  const currentMs = useEditor((s) => s.currentMs);
  const seek = useEditor((s) => s.seek);
  const active = findSegmentAt(segments, currentMs);
  const pct = (ms: number) => (durationMs > 0 ? `${(ms / durationMs) * 100}%` : "0%");

  const seekTo = (clientX: number) => {
    const r = track.current?.getBoundingClientRect();
    if (!r || !durationMs) return;
    seek(Math.round(clamp((clientX - r.left) / r.width, 0, 1) * durationMs));
  };

  return (
    <div className="scrubber">
      <div
        ref={track}
        className="scrubber-track"
        role="slider"
        tabIndex={0}
        aria-label="Playback position"
        aria-valuemin={0}
        aria-valuemax={durationMs}
        aria-valuenow={currentMs}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          seekTo(e.clientX);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) seekTo(e.clientX);
        }}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 1000 : 100;
          const delta = { ArrowRight: step, ArrowLeft: -step }[e.key];
          if (!delta) return;
          e.preventDefault();
          seek(clamp(currentMs + delta, 0, durationMs));
        }}
      >
        {segments.map((s, i) => (
          <div
            key={s.id}
            className={i === active ? "scrubber-block active" : "scrubber-block"}
            style={{ left: pct(s.start_ms), width: pct(s.end_ms - s.start_ms) }}
          />
        ))}
        <div className="scrubber-playhead" style={{ left: pct(currentMs) }} />
      </div>
    </div>
  );
}
