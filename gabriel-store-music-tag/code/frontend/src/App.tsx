import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Track } from "./types";
import { listTracks, getStats, startScan, scanStatus, artworkUrl } from "./api";
import EditModal from "./components/EditModal";
import FilterBar, { EMPTY_FILTERS, type Filters } from "./components/FilterBar";

const PAGE_SIZE = 50;
const COLUMNS: { key: string; label: string }[] = [
  { key: "title", label: "Title" },
  { key: "artist", label: "Artist" },
  { key: "album", label: "Album" },
  { key: "year", label: "Year" },
  { key: "genre", label: "Genre" },
];

export default function App() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [sort, setSort] = useState("artist");
  const [order, setOrder] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState<Track[] | null>(null);

  const changeFilters = (f: Filters) => {
    setFilters(f);
    setPage(1);
  };

  // Debounce the search box.
  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const stats = useQuery({ queryKey: ["stats"], queryFn: getStats });
  const scan = useQuery({
    queryKey: ["scan"],
    queryFn: scanStatus,
    refetchInterval: (q) => (q.state.data?.running ? 1000 : false),
  });

  const tracks = useQuery({
    queryKey: ["tracks", debounced, filters, sort, order, page],
    queryFn: () =>
      listTracks({
        search: debounced,
        artist: filters.artist,
        album: filters.album,
        genre: filters.genre,
        added_from: filters.addedFrom,
        added_to: filters.addedTo,
        sort,
        order,
        page,
        page_size: PAGE_SIZE,
      }),
  });

  // When a scan finishes, refresh the catalog + stats.
  const running = scan.data?.running;
  useEffect(() => {
    if (running === false) {
      qc.invalidateQueries({ queryKey: ["tracks"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      refreshFacets();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  const refreshFacets = () => {
    qc.invalidateQueries({ queryKey: ["artists"] });
    qc.invalidateQueries({ queryKey: ["albums"] });
    qc.invalidateQueries({ queryKey: ["genres"] });
  };

  const items = tracks.data?.items ?? [];
  const total = tracks.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const allSelected = items.length > 0 && items.every((t) => selected.has(t.id));
  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) items.forEach((t) => next.delete(t.id));
      else items.forEach((t) => next.add(t.id));
      return next;
    });
  };
  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const selectedTracks = useMemo(
    () => items.filter((t) => selected.has(t.id)),
    [items, selected]
  );

  const clickSort = (key: string) => {
    if (sort === key) setOrder((o) => (o === "asc" ? "desc" : "asc"));
    else {
      setSort(key);
      setOrder("asc");
    }
  };

  const onSaved = () => {
    setEditing(null);
    qc.invalidateQueries({ queryKey: ["tracks"] });
    qc.invalidateQueries({ queryKey: ["stats"] });
    refreshFacets();
  };

  return (
    <div className="app">
      <header className="top">
        <h1>🎵 Music Tag</h1>
        <div className="stats">
          {stats.data && (
            <>
              <span><b>{stats.data.tracks}</b> tracks</span>
              <span><b>{stats.data.artists}</b> artists</span>
              <span><b>{stats.data.albums}</b> albums</span>
              <span><b>{stats.data.with_artwork}</b> with artwork</span>
            </>
          )}
        </div>
      </header>

      <div className="toolbar">
        <input
          type="text"
          placeholder="Search title, artist, album…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button
          disabled={selectedTracks.length === 0}
          onClick={() => setEditing(selectedTracks)}
        >
          Edit selected ({selectedTracks.length})
        </button>
        <div className="spacer" />
        <button
          className="primary"
          disabled={scan.data?.running}
          onClick={async () => {
            await startScan();
            qc.invalidateQueries({ queryKey: ["scan"] });
          }}
        >
          {scan.data?.running ? "Scanning…" : "Scan library"}
        </button>
      </div>

      <FilterBar filters={filters} onChange={changeFilters} />

      {scan.data?.running && (
        <div className="scan-banner">
          <div className="spinner" />
          Scanning {scan.data.scanned}/{scan.data.total} — added {scan.data.added},
          updated {scan.data.updated}, errors {scan.data.errors}
        </div>
      )}

      {tracks.isError && <div className="error">{(tracks.error as Error).message}</div>}

      <table>
        <thead>
          <tr>
            <th className="checkbox">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} />
            </th>
            <th className="art"></th>
            {COLUMNS.map((c) => (
              <th key={c.key} onClick={() => clickSort(c.key)}>
                {c.label}
                {sort === c.key ? (order === "asc" ? " ▲" : " ▼") : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((t) => (
            <tr key={t.id} onDoubleClick={() => setEditing([t])}>
              <td className="checkbox">
                <input
                  type="checkbox"
                  checked={selected.has(t.id)}
                  onChange={() => toggle(t.id)}
                />
              </td>
              <td className="art">
                {t.has_artwork ? (
                  <img src={artworkUrl(t.id)} alt="" loading="lazy" />
                ) : (
                  <div className="art-placeholder" />
                )}
              </td>
              <td>{t.title || <span className="muted">{t.filename}</span>}</td>
              <td>{t.artist || <span className="muted">—</span>}</td>
              <td>{t.album || <span className="muted">—</span>}</td>
              <td>{t.year || <span className="muted">—</span>}</td>
              <td>{t.genre || <span className="muted">—</span>}</td>
            </tr>
          ))}
          {items.length === 0 && !tracks.isLoading && (
            <tr>
              <td colSpan={7} className="muted" style={{ padding: 24, textAlign: "center" }}>
                No tracks. Click "Scan library" to index your music.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="pager">
        <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          ← Prev
        </button>
        <span>
          Page {page} / {pages} — {total} tracks
        </span>
        <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
          Next →
        </button>
      </div>

      {editing && (
        <EditModal tracks={editing} onClose={() => setEditing(null)} onSaved={onSaved} />
      )}
    </div>
  );
}
