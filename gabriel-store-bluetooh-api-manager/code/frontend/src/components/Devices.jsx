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

function octetDiff(a, b) {
  const x = a.split(":");
  const y = b.split(":");
  if (x.length !== 6 || y.length !== 6) return 6;
  let d = 0;
  for (let i = 0; i < 6; i++) if (x[i].toLowerCase() !== y[i].toLowerCase()) d++;
  return d;
}

function isGeneric(name, address) {
  if (!name) return true;
  const dashed = address.replace(/:/g, "-").toLowerCase();
  return name.toLowerCase() === dashed || name === "(unknown)";
}

// Merge BLE + Classic entries that belong to the same physical device
// (their MAC addresses differ in at most one octet).
function unify(ble, classic) {
  const groups = [];
  const find = (addr) =>
    groups.find((g) => g.addresses.some((a) => octetDiff(a, addr) <= 1));

  for (const c of classic) {
    let g = find(c.address);
    if (!g) {
      g = { addresses: [], name: "", le: null, classic: null };
      groups.push(g);
    }
    g.addresses.push(c.address);
    g.classic = c;
    if (!isGeneric(c.name, c.address)) g.name = c.name;
  }
  for (const b of ble) {
    let g = find(b.address);
    if (!g) {
      g = { addresses: [], name: "", le: null, classic: null };
      groups.push(g);
    }
    g.addresses.push(b.address);
    g.le = b;
    if (!g.name && !isGeneric(b.name, b.address)) g.name = b.name;
  }
  for (const g of groups) {
    g.connected = Boolean(g.le?.connected || g.classic?.connected);
    g.rssi = g.le?.rssi ?? null;
    if (!g.name) g.name = (g.classic || g.le)?.name || g.addresses[0];
  }
  return groups.sort(
    (a, b) => Number(b.connected) - Number(a.connected) || (b.rssi ?? -999) - (a.rssi ?? -999)
  );
}

export default function Devices({ ble, classic, onChange }) {
  const [busy, setBusy] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState(null);
  const groups = unify(ble, classic);

  async function run(key, fn) {
    setBusy(key);
    setError(null);
    try {
      const r = await fn();
      if (r && r.ok === false) setError(r.detail || "action failed");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(null);
      onChange?.();
    }
  }

  async function scan() {
    setScanning(true);
    setError(null);
    try {
      await api.classicScan(15);
    } catch (e) {
      setError(e.message);
    } finally {
      setScanning(false);
      onChange?.();
    }
  }

  return (
    <section>
      <div className="row">
        <p className="hint" style={{ margin: 0, flex: 1 }}>
          Each card is one physical device. <strong>LE</strong> = Low Energy
          (data/GATT), <strong>Classic</strong> = BR/EDR (audio/files). Put a
          speaker in pairing mode and Scan to find it.
        </p>
        <button onClick={scan} disabled={scanning}>
          {scanning ? "Scanning…" : "Scan"}
        </button>
      </div>
      {error && <div className="error">{error}</div>}
      {groups.length === 0 && <p className="empty">No devices yet — scanning…</p>}

      {groups.map((g) => {
        const cAddr = g.classic?.address;
        const leAddr = g.le?.address;
        return (
          <div key={g.addresses.join()} className={`card device ${g.connected ? "connected" : ""}`}>
            <div className="row">
              <strong>{g.name}</strong>
              {g.le && <span className="badge le">LE</span>}
              {g.classic && <span className="badge classic">Classic</span>}
              {g.connected && <span className="badge on">connected</span>}
              <span className="mono signal" style={{ marginLeft: "auto" }}>
                {signalBars(g.rssi)} {g.rssi != null ? `${g.rssi}dBm` : ""}
              </span>
            </div>

            {g.classic && (
              <div className="row sub">
                <span className="mono">{cAddr}</span>
                <span className="props">
                  Classic · {g.classic.paired ? "paired" : "not paired"}
                  {g.classic.connected ? " · connected" : ""}
                </span>
                <span style={{ marginLeft: "auto" }} className="char-actions">
                  {!g.classic.connected ? (
                    <button
                      disabled={busy === cAddr}
                      onClick={() => run(cAddr, () => api.classicPairConnect(cAddr))}
                    >
                      {busy === cAddr ? "…" : g.classic.paired ? "Connect" : "Pair + Connect"}
                    </button>
                  ) : (
                    <button disabled={busy === cAddr} onClick={() => run(cAddr, () => api.classicDisconnect(cAddr))}>
                      Disconnect
                    </button>
                  )}
                </span>
              </div>
            )}

            {g.le && (
              <div className="row sub">
                <span className="mono">{leAddr}</span>
                <span className="props">LE · {g.le.connected ? "connected (GATT)" : "not connected"}</span>
                <span style={{ marginLeft: "auto" }} className="char-actions">
                  <button
                    disabled={busy === leAddr}
                    onClick={() =>
                      run(leAddr, () =>
                        g.le.connected ? api.disconnect(leAddr) : api.connect(leAddr)
                      )
                    }
                  >
                    {busy === leAddr ? "…" : g.le.connected ? "Disconnect" : "Connect (BLE data)"}
                  </button>
                </span>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
