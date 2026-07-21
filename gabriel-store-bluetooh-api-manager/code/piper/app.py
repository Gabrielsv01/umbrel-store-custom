"""Tiny Piper TTS HTTP worker.

One job: turn text into a WAV using a Piper voice from /voices. The main
Bluetooth app calls this over HTTP, stores the audio, and handles the queue /
scheduling / playback. Keeping TTS isolated here (KISS) keeps the heavy ONNX
runtime out of the main image.
"""
import glob
import io
import os
import wave

from fastapi import FastAPI, HTTPException, Response
from pydantic import BaseModel
from piper import PiperVoice

VOICES_DIR = os.getenv("VOICES_DIR", "/voices")

app = FastAPI(title="Piper TTS", version="1.0.0")
_cache: dict[str, PiperVoice] = {}


def _voice_files() -> dict[str, str]:
    return {
        os.path.basename(p)[:-5]: p  # strip ".onnx"
        for p in glob.glob(os.path.join(VOICES_DIR, "*.onnx"))
    }


def _load(name: str) -> PiperVoice:
    if name in _cache:
        return _cache[name]
    files = _voice_files()
    if name not in files:
        raise HTTPException(status_code=404, detail=f"voice '{name}' not found")
    _cache[name] = PiperVoice.load(files[name])
    return _cache[name]


class SynthBody(BaseModel):
    text: str
    voice: str


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/voices")
def voices() -> list[str]:
    return sorted(_voice_files().keys())


@app.post("/synthesize")
def synthesize(body: SynthBody) -> Response:
    if not body.text.strip():
        raise HTTPException(status_code=400, detail="text is empty")
    voice = _load(body.voice)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wav:
        voice.synthesize(body.text, wav)
    return Response(content=buf.getvalue(), media_type="audio/wav")
