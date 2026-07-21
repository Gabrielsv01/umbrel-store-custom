"""Audio streaming to a Bluetooth A2DP speaker via bluez-alsa (self-contained).

The container runs its own bluez-alsa daemon (bluealsad -p a2dp-source), so we
don't need any audio server on the host. To play we:
  1. make sure the speaker is connected (bluetoothctl connect <MAC>), which makes
     bluealsad expose an ALSA PCM `bluealsa:DEV=<MAC>,PROFILE=a2dp`;
  2. decode the file/URL with ffmpeg and pipe raw PCM into `aplay` on that device.

Best-effort: needs a real adapter + a speaker that has been paired once. One
stream at a time (KISS). Errors are surfaced on the event bus (Logs tab).
"""
from __future__ import annotations

import asyncio
import os
from typing import Any, Dict, Optional

from ..core.events import bus


class AudioService:
    def __init__(self) -> None:
        self._ffmpeg: Optional[asyncio.subprocess.Process] = None
        self._aplay: Optional[asyncio.subprocess.Process] = None
        self._label: Optional[str] = None
        self._device: Optional[str] = None

    def status(self) -> Dict[str, Any]:
        playing = self._aplay is not None and self._aplay.returncode is None
        return {
            "playing": playing,
            "source": self._label if playing else None,
            "device": self._device if playing else None,
        }

    async def _connect(self, device: str) -> None:
        proc = await asyncio.create_subprocess_exec(
            "bluetoothctl", "connect", device,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
        )
        out, _ = await proc.communicate()
        text = (out or b"").decode(errors="replace")
        if "Connection successful" not in text and "already" not in text.lower():
            # Not fatal on its own — the device may already be connected — but
            # record it so failures are visible.
            bus.publish("audio_connect", device=device, detail=text.strip()[-200:])

    async def play(self, source: str, device: str) -> Dict[str, Any]:
        await self.stop()  # only one stream at a time
        await self._connect(device)

        pcm = f"bluealsa:DEV={device},PROFILE=a2dp"
        # Connect ffmpeg -> aplay with a real OS pipe (asyncio can't chain a
        # subprocess StreamReader into another subprocess's stdin).
        read_fd, write_fd = os.pipe()
        # ffmpeg decodes anything (file or URL) to 44.1kHz/16-bit stereo WAV.
        self._ffmpeg = await asyncio.create_subprocess_exec(
            "ffmpeg", "-hide_banner", "-loglevel", "warning", "-re", "-i", source,
            "-vn", "-ar", "44100", "-ac", "2", "-f", "wav", "pipe:1",
            stdout=write_fd, stderr=asyncio.subprocess.PIPE,
        )
        os.close(write_fd)
        self._aplay = await asyncio.create_subprocess_exec(
            "aplay", "-D", pcm, "-q",
            stdin=read_fd, stderr=asyncio.subprocess.PIPE,
        )
        os.close(read_fd)
        self._label = source
        self._device = device
        bus.publish("audio_started", source=source, device=device)
        asyncio.create_task(self._monitor(self._ffmpeg, self._aplay, source, device))
        return self.status()

    async def _monitor(self, ffmpeg, aplay, label, device) -> None:
        _, aplay_err = await aplay.communicate()
        # aplay finished (stream ended or errored); stop ffmpeg if still running.
        if ffmpeg.returncode is None:
            ffmpeg.kill()
        ffmpeg_err = b""
        try:
            _, ffmpeg_err = await asyncio.wait_for(ffmpeg.communicate(), timeout=3)
        except asyncio.TimeoutError:
            pass
        if aplay is self._aplay:
            self._ffmpeg = self._aplay = self._label = self._device = None
        code = aplay.returncode
        if code == 0:
            bus.publish("audio_finished", source=label, device=device)
        else:
            msg = (aplay_err or ffmpeg_err or b"").decode(errors="replace")[-400:]
            bus.publish("error", where="audio", source=label, device=device,
                        message=msg or f"aplay exit {code}")

    async def stop(self) -> Dict[str, Any]:
        procs = [p for p in (self._aplay, self._ffmpeg) if p is not None]
        self._ffmpeg = self._aplay = self._label = self._device = None
        stopped = False
        for proc in procs:
            if proc.returncode is None:
                proc.kill()
                stopped = True
                try:
                    await asyncio.wait_for(proc.wait(), timeout=3)
                except asyncio.TimeoutError:
                    pass
        if stopped:
            bus.publish("audio_stopped")
        return {"playing": False}


audio = AudioService()
