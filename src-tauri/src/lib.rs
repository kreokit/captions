mod ffmpeg;
mod probe;

use std::path::PathBuf;

use probe::VideoInfo;

/// Reads duration, resolution and frame rate of the video at `path`.
#[tauri::command]
async fn probe_video(path: String) -> Result<VideoInfo, String> {
    // ffprobe can take a moment on large files; keep it off the async runtime.
    tauri::async_runtime::spawn_blocking(move || probe::probe_video(&PathBuf::from(path)))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![probe_video])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
