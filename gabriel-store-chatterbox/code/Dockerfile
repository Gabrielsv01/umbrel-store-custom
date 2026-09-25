FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    DATA_DIR=/data \
    HF_HOME=/data/hf-cache \
    DEVICE=cpu \
    PORT=5158

# libsndfile1: required by librosa/soundfile to read reference wavs.
# ffmpeg: torchaudio fallback backend for saving/loading audio.
RUN apt-get update && apt-get install -y --no-install-recommends \
        libsndfile1 \
        ffmpeg \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements-torch.txt requirements.txt ./
# Torch/torchaudio pulled from the CPU-only wheel index in their own install
# step, so the much larger dependency set below (chatterbox-tts -> gradio,
# diffusers, transformers, ...) resolves against plain PyPI only.
RUN pip install --no-cache-dir --default-timeout=100 --retries 5 --index-url https://download.pytorch.org/whl/cpu -r requirements-torch.txt \
    && pip install --no-cache-dir --default-timeout=100 --retries 5 -r requirements.txt

COPY app.py model_loader.py jobs.py ./
COPY static/ ./static/

RUN mkdir -p /data/voices /data/outputs /data/hf-cache

EXPOSE 5158

CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT:-5158}"]
