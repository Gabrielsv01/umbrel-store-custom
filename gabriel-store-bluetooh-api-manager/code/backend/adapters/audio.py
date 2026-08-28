"""Audio streaming to a Bluetooth A2DP speaker via bluez-alsa, with a queue.

The container runs its own bluez-alsa daemon (bluealsad -p a2dp-source), so no
host audio server is needed. Tracks (uploaded files or URLs) are enqueued and a
single background player plays them one after another. To play a track we:
  1. make sure the speaker is connected (bluetoothctl connect <MAC>);
  2. decode with ffmpeg and pipe raw PCM into `aplay` on the bluez-alsa PCM.

Best-effort: needs a real adapter + a paired speaker. Errors surface on the bus.
"""
from __future__ import annotations

import asyncio
import os
import random
import signal
import time
from typing import Any, Dict, List, Optional

from ..core.config import settings
from ..core.events import bus
from .bluetooth import ble

# Fake duration for a simulated mock track that has no real duration (e.g. an
# uploaded file — we never decode it, so ffmpeg's real duration is unknown).
MOCK_FALLBACK_DURATION = 20.0
MOCK_TICK_SECONDS = 0.2

# Duration of the throwaway "warm-up" silence played to absorb the FIRST-open
# glitch on some speakers (Echo/Alexa): the first aplay open after a (re)connect
# glitches its output while a second, separate open is clean — so we sacrifice
# this silent open and the real track comes out clean. Used on recovery re-prime.
# Env-tunable (kept as AUDIO_RECONNECT_DELAY for backward compatibility).
WARMUP_SECONDS = float(os.getenv("AUDIO_RECONNECT_DELAY", "1.5"))

# Longer silent lead-in for a COLD link. A short glitch-absorbing warm-up isn't
# enough when the speaker is asleep in standby: Echo/Alexa keep the ACL link up
# (so `connect` no-ops) and aplay reports success even though the speaker's amp
# is still powering up — so the real track plays into a still-waking speaker and
# is lost, yet the system sees "finished" with no error. We stream this many
# seconds of silence on a cold link to cover the wake-from-standby latency, so
# the real track lands on an awake, rendering speaker. Env-tunable.
COLD_WARMUP_SECONDS = float(os.getenv("AUDIO_COLD_WARMUP", "4.0"))

# The A2DP transport often just needs a moment to come up after a connect. We
# wait this long and retry before falling back to a forced reconnect (which
# makes the speaker chime and resets the link).
A2DP_SETTLE = 2.0

# How long a device stays "warm" after its last successful play. Within this
# window a new play reuses the still-up A2DP link and skips the warm-up (no
# glitch, no reconnect chime). Kept shorter than the speaker's own A2DP idle
# timeout so we don't treat a link the speaker already dropped as warm.
WARM_GRACE_SECONDS = 30.0

# Alexa speakers may drop the Classic/A2DP link after a period without audio.
# Reconnect periodically after the first successful play so the next track does
# not have to discover a dead link. Set to 0 to disable this behavior.
KEEPALIVE_INTERVAL = float(os.getenv("AUDIO_KEEPALIVE_INTERVAL", "20"))

# aplay/bluealsa errors that all mean "A2DP link isn't ready to stream yet": the
# device is connected at ACL level but the audio transport isn't up, so the PCM
# is missing OR exists without a valid codec config (hw params won't install).
_LINK_NOT_READY = (
    b"PCM not found", b"No such device",
    b"Unable to install hw params", b"set_params", b"Input/output error",
)


def _link_not_ready(aplay_err: bytes) -> bool:
    return any(m in aplay_err for m in _LINK_NOT_READY)


def _snip(err: bytes, n: int = 200) -> str:
    """Trim a subprocess error blob for inclusion in a diagnostic event."""
    return (err or b"").decode(errors="replace").strip()[-n:]


class AudioService:
    def __init__(self) -> None:
        self._pending: List[Dict[str, Any]] = []
        self._current: Optional[Dict[str, Any]] = None
        self._ffmpeg: Optional[asyncio.subprocess.Process] = None
        self._aplay: Optional[asyncio.subprocess.Process] = None
        self._loop_task: Optional[asyncio.Task] = None
        self._wake = asyncio.Event()
        self._interrupt = False  # set when skip/stop kills the current track
        self._paused = False
        self._priming = False  # true while a silent warm-up open is in flight
        self._counter = 0
        # Elapsed-time tracking for the progress bar: _elapsed_base is seconds
        # already played (across pauses/seeks), _track_started_at is when the
        # current segment began (None while paused/idle).
        self._track_started_at: Optional[float] = None
        self._elapsed_base: float = 0.0
        # Bounded play history so `previous()` can go back; a lone track with
        # nothing before it in history simply has no previous (by design).
        self._history: List[Dict[str, Any]] = []
        self._repeat: str = "off"  # "off" | "one"
        self._shuffled: bool = False
        self._seek_offset: Optional[float] = None  # set by seek(), consumed by _run()
        # Why the current track was killed, so _run() knows whether to push it
        # to history: "previous" already re-queues it itself, "stop" means a
        # full reset (nothing to remember); skip()/play_now() preemption and a
        # natural finish should still be rememberable via `previous()`.
        self._interrupt_reason: Optional[str] = None
        # Address whose A2DP link is warm, and the monotonic time until which it
        # stays warm (see WARM_GRACE_SECONDS). The first play to a cold device
        # gets a throwaway silent warm-up open; plays within the warm window
        # reuse the live link and skip it (no glitch, no reconnect chime).
        self._warm_device: Optional[str] = None
        self._warm_until: float = 0.0
        self._keepalive_task: Optional[asyncio.Task] = None
        self._keepalive_device: Optional[str] = None

    # ---- public API ------------------------------------------------------
    def _current_elapsed(self) -> float:
        if self._track_started_at is None:
            return self._elapsed_base
        return self._elapsed_base + (time.monotonic() - self._track_started_at)

    def status(self) -> Dict[str, Any]:
        return {
            "playing": self._current is not None,
            "current": self._current,
            "queue": list(self._pending),
            "queue_length": len(self._pending),
            "paused": self._paused,
            "priming": self._priming,
            "position": round(self._current_elapsed(), 1) if self._current else 0,
            "repeat": self._repeat,
            "shuffled": self._shuffled,
            "has_previous": bool(self._history),
        }

    def enqueue(self, source: str, device: str, label: Optional[str] = None,
                source_type: str = "url", duration: Optional[float] = None,
                title: Optional[str] = None, artist: Optional[str] = None,
                cover_url: Optional[str] = None) -> Dict[str, Any]:
        self._counter += 1
        item = {"id": self._counter, "source": source, "device": device,
                "label": label or (os.path.basename(source) if "://" not in source else source),
                "source_type": source_type, "duration": duration,
                "title": title, "artist": artist, "cover_url": cover_url}
        self._pending.append(item)
        bus.publish("audio_enqueued", **item)
        self._ensure_loop()
        self._wake.set()
        return self.status()

    async def play_now(self, source: str, device: str, label: Optional[str] = None,
                        source_type: str = "url", duration: Optional[float] = None,
                        title: Optional[str] = None, artist: Optional[str] = None,
                        cover_url: Optional[str] = None) -> Dict[str, Any]:
        """Insert at the front of the queue and preempt whatever is currently
        playing so it starts immediately (the preempted track is dropped, not
        re-queued — same semantics as `skip`)."""
        self._counter += 1
        item = {"id": self._counter, "source": source, "device": device,
                "label": label or (os.path.basename(source) if "://" not in source else source),
                "source_type": source_type, "duration": duration,
                "title": title, "artist": artist, "cover_url": cover_url}
        self._pending.insert(0, item)
        bus.publish("audio_enqueued", **item, immediate=True)
        self._ensure_loop()
        if self._current is not None:
            await self._kill_current(interrupt=True, reason="play_now")
            bus.publish("audio_skipped", reason="play_now")
        else:
            self._wake.set()
        return self.status()

    async def skip(self) -> Dict[str, Any]:
        """Stop the current track and move on to the next in the queue."""
        await self._kill_current(interrupt=True, reason="skip")
        bus.publish("audio_skipped")
        return self.status()

    async def stop(self) -> Dict[str, Any]:
        """Stop playback and clear the whole queue (and play history — a full
        stop is a clean reset, nothing left to go 'previous' back to)."""
        self._pending.clear()
        self._history.clear()
        await self._kill_current(interrupt=True, reason="stop")
        bus.publish("audio_stopped")
        return self.status()

    async def pause(self) -> Dict[str, Any]:
        """Freeze the live ffmpeg->aplay pipe in place via SIGSTOP — no data
        loss, resumes exactly where it left off. No-op if idle or already
        paused. Distinct from `stop`: the queue and current track are kept."""
        if self._current is None or self._paused:
            return self.status()
        self._paused = True
        self._elapsed_base = self._current_elapsed()
        self._track_started_at = None
        for proc in (self._ffmpeg, self._aplay):
            if proc is not None and proc.returncode is None:
                try:
                    proc.send_signal(signal.SIGSTOP)
                except ProcessLookupError:
                    pass
        bus.publish("audio_paused", source=self._current.get("source"), device=self._current.get("device"))
        return self.status()

    async def resume(self) -> Dict[str, Any]:
        """Reverse of `pause`: SIGCONT both subprocesses. No-op if not paused."""
        if not self._paused:
            return self.status()
        self._paused = False
        self._track_started_at = time.monotonic()
        for proc in (self._ffmpeg, self._aplay):
            if proc is not None and proc.returncode is None:
                try:
                    proc.send_signal(signal.SIGCONT)
                except ProcessLookupError:
                    pass
        bus.publish("audio_resumed", source=self._current.get("source") if self._current else None)
        return self.status()

    async def seek(self, position: float) -> Dict[str, Any]:
        """Jump to `position` seconds into the current track. Restarts the
        live ffmpeg->aplay pipe with an ffmpeg input-seek flag — there's no
        seekable buffer to rewind, so this kills and re-opens the stream at
        the new offset. `_run()` sees `_seek_offset` set and replays the same
        queue item instead of advancing, so this doesn't consume a track or
        touch the queue/history."""
        if self._current is None:
            return self.status()
        self._seek_offset = max(0.0, position)
        # Report the target position immediately and freeze the clock there
        # (rather than leaving the old _track_started_at running) — otherwise
        # _current_elapsed() keeps climbing from the OLD position for the
        # ~0.5-1s the restart takes (BLE scan pause + settle + reconnect),
        # and a poll landing in that window shows a confusing third value
        # between "where it was" and "where I dragged to" before finally
        # settling. _play_locked sets these same two fields again once the
        # real segment actually starts, so there's no visible jump either way.
        self._elapsed_base = self._seek_offset
        self._track_started_at = None
        for proc in (self._aplay, self._ffmpeg):
            if proc is not None and proc.returncode is None:
                proc.kill()
        return self.status()

    async def previous(self) -> Dict[str, Any]:
        """Replay the track that was playing before the current one. No-op
        (nothing to do) if there's no history — e.g. a single ad-hoc track
        with nothing queued before it."""
        if not self._history:
            return self.status()
        prev_item = self._history.pop()
        if self._current is not None:
            self._pending.insert(0, self._current)
        self._pending.insert(0, prev_item)
        await self._kill_current(interrupt=True, reason="previous")
        bus.publish("audio_previous")
        return self.status()

    def set_repeat(self, mode: str) -> Dict[str, Any]:
        if mode not in ("off", "one"):
            raise ValueError("repeat must be 'off' or 'one'")
        self._repeat = mode
        return self.status()

    def set_shuffle(self, enabled: bool) -> Dict[str, Any]:
        """Toggle shuffle. Turning it on reorders the upcoming queue once —
        this is a simple FIFO queue, not a persistent playlist, so there's no
        "original order" to restore when turning it back off."""
        self._shuffled = enabled
        if enabled:
            random.shuffle(self._pending)
            bus.publish("audio_reordered", reason="shuffle")
        return self.status()

    def clear_queue(self) -> Dict[str, Any]:
        self._pending.clear()
        return self.status()

    def remove(self, item_id: int) -> Dict[str, Any]:
        for index, item in enumerate(self._pending):
            if item["id"] == item_id:
                self._pending.pop(index)
                bus.publish("audio_removed", **item)
                break
        else:
            raise KeyError("queued item not found")
        return self.status()

    def move(self, item_id: int, direction: int) -> Dict[str, Any]:
        index = next((i for i, item in enumerate(self._pending) if item["id"] == item_id), None)
        if index is None:
            raise KeyError("queued item not found")
        new_index = index + direction
        if not 0 <= new_index < len(self._pending):
            return self.status()
        self._pending[index], self._pending[new_index] = self._pending[new_index], self._pending[index]
        bus.publish("audio_reordered", item_id=item_id, direction=direction)
        return self.status()

    # ---- internals -------------------------------------------------------
    def _ensure_loop(self) -> None:
        if self._loop_task is None or self._loop_task.done():
            self._loop_task = asyncio.create_task(self._run())

    async def _run(self) -> None:
        while True:
            if not self._pending:
                # Don't reset warmth here: the speaker keeps the A2DP link up for
                # a while after playback, so a play shortly after another should
                # still skip the warm-up. Warmth expires by time (WARM_GRACE).
                self._wake.clear()
                await self._wake.wait()
                continue
            item = self._pending.pop(0)
            self._current = item
            self._interrupt_reason = None
            start_at = 0.0
            while True:
                self._seek_offset = None
                await self._play_one(item, start_at=start_at)
                if self._seek_offset is not None:
                    # User seeked mid-track: replay the same item at the new
                    # offset instead of treating this as "track finished".
                    start_at = self._seek_offset
                    continue
                break
            reason = self._interrupt_reason
            if reason in ("previous", "stop"):
                # previous() already re-queued this item itself; stop() wants
                # a clean reset — neither should be remembered again here.
                pass
            elif reason is None and self._repeat == "one":
                # Natural finish with repeat-one: play it again, not history.
                self._pending.insert(0, item)
            else:
                # Natural finish (repeat off), or skip()/play_now() moved
                # away from it — either way `previous()` should recover it.
                self._history.append(item)
                self._history[:] = self._history[-50:]
            self._current = None

    async def _connect(self, device: str, force: bool = False) -> str:
        """Ensure the speaker is connected. Returns a short status for
        diagnostics: "already" (fast-path hit — was connected at ACL level),
        "connected", or "failed"."""
        # Fast path: if already connected, skip — reconnecting makes some
        # speakers (Echo/Alexa) re-announce "connected". `force` runs connect
        # anyway, which also brings up the A2DP profile bluez-alsa needs.
        if not force:
            info = await asyncio.create_subprocess_exec(
                "bluetoothctl", "info", device,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
            )
            out, _ = await info.communicate()
            if "connected: yes" in (out or b"").decode(errors="replace").lower():
                return "already"

        proc = await asyncio.create_subprocess_exec(
            "bluetoothctl", "connect", device,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
        )
        out, _ = await proc.communicate()
        text = (out or b"").decode(errors="replace")
        ok = "successful" in text.lower() or "already" in text.lower()
        if not ok:
            bus.publish("audio_connect", level="warn", device=device,
                        detail=text.strip()[-200:])
        return "connected" if ok else "failed"

    async def _a2dp_pcm_available(self, device: str) -> bool:
        """Check the audio profile, not just the ACL connection state."""
        proc = await asyncio.create_subprocess_exec(
            "aplay", "-L", stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        out, _ = await proc.communicate()
        return f"bluealsa:DEV={device}".lower().encode() in (out or b"").lower()

    async def _pipe(self, ffmpeg_in: List[str], device: str) -> tuple[int, bytes, bytes]:
        """Decode `ffmpeg_in` and stream it to the speaker's bluez-alsa PCM."""
        # Wrap the bluez-alsa PCM in ALSA's `plug` for automatic rate/format
        # conversion (44.1kHz on many speakers, 48kHz on Echo/Alexa). The explicit
        # plug:{SLAVE="..."} form is required — `plug:bluealsa:DEV=...` fails to
        # parse (the commas confuse plug's argument parser).
        pcm = f'plug:{{SLAVE="bluealsa:DEV={device},PROFILE=a2dp"}}'
        read_fd, write_fd = os.pipe()
        self._ffmpeg = await asyncio.create_subprocess_exec(
            "ffmpeg", "-hide_banner", "-loglevel", "warning", *ffmpeg_in,
            "-vn", "-ar", "44100", "-ac", "2", "-f", "wav", "pipe:1",
            stdout=write_fd, stderr=asyncio.subprocess.PIPE,
        )
        os.close(write_fd)
        self._aplay = await asyncio.create_subprocess_exec(
            "aplay", "-D", pcm, "-q",
            stdin=read_fd, stderr=asyncio.subprocess.PIPE,
        )
        os.close(read_fd)
        _, aplay_err = await self._aplay.communicate()
        code = self._aplay.returncode
        if self._ffmpeg.returncode is None:
            self._ffmpeg.kill()
        ffmpeg_err = b""
        try:
            _, ffmpeg_err = await asyncio.wait_for(self._ffmpeg.communicate(), timeout=3)
        except asyncio.TimeoutError:
            pass
        self._ffmpeg = self._aplay = None
        return code, aplay_err or b"", ffmpeg_err or b""

    async def _run_pipe(self, source: str, device: str, start_at: float = 0.0) -> tuple[int, bytes, bytes]:
        # `-re` reads the file at native rate so ffmpeg doesn't buffer it all up
        # front; aplay paces the actual playback on the A2DP PCM. `-ss` before
        # `-i` is an input seek (fast, keyframe-based) — how `seek()` jumps to
        # a position without a locally-seekable buffer to rewind.
        args = ["-re"]
        if start_at > 0:
            args += ["-ss", str(start_at)]
        args += ["-i", source]
        return await self._pipe(args, device)

    async def _warm_up(self, device: str, seconds: float) -> tuple[int, bytes, bytes]:
        # Throwaway silent open: on some speakers the FIRST aplay open after a
        # (re)connect glitches its output, while a second, separate open is
        # clean. Streaming generated silence here takes that hit inaudibly so
        # the real track (the next open) comes out clean. On a cold link the
        # longer duration also covers the speaker's wake-from-standby latency.
        return await self._pipe(
            ["-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
             "-t", str(seconds)], device)

    async def _prime(self, device: str, seconds: float, kind: str) -> None:
        """Warm the link with a silent open; if A2DP isn't up yet, settle and
        try once more so the real open lands on a ready, already-primed link.
        `kind` ("cold"/"recovery") is for diagnostics only."""
        self._priming = True
        try:
            for attempt in (1, 2):
                t0 = time.monotonic()
                code, aplay_err, _ = await self._warm_up(device, seconds)
                bus.publish("audio_prime", level="debug", device=device, kind=kind,
                            attempt=attempt, seconds=seconds, code=code,
                            link_ready=not _link_not_ready(aplay_err),
                            ms=round((time.monotonic() - t0) * 1000),
                            detail=_snip(aplay_err))
                if not (code != 0 and not self._interrupt and _link_not_ready(aplay_err)):
                    return
                if attempt == 1:
                    await asyncio.sleep(A2DP_SETTLE)
        finally:
            self._priming = False

    async def _play_one(self, item: Dict[str, Any], start_at: float = 0.0) -> None:
        source, device = item["source"], item["device"]
        self._interrupt = False
        self._paused = False
        # Pause BLE discovery for the whole play: a running inquiry makes the
        # BR/EDR A2DP connect fail with "br-connection-profile-unavailable" and
        # also glitches the stream. Restored in the finally below.
        await ble.pause_scan()
        await asyncio.sleep(0.5)  # let BlueZ fully stop the inquiry first
        try:
            await self._play_locked(item, source, device, start_at=start_at)
        finally:
            await ble.resume_scan()

    async def _play_locked(self, item: Dict[str, Any], source: str, device: str, start_at: float = 0.0) -> None:
        if settings.MOCK_HARDWARE:
            return await self._play_locked_mock(item, source, device, start_at)

        t_begin = time.monotonic()
        # Cold link = first play, or first after the warm window expired.
        cold = device != self._warm_device or time.monotonic() > self._warm_until
        warm_left = round(max(0.0, self._warm_until - time.monotonic()), 1)

        conn = await self._connect(device)
        # Diagnostic snapshot of the decision inputs — the data we need to tell a
        # swallowed cold play apart from a genuine failure after the fact.
        bus.publish("audio_play_begin", level="debug", source=source, device=device,
                    cold=cold, warm_left_s=warm_left, connect=conn,
                    queue_length=len(self._pending))
        bus.publish("audio_started", source=source, device=device,
                    queue_length=len(self._pending))

        # Cold link: the first PCM open glitches on some speakers AND the speaker
        # may still be waking from standby, so open once on throwaway silence
        # (long enough to cover the wake) before streaming the real track. Plays
        # within the warm window reuse the live link and skip this.
        if cold and not self._interrupt:
            await self._prime(device, COLD_WARMUP_SECONDS, kind="cold")

        if self._interrupt:
            return

        # This is where actual audio starts (priming above was silence), so
        # the elapsed clock for the progress bar starts here.
        self._elapsed_base = start_at
        self._track_started_at = time.monotonic()

        attempts = 1
        t0 = time.monotonic()
        code, aplay_err, ffmpeg_err = await self._run_pipe(source, device, start_at=start_at)
        bus.publish("audio_track", level="debug", device=device, attempt=attempts,
                    code=code, link_ready=not _link_not_ready(aplay_err),
                    ms=round((time.monotonic() - t0) * 1000),
                    aplay_err=_snip(aplay_err), ffmpeg_err=_snip(ffmpeg_err))

        # A seek() kill looks like a plain process-killed exit (no aplay error
        # text about a missing PCM), not a "link not ready" failure — bail out
        # here without treating it as one; _run()'s outer loop replays this
        # same item at the new offset.
        if self._seek_offset is not None:
            return

        if code != 0 and not self._interrupt and _link_not_ready(aplay_err):
            # A2DP still not up — force a real reconnect (may make the speaker
            # chime), re-prime, and try the real track once more.
            bus.publish("audio_reconnect", level="warn", device=device,
                        reason=_snip(aplay_err) or f"aplay exit {code}")
            await self._connect(device, force=True)
            await self._prime(device, WARMUP_SECONDS, kind="recovery")
            attempts = 2
            t0 = time.monotonic()
            code, aplay_err, ffmpeg_err = await self._run_pipe(source, device, start_at=start_at)
            bus.publish("audio_track", level="debug", device=device, attempt=attempts,
                        code=code, link_ready=not _link_not_ready(aplay_err),
                        ms=round((time.monotonic() - t0) * 1000),
                        aplay_err=_snip(aplay_err), ffmpeg_err=_snip(ffmpeg_err))
            if self._seek_offset is not None:
                return

        if self._interrupt:
            return  # skip/stop already published its own event
        total_ms = round((time.monotonic() - t_begin) * 1000)
        if code == 0:
            # Keep the link warm for a grace window so a nearby next play skips
            # the warm-up (and its reconnect chime).
            self._warm_device = device
            self._warm_until = time.monotonic() + WARM_GRACE_SECONDS
            self._start_keepalive(device)
            bus.publish("audio_finished", source=source, device=device,
                        from_cold=cold, attempts=attempts, total_ms=total_ms)
        else:
            msg = _snip(aplay_err or ffmpeg_err, 400)
            bus.publish("error", where="audio", source=source, device=device,
                        attempts=attempts, total_ms=total_ms,
                        message=msg or f"aplay exit {code}")

    async def _play_locked_mock(self, item: Dict[str, Any], source: str, device: str, start_at: float = 0.0) -> None:
        """MOCK_HARDWARE stand-in for _play_locked: no bluetoothctl/ffmpeg/aplay
        exist to shell out to (dev machine, no real speaker), so instead of
        producing real audio we just advance the elapsed clock in small ticks
        — pause/resume/seek/skip/stop/previous/repeat all still work exactly
        as they would against a real track, which is the point: it lets the
        whole player UI be exercised end-to-end without real hardware."""
        duration = item.get("duration") or MOCK_FALLBACK_DURATION
        self._elapsed_base = start_at
        self._track_started_at = time.monotonic()
        bus.publish("audio_started", source=source, device=device,
                    queue_length=len(self._pending), mock=True)

        while self._current_elapsed() < duration:
            if self._interrupt or self._seek_offset is not None:
                return
            await asyncio.sleep(MOCK_TICK_SECONDS)

        if self._interrupt or self._seek_offset is not None:
            return
        bus.publish("audio_finished", source=source, device=device,
                    from_cold=False, attempts=1, total_ms=round(duration * 1000), mock=True)

    def _start_keepalive(self, device: str) -> None:
        if KEEPALIVE_INTERVAL <= 0:
            return
        self._keepalive_device = device
        if self._keepalive_task is None or self._keepalive_task.done():
            self._keepalive_task = asyncio.create_task(self._keepalive_loop())

    async def _keepalive_loop(self) -> None:
        while KEEPALIVE_INTERVAL > 0 and self._keepalive_device:
            await asyncio.sleep(KEEPALIVE_INTERVAL)
            if self._current is not None:
                continue
            device = self._keepalive_device
            try:
                # Discovery can make bluetoothctl select the Alexa's LE
                # endpoint and abort locally instead of bringing up Classic
                # A2DP. Match the playback path and stop inquiry first.
                await ble.pause_scan()
                await asyncio.sleep(0.5)
                try:
                    result = await self._connect(device)
                    if result == "already" and not await self._a2dp_pcm_available(device):
                        result = await self._connect(device, force=True)
                finally:
                    await ble.resume_scan()
                bus.publish("audio_keepalive", level="debug", device=device,
                            result=result)
            except Exception as exc:  # noqa: BLE001 - retry on the next interval
                bus.publish("audio_keepalive", level="warn", device=device,
                            result="failed", detail=str(exc)[-200:])

    async def _kill_current(self, interrupt: bool, reason: Optional[str] = None) -> None:
        self._interrupt = interrupt
        self._interrupt_reason = reason
        self._paused = False
        # Same reasoning as seek(): freeze the reported position at 0 right
        # away instead of leaving the old clock running through the
        # skip/stop/previous restart delay — the next track (or previous()'s
        # resurrected one) always starts at 0 anyway, so this can't disagree
        # with what _play_locked sets moments later.
        self._elapsed_base = 0.0
        self._track_started_at = None
        for proc in (self._aplay, self._ffmpeg):
            if proc is not None and proc.returncode is None:
                proc.kill()
                try:
                    await asyncio.wait_for(proc.wait(), timeout=3)
                except asyncio.TimeoutError:
                    pass


audio = AudioService()
