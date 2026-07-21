"""Bluetooth Classic (BR/EDR) management for speakers/headsets.

BLE (bleak) discovery only sees Low Energy interfaces; A2DP speakers live on
Classic BR/EDR. We drive pairing/connection through `bluetoothctl`, which brings
its own pairing agent (handles Just Works pairing without a PIN). Each call is a
one-shot, non-interactive invocation.
"""
from __future__ import annotations

import asyncio
import re
from typing import Any, Dict, List

from ..core.events import bus

_DEV_RE = re.compile(r"^Device\s+([0-9A-F:]{17})\s+(.*)$", re.IGNORECASE)


async def _btctl(*args: str, timeout: float = 20.0) -> str:
    proc = await asyncio.create_subprocess_exec(
        "bluetoothctl", *args,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
    )
    try:
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill()
        out = b""
    return (out or b"").decode(errors="replace")


def _parse_devices(text: str) -> Dict[str, str]:
    devices: Dict[str, str] = {}
    for line in text.splitlines():
        m = _DEV_RE.match(line.strip())
        if m:
            devices[m.group(1).upper()] = m.group(2).strip()
    return devices


class ClassicManager:
    async def scan(self, seconds: int = 15) -> List[Dict[str, Any]]:
        """Run a timed BR/EDR + LE inquiry, then return everything known."""
        bus.publish("classic_scan", state="start", seconds=seconds)
        await _btctl("--timeout", str(seconds), "scan", "on", timeout=seconds + 8)
        bus.publish("classic_scan", state="stop")
        return await self.devices()

    async def devices(self) -> List[Dict[str, Any]]:
        known = _parse_devices(await _btctl("devices"))
        paired = set(_parse_devices(await _btctl("paired-devices")).keys())
        connected = set(_parse_devices(await _btctl("devices", "Connected")).keys())
        return [
            {
                "address": addr,
                "name": name,
                "paired": addr in paired,
                "connected": addr in connected,
            }
            for addr, name in sorted(known.items(), key=lambda kv: kv[1].lower())
        ]

    async def _action(self, verb: str, address: str) -> Dict[str, Any]:
        text = await _btctl(verb, address, timeout=30)
        ok = any(
            s in text
            for s in ("successful", "already", "Changing", "Connected: yes")
        )
        bus.publish(
            "classic_action",
            level=None if ok else "warn",
            verb=verb, device=address, ok=ok, detail=text.strip()[-200:],
        )
        return {"verb": verb, "device": address, "ok": ok, "detail": text.strip()[-400:]}

    async def pair(self, address: str) -> Dict[str, Any]:
        return await self._action("pair", address)

    async def trust(self, address: str) -> Dict[str, Any]:
        return await self._action("trust", address)

    async def connect(self, address: str) -> Dict[str, Any]:
        return await self._action("connect", address)

    async def disconnect(self, address: str) -> Dict[str, Any]:
        return await self._action("disconnect", address)


classic = ClassicManager()
