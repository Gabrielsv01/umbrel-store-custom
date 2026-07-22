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
import time
from typing import Any, Dict, List, Optional

from ..core.events import bus
from .bluetooth import ble

# Duration of the throwaway "warm-up" silence played on a cold A2DP link before
# the real audio (see _warm_up). On some speakers (Echo/Alexa) the FIRST aplay
# open after a (re)connect glitches its output while a second, separate open is
# clean — so we sacrifice this silent open and the real track comes out clean.
# Env-tunable (kept as AUDIO_RECONNECT_DELAY for backward compatibility).
WARMUP_SECONDS = float(os.getenv("AUDIO_RECONNECT_DELAY", "1.5"))

# The A2DP transport often just needs a moment to come up after a connect. We
# wait this long and retry before falling back to a forced reconnect (which
# makes the speaker chime and resets the link).
A2DP_SETTLE = 2.0

# How long a device stays "warm" after its last successful play. Within this
# window a new play reuses the still-up A2DP link and skips the warm-up (no
# glitch, no reconnect chime). Kept shorter than the speaker's own A2DP idle
# timeout so we don't treat a link the speaker already dropped as warm.
WARM_GRACE_SECONDS = 30.0

# aplay/bluealsa errors that all mean "A2DP link isn't ready to stream yet": the
# device is connected at ACL level but the audio transport isn't up, so the PCM
# is missing OR exists without a valid codec config (hw params won't install).
_LINK_NOT_READY = (
    b"PCM not found", b"No such device",
    b"Unable to install hw params", b"set_params", b"Input/output error",
)


def _link_not_ready(aplay_err: bytes) -> bool:
    return any(m in aplay_err for m in _LINK_NOT_READY)


class AudioService:
    def __init__(self) -> None:
        self._pending: List[Dict[str, Any]] = []
        self._current: Optional[Dict[str, Any]] = None
        self._ffmpeg: Optional[asyncio.subprocess.Process] = None
        self._aplay: Optional[asyncio.subprocess.Process] = None
        self._loop_task: Optional[asyncio.Task] = None
        self._wake = asyncio.Event()
        self._interrupt = False  # set when skip/stop kills the current track
        self._counter = 0
        # Address whose A2DP link is warm, and the monotonic time until which it
        # stays warm (see WARM_GRACE_SECONDS). The first play to a cold device
        # gets a throwaway silent warm-up open; plays within the warm window
        # reuse the live link and skip it (no glitch, no reconnect chime).
        self._warm_device: Optional[str] = None
        self._warm_until: float = 0.0

    # ---- public API ------------------------------------------------------
    def status(self) -> Dict[str, Any]:
        return {
            "playing": self._current is not None,
            "current": self._current,
            "queue": list(self._pending),
            "queue_length": len(self._pending),
        }

    def enqueue(self, source: str, device: str) -> Dict[str, Any]:
        self._counter += 1
        item = {"id": self._counter, "source": source, "device": device,
                "label": os.path.basename(source) if "://" not in source else source}
        self._pending.append(item)
        bus.publish("audio_enqueued", **item)
        self._ensure_loop()
        self._wake.set()
        return self.status()

    async def skip(self) -> Dict[str, Any]:
        """Stop the current track and move on to the next in the queue."""
        await self._kill_current(interrupt=True)
        bus.publish("audio_skipped")
        return self.status()

    async def stop(self) -> Dict[str, Any]:
        """Stop playback and clear the whole queue."""
        self._pending.clear()
        await self._kill_current(interrupt=True)
        bus.publish("audio_stopped")
        return self.status()

    def clear_queue(self) -> Dict[str, Any]:
        self._pending.clear()
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
            await self._play_one(item)
            self._current = None

    async def _connect(self, device: str, force: bool = False) -> None:
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
                return

        proc = await asyncio.create_subprocess_exec(
            "bluetoothctl", "connect", device,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
        )
        out, _ = await proc.communicate()
        text = (out or b"").decode(errors="replace")
        if "successful" not in text.lower() and "already" not in text.lower():
            bus.publish("audio_connect", device=device, detail=text.strip()[-200:])

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

    async def _run_pipe(self, source: str, device: str) -> tuple[int, bytes, bytes]:
        # `-re` reads the file at native rate so ffmpeg doesn't buffer it all up
        # front; aplay paces the actual playback on the A2DP PCM.
        return await self._pipe(["-re", "-i", source], device)

    async def _warm_up(self, device: str) -> tuple[int, bytes, bytes]:
        # Throwaway silent open: on some speakers the FIRST aplay open after a
        # (re)connect glitches its output, while a second, separate open is
        # clean. Streaming generated silence here takes that hit inaudibly so
        # the real track (the next open) comes out clean.
        return await self._pipe(
            ["-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
             "-t", str(WARMUP_SECONDS)], device)

    async def _prime(self, device: str) -> None:
        """Warm the link with a silent open; if A2DP isn't up yet, settle and
        try once more so the real open lands on a ready, already-primed link."""
        code, aplay_err, _ = await self._warm_up(device)
        if code != 0 and not self._interrupt and _link_not_ready(aplay_err):
            await asyncio.sleep(A2DP_SETTLE)
            await self._warm_up(device)

    async def _play_one(self, item: Dict[str, Any]) -> None:
        source, device = item["source"], item["device"]
        self._interrupt = False
        # Pause BLE discovery for the whole play: a running inquiry makes the
        # BR/EDR A2DP connect fail with "br-connection-profile-unavailable" and
        # also glitches the stream. Restored in the finally below.
        await ble.pause_scan()
        await asyncio.sleep(0.5)  # let BlueZ fully stop the inquiry first
        try:
            await self._play_locked(item, source, device)
        finally:
            await ble.resume_scan()

    async def _play_locked(self, item: Dict[str, Any], source: str, device: str) -> None:
        await self._connect(device)
        bus.publish("audio_started", source=source, device=device,
                    queue_length=len(self._pending))

        # Cold link (first play, or first after the warm window expired): the
        # first PCM open glitches on some speakers, so open once on throwaway
        # silence to take that hit, then stream the real track on a clean second
        # open. Plays within the warm window reuse the live link and skip this.
        cold = device != self._warm_device or time.monotonic() > self._warm_until
        if cold and not self._interrupt:
            await self._prime(device)

        if self._interrupt:
            return

        code, aplay_err, ffmpeg_err = await self._run_pipe(source, device)

        if code != 0 and not self._interrupt and _link_not_ready(aplay_err):
            # A2DP still not up — force a real reconnect (may make the speaker
            # chime), re-prime, and try the real track once more.
            await self._connect(device, force=True)
            await self._prime(device)
            code, aplay_err, ffmpeg_err = await self._run_pipe(source, device)

        if self._interrupt:
            return  # skip/stop already published its own event
        if code == 0:
            # Keep the link warm for a grace window so a nearby next play skips
            # the warm-up (and its reconnect chime).
            self._warm_device = device
            self._warm_until = time.monotonic() + WARM_GRACE_SECONDS
            bus.publish("audio_finished", source=source, device=device)
        else:
            msg = (aplay_err or ffmpeg_err).decode(errors="replace")[-400:]
            bus.publish("error", where="audio", source=source, device=device,
                        message=msg or f"aplay exit {code}")

    async def _kill_current(self, interrupt: bool) -> None:
        self._interrupt = interrupt
        for proc in (self._aplay, self._ffmpeg):
            if proc is not None and proc.returncode is None:
                proc.kill()
                try:
                    await asyncio.wait_for(proc.wait(), timeout=3)
                except asyncio.TimeoutError:
                    pass


audio = AudioService()
