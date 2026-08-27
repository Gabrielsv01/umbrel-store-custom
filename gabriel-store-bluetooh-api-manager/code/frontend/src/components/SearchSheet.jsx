import { useEffect, useState } from "react";
import {
  Card, CardContent, TextField, InputAdornment, IconButton, CircularProgress,
  Paper, Stack, Typography, List,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import CloseIcon from "@mui/icons-material/Close";
import { api } from "../api.js";
import Track from "./TrackListItem.jsx";

// Extracted from Musica.jsx so PlayerPage.jsx's footer can reuse the same
// live-search UI instead of duplicating it. The results sheet is a plain
// fixed Paper (not MUI's modal Drawer) so it never steals focus from the
// search field while typing.
export default function SearchSheet({ onAdd, onPlayNow, onError }) {
  const [query, setQuery] = useState("");
  const [tracks, setTracks] = useState([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setTracks([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      api.navidromeSearch(q)
        .then((result) => setTracks(result))
        .catch((e) => onError?.(e.message))
        .finally(() => setSearching(false));
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  return (
    <>
      <Card sx={{ mb: 2 }}>
        <CardContent>
          <TextField
            size="small" fullWidth placeholder="Buscar música, artista ou álbum…"
            value={query} onChange={(e) => setQuery(e.target.value)}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    {searching ? <CircularProgress size={16} /> : <SearchIcon fontSize="small" />}
                  </InputAdornment>
                ),
                endAdornment: query && (
                  <InputAdornment position="end">
                    <IconButton size="small" onClick={() => setQuery("")}>
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  </InputAdornment>
                ),
              },
            }}
          />
        </CardContent>
      </Card>

      {query.trim().length >= 2 && (
        <Paper
          elevation={8}
          sx={{
            position: "fixed",
            left: 0, right: 0,
            bottom: { xs: "56px", md: 0 },
            zIndex: (t) => t.zIndex.drawer + 2,
            maxHeight: "45vh",
            display: "flex",
            flexDirection: "column",
            borderTopLeftRadius: 12,
            borderTopRightRadius: 12,
            borderTop: 1,
            borderColor: "divider",
          }}
        >
          <Stack direction="row" sx={{ alignItems: "center", px: 2, pt: 1.5, pb: 0.5 }}>
            <Typography variant="subtitle2" sx={{ flex: 1, minWidth: 0 }}>
              {searching ? "Buscando…" : `Resultados (${tracks.length})`}
            </Typography>
            <IconButton size="small" onClick={() => setQuery("")}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Stack>
          {!searching && tracks.length === 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ px: 2, pb: 2 }}>
              Nenhuma música encontrada.
            </Typography>
          )}
          <List dense sx={{ overflowY: "auto", pt: 0 }}>
            {tracks.map((track) => (
              <Track key={track.id} track={track} onAdd={(t) => onAdd([t])} onPlayNow={onPlayNow} />
            ))}
          </List>
        </Paper>
      )}
    </>
  );
}
