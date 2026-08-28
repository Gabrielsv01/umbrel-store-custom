"""Thin server-side client for the separate "Music Tag" app's REST API
(gabriel-store-music-tag). Proxied through our own backend rather than called
directly from the browser: Music Tag's API has no CORS configured (it was
built to serve only its own same-origin frontend), so a cross-origin fetch
from this app's frontend would just be blocked.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

import httpx

from .core.config import settings


class MusicTagClient:
    async def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        if not settings.MUSIC_TAG_URL:
            raise ValueError("Music Tag não está configurado (defina MUSIC_TAG_URL)")
        url = f"{settings.MUSIC_TAG_URL}{path}"
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.request(method, url, **kwargs)
        if response.status_code >= 400:
            detail = response.text
            try:
                detail = response.json().get("detail", detail)
            except Exception:  # noqa: BLE001
                pass
            raise ValueError(detail or f"Music Tag respondeu {response.status_code}")
        return response.json()

    async def search(self, query: str, limit: int = 8) -> List[Dict[str, Any]]:
        result = await self._request("GET", "/api/tracks", params={"search": query, "page_size": limit})
        return result.get("items", [])

    async def get_track(self, track_id: int) -> Dict[str, Any]:
        return await self._request("GET", f"/api/tracks/{track_id}")

    async def update_track(self, track_id: int, changes: Dict[str, Any]) -> Dict[str, Any]:
        return await self._request("PATCH", f"/api/tracks/{track_id}", json=changes)


music_tag = MusicTagClient()
