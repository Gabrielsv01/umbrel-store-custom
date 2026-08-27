import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import SkipNextIcon from "@mui/icons-material/SkipNext";
import StopIcon from "@mui/icons-material/Stop";
import HourglassTopIcon from "@mui/icons-material/HourglassTop";
import {
  Paper, Stack, IconButton, Typography, Chip, CircularProgress, Tooltip,
} from "@mui/material";

// Mounted once in App.jsx, outside any section branch, so it survives
// switching sections/tabs — audio can keep playing while browsing elsewhere.
export default function NowPlayingBar({ status, onPause, onResume, onSkip, onStop }) {
  const hasContent = Boolean(status?.current) || Boolean(status?.queue?.length);
  if (!hasContent) return null;

  const { current, queue, paused, priming } = status;

  return (
    <Paper
      elevation={6}
      square
      sx={{
        px: 2,
        py: 1,
        borderBottom: 1,
        borderColor: "divider",
      }}
    >
      <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
        {priming ? (
          <Tooltip title="Conectando ao alto-falante…">
            <CircularProgress size={20} thickness={5} />
          </Tooltip>
        ) : (
          <Tooltip title={paused ? "Retomar" : "Pausar"}>
            <span>
              <IconButton
                size="small"
                color="primary"
                disabled={!current}
                onClick={() => (paused ? onResume() : onPause())}
              >
                {paused ? <PlayArrowIcon /> : <PauseIcon />}
              </IconButton>
            </span>
          </Tooltip>
        )}

        <Stack sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" noWrap fontWeight={600}>
            {current ? current.label : "Fila parada"}
          </Typography>
          {current?.device && (
            <Typography variant="caption" color="text.secondary" noWrap>
              {current.device}
            </Typography>
          )}
        </Stack>

        {queue?.length > 0 && (
          <Chip size="small" label={`+${queue.length} na fila`} />
        )}
        {priming && <Chip size="small" icon={<HourglassTopIcon />} label="conectando" />}

        <Tooltip title="Próxima">
          <span>
            <IconButton size="small" onClick={onSkip} disabled={!current}>
              <SkipNextIcon />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Parar e limpar fila">
          <IconButton size="small" color="error" onClick={onStop}>
            <StopIcon />
          </IconButton>
        </Tooltip>
      </Stack>
    </Paper>
  );
}
