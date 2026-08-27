import { useEffect, useState } from "react";
import {
  Box, Card, CardContent, Stack, TextField, Select, MenuItem, InputLabel,
  FormControl, Button, Typography, Alert, List, ListItem, ListItemText,
  IconButton, Tooltip,
} from "@mui/material";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import PowerSettingsNewIcon from "@mui/icons-material/PowerSettingsNew";
import DeleteIcon from "@mui/icons-material/Delete";
import { api } from "../api.js";
import WeekdayPicker, { WEEKDAYS } from "./WeekdayPicker.jsx";
import TimeRepeatRow from "./TimeRepeatRow.jsx";

export default function Schedule({ classic }) {
  const [data, setData] = useState({ now: "", tz: "", items: [] });
  const [error, setError] = useState(null);

  const connectedSpeakers = classic.filter((c) => c.connected);
  const [device, setDevice] = useState("");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState(null);
  const [time, setTime] = useState("08:00");
  const [repeat, setRepeat] = useState("once");
  const [date, setDate] = useState("");
  const [days, setDays] = useState([]);
  const [title, setTitle] = useState("");

  async function refresh() {
    try {
      setData(await api.schedules());
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!device && connectedSpeakers.length) setDevice(connectedSpeakers[0].address);
  }, [connectedSpeakers, device]);

  async function create() {
    setError(null);
    if (!device) return setError("Escolha um alto-falante.");
    if (!file && !url) return setError("Escolha um arquivo ou cole uma URL.");
    if (repeat === "once" && !date) return setError("Escolha uma data.");
    if (repeat === "weekly" && days.length === 0) return setError("Escolha pelo menos um dia da semana.");
    try {
      await api.scheduleCreate({
        device, time, repeat,
        days: days.join(","),
        date: repeat === "once" ? date : undefined,
        title: title || undefined,
        file, url: url || undefined,
      });
      setUrl(""); setFile(null); setTitle("");
      const el = document.getElementById("sched-file");
      if (el) el.value = "";
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  }

  function describe(s) {
    if (s.repeat === "once") return `uma vez em ${s.date} às ${s.time}`;
    if (s.repeat === "daily") return `todo dia às ${s.time}`;
    return `${s.days.map((d) => WEEKDAYS[d]).join(", ")} às ${s.time}`;
  }

  return (
    <Box>
      <Typography variant="h5" gutterBottom>Agenda</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Agende uma faixa para tocar num alto-falante. Dispara pelo{" "}
        <b>relógio do servidor</b>: <b>{data.now}</b> ({data.tz}). Ajuste o TZ na
        configuração do app se estiver errado.
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Stack spacing={2}>
            <TextField label="Título (opcional)" placeholder="ex: Alarme da manhã" size="small"
              value={title} onChange={(e) => setTitle(e.target.value)} fullWidth />

            <FormControl size="small" fullWidth>
              <InputLabel>Alto-falante</InputLabel>
              <Select label="Alto-falante" value={device} onChange={(e) => setDevice(e.target.value)}>
                {connectedSpeakers.map((c) => (
                  <MenuItem key={c.address} value={c.address}>{c.name} ({c.address})</MenuItem>
                ))}
                {!connectedSpeakers.length && <MenuItem value="" disabled>Nenhum conectado</MenuItem>}
              </Select>
            </FormControl>

            <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: "wrap" }}>
              <Button component="label" variant="outlined" startIcon={<CloudUploadIcon />}>
                {file ? file.name : "Escolher arquivo"}
                <input id="sched-file" hidden type="file" accept="audio/*"
                  onChange={(e) => setFile(e.target.files[0])} />
              </Button>
              <TextField label="ou URL" placeholder="https://exemplo.com/musica.mp3" size="small"
                value={url} onChange={(e) => setUrl(e.target.value)} sx={{ flex: 1, minWidth: 220 }} />
            </Stack>

            <TimeRepeatRow time={time} onTimeChange={setTime} repeat={repeat} onRepeatChange={setRepeat}
              date={date} onDateChange={setDate} />
            {repeat === "weekly" && <WeekdayPicker days={days} onChange={setDays} />}

            <Box>
              <Button variant="contained" onClick={create}>➕ Agendar</Button>
            </Box>
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="subtitle1" gutterBottom>Agendados ({data.items.length})</Typography>
          {data.items.length === 0 && (
            <Typography variant="body2" color="text.secondary">Nenhuma agenda ainda.</Typography>
          )}
          <List dense>
            {data.items.map((s) => (
              <ListItem key={s.id} divider
                secondaryAction={
                  <Stack direction="row" spacing={0.5}>
                    <Tooltip title={s.enabled ? "Desativar" : "Ativar"}>
                      <IconButton size="small" onClick={() => api.scheduleToggle(s.id, !s.enabled).then(refresh)}>
                        <PowerSettingsNewIcon fontSize="small" color={s.enabled ? "success" : "disabled"} />
                      </IconButton>
                    </Tooltip>
                    <IconButton size="small" onClick={() => api.scheduleDelete(s.id).then(refresh)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                }>
                <ListItemText
                  primary={`${s.title || describe(s)} · ${s.device}`}
                  secondary={`${s.title ? describe(s) + " · " : ""}${s.label}${s.last_fired ? ` · disparou pela última vez em ${s.last_fired}` : ""}`}
                />
              </ListItem>
            ))}
          </List>
        </CardContent>
      </Card>
    </Box>
  );
}
