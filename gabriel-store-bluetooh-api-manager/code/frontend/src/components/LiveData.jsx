import { useEffect, useState } from "react";
import {
  Box, Grid, Card, CardContent, Stack, Select, MenuItem, FormControl,
  InputLabel, Button, Typography, Alert, List, ListItem, ListItemText,
} from "@mui/material";
import { api } from "../api.js";

export default function LiveData({ devices, gattData }) {
  const connected = devices.filter((d) => d.connected);
  const [selected, setSelected] = useState("");
  const [services, setServices] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  // Default the selection to the first connected device.
  useEffect(() => {
    if (!selected && connected.length) setSelected(connected[0].address);
  }, [connected, selected]);

  async function loadServices(addr) {
    if (!addr) return;
    setLoading(true);
    setError(null);
    try {
      setServices(await api.services(addr));
    } catch (e) {
      setError(e.message);
      setServices([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadServices(selected);
  }, [selected]);

  async function act(fn) {
    setError(null);
    try {
      await fn();
      await loadServices(selected);
    } catch (e) {
      setError(e.message);
    }
  }

  const feed = gattData.filter((g) => !selected || g.address === selected);

  if (connected.length === 0) {
    return (
      <Typography color="text.secondary">
        Nenhuma conexão de <b>dados BLE</b>. Live Data mostra características GATT —
        conecte um dispositivo com <b>"Conectar (BLE)"</b> na aba Devices. Conexões
        Classic (alto-falantes/fones) não fornecem dados GATT aqui.
      </Typography>
    );
  }

  return (
    <Box>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", flexWrap: "wrap", mb: 2 }}>
        <FormControl size="small" sx={{ minWidth: 220 }}>
          <InputLabel>Dispositivo</InputLabel>
          <Select label="Dispositivo" value={selected} onChange={(e) => setSelected(e.target.value)}>
            {connected.map((d) => (
              <MenuItem key={d.address} value={d.address}>{d.name} ({d.address})</MenuItem>
            ))}
          </Select>
        </FormControl>
        <Button variant="outlined" onClick={() => loadServices(selected)}>Atualizar</Button>
      </Stack>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 7 }}>
          <Card>
            <CardContent>
              <Typography variant="subtitle1" gutterBottom>
                Serviços GATT {loading && "…"}
              </Typography>
              {services.map((s) => (
                <Box key={s.uuid} sx={{ mb: 2 }}>
                  <Typography variant="body2" className="mono" color="primary" gutterBottom>
                    {s.description || s.uuid}
                  </Typography>
                  {s.characteristics.map((c) => (
                    <Box key={c.uuid} sx={{ bgcolor: "action.hover", borderRadius: 1.5, p: 1, mb: 1 }}>
                      <Typography variant="body2" className="mono">{c.description || c.uuid}</Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
                        {c.properties.join(", ")}
                      </Typography>
                      <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
                        {c.properties.includes("read") && (
                          <Button size="small" onClick={() => act(() => api.read(selected, c.uuid))}>Read</Button>
                        )}
                        {(c.properties.includes("notify") || c.properties.includes("indicate")) && (
                          <Button size="small" color={c.notifying ? "success" : "primary"}
                            onClick={() => act(() => api.notify(selected, c.uuid, !c.notifying))}>
                            {c.notifying ? "Parar notify" : "Notify"}
                          </Button>
                        )}
                        {(c.properties.includes("write") || c.properties.includes("write-without-response")) && (
                          <WriteButton addr={selected} uuid={c.uuid} onError={setError} />
                        )}
                      </Stack>
                    </Box>
                  ))}
                </Box>
              ))}
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, md: 5 }}>
          <Card>
            <CardContent>
              <Typography variant="subtitle1" gutterBottom>Dados recebidos</Typography>
              {feed.length === 0 && (
                <Typography variant="body2" color="text.secondary">Nenhum dado ainda.</Typography>
              )}
              <List dense>
                {feed.map((g, i) => (
                  <ListItem key={i} divider>
                    <ListItemText
                      primary={<span className="mono">{g.text ?? g.hex}</span>}
                      secondary={`${g.char.slice(0, 8)}… · ${g.length}B`}
                    />
                  </ListItem>
                ))}
              </List>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}

function WriteButton({ addr, uuid, onError }) {
  async function write() {
    const text = window.prompt("Valor para escrever (texto):");
    if (text == null) return;
    try {
      await api.write(addr, uuid, { text });
    } catch (e) {
      onError(e.message);
    }
  }
  return <Button size="small" onClick={write}>Write</Button>;
}
