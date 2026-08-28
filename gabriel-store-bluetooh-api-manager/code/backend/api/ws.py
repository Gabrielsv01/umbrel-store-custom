"""WebSocket hub: streams every event from the bus to connected browsers."""
import asyncio
import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from .. import picoclaw
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


@router.websocket("/ws/agent")
async def ws_agent(websocket: WebSocket) -> None:
    """Proxies the browser's chat socket to PicoClaw's Pico Protocol channel,
    injecting PICOCLAW_TOKEN server-side so the browser never sees it."""
    await websocket.accept()
    if not picoclaw.configured():
        await websocket.send_json({
            "type": "error",
            "payload": {"code": "not_configured", "message": "PicoClaw não está configurado (defina PICOCLAW_URL e PICOCLAW_TOKEN)"},
        })
        await websocket.close()
        return

    session_id = websocket.query_params.get("session_id") or uuid.uuid4().hex
    try:
        upstream = await picoclaw.connect(session_id)
    except Exception as exc:  # noqa: BLE001
        await websocket.send_json({
            "type": "error",
            "payload": {"code": "upstream_unreachable", "message": str(exc)},
        })
        await websocket.close()
        return

    async def pump_upstream() -> None:
        try:
            async for raw in upstream:
                await websocket.send_text(raw)
        except Exception:  # noqa: BLE001 - upstream closed / network error
            pass

    pump_task = asyncio.create_task(pump_upstream())
    try:
        while True:
            data = await websocket.receive_text()
            await upstream.send(data)
    except WebSocketDisconnect:
        pass
    except Exception:  # noqa: BLE001
        pass
    finally:
        pump_task.cancel()
        await upstream.close()
