#!/usr/bin/env bash
# Regenerates the synthetic English test clip in fixtures/en/ (macOS only: uses `say`).
#
#   hello.txt  reference transcript (the exact text spoken)
#   hello.mp4  640x360 dark background + speech, starting after 1 s of silence
#
# English clips are required. Clips in other languages (fixtures/<code>/) are optional and
# added by hand with hand-checked transcripts.
set -euo pipefail

cd "$(dirname "$0")/../fixtures/en"

VOICE="Samantha"
TEXT="Welcome to the caption test. The quick brown fox jumps over the lazy dog. \
Every video deserves clear and accurate captions."

echo "$TEXT" > hello.txt

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
say -v "$VOICE" -o "$tmp/speech.aiff" "$TEXT"

# Prefer the hardware encoder; fall back to libx264 (fine for a test file, never bundled).
encoder="h264_videotoolbox"
ffmpeg -hide_banner -encoders 2>/dev/null | grep -q " $encoder " || encoder="libx264"

ffmpeg -nostdin -y -v error \
  -f lavfi -i "color=c=0x1e1e28:s=640x360:r=25" \
  -i "$tmp/speech.aiff" \
  -filter_complex "[1:a]adelay=1000:all=1,apad=pad_dur=1[a]" \
  -map 0:v -map "[a]" -shortest \
  -c:v "$encoder" -b:v 200k -pix_fmt yuv420p \
  -c:a aac -b:a 64k -ac 1 -ar 44100 \
  -movflags +faststart \
  hello.mp4

echo "wrote fixtures/en/hello.mp4 ($(du -h hello.mp4 | cut -f1)) with $encoder"
