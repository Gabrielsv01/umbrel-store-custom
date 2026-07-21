import { useEffect, useState } from "react";
import { api } from "../api.js";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function Schedule({ classic }) {
  const [data, setData] = useState({ now: "", tz: "", items: [] });
  const [error, setError] = useState(null);

  const connectedSpeakers = classic.filter((c) => c.connected);
  const [device, setDevice] = useState("");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState(null);
  const [time, setTime] = useState("08:00");
  const [repeat, setRepeat] = useState("once");
  const [date, setDate] = useState("");
  const [days, setDays] = useState([]);

  async function refresh() {
    try {
      setData(await api.schedules());
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!device && connectedSpeakers.length) setDevice(connectedSpeakers[0].address);
  }, [connectedSpeakers, device]);

  function toggleDay(i) {
    setDays((d) => (d.includes(i) ? d.filter((x) => x !== i) : [...d, i]));
  }

  async function create() {
    setError(null);
    if (!device) return setError("Choose a speaker.");
    if (!file && !url) return setError("Choose a file or paste a URL.");
    if (repeat === "once" && !date) return setError("Pick a date for a one-time schedule.");
    if (repeat === "weekly" && days.length === 0) return setError("Pick at least one weekday.");
    try {
      await api.scheduleCreate({
        device, time, repeat,
        days: days.join(","),
        date: repeat === "once" ? date : undefined,
        file, url: url || undefined,
      });
      setUrl(""); setFile(null);
      const el = document.getElementById("sched-file");
      if (el) el.value = "";
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  }

  function describe(s) {
    if (s.repeat === "once") return `once on ${s.date} at ${s.time}`;
    if (s.repeat === "daily") return `every day at ${s.time}`;
    return `${s.days.map((d) => WEEKDAYS[d]).join(", ")} at ${s.time}`;
  }

  return (
    <section>
      <p className="hint">
        Schedule a track to play on a speaker. Fires by the <strong>server clock</strong>:
        <strong> {data.now}</strong> ({data.tz}). Set TZ in the app config if this is wrong.
      </p>
      {error && <div className="error">{error}</div>}

      <div className="card">
        <div className="row">
          <label>Speaker:&nbsp;</label>
          {connectedSpeakers.length > 0 && (
            <select value={device} onChange={(e) => setDevice(e.target.value)}>
              {connectedSpeakers.map((c) => (
                <option key={c.address} value={c.address}>{c.name} ({c.address})</option>
              ))}
            </select>
          )}
          <input type="text" placeholder="AA:BB:CC:DD:EE:FF" value={device}
                 onChange={(e) => setDevice(e.target.value)} style={{ flex: 1 }} />
        </div>
        <div className="row">
          <label>File:&nbsp;</label>
          <input id="sched-file" type="file" accept="audio/*" onChange={(e) => setFile(e.target.files[0])} />
        </div>
        <div className="row">
          <label>or URL:&nbsp;</label>
          <input type="text" placeholder="https://example.com/song.mp3" value={url}
                 onChange={(e) => setUrl(e.target.value)} style={{ flex: 1 }} />
        </div>
        <div className="row">
          <label>Time:&nbsp;</label>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          <label>&nbsp;Repeat:&nbsp;</label>
          <select value={repeat} onChange={(e) => setRepeat(e.target.value)}>
            <option value="once">Once</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
          </select>
          {repeat === "once" && (
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          )}
        </div>
        {repeat === "weekly" && (
          <div className="row">
            {WEEKDAYS.map((w, i) => (
              <button key={w} className={days.includes(i) ? "on" : ""} onClick={() => toggleDay(i)}>
                {w}
              </button>
            ))}
          </div>
        )}
        <div className="row">
          <button onClick={create}>➕ Schedule</button>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Scheduled ({data.items.length})</h3>
        {data.items.length === 0 && <p className="empty">No schedules yet.</p>}
        {data.items.map((s) => (
          <div key={s.id} className="char">
            <div className="row" style={{ margin: 0 }}>
              <span>{s.enabled ? "🟢" : "⚪"} <strong>{describe(s)}</strong></span>
              <span className="mono props" style={{ marginLeft: "auto" }}>{s.device}</span>
            </div>
            <div className="props">{s.label}{s.last_fired ? ` · last fired ${s.last_fired}` : ""}</div>
            <div className="char-actions">
              <button onClick={() => api.scheduleToggle(s.id, !s.enabled).then(refresh)}>
                {s.enabled ? "Disable" : "Enable"}
              </button>
              <button onClick={() => api.scheduleDelete(s.id).then(refresh)}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
