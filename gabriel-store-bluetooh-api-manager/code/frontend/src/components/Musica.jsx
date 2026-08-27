import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box, Card, CardContent, Stack, TextField, Select, MenuItem, InputLabel,
  FormControl, Button, IconButton, List, ListItem, ListItemText,
  Typography, Alert, Tabs, Tab, Chip, Dialog, DialogTitle, DialogContent,
  DialogActions,
} from "@mui/material";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PlaylistAddIcon from "@mui/icons-material/PlaylistAdd";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import DeleteIcon from "@mui/icons-material/Delete";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import OpenInFullIcon from "@mui/icons-material/OpenInFull";
import { api } from "../api.js";
import PlaylistsPanel from "./PlaylistsPanel.jsx";
import SearchSheet from "./SearchSheet.jsx";

export default function Musica({ classic, audioStatus, onAudioStatus }) {
  const navigate = useNavigate();
  const [musicaTab, setMusicaTab] = useState("upload");
  const [device, setDevice] = useState("");
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [playerModalOpen, setPlayerModalOpen] = useState(false);

  // Upload/URL tab
  const [url, setUrl] = useState("");
  const [file, setFile] = useState(null);

  // Navidrome tab
  const [navStatus, setNavStatus] = useState({ configured: false, url: "" });
  const [form, setForm] = useState({ url: "", username: "", password: "" });

  const speakers = classic.filter((item) => item.connected);

  useEffect(() => {
    if (!device && speakers.length) setDevice(speakers[0].address);
  }, [speakers, device]);

  useEffect(() => {
    api.navidromeStatus().then((value) => {
      setNavStatus(value);
      setForm((old) => ({ ...old, url: value.url || "" }));
    }).catch(() => {});
  }, []);

  function report(promise) {
    setError(null);
    return promise
      .then((result) => { onAudioStatus(result); return result; })
      .catch((e) => { setError(e.message); throw e; });
  }

  // ---- Upload/URL tab ----
  async function addToQueue() {
    if (!device) return setError("Conecte e selecione um alto-falante Bluetooth.");
    if (!file && !url) return setError("Escolha um arquivo ou cole uma URL.");
    try {
      await report(api.audioPlay({ device, file, url: url || undefined }));
      setUrl(""); setFile(null);
      const el = document.getElementById("musica-upload-file");
      if (el) el.value = "";
      setMessage("Adicionado à fila.");
    } catch { /* handled in report */ }
  }

  async function playNowUpload() {
    if (!device) return setError("Conecte e selecione um alto-falante Bluetooth.");
    if (!file && !url) return setError("Escolha um arquivo ou cole uma URL.");
    try {
      await report(api.audioPlayNow({ device, file, url: url || undefined }));
      setUrl(""); setFile(null);
      const el = document.getElementById("musica-upload-file");
      if (el) el.value = "";
      setMessage("Tocando agora.");
    } catch { /* handled in report */ }
  }

  // ---- Navidrome tab ----
  async function connect(event) {
    event.preventDefault();
    setError(null); setMessage(null);
    try {
      const result = await api.navidromeConfigure(form);
      setNavStatus({ configured: true, url: form.url });
      setForm((old) => ({ ...old, password: "" }));
      setMessage(`Conectado ao Navidrome ${result.server}`);
      return true;
    } catch (e) { setError(e.message); return false; }
  }

  function openPlayer() {
    if (navStatus.configured) return navigate("/player");
    setPlayerModalOpen(true);
  }

  async function connectFromModal(event) {
    const ok = await connect(event);
    if (ok) {
      setPlayerModalOpen(false);
      navigate("/player");
    }
  }

  async function addTracks(items) {
    if (!device) return setError("Conecte e selecione um alto-falante Bluetooth.");
    try {
      await report(api.navidromeQueue(device, items));
      setMessage(`${items.length} música(s) adicionada(s) à fila.`);
    } catch { /* handled in report */ }
  }

  async function playNowTrack(track) {
    if (!device) return setError("Conecte e selecione um alto-falante Bluetooth.");
    try {
      await report(api.navidromePlayNow(device, track));
      setMessage("Tocando agora.");
    } catch { /* handled in report */ }
  }

  // ---- Shared queue management ----
  async function queueAction(action) {
    try { onAudioStatus(await action()); } catch (e) { setError(e.message); }
  }

  const queue = audioStatus?.queue || [];

  return (
    <Box>
      <Typography variant="h5" gutterBottom>Música</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Envie arquivos, URLs ou músicas do seu Navidrome para a fila Bluetooth.
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {message && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setMessage(null)}>{message}</Alert>}

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <FormControl fullWidth size="small">
            <InputLabel>Alto-falante</InputLabel>
            <Select label="Alto-falante" value={device} onChange={(e) => setDevice(e.target.value)}>
              {speakers.map((item) => (
                <MenuItem key={item.address} value={item.address}>{item.name} ({item.address})</MenuItem>
              ))}
              {!speakers.length && <MenuItem value="" disabled>Nenhum alto-falante conectado</MenuItem>}
            </Select>
          </FormControl>
        </CardContent>
      </Card>

      <Tabs value={musicaTab} onChange={(_, v) => setMusicaTab(v)} sx={{ mb: 2 }}>
        <Tab value="upload" label="Upload / URL" />
        <Tab value="navidrome" label="Navidrome" />
      </Tabs>

      {musicaTab === "upload" && (
        <Card sx={{ mb: 2 }}>
          <CardContent>
            <Stack spacing={2}>
              <Button component="label" variant="outlined" startIcon={<CloudUploadIcon />}>
                {file ? file.name : "Escolher arquivo de áudio"}
                <input id="musica-upload-file" hidden type="file" accept="audio/*"
                  onChange={(e) => setFile(e.target.files[0])} />
              </Button>
              <TextField label="ou URL" placeholder="https://exemplo.com/musica.mp3" size="small"
                value={url} onChange={(e) => setUrl(e.target.value)} fullWidth />
              <Stack direction="row" spacing={1}>
                <Button variant="contained" startIcon={<PlayArrowIcon />} onClick={playNowUpload}>
                  Tocar agora
                </Button>
                <Button variant="outlined" startIcon={<PlaylistAddIcon />} onClick={addToQueue}>
                  Adicionar à fila
                </Button>
              </Stack>
            </Stack>
          </CardContent>
        </Card>
      )}

      {musicaTab === "navidrome" && (
        <>
          <Card sx={{ mb: 2 }}>
            <CardContent>
              <Typography variant="subtitle1" gutterBottom>Conexão</Typography>
              <Box component="form" onSubmit={connect}>
                <Stack spacing={1.5}>
                  <TextField label="URL" size="small" value={form.url}
                    onChange={(e) => setForm({ ...form, url: e.target.value })} fullWidth />
                  <TextField label="Usuário" size="small" autoComplete="username" value={form.username}
                    onChange={(e) => setForm({ ...form, username: e.target.value })} fullWidth />
                  <TextField label="Senha" type="password" size="small" autoComplete="current-password"
                    value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} fullWidth />
                  {/* Deliberately two separate rows (not one wrapping row) —
                      packing the primary button, a text button, and a long
                      URL chip into a single flex-wrap row left them
                      overlapping on narrow screens instead of stacking. */}
                  <Stack spacing={1}>
                    <Stack direction="row" spacing={1} sx={{ alignItems: "center", minWidth: 0 }}>
                      {navStatus.configured && (
                        <Button variant="text" size="small" sx={{ flexShrink: 0 }}
                          onClick={() => api.navidromeDisconnect().then(() => setNavStatus({ configured: false, url: form.url }))}>
                          Desconectar
                        </Button>
                      )}
                      <Chip size="small" color={navStatus.configured ? "success" : "default"}
                        label={navStatus.configured ? `conectado: ${navStatus.url}` : "desconectado"}
                        sx={{ minWidth: 0, "& .MuiChip-label": { overflow: "hidden", textOverflow: "ellipsis" } }} />
                    </Stack>
                    <Box>
                      <Button type="submit" variant="contained">
                        {navStatus.configured ? "Atualizar conexão" : "Conectar"}
                      </Button>
                    </Box>
                  </Stack>
                </Stack>
              </Box>
            </CardContent>
          </Card>

          <Box sx={{ mb: 2 }}>
            <Button variant="contained" startIcon={<OpenInFullIcon />} onClick={openPlayer}>
              Abrir player
            </Button>
          </Box>

          {navStatus.configured && (
            <>
              <SearchSheet onAdd={addTracks} onPlayNow={playNowTrack} onError={setError} />
              <Box sx={{ mb: 2 }}>
                <PlaylistsPanel onAdd={addTracks} onPlayNow={playNowTrack} onError={setError} />
              </Box>
            </>
          )}
        </>
      )}

      <Card>
        <CardContent>
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
        </CardContent>
      </Card>

      <Dialog open={playerModalOpen} onClose={() => setPlayerModalOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>Conectar ao Navidrome</DialogTitle>
        <Box component="form" onSubmit={connectFromModal}>
          <DialogContent>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              O player usa sua biblioteca do Navidrome — conecte pra continuar.
            </Typography>
            <Stack spacing={1.5}>
              <TextField label="URL" size="small" autoFocus value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })} fullWidth />
              <TextField label="Usuário" size="small" autoComplete="username" value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })} fullWidth />
              <TextField label="Senha" type="password" size="small" autoComplete="current-password"
                value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} fullWidth />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setPlayerModalOpen(false)}>Cancelar</Button>
            <Button type="submit" variant="contained">Conectar</Button>
          </DialogActions>
        </Box>
      </Dialog>
    </Box>
  );
}
