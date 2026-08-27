"""Small in-memory Navidrome/Subsonic client for the web UI."""
from __future__ import annotations

import asyncio
import hashlib
import os
import secrets
from typing import Any, Dict, List, Optional
from urllib.parse import urlencode, urljoin

import httpx

DEFAULT_URL = os.getenv("NAVIDROME_URL", "")


class NavidromeClient:
    def __init__(self) -> None:
        self.base_url = ""
        self.username = ""
        self.password = ""
        self._salt = ""
        self._token = ""

    @property
    def configured(self) -> bool:
        return bool(self.base_url and self.username and self.password)

    def _auth_params(self) -> Dict[str, str]:
        return {
            "u": self.username,
            "t": self._token,
            "s": self._salt,
            "v": "1.16.1",
            "c": "BluetoothAPIManager",
            "f": "json",
        }

    async def configure(self, base_url: str, username: str, password: str) -> Dict[str, Any]:
        base_url = base_url.strip().rstrip("/") + "/"
        if not base_url.startswith(("http://", "https://")):
            raise ValueError("Navidrome URL must start with http:// or https://")
        self.base_url, self.username, self.password = base_url, username.strip(), password
        self._salt = secrets.token_hex(8)
        self._token = hashlib.md5((self.password + self._salt).encode()).hexdigest()
        try:
            result = await self._call("ping.view")
        except Exception:
            self.clear()
            raise
        return {"ok": True, "server": result.get("serverVersion", "Navidrome")}

    def clear(self) -> None:
        self.base_url = self.username = self.password = self._salt = self._token = ""

    async def _call(self, endpoint: str, **params: Any) -> Dict[str, Any]:
        if not self.configured:
            raise ValueError("Configure o Navidrome primeiro")
        query = {**self._auth_params(), **params}
        async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
            response = await client.get(urljoin(self.base_url, f"rest/{endpoint}"), params=query)
            response.raise_for_status()
            payload = response.json()
        subsonic = payload.get("subsonic-response", {})
        if subsonic.get("status") != "ok":
            error = subsonic.get("error", {})
            raise ValueError(error.get("message", "Navidrome rejeitou a solicitação"))
        return subsonic

    def _stream_url(self, track_id: str) -> str:
        return urljoin(self.base_url, "rest/stream") + "?" + urlencode({**self._auth_params(), "id": track_id})

    def _cover_url(self, cover_id: Optional[str]) -> Optional[str]:
        if not cover_id:
            return None
        return urljoin(self.base_url, "rest/getCoverArt") + "?" + urlencode({**self._auth_params(), "id": cover_id})

    def _track(self, item: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "id": item.get("id"),
            "title": item.get("title", "Untitled"),
            "artist": item.get("artist", "Unknown artist"),
            "album": item.get("album", ""),
            "duration": item.get("duration"),
            "stream_url": self._stream_url(str(item["id"])),
            "cover_url": self._cover_url(item.get("coverArt") or item.get("id")),
        }

    async def search(self, query: str) -> List[Dict[str, Any]]:
        result = await self._call("search3.view", query=query, songCount=100, albumCount=0, artistCount=0)
        return [self._track(item) for item in result.get("searchResult3", {}).get("song", [])]

    async def playlists(self) -> List[Dict[str, Any]]:
        result = await self._call("getPlaylists.view")
        items = result.get("playlists", {}).get("playlist", [])

        # getPlaylists.view's own songCount can be stale (seen 0 for playlists
        # that clearly have tracks). getPlaylist.view's entry list is always
        # accurate, so fetch it for every playlist and use the real count —
        # capped concurrency so a big library doesn't fire 40+ requests at
        # once against the Navidrome server.
        semaphore = asyncio.Semaphore(8)

        async def with_real_count(item: Dict[str, Any]) -> Dict[str, Any]:
            playlist_id = item.get("id")
            fallback = item.get("songCount", 0)
            async with semaphore:
                try:
                    detail = await self._call("getPlaylist.view", id=playlist_id)
                    count = len(detail.get("playlist", {}).get("entry", []))
                except Exception:  # noqa: BLE001 - keep the list usable even if one lookup fails
                    count = fallback
            return {"id": playlist_id, "name": item.get("name", "Untitled"), "song_count": count}

        return list(await asyncio.gather(*(with_real_count(item) for item in items)))

    async def playlist(self, playlist_id: str) -> Dict[str, Any]:
        result = await self._call("getPlaylist.view", id=playlist_id)
        item = result.get("playlist", {})
        return {
            "id": item.get("id"),
            "name": item.get("name", "Untitled"),
            "tracks": [self._track(track) for track in item.get("entry", [])],
        }

    async def add_tracks(self, tracks: List[Dict[str, Any]], device: str) -> Dict[str, Any]:
        from .adapters.audio import audio

        for track in tracks:
            audio.enqueue(track["stream_url"], device=device, label=f'{track["artist"]} - {track["title"]}',
                          source_type="navidrome", duration=track.get("duration"),
                          title=track.get("title"), artist=track.get("artist"),
                          cover_url=track.get("cover_url"))
        return audio.status()

    async def play_now(self, track: Dict[str, Any], device: str) -> Dict[str, Any]:
        from .adapters.audio import audio

        return await audio.play_now(track["stream_url"], device=device,
                                     label=f'{track["artist"]} - {track["title"]}',
                                     source_type="navidrome", duration=track.get("duration"),
                                     title=track.get("title"), artist=track.get("artist"),
                                     cover_url=track.get("cover_url"))


navidrome = NavidromeClient()
