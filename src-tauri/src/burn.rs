//! Burn-in export: renders the captions into a new MP4 with FFmpeg's `ass` filter.

use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::ffmpeg;
use crate::models::CANCELLED;

/// H.264 encoders in order of preference. Platform encoders first: they are fast and
/// available in LGPL FFmpeg builds. libx264 (GPL) is only a fallback for development
/// builds of FFmpeg; the bundled LGPL build won't have it (see CLAUDE.md).
const ENCODERS: &[&str] = &[
    #[cfg(target_os = "macos")]
    "h264_videotoolbox",
    #[cfg(target_os = "windows")]
    "h264_mf",
    "libopenh264",
    "libx264",
];

/// Writes `ass` next to a fresh temp name and renders it onto `video`, writing an MP4 to
/// `output`. `duration_ms` drives progress (0–100 via `on_progress`). On error or cancel
/// the partial output is removed.
pub fn burn_in(
    video: &Path,
    output: &Path,
    ass: &str,
    duration_ms: u64,
    cancel: &AtomicBool,
    mut on_progress: impl FnMut(u32),
) -> Result<(), String> {
    let ffmpeg = ffmpeg::locate("ffmpeg")?;
    let encoder = pick_encoder(&ffmpeg)?;
    let bitrate = target_bitrate(video, duration_ms);

    // FFmpeg's filter syntax needs escaping for ':' and '\' (Windows paths); running
    // in the temp dir and naming the file plainly avoids that entirely.
    let work_dir = std::env::temp_dir();
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_nanos());
    let ass_name = format!("kreokit-{}-{nanos}.ass", std::process::id());
    let ass_path = work_dir.join(&ass_name);
    std::fs::write(&ass_path, ass).map_err(|e| format!("cannot write captions: {e}"))?;

    let result = run_ffmpeg(
        &ffmpeg,
        &work_dir,
        video,
        output,
        &ass_name,
        encoder,
        bitrate,
        duration_ms,
        cancel,
        &mut on_progress,
    );
    let _ = std::fs::remove_file(&ass_path);
    if result.is_err() {
        let _ = std::fs::remove_file(output);
    }
    result
}

#[allow(clippy::too_many_arguments)]
fn run_ffmpeg(
    ffmpeg: &Path,
    work_dir: &Path,
    video: &Path,
    output: &Path,
    ass_name: &str,
    encoder: &str,
    bitrate: u64,
    duration_ms: u64,
    cancel: &AtomicBool,
    on_progress: &mut impl FnMut(u32),
) -> Result<(), String> {
    let mut child = Command::new(ffmpeg)
        .current_dir(work_dir)
        .args([
            "-nostdin",
            "-y",
            "-v",
            "error",
            "-nostats",
            "-progress",
            "pipe:1",
            "-i",
        ])
        .arg(absolute(video))
        .args(["-vf", &format!("ass=filename={ass_name}")])
        .args(["-map", "0:v:0", "-map", "0:a:0?"])
        .args([
            "-c:v",
            encoder,
            "-b:v",
            &bitrate.to_string(),
            "-pix_fmt",
            "yuv420p",
        ])
        .args(["-c:a", "aac", "-b:a", "192k"])
        .args(["-movflags", "+faststart"])
        .arg(absolute(output))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to run {}: {e}", ffmpeg.display()))?;

    // Collect errors on a thread so a chatty stderr can never block ffmpeg.
    let mut stderr = child.stderr.take().unwrap();
    let errors = std::thread::spawn(move || {
        let mut text = String::new();
        let _ = stderr.read_to_string(&mut text);
        text
    });

    let mut last = None;
    for line in BufReader::new(child.stdout.take().unwrap()).lines() {
        if cancel.load(Ordering::Relaxed) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(CANCELLED.to_string());
        }
        let Ok(line) = line else { break };
        if let Some(percent) = progress_percent(&line, duration_ms)
            && last != Some(percent)
        {
            last = Some(percent);
            on_progress(percent);
        }
    }

    let status = child.wait().map_err(|e| e.to_string())?;
    let errors = errors.join().unwrap_or_default();
    if cancel.load(Ordering::Relaxed) {
        return Err(CANCELLED.to_string());
    }
    if !status.success() {
        return Err(format!("export failed: {}", errors.trim()));
    }
    on_progress(100);
    Ok(())
}

/// The first preferred encoder this FFmpeg has.
fn pick_encoder(ffmpeg: &Path) -> Result<&'static str, String> {
    let output = Command::new(ffmpeg)
        .args(["-hide_banner", "-encoders"])
        .output()
        .map_err(|e| format!("failed to run {}: {e}", ffmpeg.display()))?;
    let list = String::from_utf8_lossy(&output.stdout);
    ENCODERS
        .iter()
        .copied()
        .find(|enc| {
            list.lines()
                .any(|l| l.split_whitespace().nth(1) == Some(enc))
        })
        .ok_or_else(|| "this FFmpeg has no H.264 encoder".to_string())
}

/// Keeps roughly the source's bitrate (file size over duration), within 2–50 Mbit/s.
fn target_bitrate(video: &Path, duration_ms: u64) -> u64 {
    let bytes = std::fs::metadata(video).map_or(0, |m| m.len());
    let bits_per_second = bytes * 8 * 1000 / duration_ms.max(1);
    bits_per_second.clamp(2_000_000, 50_000_000)
}

/// Parses `out_time_us=…` lines from `-progress` into 0–99 (100 is sent on success).
fn progress_percent(line: &str, duration_ms: u64) -> Option<u32> {
    let us: u64 = line.strip_prefix("out_time_us=")?.trim().parse().ok()?;
    Some(((us / 1000) * 100 / duration_ms.max(1)).min(99) as u32)
}

fn absolute(path: &Path) -> PathBuf {
    std::path::absolute(path).unwrap_or_else(|_| path.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_progress_lines() {
        assert_eq!(progress_percent("out_time_us=4729000", 9458), Some(50));
        assert_eq!(progress_percent("out_time_us=99999999", 9458), Some(99));
        assert_eq!(progress_percent("out_time_us=N/A", 9458), None);
        assert_eq!(progress_percent("frame=12", 9458), None);
    }

    #[test]
    fn bitrate_stays_in_range() {
        let tiny = std::env::temp_dir().join("kreokit-bitrate-test");
        std::fs::write(&tiny, [0u8; 1000]).unwrap();
        assert_eq!(target_bitrate(&tiny, 10_000), 2_000_000);
        assert_eq!(target_bitrate(Path::new("/does/not/exist"), 0), 2_000_000);
    }

    /// Burns the English fixture with hand-made captions and checks the result:
    /// same duration and resolution as the input, and the highlighted word visible in
    /// the highlight colour. Needs ffmpeg and ffprobe:
    /// `cargo test burns_fixture -- --ignored --nocapture`.
    /// Saves a frame to target/burn-check.png for a visual check.
    #[test]
    #[ignore]
    fn burns_fixture() {
        use crate::model::{Segment, Style, Word};
        let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("../fixtures/en/hello.mp4");
        let input = crate::probe::probe_video(&fixture).unwrap();
        let segment = Segment {
            id: 0,
            start_ms: 1000,
            end_ms: 2650,
            text: "Welcome to the caption test,".into(),
            words: [
                ("Welcome", 1040, 1340),
                ("to", 1400, 1560),
                ("the", 1560, 1650),
                ("caption", 1650, 2060),
                ("test,", 2300, 2650),
            ]
            .iter()
            .map(|&(t, s, e)| Word {
                start_ms: s,
                end_ms: e,
                text: t.into(),
            })
            .collect(),
        };
        let style = Style::default();
        let ass = crate::ass::to_ass(&[segment], &style, input.width, input.height);

        let output = std::env::temp_dir().join("kreokit-burn-test.mp4");
        let mut progress = Vec::new();
        burn_in(
            &fixture,
            &output,
            &ass,
            input.duration_ms,
            &AtomicBool::new(false),
            |p| progress.push(p),
        )
        .unwrap();
        println!("progress updates: {progress:?}");
        assert_eq!(progress.last(), Some(&100));

        let result = crate::probe::probe_video(&output).unwrap();
        println!("input {input:?}\noutput {result:?}");
        assert_eq!((result.width, result.height), (input.width, input.height));
        assert!(result.duration_ms.abs_diff(input.duration_ms) <= 100);

        // At 1.2 s "WELCOME" is highlighted (#FFD400): look for yellow pixels.
        let ffmpeg = ffmpeg::locate("ffmpeg").unwrap();
        let png = Path::new(env!("CARGO_MANIFEST_DIR")).join("target/burn-check.png");
        let frame = |args: &[&str]| {
            Command::new(&ffmpeg)
                .args(["-nostdin", "-v", "error", "-ss", "1.2", "-i"])
                .arg(&output)
                .args(["-frames:v", "1", "-y"])
                .args(args)
                .output()
                .unwrap()
        };
        frame(&[png.to_str().unwrap()]);
        let raw = frame(&["-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"]).stdout;
        let yellow = raw
            .as_chunks::<3>()
            .0
            .iter()
            .filter(|p| p[0] > 200 && p[1] > 170 && p[2] < 90)
            .count();
        println!(
            "yellow pixels at 1.2 s: {yellow}; frame saved to {}",
            png.display()
        );
        assert!(yellow > 500, "highlighted word not visible");
        let _ = std::fs::remove_file(&output);
    }
}
