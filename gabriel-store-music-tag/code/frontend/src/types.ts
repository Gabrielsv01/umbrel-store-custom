export interface Track {
  id: number;
  path: string;
  filename: string;
  format: string;
  size: number;
  duration: number | null;
  bitrate: number | null;
  title: string | null;
  artist: string | null;
  album: string | null;
  albumartist: string | null;
  year: string | null;
  genre: string | null;
  track_no: string | null;
  disc_no: string | null;
  has_artwork: boolean;
  added_at: number | null;
}

export interface Facet {
  value: string;
  count: number;
}

export interface TrackList {
  total: number;
  page: number;
  page_size: number;
  items: Track[];
}

export interface ScanStatus {
  running: boolean;
  started_at: number | null;
  finished_at: number | null;
  scanned: number;
  added: number;
  updated: number;
  removed: number;
  errors: number;
  total: number;
  current: string | null;
}

export interface Stats {
  tracks: number;
  artists: number;
  albums: number;
  with_artwork: number;
  music_dirs: string[];
}

// Editable tag fields shared by single + bulk edit.
export type EditableField =
  | "title"
  | "artist"
  | "album"
  | "albumartist"
  | "year"
  | "genre"
  | "track_no"
  | "disc_no";

export const EDITABLE_FIELDS: { key: EditableField; label: string }[] = [
  { key: "title", label: "Title" },
  { key: "artist", label: "Artist" },
  { key: "album", label: "Album" },
  { key: "albumartist", label: "Album Artist" },
  { key: "year", label: "Year" },
  { key: "genre", label: "Genre" },
  { key: "track_no", label: "Track #" },
  { key: "disc_no", label: "Disc #" },
];
