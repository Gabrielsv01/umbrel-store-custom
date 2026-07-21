import { useEffect, useState } from "react";
import { api } from "../api.js";

export default function Audio() {
  const [device, setDevice] = useState("");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState({ playing: false });
  const [error, setError] = useState(null);

  // Classic speakers (pairing)
  const [speakers, setSpeakers] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(null);
  const [note, setNote] = useState(null);

  async function refreshSpeakers() {
    try {
      setSpeakers(await api.classicDevices());
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    refreshSpeakers();
    const t = setInterval(
      () => api.audioStatus().then(setStatus).catch(() => {}),
      3000
    );
    api.audioStatus().then(setStatus).catch(() => {});
    return () => clearInterval(t);
  }, []);

  async function scan() {
    setScanning(true);
    setError(null);
    setNote("Scanning for ~15s — put the speaker in pairing mode…");
    try {
      setSpeakers(await api.classicScan(15));
    } catch (e) {
      setError(e.message);
    } finally {
      setScanning(false);
      setNote(null);
    }
  }

  async function act(fn, addr) {
    setBusy(addr);
    setError(null);
    try {
      const r = await fn(addr);
      if (r && r.ok === false) setError(`${r.verb}: ${r.detail}`);
      await refreshSpeakers();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function pairAndConnect(addr) {
    setBusy(addr);
    setError(null);
    try {
      await api.classicPair(addr);
      await api.classicTrust(addr);
      const r = await api.classicConnect(addr);
      if (r && r.ok === false) setError(`connect: ${r.detail}`);
      setDevice(addr);
      await refreshSpeakers();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function play() {
    setError(null);
    if (!device) return setError("Choose or connect a speaker first.");
    if (!file && !url) return setError("Choose a file or paste a URL.");
    try {
      setStatus(await api.audioPlay({ device, file, url: url || undefined }));
    } catch (e) {
      setError(e.message);
    }
  }

  async function stop() {
    try {
      setStatus(await api.audioStop());
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <section>
      <p className="hint">
        Stream an audio file or URL to a Bluetooth speaker (A2DP). Audio is
        handled inside the app (bluez-alsa) — no host audio server needed.
      </p>
      {error && <div className="error">{error}</div>}
      {note && <div className="hint">{note}</div>}

      {/* Pairing */}
      <div className="card">
        <div className="row">
          <strong>Speakers (Bluetooth Classic)</strong>
          <button onClick={scan} disabled={scanning} style={{ marginLeft: "auto" }}>
            {scanning ? "Scanning…" : "Scan"}
          </button>
          <button onClick={refreshSpeakers} disabled={scanning}>Refresh</button>
        </div>
        {speakers.length === 0 && (
          <p className="empty">No devices yet — put the speaker in pairing mode and Scan.</p>
        )}
        {speakers.map((s) => (
          <div key={s.address} className="char">
            <div className="mono char-uuid">
              {s.name} <span className="props">{s.address}</span>
            </div>
            <div className="props">
              {s.paired ? "paired" : "not paired"}
              {s.connected ? " · connected" : ""}
            </div>
            <div className="char-actions">
              {!s.connected ? (
                <>
                  <button disabled={busy === s.address} onClick={() => pairAndConnect(s.address)}>
                    {busy === s.address ? "…" : s.paired ? "Connect" : "Pair + Connect"}
                  </button>
                </>
              ) : (
                <button disabled={busy === s.address} onClick={() => act(api.classicDisconnect, s.address)}>
                  Disconnect
                </button>
              )}
              <button
                className={device === s.address ? "on" : ""}
                onClick={() => setDevice(s.address)}
              >
                {device === s.address ? "✓ target" : "Use for audio"}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Playback */}
      <div className="card">
        <div className="row">
          <label>Play to:&nbsp;</label>
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
          <input type="file" accept="audio/*" onChange={(e) => setFile(e.target.files[0])} />
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
          <button onClick={play} disabled={status.playing}>▶ Play</button>
          <button onClick={stop} disabled={!status.playing}>■ Stop</button>
          <span className={`status ${status.playing ? "on" : "off"}`}>
            {status.playing ? `playing → ${status.device}` : "idle"}
          </span>
        </div>
      </div>
    </section>
  );
}
