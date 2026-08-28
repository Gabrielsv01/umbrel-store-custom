import { useEffect, useRef, useState } from "react";
import {
  Box, Card, CardContent, Stack, TextField, Select, MenuItem, InputLabel,
  FormControl, Button, Typography, Alert, Checkbox, FormControlLabel,
  RadioGroup, Radio, Divider, Tabs, Tab, Chip, IconButton,
  Slider, Accordion, AccordionSummary, AccordionDetails,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import SpeakerIcon from "@mui/icons-material/Speaker";
import DeleteOutlineIcon from "@mui/icons-material/Delete";
import { api } from "../api.js";
import WeekdayPicker from "./WeekdayPicker.jsx";
import TimeRepeatRow from "./TimeRepeatRow.jsx";

const ENGINE_LABELS = { piper: "Piper", kokoro: "Kokoro" };

const STATUS_META = {
  queued: { label: "Na fila", color: "default" },
  generating: { label: "Gerando…", color: "info" },
  scheduled: { label: "Agendado", color: "secondary" },
  "queued-to-play": { label: "Enviado ao alto-falante", color: "success" },
  ready: { label: "Pronto", color: "success" },
  error: { label: "Erro", color: "error" },
};

// Kokoro's own defaults (kokoro-fastapi NormalizationOptions) — sending these
// explicitly when unchanged is equivalent to omitting the field entirely.
const NORM_DEFAULTS = {
  normalize: true,
  unit_normalization: false,
  url_normalization: true,
  email_normalization: true,
  optional_pluralization_normalization: true,
  phone_normalization: true,
  replace_remaining_symbols: true,
};
const NORM_LABELS = {
  normalize: "Normalizar texto (recomendado)",
  unit_normalization: "Unidades (10KB → 10 kilobytes)",
  url_normalization: "URLs",
  email_normalization: "E-mails",
  optional_pluralization_normalization: "Plurais opcionais — ex.: (s)",
  phone_normalization: "Telefones",
  replace_remaining_symbols: "Símbolos restantes por extenso",
};

export default function Voice({ classic }) {
  const [engines, setEngines] = useState([{ id: "piper", label: "Piper", available: true }]);
  const [engine, setEngine] = useState("piper");
  const [voices, setVoices] = useState([]);
  const [voice, setVoice] = useState("");
  const [kokoroVoices, setKokoroVoices] = useState([]);
  const [kokoroWeights, setKokoroWeights] = useState({});
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
  const [speed, setSpeed] = useState(1.0);
  const [volume, setVolume] = useState(1.0);
  const [allowVoiceTags, setAllowVoiceTags] = useState(false);
  const [ssml, setSsml] = useState(false);
  const [normOptions, setNormOptions] = useState(NORM_DEFAULTS);
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
    api.ttsEngines().then(setEngines).catch(() => {});
  }, []);

  useEffect(() => {
    setVoices([]);
    setVoice("");
    setKokoroVoices([]);
    setKokoroWeights({});
    api.ttsVoices(engine).then((v) => {
      setVoices(v);
      if (!v[0]) return;
      if (engine === "kokoro") setKokoroVoices([v[0]]);
      else setVoice(v[0]);
    }).catch((e) => setError(`${ENGINE_LABELS[engine] || engine}: ${e.message}`));
  }, [engine]);

  useEffect(() => {
    if (!device && connectedSpeakers.length) setDevice(connectedSpeakers[0].address);
  }, [connectedSpeakers, device]);

  // SSML translation emits [voice:]/[rate:] spans, so the API requires
  // allow_voice_tags whenever ssml is on.
  useEffect(() => {
    if (ssml) setAllowVoiceTags(true);
  }, [ssml]);

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

  // A single voice needs no weight; combining 2+ uses Kokoro's
  // "nome(peso)+nome2(peso2)" syntax so each voice's blend share is explicit.
  const kokoroVoice = kokoroVoices.length <= 1
    ? (kokoroVoices[0] || "")
    : kokoroVoices.map((id) => `${id}(${kokoroWeights[id] ?? 1})`).join("+");
  const activeVoice = engine === "kokoro" ? kokoroVoice : voice;

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
        length_scale: engine === "piper" ? lengthScale : undefined,
        noise_scale: engine === "piper" && advanced && noiseScale ? noiseScale : undefined,
        noise_w: engine === "piper" && advanced && noiseW ? noiseW : undefined,
        sentence_silence: engine === "piper" && advanced && sentenceSilence ? sentenceSilence : undefined,
        speed: engine === "kokoro" ? speed : undefined,
        volume_multiplier: engine === "kokoro" ? volume : undefined,
        allow_voice_tags: engine === "kokoro" ? allowVoiceTags : undefined,
        ssml: engine === "kokoro" ? ssml : undefined,
        normalization_options: engine === "kokoro" ? normOptions : undefined,
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

      <Tabs value={engine} onChange={(_, v) => setEngine(v)} sx={{ mb: 2 }}>
        {engines.map((e) => (
          <Tab key={e.id} value={e.id} label={e.label} disabled={!e.available}
            title={!e.available ? `Configure ${e.id.toUpperCase()}_URL para habilitar` : undefined} />
        ))}
      </Tabs>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Stack spacing={2}>
            <TextField multiline minRows={3} placeholder="Texto para falar…" value={text}
              onChange={(e) => setText(e.target.value)} fullWidth />

            <Stack direction="row" spacing={1.5} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
              {engine === "kokoro" ? (
                <FormControl size="small" sx={{ minWidth: 220 }}>
                  <InputLabel>Voz (combine várias)</InputLabel>
                  <Select label="Voz (combine várias)" multiple value={kokoroVoices}
                    onChange={(e) => setKokoroVoices(e.target.value)}
                    renderValue={(sel) => sel.length <= 1 ? sel.join(" + ")
                      : sel.map((id) => `${id}(${kokoroWeights[id] ?? 1})`).join(" + ")}>
                    {voices.length === 0 && <MenuItem value="" disabled>(nenhuma)</MenuItem>}
                    {voices.map((v) => <MenuItem key={v} value={v}>{v}</MenuItem>)}
                  </Select>
                </FormControl>
              ) : (
                <FormControl size="small" sx={{ minWidth: 160 }}>
                  <InputLabel>Voz</InputLabel>
                  <Select label="Voz" value={voice} onChange={(e) => setVoice(e.target.value)}>
                    {voices.length === 0 && <MenuItem value="">(nenhuma)</MenuItem>}
                    {voices.map((v) => <MenuItem key={v} value={v}>{v}</MenuItem>)}
                  </Select>
                </FormControl>
              )}
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

            {engine === "kokoro" && kokoroVoices.length > 1 && (
              <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: "wrap" }}>
                {kokoroVoices.map((id) => (
                  <TextField key={id} label={id} type="number" size="small"
                    inputProps={{ step: 0.1, min: 0.1, max: 5 }}
                    value={kokoroWeights[id] ?? 1}
                    onChange={(e) => setKokoroWeights((cur) => ({ ...cur, [id]: e.target.value }))}
                    sx={{ width: 130 }} />
                ))}
              </Stack>
            )}

            {engine === "piper" ? (
              <>
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
              </>
            ) : (
              <>
                <Stack direction="row" spacing={4} useFlexGap sx={{ flexWrap: "wrap" }}>
                  <Box sx={{ px: 0.5, minWidth: 220 }}>
                    <Typography variant="body2" gutterBottom>
                      Velocidade: {speed.toFixed(2)}x
                    </Typography>
                    <Slider value={speed} onChange={(_, v) => setSpeed(v)}
                      min={0.25} max={4.0} step={0.05} size="small" sx={{ maxWidth: 320 }} />
                  </Box>
                  <Box sx={{ px: 0.5, minWidth: 220 }}>
                    <Typography variant="body2" gutterBottom>
                      Volume: {volume.toFixed(2)}x
                    </Typography>
                    <Slider value={volume} onChange={(_, v) => setVolume(v)}
                      min={0} max={10} step={0.1} size="small" sx={{ maxWidth: 320 }} />
                  </Box>
                </Stack>

                <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: "wrap" }}>
                  <FormControlLabel
                    control={<Checkbox checked={allowVoiceTags} disabled={ssml}
                      onChange={(e) => setAllowVoiceTags(e.target.checked)} />}
                    label='Tags de voz "[voice:nome]" no texto' />
                  <FormControlLabel
                    control={<Checkbox checked={ssml}
                      onChange={(e) => setSsml(e.target.checked)} />}
                    label="Interpretar texto como SSML" />
                </Stack>
                {(allowVoiceTags || ssml) && (
                  <Alert severity="info" sx={{ py: 0 }}>
                    {ssml
                      ? "O texto será tratado como SSML (ex.: <speak>, <break>, <emphasis>) — a tradução usa tags [voice:]/[rate:] internamente."
                      : 'Use "[voice:nome]" dentro do texto para trocar de voz naquele ponto.'}
                  </Alert>
                )}

                <Accordion sx={{ boxShadow: "none", border: 1, borderColor: "divider" }}>
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Typography variant="body2">Opções de normalização</Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Stack sx={{ flexWrap: "wrap" }} direction="row">
                      {Object.keys(NORM_DEFAULTS).map((key) => (
                        <FormControlLabel key={key} sx={{ minWidth: 260 }}
                          control={
                            <Checkbox checked={!!normOptions[key]}
                              onChange={(e) => setNormOptions((cur) => ({ ...cur, [key]: e.target.checked }))} />
                          }
                          label={NORM_LABELS[key]} />
                      ))}
                    </Stack>
                  </AccordionDetails>
                </Accordion>
              </>
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
