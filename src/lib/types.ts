/** Mirrors src-tauri/src/model.rs. See CLAUDE.md "Data model". */
export interface Word {
  start_ms: number;
  end_ms: number;
  text: string;
}

export interface Segment {
  id: number;
  start_ms: number;
  end_ms: number;
  text: string;
  words: Word[];
}
