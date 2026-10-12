#!/usr/bin/env bash
# Generates the synthetic English test clips in fixtures/en/ (macOS only: uses `say`).
# Existing clips are kept (re-encoding changes the bytes); pass --force to rebuild them.
#
#   <name>.txt  reference transcript (the exact text spoken)
#   <name>.mp4  640x360 dark background + speech, starting after 1 s of silence
#
#   hello   plain English, for accuracy and timing tests
#   brands  made-up names (custom words / initial prompt tests)
#
# English clips are required. Clips in other languages (fixtures/<code>/) are optional and
# added by hand with hand-checked transcripts.
set -euo pipefail

cd "$(dirname "$0")/../fixtures/en"

VOICE="Samantha"
FORCE="${1:-}"

# Prefer the hardware encoder; fall back to libx264 (fine for a test file, never bundled).
encoder="h264_videotoolbox"
ffmpeg -hide_banner -encoders 2>/dev/null | grep -q " $encoder " || encoder="libx264"

make_clip() {
  local name="$1" text="$2"
  if [[ -f "$name.mp4" && "$FORCE" != "--force" ]]; then
    echo "kept fixtures/en/$name.mp4"
    return
  fi
  echo "$text" > "$name.txt"

  local tmp
  tmp="$(mktemp -d)"
  say -v "$VOICE" -o "$tmp/speech.aiff" "$text"
  ffmpeg -nostdin -y -v error \
    -f lavfi -i "color=c=0x1e1e28:s=640x360:r=25" \
    -i "$tmp/speech.aiff" \
    -filter_complex "[1:a]adelay=1000:all=1,apad=pad_dur=1[a]" \
    -map 0:v -map "[a]" -shortest \
    -c:v "$encoder" -b:v 200k -pix_fmt yuv420p \
    -c:a aac -b:a 64k -ac 1 -ar 44100 \
    -movflags +faststart \
    "$name.mp4"
  rm -rf "$tmp"
  echo "wrote fixtures/en/$name.mp4 ($(du -h "$name.mp4" | cut -f1)) with $encoder"
}

make_clip hello "Welcome to the caption test. The quick brown fox jumps over the lazy dog. \
Every video deserves clear and accurate captions."

make_clip brands "Welcome back to KreoKit. Today Zylvana and Morvelle show how Quillhaven \
makes captions."
