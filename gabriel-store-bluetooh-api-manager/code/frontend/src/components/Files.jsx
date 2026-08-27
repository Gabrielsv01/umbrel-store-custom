import { useEffect, useState } from "react";
import {
  Box, Card, CardContent, Stack, Select, MenuItem, FormControl, InputLabel,
  TextField, Button, Typography, Alert,
} from "@mui/material";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import { api } from "../api.js";

export default function Files({ devices }) {
  const [address, setAddress] = useState("");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!address && devices.length) setAddress(devices[0].address);
  }, [devices, address]);

  async function send() {
    setError(null);
    setResult(null);
    if (!address) return setError("Informe o endereço do dispositivo.");
    if (!file) return setError("Escolha um arquivo para enviar.");
    setBusy(true);
    try {
      setResult(await api.sendFile(address, file));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box>
      <Typography variant="h5" gutterBottom>Files</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Envie um arquivo para um dispositivo pareado via Bluetooth (OBEX Object Push).
        O dispositivo precisa estar pareado e aceitar arquivos recebidos.
      </Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {result && (
        <Alert severity={result.status === "complete" ? "success" : "info"} sx={{ mb: 2 }}>
          {result.file} → {result.address}: <b>{result.status}</b>
        </Alert>
      )}

      <Card>
        <CardContent>
          <Stack spacing={2}>
            {devices.length > 0 ? (
              <FormControl size="small" fullWidth>
                <InputLabel>Dispositivo</InputLabel>
                <Select label="Dispositivo" value={address} onChange={(e) => setAddress(e.target.value)}>
                  {devices.map((d) => (
                    <MenuItem key={d.address} value={d.address}>{d.name} ({d.address})</MenuItem>
                  ))}
                </Select>
              </FormControl>
            ) : (
              <TextField size="small" label="Endereço do dispositivo" placeholder="AA:BB:CC:DD:EE:FF"
                value={address} onChange={(e) => setAddress(e.target.value)} fullWidth />
            )}

            <Button component="label" variant="outlined" startIcon={<CloudUploadIcon />}>
              {file ? file.name : "Escolher arquivo"}
              <input hidden type="file" onChange={(e) => setFile(e.target.files[0])} />
            </Button>

            <Box>
              <Button variant="contained" onClick={send} disabled={busy}>
                {busy ? "Enviando…" : "Enviar arquivo"}
              </Button>
            </Box>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
