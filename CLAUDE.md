# KreoKit Captions: build spec for Claude Code

Read this before every task. It is the source of truth for scope and architecture.

**Status (2026-10-15):** Milestones 1–6 and the UI redesign are done. v0.1.2-alpha (fixes the crash when transcribing on macOS 12–13.2; free caption positioning came in 0.1.1) is published as a pre-release: <https://github.com/kreokit/captions/releases/tag/v0.1.2-alpha>. Next work comes from the backlog and tester feedback (issues).

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
  - CPU only in v0.1 (all platforms). Release builds use `GGML_NATIVE=OFF`, and on macOS Accelerate's classic `cblas_sgemm` (see Release lessons); x86-64 needs AVX2/FMA/F16C, checked at startup (`src-tauri/src/cpu.rs`). GPU (Metal, CUDA/Vulkan) is in the backlog
- **Media:** FFmpeg as a Tauri **sidecar** binary
  - Use an **LGPL** FFmpeg build, not GPL. That means no libx264. Encode with platform encoders: `h264_videotoolbox` (macOS), `h264_mf` (Windows), `libopenh264` (Linux, and Windows fallback); libx264 only in debug builds
  - Release sidecars: FFmpeg 9.0.2. BtbN LGPL builds (Windows/Linux), built from source in CI (macOS). Exact sources in `src-tauri/binaries/README.md`; `scripts/verify_ffmpeg.py` enforces LGPL + features
  - Extract audio: 16 kHz mono WAV for Whisper
  - Burn-in: generate an **ASS** subtitle file from our caption model, then use FFmpeg's `subtitles`/`ass` filter
- **Fonts:** caption fonts (Inter, Montserrat, Poppins, Bebas Neue; OFL) bundled in `src-tauri/resources/fonts`; the preview and the burn-in export use the same files
- **State:** Zustand on the frontend. Project files are saved as JSON (`.kreocap`, with a format version)

## Data model (Rust + TS mirror)

```
Project { video_path, language, model, segments: Segment[], style: Style }
Segment { id, start_ms, end_ms, text, words: Word[] }
Word    { start_ms, end_ms, text }
Style   { font_family, font_size, color, highlight_color, outline_color,
          outline_width, position: "bottom" | "middle" | "top",
          max_chars_per_line, max_lines, mode: "line" | "word_highlight" | "one_word",
          bold, uppercase, animation: "none" | "pop" }
```

## Screens (v0.1)

1. **Home:** drop zone for a video, recent projects (with thumbnails)
2. **Transcribe:** language (auto-detect by default / en / …), model picker, progress bar, cancel
3. **Editor:** video player with a live caption overlay rendered in HTML/CSS, matching the ASS output; segment list with editable text and start/end times; split/merge; click a segment to seek
4. **Style panel:** presets plus manual controls, previewed live
5. **Export:** MP4 (burned-in) / SRT / VTT, output folder, progress

## Milestones

1. ✅ **Scaffold:** Tauri 2 + React app runs on macOS and Windows; FFmpeg sidecar wired; "probe video" command returns duration and resolution
2. ✅ **Transcribe:** audio extraction → whisper-rs → `Segment[]` with word timings; model download with progress; progress events to the UI
3. ✅ **Editor:** player + overlay + editable segment list; save/load `.kreocap`
4. ✅ **Export subtitles:** SRT/VTT writers plus an SRT parser (for round-trip tests)
5. ✅ **Style + burn-in:** Style → ASS generator (including word-highlight using `\k`/override tags); FFmpeg burn-in export with progress
6. ✅ **Release:** GitHub Actions matrix build (Windows, macOS, Linux) → unsigned artifacts on GitHub Releases (`.github/workflows/release.yml`)

✅ **UI redesign:** flat dark design system, UI kit, timeline with waveform, Home + Transcribe dialog, bundled caption fonts.

## Backlog

Not scheduled in a milestone yet:

- **Undo / redo** for caption edits
- **Prompt on window close** with unsaved changes (today only the editor's Home button asks)
- **MKV / AVI preview:** WebKit can't play them; make a lightweight preview copy with FFmpeg
- **Metal on Apple Silicon:** enable whisper-rs `metal` + `use_gpu` for aarch64-apple-darwin once it can be tested on an M-series Mac (`TODO(metal)` in `src-tauri/src/transcribe.rs`)
- **Slimmer Windows/Linux FFmpeg:** the BtbN executables are ~130 MB each; build a minimal LGPL FFmpeg with only what we use

## Reusable for the next KreoKit apps

Copy these into a new app (same stack) instead of rebuilding them:

- **Design tokens:** `src/styles/tokens.css` (flat dark palette, lime accent, type, spacing, radii) and `src/styles/base.css`. Rules: lime only for primary/active/focus/playhead/highlight, never large areas
- **UI kit:** `src/ui/` (buttons, menus, context menus, select, slider, color picker, switch, checkbox, segmented, tabs, dialog, toasts, tooltip) with tested logic in `src/ui/logic.ts`; Inter bundled via `@fontsource-variable/inter`, icons from `lucide-react`
- **App shell:** macOS overlay title bar (`src-tauri/tauri.macos.conf.json`, drag regions, `platform-mac`), top bar, Home drop zone + recent projects (`src-tauri/src/recent.rs`), unsupported-CPU dialog
- **Fonts:** `src-tauri/resources/fonts` (OFL fonts + licence files) and `src/styles/caption-fonts.css`; same files for preview and FFmpeg/libass (`fontsdir`)
- **FFmpeg sidecar setup:** `src-tauri/src/ffmpeg.rs` (locate dev/sidecar binaries), `scripts/fetch_ffmpeg.py`, `scripts/build-ffmpeg-macos.sh`, `scripts/verify_ffmpeg.py`, `src-tauri/binaries/README.md`, encoder allow-list + fallback in `src-tauri/src/burn.rs`
- **Release workflow:** `.github/workflows/release.yml` (4-target matrix, draft pre-release, ad-hoc macOS signing, whisper CPU baseline, macOS binary check `scripts/check_macos_binary.py`, `--self-test`), `tauri.release.conf.json`, release-notes template in `docs/release-notes/`
- **Licence checks:** `src-tauri/deny.toml` (cargo-deny), `scripts/third_party.py` + `scripts/third-party-header.md` → `THIRD-PARTY-LICENSES.md` (CI `--check`)
- **Feedback:** `.github/ISSUE_TEMPLATE/` and the in-app "Report a problem" command

## Tests (our oracle)

- `fixtures/` holds short clips with **hand-checked reference transcripts**. English clips are required (`fixtures/en/`; `scripts/make-fixtures.sh` generates a synthetic one); clips in other languages are optional
- Transcription accuracy: word error rate under a threshold per model, logged rather than strictly enforced at first
- SRT/VTT: write → parse → compare round-trip; timestamp formatting edge cases (00:00:00,000, over 1 hour)
- Line layout: `fixtures/layout-cases.json`, shared by the Rust and TypeScript implementations so preview and exports break lines identically
- ASS generator: snapshot tests per style mode
- Export: the burned-in MP4 has the same duration and resolution as the input (ffprobe)

## Release lessons

- **Release builds use a newer SDK than dev builds; weak imports can crash on older macOS.** CI builds with the runner's SDK (15.x); this Mac has SDK 13.1. A system function newer than the minimum macOS (12.0) is weak-imported and is NULL on older macOS, so calling it jumps to address 0 (`EXC_BAD_ACCESS`, `rip = 0`). 0.1.0 and 0.1.1 crashed on macOS 12 when transcribing this way: whisper.cpp's BLAS backend called Accelerate's `cblas_sgemm$NEWLAPACK$ILP64` (macOS 13.3+). Local builds never showed it, and neither can the macOS 15 runners. Fix: the macOS release builds set `CXXFLAGS=-UACCELERATE_NEW_LAPACK -UACCELERATE_LAPACK_ILP64`, so the classic `cblas_sgemm` (every macOS) is linked, as in dev builds. (`GGML_BLAS=OFF` doesn't link with whisper-rs-sys 0.15 and was 1.5× slower.) whisper-rs-sys doesn't rebuild when `GGML_*`/`CXXFLAGS` change, so change the rust-cache key with them. Guard: `scripts/check_macos_binary.py` (no weak imports, minimum macOS ≤ 12.0) runs on the app and its FFmpeg sidecars in the release workflow
- **Test the shipped binary, not a dev build.** `captions --self-test <clip> [--reference <txt>] [--models <dir>]` (`src-tauri/src/selftest.rs`, hidden, starts no window) transcribes with the base model inside the release binary; the release workflow runs it on all four targets
- Run the full test suite after a version bump

## Release checklist

- After publishing, update the kreokit/.github profile README row.

## Dev environments to support

- macOS 12 Monterey (Intel or Apple Silicon): check Tauri 2 / WebView compatibility early
- Windows 10/11
