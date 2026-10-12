# Third-party licences

KreoKit Captions is free software, dual-licensed under MIT or Apache-2.0. It includes or
uses the third-party components below, each under its own licence. The full licence texts
ship with the app (the `licenses` and `fonts` folders) and are linked here.

## FFmpeg (bundled program)

KreoKit Captions bundles `ffmpeg` and `ffprobe` from **FFmpeg 9.0.2** as separate programs
(sidecars); the app runs them, it does not link to them.

- Licence: **GNU Lesser General Public License** (LGPL-2.1-or-later for the macOS builds,
  LGPL-3.0-or-later for the Windows and Linux builds). No GPL or non-free components are
  enabled. Full text: `licenses/FFMPEG-LICENSE.txt` in the app, and
  <https://www.gnu.org/licenses/lgpl-3.0.html>.
- Source code: FFmpeg <https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz>. The exact
  builds, their sources and SHA-256 checksums are listed in
  [src-tauri/binaries/README.md](src-tauri/binaries/README.md):
  - Windows / Linux: BtbN FFmpeg-Builds, LGPL variant, release `autobuild-2026-09-30-13-08`
    (revision `n9.0.2-17-g2a571b6068`), <https://github.com/BtbN/FFmpeg-Builds>
  - macOS: built from source by `scripts/build-ffmpeg-macos.sh` in this repository
- You may replace the bundled FFmpeg with your own build: put it next to the app's
  executable under the same name, or point `KREOKIT_FFMPEG` / `KREOKIT_FFPROBE` at it.

Libraries built into the bundled FFmpeg include:

| Library | Licence | Source |
|---|---|---|
| libass | ISC | <https://github.com/libass/libass> |
| FreeType | FreeType Licence (FTL) | <https://freetype.org> |
| FriBidi | LGPL-2.1-or-later | <https://github.com/fribidi/fribidi> |
| HarfBuzz | MIT ("Old MIT") | <https://github.com/harfbuzz/harfbuzz> |
| Fontconfig (Windows / Linux builds) | MIT-style | <https://www.freedesktop.org/wiki/Software/fontconfig/> |
| OpenH264 (Windows / Linux builds) | BSD-2-Clause | <https://github.com/cisco/openh264> |

The Windows and Linux builds contain further LGPL-compatible libraries enabled by BtbN's
LGPL variant; the complete list is in `ffmpeg -buildconf` and in BtbN's build scripts.

Portions of this software are copyright © The FreeType Project (https://freetype.org).
All rights reserved.

OpenH264 in the Windows and Linux FFmpeg builds is compiled from source. Its BSD licence
covers the code; Cisco's H.264 patent licence applies only to binaries distributed by
Cisco, so it does not extend to this build. KreoKit uses OpenH264 only when the platform's
own H.264 encoder (Media Foundation on Windows) is not available.

## whisper.cpp and ggml (compiled into the app)

Speech recognition uses whisper.cpp and ggml (via the whisper-rs crates), © the
ggml / whisper.cpp authors, **MIT** licence: <https://github.com/ggml-org/whisper.cpp>.

## Whisper models (downloaded on first use, not bundled)

The ggml Whisper models are downloaded from <https://huggingface.co/ggerganov/whisper.cpp>
the first time they are needed. They are converted from OpenAI's Whisper models, released
under the **MIT** licence: <https://github.com/openai/whisper>.

## Fonts (bundled)

All under the **SIL Open Font License 1.1**; licence files ship next to the fonts.

| Font | Use | Copyright | Licence file |
|---|---|---|---|
| Inter | interface and captions | © The Inter Project Authors | `Inter-OFL.txt`, `OFL-Inter.txt` |
| Montserrat | captions | © The Montserrat Project Authors | `OFL-Montserrat.txt` |
| Poppins | captions | © The Poppins Project Authors | `OFL-Poppins.txt` |
| Bebas Neue | captions | © Dharma Type | `OFL-BebasNeue.txt` |

## Icons

Lucide icons, © Lucide contributors, **ISC** licence: <https://lucide.dev>.
