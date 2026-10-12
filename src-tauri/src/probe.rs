//! `probe_video`: reads duration, resolution and frame rate of a video with ffprobe.

use std::path::Path;
use std::process::Command;

use serde::{Deserialize, Serialize};

use crate::ffmpeg;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct VideoInfo {
    pub duration_ms: u64,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
}

pub fn probe_video(path: &Path) -> Result<VideoInfo, String> {
    let ffprobe = ffmpeg::locate("ffprobe")?;
    let output = Command::new(&ffprobe)
        .args(["-v", "error", "-select_streams", "v:0"])
        .args([
            "-show_entries",
            "format=duration:stream=width,height,avg_frame_rate,r_frame_rate,duration",
        ])
        .args(["-of", "json"])
        .arg(path)
        .output()
        .map_err(|e| format!("failed to run {}: {e}", ffprobe.display()))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "ffprobe could not read the file: {}",
            stderr.trim()
        ));
    }
    parse_ffprobe_json(&String::from_utf8_lossy(&output.stdout))
}

#[derive(Deserialize)]
struct FfprobeOutput {
    #[serde(default)]
    streams: Vec<FfprobeStream>,
    format: Option<FfprobeFormat>,
}

#[derive(Deserialize)]
struct FfprobeStream {
    width: Option<u32>,
    height: Option<u32>,
    avg_frame_rate: Option<String>,
    r_frame_rate: Option<String>,
    duration: Option<String>,
}

#[derive(Deserialize)]
struct FfprobeFormat {
    duration: Option<String>,
}

/// Parses the JSON printed by the ffprobe invocation in [`probe_video`].
pub fn parse_ffprobe_json(json: &str) -> Result<VideoInfo, String> {
    let parsed: FfprobeOutput =
        serde_json::from_str(json).map_err(|e| format!("unexpected ffprobe output: {e}"))?;

    let stream = parsed
        .streams
        .first()
        .ok_or("the file has no video stream")?;
    let (width, height) = stream
        .width
        .zip(stream.height)
        .ok_or("the video stream has no resolution")?;

    // avg_frame_rate is "0/0" for some containers; fall back to r_frame_rate.
    let fps = [&stream.avg_frame_rate, &stream.r_frame_rate]
        .into_iter()
        .flatten()
        .find_map(|rate| parse_rate(rate))
        .ok_or("the video stream has no frame rate")?;

    // The container duration covers all streams; fall back to the video stream's own.
    let seconds = parsed
        .format
        .and_then(|f| f.duration)
        .or_else(|| stream.duration.clone())
        .and_then(|d| d.parse::<f64>().ok())
        .filter(|s| s.is_finite() && *s >= 0.0)
        .ok_or("the video has no duration")?;

    Ok(VideoInfo {
        duration_ms: (seconds * 1000.0).round() as u64,
        width,
        height,
        fps,
    })
}

/// Parses an ffprobe rational like "30000/1001". Returns `None` for "0/0" and other
/// unusable values.
fn parse_rate(rate: &str) -> Option<f64> {
    let (num, den) = rate.split_once('/')?;
    let (num, den) = (
        num.trim().parse::<f64>().ok()?,
        den.trim().parse::<f64>().ok()?,
    );
    let fps = num / den;
    (fps.is_finite() && fps > 0.0).then_some(fps)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// ffprobe `-of json` output for a 1080p 29.97 fps clip.
    const SAMPLE: &str = r#"{
        "programs": [],
        "stream_groups": [],
        "streams": [
            {
                "width": 1920,
                "height": 1080,
                "r_frame_rate": "30000/1001",
                "avg_frame_rate": "30000/1001",
                "duration": "12.312300"
            }
        ],
        "format": {
            "duration": "12.345000"
        }
    }"#;

    #[test]
    fn parses_typical_output() {
        let info = parse_ffprobe_json(SAMPLE).unwrap();
        assert_eq!(info.duration_ms, 12_345);
        assert_eq!((info.width, info.height), (1920, 1080));
        assert!((info.fps - 29.97).abs() < 0.001, "fps was {}", info.fps);
    }

    #[test]
    fn falls_back_to_r_frame_rate_and_stream_duration() {
        let json = r#"{
            "streams": [{ "width": 720, "height": 1280, "avg_frame_rate": "0/0",
                          "r_frame_rate": "25/1", "duration": "3.0004" }],
            "format": {}
        }"#;
        let info = parse_ffprobe_json(json).unwrap();
        assert_eq!(
            info,
            VideoInfo {
                duration_ms: 3_000,
                width: 720,
                height: 1280,
                fps: 25.0
            }
        );
    }

    #[test]
    fn rejects_file_without_video_stream() {
        let json = r#"{ "streams": [], "format": { "duration": "60.0" } }"#;
        assert_eq!(
            parse_ffprobe_json(json).unwrap_err(),
            "the file has no video stream"
        );
    }

    #[test]
    fn rejects_missing_duration() {
        let json = r#"{ "streams": [{ "width": 640, "height": 480, "avg_frame_rate": "30/1" }] }"#;
        assert_eq!(
            parse_ffprobe_json(json).unwrap_err(),
            "the video has no duration"
        );
    }

    #[test]
    fn rejects_invalid_json() {
        assert!(parse_ffprobe_json("not json").is_err());
    }

    #[test]
    fn parses_rates() {
        assert_eq!(parse_rate("60/1"), Some(60.0));
        assert_eq!(parse_rate("0/0"), None);
        assert_eq!(parse_rate("30/0"), None);
        assert_eq!(parse_rate("abc"), None);
    }

    /// Needs ffmpeg and ffprobe installed: `cargo test -- --ignored`.
    #[test]
    #[ignore]
    fn probes_generated_clip() {
        let dir = std::env::temp_dir().join("kreokit-probe-test");
        std::fs::create_dir_all(&dir).unwrap();
        let clip = dir.join("clip.mp4");
        let status = Command::new(ffmpeg::locate("ffmpeg").unwrap())
            .args(["-y", "-v", "error", "-f", "lavfi"])
            .args(["-i", "testsrc=duration=2:size=640x360:rate=24"])
            .args(["-pix_fmt", "yuv420p"])
            .arg(&clip)
            .status()
            .unwrap();
        assert!(status.success());

        let info = probe_video(&clip).unwrap();
        assert_eq!(
            info,
            VideoInfo {
                duration_ms: 2_000,
                width: 640,
                height: 360,
                fps: 24.0
            }
        );
    }
}
