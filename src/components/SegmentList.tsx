import { useEffect, useRef, useState } from "react";
import { Merge, Pencil, Play, Scissors, Trash2 } from "lucide-react";
import { findSegmentAt, parseTime, splitPointAt, wordIndexAtCaret } from "../lib/captions";
import { formatDuration } from "../lib/video";
import type { Segment } from "../lib/types";
import { useEditor } from "../store/editor";
import { IconButton, MenuEntry, toast, useContextMenu } from "../ui";

const NO_SEGMENTS: Segment[] = [];

/** "0:01.040" → "0:01.0": rows show tenths; the editor fields show milliseconds. */
function shortTime(ms: number): string {
  return formatDuration(ms).slice(0, -2);
}

/**
 * Compact caption list. One tab stop: arrows move the selection, Enter edits, S splits at
 * the playhead, M merges with the next, Delete removes. The playing caption is marked and
 * kept in view.
 */
export function SegmentList() {
  const segments = useEditor((s) => s.project?.segments ?? NO_SEGMENTS);
  const selected = useEditor((s) => s.selected);
  const playing = useEditor((s) => findSegmentAt(s.project?.segments ?? NO_SEGMENTS, s.currentMs));
  const [editing, setEditing] = useState<number | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const focusIndex = selected ?? (playing >= 0 ? playing : 0);

  // Follow playback, unless the user is working in the list.
  useEffect(() => {
    if (playing < 0 || list.current?.contains(document.activeElement)) return;
    list.current
      ?.querySelector(`[data-index="${playing}"]`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [playing]);

  const focusRow = (index: number) => {
    const { select, seek, project } = useEditor.getState();
    const seg = project?.segments[index];
    if (!seg) return;
    select(index);
    seek(seg.start_ms);
    requestAnimationFrame(() => {
      const row = list.current?.querySelector<HTMLElement>(`[data-index="${index}"]`);
      row?.focus();
      row?.scrollIntoView({ block: "nearest" });
    });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editing !== null || e.metaKey || e.ctrlKey || e.altKey) return;
    const { split, merge, remove, currentMs, project } = useEditor.getState();
    const seg = project?.segments[focusIndex];
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        return focusRow(Math.min(focusIndex + 1, segments.length - 1));
      case "ArrowUp":
        e.preventDefault();
        return focusRow(Math.max(focusIndex - 1, 0));
      case "Enter":
        e.preventDefault();
        return setEditing(focusIndex);
      case "s":
      case "S":
        if (!seg) return;
        e.preventDefault();
        if (seg.words.length < 2) return toast("This caption has one word; nothing to split.");
        return split(focusIndex, splitPointAt(seg, currentMs));
      case "m":
      case "M":
        e.preventDefault();
        return merge(focusIndex);
      case "Backspace":
      case "Delete":
        e.preventDefault();
        remove(focusIndex);
        return focusRow(Math.min(focusIndex, segments.length - 2));
    }
  };

  if (segments.length === 0) {
    return <p className="captions-empty">No captions. Nothing was recognised as speech.</p>;
  }
  return (
    <div
      ref={list}
      role="listbox"
      aria-label="Captions"
      aria-activedescendant={`caption-${focusIndex}`}
      className="captions"
      onKeyDown={onKeyDown}
    >
      {segments.map((seg, i) => (
        <CaptionRow
          key={seg.id}
          segment={seg}
          index={i}
          isLast={i === segments.length - 1}
          playing={i === playing}
          selected={i === selected}
          tabStop={i === focusIndex}
          editing={i === editing}
          onEdit={(on) => setEditing(on ? i : null)}
          onFocusRow={() => focusRow(i)}
        />
      ))}
    </div>
  );
}

function CaptionRow({
  segment,
  index,
  isLast,
  playing,
  selected,
  tabStop,
  editing,
  onEdit,
  onFocusRow,
}: {
  segment: Segment;
  index: number;
  isLast: boolean;
  playing: boolean;
  selected: boolean;
  tabStop: boolean;
  editing: boolean;
  onEdit: (on: boolean) => void;
  onFocusRow: () => void;
}) {
  const { seek, select, split, merge, remove } = useEditor.getState();
  const canSplit = segment.words.length >= 2;

  const splitAtPlayhead = () => split(index, splitPointAt(segment, useEditor.getState().currentMs));
  const { onContextMenu, menu } = useContextMenu(
    (): MenuEntry[] => [
      { label: "Play from here", icon: Play, onSelect: () => seek(segment.start_ms) },
      { label: "Edit text", icon: Pencil, shortcut: "↵", onSelect: () => onEdit(true) },
      "separator",
      { label: "Split at playhead", icon: Scissors, shortcut: "S", disabled: !canSplit, onSelect: splitAtPlayhead },
      { label: "Merge with next", icon: Merge, shortcut: "M", disabled: isLast, onSelect: () => merge(index) },
      "separator",
      { label: "Delete", icon: Trash2, shortcut: "⌫", danger: true, onSelect: () => remove(index) },
    ],
    "Caption actions",
  );

  const className = ["caption-row", playing && "playing", selected && "selected", editing && "editing"]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      id={`caption-${index}`}
      data-index={index}
      role="option"
      aria-selected={selected}
      tabIndex={tabStop && !editing ? 0 : -1}
      className={className}
      onClick={() => {
        if (editing) return;
        select(index);
        seek(segment.start_ms);
      }}
      onDoubleClick={() => onEdit(true)}
      onContextMenu={(e) => {
        select(index);
        onContextMenu(e);
      }}
    >
      {editing ? (
        <CaptionEditor segment={segment} index={index} onDone={() => (onEdit(false), onFocusRow())} />
      ) : (
        <>
          <span className="caption-time tabular">{shortTime(segment.start_ms)}</span>
          <span className="caption-text">{segment.text || <em>Empty caption</em>}</span>
          <span className="caption-actions" onClick={(e) => e.stopPropagation()}>
            <IconButton icon={Scissors} label="Split at playhead" shortcut="S" size="sm" disabled={!canSplit} tabIndex={-1} onClick={splitAtPlayhead} />
            <IconButton icon={Merge} label="Merge with next" shortcut="M" size="sm" disabled={isLast} tabIndex={-1} onClick={() => merge(index)} />
            <IconButton icon={Trash2} label="Delete" shortcut="⌫" size="sm" tabIndex={-1} onClick={() => remove(index)} />
          </span>
        </>
      )}
      {menu}
    </div>
  );
}

/** Inline editor: start / end times and the text. Enter saves, Escape cancels. */
function CaptionEditor({ segment, index, onDone }: { segment: Segment; index: number; onDone: () => void }) {
  const { setText, setTimes, split } = useEditor.getState();
  const [text, setTextDraft] = useState(segment.text);
  const [start, setStart] = useState(formatDuration(segment.start_ms));
  const [end, setEnd] = useState(formatDuration(segment.end_ms));
  const [error, setError] = useState<string | null>(null);
  const textArea = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textArea.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  // Grow with the text.
  useEffect(() => {
    const el = textArea.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  const save = (): boolean => {
    const startMs = parseTime(start);
    const endMs = parseTime(end);
    if (startMs === null || endMs === null) {
      setError("Use times like 1:23.456");
      return false;
    }
    if (startMs !== segment.start_ms || endMs !== segment.end_ms) {
      const problem = setTimes(index, startMs, endMs);
      if (problem) {
        setError(problem);
        return false;
      }
    }
    setText(index, text.trim());
    return true;
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      onDone();
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (save()) onDone();
    }
  };

  return (
    <div
      className="caption-editor"
      onKeyDown={onKeyDown}
      onClick={(e) => e.stopPropagation()}
      onBlur={(e) => {
        // Focus leaving the editor (not moving between its fields) saves.
        if (!e.currentTarget.contains(e.relatedTarget as Node) && save()) onDone();
      }}
    >
      <div className="caption-editor-times">
        <input className="ui-input tabular" aria-label="Start" value={start} onChange={(e) => setStart(e.target.value)} />
        <span aria-hidden>–</span>
        <input className="ui-input tabular" aria-label="End" value={end} onChange={(e) => setEnd(e.target.value)} />
        <span className="caption-editor-hint">↵ save · esc cancel</span>
      </div>
      <textarea
        ref={textArea}
        className="ui-input caption-editor-text"
        aria-label={`Caption ${index + 1} text`}
        value={text}
        rows={1}
        onChange={(e) => setTextDraft(e.target.value)}
      />
      <div className="caption-editor-actions">
        <IconButton
          icon={Scissors}
          label="Split at text cursor"
          size="sm"
          disabled={segment.words.length < 2}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            const caret = textArea.current?.selectionStart ?? text.length;
            setText(index, text.trim());
            split(index, wordIndexAtCaret(text, caret));
            onDone();
          }}
        />
      </div>
      {error && <p className="caption-editor-error">{error}</p>}
    </div>
  );
}
