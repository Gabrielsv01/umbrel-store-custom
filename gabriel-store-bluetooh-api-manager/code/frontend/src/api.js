// Thin client over the backend REST API. Relative URLs so it works wherever
// the app is hosted.

async function handle(res) {
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail || detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return res.status === 204 ? null : res.json();
}

async function request(path, options = {}) {
  return handle(
    await fetch(`/api${path}`, {
      headers: { "Content-Type": "application/json" },
      ...options,
    })
  );
}

// multipart/form-data: let the browser set the Content-Type + boundary.
async function upload(path, formData) {
  return handle(await fetch(`/api${path}`, { method: "POST", body: formData }));
}

export const api = {
  adapter: () => request("/adapter"),
  stats: () => request("/stats"),
  devices: () => request("/devices"),
  connect: (addr) => request(`/devices/${addr}/connect`, { method: "POST" }),
  disconnect: (addr) => request(`/devices/${addr}/disconnect`, { method: "POST" }),
  services: (addr) => request(`/devices/${addr}/services`),
  read: (addr, char_uuid) =>
    request(`/devices/${addr}/read`, {
      method: "POST",
      body: JSON.stringify({ char_uuid }),
    }),
  write: (addr, char_uuid, payload) =>
    request(`/devices/${addr}/write`, {
      method: "POST",
      body: JSON.stringify({ char_uuid, ...payload }),
    }),
  notify: (addr, char_uuid, enable) =>
    request(`/devices/${addr}/notify`, {
      method: "POST",
      body: JSON.stringify({ char_uuid, enable }),
    }),

  // Bluetooth Classic (speakers)
  classicDevices: () => request("/classic/devices"),
  classicScan: (seconds = 15) =>
    request(`/classic/scan?seconds=${seconds}`, { method: "POST" }),
  classicPair: (addr) => request(`/classic/${addr}/pair`, { method: "POST" }),
  classicTrust: (addr) => request(`/classic/${addr}/trust`, { method: "POST" }),
  classicConnect: (addr) => request(`/classic/${addr}/connect`, { method: "POST" }),
  classicDisconnect: (addr) =>
    request(`/classic/${addr}/disconnect`, { method: "POST" }),
  classicPairConnect: (addr) =>
    request(`/classic/${addr}/pair-connect`, { method: "POST" }),
  classicForget: (addr) =>
    request(`/classic/${addr}/forget`, { method: "POST" }),
  renameDevice: (addr, name) =>
    request(`/classic/${addr}/rename`, { method: "POST", body: JSON.stringify({ name }) }),
  setAdapterName: (name) =>
    request(`/adapter/name`, { method: "POST", body: JSON.stringify({ name }) }),

  // Text-to-speech (Piper / Kokoro)
  ttsEngines: () => request("/tts/engines"),
  ttsVoices: (engine = "piper") => request(`/tts/voices?engine=${engine}`),
  ttsStatus: () => request("/tts"),
  ttsSubmit: ({ text, voice, device, mode, engine, length_scale, noise_scale, noise_w,
                sentence_silence, speed, volume_multiplier, allow_voice_tags, ssml,
                normalization_options, time, repeat, days, date, title }) => {
    const fd = new FormData();
    fd.append("text", text);
    fd.append("voice", voice);
    if (device) fd.append("device", device);
    fd.append("mode", mode);
    if (engine) fd.append("engine", engine);
    if (length_scale) fd.append("length_scale", length_scale);
    if (noise_scale) fd.append("noise_scale", noise_scale);
    if (noise_w) fd.append("noise_w", noise_w);
    if (sentence_silence) fd.append("sentence_silence", sentence_silence);
    if (speed) fd.append("speed", speed);
    if (volume_multiplier) fd.append("volume_multiplier", volume_multiplier);
    if (allow_voice_tags) fd.append("allow_voice_tags", "true");
    if (ssml) fd.append("ssml", "true");
    if (normalization_options) fd.append("normalization_options", JSON.stringify(normalization_options));
    if (time) fd.append("time", time);
    if (repeat) fd.append("repeat", repeat);
    if (days) fd.append("days", days);
    if (date) fd.append("date", date);
    if (title) fd.append("title", title);
    return upload("/tts", fd);
  },
  ttsJobAudioUrl: (id) => `/api/tts/jobs/${id}/audio`,
  ttsPlayJob: (id, device) => {
    const fd = new FormData();
    fd.append("device", device);
    return upload(`/tts/jobs/${id}/play`, fd);
  },
  ttsDeleteJob: (id) => request(`/tts/jobs/${id}`, { method: "DELETE" }),

  // Storage / cleanup
  storage: () => request("/storage"),
  cleanup: () => request("/cleanup", { method: "POST" }),

  // Scheduler
  schedules: () => request("/schedules"),
  scheduleCreate: ({ device, time, repeat, days, date, title, file, url }) => {
    const fd = new FormData();
    fd.append("device", device);
    fd.append("time", time);
    fd.append("repeat", repeat);
    if (days) fd.append("days", days);
    if (date) fd.append("date", date);
    if (title) fd.append("title", title);
    if (file) fd.append("file", file);
    if (url) fd.append("url", url);
    return upload("/schedules", fd);
  },
  scheduleDelete: (id) => request(`/schedules/${id}`, { method: "DELETE" }),
  scheduleToggle: (id, enabled) =>
    request(`/schedules/${id}/toggle?enabled=${enabled}`, { method: "POST" }),

  // Audio (Phase 2) — queue based
  audioStatus: () => request("/audio/status"),
  audioQueue: () => request("/audio/queue"),
  audioSkip: () => request("/audio/skip", { method: "POST" }),
  audioStop: () => request("/audio/stop", { method: "POST" }),
  audioPause: () => request("/audio/pause", { method: "POST" }),
  audioResume: () => request("/audio/resume", { method: "POST" }),
  audioPrevious: () => request("/audio/previous", { method: "POST" }),
  audioSeek: (position) => {
    const fd = new FormData();
    fd.append("position", position);
    return upload("/audio/seek", fd);
  },
  audioRepeat: (mode) => {
    const fd = new FormData();
    fd.append("mode", mode);
    return upload("/audio/repeat", fd);
  },
  audioShuffle: (enabled) => {
    const fd = new FormData();
    fd.append("enabled", enabled);
    return upload("/audio/shuffle", fd);
  },
  audioRemove: (id) => request(`/audio/queue/${id}`, { method: "DELETE" }),
  audioMove: (id, direction) => request(`/audio/queue/${id}/move`, {
    method: "POST", body: JSON.stringify({ direction }),
  }),
  audioPlay: ({ device, file, url }) => {
    const fd = new FormData();
    fd.append("device", device);
    if (file) fd.append("file", file);
    if (url) fd.append("url", url);
    return upload("/audio/play", fd);
  },
  audioPlayNow: ({ device, file, url }) => {
    const fd = new FormData();
    fd.append("device", device);
    if (file) fd.append("file", file);
    if (url) fd.append("url", url);
    return upload("/audio/play-now", fd);
  },

  musicTagStatus: () => request("/music-tag/status"),
  musicTagSearch: (q) => request(`/music-tag/search?q=${encodeURIComponent(q)}`),
  musicTagGetTrack: (id) => request(`/music-tag/tracks/${id}`),
  musicTagUpdateTrack: (id, changes) => request(`/music-tag/tracks/${id}`, {
    method: "PATCH", body: JSON.stringify(changes),
  }),
  navidromeStatus: () => request("/navidrome/status"),
  navidromeConfigure: (body) => request("/navidrome/configure", {
    method: "POST", body: JSON.stringify(body),
  }),
  navidromeDisconnect: () => request("/navidrome/disconnect", { method: "POST" }),
  navidromeSearch: (query) => request(`/navidrome/search?q=${encodeURIComponent(query)}`),
  navidromePlaylists: () => request("/navidrome/playlists"),
  navidromePlaylist: (id) => request(`/navidrome/playlists/${encodeURIComponent(id)}`),
  navidromeQueue: (device, tracks) => request("/navidrome/queue", {
    method: "POST", body: JSON.stringify({ device, tracks }),
  }),
  navidromePlayNow: (device, track) => request("/navidrome/play-now", {
    method: "POST", body: JSON.stringify({ device, track }),
  }),

  // Files (Phase 3)
  sendFile: (address, file) => {
    const fd = new FormData();
    fd.append("address", address);
    fd.append("file", file);
    return upload("/files/send", fd);
  },
};
