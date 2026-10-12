//! Whisper model catalog and the one-time model download.
//!
//! Models are ggml files from https://huggingface.co/ggerganov/whisper.cpp, stored in
//! `<app data dir>/models/`. This download is the app's only network call.

use std::fs::{self, File};
use std::io::{BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const CANCELLED: &str = "cancelled";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum WhisperModel {
    Base,
    Small,
    LargeV3Turbo,
}

impl WhisperModel {
    pub const ALL: [WhisperModel; 3] = [Self::Base, Self::Small, Self::LargeV3Turbo];

    pub fn file_name(self) -> &'static str {
        match self {
            Self::Base => "ggml-base.bin",
            Self::Small => "ggml-small.bin",
            Self::LargeV3Turbo => "ggml-large-v3-turbo.bin",
        }
    }

    /// Size and SHA-256 as published by Hugging Face (LFS metadata).
    fn size_bytes(self) -> u64 {
        match self {
            Self::Base => 147_951_465,
            Self::Small => 487_601_967,
            Self::LargeV3Turbo => 1_624_555_275,
        }
    }

    fn sha256(self) -> &'static str {
        match self {
            Self::Base => "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe",
            Self::Small => "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b",
            Self::LargeV3Turbo => {
                "1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69"
            }
        }
    }

    fn url(self) -> String {
        format!(
            "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/{}",
            self.file_name()
        )
    }

    pub fn path_in(self, models_dir: &Path) -> PathBuf {
        models_dir.join(self.file_name())
    }

    /// A model counts as downloaded once the complete file is in place. Downloads land
    /// in a `.part` file and are only renamed after the checksum matches.
    pub fn is_downloaded(self, models_dir: &Path) -> bool {
        fs::metadata(self.path_in(models_dir)).is_ok_and(|m| m.len() == self.size_bytes())
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ModelInfo {
    pub id: WhisperModel,
    pub size_bytes: u64,
    pub downloaded: bool,
}

pub fn list(models_dir: &Path) -> Vec<ModelInfo> {
    WhisperModel::ALL
        .iter()
        .map(|&id| ModelInfo {
            id,
            size_bytes: id.size_bytes(),
            downloaded: id.is_downloaded(models_dir),
        })
        .collect()
}

#[derive(Debug, Clone, Copy, Serialize)]
pub struct DownloadProgress {
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
}

/// Downloads `model` into `models_dir`, verifying size and SHA-256.
/// `on_progress` is called roughly every 1 MB. Returns [`CANCELLED`] if `cancel` is set.
pub fn download(
    model: WhisperModel,
    models_dir: &Path,
    cancel: &AtomicBool,
    mut on_progress: impl FnMut(DownloadProgress),
) -> Result<PathBuf, String> {
    let target = model.path_in(models_dir);
    if model.is_downloaded(models_dir) {
        return Ok(target);
    }
    fs::create_dir_all(models_dir).map_err(|e| format!("cannot create models folder: {e}"))?;
    let part = target.with_extension("bin.part");

    let result = (|| {
        let response = ureq::get(&model.url())
            .call()
            .map_err(|e| format!("model download failed: {e}"))?;
        let mut reader = response.into_body().into_reader();
        let mut file = BufWriter::new(
            File::create(&part).map_err(|e| format!("cannot write model file: {e}"))?,
        );

        let total_bytes = model.size_bytes();
        let mut hasher = Sha256::new();
        let mut downloaded_bytes = 0u64;
        let mut last_reported = 0u64;
        let mut buf = vec![0u8; 64 * 1024];
        loop {
            if cancel.load(Ordering::Relaxed) {
                return Err(CANCELLED.to_string());
            }
            let n = reader
                .read(&mut buf)
                .map_err(|e| format!("model download interrupted: {e}"))?;
            if n == 0 {
                break;
            }
            hasher.update(&buf[..n]);
            file.write_all(&buf[..n])
                .map_err(|e| format!("cannot write model file: {e}"))?;
            downloaded_bytes += n as u64;
            if downloaded_bytes - last_reported >= 1 << 20 || downloaded_bytes == total_bytes {
                last_reported = downloaded_bytes;
                on_progress(DownloadProgress {
                    downloaded_bytes,
                    total_bytes,
                });
            }
        }
        file.flush()
            .map_err(|e| format!("cannot write model file: {e}"))?;

        let digest = to_hex(&hasher.finalize());
        if downloaded_bytes != total_bytes || digest != model.sha256() {
            return Err(format!(
                "downloaded {} is corrupt (got {downloaded_bytes} bytes); please try again",
                model.file_name()
            ));
        }
        fs::rename(&part, &target).map_err(|e| format!("cannot save model file: {e}"))?;
        Ok(target.clone())
    })();

    if result.is_err() {
        let _ = fs::remove_file(&part);
    }
    result
}

fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// The app data dir on macOS, used by the ignored tests that need a real model.
    /// Override with `KREOKIT_MODELS_DIR`.
    pub(crate) fn dev_models_dir() -> PathBuf {
        std::env::var_os("KREOKIT_MODELS_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                PathBuf::from(std::env::var_os("HOME").unwrap())
                    .join("Library/Application Support/com.kreokit.captions/models")
            })
    }

    #[test]
    fn model_ids_match_the_frontend() {
        let ids: Vec<String> = WhisperModel::ALL
            .iter()
            .map(|m| serde_json::to_string(m).unwrap())
            .collect();
        assert_eq!(ids, [r#""base""#, r#""small""#, r#""large-v3-turbo""#]);
    }

    #[test]
    fn urls_point_at_whisper_cpp_repo() {
        assert_eq!(
            WhisperModel::LargeV3Turbo.url(),
            "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin"
        );
    }

    #[test]
    fn partial_file_is_not_downloaded() {
        let dir = std::env::temp_dir().join("kreokit-models-test");
        fs::create_dir_all(&dir).unwrap();
        fs::write(WhisperModel::Base.path_in(&dir), b"truncated").unwrap();
        assert!(!WhisperModel::Base.is_downloaded(&dir));
        assert!(!list(&dir)[0].downloaded);
    }

    #[test]
    fn hex_encodes() {
        assert_eq!(to_hex(&[0x00, 0x0f, 0xab]), "000fab");
    }

    /// Downloads the base model (~148 MB) into the app data dir:
    /// `cargo test downloads_base_model -- --ignored`.
    #[test]
    #[ignore]
    fn downloads_base_model() {
        let cancel = AtomicBool::new(false);
        let path = download(WhisperModel::Base, &dev_models_dir(), &cancel, |_| {}).unwrap();
        assert!(WhisperModel::Base.is_downloaded(path.parent().unwrap()));
    }
}
