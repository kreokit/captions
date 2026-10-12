//! Recent projects for the Home screen, and video thumbnails.
//!
//! The list is `recent.json` in the app data dir; thumbnails are JPEGs in `thumbnails/`,
//! named by a hash of the video path and made once with FFmpeg.

use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::ffmpeg;

/// How many projects the Home screen keeps.
pub const MAX_RECENT: usize = 12;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RecentProject {
    /// The .kreocap file.
    pub path: String,
    pub video_path: String,
    /// Last opened or saved, in Unix milliseconds.
    pub opened_at: u64,
}

/// A list entry plus what the Home screen needs to show it.
#[derive(Debug, Clone, Serialize)]
pub struct RecentEntry {
    #[serde(flatten)]
    pub project: RecentProject,
    /// The project file still exists.
    pub exists: bool,
    /// Path of a cached thumbnail, if one could be made.
    pub thumbnail: Option<String>,
}

fn list_file(dir: &Path) -> PathBuf {
    dir.join("recent.json")
}

/// The stored list, newest first. A missing or damaged file is an empty list.
pub fn load(dir: &Path) -> Vec<RecentProject> {
    fs::read_to_string(list_file(dir))
        .ok()
        .and_then(|json| serde_json::from_str(&json).ok())
        .unwrap_or_default()
}

fn store(dir: &Path, list: &[RecentProject]) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(list).map_err(|e| e.to_string())?;
    fs::write(list_file(dir), json).map_err(|e| format!("cannot save recent projects: {e}"))
}

/// Puts `path` at the top of the list (adding or moving it), capped at MAX_RECENT.
pub fn touch(dir: &Path, path: &str, video_path: &str, now_ms: u64) -> Result<(), String> {
    let mut list = load(dir);
    list.retain(|p| p.path != path);
    list.insert(
        0,
        RecentProject {
            path: path.into(),
            video_path: video_path.into(),
            opened_at: now_ms,
        },
    );
    list.truncate(MAX_RECENT);
    store(dir, &list)
}

pub fn remove(dir: &Path, path: &str) -> Result<(), String> {
    let mut list = load(dir);
    list.retain(|p| p.path != path);
    store(dir, &list)
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

/// The cached thumbnail for `video`, making it with FFmpeg if needed (a frame about one
/// second in, or the first frame for very short clips), 480 px wide.
pub fn thumbnail(dir: &Path, video: &Path) -> Result<PathBuf, String> {
    let mut hasher = DefaultHasher::new();
    video.hash(&mut hasher);
    let thumbs = dir.join("thumbnails");
    let out = thumbs.join(format!("{:016x}.jpg", hasher.finish()));
    if out.is_file() {
        return Ok(out);
    }
    if !video.is_file() {
        return Err("video not found".into());
    }
    fs::create_dir_all(&thumbs).map_err(|e| e.to_string())?;
    let ffmpeg = ffmpeg::locate("ffmpeg")?;
    for seek in ["1", "0"] {
        let ok = Command::new(&ffmpeg)
            .args(["-nostdin", "-v", "error", "-y", "-ss", seek, "-i"])
            .arg(video)
            .args(["-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "4"])
            .arg(&out)
            .status()
            .is_ok_and(|s| s.success());
        if ok && out.is_file() {
            return Ok(out);
        }
    }
    Err("could not make a thumbnail".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join("kreokit-recent-tests").join(name);
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn newest_first_without_duplicates() {
        let dir = temp_dir("order");
        touch(&dir, "/a.kreocap", "/a.mp4", 1).unwrap();
        touch(&dir, "/b.kreocap", "/b.mp4", 2).unwrap();
        touch(&dir, "/a.kreocap", "/a2.mp4", 3).unwrap();
        let list = load(&dir);
        let paths: Vec<&str> = list.iter().map(|p| p.path.as_str()).collect();
        assert_eq!(paths, ["/a.kreocap", "/b.kreocap"]);
        assert_eq!(list[0].video_path, "/a2.mp4");
        assert_eq!(list[0].opened_at, 3);
    }

    #[test]
    fn keeps_at_most_twelve() {
        let dir = temp_dir("cap");
        for i in 0..20 {
            touch(&dir, &format!("/{i}.kreocap"), "/v.mp4", i).unwrap();
        }
        let list = load(&dir);
        assert_eq!(list.len(), MAX_RECENT);
        assert_eq!(list[0].path, "/19.kreocap");
    }

    #[test]
    fn removes_and_survives_damage() {
        let dir = temp_dir("remove");
        touch(&dir, "/a.kreocap", "/a.mp4", 1).unwrap();
        remove(&dir, "/a.kreocap").unwrap();
        assert!(load(&dir).is_empty());
        fs::write(list_file(&dir), "not json").unwrap();
        assert!(load(&dir).is_empty());
    }

    /// Needs ffmpeg: `cargo test makes_thumbnails -- --ignored`.
    #[test]
    #[ignore]
    fn makes_thumbnails() {
        let dir = temp_dir("thumbs");
        let video = Path::new(env!("CARGO_MANIFEST_DIR")).join("../fixtures/en/hello.mp4");
        let thumb = thumbnail(&dir, &video).unwrap();
        assert!(fs::metadata(&thumb).unwrap().len() > 0);
        assert_eq!(thumbnail(&dir, &video).unwrap(), thumb); // cached
        assert!(thumbnail(&dir, Path::new("/missing.mp4")).is_err());
    }
}
