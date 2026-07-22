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

    async def _run_pipe(self, source: str, device: str) -> tuple[int, bytes, bytes]:
        # Wrap the bluez-alsa PCM in ALSA's `plug` for automatic rate/format
        # conversion (44.1kHz on many speakers, 48kHz on Echo/Alexa). The explicit
        # plug:{SLAVE="..."} form is required — `plug:bluealsa:DEV=...` fails to
        # parse (the commas confuse plug's argument parser).
        pcm = f'plug:{{SLAVE="bluealsa:DEV={device},PROFILE=a2dp"}}'
        read_fd, write_fd = os.pipe()
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
        await self._connect(device)
        bus.publish("audio_started", source=source, device=device,
                    queue_length=len(self._pending))

        code, aplay_err, ffmpeg_err = await self._run_pipe(source, device)

        # "PCM not found" = the A2DP link isn't up yet (device connected at ACL
        # level but the audio profile isn't). Force a real connect and retry once.
        pcm_missing = b"PCM not found" in aplay_err or b"No such device" in aplay_err
        if code != 0 and not self._interrupt and pcm_missing:
            await self._connect(device, force=True)
            await asyncio.sleep(2)
            code, aplay_err, ffmpeg_err = await self._run_pipe(source, device)

        if self._interrupt:
            return  # skip/stop already published its own event
        if code == 0:
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
