<p align="center">
  <img src="assets/brand/kreokit-logo-wide.png" alt="KreoKit" width="420">
</p>

# KreoKit Captions

**Free, offline auto-captions for your videos.** Drop in a video, get accurate captions in seconds, style them, and export, with no watermark, no account and no upload.

Part of [KreoKit](https://github.com/kreokit), free open-source creator tools.

## Download

**[Get the latest version from Releases →](https://github.com/kreokit/captions/releases)** (currently [v0.1.2-alpha](https://github.com/kreokit/captions/releases/tag/v0.1.2-alpha), an early test version)

| Your computer | Download |
|---|---|
| Mac with Apple Silicon (M1, M2, M3, M4…) | [KreoKit.Captions_0.1.2_aarch64.dmg](https://github.com/kreokit/captions/releases/download/v0.1.2-alpha/KreoKit.Captions_0.1.2_aarch64.dmg) |
| Mac with Intel processor | [KreoKit.Captions_0.1.2_x64.dmg](https://github.com/kreokit/captions/releases/download/v0.1.2-alpha/KreoKit.Captions_0.1.2_x64.dmg) |
| Windows 10 / 11 | [KreoKit.Captions_0.1.2_x64-setup.exe](https://github.com/kreokit/captions/releases/download/v0.1.2-alpha/KreoKit.Captions_0.1.2_x64-setup.exe) |
| Linux (any distribution) | [KreoKit.Captions_0.1.2_amd64.AppImage](https://github.com/kreokit/captions/releases/download/v0.1.2-alpha/KreoKit.Captions_0.1.2_amd64.AppImage) |
| Linux (Debian / Ubuntu) | [KreoKit.Captions_0.1.2_amd64.deb](https://github.com/kreokit/captions/releases/download/v0.1.2-alpha/KreoKit.Captions_0.1.2_amd64.deb) |

Not sure which Mac you have? Apple menu → **About This Mac**: "Chip: Apple M…" means Apple Silicon, "Processor: Intel…" means Intel.

### System requirements

- **macOS 12 Monterey** or later, **Windows 10 / 11** (64-bit), or **Linux** with glibc 2.35+ (e.g. Ubuntu 22.04+)
- On Intel / AMD computers, a processor with **AVX2** (most Intel CPUs from 2013 and AMD CPUs from 2015 on). The app tells you if yours isn't supported.
- Disk space for a speech model, downloaded once on first use: 150 MB (fast) to 1.6 GB (most accurate)

### Installing (the alpha isn't signed yet)

**macOS:** open the `.dmg` and drag **KreoKit Captions** to Applications, then open it. If macOS says it can't verify the app, go to **System Settings → Privacy & Security**, scroll down and click **Open Anyway**. If it says the app "is damaged", run this once in Terminal and open it again:

```bash
xattr -dr com.apple.quarantine "/Applications/KreoKit Captions.app"
```

**Windows:** run the installer. If SmartScreen says "Windows protected your PC", click **More info → Run anyway**.

**Linux:** make the AppImage executable and run it:

```bash
chmod +x KreoKit.Captions_*.AppImage
./KreoKit.Captions_*.AppImage
```

or install the `.deb`: `sudo apt install ./KreoKit.Captions_*_amd64.deb`.

Found a problem? [Report it here](https://github.com/kreokit/captions/issues/new/choose), or use **⋯ → Report a problem** in the app.

## Features

- 🎙️ **Auto-transcription** that runs locally with Whisper: English first, plus 90+ other languages, with **custom words** for names and brands
- ✏️ **Caption editor**: fix words, split and merge, and drag captions on a **timeline** with the audio waveform
- 🎨 **Styles**: presets (Clean subtitle, Bold highlight, One-word pop) or your own font, size, colours, outline, position and line layout, with **word-by-word highlight** for Reels, TikTok and Shorts
- 📤 **Export** an MP4 with burned-in captions, or `.srt` / `.vtt` / styled `.ass` subtitles
- 🔒 **Private**: your video never leaves your computer

## Build from source

Requirements: Rust (stable), Node.js 20+, pnpm, FFmpeg, CMake (to build whisper.cpp).

```bash
git clone https://github.com/kreokit/captions
cd captions
pnpm install
pnpm tauri dev
```

Release builds are made by [GitHub Actions](.github/workflows/release.yml) with LGPL FFmpeg sidecars (see [src-tauri/binaries/README.md](src-tauri/binaries/README.md)).

## Roadmap

- [x] v0.1 (alpha): transcribe, edit, style, export
- [ ] v0.2: more caption style presets and templates
- [ ] v0.3: translate captions to another language
- [ ] v0.4: batch processing

## License

Dual-licensed under [MIT](LICENSE-MIT) or [Apache 2.0](LICENSE-APACHE), at your option. Third-party components (FFmpeg under the LGPL, fonts under the SIL OFL, and more) are listed in [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md).

Implemented from public specifications, open-source libraries and observed behaviour only. Not affiliated with any company whose products are mentioned as alternatives.
