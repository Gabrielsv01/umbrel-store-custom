import { useEffect, useState } from "react";
import { api } from "../api.js";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function Voice({ classic }) {
  const [voices, setVoices] = useState([]);
  const [voice, setVoice] = useState("");
  const [text, setText] = useState("");
  const [device, setDevice] = useState("");
  const [mode, setMode] = useState("play");
  const [time, setTime] = useState("08:00");
  const [repeat, setRepeat] = useState("once");
  const [date, setDate] = useState("");
  const [days, setDays] = useState([]);
  const [title, setTitle] = useState("");
  const [lengthScale, setLengthScale] = useState("1.0");
  const [advanced, setAdvanced] = useState(false);
  const [noiseScale, setNoiseScale] = useState("");
  const [noiseW, setNoiseW] = useState("");
  const [sentenceSilence, setSentenceSilence] = useState("");
  const [status, setStatus] = useState({ jobs: [], queued: 0 });
  const [storage, setStorage] = useState(null);
  const [error, setError] = useState(null);

  const connectedSpeakers = classic.filter((c) => c.connected);

  useEffect(() => {
    api.ttsVoices().then((v) => { setVoices(v); if (v[0]) setVoice((cur) => cur || v[0]); })
      .catch((e) => setError(`Piper: ${e.message}`));
  }, []);

  useEffect(() => {
    if (!device && connectedSpeakers.length) setDevice(connectedSpeakers[0].address);
  }, [connectedSpeakers, device]);

  useEffect(() => {
    const tick = () => api.ttsStatus().then(setStatus).catch(() => {});
    const stick = () => api.storage().then(setStorage).catch(() => {});
    tick();
    stick();
    const t = setInterval(tick, 2000);
    const t2 = setInterval(stick, 10000);
    return () => { clearInterval(t); clearInterval(t2); };
  }, []);

  async function cleanNow() {
    try {
      await api.cleanup();
      setStorage(await api.storage());
    } catch (e) {
      setError(e.message);
    }
  }

  function fmtBytes(b) {
    if (b == null) return "—";
    if (b < 1024) return `${b} B`;
    if (b < 1048576) return `${(b / 1024).toFixed(0)} KB`;
    return `${(b / 1048576).toFixed(1)} MB`;
  }

  function toggleDay(i) {
    setDays((d) => (d.includes(i) ? d.filter((x) => x !== i) : [...d, i]));
  }

  async function generate() {
    setError(null);
    if (!text.trim()) return setError("Type some text.");
    if (!voice) return setError("No voice available.");
    if (!device) return setError("Choose a connected speaker.");
    if (mode === "schedule" && repeat === "once" && !date) return setError("Pick a date.");
    if (mode === "schedule" && repeat === "weekly" && days.length === 0) return setError("Pick weekdays.");
    try {
      await api.ttsSubmit({
        text, voice, device, mode,
        length_scale: lengthScale,
        noise_scale: advanced && noiseScale ? noiseScale : undefined,
        noise_w: advanced && noiseW ? noiseW : undefined,
        sentence_silence: advanced && sentenceSilence ? sentenceSilence : undefined,
        time: mode === "schedule" ? time : undefined,
        repeat: mode === "schedule" ? repeat : undefined,
        days: mode === "schedule" ? days.join(",") : undefined,
        date: mode === "schedule" && repeat === "once" ? date : undefined,
        title: title || undefined,
      });
      setText(""); setTitle("");
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <section>
      <p className="hint">
        Type text, Piper turns it into speech, and it plays on a Bluetooth
        speaker — now or on a schedule. Connect a speaker in the Devices tab.
      </p>
      {error && <div className="error">{error}</div>}

      <div className="card">
        <textarea
          rows={3}
          placeholder="Text to speak…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          style={{ width: "100%", background: "var(--panel2)", color: "var(--text)",
                   border: "1px solid var(--border)", borderRadius: 6, padding: "0.5rem" }}
        />
        <div className="row">
          <label>Voice:&nbsp;</label>
          <select value={voice} onChange={(e) => setVoice(e.target.value)}>
            {voices.length === 0 && <option value="">(none)</option>}
            {voices.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <label>&nbsp;Speaker:&nbsp;</label>
          {connectedSpeakers.length > 0 && (
            <select value={device} onChange={(e) => setDevice(e.target.value)}>
              {connectedSpeakers.map((c) => (
                <option key={c.address} value={c.address}>{c.name}</option>
              ))}
            </select>
          )}
          <input type="text" placeholder="AA:BB:CC:DD:EE:FF" value={device}
                 onChange={(e) => setDevice(e.target.value)} style={{ flex: 1 }} />
        </div>

        <div className="row">
          <label>Speed:&nbsp;</label>
          <select value={lengthScale} onChange={(e) => setLengthScale(e.target.value)}>
            <option value="0.85">Fast</option>
            <option value="1.0">Normal</option>
            <option value="1.25">Slower</option>
            <option value="1.5">Slowest</option>
          </select>
          <label style={{ marginLeft: "auto" }}>
            <input type="checkbox" checked={advanced} onChange={(e) => setAdvanced(e.target.checked)} /> Advanced voice
          </label>
        </div>

        {advanced && (
          <div className="row" style={{ flexWrap: "wrap", gap: "0.75rem" }}>
            <label>Expressiveness&nbsp;
              <input type="number" step="0.05" min="0" max="1.5" placeholder="0.667" value={noiseScale}
                     onChange={(e) => setNoiseScale(e.target.value)} style={{ width: 70 }} />
            </label>
            <label>Cadence&nbsp;
              <input type="number" step="0.05" min="0" max="1.5" placeholder="0.8" value={noiseW}
                     onChange={(e) => setNoiseW(e.target.value)} style={{ width: 70 }} />
            </label>
            <label>Sentence pause (s)&nbsp;
              <input type="number" step="0.1" min="0" max="5" placeholder="0.2" value={sentenceSilence}
                     onChange={(e) => setSentenceSilence(e.target.value)} style={{ width: 70 }} />
            </label>
          </div>
        )}

        <div className="row">
          <label>
            <input type="radio" checked={mode === "play"} onChange={() => setMode("play")} /> Play now
          </label>
          <label>
            <input type="radio" checked={mode === "schedule"} onChange={() => setMode("schedule")} /> Schedule
          </label>
        </div>

        {mode === "schedule" && (
          <>
            <div className="row">
              <label>Title:&nbsp;</label>
              <input type="text" placeholder="(optional)" value={title}
                     onChange={(e) => setTitle(e.target.value)} style={{ flex: 1 }} />
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
                  <button key={w} className={days.includes(i) ? "on" : ""} onClick={() => toggleDay(i)}>{w}</button>
                ))}
              </div>
            )}
          </>
        )}

        <div className="row">
          <button onClick={generate}>🔊 {mode === "schedule" ? "Generate & schedule" : "Generate & play"}</button>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Generation queue ({status.queued} waiting)</h3>
        {status.jobs.length === 0 && <p className="empty">No jobs yet.</p>}
        {status.jobs.map((j) => (
          <div key={j.id} className="reading">
            <span>{j.preview}</span>
            <span className="len" style={{ marginLeft: "auto" }}>{j.status}{j.error ? `: ${j.error}` : ""}</span>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="row" style={{ margin: 0 }}>
          <strong>Storage</strong>
          <span className="props" style={{ marginLeft: "0.5rem" }}>
            {storage ? `${storage.files} audio files · ${fmtBytes(storage.bytes)}` : "…"}
          </span>
          <button style={{ marginLeft: "auto" }} onClick={cleanNow}>Clean now</button>
        </div>
        <p className="hint" style={{ marginBottom: 0 }}>
          Auto-cleanup removes audio older than {storage?.retention_days ?? 7} days.
          <strong> Clean now</strong> deletes all cached audio immediately. Files
          tied to a schedule are always kept.
        </p>
      </div>
    </section>
  );
}
