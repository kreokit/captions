mod ass;
mod audio;
mod burn;
mod ffmpeg;
mod layout;
mod model;
mod models;
mod probe;
mod project;
mod subtitles;
mod transcribe;
mod vad;
#[cfg(test)]
mod wer;

use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};

use model::{Project, Segment, Style};
use models::{DownloadProgress, ModelInfo, WhisperModel};
use probe::VideoInfo;
use transcribe::Transcript;

/// Set by `cancel_transcription`; checked by model downloads and whisper.
#[derive(Default)]
struct CancelFlag(Arc<AtomicBool>);

#[derive(Clone, Serialize)]
#[serde(tag = "stage", rename_all = "snake_case")]
enum TranscribeProgress {
    Extracting,
    LoadingModel,
    Transcribing { percent: i32 },
}

fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("models"))
        .map_err(|e| format!("cannot find app data folder: {e}"))
}

/// Runs blocking work (ffprobe, downloads, whisper) off the async runtime.
async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}

/// Reads duration, resolution and frame rate of the video at `path`.
#[tauri::command]
async fn probe_video(path: String) -> Result<VideoInfo, String> {
    blocking(move || probe::probe_video(&PathBuf::from(path))).await
}

#[tauri::command]
fn list_models(app: AppHandle) -> Result<Vec<ModelInfo>, String> {
    Ok(models::list(&models_dir(&app)?))
}

#[tauri::command]
async fn download_model(
    app: AppHandle,
    cancel: State<'_, CancelFlag>,
    model: WhisperModel,
    on_progress: Channel<DownloadProgress>,
) -> Result<(), String> {
    let dir = models_dir(&app)?;
    let cancel = cancel.0.clone();
    cancel.store(false, Ordering::Relaxed);
    blocking(move || {
        models::download(model, &dir, &cancel, |p| {
            let _ = on_progress.send(p);
        })
        .map(|_| ())
    })
    .await
}

/// Transcribes the audio of the video at `path`. `language` is a Whisper code
/// ("en", "de", …) or `None` to auto-detect. `hide_non_speech` (default true) drops
/// sound tags like "[MUSIC]". The model must be downloaded.
#[tauri::command]
async fn transcribe(
    app: AppHandle,
    cancel: State<'_, CancelFlag>,
    path: String,
    language: Option<String>,
    model: WhisperModel,
    hide_non_speech: Option<bool>,
    on_progress: Channel<TranscribeProgress>,
) -> Result<Transcript, String> {
    let model_path = model.path_in(&models_dir(&app)?);
    if !model.is_downloaded(model_path.parent().unwrap()) {
        return Err(format!("model {} is not downloaded", model.file_name()));
    }
    let cancel = cancel.0.clone();
    cancel.store(false, Ordering::Relaxed);

    blocking(move || {
        let _ = on_progress.send(TranscribeProgress::Extracting);
        let samples = audio::extract_audio(&PathBuf::from(path))?;
        if cancel.load(Ordering::Relaxed) {
            return Err(models::CANCELLED.to_string());
        }

        let _ = on_progress.send(TranscribeProgress::LoadingModel);
        let progress = on_progress.clone();
        transcribe::transcribe(
            model,
            &model_path,
            &samples,
            language.as_deref(),
            hide_non_speech.unwrap_or(true),
            cancel,
            move |percent| {
                let _ = progress.send(TranscribeProgress::Transcribing { percent });
            },
        )
    })
    .await
}

/// Saves `project` to `path` and returns the final path (with `.kreocap` added if missing).
#[tauri::command]
async fn save_project(path: String, project: Project) -> Result<String, String> {
    blocking(move || {
        project::save(&PathBuf::from(path), &project).map(|p| p.to_string_lossy().into_owned())
    })
    .await
}

/// Loads a project and lets the webview play its video (the asset protocol only serves
/// files the user picked or opened).
#[tauri::command]
async fn load_project(app: AppHandle, path: String) -> Result<Project, String> {
    let project = blocking(move || project::load(&PathBuf::from(path))).await?;
    app.asset_protocol_scope()
        .allow_file(&project.video_path)
        .map_err(|e| e.to_string())?;
    Ok(project)
}

/// Writes the captions as SRT, WebVTT or styled ASS; returns the path written.
/// ASS needs the video's size, read from `video_path`.
#[tauri::command]
async fn export_subtitles(
    path: String,
    format: subtitles::SubtitleFormat,
    video_path: String,
    segments: Vec<Segment>,
    style: Style,
) -> Result<String, String> {
    use subtitles::SubtitleFormat::*;
    blocking(move || {
        let text = match format {
            Srt => subtitles::to_srt(&subtitles::cues(&segments, &style)),
            Vtt => subtitles::to_vtt(&subtitles::cues(&segments, &style)),
            Ass => {
                let video = probe::probe_video(&PathBuf::from(&video_path))?;
                ass::to_ass(&segments, &style, video.width, video.height)
            }
        };
        std::fs::write(&path, text).map_err(|e| format!("cannot write {path}: {e}"))?;
        Ok(path)
    })
    .await
}

/// Renders the captions into a new MP4 at `output_path`. Progress 0–100 goes to
/// `on_progress`; `cancel_transcription` stops it.
#[tauri::command]
async fn export_video(
    cancel: State<'_, CancelFlag>,
    video_path: String,
    output_path: String,
    segments: Vec<Segment>,
    style: Style,
    on_progress: Channel<u32>,
) -> Result<String, String> {
    let cancel = cancel.0.clone();
    cancel.store(false, Ordering::Relaxed);
    blocking(move || {
        let video = PathBuf::from(&video_path);
        let info = probe::probe_video(&video)?;
        let script = ass::to_ass(&segments, &style, info.width, info.height);
        burn::burn_in(
            &video,
            &PathBuf::from(&output_path),
            &script,
            info.duration_ms,
            &cancel,
            |p| {
                let _ = on_progress.send(p);
            },
        )?;
        Ok(output_path)
    })
    .await
}

/// Stops a running transcription, model download or video export.
#[tauri::command]
fn cancel_transcription(cancel: State<'_, CancelFlag>) {
    cancel.0.store(true, Ordering::Relaxed);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(CancelFlag::default())
        .invoke_handler(tauri::generate_handler![
            probe_video,
            list_models,
            download_model,
            transcribe,
            cancel_transcription,
            save_project,
            load_project,
            export_subtitles,
            export_video
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
