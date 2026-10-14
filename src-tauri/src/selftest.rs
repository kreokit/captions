//! `captions --self-test <video> [--reference <txt>] [--models <dir>]`: a hidden mode for
//! release CI. It transcribes the clip with the base model inside the shipped binary (the
//! bundled FFmpeg, whisper.cpp's release build flags) and exits non-zero on any failure.
//! It runs before Tauri starts, so it needs no window or display.
//!
//! The base model is downloaded into `--models` (default: the system temp dir) if it isn't
//! there yet, which also exercises the download and checksum code.

use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use std::time::Instant;

use crate::models::{self, WhisperModel};
use crate::{audio, cpu, ffmpeg, transcribe, wer};

/// The highest word error rate (against `--reference`) that still passes.
const MAX_WER: f64 = 0.3;

/// Runs the self-test if `args` (without the program name) start with `--self-test`.
pub fn run_if_requested(args: &[String]) -> Option<ExitCode> {
    if args.first().map(String::as_str) != Some("--self-test") {
        return None;
    }
    Some(match parse(&args[1..]).and_then(|options| run(&options)) {
        Ok(()) => {
            println!("self-test: ok");
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("self-test: FAILED: {e}");
            ExitCode::FAILURE
        }
    })
}

#[derive(Debug, PartialEq)]
struct SelfTestOptions {
    video: PathBuf,
    reference: Option<PathBuf>,
    models_dir: PathBuf,
}

fn parse(args: &[String]) -> Result<SelfTestOptions, String> {
    let usage = "usage: captions --self-test <video> [--reference <txt>] [--models <dir>]";
    let mut video = None;
    let mut reference = None;
    let mut models_dir = std::env::temp_dir().join("kreokit-self-test-models");
    let mut args = args.iter();
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--reference" => reference = Some(PathBuf::from(args.next().ok_or(usage)?)),
            "--models" => models_dir = PathBuf::from(args.next().ok_or(usage)?),
            flag if flag.starts_with("--") => return Err(format!("unknown flag {flag}; {usage}")),
            _ if video.is_none() => video = Some(PathBuf::from(arg)),
            _ => return Err(usage.into()),
        }
    }
    Ok(SelfTestOptions {
        video: video.ok_or(usage)?,
        reference,
        models_dir,
    })
}

fn run(options: &SelfTestOptions) -> Result<(), String> {
    let support = cpu::check();
    if !support.supported {
        return Err(cpu::unsupported_message(&support.missing));
    }
    println!("ffmpeg:  {}", ffmpeg::locate("ffmpeg")?.display());

    let model = WhisperModel::Base;
    let model_path = ensure_model(model, &options.models_dir)?;
    println!("model:   {}", model_path.display());

    let samples = audio::extract_audio(&options.video)?;
    let started = Instant::now();
    let transcript = transcribe::transcribe(
        model,
        &model_path,
        &samples,
        transcribe::Options {
            hide_non_speech: true,
            ..transcribe::Options::default()
        },
        Arc::new(AtomicBool::new(false)),
        |_| {},
    )?;
    let text: Vec<&str> = transcript
        .segments
        .iter()
        .map(|s| s.text.as_str())
        .collect();
    let text = text.join(" ");
    println!("language: {}", transcript.language);
    println!("text:    {text}");
    println!(
        "took {:.1?} for {:.1}s of audio",
        started.elapsed(),
        samples.len() as f64 / audio::SAMPLE_RATE as f64
    );

    if text.trim().is_empty() {
        return Err("the transcript is empty".into());
    }
    if let Some(reference) = &options.reference {
        let reference = std::fs::read_to_string(reference)
            .map_err(|e| format!("cannot read {}: {e}", reference.display()))?;
        let wer = wer::word_error_rate(&reference, &text);
        println!("WER:     {wer:.3} (max {MAX_WER})");
        if wer > MAX_WER {
            return Err(format!("WER {wer:.3} is above {MAX_WER}"));
        }
    }
    Ok(())
}

fn ensure_model(model: WhisperModel, models_dir: &Path) -> Result<PathBuf, String> {
    if model.is_downloaded(models_dir) {
        return Ok(model.path_in(models_dir));
    }
    std::fs::create_dir_all(models_dir)
        .map_err(|e| format!("cannot create {}: {e}", models_dir.display()))?;
    println!("downloading {} …", model.file_name());
    models::download(model, models_dir, &AtomicBool::new(false), |_| {})
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn only_runs_with_the_flag() {
        assert_eq!(run_if_requested(&args(&[])), None);
        assert_eq!(run_if_requested(&args(&["clip.mp4"])), None);
    }

    #[test]
    fn parses_video_reference_and_models() {
        let parsed = parse(&args(&["a.mp4", "--reference", "a.txt", "--models", "m"])).unwrap();
        assert_eq!(
            parsed,
            SelfTestOptions {
                video: "a.mp4".into(),
                reference: Some("a.txt".into()),
                models_dir: "m".into(),
            }
        );
    }

    #[test]
    fn rejects_missing_video_and_unknown_flags() {
        assert!(parse(&args(&[])).is_err());
        assert!(parse(&args(&["a.mp4", "--fast"])).is_err());
        assert!(parse(&args(&["a.mp4", "--models"])).is_err());
        assert!(parse(&args(&["a.mp4", "b.mp4"])).is_err());
    }
}
