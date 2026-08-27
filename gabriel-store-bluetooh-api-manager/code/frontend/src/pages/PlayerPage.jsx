import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box, AppBar, Toolbar, IconButton, Typography, Drawer, List, ListItem,
  ListItemButton, ListItemIcon, ListItemText, Divider, Slider, Stack,
  Alert, Snackbar,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import MusicNoteIcon from "@mui/icons-material/MusicNote";
import SkipPreviousIcon from "@mui/icons-material/SkipPrevious";
import SkipNextIcon from "@mui/icons-material/SkipNext";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import RepeatIcon from "@mui/icons-material/Repeat";
import RepeatOneIcon from "@mui/icons-material/RepeatOne";
import ShuffleIcon from "@mui/icons-material/Shuffle";
import QueueMusicIcon from "@mui/icons-material/QueueMusic";
import SearchIcon from "@mui/icons-material/Search";
import LinkOffIcon from "@mui/icons-material/LinkOff";
import CloseIcon from "@mui/icons-material/Close";
import EditIcon from "@mui/icons-material/Edit";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import DeleteIcon from "@mui/icons-material/Delete";
import { useAudioStatus } from "../hooks/useAudioStatus.js";
import { api } from "../api.js";
import PlaylistsPanel from "../components/PlaylistsPanel.jsx";
import SearchSheet from "../components/SearchSheet.jsx";

function fmtTime(s) {
  if (!s && s !== 0) return "--:--";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export default function PlayerPage() {
  const navigate = useNavigate();
  const {
    audioStatus, setAudioStatus, handlePause, handleResume, handleSkip,
    handlePrevious, handleSeek, handleRepeat, handleShuffle,
  } = useAudioStatus();

  const [menuOpen, setMenuOpen] = useState(false);
  const [sheet, setSheet] = useState(null); // null | "playlists" | "search"
  const [dragValue, setDragValue] = useState(null);
  const [notice, setNotice] = useState(null);
  const [artBroken, setArtBroken] = useState(false);
  const [musicTagUrl, setMusicTagUrl] = useState("");
  const [navidromeConnected, setNavidromeConnected] = useState(false);
  const [sheetHeightVh, setSheetHeightVh] = useState(50);
  const dragRef = useRef(null);

  function handleSheetDragStart(e) {
    dragRef.current = { startY: e.clientY, startHeight: sheetHeightVh };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function handleSheetDragMove(e) {
    if (!dragRef.current) return;
    const deltaVh = ((dragRef.current.startY - e.clientY) / window.innerHeight) * 100;
    setSheetHeightVh(Math.min(90, Math.max(30, dragRef.current.startHeight + deltaVh)));
  }
  function handleSheetDragEnd() {
    dragRef.current = null;
  }

  const current = audioStatus.current;
  const queue = audioStatus.queue || [];
  const duration = current?.duration || 0;
  const position = dragValue ?? audioStatus.position;
  const title = current?.title || current?.label || "";
  const artist = current?.artist || "";

  useEffect(() => {
    api.musicTagStatus()
      .then((s) => setMusicTagUrl(s.configured ? s.url : ""))
      .catch(() => {});
  }, []);

  useEffect(() => {
    api.navidromeStatus()
      .then((s) => setNavidromeConnected(Boolean(s.configured)))
      .catch(() => setNavidromeConnected(false));
    // Re-check whenever the menu opens too — the connection can change
    // elsewhere (e.g. disconnected from the Música tab in another tab)
    // while this page stays open.
  }, [menuOpen]);

  function openMusicTag() {
    const query = title ? `?search=${encodeURIComponent(title)}` : "";
    window.open(`${musicTagUrl}/${query}`, "_blank", "noopener,noreferrer");
    setMenuOpen(false);
  }

  async function queueAction(action) {
    try { setAudioStatus(await action()); } catch (e) { setNotice(e.message); }
  }

  function requireDevice() {
    const device = current?.device;
    if (!device) {
      setNotice("Toque algo na aba Música primeiro, pra escolher o alto-falante.");
      return null;
    }
    return device;
  }

  async function handleAdd(tracks) {
    const device = requireDevice();
    if (!device) return;
    try { setAudioStatus(await api.navidromeQueue(device, tracks)); }
    catch (e) { setNotice(e.message); }
  }

  async function handlePlayNow(track) {
    const device = requireDevice();
    if (!device) return;
    try { setAudioStatus(await api.navidromePlayNow(device, track)); }
    catch (e) { setNotice(e.message); }
  }

  async function disconnectNavidrome() {
    try { await api.navidromeDisconnect(); setMenuOpen(false); navigate("/"); }
    catch (e) { setNotice(e.message); }
  }

  return (
    <Box sx={{ minHeight: "100vh", display: "flex", flexDirection: "column", bgcolor: "background.default" }}>
      <AppBar position="static" color="transparent" elevation={0}>
        <Toolbar>
          <IconButton edge="start" onClick={() => navigate("/")}>
            <ArrowBackIcon />
          </IconButton>
          <Box sx={{ flex: 1 }} />
          <IconButton edge="end" onClick={() => setMenuOpen(true)}>
            <MoreVertIcon />
          </IconButton>
        </Toolbar>
      </AppBar>

      <Box sx={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", px: 3, pb: 2, minWidth: 0 }}>
        {!current ? (
          <Stack spacing={1} sx={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <MusicNoteIcon sx={{ fontSize: 64, color: "text.disabled" }} />
            <Typography color="text.secondary">Nada tocando</Typography>
          </Stack>
        ) : (
          <>
            <Box
              sx={{
                width: "100%", maxWidth: 340, aspectRatio: "1 / 1", borderRadius: 3,
                bgcolor: "background.paper", display: "flex", alignItems: "center",
                justifyContent: "center", overflow: "hidden", mt: 2, mb: 3,
              }}
            >
              {current.cover_url && !artBroken ? (
                <Box component="img" src={current.cover_url} alt="" onError={() => setArtBroken(true)}
                  sx={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <MusicNoteIcon sx={{ fontSize: 96, color: "text.disabled" }} />
              )}
            </Box>

            <Typography variant="h5" align="center" sx={{ width: "100%", overflowWrap: "anywhere" }}>
              {title}
            </Typography>
            {artist && (
              <Typography variant="body1" color="text.secondary" align="center" sx={{ width: "100%", overflowWrap: "anywhere" }}>
                {artist}
              </Typography>
            )}
            {current.device && (
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
                tocando em {current.device}
              </Typography>
            )}

            <Box sx={{ width: "100%", maxWidth: 420, mt: 3 }}>
              <Slider
                size="small"
                value={position}
                min={0}
                max={duration || 1}
                disabled={!duration}
                onChange={(_, v) => setDragValue(v)}
                onChangeCommitted={(_, v) => { handleSeek(v); setDragValue(null); }}
              />
              <Stack direction="row" sx={{ justifyContent: "space-between", width: "100%" }}>
                <Typography variant="caption" color="text.secondary">{fmtTime(position)}</Typography>
                <Typography variant="caption" color="text.secondary">{duration ? fmtTime(duration) : "--:--"}</Typography>
              </Stack>
            </Box>

            <Stack direction="row" spacing={2} sx={{ alignItems: "center", justifyContent: "center", mt: 2 }}>
              <IconButton
                color={audioStatus.shuffled ? "primary" : "default"}
                onClick={() => handleShuffle(!audioStatus.shuffled)}
              >
                <ShuffleIcon />
              </IconButton>
              <IconButton size="large" disabled={!audioStatus.has_previous} onClick={handlePrevious}>
                <SkipPreviousIcon fontSize="large" />
              </IconButton>
              <IconButton
                size="large" color="primary"
                sx={{ bgcolor: "primary.main", color: "primary.contrastText", "&:hover": { bgcolor: "primary.dark" }, width: 64, height: 64 }}
                onClick={() => (audioStatus.paused ? handleResume() : handlePause())}
              >
                {audioStatus.paused ? <PlayArrowIcon fontSize="large" /> : <PauseIcon fontSize="large" />}
              </IconButton>
              <IconButton size="large" disabled={queue.length === 0} onClick={handleSkip}>
                <SkipNextIcon fontSize="large" />
              </IconButton>
              <IconButton
                color={audioStatus.repeat === "one" ? "primary" : "default"}
                onClick={() => handleRepeat(audioStatus.repeat === "one" ? "off" : "one")}
              >
                {audioStatus.repeat === "one" ? <RepeatOneIcon /> : <RepeatIcon />}
              </IconButton>
            </Stack>
          </>
        )}
      </Box>

      <Divider />
      <Stack direction="row">
        <ListItemButton sx={{ justifyContent: "center", py: 1.5 }} onClick={() => setSheet("playlists")}>
          <Stack spacing={0.5} sx={{ alignItems: "center" }}>
            <QueueMusicIcon />
            <Typography variant="caption">Playlists</Typography>
          </Stack>
        </ListItemButton>
        <ListItemButton sx={{ justifyContent: "center", py: 1.5 }} onClick={() => setSheet("search")}>
          <Stack spacing={0.5} sx={{ alignItems: "center" }}>
            <SearchIcon />
            <Typography variant="caption">Buscar</Typography>
          </Stack>
        </ListItemButton>
      </Stack>

      {/* 3-dot menu: queue management + disconnect + close */}
      <Drawer anchor="bottom" open={menuOpen} onClose={() => setMenuOpen(false)}
        slotProps={{ paper: { sx: { borderTopLeftRadius: 20, borderTopRightRadius: 20 } } }}>
        <Box sx={{ width: 36, height: 4, borderRadius: 2, bgcolor: "divider", mx: "auto", mt: 1.5, mb: 0.5 }} />
        <Box sx={{ p: 2, pt: 1, maxHeight: "70vh", overflowY: "auto" }}>
          <Typography variant="subtitle1" gutterBottom>Fila ({queue.length})</Typography>
          {queue.length === 0 && (
            <Typography variant="body2" color="text.secondary">A fila está vazia.</Typography>
          )}
          <List dense>
            {queue.map((item, index) => (
              <ListItem key={item.id} divider
                secondaryAction={
                  <Stack direction="row" spacing={0.5}>
                    <IconButton size="small" disabled={index === 0}
                      onClick={() => queueAction(() => api.audioMove(item.id, -1))}>
                      <ArrowUpwardIcon fontSize="small" />
                    </IconButton>
                    <IconButton size="small" disabled={index === queue.length - 1}
                      onClick={() => queueAction(() => api.audioMove(item.id, 1))}>
                      <ArrowDownwardIcon fontSize="small" />
                    </IconButton>
                    <IconButton size="small" onClick={() => queueAction(() => api.audioRemove(item.id))}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                }>
                <ListItemText primary={`${index + 1}. ${item.label}`} secondary={item.device} />
              </ListItem>
            ))}
          </List>
          <Divider sx={{ my: 1 }} />
          <List>
            {musicTagUrl && current && (
              <ListItemButton onClick={openMusicTag}>
                <ListItemIcon><EditIcon /></ListItemIcon>
                <ListItemText primary="Editar informações da música" secondary="Abre o Music Tag" />
              </ListItemButton>
            )}
            {navidromeConnected && (
              <ListItemButton onClick={disconnectNavidrome}>
                <ListItemIcon><LinkOffIcon /></ListItemIcon>
                <ListItemText primary="Desconectar do Navidrome" />
              </ListItemButton>
            )}
            <ListItemButton onClick={() => navigate("/")}>
              <ListItemIcon><CloseIcon /></ListItemIcon>
              <ListItemText primary="Fechar player" />
            </ListItemButton>
          </List>
        </Box>
      </Drawer>

      {/* Playlists: a real modal Drawer is fine here (no text input to lose focus).
          No separate "Playlists" heading here — PlaylistsPanel already has its
          own "Playlists (N)" title, so this just adds the sheet chrome (a
          drag-to-resize handle) around it. No close (X) button — tapping
          outside the sheet already dismisses it via the Drawer's backdrop. */}
      <Drawer anchor="bottom" open={sheet === "playlists"} onClose={() => setSheet(null)}
        slotProps={{ paper: { sx: {
          borderTopLeftRadius: 20, borderTopRightRadius: 20, height: `${sheetHeightVh}vh`,
          display: "flex", flexDirection: "column", transition: dragRef.current ? "none" : "height 0.15s ease-out",
        } } }}>
        <Box
          onPointerDown={handleSheetDragStart}
          onPointerMove={handleSheetDragMove}
          onPointerUp={handleSheetDragEnd}
          onPointerCancel={handleSheetDragEnd}
          sx={{
            display: "flex", alignItems: "center", justifyContent: "center",
            height: 32, flexShrink: 0, cursor: "ns-resize", touchAction: "none",
          }}
        >
          <Box sx={{ width: 36, height: 4, borderRadius: 2, bgcolor: "divider" }} />
        </Box>
        <Box sx={{ px: 2, pb: 2, overflowY: "auto", flex: 1, minHeight: 0 }}>
          <PlaylistsPanel onAdd={handleAdd} onPlayNow={handlePlayNow} onError={setNotice} showHeading={false} />
        </Box>
      </Drawer>

      {/* Search stays a plain overlay (not a modal Drawer) so the field never
          loses focus while typing — same reasoning as in Musica.jsx. */}
      {sheet === "search" && (
        <Box sx={{ position: "fixed", inset: 0, bgcolor: "background.default", zIndex: (t) => t.zIndex.drawer + 3, p: 2, overflowY: "auto" }}>
          <Stack direction="row" sx={{ alignItems: "center", mb: 1 }}>
            <Typography variant="h6" sx={{ flex: 1 }}>Buscar</Typography>
            <IconButton size="small" onClick={() => setSheet(null)}><CloseIcon fontSize="small" /></IconButton>
          </Stack>
          <SearchSheet onAdd={handleAdd} onPlayNow={handlePlayNow} onError={setNotice} />
        </Box>
      )}

      <Snackbar open={Boolean(notice)} autoHideDuration={4000} onClose={() => setNotice(null)}>
        <Alert severity="error" onClose={() => setNotice(null)}>{notice}</Alert>
      </Snackbar>
    </Box>
  );
}
