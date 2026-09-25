"""In-memory job tracking for async /tts generation with progress.

One background thread runs the actual generation per job; a thread-local
"current job" pointer lets the monkeypatched tqdm in model_loader.py report
real per-token progress back into the right Job without the caller having to
thread a callback through chatterbox's generate()/inference() call chain.
"""
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Dict, Optional

# Only one generation runs at a time (CPU-bound; avoids thrashing a
# resource-constrained host). Extra requests queue as "queued" until it's
# their turn.
generation_lock = threading.Lock()

_jobs_lock = threading.Lock()
_jobs: Dict[str, "Job"] = {}
_current_job = threading.local()

JOB_MAX_AGE_SECONDS = 3600


@dataclass
class Job:
    id: str
    estimated_steps: int
    status: str = "queued"  # queued | running | done | error
    current_step: int = 0
    filename: Optional[str] = None
    error: Optional[str] = None
    created_at: float = field(default_factory=time.time)

    def progress(self) -> int:
        if self.status == "done":
            return 100
        if self.status in ("queued", "error"):
            return 0
        pct = 100 * self.current_step / max(1, self.estimated_steps)
        return int(min(97, pct))

    def to_dict(self) -> dict:
        return {
            "job_id": self.id,
            "status": self.status,
            "progress": self.progress(),
            "filename": self.filename,
            "error": self.error,
        }


def estimate_steps(text: str) -> int:
    # Rough heuristic (~2.5 speech tokens per input character, observed
    # empirically) so the progress bar tracks reality instead of counting
    # against the hard max_new_tokens=1000 ceiling that most utterances never
    # get near. Clamped to a sane range; progress() caps display at 97%
    # anyway if a given utterance runs longer than estimated.
    return max(40, min(1000, round(len(text) * 2.5)))


def create_job(text: str) -> Job:
    job = Job(id=uuid.uuid4().hex[:12], estimated_steps=estimate_steps(text))
    with _jobs_lock:
        _jobs[job.id] = job
        _prune_locked()
    return job


def get_job(job_id: str) -> Optional[Job]:
    with _jobs_lock:
        return _jobs.get(job_id)


def _prune_locked() -> None:
    cutoff = time.time() - JOB_MAX_AGE_SECONDS
    stale = [jid for jid, j in _jobs.items() if j.created_at < cutoff]
    for jid in stale:
        _jobs.pop(jid, None)


def set_current_job(job: Optional[Job]) -> None:
    _current_job.value = job


def get_current_job() -> Optional[Job]:
    return getattr(_current_job, "value", None)
