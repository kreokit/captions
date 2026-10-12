mod audio;
mod ffmpeg;
mod model;
mod models;
mod probe;
mod transcribe;
#[cfg(test)]
mod wer;

use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};

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
/// ("sq", "mk", "en", …) or `None` to auto-detect. The model must be downloaded.
#[tauri::command]
async fn transcribe(
    app: AppHandle,
    cancel: State<'_, CancelFlag>,
    path: String,
    language: Option<String>,
    model: WhisperModel,
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
            cancel,
            move |percent| {
                let _ = progress.send(TranscribeProgress::Transcribing { percent });
            },
        )
    })
    .await
}

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
            cancel_transcription
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
