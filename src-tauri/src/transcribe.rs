//! Speech-to-text with whisper.cpp (via whisper-rs), producing segments with word timings.
//!
//! Runs on the CPU. ggml's Metal backend needs simdgroup support (Apple7 GPU family or
//! Metal 3) for its fast paths, which Intel Macs on macOS 12 lack, so Metal would mostly fall
//! back to the CPU anyway. TODO: enable the `metal` feature for Apple Silicon builds.

use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;
use whisper_rs::{
    DtwMode, DtwModelPreset, DtwParameters, FullParams, SamplingStrategy, WhisperContext,
    WhisperContextParameters,
};

use crate::model::{Segment, Word};
use crate::models::{CANCELLED, WhisperModel};

#[derive(Debug, Clone, Serialize)]
pub struct Transcript {
    /// Detected (or requested) language code, e.g. "sq".
    pub language: String,
    pub segments: Vec<Segment>,
}

/// `language`: a Whisper language code, or `None` to auto-detect.
/// `on_progress` receives 0–100. Returns [`CANCELLED`] if `cancel` is set.
pub fn transcribe(
    model: WhisperModel,
    model_path: &Path,
    samples: &[f32],
    language: Option<&str>,
    cancel: Arc<AtomicBool>,
    on_progress: impl FnMut(i32) + 'static,
) -> Result<Transcript, String> {
    // Routes whisper.cpp's console logging into the (silent) `log` facade.
    whisper_rs::install_logging_hooks();

    let mut ctx_params = WhisperContextParameters::default();
    ctx_params.use_gpu(false);
    ctx_params.dtw_parameters(DtwParameters {
        mode: DtwMode::ModelPreset {
            model_preset: dtw_preset(model),
        },
        ..DtwParameters::default()
    });
    let ctx = WhisperContext::new_with_params(model_path, ctx_params)
        .map_err(|e| format!("cannot load model {}: {e}", model_path.display()))?;
    let mut state = ctx.create_state().map_err(|e| e.to_string())?;

    // Same as whisper.cpp's default greedy params; beam search is ~3x slower on CPU.
    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 5 });
    params.set_n_threads(thread_count());
    params.set_language(Some(language.unwrap_or("auto")));
    params.set_translate(false);
    params.set_token_timestamps(true);
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    params.set_progress_callback_safe(on_progress);
    let abort = cancel.clone();
    // whisper-rs 0.16 calls the closure as `F` but stores it as `Box<dyn FnMut>`, so `F`
    // must itself be that box type for the call to be sound.
    params.set_abort_callback_safe::<_, Box<dyn FnMut() -> bool>>(Box::new(move || {
        abort.load(Ordering::Relaxed)
    })
        as Box<dyn FnMut() -> bool>);

    let result = state.full(params, samples);
    if cancel.load(Ordering::Relaxed) {
        return Err(CANCELLED.to_string());
    }
    result.map_err(|e| format!("transcription failed: {e}"))?;

    let eot = ctx.token_eot();
    let mut segments = Vec::new();
    let mut prev_end_ms = 0;
    for seg in state.as_iter() {
        let text = seg
            .to_bytes()
            .map(|b| String::from_utf8_lossy(b).trim().to_string())
            .unwrap_or_default();
        if text.is_empty() {
            continue;
        }
        let tokens: Vec<RawToken> = (0..seg.n_tokens())
            .filter_map(|t| seg.get_token(t))
            .filter(|tok| tok.token_id() < eot) // drop special and timestamp tokens
            .map(|tok| {
                let data = tok.token_data();
                RawToken {
                    bytes: tok.to_bytes().unwrap_or_default().to_vec(),
                    start_ms: centis_to_ms(data.t0),
                    end_ms: centis_to_ms(data.t1),
                    dtw_ms: (data.t_dtw >= 0).then(|| centis_to_ms(data.t_dtw)),
                }
            })
            .collect();
        let words = align_words(group_tokens(&tokens), &mut prev_end_ms);
        let (start_ms, end_ms) = match (words.first(), words.last()) {
            (Some(first), Some(last)) => (first.start_ms, last.end_ms),
            _ => (
                centis_to_ms(seg.start_timestamp()),
                centis_to_ms(seg.end_timestamp()),
            ),
        };
        segments.push(Segment {
            id: segments.len() as u32,
            start_ms,
            end_ms,
            text,
            words,
        });
    }

    let language = whisper_rs::get_lang_str(state.full_lang_id_from_state())
        .map(str::to_string)
        .or_else(|| language.map(str::to_string))
        .unwrap_or_else(|| "auto".into());
    Ok(Transcript { language, segments })
}

fn thread_count() -> i32 {
    std::thread::available_parallelism()
        .map(|n| n.get().min(8) as i32)
        .unwrap_or(4)
}

/// Whisper timestamps are in 10 ms units.
fn centis_to_ms(t: i64) -> u64 {
    (t.max(0) as u64) * 10
}

#[derive(Debug, Clone)]
struct RawToken {
    bytes: Vec<u8>,
    start_ms: u64,
    end_ms: u64,
    /// DTW-aligned time of the token, when available.
    dtw_ms: Option<u64>,
}

/// Attention heads used for DTW alignment differ per model.
fn dtw_preset(model: WhisperModel) -> DtwModelPreset {
    match model {
        WhisperModel::Base => DtwModelPreset::Base,
        WhisperModel::Small => DtwModelPreset::Small,
        WhisperModel::LargeV3Turbo => DtwModelPreset::LargeV3Turbo,
    }
}

/// A word with whisper's classic timestamps and the DTW time of its last token.
#[derive(Debug, Clone, PartialEq)]
struct WordDraft {
    text: String,
    start_ms: u64,
    end_ms: u64,
    dtw_end_ms: Option<u64>,
}

/// Groups subword tokens into words. A token starting with a space begins a new word;
/// others (word pieces, punctuation) attach to the current one. Bytes are joined before
/// decoding because a token can end in the middle of a multi-byte character (ë, Cyrillic).
fn group_tokens(tokens: &[RawToken]) -> Vec<WordDraft> {
    let mut groups: Vec<(Vec<u8>, u64, u64, Option<u64>)> = Vec::new();
    for tok in tokens {
        match groups.last_mut() {
            Some((bytes, _, end, dtw)) if !tok.bytes.starts_with(b" ") => {
                bytes.extend_from_slice(&tok.bytes);
                *end = tok.end_ms;
                *dtw = tok.dtw_ms.or(*dtw);
            }
            _ => groups.push((tok.bytes.clone(), tok.start_ms, tok.end_ms, tok.dtw_ms)),
        }
    }
    groups
        .into_iter()
        .filter_map(|(bytes, start_ms, end_ms, dtw_end_ms)| {
            let text = String::from_utf8_lossy(&bytes).trim().to_string();
            (!text.is_empty()).then_some(WordDraft {
                text,
                start_ms,
                end_ms,
                dtw_end_ms,
            })
        })
        .collect()
}

/// Final word timings. Whisper's classic token timestamps drift (on our fixture they were
/// up to 1 s early), while the DTW time of a word's last token tracks where the word ends
/// to within ~0.3 s. So: end = DTW time; start = the previous word's end, or the end minus
/// the word's classic duration, whichever is later. Without DTW the classic times are kept.
/// Times never go backwards; `prev_end_ms` carries across segments.
fn align_words(drafts: Vec<WordDraft>, prev_end_ms: &mut u64) -> Vec<Word> {
    drafts
        .into_iter()
        .map(|d| {
            let (start_ms, end_ms) = match d.dtw_end_ms {
                Some(dtw_end) => {
                    let end = dtw_end.max(*prev_end_ms);
                    let duration = d.end_ms.saturating_sub(d.start_ms);
                    (end.saturating_sub(duration).max(*prev_end_ms), end)
                }
                None => {
                    let start = d.start_ms.max(*prev_end_ms);
                    (start, d.end_ms.max(start))
                }
            };
            *prev_end_ms = end_ms;
            Word {
                start_ms,
                end_ms,
                text: d.text,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tok(bytes: &[u8], start_ms: u64, end_ms: u64) -> RawToken {
        RawToken {
            bytes: bytes.to_vec(),
            start_ms,
            end_ms,
            dtw_ms: None,
        }
    }

    fn draft(text: &str, start_ms: u64, end_ms: u64, dtw_end_ms: Option<u64>) -> WordDraft {
        WordDraft {
            text: text.into(),
            start_ms,
            end_ms,
            dtw_end_ms,
        }
    }

    fn word(text: &str, start_ms: u64, end_ms: u64) -> Word {
        Word {
            start_ms,
            end_ms,
            text: text.into(),
        }
    }

    #[test]
    fn groups_subword_tokens_and_punctuation() {
        let mut tokens = [
            tok(b" Hel", 0, 200),
            tok(b"lo", 200, 400),
            tok(b",", 400, 420),
            tok(b" world", 500, 900),
            tok(b".", 900, 950),
        ];
        tokens[1].dtw_ms = Some(380);
        assert_eq!(
            group_tokens(&tokens),
            [
                draft("Hello,", 0, 420, Some(380)),
                draft("world.", 500, 950, None)
            ]
        );
    }

    #[test]
    fn joins_multibyte_characters_split_across_tokens() {
        // "Здраво" (Macedonian), with "З" (0xD0 0x97) split between two tokens.
        let tokens = [
            tok(b" \xD0", 0, 100),
            tok(b"\x97\xD0\xB4\xD1\x80\xD0\xB0\xD0\xB2\xD0\xBE", 100, 600),
        ];
        assert_eq!(group_tokens(&tokens), [draft("Здраво", 0, 600, None)]);
    }

    #[test]
    fn first_token_without_space_starts_a_word() {
        let tokens = [tok(b"Faleminderit", 0, 800), tok(b"!", 800, 850)];
        assert_eq!(
            group_tokens(&tokens),
            [draft("Faleminderit!", 0, 850, None)]
        );
    }

    #[test]
    fn skips_blank_tokens() {
        assert_eq!(group_tokens(&[tok(b" ", 0, 10)]), []);
    }

    #[test]
    fn aligns_words_to_dtw_ends() {
        // Times from the English fixture: classic timestamps start at 0, speech at 1040 ms.
        let drafts = vec![
            draft("Welcome", 0, 550, Some(1340)),
            draft("to", 550, 710, Some(1560)),
            draft("the", 950, 950, Some(2060)),
        ];
        let mut prev_end = 0;
        assert_eq!(
            align_words(drafts, &mut prev_end),
            [
                word("Welcome", 790, 1340),
                word("to", 1400, 1560),
                word("the", 2060, 2060)
            ]
        );
        assert_eq!(prev_end, 2060);
    }

    #[test]
    fn word_after_a_pause_starts_after_the_gap() {
        // "every" follows a pause: its start comes from its own duration, not "dog,".
        let drafts = vec![draft("every", 5220, 5400, Some(5820))];
        let mut prev_end = 5340;
        assert_eq!(
            align_words(drafts, &mut prev_end),
            [word("every", 5640, 5820)]
        );
    }

    #[test]
    fn timings_never_go_backwards() {
        let drafts = vec![
            draft("a", 0, 300, Some(900)),
            draft("b", 300, 500, Some(700)), // DTW earlier than the previous word
            draft("c", 400, 600, None),      // no DTW, classic time also too early
        ];
        let mut prev_end = 0;
        assert_eq!(
            align_words(drafts, &mut prev_end),
            [
                word("a", 600, 900),
                word("b", 900, 900),
                word("c", 900, 900)
            ]
        );
    }

    #[test]
    fn converts_centiseconds() {
        assert_eq!(centis_to_ms(123), 1_230);
        assert_eq!(centis_to_ms(-1), 0);
    }

    /// Transcribes fixtures/en/hello.mp4 with the base model and checks the word error
    /// rate against the reference transcript. Needs ffmpeg and the base model:
    /// `cargo test downloads_base_model -- --ignored` first, then
    /// `cargo test transcribes_english_fixture -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn transcribes_english_fixture() {
        use crate::models::tests::dev_models_dir;

        let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("../fixtures/en");
        let reference = std::fs::read_to_string(fixtures.join("hello.txt")).unwrap();
        let model = WhisperModel::Base.path_in(&dev_models_dir());
        assert!(model.is_file(), "base model missing at {}", model.display());

        let samples = crate::audio::extract_audio(&fixtures.join("hello.mp4")).unwrap();
        let started = std::time::Instant::now();
        let transcript = transcribe(
            WhisperModel::Base,
            &model,
            &samples,
            None,
            Arc::new(AtomicBool::new(false)),
            |_| {},
        )
        .unwrap();
        let elapsed = started.elapsed();

        let hypothesis: Vec<&str> = transcript
            .segments
            .iter()
            .map(|s| s.text.as_str())
            .collect();
        let hypothesis = hypothesis.join(" ");
        let wer = crate::wer::word_error_rate(&reference, &hypothesis);
        println!("language:   {}", transcript.language);
        println!("reference:  {}", reference.trim());
        println!("hypothesis: {hypothesis}");
        println!(
            "WER (base): {wer:.3}, took {elapsed:.1?} for {:.1}s of audio",
            samples.len() as f64 / crate::audio::SAMPLE_RATE as f64
        );

        for w in transcript.segments.iter().flat_map(|s| &s.words) {
            println!("  {:>5}–{:>5} ms  {}", w.start_ms, w.end_ms, w.text);
        }

        assert_eq!(transcript.language, "en");
        assert!(wer < 0.3, "WER {wer:.3} is too high");

        // Speech intervals of hello.mp4 measured with ffmpeg's silencedetect (see
        // scripts/make-fixtures.sh); captions should start and end within 0.35 s of them.
        let speech_ms = [(1_041, 2_647), (2_898, 5_347), (5_588, 8_254)];
        let words: Vec<&Word> = transcript.segments.iter().flat_map(|s| &s.words).collect();
        let sentence_ranges = [("welcome", "test"), ("the", "dog"), ("every", "captions")];
        let mut from = 0;
        for ((first, last), (speech_start, speech_end)) in
            sentence_ranges.into_iter().zip(speech_ms)
        {
            let starts = |w: &&Word, prefix: &str| w.text.to_lowercase().starts_with(prefix);
            let i = from + words[from..].iter().position(|w| starts(w, first)).unwrap();
            let j = i + words[i..].iter().position(|w| starts(w, last)).unwrap();
            from = j + 1;
            let (start, end) = (words[i].start_ms, words[j].end_ms);
            println!(
                "sentence {first}…{last}: {start}–{end} ms, speech {speech_start}–{speech_end} ms"
            );
            assert!(
                start.abs_diff(speech_start) <= 350,
                "{first} starts at {start} ms, speech at {speech_start} ms"
            );
            assert!(
                end.abs_diff(speech_end) <= 350,
                "{last} ends at {end} ms, speech at {speech_end} ms"
            );
        }

        // Word timings are ordered and lie within their segment.
        for seg in &transcript.segments {
            assert!(!seg.words.is_empty(), "segment without words: {seg:?}");
            for w in &seg.words {
                assert!(w.start_ms <= w.end_ms, "{w:?}");
                assert!(
                    w.start_ms >= seg.start_ms && w.end_ms <= seg.end_ms,
                    "{w:?} outside {seg:?}"
                );
            }
        }
    }
}
