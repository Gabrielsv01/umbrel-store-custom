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
from typing import Any, Dict, List, Optional

from ..core.events import bus
from .bluetooth import ble

# Seconds of *streamed silence* played before the real audio whenever the A2DP
# link is cold (first play, or a forced reconnect). Streaming silence — rather
# than waiting idle — brings the link fully up and keeps it warm, so the real
# audio starts clean instead of the speaker glitching/cutting its first seconds
# (and it covers any "connected" prompt). Tunable via env.
RECONNECT_DELAY = float(os.getenv("AUDIO_RECONNECT_DELAY", "4.5"))

# The A2DP transport often just needs a moment to come up after a connect. We
# wait this long and retry the stream *without* reconnecting before falling back
# to a forced reconnect (which makes the speaker chime and resets the link).
A2DP_SETTLE = 2.0

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
        # Address whose A2DP link is currently warm (we just streamed to it).
        # A cold link glitches its first seconds, so the first play to a cold
        # device gets a silent lead-in; back-to-back queued tracks skip it.
        self._warm_device: Optional[str] = None

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
                # Idle: the A2DP link will drop, so treat the next play as cold.
                self._warm_device = None
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

    async def _run_pipe(self, source: str, device: str,
                        lead_in: float = 0.0) -> tuple[int, bytes, bytes]:
        # Wrap the bluez-alsa PCM in ALSA's `plug` for automatic rate/format
        # conversion (44.1kHz on many speakers, 48kHz on Echo/Alexa). The explicit
        # plug:{SLAVE="..."} form is required — `plug:bluealsa:DEV=...` fails to
        # parse (the commas confuse plug's argument parser).
        pcm = f'plug:{{SLAVE="bluealsa:DEV={device},PROFILE=a2dp"}}'
        # `lead_in` prepends that many seconds of silence to the stream so aplay
        # keeps feeding the A2DP link (warm) while the speaker plays its connect
        # prompt — the real audio then starts on an already-open link.
        filters = ["-af", f"adelay=delays={int(lead_in * 1000)}:all=1"] if lead_in > 0 else []
        read_fd, write_fd = os.pipe()
        self._ffmpeg = await asyncio.create_subprocess_exec(
            "ffmpeg", "-hide_banner", "-loglevel", "warning", "-re", "-i", source,
            "-vn", *filters, "-ar", "44100", "-ac", "2", "-f", "wav", "pipe:1",
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

        # Cold link (first play, or first after the queue drained/idled): stream
        # a silent lead-in so the A2DP link is fully warm before the real audio,
        # otherwise the speaker glitches the first seconds. A back-to-back queued
        # track to the same device is already warm, so it skips the lead-in.
        cold = device != self._warm_device
        code, aplay_err, ffmpeg_err = await self._run_pipe(
            source, device, lead_in=RECONNECT_DELAY if cold else 0.0)

        if code != 0 and not self._interrupt and _link_not_ready(aplay_err):
            # First recover *without* reconnecting: the transport usually just
            # needs a moment after connect. Wait, then retry with a silent
            # lead-in that warms the link before the real audio. This avoids the
            # speaker's disconnect/reconnect chime and rough start in the common
            # case (device connected, A2DP a beat behind).
            await asyncio.sleep(A2DP_SETTLE)
            code, aplay_err, ffmpeg_err = await self._run_pipe(
                source, device, lead_in=RECONNECT_DELAY)

            if code != 0 and not self._interrupt and _link_not_ready(aplay_err):
                # Still not up — force a real reconnect (may make the speaker
                # chime) and try once more with the lead-in.
                await self._connect(device, force=True)
                code, aplay_err, ffmpeg_err = await self._run_pipe(
                    source, device, lead_in=RECONNECT_DELAY)

        if self._interrupt:
            return  # skip/stop already published its own event
        if code == 0:
            self._warm_device = device  # link is warm for the next queued track
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
