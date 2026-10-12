/**
 * Caption line layout: how a segment's words are broken into lines and on-screen pages.
 *
 * Mirrors src-tauri/src/layout.rs; both are tested against fixtures/layout-cases.json so
 * the preview and the exports always break lines identically. Keep the two in sync.
 */
import type { Segment, Word } from "./types";

/** One caption screen: up to max_lines lines of word indices into the layout's words. */
export interface Page {
  start_ms: number;
  end_ms: number;
  lines: number[][];
}

export interface Layout {
  /** The segment's words, or one word spanning the segment if it has no word timings. */
  words: Word[];
  pages: Page[];
}

/** Characters as the user sees them (code points), matching Rust's `chars().count()`. */
function charCount(text: string): number {
  return [...text].length;
}

/**
 * Greedy line breaking: a word joins the current line if the line (words plus single
 * spaces) stays within maxChars characters; a longer word gets a line of its own. Lines
 * are grouped into pages of maxLines. The first page starts with the segment, later pages
 * with their first word, and each page lasts until the next one starts (the last until
 * the segment ends).
 */
export function layout(segment: Segment, maxChars: number, maxLines: number): Layout {
  const text = segment.text.trim();
  const words: Word[] =
    segment.words.length > 0
      ? segment.words
      : text
        ? [{ start_ms: segment.start_ms, end_ms: segment.end_ms, text }]
        : [];
  const chars = Math.max(1, maxChars);
  const perPage = Math.max(1, maxLines);

  const lines: number[][] = [];
  let lineLen = 0;
  words.forEach((word, i) => {
    const len = charCount(word.text);
    const line = lines[lines.length - 1];
    if (line && lineLen + 1 + len <= chars) {
      line.push(i);
      lineLen += 1 + len;
    } else {
      lines.push([i]);
      lineLen = len;
    }
  });

  const chunks: number[][][] = [];
  for (let i = 0; i < lines.length; i += perPage) chunks.push(lines.slice(i, i + perPage));
  const starts = chunks.map((page, p) => (p === 0 ? segment.start_ms : words[page[0][0]].start_ms));
  const pages = chunks.map((lines, p) => ({
    start_ms: starts[p],
    end_ms: p + 1 < starts.length ? starts[p + 1] : segment.end_ms,
    lines,
  }));
  return { words, pages };
}
