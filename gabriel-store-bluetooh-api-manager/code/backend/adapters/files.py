"""File transfer to a Bluetooth device via OBEX Object Push.

Uses the BlueZ OBEX D-Bus API (obexd), which lives on the SESSION bus — the
container starts its own session bus + obexd in entrypoint.sh. We drive it with
dbus-fast (already pulled in by bleak on Linux) instead of guessing CLI flags,
so it's version-independent.

Best-effort: needs obexd running and the target device paired & accepting OPP.
Errors are surfaced on the event bus (Logs tab).
"""
from __future__ import annotations

import asyncio
import os
from typing import Any, Dict

from dbus_fast import BusType, Variant
from dbus_fast.aio import MessageBus

from ..core.events import bus

OBEX_BUS = "org.bluez.obex"
OBEX_ROOT = "/org/bluez/obex"


class FileTransferService:
    async def _iface(self, dbus: MessageBus, path: str, iface: str):
        introspection = await dbus.introspect(OBEX_BUS, path)
        obj = dbus.get_proxy_object(OBEX_BUS, path, introspection)
        return obj.get_interface(iface)

    async def send_file(self, address: str, filepath: str) -> Dict[str, Any]:
        if not os.path.isfile(filepath):
            raise FileNotFoundError(filepath)
        name = os.path.basename(filepath)

        dbus = await MessageBus(bus_type=BusType.SESSION).connect()
        session_path = None
        client = None
        try:
            client = await self._iface(dbus, OBEX_ROOT, "org.bluez.obex.Client1")
            session_path = await client.call_create_session(
                address, {"Target": Variant("s", "opp")}
            )
            opp = await self._iface(dbus, session_path, "org.bluez.obex.ObjectPush1")
            transfer_path, _props = await opp.call_send_file(filepath)

            bus.publish("file_transfer", address=address, file=name, status="started")
            status = await self._wait_transfer(dbus, transfer_path)
            bus.publish("file_transfer", address=address, file=name, status=status)
            return {"address": address, "file": name, "status": status}
        except Exception as exc:  # noqa: BLE001
            bus.publish("error", where="file_transfer", address=address, file=name, message=str(exc))
            raise
        finally:
            if client is not None and session_path is not None:
                try:
                    await client.call_remove_session(session_path)
                except Exception:  # noqa: BLE001
                    pass
            dbus.disconnect()

    async def _wait_transfer(self, dbus: MessageBus, path: str, timeout: float = 180.0) -> str:
        transfer = await self._iface(dbus, path, "org.bluez.obex.Transfer1")
        deadline = timeout
        while deadline > 0:
            status = await transfer.get_status()
            if status in ("complete", "error"):
                return status
            await asyncio.sleep(0.5)
            deadline -= 0.5
        return "timeout"


files = FileTransferService()
