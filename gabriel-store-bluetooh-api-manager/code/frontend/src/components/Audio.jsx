import { useEffect, useState } from "react";
import { api } from "../api.js";

export default function Audio({ classic }) {
  const [device, setDevice] = useState("");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState(null);
  const [state, setState] = useState({ playing: false, current: null, queue: [] });
  const [error, setError] = useState(null);

  const connectedSpeakers = classic.filter((c) => c.connected);

  useEffect(() => {
    if (!device && connectedSpeakers.length) setDevice(connectedSpeakers[0].address);
  }, [connectedSpeakers, device]);

  useEffect(() => {
    const tick = () => api.audioStatus().then(setState).catch(() => {});
    tick();
    const t = setInterval(tick, 2000);
    return () => clearInterval(t);
  }, []);

  async function add() {
    setError(null);
    if (!device) return setError("Choose a connected speaker (or type its address).");
    if (!file && !url) return setError("Choose a file or paste a URL.");
    try {
      setState(await api.audioPlay({ device, file, url: url || undefined }));
      setUrl("");
      setFile(null);
      const el = document.getElementById("audio-file");
      if (el) el.value = "";
    } catch (e) {
      setError(e.message);
    }
  }

  async function ctl(fn) {
    setError(null);
    try {
      setState(await fn());
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <section>
      <p className="hint">
        Queue audio files or URLs to a connected Bluetooth speaker (A2DP) — they
        play in order. Connect a speaker in the <strong>Devices</strong> tab first.
      </p>
      {error && <div className="error">{error}</div>}

      <div className="card">
        <div className="row">
          <label>Speaker:&nbsp;</label>
          {connectedSpeakers.length > 0 && (
            <select value={device} onChange={(e) => setDevice(e.target.value)}>
              {connectedSpeakers.map((c) => (
                <option key={c.address} value={c.address}>
                  {c.name} ({c.address})
                </option>
              ))}
            </select>
          )}
          <input
            type="text"
            placeholder="AA:BB:CC:DD:EE:FF"
            value={device}
            onChange={(e) => setDevice(e.target.value)}
            style={{ flex: 1 }}
          />
        </div>
        <div className="row">
          <label>File:&nbsp;</label>
          <input id="audio-file" type="file" accept="audio/*" onChange={(e) => setFile(e.target.files[0])} />
        </div>
        <div className="row">
          <label>or URL:&nbsp;</label>
          <input
            type="text"
            placeholder="https://example.com/song.mp3"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            style={{ flex: 1 }}
          />
        </div>
        <div className="row">
          <button onClick={add}>➕ Add to queue</button>
          <button onClick={() => ctl(api.audioSkip)} disabled={!state.playing}>⏭ Skip</button>
          <button onClick={() => ctl(api.audioStop)} disabled={!state.playing && !state.queue?.length}>
            ■ Stop &amp; clear
          </button>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Now playing</h3>
        {state.current ? (
          <div className="reading">
            <span>▶ {state.current.label}</span>
            <span className="mono" style={{ marginLeft: "auto" }}>{state.current.device}</span>
          </div>
        ) : (
          <p className="empty">Nothing playing.</p>
        )}

        <h3>Up next ({state.queue?.length || 0})</h3>
        {(!state.queue || state.queue.length === 0) && <p className="empty">Queue is empty.</p>}
        {state.queue?.map((q, i) => (
          <div key={q.id} className="reading">
            <span className="len">{i + 1}.</span>
            <span>{q.label}</span>
            <span className="mono" style={{ marginLeft: "auto" }}>{q.device}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
