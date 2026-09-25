# Chatterbox TTS (pt-BR)

FastAPI wrapper around Resemble AI's Chatterbox multilingual TTS model,
loading the `ResembleAI/Chatterbox-Multilingual-pt-br` checkpoint (Chatterbox
fine-tuned for Brazilian Portuguese). CPU-only.

Web UI: `http://umbrel.local:5160/` · Swagger/OpenAPI docs: `http://umbrel.local:5160/docs`

Host port 5160 maps to container port 5158 (kept as-is internally; moved off
5158 on the host side because gabriel-store-bluetooh-api-manager's "piper"
helper already binds 5158 via `network_mode: host` on the same Umbrel).

## How the checkpoint is assembled

`ResembleAI/Chatterbox-Multilingual-pt-br` only ships a fine-tuned T3
(text -> speech-token) model and S3Gen vocoder. It does not include the voice
encoder or the built-in default-voice conditioning, so `code/model_loader.py`
downloads those two extra files from the base `ResembleAI/chatterbox` repo on
first startup and combines everything into `/data/ckpt/chatterbox-ptbr`
(persisted via the `/data` volume, so it only happens once):

| local filename                              | source repo                              | source filename                |
|----------------------------------------------|-------------------------------------------|---------------------------------|
| `ve.pt`                                       | `ResembleAI/chatterbox`                    | `ve.pt`                         |
| `conds.pt`                                    | `ResembleAI/chatterbox`                    | `conds.pt`                      |
| `t3_pt_br.safetensors`                        | `ResembleAI/Chatterbox-Multilingual-pt-br`  | `t3_pt_br.safetensors`          |
| `s3gen.pt`                                    | `ResembleAI/Chatterbox-Multilingual-pt-br`  | `s3gen_v3.pt`                   |
| `grapheme_mtl_merged_expanded_v1.json`        | `ResembleAI/Chatterbox-Multilingual-pt-br`  | `grapheme_mtl_merged_expanded_v1.json` |

`code/model_loader.py`'s `_load_checkpoint()` is a copy of the
`chatterbox-tts` PyPI package's (0.1.7) `ChatterboxMultilingualTTS.from_local()`,
with one change: it loads `s3gen.pt` with `strict=False`. The pt-BR repo's
S3Gen ("v3") checkpoint predates two deterministic buffers
(`tokenizer._mel_filters`, `tokenizer.window`) that the installed
`s3tokenizer` package now registers as persistent; they're recomputed from
fixed constants at init (not learned), so a strict load fails on them for no
real reason. Any *other* missing/unexpected key still raises, so a genuine
checkpoint/code mismatch is not silently swallowed.

Tuning note: the default `repetition_penalty=2.0` matters more than it looks —
at `1.2` (a value floating around in Chatterbox docs/examples) this
checkpoint frequently loops on a single speech token a few frames in and gets
cut short by the model's own repetition guard, producing a WAV of well under
a second regardless of input length. `2.0` (the PyPI package's own default)
reliably reaches a natural end-of-utterance stop instead. If you still get
suspiciously short audio, that guard is almost certainly the reason — try
raising `repetition_penalty` further before anything else.

A shared model instance means "no reference" requests must explicitly reset
to the built-in default voice before generating — otherwise
`ChatterboxMultilingualTTS.generate()` just reuses whatever voice the last
caller (anyone) left conditioned, since it only recomputes conditioning when
given `audio_prompt_path`. See `reset_to_default_voice()`.

## Resource usage

The loaded model uses **~6.5GB of RAM** (measured: 6.45GiB peak). Plan
accordingly — this rules out a 4GB Raspberry Pi, and an 8GB one will be very
tight once you add OS + Docker + anything else running. 16GB is comfortable.

By default (`LAZY_LOAD_ENABLED=true` + `IDLE_UNLOAD_ENABLED=true`, see below)
the app only actually holds the model in RAM while it's being used —
otherwise it sits at ~350MB (just FastAPI/the web UI). Set either to
`false` to keep it loaded at all times instead (skips the load/reload delay
on the first request after a cold start or idle period).

First run also downloads ~5GB of weights from Hugging Face into `/data`
(cached after that — see the checkpoint table above).

## API

- `POST /tts` — generate speech, blocking until the WAV is ready. Form
  fields: `text`, `language_id` (default `pt`), `voice_name`, `exaggeration`,
  `cfg_weight`, `temperature`, `repetition_penalty`, `min_p`, `top_p`,
  `seed`; optional `audio_prompt` file upload for one-off voice cloning.
- `POST /tts/jobs` + `GET /tts/jobs/{job_id}` — same fields as `/tts`, but
  async: returns a `job_id` immediately, poll for `status`
  (`queued`/`running`/`done`/`error`) and a real `progress` percentage
  (tracked from T3's speech-token sampling loop). Once `done`, fetch the
  result from `GET /outputs/{filename}`. This is what the web UI uses to
  show a progress bar instead of blocking the whole request.
- `POST /voices` / `GET /voices` / `GET /voices/{name}` / `DELETE /voices/{name}`
  — save a reference clip once, reuse it by name, preview or remove it later.
- `GET /outputs` / `GET /outputs/{filename}` / `DELETE /outputs/{filename}` —
  every `/tts` or `/tts/jobs` result is also saved here; auto-deleted after
  `OUTPUT_RETENTION_DAYS` (default 1 day).
- `GET /languages` — supported language codes.
- `GET /health` — `{status, device, error}`; status is `loading` (initial
  load or reload), `ready`, `idle` (deliberately unloaded, see below), or
  `error`.

Only one generation actually runs at a time (`jobs.generation_lock`) — extra
`/tts`/`/tts/jobs` calls queue rather than racing on the shared model.

### Lazy load + idle unload

Two independent env vars, both **on by default** in `docker-compose.yml`
(the code itself defaults both to off, for anyone reusing it elsewhere):

- `LAZY_LOAD_ENABLED` — skip loading the model at container startup; it
  loads on the first `/tts`/`/tts/jobs` call instead. The web UI, Swagger,
  `/voices` and `/outputs` all work immediately either way.
- `IDLE_UNLOAD_ENABLED` (+ `IDLE_UNLOAD_MINUTES`, default 30) — a background
  thread frees the model from RAM after that long with no generation
  activity (health-check polling doesn't count), calling `gc.collect()` +
  glibc `malloc_trim(0)` to actually shrink RSS instead of just letting
  Python consider it garbage.

Either path means the *next* `/tts`/`/tts/jobs` call transparently triggers
a (re)load — a few seconds to ~1 minute depending on disk speed, no
re-download since the checkpoint is already cached — and returns 503 in the
meantime. `/health` reports `idle` while the model isn't loaded (never
loaded yet, or freed after being idle) and `loading` while a (re)load is in
progress.

Set either to `false` in the environment to go back to "always loaded."

## Local build

```
cd code
make build-version VERSION=1.0.0
docker run --rm -p 5160:5158 -v $(pwd)/../data:/data chatterbox-tts-ptbr:1.0.0
```

## Release

```
cd code
make release VERSION=1.0.0
```
