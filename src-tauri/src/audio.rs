//! Audio extraction for Whisper: 16 kHz mono 32-bit float samples, decoded by ffmpeg.
//!
//! ffmpeg writes raw `f32le` samples to stdout, so no temporary WAV file is needed.

use std::path::Path;
use std::process::Command;

use crate::ffmpeg;

/// Whisper expects 16 kHz mono audio.
pub const SAMPLE_RATE: u32 = 16_000;

pub fn extract_audio(video: &Path) -> Result<Vec<f32>, String> {
    let ffmpeg = ffmpeg::locate("ffmpeg")?;
    let output = Command::new(&ffmpeg)
        .args(["-nostdin", "-v", "error", "-i"])
        .arg(video)
        .args(["-vn", "-ac", "1", "-ar", &SAMPLE_RATE.to_string()])
        .args(["-f", "f32le", "-acodec", "pcm_f32le", "pipe:1"])
        .output()
        .map_err(|e| format!("failed to run {}: {e}", ffmpeg.display()))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("does not contain any stream") {
            return Err("this video has no audio track".into());
        }
        return Err(format!(
            "ffmpeg could not read the audio: {}",
            stderr.trim()
        ));
    }

    let samples = samples_from_f32le(&output.stdout);
    if samples.is_empty() {
        return Err("this video has no audio track".into());
    }
    Ok(samples)
}

/// Converts little-endian `f32` bytes to samples. A trailing partial sample is dropped.
fn samples_from_f32le(bytes: &[u8]) -> Vec<f32> {
    let (chunks, _) = bytes.as_chunks::<4>();
    chunks.iter().map(|&b| f32::from_le_bytes(b)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_f32le_samples() {
        let bytes: Vec<u8> = [0.0f32, 0.5, -1.0]
            .iter()
            .flat_map(|s| s.to_le_bytes())
            .chain([0xAB]) // partial trailing sample
            .collect();
        assert_eq!(samples_from_f32le(&bytes), vec![0.0, 0.5, -1.0]);
    }
}
