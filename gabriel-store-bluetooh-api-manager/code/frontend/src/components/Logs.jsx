import { useMemo, useState } from "react";
import {
  Box, Stack, Select, MenuItem, TextField, IconButton, Button, Chip,
  Typography, Tooltip,
} from "@mui/material";
import PauseIcon from "@mui/icons-material/Pause";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import DownloadIcon from "@mui/icons-material/Download";

function fmtTime(ts) {
  return new Date(ts * 1000).toLocaleTimeString();
}

const LEVELS = ["all", "debug", "info", "warn", "error"];
const LEVEL_COLOR = { debug: "text.disabled", info: "text.secondary", warn: "warning.main", error: "error.main" };

export default function Logs({ log }) {
  const [level, setLevel] = useState("all");
  const [query, setQuery] = useState("");
  const [paused, setPaused] = useState(false);
  const [frozen, setFrozen] = useState([]);

  // When paused, show a snapshot taken at pause time so the view stops moving.
  const source = paused ? frozen : log;

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...source]
      .reverse()
      .filter((e) => level === "all" || (e.level || "info") === level)
      .filter(
        (e) =>
          !q ||
          e.type.toLowerCase().includes(q) ||
          JSON.stringify(e.data).toLowerCase().includes(q)
      );
  }, [source, level, query]);

  function togglePause() {
    if (!paused) setFrozen(log);
    setPaused(!paused);
  }

  function download() {
    const blob = new Blob([JSON.stringify(log, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "bluetooth-manager-events.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Box>
      {/* Two fixed rows instead of one 5-item flex-wrap row — predictable on
          a narrow phone instead of relying on exactly where wrap kicks in. */}
      <Stack spacing={1} sx={{ mb: 1.5 }}>
        <Stack direction="row" spacing={1}>
          <Select size="small" value={level} onChange={(e) => setLevel(e.target.value)}>
            {LEVELS.map((l) => <MenuItem key={l} value={l}>{l}</MenuItem>)}
          </Select>
          <TextField size="small" placeholder="buscar tipo ou payload…" value={query}
            onChange={(e) => setQuery(e.target.value)} sx={{ flex: 1, minWidth: 0 }} />
        </Stack>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Tooltip title={paused ? "Retomar" : "Pausar"}>
            <IconButton size="small" color={paused ? "success" : "default"} onClick={togglePause}>
              {paused ? <PlayArrowIcon /> : <PauseIcon />}
            </IconButton>
          </Tooltip>
          <Button size="small" startIcon={<DownloadIcon />} onClick={download}>Baixar</Button>
          <Box sx={{ flex: 1 }} />
          <Chip size="small" label={`${rows.length} exibidos`} />
        </Stack>
      </Stack>

      <Box sx={{ bgcolor: "background.default", border: 1, borderColor: "divider", borderRadius: 1.5, p: 1, maxHeight: "65vh", overflow: "auto" }}>
        {rows.length === 0 && (
          <Typography variant="body2" color="text.secondary" fontStyle="italic">Nenhum evento correspondente.</Typography>
        )}
        {rows.map((e) => {
          const lvl = e.level || "info";
          return (
            <Box key={e.seq}
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "1fr auto", sm: "5.5rem 1.5rem 9rem 1fr" },
                gridTemplateAreas: { xs: '"type time" "payload payload"', sm: '"time lvl type payload"' },
                columnGap: 1, rowGap: 0.15,
                py: 0.4,
                borderBottom: 1, borderColor: "divider",
                fontSize: "0.78rem",
              }}
            >
              <Box className="mono" sx={{ gridArea: "time", color: "text.secondary", textAlign: { xs: "right", sm: "left" } }}>
                {fmtTime(e.ts)}
              </Box>
              <Box className="mono" sx={{ gridArea: "lvl", display: { xs: "none", sm: "block" }, textAlign: "center", fontWeight: 700, color: LEVEL_COLOR[lvl] || "text.secondary" }}>
                {lvl[0].toUpperCase()}
              </Box>
              <Box className="mono" sx={{ gridArea: "type", color: lvl === "error" ? "error.main" : lvl === "warn" ? "warning.main" : "primary.main" }}>
                {e.type}
              </Box>
              <Box className="mono" sx={{ gridArea: "payload", color: "text.secondary", wordBreak: "break-all", whiteSpace: { xs: "normal", sm: "nowrap" }, overflow: { sm: "hidden" }, textOverflow: { sm: "ellipsis" } }}>
                {JSON.stringify(e.data)}
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
