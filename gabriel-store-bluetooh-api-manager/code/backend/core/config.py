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


settings = Settings()
