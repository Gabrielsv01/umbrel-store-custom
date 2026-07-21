import { useState } from "react";
import { api } from "../api.js";

function signalBars(rssi) {
  if (rssi == null) return "○○○○";
  if (rssi >= -60) return "████";
  if (rssi >= -70) return "███░";
  if (rssi >= -80) return "██░░";
  if (rssi >= -90) return "█░░░";
  return "░░░░";
}

export default function Devices({ devices }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  async function toggle(d) {
    setBusy(d.address);
    setError(null);
    try {
      if (d.connected) await api.disconnect(d.address);
      else await api.connect(d.address);
    } catch (e) {
      setError(`${d.address}: ${e.message}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section>
      <p className="hint">
        Nearby devices update live as the adapter scans. Connect to inspect a
        device's data in the <strong>Live Data</strong> tab.
      </p>
      {error && <div className="error">{error}</div>}
      {devices.length === 0 && <p className="empty">No devices seen yet — scanning…</p>}
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Address</th>
            <th>Signal</th>
            <th>RSSI</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {devices.map((d) => (
            <tr key={d.address} className={d.connected ? "connected" : ""}>
              <td>{d.name}</td>
              <td className="mono">{d.address}</td>
              <td className="mono signal">{signalBars(d.rssi)}</td>
              <td className="mono">{d.rssi ?? "—"} dBm</td>
              <td>
                <button disabled={busy === d.address} onClick={() => toggle(d)}>
                  {busy === d.address
                    ? "…"
                    : d.connected
                    ? "Disconnect"
                    : "Connect"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
