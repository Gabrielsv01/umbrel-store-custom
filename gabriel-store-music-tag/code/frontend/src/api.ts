import type { Track, TrackList, ScanStatus, Stats, Facet } from "./types";

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export interface ListParams {
  search?: string;
  artist?: string;
  album?: string;
  genre?: string;
  added_from?: string;
  added_to?: string;
  sort?: string;
  order?: "asc" | "desc";
  page?: number;
  page_size?: number;
}

export function listTracks(params: ListParams): Promise<TrackList> {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== "" && v !== null) q.set(k, String(v));
  });
  return req<TrackList>(`/api/tracks?${q.toString()}`);
}

export function patchTrack(id: number, changes: Record<string, string | null>): Promise<Track> {
  return req<Track>(`/api/tracks/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(changes),
  });
}

export function bulkPatch(ids: number[], changes: Record<string, string | null>): Promise<Track[]> {
  return req<Track[]>(`/api/tracks/bulk`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids, changes }),
  });
}

export function uploadArtwork(id: number, file: File): Promise<Track> {
  const fd = new FormData();
  fd.append("file", file);
  return req<Track>(`/api/tracks/${id}/artwork`, { method: "PUT", body: fd });
}

export function startScan(): Promise<ScanStatus> {
  return req<ScanStatus>(`/api/scan`, { method: "POST" });
}

export function scanStatus(): Promise<ScanStatus> {
  return req<ScanStatus>(`/api/scan/status`);
}

export function getStats(): Promise<Stats> {
  return req<Stats>(`/api/stats`);
}

export function getArtists(): Promise<Facet[]> {
  return req<Facet[]>(`/api/artists`);
}

export function getAlbums(artist?: string): Promise<Facet[]> {
  const q = artist ? `?artist=${encodeURIComponent(artist)}` : "";
  return req<Facet[]>(`/api/albums${q}`);
}

export function getGenres(): Promise<Facet[]> {
  return req<Facet[]>(`/api/genres`);
}

export function artworkUrl(id: number): string {
  return `/api/tracks/${id}/artwork`;
}
