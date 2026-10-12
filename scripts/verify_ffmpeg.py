#!/usr/bin/env python3
"""Checks the bundled ffmpeg/ffprobe sidecars for one target before they ship.

    python3 scripts/verify_ffmpeg.py <rust-target-triple>

Fails unless:
- the build is LGPL: no --enable-gpl / --enable-nonfree / libx264 / libx265 in its
  configuration, and `ffmpeg -L` prints the GNU Lesser General Public License
- the ass filter and at least one encoder KreoKit allows in release builds exist
- (macOS) the executables run on macOS 12
- a 1-second clip with a caption in the bundled Montserrat burns and probes correctly,
  trying the allowed encoders in the app's order (src-tauri/src/burn.rs)
"""

import json
import platform
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BINARIES = ROOT / "src-tauri" / "binaries"
FONTS = ROOT / "src-tauri" / "resources" / "fonts"

# Mirrors allowed_encoders(false) in src-tauri/src/burn.rs.
ALLOWED = {
    "darwin": ["h264_videotoolbox", "libopenh264"],
    "windows": ["h264_mf", "libopenh264"],
    "linux": ["libopenh264"],
}
FORBIDDEN_CONFIG = ["--enable-gpl", "--enable-nonfree", "--enable-libx264", "--enable-libx265"]

ASS = """[Script Info]
ScriptType: v4.00+
PlayResX: 640
PlayResY: 360

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Montserrat,40,&H0035F1C8,&H0035F1C8,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,3,0,2,20,20,30,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,KreoKit release check
"""


def run(*args: str, cwd: Path | None = None) -> str:
    result = subprocess.run(args, capture_output=True, text=True, cwd=cwd)
    if result.returncode != 0:
        raise RuntimeError(f"{' '.join(args[:3])}… failed:\n{result.stderr[-2000:]}")
    return result.stdout + result.stderr


def fail(message: str) -> None:
    sys.exit(f"FAIL: {message}")


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    triple = sys.argv[1]
    exe = ".exe" if "windows" in triple else ""
    os_name = "darwin" if "apple" in triple else "windows" if "windows" in triple else "linux"
    ffmpeg = BINARIES / f"ffmpeg-{triple}{exe}"
    ffprobe = BINARIES / f"ffprobe-{triple}{exe}"
    for tool in (ffmpeg, ffprobe):
        if not tool.is_file():
            fail(f"missing {tool.relative_to(ROOT)}; run scripts/fetch_ffmpeg.py {triple}")

    version = run(str(ffmpeg), "-hide_banner", "-version").splitlines()[0]
    config = run(str(ffmpeg), "-hide_banner", "-buildconf")
    bad = [flag for flag in FORBIDDEN_CONFIG if flag in config]
    if bad:
        fail(f"not an LGPL build: {', '.join(bad)}")
    # The licence text is wrapped differently per version, so compare words, not lines.
    licence = " ".join(run(str(ffmpeg), "-hide_banner", "-L").split())
    if "GNU Lesser General Public License" not in licence:
        fail("ffmpeg -L does not show the LGPL")
    run(str(ffprobe), "-hide_banner", "-version")

    if not re.search(r"^\s*\S+\s+ass\s", run(str(ffmpeg), "-hide_banner", "-filters"), re.M):
        fail("the ass filter is missing")
    encoders_out = run(str(ffmpeg), "-hide_banner", "-encoders")
    available = [e for e in ALLOWED[os_name] if re.search(rf"^\s*V\S*\s+{e}\s", encoders_out, re.M)]
    if not available:
        fail(f"none of the allowed encoders {ALLOWED[os_name]} is available")

    if os_name == "darwin" and platform.system() == "Darwin":
        for tool in (ffmpeg, ffprobe):
            minos = re.search(r"minos (\S+)", run("otool", "-l", str(tool)))
            if not minos or tuple(map(int, minos.group(1).split("."))) > (12, 0):
                fail(f"{tool.name} needs macOS {minos.group(1) if minos else '?'}, not 12.0")

    used = burn_test(ffmpeg, ffprobe, available)
    print(f"OK {triple}: {version}")
    print(f"   LGPL, ass filter, encoders {available}; test clip burned with {used}")


def burn_test(ffmpeg: Path, ffprobe: Path, encoders: list[str]) -> str:
    ffmpeg, ffprobe = ffmpeg.resolve(), ffprobe.resolve()  # FFmpeg runs in the temp dir
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        (work / "captions.ass").write_text(ASS)
        shutil.copytree(FONTS, work / "fonts", ignore=shutil.ignore_patterns("*.txt", "*.md"))
        errors = []
        for encoder in encoders:
            extra = ["-allow_sw", "1"] if encoder == "h264_videotoolbox" else []
            try:
                run(
                    str(ffmpeg), "-nostdin", "-y", "-v", "error",
                    "-f", "lavfi", "-i", "color=c=0x1e1e28:s=640x360:r=25:d=1",
                    "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
                    "-vf", "ass=filename=captions.ass:fontsdir=fonts",
                    "-c:v", encoder, *extra, "-b:v", "2000000", "-pix_fmt", "yuv420p",
                    "-c:a", "aac", "-shortest", "out.mp4",
                    cwd=work,
                )
            except RuntimeError as e:
                errors.append(f"{encoder}: {e}")
                continue
            info = json.loads(run(
                str(ffprobe), "-v", "error", "-select_streams", "v:0",
                "-show_entries", "stream=width,height,codec_name:format=duration", "-of", "json",
                str(work / "out.mp4"),
            ))
            stream, duration = info["streams"][0], float(info["format"]["duration"])
            if (stream["width"], stream["height"], stream["codec_name"]) != (640, 360, "h264"):
                fail(f"unexpected output stream {stream}")
            if abs(duration - 1.0) > 0.15:
                fail(f"unexpected output duration {duration}")
            return encoder
        fail("no allowed encoder could burn the test clip:\n" + "\n".join(errors))
        return ""


if __name__ == "__main__":
    main()
