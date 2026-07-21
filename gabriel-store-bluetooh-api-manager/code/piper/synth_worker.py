"""One-shot synthesis worker: load voice, synthesize, write WAV, exit.

Run as a short-lived subprocess per request so ALL the model memory (~120 MiB,
which Python/onnxruntime otherwise never return to the OS) is reclaimed the
moment the process exits. Reads a JSON request from stdin:

    {"text": "...", "params": {"length_scale": 1.0, "noise_scale": 0.667, ...}}

Usage: python synth_worker.py <model.onnx> <out.wav>
"""
import json
import sys
import wave

from piper import PiperVoice

# Sane clamps so a bad env/request can't produce broken audio.
_CLAMPS = {
    "length_scale": (0.3, 3.0),
    "noise_scale": (0.0, 1.5),
    "noise_w": (0.0, 1.5),
    "sentence_silence": (0.0, 5.0),
}


def main() -> int:
    model_path, out_path = sys.argv[1], sys.argv[2]
    req = json.load(sys.stdin)
    kwargs = {}
    for key, value in (req.get("params") or {}).items():
        if key in _CLAMPS and value is not None:
            lo, hi = _CLAMPS[key]
            kwargs[key] = max(lo, min(hi, float(value)))
    voice = PiperVoice.load(model_path)
    with wave.open(out_path, "wb") as wav:
        voice.synthesize(req["text"], wav, **kwargs)
    return 0


if __name__ == "__main__":
    sys.exit(main())
