"""Assemble and load the Chatterbox Multilingual pt-BR checkpoint.

ResembleAI/Chatterbox-Multilingual-pt-br only publishes a re-trained T3
(text -> speech-token) model and S3Gen vocoder, fine-tuned for Brazilian
Portuguese. It does not include the voice encoder or the built-in default
voice conditioning, so those two files are pulled from the base
ResembleAI/chatterbox checkpoint. Everything is copied into one local
directory, then loaded by _load_checkpoint() below (a copy of
ChatterboxMultilingualTTS.from_local() that tolerates the s3gen state_dict
gap noted at S3GEN_ALLOWED_MISSING_KEYS).
"""
import copy
import os
import shutil
import threading
from pathlib import Path
from typing import Optional

import torch
from huggingface_hub import hf_hub_download
from safetensors.torch import load_file as load_safetensors
from tqdm import tqdm as _real_tqdm

from chatterbox.mtl_tts import ChatterboxMultilingualTTS, Conditionals, SUPPORTED_LANGUAGES
from chatterbox.models.t3 import T3
from chatterbox.models.t3 import t3 as _t3_module
from chatterbox.models.t3.modules.t3_config import T3Config
from chatterbox.models.s3gen import S3Gen
from chatterbox.models.tokenizers import MTLTokenizer
from chatterbox.models.voice_encoder import VoiceEncoder

import jobs as _jobs


class _ProgressTqdm(_real_tqdm):
    """Reports each speech-token generation step to the current Job (see
    jobs.py), on top of tqdm's normal behavior. T3.inference's sampling loop
    (`for i in tqdm(range(max_new_tokens), ...)`) looks up `tqdm` as a module
    global at call time, so replacing it below affects that loop without
    touching chatterbox's own source.
    """

    def __iter__(self):
        job = _jobs.get_current_job()
        n = 0
        for obj in self.iterable:
            yield obj
            n += 1
            self.n = n
            if job is not None:
                job.current_step = n


_t3_module.tqdm = _ProgressTqdm

BASE_REPO_ID = "ResembleAI/chatterbox"
PTBR_REPO_ID = "ResembleAI/Chatterbox-Multilingual-pt-br"

# local_filename -> (source_repo_id, filename_in_that_repo)
CHECKPOINT_FILES = {
    "ve.pt": (BASE_REPO_ID, "ve.pt"),
    "conds.pt": (BASE_REPO_ID, "conds.pt"),
    "t3_pt_br.safetensors": (PTBR_REPO_ID, "t3_pt_br.safetensors"),
    "s3gen.pt": (PTBR_REPO_ID, "s3gen_v3.pt"),
    "grapheme_mtl_merged_expanded_v1.json": (PTBR_REPO_ID, "grapheme_mtl_merged_expanded_v1.json"),
}

# The pt-BR "v3" S3Gen checkpoint predates two deterministic buffers
# (mel filterbank + analysis window) that the installed s3tokenizer package
# now registers as persistent on its tokenizer submodule. They are computed
# from fixed constants at __init__, not learned, so it's safe to keep the
# freshly-initialized values instead of requiring them in the checkpoint.
S3GEN_ALLOWED_MISSING_KEYS = {"tokenizer._mel_filters", "tokenizer.window"}

DATA_DIR = Path(os.environ.get("DATA_DIR", "/data"))
HF_CACHE_DIR = Path(os.environ.get("HF_HOME", str(DATA_DIR / "hf-cache")))
CKPT_DIR = DATA_DIR / "ckpt" / "chatterbox-ptbr"

_lock = threading.Lock()
_model: Optional[ChatterboxMultilingualTTS] = None
_load_error: Optional[str] = None
_loading = False
# Untouched copy of the built-in default voice conditioning, kept aside so
# a "no reference" request can be reset to it explicitly (see
# reset_to_default_voice() below).
_default_conds = None


def _prepare_checkpoint_dir() -> Path:
    CKPT_DIR.mkdir(parents=True, exist_ok=True)
    for local_name, (repo_id, remote_name) in CHECKPOINT_FILES.items():
        dst = CKPT_DIR / local_name
        if dst.exists():
            continue
        src = hf_hub_download(repo_id=repo_id, filename=remote_name, cache_dir=str(HF_CACHE_DIR))
        shutil.copy(src, dst)
    return CKPT_DIR


def get_device() -> str:
    return os.environ.get("DEVICE", "cpu")


def is_ready() -> bool:
    return _model is not None


def get_error() -> Optional[str]:
    return _load_error


def get_model() -> ChatterboxMultilingualTTS:
    if _model is None:
        raise RuntimeError("Model not loaded yet")
    return _model


def start_loading() -> None:
    global _loading
    with _lock:
        if _loading or _model is not None:
            return
        _loading = True
    threading.Thread(target=_load, daemon=True).start()


def _load_checkpoint(ckpt_dir: Path, device: str) -> ChatterboxMultilingualTTS:
    # Mirrors ChatterboxMultilingualTTS.from_local, except s3gen is loaded with
    # strict=False (see S3GEN_ALLOWED_MISSING_KEYS above) so the pt-BR "v3"
    # checkpoint loads under the currently installed chatterbox-tts.
    map_location = torch.device("cpu") if device in ("cpu", "mps") else None

    ve = VoiceEncoder()
    ve.load_state_dict(torch.load(ckpt_dir / "ve.pt", map_location=map_location, weights_only=True))
    ve.to(device).eval()

    t3 = T3(T3Config.multilingual())
    t3_state = load_safetensors(ckpt_dir / "t3_pt_br.safetensors")
    if "model" in t3_state:
        t3_state = t3_state["model"][0]
    t3.load_state_dict(t3_state)
    t3.to(device).eval()

    s3gen = S3Gen()
    result = s3gen.load_state_dict(
        torch.load(ckpt_dir / "s3gen.pt", map_location=map_location, weights_only=True),
        strict=False,
    )
    unexpected_missing = set(result.missing_keys) - S3GEN_ALLOWED_MISSING_KEYS
    if unexpected_missing or result.unexpected_keys:
        raise RuntimeError(
            "Unexpected state_dict mismatch loading s3gen: "
            f"missing={sorted(unexpected_missing)} unexpected={sorted(result.unexpected_keys)}"
        )
    s3gen.to(device).eval()

    tokenizer = MTLTokenizer(str(ckpt_dir / "grapheme_mtl_merged_expanded_v1.json"))

    conds = None
    builtin_voice = ckpt_dir / "conds.pt"
    if builtin_voice.exists():
        conds = Conditionals.load(builtin_voice, map_location=map_location).to(device)

    return ChatterboxMultilingualTTS(t3, s3gen, ve, tokenizer, device, conds=conds)


def _load() -> None:
    global _model, _load_error, _loading, _default_conds
    try:
        ckpt_dir = _prepare_checkpoint_dir()
        model = _load_checkpoint(ckpt_dir, get_device())
        with _lock:
            _model = model
            _default_conds = copy.deepcopy(model.conds) if model.conds is not None else None
    except Exception as exc:  # noqa: BLE001 - surfaced via /health
        with _lock:
            _load_error = str(exc)
    finally:
        with _lock:
            _loading = False


def reset_to_default_voice() -> None:
    """Restore the model's built-in default voice conditioning.

    ChatterboxMultilingualTTS.generate() only recomputes conditioning when
    given audio_prompt_path; otherwise it just reuses whatever self.conds
    currently is. Since the model instance is a shared singleton, a "no
    reference" request made after any voice-cloned request would otherwise
    keep using that other voice instead of the intended default. Call this
    before generate() whenever audio_prompt_path is None.
    """
    if _model is not None and _default_conds is not None:
        _model.conds = copy.deepcopy(_default_conds)


def supported_languages() -> dict:
    return dict(SUPPORTED_LANGUAGES)
