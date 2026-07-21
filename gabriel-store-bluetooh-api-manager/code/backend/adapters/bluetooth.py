"""BLE manager built on top of bleak (which talks to the host's BlueZ over D-Bus).

This is the single low-level Bluetooth layer. The REST routes and the WebSocket
hub both go through it, so device/GATT logic lives in exactly one place (DRY).
"""
from __future__ import annotations

import asyncio
import time
from typing import Any, Dict, Optional

from bleak import BleakClient, BleakScanner
from bleak.backends.device import BLEDevice
from bleak.backends.scanner import AdvertisementData
from dbus_fast import BusType
from dbus_fast.aio import MessageBus

from ..core.events import bus


class BLEManager:
    def __init__(self) -> None:
        self._scanner: Optional[BleakScanner] = None
        self._scanning = False
        # address -> last-seen device snapshot (name, rssi, ...)
        self._devices: Dict[str, Dict[str, Any]] = {}
        # address -> BLEDevice object handed out by the scanner (needed to connect)
        self._ble_objects: Dict[str, BLEDevice] = {}
        # address -> connected BleakClient
        self._clients: Dict[str, BleakClient] = {}
        # set of "address|char_uuid" with an active notification
        self._notifying: set[str] = set()

    # ---- lifecycle -------------------------------------------------------
    async def start(self) -> None:
        """Start a continuous background scan so the device list stays live."""
        if self._scanning:
            return
        try:
            self._scanner = BleakScanner(detection_callback=self._on_detection)
            await self._scanner.start()
            self._scanning = True
            bus.publish("scan_state", scanning=True)
        except Exception as exc:  # noqa: BLE001 - surface adapter problems in the UI
            bus.publish("error", where="scan_start", message=str(exc))

    async def stop(self) -> None:
        for address in list(self._clients):
            await self.disconnect(address)
        if self._scanner and self._scanning:
            try:
                await self._scanner.stop()
            except Exception:  # noqa: BLE001
                pass
        self._scanning = False
        bus.publish("scan_state", scanning=False)

    # ---- scanning --------------------------------------------------------
    def _on_detection(self, device: BLEDevice, adv: AdvertisementData) -> None:
        self._ble_objects[device.address] = device
        snapshot = {
            "address": device.address,
            "name": adv.local_name or device.name or "(unknown)",
            "rssi": adv.rssi,
            "tx_power": adv.tx_power,
            "connected": device.address in self._clients,
            "last_seen": time.time(),
            "service_uuids": list(adv.service_uuids or []),
            "manufacturer": list((adv.manufacturer_data or {}).keys()),
        }
        self._devices[device.address] = snapshot
        bus.publish("device_update", device=snapshot)

    async def adapter_info(self) -> Optional[Dict[str, Any]]:
        """Best-effort details about the host Bluetooth adapter (via BlueZ).

        Returns None if no adapter/BlueZ is reachable — which itself is a useful
        signal ("why do I see no devices?").
        """
        try:
            sysbus = await MessageBus(bus_type=BusType.SYSTEM).connect()
        except Exception:  # noqa: BLE001
            return None
        try:
            introspection = await sysbus.introspect("org.bluez", "/")
            obj = sysbus.get_proxy_object("org.bluez", "/", introspection)
            manager = obj.get_interface("org.freedesktop.DBus.ObjectManager")
            managed = await manager.call_get_managed_objects()
            for path, ifaces in managed.items():
                adapter = ifaces.get("org.bluez.Adapter1")
                if adapter:
                    return {
                        "path": path,
                        "address": adapter.get("Address").value if "Address" in adapter else None,
                        "name": adapter.get("Name").value if "Name" in adapter else None,
                        "powered": adapter.get("Powered").value if "Powered" in adapter else None,
                        "discovering": adapter.get("Discovering").value if "Discovering" in adapter else None,
                    }
            return None
        except Exception:  # noqa: BLE001
            return None
        finally:
            sysbus.disconnect()

    def list_devices(self) -> list[Dict[str, Any]]:
        # Freshest / strongest signal first.
        return sorted(
            self._devices.values(),
            key=lambda d: (d["connected"], d.get("rssi") or -999),
            reverse=True,
        )

    # ---- connections -----------------------------------------------------
    def _client(self, address: str) -> BleakClient:
        client = self._clients.get(address)
        if client is None:
            raise KeyError(f"Device {address} is not connected")
        return client

    async def connect(self, address: str) -> Dict[str, Any]:
        if address in self._clients:
            return {"address": address, "connected": True}
        target: Any = self._ble_objects.get(address, address)
        client = BleakClient(target, disconnected_callback=self._on_disconnect)
        await client.connect()
        self._clients[address] = client
        if address in self._devices:
            self._devices[address]["connected"] = True
        bus.publish("device_connected", address=address)
        return {"address": address, "connected": True}

    def _on_disconnect(self, client: BleakClient) -> None:
        address = client.address
        self._clients.pop(address, None)
        if address in self._devices:
            self._devices[address]["connected"] = False
        bus.publish("device_disconnected", address=address)

    async def disconnect(self, address: str) -> Dict[str, Any]:
        client = self._clients.pop(address, None)
        if client is not None:
            try:
                await client.disconnect()
            except Exception:  # noqa: BLE001
                pass
        if address in self._devices:
            self._devices[address]["connected"] = False
        bus.publish("device_disconnected", address=address)
        return {"address": address, "connected": False}

    # ---- GATT ------------------------------------------------------------
    def get_services(self, address: str) -> list[Dict[str, Any]]:
        client = self._client(address)
        services = []
        for service in client.services:
            services.append({
                "uuid": service.uuid,
                "description": service.description,
                "characteristics": [
                    {
                        "uuid": char.uuid,
                        "description": char.description,
                        "properties": list(char.properties),
                        "notifying": f"{address}|{char.uuid}" in self._notifying,
                    }
                    for char in service.characteristics
                ],
            })
        return services

    async def read_char(self, address: str, char_uuid: str) -> Dict[str, Any]:
        client = self._client(address)
        value = await client.read_gatt_char(char_uuid)
        return self._decode(value, address, char_uuid)

    async def write_char(
        self, address: str, char_uuid: str, data: bytes, response: bool = True
    ) -> None:
        client = self._client(address)
        await client.write_gatt_char(char_uuid, data, response=response)
        bus.publish(
            "gatt_write", address=address, char=char_uuid, hex=data.hex()
        )

    async def start_notify(self, address: str, char_uuid: str) -> None:
        client = self._client(address)
        key = f"{address}|{char_uuid}"
        if key in self._notifying:
            return

        def callback(_sender: Any, value: bytearray) -> None:
            bus.publish("gatt_data", **self._decode(bytes(value), address, char_uuid))

        await client.start_notify(char_uuid, callback)
        self._notifying.add(key)
        bus.publish("notify_state", address=address, char=char_uuid, notifying=True)

    async def stop_notify(self, address: str, char_uuid: str) -> None:
        client = self._client(address)
        try:
            await client.stop_notify(char_uuid)
        except Exception:  # noqa: BLE001
            pass
        self._notifying.discard(f"{address}|{char_uuid}")
        bus.publish("notify_state", address=address, char=char_uuid, notifying=False)

    # ---- helpers ---------------------------------------------------------
    @staticmethod
    def _decode(value: bytes, address: str, char_uuid: str) -> Dict[str, Any]:
        try:
            text = value.decode("utf-8")
            if not text.isprintable():
                text = None
        except UnicodeDecodeError:
            text = None
        return {
            "address": address,
            "char": char_uuid,
            "hex": value.hex(),
            "text": text,
            "length": len(value),
        }


# Single shared instance.
ble = BLEManager()
