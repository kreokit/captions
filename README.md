# KreoKit Captions

**Free, offline auto-captions for your videos.** Drop in a video, get accurate captions in seconds, style them, and export, with no watermark, no account and no upload.

Part of [KreoKit](https://github.com/kreokit), free open-source creator tools.

## Features (v0.1)

- 🎙️ **Auto-transcription** that runs locally with Whisper, in 90+ languages including Albanian, Macedonian and English
- ✏️ **Caption editor** to fix words, split and merge lines, and adjust timing
- 🎨 **Styles**: font, size, colour, outline, position, and word-by-word highlight for Reels and TikTok
- 📤 **Export** as an MP4 with burned-in captions, or as `.srt` / `.vtt` files
- 🔒 **Private**: your video never leaves your computer

## Install

Download the latest build for Windows, macOS or Linux from [Releases](../../releases).

> Early alpha builds are unsigned. On macOS, right-click the app and choose **Open**. On Windows, click **More info → Run anyway**.

The first launch downloads a speech model (~150 MB–1.5 GB depending on the quality you pick).

## Build from source

Requirements: Rust (stable), Node.js 20+, pnpm, FFmpeg.

```bash
git clone https://github.com/kreokit/captions
cd captions
pnpm install
pnpm tauri dev
```

## Roadmap

- [ ] v0.1: transcribe, edit, style, export
- [ ] v0.2: caption style presets and templates
- [ ] v0.3: translate captions to another language
- [ ] v0.4: batch processing

## License

Dual-licensed under [MIT](LICENSE-MIT) or [Apache 2.0](LICENSE-APACHE), at your option.

Implemented from public specifications, open-source libraries and observed behaviour only. Not affiliated with any company whose products are mentioned as alternatives.
