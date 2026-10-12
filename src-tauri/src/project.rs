//! Saving and loading `.kreocap` project files (pretty-printed JSON).

use std::fs;
use std::path::{Path, PathBuf};

use crate::model::Project;

/// Current file format version. Bump it when the format changes incompatibly, and teach
/// [`load`] to read the older versions.
pub const FORMAT_VERSION: u32 = 1;
pub const EXTENSION: &str = "kreocap";

/// Writes `project` to `path` (adding the `.kreocap` extension if missing) and returns the
/// final path. Writes to a temporary file first, so a crash never leaves a half-written
/// project behind.
pub fn save(path: &Path, project: &Project) -> Result<PathBuf, String> {
    let path = if path.extension().is_some_and(|e| e == EXTENSION) {
        path.to_path_buf()
    } else {
        let mut name = path.as_os_str().to_owned();
        name.push(".");
        name.push(EXTENSION);
        PathBuf::from(name)
    };

    let project = Project {
        version: FORMAT_VERSION,
        ..project.clone()
    };
    let json = serde_json::to_string_pretty(&project).map_err(|e| e.to_string())?;
    let tmp = path.with_extension(format!("{EXTENSION}.tmp"));
    fs::write(&tmp, json + "\n")
        .and_then(|_| fs::rename(&tmp, &path))
        .map_err(|e| {
            let _ = fs::remove_file(&tmp);
            format!("cannot save {}: {e}", path.display())
        })?;
    Ok(path)
}

pub fn load(path: &Path) -> Result<Project, String> {
    let json =
        fs::read_to_string(path).map_err(|e| format!("cannot open {}: {e}", path.display()))?;

    // Check the version before the full parse, so a newer file gets a clear message
    // instead of a confusing field error.
    #[derive(serde::Deserialize)]
    struct Header {
        version: u32,
    }
    let header: Header = serde_json::from_str(&json)
        .map_err(|_| format!("{} is not a KreoKit Captions project", path.display()))?;
    if header.version > FORMAT_VERSION {
        return Err(format!(
            "{} was made by a newer version of KreoKit Captions; please update the app",
            path.display()
        ));
    }

    serde_json::from_str(&json).map_err(|e| format!("{} is damaged: {e}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{CaptionMode, Segment, Style, Word};
    use crate::models::WhisperModel;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir()
            .join("kreokit-project-tests")
            .join(name);
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn sample() -> Project {
        Project {
            version: FORMAT_VERSION,
            video_path: "/Users/me/Movies/clip.mp4".into(),
            language: "en".into(),
            model: WhisperModel::Base,
            segments: vec![Segment {
                id: 0,
                start_ms: 1_040,
                end_ms: 2_650,
                text: "Welcome to the caption test,".into(),
                words: vec![Word {
                    start_ms: 1_040,
                    end_ms: 1_340,
                    text: "Welcome".into(),
                }],
            }],
            style: Style::default(),
        }
    }

    #[test]
    fn round_trips() {
        let dir = temp_dir("round_trip");
        let path = save(&dir.join("clip.kreocap"), &sample()).unwrap();
        assert_eq!(path, dir.join("clip.kreocap"));
        assert_eq!(load(&path).unwrap(), sample());
        assert!(!dir.join("clip.kreocap.tmp").exists());
    }

    #[test]
    fn adds_the_extension() {
        let dir = temp_dir("extension");
        let path = save(&dir.join("my clip"), &sample()).unwrap();
        assert_eq!(path, dir.join("my clip.kreocap"));
        assert!(path.is_file());
    }

    #[test]
    fn reads_a_version_1_file() {
        // The documented format; keep this test passing when the format evolves.
        let dir = temp_dir("v1");
        let path = dir.join("v1.kreocap");
        fs::write(
            &path,
            r#"{
              "version": 1,
              "video_path": "/tmp/clip.mp4",
              "language": "en",
              "model": "small",
              "segments": [
                { "id": 0, "start_ms": 0, "end_ms": 900, "text": "Hi there",
                  "words": [ { "start_ms": 0, "end_ms": 400, "text": "Hi" },
                             { "start_ms": 400, "end_ms": 900, "text": "there" } ] }
              ],
              "style": { "font_size": 80, "mode": "one_word" }
            }"#,
        )
        .unwrap();
        let project = load(&path).unwrap();
        assert_eq!(project.model, WhisperModel::Small);
        assert_eq!(project.segments[0].words[1].text, "there");
        // Missing style fields fall back to defaults.
        assert_eq!(project.style.font_size, 80);
        assert_eq!(project.style.mode, CaptionMode::OneWord);
        assert_eq!(project.style.color, Style::default().color);
    }

    #[test]
    fn rejects_newer_versions_and_other_files() {
        let dir = temp_dir("reject");
        let newer = dir.join("newer.kreocap");
        fs::write(&newer, r#"{ "version": 99 }"#).unwrap();
        assert!(load(&newer).unwrap_err().contains("newer version"));

        let other = dir.join("notes.kreocap");
        fs::write(&other, "hello").unwrap();
        assert!(
            load(&other)
                .unwrap_err()
                .contains("not a KreoKit Captions project")
        );

        let damaged = dir.join("damaged.kreocap");
        fs::write(&damaged, r#"{ "version": 1, "segments": 3 }"#).unwrap();
        assert!(load(&damaged).unwrap_err().contains("damaged"));
    }
}
