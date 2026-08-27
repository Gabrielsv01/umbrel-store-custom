"""Central configuration, read once from the environment (KISS)."""
import os


class Settings:
    PORT: int = int(os.getenv("PORT", "5157"))
    STATIC_DIR: str = os.getenv("STATIC_DIR", "")
    DATA_DIR: str = os.getenv("DATA_DIR", "/data")

    # How long a single active BLE scan runs, in seconds.
    SCAN_DURATION: float = float(os.getenv("SCAN_DURATION", "8.0"))
    # Keep this many recent events for the "Logs" tab / late WebSocket clients.
    EVENT_HISTORY: int = int(os.getenv("EVENT_HISTORY", "500"))

    # Skip real BlueZ/D-Bus/bleak calls entirely — for running the API (and
    # Swagger at /docs) on a machine with no Bluetooth adapter/D-Bus, e.g. a
    # developer's laptop. Real scanning/connect calls simply no-op instead of
    # hanging or erroring. Never set this in the actual Umbrel deployment.
    MOCK_HARDWARE: bool = os.getenv("MOCK_HARDWARE", "false").lower() in ("1", "true", "yes")

    # Base URL of the separate "Music Tag" Umbrel app (gabriel-store-music-tag),
    # used only to build a browser link from the player's 3-dot menu — this is
    # opened directly by the user's browser, so it must be an address the
    # browser can reach (the Umbrel device's LAN hostname/IP), not a container-
    # internal one. Empty disables the menu item.
    MUSIC_TAG_URL: str = os.getenv("MUSIC_TAG_URL", "").strip().rstrip("/")


settings = Settings()
