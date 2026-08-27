import { useEffect, useState } from "react";
import {
  Card, CardContent, Typography, Accordion, AccordionSummary,
  AccordionDetails, Stack, Chip, Button, List,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import PlaylistAddIcon from "@mui/icons-material/PlaylistAdd";
import { api } from "../api.js";
import Track from "./TrackListItem.jsx";

// Extracted from Musica.jsx so PlayerPage.jsx's footer can reuse the same
// Navidrome playlist browsing UI instead of duplicating it. `showHeading`
// is off when this sits inside a sheet that already has its own "Playlists"
// context (the sheet was opened by tapping a "Playlists" button) — repeating
// the label there just eats vertical space for no new information.
export default function PlaylistsPanel({ onAdd, onPlayNow, onError, showHeading = true }) {
  const [playlists, setPlaylists] = useState([]);
  const [openPlaylist, setOpenPlaylist] = useState(null);

  useEffect(() => {
    api.navidromePlaylists().then(setPlaylists).catch((e) => onError?.(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function togglePlaylist(id) {
    if (openPlaylist?.id === id) return setOpenPlaylist(null);
    try {
      const full = await api.navidromePlaylist(id);
      setOpenPlaylist(full);
      // The list endpoint's songCount can be stale; reconcile it with the
      // real track list once we actually fetch it.
      setPlaylists((prev) => prev.map((p) => (p.id === id ? { ...p, song_count: full.tracks.length } : p)));
    } catch (e) { onError?.(e.message); }
  }

  return (
    <Card>
      <CardContent>
        {showHeading && (
          <Typography variant="subtitle1" gutterBottom>Playlists ({playlists.length})</Typography>
        )}
        {playlists.length === 0 && (
          <Typography variant="body2" color="text.secondary">Nenhuma playlist encontrada.</Typography>
        )}
        {playlists.map((playlist) => (
          <Accordion key={playlist.id} expanded={openPlaylist?.id === playlist.id}
            onChange={() => togglePlaylist(playlist.id)} disableGutters>
            <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ "& .MuiAccordionSummary-content": { minWidth: 0 } }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: "center", flex: 1, minWidth: 0, pr: 1 }}>
                <Typography sx={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{playlist.name}</Typography>
                <Chip size="small" label={`${playlist.song_count} músicas`} sx={{ flexShrink: 0 }} />
              </Stack>
            </AccordionSummary>
            <AccordionDetails>
              {openPlaylist?.id === playlist.id && (
                <>
                  <Button size="small" startIcon={<PlaylistAddIcon />}
                    onClick={() => onAdd(openPlaylist.tracks)} sx={{ mb: 1 }}>
                    Adicionar playlist à fila
                  </Button>
                  <List dense>
                    {openPlaylist.tracks.map((track) => (
                      <Track key={track.id} track={track} onAdd={(t) => onAdd([t])} onPlayNow={onPlayNow} />
                    ))}
                  </List>
                </>
              )}
            </AccordionDetails>
          </Accordion>
        ))}
      </CardContent>
    </Card>
  );
}
