//! Burn-in export: renders the captions into a new MP4 with FFmpeg's `ass` filter.

use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::ffmpeg;
use crate::models::CANCELLED;

/// H.264 encoders we may use, in order of preference. Platform encoders first (fast,
/// present in LGPL FFmpeg builds), then OpenH264. libx264 is GPL (CLAUDE.md: no GPL
/// components), so only development builds may fall back to it, for the GPL FFmpeg a
/// developer may have installed; release builds never use it.
fn allowed_encoders(dev_build: bool) -> Vec<&'static str> {
    let mut encoders = Vec::new();
    if cfg!(target_os = "macos") {
        encoders.push("h264_videotoolbox");
    }
    if cfg!(target_os = "windows") {
        encoders.push("h264_mf");
    }
    encoders.push("libopenh264");
    if dev_build {
        encoders.push("libx264");
    }
    encoders
}

/// Writes `ass` next to a fresh temp name and renders it onto `video`, writing an MP4 to
/// `output`. `duration_ms` drives progress (0–100 via `on_progress`). On error or cancel
/// the partial output is removed.
pub fn burn_in(
    video: &Path,
    output: &Path,
    ass: &str,
    fonts_dir: Option<&Path>,
    duration_ms: u64,
    cancel: &AtomicBool,
    mut on_progress: impl FnMut(u32),
) -> Result<(), String> {
    let ffmpeg = ffmpeg::locate("ffmpeg")?;
    let encoders = pick_encoders(&ffmpeg)?;
    let bitrate = target_bitrate(video, duration_ms);

    // FFmpeg's filter syntax needs escaping for ':' and '\\' (Windows paths). Each export
    // gets its own temp folder holding the script and a copy of the bundled caption fonts,
    // and FFmpeg runs inside it, so the filter only names plain relative paths.
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_nanos());
    let work_dir =
        std::env::temp_dir().join(format!("kreokit-export-{}-{nanos}", std::process::id()));
    // An encoder can be listed but unusable on this machine (e.g. Media Foundation missing
    // on some Windows editions); if it fails before any video is written, try the next.
    let result = prepare_work_dir(&work_dir, ass, fonts_dir).and_then(|filter| {
        let mut failures = Vec::new();
        for encoder in &encoders {
            match run_ffmpeg(
                &ffmpeg,
                &work_dir,
                video,
                output,
                &filter,
                encoder,
                bitrate,
                duration_ms,
                cancel,
                &mut on_progress,
            ) {
                Ok(()) => return Ok(()),
                Err(attempt) if !attempt.started && attempt.message != CANCELLED => {
                    failures.push(format!("{encoder}: {}", attempt.message));
                    let _ = std::fs::remove_file(output);
                }
                Err(attempt) => return Err(attempt.message),
            }
        }
        Err(format!("export failed:\n{}", failures.join("\n")))
    });
    let _ = std::fs::remove_dir_all(&work_dir);
    if result.is_err() {
        let _ = std::fs::remove_file(output);
    }
    result
}

/// Writes `captions.ass` (and copies the `.ttf`/`.otf` files from `fonts_dir` into
/// `fonts/`) under `work_dir`; returns the matching `ass` filter.
fn prepare_work_dir(
    work_dir: &Path,
    ass: &str,
    fonts_dir: Option<&Path>,
) -> Result<String, String> {
    let fail = |e: std::io::Error| format!("cannot prepare the export: {e}");
    std::fs::create_dir_all(work_dir).map_err(fail)?;
    std::fs::write(work_dir.join("captions.ass"), ass).map_err(fail)?;
    let Some(fonts_dir) = fonts_dir else {
        return Ok("ass=filename=captions.ass".into());
    };
    let fonts = work_dir.join("fonts");
    std::fs::create_dir_all(&fonts).map_err(fail)?;
    for entry in std::fs::read_dir(fonts_dir).map_err(fail)?.flatten() {
        let path = entry.path();
        let is_font = path
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| matches!(e.to_lowercase().as_str(), "ttf" | "otf"));
        if is_font {
            std::fs::copy(&path, fonts.join(entry.file_name())).map_err(fail)?;
        }
    }
    Ok("ass=filename=captions.ass:fontsdir=fonts".into())
}

/// A failed FFmpeg run, and whether it had started writing video (then retrying with
/// another encoder makes no sense).
struct Attempt {
    message: String,
    started: bool,
}

#[allow(clippy::too_many_arguments)]
fn run_ffmpeg(
    ffmpeg: &Path,
    work_dir: &Path,
    video: &Path,
    output: &Path,
    filter: &str,
    encoder: &str,
    bitrate: u64,
    duration_ms: u64,
    cancel: &AtomicBool,
    on_progress: &mut impl FnMut(u32),
) -> Result<(), Attempt> {
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
        .args(["-vf", filter])
        .args(["-map", "0:v:0", "-map", "0:a:0?"])
        .args([
            "-c:v",
            encoder,
            "-b:v",
            &bitrate.to_string(),
            "-pix_fmt",
            "yuv420p",
        ])
        // VideoToolbox may fall back to Apple's software encoder (e.g. in VMs).
        .args(if encoder == "h264_videotoolbox" {
            &["-allow_sw", "1"][..]
        } else {
            &[][..]
        })
        .args(["-c:a", "aac", "-b:a", "192k"])
        .args(["-movflags", "+faststart"])
        .arg(absolute(output))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| Attempt {
            message: format!("failed to run {}: {e}", ffmpeg.display()),
            started: false,
        })?;

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
            return Err(Attempt {
                message: CANCELLED.to_string(),
                started: true,
            });
        }
        let Ok(line) = line else { break };
        if let Some(percent) = progress_percent(&line, duration_ms)
            && last != Some(percent)
        {
            last = Some(percent);
            on_progress(percent);
        }
    }

    let started = last.is_some_and(|p| p > 0);
    let status = child.wait().map_err(|e| Attempt {
        message: e.to_string(),
        started,
    })?;
    let errors = errors.join().unwrap_or_default();
    if cancel.load(Ordering::Relaxed) {
        return Err(Attempt {
            message: CANCELLED.to_string(),
            started: true,
        });
    }
    if !status.success() {
        return Err(Attempt {
            message: format!("export failed: {}", errors.trim()),
            started,
        });
    }
    on_progress(100);
    Ok(())
}

/// The allowed encoders this FFmpeg has, in order of preference.
fn pick_encoders(ffmpeg: &Path) -> Result<Vec<&'static str>, String> {
    let output = Command::new(ffmpeg)
        .args(["-hide_banner", "-encoders"])
        .output()
        .map_err(|e| format!("failed to run {}: {e}", ffmpeg.display()))?;
    pick_from(
        &String::from_utf8_lossy(&output.stdout),
        &allowed_encoders(cfg!(debug_assertions)),
    )
}

/// The allowed encoders listed in `ffmpeg -encoders` output (" V....D name  description"
/// lines), in `allowed` order; an error if there are none.
fn pick_from(encoder_list: &str, allowed: &[&'static str]) -> Result<Vec<&'static str>, String> {
    let found: Vec<&'static str> = allowed
        .iter()
        .copied()
        .filter(|enc| {
            encoder_list
                .lines()
                .any(|l| l.split_whitespace().nth(1) == Some(enc))
        })
        .collect();
    if found.is_empty() {
        return Err(format!(
            "Can't export video: this FFmpeg has none of the allowed H.264 encoders ({}).",
            allowed.join(", ")
        ));
    }
    Ok(found)
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
    fn release_builds_never_use_libx264() {
        assert!(!allowed_encoders(false).contains(&"libx264"));
        assert_eq!(allowed_encoders(true).last(), Some(&"libx264"));
        assert!(allowed_encoders(false).contains(&"libopenh264"));
    }

    #[test]
    fn picks_the_first_allowed_encoder_available() {
        let list = " V....D libx264    libx264 H.264\n V....D libopenh264  OpenH264 H.264\n";
        assert_eq!(
            pick_from(list, &["h264_mf", "libopenh264", "libx264"]),
            Ok(vec!["libopenh264", "libx264"])
        );

        let gpl_only = " V....D libx264    libx264 H.264\n";
        let err = pick_from(gpl_only, &allowed_encoders(false)).unwrap_err();
        assert!(err.contains("none of the allowed H.264 encoders"), "{err}");
        assert!(!err.contains("libx264"), "{err}");
    }

    #[test]
    fn prepares_script_and_fonts() {
        let work = std::env::temp_dir().join("kreokit-prepare-test");
        let _ = std::fs::remove_dir_all(&work);
        let fonts = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/fonts");
        let filter = prepare_work_dir(&work, "[Script Info]", Some(&fonts)).unwrap();
        assert_eq!(filter, "ass=filename=captions.ass:fontsdir=fonts");
        assert!(work.join("fonts/Montserrat-Bold.ttf").is_file());
        assert!(!work.join("fonts/OFL-Montserrat.txt").exists());
        let _ = std::fs::remove_dir_all(&work);
        assert_eq!(
            prepare_work_dir(&work, "x", None).unwrap(),
            "ass=filename=captions.ass"
        );
        let _ = std::fs::remove_dir_all(&work);
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
        let fonts = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/fonts");
        burn_in(
            &fixture,
            &output,
            &ass,
            Some(&fonts),
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

        // At 1.2 s "WELCOME" is highlighted in the default lime (#C8F135): look for it.
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
        let lime = raw
            .as_chunks::<3>()
            .0
            .iter()
            .filter(|p| p[0] > 160 && p[1] > 210 && p[2] < 110)
            .count();
        println!(
            "lime pixels at 1.2 s: {lime}; frame saved to {}",
            png.display()
        );
        // "WELCOME" in Montserrat Bold covers ~250-300 px at 640x360, and compression
        // shifts some edge pixels out of the colour range, so allow for that.
        assert!(lime > 150, "highlighted word not visible");
        let _ = std::fs::remove_file(&output);
    }

    /// Burns a caption at free positions into 9:16 and 16:9 clips and checks where the
    /// text lands in the video: horizontally centred on the anchor, vertically with the
    /// anchored edge (top / centre / bottom) at the anchor, as the preview places it.
    /// Needs ffmpeg and ffprobe: `cargo test burned_position -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn burned_position_matches_placement() {
        use crate::model::{CaptionMode, Position, Segment, Style, Word};
        let ffmpeg = ffmpeg::locate("ffmpeg").unwrap();
        let fonts = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/fonts");
        let cases = [
            (1080u32, 1920u32, Position::Top, 0.3, 0.2),
            (1920, 1080, Position::Bottom, 0.7, 0.85),
            (1080, 1920, Position::Middle, 0.5, 0.5),
        ];
        for (width, height, position, pos_x, pos_y) in cases {
            let dir = std::env::temp_dir().join(format!("kreokit-place-{width}x{height}"));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).unwrap();
            let clip = dir.join("black.mp4");
            assert!(
                Command::new(&ffmpeg)
                    .args(["-nostdin", "-y", "-v", "error", "-f", "lavfi", "-i"])
                    .arg(format!("color=c=black:s={width}x{height}:r=25:d=1"))
                    .args(["-pix_fmt", "yuv420p"])
                    .arg(&clip)
                    .status()
                    .unwrap()
                    .success()
            );
            let style = Style {
                font_family: "Montserrat".into(),
                font_size: 80,
                color: "#FFFFFF".into(),
                outline_width: 0,
                mode: CaptionMode::Line,
                uppercase: false,
                position,
                pos_x: Some(pos_x),
                pos_y: Some(pos_y),
                ..Style::default()
            };
            let segment = Segment {
                id: 0,
                start_ms: 0,
                end_ms: 1000,
                text: "MARK".into(),
                words: vec![Word {
                    start_ms: 0,
                    end_ms: 1000,
                    text: "MARK".into(),
                }],
            };
            let ass = crate::ass::to_ass(&[segment], &style, width, height);
            let out = dir.join("out.mp4");
            burn_in(
                &clip,
                &out,
                &ass,
                Some(&fonts),
                1000,
                &AtomicBool::new(false),
                |_| {},
            )
            .unwrap();

            let raw = Command::new(&ffmpeg)
                .args(["-nostdin", "-v", "error", "-ss", "0.5", "-i"])
                .arg(&out)
                .args([
                    "-frames:v",
                    "1",
                    "-f",
                    "rawvideo",
                    "-pix_fmt",
                    "gray",
                    "pipe:1",
                ])
                .output()
                .unwrap()
                .stdout;
            assert_eq!(raw.len(), (width * height) as usize);
            let (mut left, mut right, mut top, mut bottom) = (u32::MAX, 0, u32::MAX, 0);
            for (i, &v) in raw.iter().enumerate() {
                if v > 128 {
                    let (x, y) = (i as u32 % width, i as u32 / width);
                    left = left.min(x);
                    right = right.max(x);
                    top = top.min(y);
                    bottom = bottom.max(y);
                }
            }
            assert!(
                right > left,
                "no caption found in the {width}x{height} frame"
            );

            let anchor_x = pos_x * width as f64;
            let anchor_y = pos_y * height as f64;
            let font_px = 80.0 * height as f64 / 1080.0;
            let centre_x = (left + right) as f64 / 2.0;
            let edge_y = match position {
                Position::Top => top as f64,
                Position::Middle => (top + bottom) as f64 / 2.0,
                Position::Bottom => bottom as f64,
            };
            println!(
                "{width}x{height} {position:?}: anchor ({anchor_x:.0}, {anchor_y:.0}), text box x {left}-{right}, y {top}-{bottom}"
            );
            assert!(
                (centre_x - anchor_x).abs() <= width as f64 * 0.02,
                "{width}x{height}: text centred at x {centre_x}, anchor {anchor_x}"
            );
            // The glyphs sit inside the font's line box (ascender / descender space, e.g.
            // ~0.27 of the size above Montserrat's capitals), so the anchored edge of the
            // ink is within 30 % of the font size of the anchor. A misplaced caption would be
            // hundreds of pixels off.
            assert!(
                (edge_y - anchor_y).abs() <= font_px * 0.3,
                "{width}x{height} {position:?}: text edge at y {edge_y}, anchor {anchor_y}"
            );
        }
    }
}
