#!/usr/bin/env bash
set -e

VOICES_DIR="${VOICES_DIR:-/voices}"
mkdir -p "$VOICES_DIR"

BASE="https://huggingface.co/Lucasllfs/Razo-piper-voice/resolve/main"
MODEL="$VOICES_DIR/pt-BR-razo-medium.onnx"
CONFIG="$VOICES_DIR/pt-BR-razo-medium.onnx.json"

# Download to a temp file and only move it into place once complete, so an
# interrupted download never leaves a 0-byte file that poisons later starts.
# `-s` = exists AND non-empty. curl -fL follows HF's CDN redirects and fails
# loudly on HTTP errors.
download() {  # url dest
  curl -fL --retry 3 --retry-delay 2 -o "$2.part" "$1" && mv "$2.part" "$2" \
    || { echo "download failed: $1"; rm -f "$2.part"; }
}

if [ ! -s "$MODEL" ]; then
  echo "Downloading pt-BR Razo voice from Hugging Face..."
  download "$BASE/pt-BR-razo-medium.onnx" "$MODEL"
fi
if [ ! -s "$CONFIG" ]; then
  download "$BASE/config.json" "$CONFIG"
fi
[ -s "$MODEL" ] && echo "Voice ready." || echo "WARNING: no voice model — /voices is empty, synth will fail until it downloads."

exec python -m uvicorn app:app --host 0.0.0.0 --port "${PORT:-5158}"
