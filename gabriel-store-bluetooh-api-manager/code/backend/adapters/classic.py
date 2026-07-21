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

from dbus_fast import BusType
from dbus_fast.aio import MessageBus

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
        # BlueZ 5.66+ uses `devices Paired`/`Connected`; `paired-devices` is empty.
        paired = set(_parse_devices(await _btctl("devices", "Paired")).keys())
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

    async def set_device_alias(self, address: str, name: str) -> Dict[str, Any]:
        """Give a device a friendly name (BlueZ Device1.Alias). Persistent, and
        it's what `bluetoothctl devices` / our listing shows."""
        dbus = await MessageBus(bus_type=BusType.SYSTEM).connect()
        try:
            intro = await dbus.introspect("org.bluez", "/")
            obj = dbus.get_proxy_object("org.bluez", "/", intro)
            mgr = obj.get_interface("org.freedesktop.DBus.ObjectManager")
            managed = await mgr.call_get_managed_objects()
            path = None
            for p, ifaces in managed.items():
                dev = ifaces.get("org.bluez.Device1")
                if dev and "Address" in dev and dev["Address"].value.upper() == address.upper():
                    path = p
                    break
            if path is None:
                raise KeyError(f"device {address} not known to BlueZ")
            dintro = await dbus.introspect("org.bluez", path)
            dobj = dbus.get_proxy_object("org.bluez", path, dintro)
            await dobj.get_interface("org.bluez.Device1").set_alias(name)
            bus.publish("device_renamed", address=address, name=name)
            return {"address": address, "alias": name}
        finally:
            dbus.disconnect()

    async def set_adapter_name(self, name: str) -> Dict[str, Any]:
        """Rename the local adapter (what other devices see) via system-alias."""
        text = await _btctl("system-alias", name, timeout=10)
        bus.publish("adapter_renamed", name=name)
        return {"name": name, "detail": text.strip()[-200:]}

    async def pair_connect(self, address: str, scan_seconds: int = 25) -> Dict[str, Any]:
        """Pair + trust + connect, keeping discovery active the whole time.

        BlueZ evicts an unpaired device as soon as discovery stops, so we hold a
        scan running (in the background) until the device shows up and pairing
        completes. This is what makes "Pair + Connect" reliable from the UI.
        """
        bus.publish("classic_scan", state="start", seconds=scan_seconds)
        scan = await asyncio.create_subprocess_exec(
            "bluetoothctl", "--timeout", str(scan_seconds), "scan", "on",
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
        )
        try:
            appeared = False
            for _ in range(scan_seconds):
                info = await _btctl("info", address, timeout=5)
                if "not available" not in info.lower() and address.lower() in info.lower():
                    appeared = True
                    break
                await asyncio.sleep(1)
            pair = await self.pair(address)
            await self.trust(address)
            connect = await self.connect(address)
            return {
                "appeared": appeared,
                "ok": connect["ok"],
                "pair": pair,
                "connect": connect,
            }
        finally:
            try:
                scan.kill()
            except ProcessLookupError:
                pass
            bus.publish("classic_scan", state="stop")


classic = ClassicManager()
