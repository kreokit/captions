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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Animation {
    None,
    /// Each caption (or word, in one_word mode) scales up briefly as it appears.
    Pop,
}

/// Caption look. Sizes are in pixels for a 1080 px tall frame and scale with the video.
/// The default is the "Bold highlight" preset (src/lib/presets.ts).
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
    pub bold: bool,
    pub uppercase: bool,
    pub animation: Animation,
}

impl Default for Style {
    fn default() -> Self {
        Self {
            font_family: "Arial".into(),
            font_size: 72,
            color: "#FFFFFF".into(),
            highlight_color: "#C8F135".into(),
            outline_color: "#000000".into(),
            outline_width: 6,
            position: Position::Bottom,
            max_chars_per_line: 22,
            max_lines: 2,
            mode: CaptionMode::WordHighlight,
            bold: true,
            uppercase: true,
            animation: Animation::None,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_style_is_the_bold_highlight_preset() {
        let presets: serde_json::Value =
            serde_json::from_str(include_str!("../../src/lib/presets.json")).unwrap();
        let preset = presets
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["id"] == "bold-highlight")
            .unwrap();
        let style: Style = serde_json::from_value(preset["style"].clone()).unwrap();
        assert_eq!(style, Style::default());
    }
}
