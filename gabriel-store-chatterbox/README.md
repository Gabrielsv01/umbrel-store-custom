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

## API

- `POST /tts` — generate speech. Form fields: `text`, `language_id` (default
  `pt`), `voice_name`, `exaggeration`, `cfg_weight`, `temperature`,
  `repetition_penalty`, `min_p`, `top_p`, `seed`; optional `audio_prompt` file
  upload for one-off voice cloning. Returns a WAV file.
- `POST /voices` / `GET /voices` / `DELETE /voices/{name}` — save a reference
  clip once, reuse it by name.
- `GET /languages` — supported language codes.
- `GET /health` — model load status (`loading` until the ~5GB download
  finishes, then `ready`).

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
