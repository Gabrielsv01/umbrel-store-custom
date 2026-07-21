import { useEffect, useState } from "react";
import { api } from "../api.js";

export default function Audio({ devices }) {
  const [device, setDevice] = useState("");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState({ playing: false });
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!device && devices.length) setDevice(devices[0].address);
  }, [devices, device]);

  useEffect(() => {
    const t = setInterval(
      () => api.audioStatus().then(setStatus).catch(() => {}),
      3000
    );
    api.audioStatus().then(setStatus).catch(() => {});
    return () => clearInterval(t);
  }, []);

  async function play() {
    setError(null);
    if (!device) return setError("Enter the speaker's Bluetooth address.");
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
        Stream an audio file or a URL to a Bluetooth speaker (A2DP). The speaker
        must be <strong>paired</strong> first. Audio is handled inside the app
        (bluez-alsa) — no host audio server needed.
      </p>
      {error && <div className="error">{error}</div>}

      <div className="card">
        <div className="row">
          <label>Speaker:&nbsp;</label>
          {devices.length > 0 ? (
            <select value={device} onChange={(e) => setDevice(e.target.value)}>
              {devices.map((d) => (
                <option key={d.address} value={d.address}>
                  {d.name} ({d.address})
                </option>
              ))}
              <option value="">— type an address —</option>
            </select>
          ) : null}
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
