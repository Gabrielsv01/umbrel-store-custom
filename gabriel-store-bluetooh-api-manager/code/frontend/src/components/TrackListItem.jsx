import { IconButton, ListItem, ListItemText, Stack, Tooltip } from "@mui/material";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PlaylistAddIcon from "@mui/icons-material/PlaylistAdd";

// Shared by PlaylistsPanel and SearchSheet — one Navidrome track row with
// "play now" / "add to queue" actions.
export default function TrackListItem({ track, onAdd, onPlayNow }) {
  return (
    <ListItem
      divider
      secondaryAction={
        <Stack direction="row" spacing={0.5}>
          <Tooltip title="Tocar agora">
            <IconButton edge="end" size="small" onClick={() => onPlayNow(track)}>
              <PlayArrowIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Adicionar à fila">
            <IconButton edge="end" size="small" onClick={() => onAdd(track)}>
              <PlaylistAddIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      }
    >
      <ListItemText
        primary={track.title}
        secondary={`${track.artist}${track.album ? ` · ${track.album}` : ""}`}
      />
    </ListItem>
  );
}
