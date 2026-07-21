import { useEffect, useState } from "react";
import { useEventStream } from "./useEventStream.js";
import { api } from "./api.js";
import Devices from "./components/Devices.jsx";
import LiveData from "./components/LiveData.jsx";
import Audio from "./components/Audio.jsx";
import Schedule from "./components/Schedule.jsx";
import Files from "./components/Files.jsx";
import Logs from "./components/Logs.jsx";

const TABS = [
  { id: "devices", label: "Devices" },
  { id: "live", label: "Live Data" },
  { id: "audio", label: "Audio" },
  { id: "schedule", label: "Schedule" },
  { id: "files", label: "Files" },
  { id: "logs", label: "Logs" },
];

export default function App() {
  const [tab, setTab] = useState("devices");
  const { connected, devices, log, gattData } = useEventStream();
  const [stats, setStats] = useState(null);
  const [classic, setClassic] = useState([]);

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
      ? { cls: "off", text: "no adapter" }
      : adapter.powered
      ? { cls: "on", text: `adapter on · ${adapter.address || adapter.name || "hci"}` }
      : { cls: "off", text: "adapter powered off" };

  const connectedCount =
    bleList.filter((d) => d.connected).length +
    classic.filter((d) => d.connected).length;

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
        <span className={`chip ${connectedCount ? "on" : ""}`}>{connectedCount} connected</span>
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
        {tab === "devices" && (
          <Devices ble={bleList} classic={classic} onChange={() => api.classicDevices().then(setClassic).catch(() => {})} />
        )}
        {tab === "live" && <LiveData devices={bleList} gattData={gattData} />}
        {tab === "audio" && <Audio classic={classic} />}
        {tab === "schedule" && <Schedule classic={classic} />}
        {tab === "files" && <Files devices={bleList} />}
        {tab === "logs" && <Logs log={log} />}
      </main>
    </div>
  );
}
