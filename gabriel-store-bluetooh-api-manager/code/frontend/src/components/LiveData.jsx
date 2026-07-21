import { useEffect, useState } from "react";
import { api } from "../api.js";

export default function LiveData({ devices, gattData }) {
  const connected = devices.filter((d) => d.connected);
  const [selected, setSelected] = useState("");
  const [services, setServices] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  // Default the selection to the first connected device.
  useEffect(() => {
    if (!selected && connected.length) setSelected(connected[0].address);
  }, [connected, selected]);

  async function loadServices(addr) {
    if (!addr) return;
    setLoading(true);
    setError(null);
    try {
      setServices(await api.services(addr));
    } catch (e) {
      setError(e.message);
      setServices([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadServices(selected);
  }, [selected]);

  async function act(fn) {
    setError(null);
    try {
      await fn();
      await loadServices(selected);
    } catch (e) {
      setError(e.message);
    }
  }

  const feed = gattData.filter((g) => !selected || g.address === selected);

  return (
    <section className="live">
      {connected.length === 0 ? (
        <p className="empty">
          No <strong>BLE data</strong> connection. Live Data shows GATT
          characteristics — connect a device with <strong>“Connect (BLE data)”</strong>
          in the Devices tab. Audio (Classic) connections, like speakers/headsets,
          don’t provide GATT data here.
        </p>
      ) : (
        <>
          <div className="row">
            <label>Device:&nbsp;</label>
            <select value={selected} onChange={(e) => setSelected(e.target.value)}>
              {connected.map((d) => (
                <option key={d.address} value={d.address}>
                  {d.name} ({d.address})
                </option>
              ))}
            </select>
            <button onClick={() => loadServices(selected)}>Refresh</button>
          </div>
          {error && <div className="error">{error}</div>}

          <div className="split">
            <div className="services">
              <h3>GATT services {loading && "…"}</h3>
              {services.map((s) => (
                <div key={s.uuid} className="service">
                  <div className="svc-title mono">{s.description || s.uuid}</div>
                  {s.characteristics.map((c) => (
                    <div key={c.uuid} className="char">
                      <div className="mono char-uuid">{c.description || c.uuid}</div>
                      <div className="props">{c.properties.join(", ")}</div>
                      <div className="char-actions">
                        {c.properties.includes("read") && (
                          <button onClick={() => act(() => api.read(selected, c.uuid))}>
                            Read
                          </button>
                        )}
                        {(c.properties.includes("notify") ||
                          c.properties.includes("indicate")) && (
                          <button
                            className={c.notifying ? "on" : ""}
                            onClick={() =>
                              act(() => api.notify(selected, c.uuid, !c.notifying))
                            }
                          >
                            {c.notifying ? "Stop notify" : "Notify"}
                          </button>
                        )}
                        {(c.properties.includes("write") ||
                          c.properties.includes("write-without-response")) && (
                          <WriteButton addr={selected} uuid={c.uuid} onError={setError} />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>

            <div className="feed">
              <h3>Incoming data</h3>
              {feed.length === 0 && <p className="empty">No data yet.</p>}
              {feed.map((g, i) => (
                <div key={i} className="reading">
                  <span className="mono char-uuid">{g.char.slice(0, 8)}…</span>
                  <span className="mono">{g.text ?? g.hex}</span>
                  <span className="len">{g.length}B</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function WriteButton({ addr, uuid, onError }) {
  async function write() {
    const text = window.prompt("Value to write (text):");
    if (text == null) return;
    try {
      await api.write(addr, uuid, { text });
    } catch (e) {
      onError(e.message);
    }
  }
  return <button onClick={write}>Write</button>;
}
