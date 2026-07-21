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
  renameDevice: (addr, name) =>
    request(`/classic/${addr}/rename`, { method: "POST", body: JSON.stringify({ name }) }),
  setAdapterName: (name) =>
    request(`/adapter/name`, { method: "POST", body: JSON.stringify({ name }) }),

  // Scheduler
  schedules: () => request("/schedules"),
  scheduleCreate: ({ device, time, repeat, days, date, file, url }) => {
    const fd = new FormData();
    fd.append("device", device);
    fd.append("time", time);
    fd.append("repeat", repeat);
    if (days) fd.append("days", days);
    if (date) fd.append("date", date);
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
  audioPlay: ({ device, file, url }) => {
    const fd = new FormData();
    fd.append("device", device);
    if (file) fd.append("file", file);
    if (url) fd.append("url", url);
    return upload("/audio/play", fd);
  },

  // Files (Phase 3)
  sendFile: (address, file) => {
    const fd = new FormData();
    fd.append("address", address);
    fd.append("file", file);
    return upload("/files/send", fd);
  },
};
