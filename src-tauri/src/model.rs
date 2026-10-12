//! Caption data model, mirrored in src/lib/types.ts. See CLAUDE.md "Data model".

use serde::{Deserialize, Serialize};

use crate::models::WhisperModel;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Word {
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Segment {
    pub id: u32,
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
    pub words: Vec<Word>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Position {
    Bottom,
    Middle,
    Top,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CaptionMode {
    Line,
    WordHighlight,
    OneWord,
}

/// Caption look. Sizes are in pixels for a 1080 px tall frame and scale with the video.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Style {
    pub font_family: String,
    pub font_size: u32,
    pub color: String,
    pub highlight_color: String,
    pub outline_color: String,
    pub outline_width: u32,
    pub position: Position,
    pub max_chars_per_line: u32,
    pub max_lines: u32,
    pub mode: CaptionMode,
}

impl Default for Style {
    fn default() -> Self {
        Self {
            font_family: "Arial".into(),
            font_size: 64,
            color: "#FFFFFF".into(),
            highlight_color: "#FFD400".into(),
            outline_color: "#000000".into(),
            outline_width: 4,
            position: Position::Bottom,
            max_chars_per_line: 32,
            max_lines: 2,
            mode: CaptionMode::WordHighlight,
        }
    }
}

/// A `.kreocap` project file.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Project {
    /// File format version, see `project::FORMAT_VERSION`.
    pub version: u32,
    pub video_path: String,
    pub language: String,
    pub model: WhisperModel,
    pub segments: Vec<Segment>,
    #[serde(default)]
    pub style: Style,
}
