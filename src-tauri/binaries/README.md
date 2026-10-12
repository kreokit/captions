# FFmpeg sidecar binaries

Release builds bundle `ffmpeg` and `ffprobe` as Tauri sidecars. The sidecar list lives in
`../tauri.release.conf.json`, not in `tauri.conf.json`: Tauri refuses to start, even in
`tauri dev`, when a listed sidecar file is missing.

**Development** uses the FFmpeg installed on your system (found on `PATH`, or set
`KREOKIT_FFMPEG` / `KREOKIT_FFPROBE`). See `src/ffmpeg.rs`.

**Release** expects one binary per target triple in this folder, for example:

```
ffmpeg-x86_64-apple-darwin
ffprobe-x86_64-apple-darwin
ffmpeg-aarch64-apple-darwin
ffprobe-aarch64-apple-darwin
ffmpeg-x86_64-pc-windows-msvc.exe
ffprobe-x86_64-pc-windows-msvc.exe
```

Build with:

```bash
pnpm tauri build --config src-tauri/tauri.release.conf.json
```

The binaries are not committed (see `.gitignore`).

## TODO

- [ ] Pick or produce an **LGPL** FFmpeg build per platform: configured without
      `--enable-gpl` / `--enable-nonfree`, so no libx264, libx265 or other GPL libraries.
      Encoders we rely on: `h264_videotoolbox` (macOS), `h264_mf` (Windows),
      `h264_vaapi` / `libopenh264` (Linux). We also need the `subtitles`/`ass` filters (libass).
- [ ] Add a script (`scripts/fetch-ffmpeg.*`) that downloads those builds, verifies
      checksums and places them here with the right target-triple names.
- [ ] Ship the FFmpeg LGPL licence text and a source-code offer with the app.
- [ ] Call it from the GitHub Actions release workflow (Milestone 6).
