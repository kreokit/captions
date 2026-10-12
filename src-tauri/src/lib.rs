mod ass;
mod audio;
mod burn;
mod cpu;
mod ffmpeg;
mod layout;
mod model;
mod models;
mod probe;
mod project;
mod recent;
mod subtitles;
mod transcribe;
mod vad;
mod waveform;
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

/// Waveform peaks per video path, computed once per session.
#[derive(Default)]
struct WaveformCache(std::sync::Mutex<std::collections::HashMap<String, std::sync::Arc<Vec<u8>>>>);

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

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("cannot find app data folder: {e}"))
}

/// Video files the app opens (also used to vet dropped files).
const VIDEO_EXTENSIONS: &[&str] = &["mp4", "mov", "m4v", "mkv", "webm", "avi"];

/// The bundled caption fonts (tauri.conf.json `bundle.resources`); in debug builds also
/// the source folder, in case the resources haven't been copied yet.
fn caption_fonts_dir(app: &AppHandle) -> Option<PathBuf> {
    let bundled = app
        .path()
        .resolve("fonts", tauri::path::BaseDirectory::Resource)
        .ok()
        .filter(|p| p.is_dir());
    bundled.or_else(|| {
        let source = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/fonts");
        (cfg!(debug_assertions) && source.is_dir()).then_some(source)
    })
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
/// sound tags like "[MUSIC]". `custom_words` (names, brands, jargon; comma-separated) are
/// passed to Whisper as its initial prompt. The model must be downloaded.
#[tauri::command]
#[allow(clippy::too_many_arguments)] // arguments map 1:1 to the frontend's invoke() call
async fn transcribe(
    app: AppHandle,
    cancel: State<'_, CancelFlag>,
    path: String,
    language: Option<String>,
    model: WhisperModel,
    hide_non_speech: Option<bool>,
    custom_words: Option<String>,
    on_progress: Channel<TranscribeProgress>,
) -> Result<Transcript, String> {
    let support = cpu::check();
    if !support.supported {
        return Err(cpu::unsupported_message(&support.missing));
    }
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

        let prompt = custom_words
            .as_deref()
            .and_then(transcribe::prompt_from_custom_words);
        let _ = on_progress.send(TranscribeProgress::LoadingModel);
        let progress = on_progress.clone();
        transcribe::transcribe(
            model,
            &model_path,
            &samples,
            transcribe::Options {
                language: language.as_deref(),
                hide_non_speech: hide_non_speech.unwrap_or(true),
                prompt: prompt.as_deref(),
            },
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
    app: AppHandle,
    cancel: State<'_, CancelFlag>,
    video_path: String,
    output_path: String,
    segments: Vec<Segment>,
    style: Style,
    on_progress: Channel<u32>,
) -> Result<String, String> {
    let cancel = cancel.0.clone();
    cancel.store(false, Ordering::Relaxed);
    let fonts = caption_fonts_dir(&app);
    blocking(move || {
        let video = PathBuf::from(&video_path);
        let info = probe::probe_video(&video)?;
        let script = ass::to_ass(&segments, &style, info.width, info.height);
        burn::burn_in(
            &video,
            &PathBuf::from(&output_path),
            &script,
            fonts.as_deref(),
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

/// Timeline waveform for the video at `path`: one byte per 10 ms (see waveform.rs), sent
/// as raw bytes. A video without audio gives an empty waveform.
#[tauri::command]
async fn get_waveform(
    cache: State<'_, WaveformCache>,
    path: String,
) -> Result<tauri::ipc::Response, String> {
    if let Some(peaks) = cache.0.lock().unwrap().get(&path).cloned() {
        return Ok(tauri::ipc::Response::new(peaks.to_vec()));
    }
    let key = path.clone();
    let peaks = blocking(move || {
        Ok(match audio::extract_audio(&PathBuf::from(&path)) {
            Ok(samples) => waveform::peaks(&samples),
            Err(e) if e.contains("no audio track") => Vec::new(),
            Err(e) => return Err(e),
        })
    })
    .await?;
    let peaks = std::sync::Arc::new(peaks);
    cache.0.lock().unwrap().insert(key, peaks.clone());
    Ok(tauri::ipc::Response::new(peaks.to_vec()))
}

/// Recent projects for the Home screen, newest first, with thumbnails where possible.
#[tauri::command]
async fn list_recent(app: AppHandle) -> Result<Vec<recent::RecentEntry>, String> {
    let dir = data_dir(&app)?;
    let entries = blocking(move || {
        Ok(recent::load(&dir)
            .into_iter()
            .map(|project| recent::RecentEntry {
                exists: std::path::Path::new(&project.path).is_file(),
                thumbnail: recent::thumbnail(&dir, std::path::Path::new(&project.video_path))
                    .ok()
                    .map(|p| p.to_string_lossy().into_owned()),
                project,
            })
            .collect::<Vec<_>>())
    })
    .await?;
    for thumb in entries.iter().filter_map(|e| e.thumbnail.as_ref()) {
        let _ = app.asset_protocol_scope().allow_file(thumb);
    }
    Ok(entries)
}

/// Moves (or adds) a project to the top of the recent list.
#[tauri::command]
fn touch_recent(app: AppHandle, path: String, video_path: String) -> Result<(), String> {
    recent::touch(&data_dir(&app)?, &path, &video_path, recent::now_ms())
}

#[tauri::command]
fn remove_recent(app: AppHandle, path: String) -> Result<(), String> {
    recent::remove(&data_dir(&app)?, &path)
}

/// A thumbnail for a video (cached), viewable by the webview.
#[tauri::command]
async fn video_thumbnail(app: AppHandle, path: String) -> Result<String, String> {
    let dir = data_dir(&app)?;
    let thumb = blocking(move || recent::thumbnail(&dir, std::path::Path::new(&path))).await?;
    app.asset_protocol_scope()
        .allow_file(&thumb)
        .map_err(|e| e.to_string())?;
    Ok(thumb.to_string_lossy().into_owned())
}

/// Lets the webview play a video the user dropped on the window (files picked in a
/// dialog are allowed automatically). Only existing video files are accepted.
#[tauri::command]
fn allow_dropped_video(app: AppHandle, path: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    let is_video = path
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| VIDEO_EXTENSIONS.contains(&e.to_lowercase().as_str()));
    if !is_video || !path.is_file() {
        return Err("Drop a video file (MP4, MOV, M4V, MKV, WebM or AVI).".into());
    }
    app.asset_protocol_scope()
        .allow_file(&path)
        .map_err(|e| e.to_string())
}

/// Whether this CPU can run transcription (see cpu.rs).
#[tauri::command]
fn cpu_support() -> cpu::CpuSupport {
    cpu::check()
}

/// Where testers report problems: the bug-report form, with the app version filled in.
fn report_problem_url() -> String {
    format!(
        "https://github.com/kreokit/captions/issues/new?template=bug_report.yml&version={}",
        env!("CARGO_PKG_VERSION")
    )
}

/// Opens the bug-report page in the default browser. Only this fixed page can be opened;
/// the webview gets no general permission to open links.
#[tauri::command]
fn report_problem(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(report_problem_url(), None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

/// Development aid: a project to open at startup, from `KREOKIT_DEV_OPEN`. Always `None`
/// in release builds.
#[tauri::command]
fn dev_startup_project() -> Option<String> {
    if cfg!(debug_assertions) {
        std::env::var("KREOKIT_DEV_OPEN").ok()
    } else {
        None
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(CancelFlag::default())
        .manage(WaveformCache::default())
        .invoke_handler(tauri::generate_handler![
            probe_video,
            list_models,
            download_model,
            transcribe,
            cancel_transcription,
            save_project,
            load_project,
            export_subtitles,
            export_video,
            dev_startup_project,
            get_waveform,
            list_recent,
            touch_recent,
            remove_recent,
            video_thumbnail,
            allow_dropped_video,
            cpu_support,
            quit_app,
            report_problem
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    #[test]
    fn report_problem_opens_the_bug_form() {
        assert_eq!(
            super::report_problem_url(),
            format!(
                "https://github.com/kreokit/captions/issues/new?template=bug_report.yml&version={}",
                env!("CARGO_PKG_VERSION")
            )
        );
        assert!(super::report_problem_url().contains("version=0.1.0"));
    }
}
