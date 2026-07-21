import { useEffect, useState } from "react";
import { useEventStream } from "./useEventStream.js";
import { api } from "./api.js";
import Devices from "./components/Devices.jsx";
import LiveData from "./components/LiveData.jsx";
import Audio from "./components/Audio.jsx";
import Files from "./components/Files.jsx";
import Logs from "./components/Logs.jsx";

const TABS = [
  { id: "devices", label: "Devices" },
  { id: "live", label: "Live Data" },
  { id: "audio", label: "Audio" },
  { id: "files", label: "Files" },
  { id: "logs", label: "Logs" },
];

export default function App() {
  const [tab, setTab] = useState("devices");
  const { connected, devices, log, gattData } = useEventStream();
  const [stats, setStats] = useState(null);
  const deviceList = Object.values(devices).sort(
    (a, b) => Number(b.connected) - Number(a.connected) || (b.rssi ?? -999) - (a.rssi ?? -999)
  );

  // Poll the observability snapshot for the status bar.
  useEffect(() => {
    const tick = () => api.stats().then(setStats).catch(() => setStats(null));
    tick();
    const t = setInterval(tick, 5000);
    return () => clearInterval(t);
  }, []);

  const adapter = stats?.adapter;
  const adapterState =
    adapter == null
      ? { cls: "off", text: "no adapter" }
      : adapter.powered
      ? { cls: "on", text: `adapter on · ${adapter.address || adapter.name || "hci"}` }
      : { cls: "off", text: "adapter powered off" };

  return (
    <div className="app">
      <header>
        <h1>🔵 Bluetooth API Manager</h1>
        <span className={`status ${connected ? "on" : "off"}`}>
          {connected ? "live" : "reconnecting…"}
        </span>
        <a className="apilink" href="/docs" target="_blank" rel="noreferrer">
          API docs ↗
        </a>
      </header>

      <div className="statusbar">
        <span className={`chip ${adapterState.cls}`}>{adapterState.text}</span>
        <span className="chip">{stats?.devices_seen ?? 0} seen</span>
        <span className="chip">{stats?.connected ?? 0} connected</span>
        <span className={`chip ${stats?.audio?.playing ? "on" : ""}`}>
          {stats?.audio?.playing ? "audio ▶" : "audio idle"}
        </span>
        <span className="chip">{stats?.events?.total_events ?? 0} events</span>
        {stats?.events?.events_by_level?.error ? (
          <span className="chip err">{stats.events.events_by_level.error} errors</span>
        ) : null}
      </div>

      <nav className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? "active" : ""}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main>
        {tab === "devices" && <Devices devices={deviceList} />}
        {tab === "live" && <LiveData devices={deviceList} gattData={gattData} />}
        {tab === "audio" && <Audio />}
        {tab === "files" && <Files devices={deviceList} />}
        {tab === "logs" && <Logs log={log} />}
      </main>
    </div>
  );
}
