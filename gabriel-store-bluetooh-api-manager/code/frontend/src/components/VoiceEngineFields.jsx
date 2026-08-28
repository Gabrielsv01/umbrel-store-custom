import {
  Box, Stack, TextField, Select, MenuItem, InputLabel, FormControl, Typography,
  Alert, Checkbox, FormControlLabel, Tabs, Tab, Slider, Accordion,
  AccordionSummary, AccordionDetails,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { NORM_DEFAULTS, NORM_LABELS } from "../hooks/useVoiceEngine.js";

// Engine tabs + voice picker (single, or combine-multiple for Kokoro) +
// engine-specific params (Piper: velocidade/avançado; Kokoro: velocidade,
// volume, tags de voz, SSML, normalização). Shared by the Voz tab and the
// Agente tab's "reproduzir resposta em voz" panel — `ve` is a useVoiceEngine()
// instance, kept in the host component so it can also read activeVoice/buildParams().
export default function VoiceEngineFields({ ve, voiceLabel = "Voz" }) {
  const {
    engines, engine, setEngine, voices, voice, setVoice,
    kokoroVoices, setKokoroVoices, kokoroWeights, setKokoroWeights,
    lengthScale, setLengthScale, advanced, setAdvanced,
    noiseScale, setNoiseScale, noiseW, setNoiseW, sentenceSilence, setSentenceSilence,
    speed, setSpeed, volume, setVolume, allowVoiceTags, setAllowVoiceTags,
    ssml, setSsml, normOptions, setNormOptions,
  } = ve;

  return (
    <Stack spacing={1.5}>
      <Tabs value={engine} onChange={(_, v) => setEngine(v)} sx={{ minHeight: 36 }}>
        {engines.map((e) => (
          <Tab key={e.id} value={e.id} label={e.label} disabled={!e.available} sx={{ minHeight: 36, py: 0.5 }}
            title={!e.available ? `Configure ${e.id.toUpperCase()}_URL para habilitar` : undefined} />
        ))}
      </Tabs>

      {engine === "kokoro" ? (
        <FormControl size="small" sx={{ minWidth: 220 }}>
          <InputLabel>{voiceLabel} (combine várias)</InputLabel>
          <Select label={`${voiceLabel} (combine várias)`} multiple value={kokoroVoices}
            onChange={(e) => setKokoroVoices(e.target.value)}
            MenuProps={{ slotProps: { paper: { sx: { maxHeight: 320 } } } }}
            renderValue={(sel) => sel.length <= 1 ? sel.join(" + ")
              : sel.map((id) => `${id}(${kokoroWeights[id] ?? 1})`).join(" + ")}>
            {voices.length === 0 && <MenuItem value="" disabled>(nenhuma)</MenuItem>}
            {voices.map((v) => <MenuItem key={v} value={v}>{v}</MenuItem>)}
          </Select>
        </FormControl>
      ) : (
        <FormControl size="small" sx={{ minWidth: 160 }}>
          <InputLabel>{voiceLabel}</InputLabel>
          <Select label={voiceLabel} value={voice} onChange={(e) => setVoice(e.target.value)}
            MenuProps={{ slotProps: { paper: { sx: { maxHeight: 320 } } } }}>
            {voices.length === 0 && <MenuItem value="">(nenhuma)</MenuItem>}
            {voices.map((v) => <MenuItem key={v} value={v}>{v}</MenuItem>)}
          </Select>
        </FormControl>
      )}

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
    </Stack>
  );
}
