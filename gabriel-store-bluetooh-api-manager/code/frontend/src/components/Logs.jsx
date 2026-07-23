import { useMemo, useState } from "react";

function fmtTime(ts) {
  return new Date(ts * 1000).toLocaleTimeString();
}

const LEVELS = ["all", "debug", "info", "warn", "error"];

export default function Logs({ log }) {
  const [level, setLevel] = useState("all");
  const [query, setQuery] = useState("");
  const [paused, setPaused] = useState(false);
  const [frozen, setFrozen] = useState([]);

  // When paused, show a snapshot taken at pause time so the view stops moving.
  const source = paused ? frozen : log;

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...source]
      .reverse()
      .filter((e) => level === "all" || (e.level || "info") === level)
      .filter(
        (e) =>
          !q ||
          e.type.toLowerCase().includes(q) ||
          JSON.stringify(e.data).toLowerCase().includes(q)
      );
  }, [source, level, query]);

  function togglePause() {
    if (!paused) setFrozen(log);
    setPaused(!paused);
  }

  function download() {
    const blob = new Blob([JSON.stringify(log, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "bluetooth-manager-events.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="logs">
      <div className="logbar">
        <select value={level} onChange={(e) => setLevel(e.target.value)}>
          {LEVELS.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder="search type or payload…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ flex: 1 }}
        />
        <button className={paused ? "on" : ""} onClick={togglePause}>
          {paused ? "▶ Resume" : "⏸ Pause"}
        </button>
        <button onClick={download}>⭳ Download</button>
        <span className="count">{rows.length} shown</span>
      </div>

      <div className="logbox">
        {rows.length === 0 && <p className="empty">No matching events.</p>}
        {rows.map((e) => (
          <div key={e.seq} className={`logline ${e.level || "info"}`}>
            <span className="mono time">{fmtTime(e.ts)}</span>
            <span className={`mono lvl ${e.level || "info"}`}>{(e.level || "info")[0].toUpperCase()}</span>
            <span className="mono type">{e.type}</span>
            <span className="mono payload">{JSON.stringify(e.data)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
