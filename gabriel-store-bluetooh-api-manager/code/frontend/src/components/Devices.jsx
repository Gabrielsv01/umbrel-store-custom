import { useState } from "react";
import {
  Box, Card, CardContent, Stack, Chip, IconButton, Button, TextField,
  Typography, Alert, Tooltip,
} from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import { api } from "../api.js";

function signalBars(rssi) {
  if (rssi == null) return "○○○○";
  if (rssi >= -60) return "████";
  if (rssi >= -70) return "███░";
  if (rssi >= -80) return "██░░";
  if (rssi >= -90) return "█░░░";
  return "░░░░";
}

function octetDiff(a, b) {
  const x = a.split(":");
  const y = b.split(":");
  if (x.length !== 6 || y.length !== 6) return 6;
  let d = 0;
  for (let i = 0; i < 6; i++) if (x[i].toLowerCase() !== y[i].toLowerCase()) d++;
  return d;
}

function isGeneric(name, address) {
  if (!name) return true;
  const dashed = address.replace(/:/g, "-").toLowerCase();
  return name.toLowerCase() === dashed || name === "(unknown)";
}

// Merge BLE + Classic entries that belong to the same physical device
// (their MAC addresses differ in at most one octet).
function unify(ble, classic) {
  const groups = [];
  const find = (addr) =>
    groups.find((g) => g.addresses.some((a) => octetDiff(a, addr) <= 1));

  for (const c of classic) {
    let g = find(c.address);
    if (!g) {
      g = { addresses: [], name: "", le: null, classic: null };
      groups.push(g);
    }
    g.addresses.push(c.address);
    g.classic = c;
    if (!isGeneric(c.name, c.address)) g.name = c.name;
  }
  for (const b of ble) {
    let g = find(b.address);
    if (!g) {
      g = { addresses: [], name: "", le: null, classic: null };
      groups.push(g);
    }
    g.addresses.push(b.address);
    g.le = b;
    if (!g.name && !isGeneric(b.name, b.address)) g.name = b.name;
  }
  for (const g of groups) {
    g.connected = Boolean(g.le?.connected || g.classic?.connected);
    g.rssi = g.le?.rssi ?? null;
    if (!g.name) g.name = (g.classic || g.le)?.name || g.addresses[0];
  }
  return groups.sort(
    (a, b) => Number(b.connected) - Number(a.connected) || (b.rssi ?? -999) - (a.rssi ?? -999)
  );
}

export default function Devices({ ble, classic, adapter, onChange }) {
  const [busy, setBusy] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState(null);
  const [adapterName, setAdapterName] = useState("");
  const groups = unify(ble, classic);

  async function rename(addr, current) {
    const name = window.prompt("Nome amigável para este dispositivo:", current || "");
    if (!name) return;
    setBusy(addr);
    setError(null);
    try {
      await api.renameDevice(addr, name);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
      onChange?.();
    }
  }

  async function saveAdapterName() {
    if (!adapterName.trim()) return;
    setError(null);
    try {
      await api.setAdapterName(adapterName.trim());
    } catch (e) {
      setError(e.message);
    }
  }

  async function run(key, fn) {
    setBusy(key);
    setError(null);
    try {
      const r = await fn();
      if (r && r.ok === false) setError(r.detail || "action failed");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
      onChange?.();
    }
  }

  async function scan() {
    setScanning(true);
    setError(null);
    try {
      await api.classicScan(15);
    } catch (e) {
      setError(e.message);
    } finally {
      setScanning(false);
      onChange?.();
    }
  }

  return (
    <Box>
      <Stack direction="row" spacing={2} sx={{ alignItems: "flex-start", flexWrap: "wrap", mb: 2 }}>
        <Typography variant="body2" color="text.secondary" sx={{ flex: 1, minWidth: 240 }}>
          Cada card é um dispositivo físico. <b>LE</b> = Low Energy (dados/GATT),{" "}
          <b>Classic</b> = BR/EDR (áudio/arquivos). Coloque um alto-falante em modo
          de pareamento e clique em Scan para encontrá-lo.
        </Typography>
        <Button variant="outlined" onClick={scan} disabled={scanning}>
          {scanning ? "Escaneando…" : "Scan"}
        </Button>
      </Stack>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", flexWrap: "wrap" }}>
            <TextField
              size="small" label="Nome Bluetooth deste Pi"
              placeholder={adapter?.alias || adapter?.name || "ex: Umbrel BT"}
              value={adapterName} onChange={(e) => setAdapterName(e.target.value)}
              sx={{ flex: 1, minWidth: 220 }}
            />
            <Button variant="outlined" onClick={saveAdapterName}>Salvar</Button>
          </Stack>
        </CardContent>
      </Card>

      {groups.length === 0 && (
        <Typography color="text.secondary" fontStyle="italic">Nenhum dispositivo ainda — escaneando…</Typography>
      )}

      <Stack spacing={2}>
        {groups.map((g) => {
          const cAddr = g.classic?.address;
          const leAddr = g.le?.address;
          return (
            <Card key={g.addresses.join()} variant="outlined"
              sx={{ borderColor: g.connected ? "success.main" : "divider" }}>
              <CardContent>
                <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
                  <Typography fontWeight={600}>{g.name}</Typography>
                  {g.le && <Chip size="small" label="LE" variant="outlined" />}
                  {g.classic && <Chip size="small" label="Classic" color="primary" variant="outlined" />}
                  {g.connected && <Chip size="small" label="connected" color="success" />}
                  <Box sx={{ flex: 1 }} />
                  <Typography variant="caption" className="mono" color="text.secondary">
                    {signalBars(g.rssi)} {g.rssi != null ? `${g.rssi}dBm` : ""}
                  </Typography>
                  <Tooltip title="Renomear">
                    <IconButton size="small" disabled={busy === (cAddr || leAddr)}
                      onClick={() => rename(cAddr || leAddr, g.name)}>
                      <EditIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Stack>

                {g.classic && (
                  <Stack direction="row" spacing={1.5}
                    sx={{ alignItems: "center", flexWrap: "wrap", mt: 1.5, pt: 1.5, borderTop: 1, borderColor: "divider" }}>
                    <Typography variant="caption" className="mono">{cAddr}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      Classic · {g.classic.paired ? "pareado" : "não pareado"}
                      {g.classic.connected ? " · conectado" : ""}
                    </Typography>
                    <Box sx={{ flex: 1 }} />
                    {!g.classic.connected ? (
                      <Button size="small" disabled={busy === cAddr}
                        onClick={() => run(cAddr, () => api.classicPairConnect(cAddr))}>
                        {busy === cAddr ? "…" : g.classic.paired ? "Conectar" : "Parear + Conectar"}
                      </Button>
                    ) : (
                      <Button size="small" disabled={busy === cAddr}
                        onClick={() => run(cAddr, () => api.classicDisconnect(cAddr))}>
                        Desconectar
                      </Button>
                    )}
                    {g.classic.paired && (
                      <Tooltip title="Remove o vínculo/chave de pareamento. Use se o áudio falhar com erro de autenticação, depois pareie de novo com o alto-falante em modo de pareamento.">
                        <Button size="small" color="warning" disabled={busy === cAddr}
                          onClick={() => run(cAddr, () => api.classicForget(cAddr))}>
                          Esquecer
                        </Button>
                      </Tooltip>
                    )}
                  </Stack>
                )}

                {g.le && (
                  <Stack direction="row" spacing={1.5}
                    sx={{ alignItems: "center", flexWrap: "wrap", mt: 1.5, pt: 1.5, borderTop: 1, borderColor: "divider" }}>
                    <Typography variant="caption" className="mono">{leAddr}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      LE · {g.le.connected ? "conectado (GATT)" : "não conectado"}
                    </Typography>
                    <Box sx={{ flex: 1 }} />
                    <Button size="small" disabled={busy === leAddr}
                      onClick={() => run(leAddr, () => (g.le.connected ? api.disconnect(leAddr) : api.connect(leAddr)))}>
                      {busy === leAddr ? "…" : g.le.connected ? "Desconectar" : "Conectar (BLE)"}
                    </Button>
                  </Stack>
                )}
              </CardContent>
            </Card>
          );
        })}
      </Stack>
    </Box>
  );
}
