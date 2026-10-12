# KreoKit Captions: build spec for Claude Code

Read this before every task. It is the source of truth for scope and architecture.

## What we are building

A cross-platform desktop app that auto-captions videos **fully offline**:
import video → transcribe with Whisper → edit captions → style → export a burned-in MP4 or SRT/VTT.

Target users: creators worldwide making Reels/TikTok/Shorts, plus NGOs and small businesses. **English is the primary language and must be excellent.** The other 90+ languages Whisper supports are available too, but secondary.

## Hard rules

- **No proprietary code or assets.** Build only from public docs, open-source libraries and observed behaviour. Never copy another product's name, logo, icons or exact UI.
- **Offline first.** No servers, no accounts, no telemetry. The only network call is the one-time model download.
- **Licences must stay MIT/Apache-compatible.** Do not bundle GPL components (see FFmpeg below).
- Small, testable steps. After each milestone: `cargo test`, `pnpm test`, and run the app.

## Stack

- **Shell:** Tauri 2 (Rust backend) + React + TypeScript + Vite (frontend), pnpm
- **Transcription:** `whisper-rs` (bindings to whisper.cpp) with ggml models from Hugging Face, downloaded on first run into the app data dir
  - Model choices in settings: `base` (fast; default in dev builds), `small` (default in releases), `large-v3-turbo` (most accurate, especially for non-English)
  - Language: auto-detect by default
  - Non-speech tags such as `[MUSIC]` or `(applause)` are hidden from captions by default
  - Enable token-level timestamps to get **word timings** for word-highlight styles
  - GPU: Metal on macOS and CUDA/Vulkan where available, CPU fallback
- **Media:** FFmpeg as a Tauri **sidecar** binary
  - Use an **LGPL** FFmpeg build, not GPL. That means no libx264. Encode with platform encoders: `h264_videotoolbox` (macOS), `h264_mf` (Windows), `h264_vaapi`, or `libopenh264` (Linux)
  - Extract audio: 16 kHz mono WAV for Whisper
  - Burn-in: generate an **ASS** subtitle file from our caption model, then use FFmpeg's `subtitles`/`ass` filter
- **State:** Zustand on the frontend. Project files are saved as JSON (`.kreocap`)

## Data model (Rust + TS mirror)

```
Project { video_path, language, model, segments: Segment[], style: Style }
Segment { id, start_ms, end_ms, text, words: Word[] }
Word    { start_ms, end_ms, text }
Style   { font_family, font_size, color, highlight_color, outline_color,
          outline_width, position: "bottom" | "middle" | "top",
          max_chars_per_line, max_lines, mode: "line" | "word_highlight" | "one_word" }
```

## Screens (v0.1)

1. **Home:** drop zone for a video, recent projects
2. **Transcribe:** language (auto-detect by default / en / …), model picker, progress bar, cancel
3. **Editor:** video player with a live caption overlay rendered in HTML/CSS, matching the ASS output; segment list with editable text and start/end times; split/merge; click a segment to seek
4. **Style panel:** presets plus manual controls, previewed live
5. **Export:** MP4 (burned-in) / SRT / VTT, output folder, progress

## Milestones

1. **Scaffold:** Tauri 2 + React app runs on macOS and Windows; FFmpeg sidecar wired; "probe video" command returns duration and resolution
2. **Transcribe:** audio extraction → whisper-rs → `Segment[]` with word timings; model download with progress; progress events to the UI
3. **Editor:** player + overlay + editable segment list; save/load `.kreocap`
4. **Export subtitles:** SRT/VTT writers plus an SRT parser (for round-trip tests)
5. **Style + burn-in:** Style → ASS generator (including word-highlight using `\k`/override tags); FFmpeg burn-in export with progress
6. **Release:** GitHub Actions matrix build (Windows, macOS, Linux) → unsigned artifacts on GitHub Releases

## Tests (our oracle)

- `fixtures/` holds short clips with **hand-checked reference transcripts**. English clips are required (`fixtures/en/`; `scripts/make-fixtures.sh` generates a synthetic one); clips in other languages are optional
- Transcription accuracy: word error rate under a threshold per model, logged rather than strictly enforced at first
- SRT/VTT: write → parse → compare round-trip; timestamp formatting edge cases (00:00:00,000, over 1 hour)
- ASS generator: snapshot tests per style mode
- Export: the burned-in MP4 has the same duration and resolution as the input (ffprobe)

## Dev environments to support

- macOS 12 Monterey (Intel or Apple Silicon): check Tauri 2 / WebView compatibility early
- Windows 10/11
