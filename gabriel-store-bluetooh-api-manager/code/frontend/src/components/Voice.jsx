import { useEffect, useRef, useState } from "react";
import {
  Box, Card, CardContent, Stack, TextField, Typography, Alert,
  FormControlLabel, RadioGroup, Radio, Divider, Chip, IconButton, Button,
  Select, MenuItem, InputLabel, FormControl,
} from "@mui/material";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import SpeakerIcon from "@mui/icons-material/Speaker";
import DeleteOutlineIcon from "@mui/icons-material/Delete";
import { api } from "../api.js";
import { useVoiceEngine } from "../hooks/useVoiceEngine.js";
import VoiceEngineFields from "./VoiceEngineFields.jsx";
import WeekdayPicker from "./WeekdayPicker.jsx";
import TimeRepeatRow from "./TimeRepeatRow.jsx";

const STATUS_META = {
  queued: { label: "Na fila", color: "default" },
  generating: { label: "Gerando…", color: "info" },
  scheduled: { label: "Agendado", color: "secondary" },
  "queued-to-play": { label: "Enviado ao alto-falante", color: "success" },
  ready: { label: "Pronto", color: "success" },
  error: { label: "Erro", color: "error" },
};

export default function Voice({ classic }) {
  const ve = useVoiceEngine("voice_engine_voz");
  const { engine, activeVoice, buildParams, voiceError } = ve;
  const [text, setText] = useState("");
  const [device, setDevice] = useState("");
  const [mode, setMode] = useState("play");
  const [time, setTime] = useState("08:00");
  const [repeat, setRepeat] = useState("once");
  const [date, setDate] = useState("");
  const [days, setDays] = useState([]);
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState({ jobs: [], queued: 0 });
  const [storage, setStorage] = useState(null);
  const [error, setError] = useState(null);
  const [playingJobId, setPlayingJobId] = useState(null);
  const audioRef = useRef(null);

  function playInBrowser(jobId) {
    const el = audioRef.current;
    if (!el) return;
    if (playingJobId === jobId && !el.paused) {
      el.pause();
      return;
    }
    el.src = api.ttsJobAudioUrl(jobId);
    el.play().catch(() => {});
    setPlayingJobId(jobId);
  }

  const connectedSpeakers = classic.filter((c) => c.connected);

  useEffect(() => {
    if (voiceError) setError(voiceError);
  }, [voiceError]);

  useEffect(() => {
    if (!device && connectedSpeakers.length) setDevice(connectedSpeakers[0].address);
  }, [connectedSpeakers, device]);

  useEffect(() => {
    const tick = () => api.ttsStatus().then(setStatus).catch(() => {});
    const stick = () => api.storage().then(setStorage).catch(() => {});
    tick();
    stick();
    const t = setInterval(tick, 2000);
    const t2 = setInterval(stick, 10000);
    return () => { clearInterval(t); clearInterval(t2); };
  }, []);

  async function cleanNow() {
    try {
      await api.cleanup();
      setStorage(await api.storage());
    } catch (e) {
      setError(e.message);
    }
  }

  function fmtBytes(b) {
    if (b == null) return "—";
    if (b < 1024) return `${b} B`;
    if (b < 1048576) return `${(b / 1024).toFixed(0)} KB`;
    return `${(b / 1048576).toFixed(1)} MB`;
  }

  // target: "speaker" (gera e toca no alto-falante agora) ou "generate" (só
  // gera — fica disponível na Fila de geração pra ouvir no navegador ou
  // enviar pro alto-falante depois).
  async function generate(target) {
    setError(null);
    if (!text.trim()) return setError("Digite um texto.");
    if (!activeVoice) return setError("Nenhuma voz disponível.");
    const needsDevice = mode === "schedule" || target === "speaker";
    if (needsDevice && !device) return setError("Escolha um alto-falante conectado.");
    if (mode === "schedule" && repeat === "once" && !date) return setError("Escolha uma data.");
    if (mode === "schedule" && repeat === "weekly" && days.length === 0) return setError("Escolha os dias da semana.");
    const submitMode = mode === "schedule" ? "schedule" : (target === "speaker" ? "play" : "browser");
    try {
      await api.ttsSubmit({
        text, voice: activeVoice, device: needsDevice ? device : undefined, mode: submitMode, engine,
        ...buildParams(),
        time: mode === "schedule" ? time : undefined,
        repeat: mode === "schedule" ? repeat : undefined,
        days: mode === "schedule" ? days.join(",") : undefined,
        date: mode === "schedule" && repeat === "once" ? date : undefined,
        title: title || undefined,
      });
      setText(""); setTitle("");
    } catch (e) {
      setError(e.message);
    }
  }

  async function sendJobToSpeaker(jobId) {
    setError(null);
    if (!device) return setError("Escolha um alto-falante conectado.");
    try {
      await api.ttsPlayJob(jobId, device);
      setStatus(await api.ttsStatus());
    } catch (e) {
      setError(e.message);
    }
  }

  async function deleteJob(jobId) {
    if (playingJobId === jobId && audioRef.current) {
      audioRef.current.pause();
    }
    try {
      await api.ttsDeleteJob(jobId);
      setStatus(await api.ttsStatus());
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <Box>
      <Typography variant="h5" gutterBottom>Voz</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Digite um texto e escolha um motor de voz para transformar em fala. Toque
        aqui no navegador, num alto-falante Bluetooth, ou agende. Conecte um
        alto-falante na aba Devices.
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Stack spacing={2}>
            <TextField multiline minRows={3} placeholder="Texto para falar…" value={text}
              onChange={(e) => setText(e.target.value)} fullWidth />

            <VoiceEngineFields ve={ve} />

            <FormControl size="small" sx={{ minWidth: 200, maxWidth: 320 }}>
              <InputLabel>Alto-falante</InputLabel>
              <Select label="Alto-falante" value={device} onChange={(e) => setDevice(e.target.value)}>
                {connectedSpeakers.map((c) => (
                  <MenuItem key={c.address} value={c.address}>{c.name}</MenuItem>
                ))}
                {!connectedSpeakers.length && <MenuItem value="" disabled>Nenhum conectado</MenuItem>}
              </Select>
            </FormControl>

            <RadioGroup row value={mode} onChange={(e) => setMode(e.target.value)}>
              <FormControlLabel value="play" control={<Radio size="small" />} label="Tocar agora" />
              <FormControlLabel value="schedule" control={<Radio size="small" />} label="Agendar" />
            </RadioGroup>

            {mode === "schedule" && (
              <>
                <TextField label="Título (opcional)" size="small" value={title}
                  onChange={(e) => setTitle(e.target.value)} fullWidth />
                <TimeRepeatRow time={time} onTimeChange={setTime} repeat={repeat} onRepeatChange={setRepeat}
                  date={date} onDateChange={setDate} />
                {repeat === "weekly" && <WeekdayPicker days={days} onChange={setDays} />}
              </>
            )}

            {mode === "schedule" ? (
              <Box>
                <Button variant="contained" onClick={() => generate("speaker")}>
                  🔊 Gerar e agendar
                </Button>
              </Box>
            ) : (
              <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: "wrap" }}>
                <Button variant="outlined" onClick={() => generate("generate")}>
                  🎛️ Gerar
                </Button>
                <Button variant="contained" onClick={() => generate("speaker")}
                  disabled={!connectedSpeakers.length}>
                  📡 Tocar no alto-falante
                </Button>
              </Stack>
            )}
            <audio ref={audioRef} style={{ display: "none" }}
              onPause={() => setPlayingJobId(null)} onEnded={() => setPlayingJobId(null)} />
          </Stack>
        </CardContent>
      </Card>

      <Box sx={{ mb: 2 }}>
        <Typography variant="subtitle1" gutterBottom>
          Fila de geração ({status.queued} aguardando)
        </Typography>
        {status.jobs.length === 0 && (
          <Card variant="outlined"><CardContent>
            <Typography variant="body2" color="text.secondary">Nenhum job ainda.</Typography>
          </CardContent></Card>
        )}
        <Stack spacing={1}>
          {status.jobs.map((j) => {
            const meta = STATUS_META[j.status] || { label: j.status, color: "default" };
            return (
              <Card key={j.id} variant="outlined">
                <CardContent sx={{ py: 1.25, "&:last-child": { pb: 1.25 } }}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                    <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0 }}>
                      {j.preview}
                    </Typography>
                    <Chip size="small" label={meta.label} color={meta.color} variant="outlined" />
                    <IconButton size="small" onClick={() => deleteJob(j.id)} title="Excluir">
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                  {j.error && (
                    <Typography variant="caption" color="error.main">{j.error}</Typography>
                  )}
                  {j.status === "ready" && (
                    <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                      <Button size="small"
                        variant={playingJobId === j.id ? "contained" : "outlined"}
                        startIcon={playingJobId === j.id ? <PauseIcon /> : <PlayArrowIcon />}
                        onClick={() => playInBrowser(j.id)}>
                        Navegador
                      </Button>
                      <Button size="small" variant="outlined" startIcon={<SpeakerIcon />}
                        disabled={!device} onClick={() => sendJobToSpeaker(j.id)}>
                        Alto-falante
                      </Button>
                    </Stack>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </Stack>
      </Box>

      <Card>
        <CardContent>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", flexWrap: "wrap" }}>
            <Typography variant="subtitle1">Armazenamento</Typography>
            <Typography variant="body2" color="text.secondary">
              {storage ? `${storage.files} arquivos de áudio · ${fmtBytes(storage.bytes)}` : "…"}
            </Typography>
            <Box sx={{ flex: 1 }} />
            <Button size="small" variant="outlined" onClick={cleanNow}>Limpar agora</Button>
          </Stack>
          <Divider sx={{ my: 1.5 }} />
          <Typography variant="body2" color="text.secondary">
            A limpeza automática remove áudios com mais de {storage?.retention_days ?? 7} dias.{" "}
            <b>Limpar agora</b> apaga todo o áudio em cache imediatamente. Arquivos
            ligados a uma agenda são sempre mantidos.
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
}
