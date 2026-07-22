import { useQuery } from "@tanstack/react-query";
import { getArtists, getAlbums, getGenres } from "../api";

export interface Filters {
  artist: string;
  album: string;
  genre: string;
  addedFrom: string;
  addedTo: string;
}

export const EMPTY_FILTERS: Filters = {
  artist: "",
  album: "",
  genre: "",
  addedFrom: "",
  addedTo: "",
};

interface Props {
  filters: Filters;
  onChange: (f: Filters) => void;
}

export default function FilterBar({ filters, onChange }: Props) {
  const artists = useQuery({ queryKey: ["artists"], queryFn: getArtists });
  const genres = useQuery({ queryKey: ["genres"], queryFn: getGenres });
  // Albums depend on the selected artist so the list stays relevant.
  const albums = useQuery({
    queryKey: ["albums", filters.artist],
    queryFn: () => getAlbums(filters.artist || undefined),
  });

  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });

  const active =
    filters.artist || filters.album || filters.genre || filters.addedFrom || filters.addedTo;

  const opt = (f: { value: string; count: number }) => (
    <option key={f.value} value={f.value}>
      {f.value} ({f.count})
    </option>
  );

  return (
    <div className="filters">
      <select
        value={filters.artist}
        onChange={(e) => set({ artist: e.target.value, album: "" })}
      >
        <option value="">All artists</option>
        {artists.data?.map(opt)}
      </select>

      <select value={filters.album} onChange={(e) => set({ album: e.target.value })}>
        <option value="">All albums</option>
        {albums.data?.map(opt)}
      </select>

      <select value={filters.genre} onChange={(e) => set({ genre: e.target.value })}>
        <option value="">All genres</option>
        {genres.data?.map(opt)}
      </select>

      <label className="date-field">
        Added from
        <input
          type="date"
          value={filters.addedFrom}
          onChange={(e) => set({ addedFrom: e.target.value })}
        />
      </label>
      <label className="date-field">
        to
        <input
          type="date"
          value={filters.addedTo}
          onChange={(e) => set({ addedTo: e.target.value })}
        />
      </label>

      {active && (
        <button className="link" onClick={() => onChange(EMPTY_FILTERS)}>
          Clear filters ✕
        </button>
      )}
    </div>
  );
}
