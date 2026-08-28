import { useEffect, useState } from "react";
import {
  AppBar, Toolbar, Typography, Box, Drawer, List, ListItemButton,
  ListItemIcon, ListItemText, BottomNavigation, BottomNavigationAction,
  Paper, Tabs, Tab, Chip, Badge, IconButton, Tooltip, useMediaQuery,
} from "@mui/material";
import BluetoothIcon from "@mui/icons-material/Bluetooth";
import MusicNoteIcon from "@mui/icons-material/MusicNote";
import RecordVoiceOverIcon from "@mui/icons-material/RecordVoiceOver";
import EventIcon from "@mui/icons-material/Event";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import TuneIcon from "@mui/icons-material/Tune";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import { theme } from "./theme.js";
import { useEventStream } from "./useEventStream.js";
import { api } from "./api.js";
import { useAudioStatus } from "./hooks/useAudioStatus.js";
import NowPlayingBar from "./components/NowPlayingBar.jsx";
import StatusDialog from "./components/StatusDialog.jsx";
import Devices from "./components/Devices.jsx";
import LiveData from "./components/LiveData.jsx";
import Musica from "./components/Musica.jsx";
import Voice from "./components/Voice.jsx";
import Agent from "./components/Agent.jsx";
import Schedule from "./components/Schedule.jsx";
import Files from "./components/Files.jsx";
import Logs from "./components/Logs.jsx";

const DRAWER_WIDTH = 224;

const SECTIONS = [
  { id: "devices", label: "Devices", icon: <BluetoothIcon /> },
  { id: "musica", label: "Música", icon: <MusicNoteIcon /> },
  { id: "voz", label: "Voz", icon: <RecordVoiceOverIcon /> },
  { id: "agente", label: "Agente", icon: <SmartToyIcon /> },
  { id: "agenda", label: "Agenda", icon: <EventIcon /> },
  { id: "avancado", label: "Avançado", icon: <TuneIcon /> },
];

const ADVANCED_TABS = [
  { id: "live", label: "Live Data" },
  { id: "files", label: "Files" },
  { id: "logs", label: "Logs" },
];

export default function App() {
  const isDesktop = useMediaQuery(theme.breakpoints.up("md"));
  const [section, setSection] = useState("devices");
  const [statusOpen, setStatusOpen] = useState(false);
  const [advancedTab, setAdvancedTab] = useState("live");
  const { connected, devices, log, gattData } = useEventStream();
  const [stats, setStats] = useState(null);
  const [classic, setClassic] = useState([]);
  const { audioStatus, setAudioStatus, handlePause, handleResume, handleSkip, handleStop } = useAudioStatus();

  const bleList = Object.values(devices).sort(
    (a, b) => Number(b.connected) - Number(a.connected) || (b.rssi ?? -999) - (a.rssi ?? -999)
  );

  useEffect(() => {
    const tick = () => api.stats().then(setStats).catch(() => setStats(null));
    const tickC = () => api.classicDevices().then(setClassic).catch(() => {});
    tick();
    tickC();
    const t1 = setInterval(tick, 5000);
    const t2 = setInterval(tickC, 4000);
    return () => {
      clearInterval(t1);
      clearInterval(t2);
    };
  }, []);

  const adapter = stats?.adapter;
  const adapterState =
    adapter == null
      ? { color: "default", text: "no adapter" }
      : adapter.powered
      ? { color: "success", text: `adapter on · ${adapter.address || adapter.name || "hci"}` }
      : { color: "warning", text: "adapter powered off" };

  const connectedCount =
    bleList.filter((d) => d.connected).length +
    classic.filter((d) => d.connected).length;
  const hasErrors = Boolean(stats?.events?.events_by_level?.error);

  const content = (
    <>
      {section === "devices" && (
        <Devices ble={bleList} classic={classic} adapter={adapter} onChange={() => api.classicDevices().then(setClassic).catch(() => {})} />
      )}
      {section === "musica" && (
        <Musica classic={classic} audioStatus={audioStatus} onAudioStatus={setAudioStatus} />
      )}
      {section === "voz" && <Voice classic={classic} />}
      {section === "agente" && <Agent />}
      {section === "agenda" && <Schedule classic={classic} />}
      {section === "avancado" && (
        <Box>
          <Tabs value={advancedTab} onChange={(_, v) => setAdvancedTab(v)} sx={{ mb: 2 }}>
            {ADVANCED_TABS.map((t) => <Tab key={t.id} value={t.id} label={t.label} />)}
          </Tabs>
          {advancedTab === "live" && <LiveData devices={bleList} gattData={gattData} />}
          {advancedTab === "files" && <Files devices={bleList} />}
          {advancedTab === "logs" && <Logs log={log} />}
        </Box>
      )}
    </>
  );

  return (
    // height (not minHeight): 100dvh tracks the actual visible viewport, so
    // it shrinks when the on-screen keyboard opens instead of staying sized
    // to the pre-keyboard layout viewport — needed for the Agent chat's
    // flex:1 regions below to size correctly with the keyboard open. Tabs
    // whose content is taller than this still just overflow the page and
    // scroll normally, same as before.
    <Box sx={{ display: "flex", flexDirection: "column", height: "100dvh" }}>
      {/* AppBar + Now Playing sit outside the scrolling region below (main
          has overflowY:auto — see below), so they're simply always visible,
          never needing position:sticky/a spacer height: nothing in their own
          flex column ever scrolls past them. */}
      <Box sx={{ flexShrink: 0 }}>
        <AppBar position="static">
          <Toolbar variant="dense" sx={{ gap: 0.5 }}>
            <Typography variant="h6" noWrap sx={{ flex: 1, minWidth: 0 }}>
              🔵 Bluetooth API Manager
            </Typography>
            <Chip size="small" label={connected ? "live" : "reconnecting…"} color={connected ? "success" : "warning"} />
            <Tooltip title="Status do sistema">
              <IconButton color="inherit" size="small" onClick={() => setStatusOpen(true)}>
                <Badge color="error" variant="dot" invisible={!hasErrors}>
                  <InfoOutlinedIcon fontSize="small" />
                </Badge>
              </IconButton>
            </Tooltip>
            <Tooltip title="API docs">
              <IconButton color="inherit" size="small" component="a" href="/docs" target="_blank" rel="noreferrer">
                <OpenInNewIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Toolbar>
        </AppBar>
        <NowPlayingBar status={audioStatus} onPause={handlePause} onResume={handleResume} onSkip={handleSkip} onStop={handleStop} />
      </Box>

      <Box sx={{ display: "flex", flex: 1, minHeight: 0 }}>
        {isDesktop && (
          <Drawer
            variant="permanent"
            sx={{
              width: DRAWER_WIDTH,
              flexShrink: 0,
              [`& .MuiDrawer-paper`]: { width: DRAWER_WIDTH, boxSizing: "border-box", position: "relative" },
            }}
          >
            <List>
              {SECTIONS.map((s) => (
                <ListItemButton key={s.id} selected={section === s.id} onClick={() => setSection(s.id)}>
                  <ListItemIcon>{s.icon}</ListItemIcon>
                  <ListItemText primary={s.label} />
                </ListItemButton>
              ))}
            </List>
          </Drawer>
        )}

        {/* main is the ONLY scrolling region in the app: header/footer are
            fixed siblings outside it, so content never passes "under" them —
            it scrolls within its own bounded box instead. height:"100%" on
            the inner Box is ONLY for sections that manage their own internal
            scroll (currently just Agent) — forcing it on every section made
            content even slightly taller than the available height silently
            overflow into main's own bottom-nav clearance padding without
            triggering a scrollbar (main's scrollHeight stayed <= its own
            height, since the overflow was smaller than that padding), so it
            rendered hidden behind the fixed bottom nav on shorter screens.
            Other sections get an auto-height wrapper so main measures their
            true rendered height and scrolls correctly when needed. */}
        <Box component="main" sx={{ flexGrow: 1, minWidth: 0, minHeight: 0, overflowY: "auto", pb: isDesktop ? 2 : 9 }}>
          <Box sx={{ p: 2, height: section === "agente" ? "100%" : "auto" }}>{content}</Box>
        </Box>
      </Box>

      {!isDesktop && (
        <Paper elevation={8} sx={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: (t) => t.zIndex.drawer + 1 }}>
          <BottomNavigation showLabels value={section} onChange={(_, v) => setSection(v)}>
            {SECTIONS.map((s) => (
              <BottomNavigationAction key={s.id} value={s.id} label={s.label} icon={s.icon} sx={{ minWidth: 0, px: 0.5 }} />
            ))}
          </BottomNavigation>
        </Paper>
      )}

      <StatusDialog
        open={statusOpen}
        onClose={() => setStatusOpen(false)}
        adapterState={adapterState}
        stats={stats}
        connectedCount={connectedCount}
        audioStatus={audioStatus}
      />
    </Box>
  );
}
