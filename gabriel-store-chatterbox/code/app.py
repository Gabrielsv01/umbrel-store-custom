import io
import os
import re
import tempfile
import threading
import time
import uuid
from pathlib import Path
from typing import List, Optional

import torch
import torchaudio as ta
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import jobs
import model_loader as ml

DATA_DIR = Path(os.environ.get("DATA_DIR", "/data"))
VOICES_DIR = DATA_DIR / "voices"
VOICES_DIR.mkdir(parents=True, exist_ok=True)
OUTPUTS_DIR = DATA_DIR / "outputs"
OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)

MAX_TEXT_LENGTH = int(os.environ.get("MAX_TEXT_LENGTH", "2000"))
VOICE_NAME_RE = re.compile(r"^[A-Za-z0-9_-]+$")

# Generated audio (not saved voices) older than this is deleted automatically.
# Does not apply to /voices, which are meant to be kept.
OUTPUT_RETENTION_DAYS = float(os.environ.get("OUTPUT_RETENTION_DAYS", "1"))
_CLEANUP_INTERVAL_SECONDS = 3600

# If set, skip loading the (~6.5GB) model at container startup; the web UI,
# Swagger, /voices and /outputs all work immediately either way, and the
# model loads lazily on the first /tts or /tts/jobs call instead (that first
# request gets a 503 while it loads). Off by default so /tts works right
# away post-install, matching the original behavior.
LAZY_LOAD_ENABLED = os.environ.get("LAZY_LOAD_ENABLED", "false").strip().lower() in ("1", "true", "yes", "on")


def _cleanup_old_outputs() -> None:
    cutoff = time.time() - OUTPUT_RETENTION_DAYS * 86400
    for f in OUTPUTS_DIR.glob("*.wav"):
        try:
            if f.stat().st_mtime < cutoff:
                f.unlink()
        except FileNotFoundError:
            pass


def _cleanup_loop() -> None:
    while True:
        _cleanup_old_outputs()
        time.sleep(_CLEANUP_INTERVAL_SECONDS)

app = FastAPI(
    title="Chatterbox TTS - Multilingual pt-BR",
    description=(
        "REST API around Resemble AI's Chatterbox multilingual text-to-speech "
        "model fine-tuned for Brazilian Portuguese "
        "(ResembleAI/Chatterbox-Multilingual-pt-br). Generates speech from text "
        "and supports zero-shot voice cloning from a reference audio clip. "
        "Every /tts response is also saved under /data/outputs and listed at "
        "GET /outputs, so generated audio survives beyond the HTTP response; "
        "it is auto-deleted after OUTPUT_RETENTION_DAYS (default 1 day, saved "
        "voices are never touched). If IDLE_UNLOAD_ENABLED is set, the model "
        "is freed from RAM after IDLE_UNLOAD_MINUTES of no generation activity "
        "and reloaded automatically on the next request (see /health status "
        "'idle' vs 'loading' vs 'ready'). Interactive docs are this same page; "
        "try requests directly below."
    ),
    version="1.0.0",
)


@app.on_event("startup")
def _startup() -> None:
    if not LAZY_LOAD_ENABLED:
        ml.start_loading()
    ml.start_idle_unload_watcher()
    threading.Thread(target=_cleanup_loop, daemon=True).start()


class HealthResponse(BaseModel):
    status: str
    device: str
    error: Optional[str] = None


class LanguagesResponse(BaseModel):
    default: str
    languages: dict


class VoiceInfo(BaseModel):
    name: str
    size_bytes: int


class OutputInfo(BaseModel):
    filename: str
    size_bytes: int


@app.get("/health", response_model=HealthResponse, tags=["System"], summary="Model load status")
def health():
    return HealthResponse(
        status=ml.get_status(),
        device=ml.get_device(),
        error=ml.get_error(),
    )


@app.get("/languages", response_model=LanguagesResponse, tags=["System"], summary="Supported language codes")
def languages():
    return LanguagesResponse(default="pt", languages=ml.supported_languages())


@app.get("/voices", response_model=List[VoiceInfo], tags=["Voices"], summary="List saved reference voices")
def list_voices():
    return [
        VoiceInfo(name=f.stem, size_bytes=f.stat().st_size)
        for f in sorted(VOICES_DIR.glob("*.wav"))
    ]


@app.post("/voices", response_model=VoiceInfo, tags=["Voices"], summary="Save a reference voice for reuse")
async def upload_voice(
    name: str = Form(..., description="Identifier to reuse this voice later as 'voice_name' in /tts."),
    file: UploadFile = File(..., description="Reference audio (wav recommended), a few seconds of clean single-speaker speech."),
):
    if not VOICE_NAME_RE.match(name):
        raise HTTPException(400, "Voice name must contain only letters, numbers, '-' and '_'.")
    dest = VOICES_DIR / f"{name}.wav"
    dest.write_bytes(await file.read())
    return VoiceInfo(name=name, size_bytes=dest.stat().st_size)


@app.get("/voices/{name}", tags=["Voices"], summary="Download/preview a saved reference voice")
def get_voice(name: str):
    dest = VOICES_DIR / f"{name}.wav"
    if not VOICE_NAME_RE.match(name) or not dest.exists():
        raise HTTPException(404, f"Voice '{name}' not found.")
    return FileResponse(dest, media_type="audio/wav", filename=f"{name}.wav")


@app.delete("/voices/{name}", tags=["Voices"], summary="Delete a saved reference voice")
def delete_voice(name: str):
    dest = VOICES_DIR / f"{name}.wav"
    if not dest.exists():
        raise HTTPException(404, f"Voice '{name}' not found.")
    dest.unlink()
    return {"status": "deleted", "name": name}


@app.get("/outputs", response_model=List[OutputInfo], tags=["Text-to-Speech"], summary="List previously generated audio")
def list_outputs():
    return [
        OutputInfo(filename=f.name, size_bytes=f.stat().st_size)
        for f in sorted(OUTPUTS_DIR.glob("*.wav"), key=lambda p: p.stat().st_mtime, reverse=True)
    ]


@app.get("/outputs/{filename}", tags=["Text-to-Speech"], summary="Download a previously generated audio file")
def get_output(filename: str):
    candidate = OUTPUTS_DIR / filename
    if candidate.parent != OUTPUTS_DIR or not candidate.exists():
        raise HTTPException(404, f"Output '{filename}' not found. See /outputs.")
    return FileResponse(candidate, media_type="audio/wav", filename=filename)


@app.delete("/outputs/{filename}", tags=["Text-to-Speech"], summary="Delete a previously generated audio file")
def delete_output(filename: str):
    candidate = OUTPUTS_DIR / filename
    if candidate.parent != OUTPUTS_DIR or not candidate.exists():
        raise HTTPException(404, f"Output '{filename}' not found. See /outputs.")
    candidate.unlink()
    return {"status": "deleted", "filename": filename}


def _validate_ready_and_language(language_id: str) -> str:
    if not ml.is_ready():
        # No-op if already loading/loaded; kicks off a reload if the model
        # was idle-unloaded (see IDLE_UNLOAD_ENABLED in model_loader.py).
        ml.start_loading()
        detail = "Model is still loading, retry shortly. Check /health."
        if ml.get_error():
            detail = f"Model failed to load: {ml.get_error()}"
        raise HTTPException(503, detail)

    language_id = language_id.strip().lower()
    if language_id not in ml.supported_languages():
        raise HTTPException(400, f"Unsupported language_id '{language_id}'. See /languages for the full list.")
    return language_id


async def _resolve_audio_prompt(
    voice_name: Optional[str], audio_prompt: Optional[UploadFile]
) -> tuple:
    """Returns (audio_prompt_path, tmp_path_to_cleanup_or_None)."""
    if audio_prompt is not None:
        suffix = Path(audio_prompt.filename or "prompt.wav").suffix or ".wav"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(await audio_prompt.read())
            tmp_path = tmp.name
        return tmp_path, tmp_path
    if voice_name:
        candidate = VOICES_DIR / f"{voice_name}.wav"
        if not candidate.exists():
            raise HTTPException(404, f"Voice '{voice_name}' not found. See /voices.")
        return str(candidate), None
    return None, None


def _generate_core(
    text: str,
    language_id: str,
    audio_prompt_path: Optional[str],
    exaggeration: float,
    cfg_weight: float,
    temperature: float,
    repetition_penalty: float,
    min_p: float,
    top_p: float,
    seed: Optional[int],
) -> str:
    """Runs model.generate() and saves the result under OUTPUTS_DIR. Returns
    the filename. Raises AssertionError/ValueError as chatterbox itself does;
    callers translate those into the right response shape."""
    ml.touch()
    if seed is not None:
        torch.manual_seed(seed)

    model = ml.get_model()
    if audio_prompt_path is None:
        # Otherwise generate() silently reuses whatever voice the last
        # request (from anyone) left behind on this shared model instance.
        ml.reset_to_default_voice()
    wav = model.generate(
        text,
        language_id=language_id,
        audio_prompt_path=audio_prompt_path,
        exaggeration=exaggeration,
        cfg_weight=cfg_weight,
        temperature=temperature,
        repetition_penalty=repetition_penalty,
        min_p=min_p,
        top_p=top_p,
    )

    filename = f"tts-{uuid.uuid4().hex[:8]}.wav"
    output_path = OUTPUTS_DIR / filename
    ta.save(str(output_path), wav, model.sr, format="wav")
    return filename


@app.post(
    "/tts",
    tags=["Text-to-Speech"],
    summary="Generate speech from text",
    responses={200: {"content": {"audio/wav": {}}}},
)
async def text_to_speech(
    text: str = Form(..., max_length=MAX_TEXT_LENGTH, description="Text to synthesize."),
    language_id: str = Form("pt", description="Language code (see /languages). Defaults to Portuguese."),
    voice_name: Optional[str] = Form(None, description="Name of a voice previously saved via POST /voices."),
    exaggeration: float = Form(0.5, ge=0.0, le=2.0, description="Emotion/intensity exaggeration (0=neutral, higher=more expressive)."),
    cfg_weight: float = Form(0.5, ge=0.0, le=1.0, description="Classifier-free guidance weight; lower can speed up pacing."),
    temperature: float = Form(0.8, ge=0.05, le=2.0, description="Sampling temperature; higher = more varied/less stable."),
    repetition_penalty: float = Form(2.0, ge=1.0, le=3.0, description="Penalty applied to repeated speech tokens. Lower values make this checkpoint prone to cutting speech short on a repeated-token safety stop."),
    min_p: float = Form(0.05, ge=0.0, le=1.0, description="Minimum-probability sampling threshold."),
    top_p: float = Form(1.0, ge=0.0, le=1.0, description="Nucleus sampling threshold."),
    seed: Optional[int] = Form(None, description="Random seed for reproducible output. Omit for random."),
    audio_prompt: Optional[UploadFile] = File(
        None, description="One-off reference audio for voice cloning; takes priority over voice_name."
    ),
):
    """Blocks until the WAV is ready. For a progress percentage (e.g. from a
    UI), use POST /tts/jobs + GET /tts/jobs/{job_id} instead."""
    language_id = _validate_ready_and_language(language_id)
    audio_prompt_path, tmp_path = await _resolve_audio_prompt(voice_name, audio_prompt)

    try:
        try:
            # Shared with /tts/jobs so a sync call and an async job (or two
            # sync calls) can't race on the model's mutable voice state.
            with jobs.generation_lock:
                filename = _generate_core(
                    text, language_id, audio_prompt_path,
                    exaggeration, cfg_weight, temperature, repetition_penalty, min_p, top_p, seed,
                )
        except AssertionError as exc:
            raise HTTPException(
                400,
                f"{exc} Provide 'audio_prompt' or 'voice_name' to select a voice.",
            )
        except ValueError as exc:
            raise HTTPException(400, str(exc))

        output_path = OUTPUTS_DIR / filename
        return StreamingResponse(
            io.BytesIO(output_path.read_bytes()),
            media_type="audio/wav",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)


class JobStatus(BaseModel):
    job_id: str
    status: str
    progress: int
    filename: Optional[str] = None
    error: Optional[str] = None


def _run_job(job: jobs.Job, tmp_path: Optional[str], **generate_kwargs) -> None:
    try:
        with jobs.generation_lock:
            job.status = "running"
            jobs.set_current_job(job)
            try:
                job.filename = _generate_core(**generate_kwargs)
                job.status = "done"
            except Exception as exc:  # noqa: BLE001 - surfaced via GET /tts/jobs/{id}
                job.error = str(exc)
                job.status = "error"
            finally:
                jobs.set_current_job(None)
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)


@app.post(
    "/tts/jobs",
    response_model=JobStatus,
    tags=["Text-to-Speech"],
    summary="Start async speech generation (for progress polling)",
)
async def start_tts_job(
    text: str = Form(..., max_length=MAX_TEXT_LENGTH, description="Text to synthesize."),
    language_id: str = Form("pt", description="Language code (see /languages). Defaults to Portuguese."),
    voice_name: Optional[str] = Form(None, description="Name of a voice previously saved via POST /voices."),
    exaggeration: float = Form(0.5, ge=0.0, le=2.0, description="Emotion/intensity exaggeration (0=neutral, higher=more expressive)."),
    cfg_weight: float = Form(0.5, ge=0.0, le=1.0, description="Classifier-free guidance weight; lower can speed up pacing."),
    temperature: float = Form(0.8, ge=0.05, le=2.0, description="Sampling temperature; higher = more varied/less stable."),
    repetition_penalty: float = Form(2.0, ge=1.0, le=3.0, description="Penalty applied to repeated speech tokens."),
    min_p: float = Form(0.05, ge=0.0, le=1.0, description="Minimum-probability sampling threshold."),
    top_p: float = Form(1.0, ge=0.0, le=1.0, description="Nucleus sampling threshold."),
    seed: Optional[int] = Form(None, description="Random seed for reproducible output. Omit for random."),
    audio_prompt: Optional[UploadFile] = File(
        None, description="One-off reference audio for voice cloning; takes priority over voice_name."
    ),
):
    """Same parameters as POST /tts, but returns immediately with a job_id
    instead of blocking for the whole generation (which can take a while on
    CPU). Poll GET /tts/jobs/{job_id} for a live progress percentage, then
    fetch the result from GET /outputs/{filename} once status is "done".
    Only one job actually runs at a time; extra ones wait as "queued"."""
    language_id = _validate_ready_and_language(language_id)
    audio_prompt_path, tmp_path = await _resolve_audio_prompt(voice_name, audio_prompt)

    job = jobs.create_job(text)
    threading.Thread(
        target=_run_job,
        kwargs=dict(
            job=job,
            tmp_path=tmp_path,
            text=text,
            language_id=language_id,
            audio_prompt_path=audio_prompt_path,
            exaggeration=exaggeration,
            cfg_weight=cfg_weight,
            temperature=temperature,
            repetition_penalty=repetition_penalty,
            min_p=min_p,
            top_p=top_p,
            seed=seed,
        ),
        daemon=True,
    ).start()
    return JobStatus(**job.to_dict())


@app.get(
    "/tts/jobs/{job_id}",
    response_model=JobStatus,
    tags=["Text-to-Speech"],
    summary="Poll async generation status/progress",
)
def get_tts_job(job_id: str):
    job = jobs.get_job(job_id)
    if job is None:
        raise HTTPException(404, f"Job '{job_id}' not found.")
    return JobStatus(**job.to_dict())


# Mounted last: the API routes above take precedence, this serves the web UI
# (static/index.html) for "/" and any other path that isn't an API route.
_STATIC_DIR = Path(__file__).parent / "static"
if _STATIC_DIR.is_dir():
    app.mount("/", StaticFiles(directory=str(_STATIC_DIR), html=True), name="ui")
