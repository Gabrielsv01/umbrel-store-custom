"""Tiny Piper TTS HTTP worker.

Turns text into a WAV using a Piper voice from /voices. To keep memory low, this
FastAPI process does NOT load any model itself — each /synthesize spawns a
short-lived subprocess (synth_worker.py) that loads the voice, writes the WAV
and exits, so all model memory (~120 MiB) is returned to the OS immediately.
Idle footprint stays tiny; the cost is a ~3s cold start on every request.

Default synthesis parameters come from env vars (see DEFAULT_PARAMS); a request
may override any of them per call.
"""
import asyncio
import glob
import json
import os
import tempfile

from fastapi import FastAPI, HTTPException, Response
from pydantic import BaseModel

VOICES_DIR = os.getenv("VOICES_DIR", "/voices")
WORKER = os.path.join(os.path.dirname(__file__), "synth_worker.py")

app = FastAPI(title="Piper TTS", version="1.0.2")


def _env_float(name: str):
    val = os.getenv(name)
    try:
        return float(val) if val not in (None, "") else None
    except ValueError:
        return None


# Container-wide defaults (None = use Piper's built-in default).
DEFAULT_PARAMS = {
    "length_scale": _env_float("PIPER_LENGTH_SCALE"),      # speed: >1 slower, <1 faster
    "noise_scale": _env_float("PIPER_NOISE_SCALE"),        # expressiveness / variability
    "noise_w": _env_float("PIPER_NOISE_W"),                # cadence (timing) variability
    "sentence_silence": _env_float("PIPER_SENTENCE_SILENCE"),  # pause between sentences (s)
}


def _voice_files() -> dict[str, str]:
    return {
        os.path.basename(p)[:-5]: p  # strip ".onnx"
        for p in glob.glob(os.path.join(VOICES_DIR, "*.onnx"))
    }


class SynthBody(BaseModel):
    text: str
    voice: str
    length_scale: float | None = None
    noise_scale: float | None = None
    noise_w: float | None = None
    sentence_silence: float | None = None


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/voices")
def voices() -> list[str]:
    return sorted(_voice_files().keys())


@app.get("/defaults")
def defaults() -> dict:
    return {k: v for k, v in DEFAULT_PARAMS.items()}


@app.post("/synthesize")
async def synthesize(body: SynthBody) -> Response:
    if not body.text.strip():
        raise HTTPException(status_code=400, detail="text is empty")
    files = _voice_files()
    if body.voice not in files:
        raise HTTPException(status_code=404, detail=f"voice '{body.voice}' not found")

    # Per-request value wins; otherwise fall back to the env default.
    params = {}
    for key in ("length_scale", "noise_scale", "noise_w", "sentence_silence"):
        value = getattr(body, key)
        if value is None:
            value = DEFAULT_PARAMS[key]
        if value is not None:
            params[key] = value

    out_path = tempfile.mktemp(suffix=".wav")
    payload = json.dumps({"text": body.text, "params": params}).encode()
    proc = await asyncio.create_subprocess_exec(
        "python", WORKER, files[body.voice], out_path,
        stdin=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    _, err = await proc.communicate(payload)
    if proc.returncode != 0:
        raise HTTPException(status_code=500, detail=(err or b"synthesis failed").decode()[-400:])
    try:
        with open(out_path, "rb") as fh:
            data = fh.read()
    finally:
        if os.path.exists(out_path):
            os.remove(out_path)
    return Response(content=data, media_type="audio/wav")
