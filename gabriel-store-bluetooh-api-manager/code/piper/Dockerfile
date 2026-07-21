FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        curl \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py entrypoint.sh ./
RUN chmod +x entrypoint.sh

ENV PORT=5158 \
    VOICES_DIR=/voices \
    PYTHONUNBUFFERED=1

EXPOSE 5158
CMD ["./entrypoint.sh"]
