//! Audio peaks for the timeline waveform.

use crate::audio::SAMPLE_RATE;

/// Peak levels per second of audio (one per 10 ms).
pub const PEAKS_PER_SECOND: u32 = 100;
/// Levels are drawn on a decibel scale from this floor up to 0 dBFS.
const FLOOR_DB: f32 = -48.0;

/// One byte per 10 ms: the loudest sample in that slice on a 0–255 dB scale (FLOOR_DB
/// and quieter is 0, full scale is 255). A dB scale keeps quiet speech visible next to
/// loud parts.
pub fn peaks(samples: &[f32]) -> Vec<u8> {
    let bucket = (SAMPLE_RATE / PEAKS_PER_SECOND) as usize;
    samples
        .chunks(bucket)
        .map(|chunk| {
            let peak = chunk.iter().fold(0.0f32, |m, s| m.max(s.abs()));
            let db = 20.0 * peak.max(1e-6).log10();
            ((db - FLOOR_DB) / -FLOOR_DB)
                .clamp(0.0, 1.0)
                .mul_add(255.0, 0.5) as u8
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_level_per_10_ms_on_a_db_scale() {
        let mut samples = vec![0.0f32; 160]; // silence
        samples.extend(vec![1.0f32; 160]); // full scale
        samples.extend(vec![0.0039f32; 160]); // about -48 dB
        samples.extend(vec![0.0631f32; 160]); // about -24 dB: halfway
        samples.extend(vec![-0.5f32; 80]); // a short last bucket, negative
        let levels = peaks(&samples);
        assert_eq!(levels.len(), 5);
        assert_eq!(levels[0], 0);
        assert_eq!(levels[1], 255);
        assert!(levels[2] <= 1, "{}", levels[2]);
        assert!((126..=130).contains(&levels[3]), "{}", levels[3]);
        assert!((205..=225).contains(&levels[4]), "{}", levels[4]);
    }

    #[test]
    fn empty_audio_has_no_peaks() {
        assert!(peaks(&[]).is_empty());
    }
}
