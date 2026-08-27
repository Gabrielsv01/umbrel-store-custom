import {
  Dialog, DialogTitle, DialogContent, IconButton, List, ListItem,
  ListItemText, Chip,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";

export default function StatusDialog({ open, onClose, adapterState, stats, connectedCount, audioStatus }) {
  const rows = [
    { label: "Adaptador", chip: <Chip size="small" color={adapterState.color} label={adapterState.text} /> },
    { label: "Dispositivos vistos", chip: <Chip size="small" label={stats?.devices_seen ?? 0} /> },
    { label: "Conectados", chip: <Chip size="small" color={connectedCount ? "success" : "default"} label={connectedCount} /> },
    { label: "Áudio", chip: <Chip size="small" color={audioStatus.playing ? "success" : "default"} label={audioStatus.playing ? "tocando" : "parado"} /> },
    { label: "Eventos", chip: <Chip size="small" label={stats?.events?.total_events ?? 0} /> },
    ...(stats?.events?.events_by_level?.error
      ? [{ label: "Erros recentes", chip: <Chip size="small" color="error" label={stats.events.events_by_level.error} /> }]
      : []),
  ];

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        Status do sistema
        <IconButton size="small" onClick={onClose}><CloseIcon fontSize="small" /></IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <List dense disablePadding>
          {rows.map((r) => (
            <ListItem key={r.label} disableGutters
              secondaryAction={r.chip}>
              <ListItemText primary={r.label} />
            </ListItem>
          ))}
        </List>
      </DialogContent>
    </Dialog>
  );
}
