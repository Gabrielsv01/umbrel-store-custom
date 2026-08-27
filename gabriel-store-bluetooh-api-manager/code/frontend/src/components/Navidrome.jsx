import { useEffect, useState } from "react";
import { api } from "../api.js";

function Track({ track, onAdd }) {
  return (
    <div className="reading">
      <span style={{ flex: 1 }}>
        <strong>{track.title}</strong>
        <span className="muted"> · {track.artist}{track.album ? ` · ${track.album}` : ""}</span>
      </span>
      <button onClick={() => onAdd(track)}>＋ fila</button>
    </div>
  );
}

export default function Navidrome({ classic }) {
  const [status, setStatus] = useState({ configured: false, url: "" });
  const [form, setForm] = useState({ url: "", username: "", password: "" });
  const [query, setQuery] = useState("");
  const [tracks, setTracks] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [openPlaylist, setOpenPlaylist] = useState(null);
  const [device, setDevice] = useState("");
  const [queue, setQueue] = useState({ playing: false, current: null, queue: [] });
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const speakers = classic.filter((item) => item.connected);

  useEffect(() => {
    api.navidromeStatus().then((value) => {
      setStatus(value);
      setForm((old) => ({ ...old, url: value.url || "" }));
      if (value.configured) api.navidromePlaylists().then(setPlaylists).catch((e) => setError(e.message));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!device && speakers.length) setDevice(speakers[0].address);
  }, [speakers, device]);

  useEffect(() => {
    const refresh = () => api.audioStatus().then(setQueue).catch(() => {});
    refresh();
    const timer = setInterval(refresh, 2000);
    return () => clearInterval(timer);
  }, []);

  async function connect(event) {
    event.preventDefault();
    setError(null); setMessage(null);
    try {
      const result = await api.navidromeConfigure(form);
      setStatus({ configured: true, url: form.url });
      setForm((old) => ({ ...old, password: "" }));
      setPlaylists(await api.navidromePlaylists());
      setMessage(`Conectado ao Navidrome ${result.server}`);
    } catch (e) { setError(e.message); }
  }

  async function search(event) {
    event.preventDefault();
    if (!query.trim()) return setTracks([]);
    setError(null);
    try { setTracks(await api.navidromeSearch(query)); } catch (e) { setError(e.message); }
  }

  async function addTracks(items) {
    if (!device) return setError("Conecte e selecione um alto-falante Bluetooth.");
    try {
      setQueue(await api.navidromeQueue(device, items));
      setMessage(`${items.length} música(s) adicionada(s) à fila.`);
    } catch (e) { setError(e.message); }
  }

  async function togglePlaylist(id) {
    if (openPlaylist?.id === id) return setOpenPlaylist(null);
    try { setOpenPlaylist(await api.navidromePlaylist(id)); } catch (e) { setError(e.message); }
  }

  async function queueAction(action) {
    try { setQueue(await action()); } catch (e) { setError(e.message); }
  }

  return (
    <section>
      <p className="hint">Pesquise sua biblioteca do Navidrome e envie músicas ou playlists para a fila Bluetooth.</p>
      {error && <div className="error">{error}</div>}
      {message && <div className="error ok-box">{message}</div>}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Conexão</h3>
        <form onSubmit={connect}>
          <div className="row"><label>URL:</label><input type="text" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} style={{ flex: 1 }} /></div>
          <div className="row"><label>Usuário:</label><input type="text" autoComplete="username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></div>
          <div className="row"><label>Senha:</label><input type="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
          <div className="row">
            <button type="submit">{status.configured ? "Atualizar conexão" : "Conectar"}</button>
            {status.configured && <button type="button" onClick={() => api.navidromeDisconnect().then(() => setStatus({ configured: false, url: form.url }))}>Desconectar</button>}
            <span className={status.configured ? "chip on" : "chip"}>{status.configured ? `conectado: ${status.url}` : "desconectado"}</span>
          </div>
        </form>
      </div>

      {status.configured && <>
        <div className="card">
          <div className="row"><label>Alto-falante:</label>
            <select value={device} onChange={(e) => setDevice(e.target.value)}>
              <option value="">Selecione...</option>
              {speakers.map((item) => <option key={item.address} value={item.address}>{item.name} ({item.address})</option>)}
            </select>
            <input type="text" placeholder="AA:BB:CC:DD:EE:FF" value={device} onChange={(e) => setDevice(e.target.value)} style={{ flex: 1 }} />
          </div>
          <form className="row" onSubmit={search}>
            <input type="search" placeholder="Buscar música, artista ou álbum" value={query} onChange={(e) => setQuery(e.target.value)} style={{ flex: 1 }} />
            <button type="submit">Buscar</button>
          </form>
          {tracks.length === 0 && query && <p className="empty">Nenhuma música encontrada.</p>}
          {tracks.map((track) => <Track key={track.id} track={track} onAdd={(item) => addTracks([item])} />)}
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>Playlists ({playlists.length})</h3>
          {playlists.length === 0 && <p className="empty">Nenhuma playlist encontrada.</p>}
          {playlists.map((playlist) => <div key={playlist.id}>
            <div className="reading"><button onClick={() => togglePlaylist(playlist.id)}>{openPlaylist?.id === playlist.id ? "▾" : "▸"}</button><strong style={{ flex: 1 }}>{playlist.name}</strong><span className="muted">{playlist.song_count} músicas</span>{openPlaylist?.id === playlist.id && <button onClick={() => addTracks(openPlaylist.tracks)}>＋ playlist</button>}</div>
            {openPlaylist?.id === playlist.id && openPlaylist.tracks.map((track) => <Track key={track.id} track={track} onAdd={(item) => addTracks([item])} />)}
          </div>)}
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>Fila ({queue.queue?.length || 0})</h3>
          {queue.current && <div className="reading"><strong>▶ {queue.current.label}</strong><button onClick={() => queueAction(api.audioSkip)}>Próxima</button></div>}
          {queue.queue?.map((item, index) => <div className="reading" key={item.id}><span className="len">{index + 1}.</span><span style={{ flex: 1 }}>{item.label}</span><button onClick={() => queueAction(() => api.audioMove(item.id, -1))} disabled={index === 0}>↑</button><button onClick={() => queueAction(() => api.audioMove(item.id, 1))} disabled={index === queue.queue.length - 1}>↓</button><button onClick={() => queueAction(() => api.audioRemove(item.id))}>Remover</button></div>)}
          {!queue.current && !queue.queue?.length && <p className="empty">A fila está vazia.</p>}
        </div>
      </>}
    </section>
  );
}
