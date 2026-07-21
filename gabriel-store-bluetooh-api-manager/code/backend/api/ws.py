"""WebSocket hub: streams every event from the bus to connected browsers."""
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..core.events import bus

router = APIRouter()


@router.websocket("/ws")
async def ws_events(websocket: WebSocket) -> None:
    await websocket.accept()
    try:
        async for event in bus.subscribe():
            await websocket.send_json(event)
    except WebSocketDisconnect:
        pass
    except Exception:  # noqa: BLE001 - client closed / network error
        pass
