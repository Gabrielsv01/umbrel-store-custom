import { useEffect, useState } from "react";
import { api } from "../api.js";

export default function Files({ devices }) {
  const [address, setAddress] = useState("");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!address && devices.length) setAddress(devices[0].address);
  }, [devices, address]);

  async function send() {
    setError(null);
    setResult(null);
    if (!address) return setError("Enter a device address.");
    if (!file) return setError("Choose a file to send.");
    setBusy(true);
    try {
      setResult(await api.sendFile(address, file));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <p className="hint">
        Send a file to a paired device over Bluetooth (OBEX Object Push). The
        device must be paired and accept incoming files.
      </p>
      {error && <div className="error">{error}</div>}
      {result && (
        <div className={`error ${result.status === "complete" ? "ok-box" : ""}`}>
          {result.file} → {result.address}: <strong>{result.status}</strong>
        </div>
      )}

      <div className="card">
        <div className="row">
          <label>Device:&nbsp;</label>
          {devices.length > 0 ? (
            <select value={address} onChange={(e) => setAddress(e.target.value)}>
              {devices.map((d) => (
                <option key={d.address} value={d.address}>
                  {d.name} ({d.address})
                </option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              placeholder="AA:BB:CC:DD:EE:FF"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          )}
        </div>
        <div className="row">
          <label>File:&nbsp;</label>
          <input type="file" onChange={(e) => setFile(e.target.files[0])} />
        </div>
        <div className="row">
          <button onClick={send} disabled={busy}>
            {busy ? "Sending…" : "Send file"}
          </button>
        </div>
      </div>
    </section>
  );
}
