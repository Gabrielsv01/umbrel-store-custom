import { useEffect, useState } from "react";
import {
  Box, Card, CardContent, Stack, TextField, Select, MenuItem, InputLabel,
  FormControl, Button, Typography, Alert, Checkbox, FormControlLabel,
  RadioGroup, Radio, List, ListItem, ListItemText, Divider,
} from "@mui/material";
import { api } from "../api.js";
import WeekdayPicker from "./WeekdayPicker.jsx";
import TimeRepeatRow from "./TimeRepeatRow.jsx";

export default function Voice({ classic }) {
  const [voices, setVoices] = useState([]);
  const [voice, setVoice] = useState("");
  const [text, setText] = useState("");
  const [device, setDevice] = useState("");
  const [mode, setMode] = useState("play");
  const [time, setTime] = useState("08:00");
  const [repeat, setRepeat] = useState("once");
  const [date, setDate] = useState("");
  const [days, setDays] = useState([]);
  const [title, setTitle] = useState("");
  const [lengthScale, setLengthScale] = useState("1.0");
  const [advanced, setAdvanced] = useState(false);
  const [noiseScale, setNoiseScale] = useState("");
  const [noiseW, setNoiseW] = useState("");
  const [sentenceSilence, setSentenceSilence] = useState("");
  const [status, setStatus] = useState({ jobs: [], queued: 0 });
  const [storage, setStorage] = useState(null);
  const [error, setError] = useState(null);

  const connectedSpeakers = classic.filter((c) => c.connected);

  useEffect(() => {
    api.ttsVoices().then((v) => { setVoices(v); if (v[0]) setVoice((cur) => cur || v[0]); })
      .catch((e) => setError(`Piper: ${e.message}`));
  }, []);

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

  async function generate() {
    setError(null);
    if (!text.trim()) return setError("Digite um texto.");
    if (!voice) return setError("Nenhuma voz disponível.");
    if (!device) return setError("Escolha um alto-falante conectado.");
    if (mode === "schedule" && repeat === "once" && !date) return setError("Escolha uma data.");
    if (mode === "schedule" && repeat === "weekly" && days.length === 0) return setError("Escolha os dias da semana.");
    try {
      await api.ttsSubmit({
        text, voice, device, mode,
        length_scale: lengthScale,
        noise_scale: advanced && noiseScale ? noiseScale : undefined,
        noise_w: advanced && noiseW ? noiseW : undefined,
        sentence_silence: advanced && sentenceSilence ? sentenceSilence : undefined,
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

  return (
    <Box>
      <Typography variant="h5" gutterBottom>Voz</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Digite um texto, o Piper transforma em fala e toca num alto-falante Bluetooth
        — agora ou numa agenda. Conecte um alto-falante na aba Devices.
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Stack spacing={2}>
            <TextField multiline minRows={3} placeholder="Texto para falar…" value={text}
              onChange={(e) => setText(e.target.value)} fullWidth />

            <Stack direction="row" spacing={1.5} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
              <FormControl size="small" sx={{ minWidth: 160 }}>
                <InputLabel>Voz</InputLabel>
                <Select label="Voz" value={voice} onChange={(e) => setVoice(e.target.value)}>
                  {voices.length === 0 && <MenuItem value="">(nenhuma)</MenuItem>}
                  {voices.map((v) => <MenuItem key={v} value={v}>{v}</MenuItem>)}
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: 200, flex: 1 }}>
                <InputLabel>Alto-falante</InputLabel>
                <Select label="Alto-falante" value={device} onChange={(e) => setDevice(e.target.value)}>
                  {connectedSpeakers.map((c) => (
                    <MenuItem key={c.address} value={c.address}>{c.name}</MenuItem>
                  ))}
                  {!connectedSpeakers.length && <MenuItem value="" disabled>Nenhum conectado</MenuItem>}
                </Select>
              </FormControl>
            </Stack>

            <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
              <FormControl size="small" sx={{ minWidth: 140 }}>
                <InputLabel>Velocidade</InputLabel>
                <Select label="Velocidade" value={lengthScale} onChange={(e) => setLengthScale(e.target.value)}>
                  <MenuItem value="0.85">Rápido</MenuItem>
                  <MenuItem value="1.0">Normal</MenuItem>
                  <MenuItem value="1.25">Mais lento</MenuItem>
                  <MenuItem value="1.5">Bem lento</MenuItem>
                </Select>
              </FormControl>
              <FormControlLabel
                control={<Checkbox checked={advanced} onChange={(e) => setAdvanced(e.target.checked)} />}
                label="Voz avançada" />
            </Stack>

            {advanced && (
              <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: "wrap" }}>
                <TextField label="Expressividade" type="number" size="small" inputProps={{ step: 0.05, min: 0, max: 1.5 }}
                  placeholder="0.667" value={noiseScale} onChange={(e) => setNoiseScale(e.target.value)} sx={{ width: 140 }} />
                <TextField label="Cadência" type="number" size="small" inputProps={{ step: 0.05, min: 0, max: 1.5 }}
                  placeholder="0.8" value={noiseW} onChange={(e) => setNoiseW(e.target.value)} sx={{ width: 140 }} />
                <TextField label="Pausa entre frases (s)" type="number" size="small" inputProps={{ step: 0.1, min: 0, max: 5 }}
                  placeholder="0.2" value={sentenceSilence} onChange={(e) => setSentenceSilence(e.target.value)} sx={{ width: 160 }} />
              </Stack>
            )}

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

            <Box>
              <Button variant="contained" onClick={generate}>
                🔊 {mode === "schedule" ? "Gerar e agendar" : "Gerar e tocar"}
              </Button>
            </Box>
          </Stack>
        </CardContent>
      </Card>

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="subtitle1" gutterBottom>
            Fila de geração ({status.queued} aguardando)
          </Typography>
          {status.jobs.length === 0 && (
            <Typography variant="body2" color="text.secondary">Nenhum job ainda.</Typography>
          )}
          <List dense>
            {status.jobs.map((j) => (
              <ListItem key={j.id} divider>
                <ListItemText primary={j.preview} secondary={j.status + (j.error ? `: ${j.error}` : "")} />
              </ListItem>
            ))}
          </List>
        </CardContent>
      </Card>

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
