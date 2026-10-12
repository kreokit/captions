import { useEffect, useRef, useState } from "react";
import { findSegmentAt, parseTime, wordIndexAtCaret } from "../lib/captions";
import { formatDuration } from "../lib/video";
import type { Segment } from "../lib/types";
import { useEditor } from "../store/editor";

/** Editable list of captions. The one playing is highlighted and kept in view. */
const NO_SEGMENTS: Segment[] = [];

export function SegmentList() {
  const segments = useEditor((s) => s.project?.segments ?? NO_SEGMENTS);
  const activeIndex = useEditor((s) =>
    findSegmentAt(s.project?.segments ?? NO_SEGMENTS, s.currentMs),
  );

  if (segments.length === 0) {
    return <p className="hint">No captions. Nothing was recognised as speech.</p>;
  }
  return (
    <ol className="segments">
      {segments.map((seg, i) => (
        <SegmentRow
          key={seg.id}
          segment={seg}
          index={i}
          active={i === activeIndex}
          isLast={i === segments.length - 1}
        />
      ))}
    </ol>
  );
}

function SegmentRow({
  segment,
  index,
  active,
  isLast,
}: {
  segment: Segment;
  index: number;
  active: boolean;
  isLast: boolean;
}) {
  const { seek, split, merge, remove, setText, setTimes } = useEditor.getState();
  const row = useRef<HTMLLIElement>(null);
  const textArea = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState(segment.text);
  const [timeError, setTimeError] = useState<string | null>(null);

  // Show external changes (split, merge, undoing a draft) in the text box.
  useEffect(() => setDraft(segment.text), [segment.text]);

  // Follow playback, but don't scroll away from a caption being edited.
  useEffect(() => {
    const list = row.current?.parentElement;
    if (active && !list?.contains(document.activeElement)) {
      row.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [active]);

  const commitText = () => setText(index, draft);

  function splitAtCaret() {
    const caret = textArea.current?.selectionStart ?? draft.length;
    commitText();
    split(index, wordIndexAtCaret(draft, caret));
  }

  function commitTime(which: "start" | "end", text: string) {
    const ms = parseTime(text);
    if (ms === null) {
      setTimeError("Use a time like 1:23.456");
      return;
    }
    const error =
      which === "start"
        ? setTimes(index, ms, segment.end_ms)
        : setTimes(index, segment.start_ms, ms);
    setTimeError(error);
  }

  return (
    <li ref={row} className={active ? "segment active" : "segment"}>
      <div className="times">
        <button
          type="button"
          className="link"
          title="Play from here"
          onClick={() => seek(segment.start_ms)}
        >
          ▶
        </button>
        <TimeInput value={segment.start_ms} label="Start" onCommit={(t) => commitTime("start", t)} />
        <span aria-hidden>–</span>
        <TimeInput value={segment.end_ms} label="End" onCommit={(t) => commitTime("end", t)} />
      </div>
      <textarea
        ref={textArea}
        value={draft}
        rows={2}
        aria-label={`Caption ${index + 1} text`}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => seek(segment.start_ms)}
        onBlur={commitText}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            setDraft(segment.text);
          }
        }}
      />
      {timeError && <p className="error">{timeError}</p>}
      <div className="row-actions">
        <button
          type="button"
          className="secondary"
          title="Split this caption at the text cursor"
          disabled={segment.words.length < 2}
          onMouseDown={(e) => e.preventDefault()} // keep the caret in the text box
          onClick={splitAtCaret}
        >
          Split
        </button>
        <button
          type="button"
          className="secondary"
          title="Merge with the next caption"
          disabled={isLast}
          onClick={() => merge(index)}
        >
          Merge ↓
        </button>
        <button type="button" className="secondary" onClick={() => remove(index)}>
          Delete
        </button>
      </div>
    </li>
  );
}

function TimeInput({
  value,
  label,
  onCommit,
}: {
  value: number;
  label: string;
  onCommit: (text: string) => void;
}) {
  const [text, setText] = useState(formatDuration(value));
  useEffect(() => setText(formatDuration(value)), [value]);
  return (
    <input
      className="time"
      aria-label={label}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== formatDuration(value) && onCommit(text)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") setText(formatDuration(value));
      }}
    />
  );
}
