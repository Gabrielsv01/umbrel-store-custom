(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  // ---------- Tabs ----------
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      $(`panel-${tab.dataset.tab}`).classList.add("active");
    });
  });

  // ---------- Health polling ----------
  let modelReady = false;

  async function pollHealth() {
    try {
      const res = await fetch("/health");
      const data = await res.json();
      const dot = $("status-dot");
      const text = $("status-text");
      dot.classList.remove("ready", "error");
      if (data.status === "ready") {
        dot.classList.add("ready");
        text.textContent = "modelo pronto";
        modelReady = true;
      } else if (data.status === "error") {
        dot.classList.add("error");
        text.textContent = `erro: ${data.error || "falha ao carregar"}`;
        modelReady = false;
      } else {
        text.textContent = "carregando modelo…";
        modelReady = false;
      }
    } catch (err) {
      $("status-text").textContent = "sem conexão com a API";
      modelReady = false;
    }
  }

  pollHealth();
  setInterval(pollHealth, 4000);

  // ---------- Languages ----------
  async function loadLanguages() {
    try {
      const res = await fetch("/languages");
      const data = await res.json();
      const select = $("language_id");
      select.innerHTML = "";
      Object.entries(data.languages).forEach(([code, name]) => {
        const opt = document.createElement("option");
        opt.value = code;
        opt.textContent = `${name} (${code})`;
        if (code === data.default) opt.selected = true;
        select.appendChild(opt);
      });
    } catch (err) {
      // Left empty; the generate form will surface the underlying error.
    }
  }

  // ---------- Voice source toggle ----------
  const voiceSource = $("voice_source");
  const voiceSavedField = $("voice-saved-field");
  const voiceUploadField = $("voice-upload-field");

  voiceSource.addEventListener("change", () => {
    voiceSavedField.hidden = voiceSource.value !== "saved";
    voiceUploadField.hidden = voiceSource.value !== "upload";
  });

  // ---------- Sliders ----------
  ["exaggeration", "cfg_weight", "temperature", "repetition_penalty", "min_p", "top_p"].forEach((id) => {
    const input = $(id);
    const output = $(`out-${id}`);
    input.addEventListener("input", () => {
      output.textContent = Number(input.value).toFixed(2);
    });
  });

  // ---------- Text counter ----------
  const textArea = $("text");
  textArea.addEventListener("input", () => {
    $("text-count").textContent = textArea.value.length;
  });

  // ---------- Helpers ----------
  function humanSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  async function readError(res) {
    try {
      const data = await res.json();
      return data.detail || JSON.stringify(data);
    } catch {
      return `Erro HTTP ${res.status}`;
    }
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ---------- Voices list + dropdown ----------
  async function loadVoices() {
    const res = await fetch("/voices");
    const voices = await res.json();

    const dropdown = $("voice_name");
    dropdown.innerHTML = "";
    voices.forEach((v) => {
      const opt = document.createElement("option");
      opt.value = v.name;
      opt.textContent = v.name;
      dropdown.appendChild(opt);
    });

    const list = $("voices-list");
    const empty = $("voices-empty");
    list.innerHTML = "";
    empty.style.display = voices.length ? "none" : "block";

    voices.forEach((v) => {
      const li = document.createElement("li");
      li.className = "item";
      li.innerHTML = `
        <div class="item-info">
          <div class="item-name">${v.name}</div>
          <div class="item-meta">${humanSize(v.size_bytes)}</div>
        </div>
        <audio controls preload="none" src="/voices/${encodeURIComponent(v.name)}"></audio>
        <div class="item-actions">
          <button class="btn danger small" data-name="${v.name}">Apagar</button>
        </div>
      `;
      li.querySelector("button").addEventListener("click", async (e) => {
        const name = e.target.dataset.name;
        if (!confirm(`Apagar a voz "${name}"?`)) return;
        await fetch(`/voices/${encodeURIComponent(name)}`, { method: "DELETE" });
        loadVoices();
      });
      list.appendChild(li);
    });
  }

  $("refresh-voices").addEventListener("click", loadVoices);

  $("voice-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = $("voice-error");
    errorEl.hidden = true;

    const name = $("voice-name").value.trim();
    const file = $("voice-file").files[0];
    if (!file) return;

    const form = new FormData();
    form.append("name", name);
    form.append("file", file);

    const res = await fetch("/voices", { method: "POST", body: form });
    if (!res.ok) {
      errorEl.textContent = await readError(res);
      errorEl.hidden = false;
      return;
    }
    $("voice-form").reset();
    loadVoices();
  });

  // ---------- Outputs history ----------
  async function loadOutputs() {
    const res = await fetch("/outputs");
    const outputs = await res.json();

    const list = $("outputs-list");
    const empty = $("outputs-empty");
    list.innerHTML = "";
    empty.style.display = outputs.length ? "none" : "block";

    outputs.forEach((o) => {
      const li = document.createElement("li");
      li.className = "item";
      li.innerHTML = `
        <div class="item-info">
          <div class="item-name">${o.filename}</div>
          <div class="item-meta">${humanSize(o.size_bytes)}</div>
        </div>
        <audio controls preload="none" src="/outputs/${encodeURIComponent(o.filename)}"></audio>
        <div class="item-actions">
          <a class="btn ghost small" href="/outputs/${encodeURIComponent(o.filename)}" download>Baixar</a>
          <button class="btn danger small" data-name="${o.filename}">Apagar</button>
        </div>
      `;
      li.querySelector("button").addEventListener("click", async (e) => {
        const filename = e.target.dataset.name;
        if (!confirm(`Apagar "${filename}"?`)) return;
        await fetch(`/outputs/${encodeURIComponent(filename)}`, { method: "DELETE" });
        loadOutputs();
      });
      list.appendChild(li);
    });
  }

  $("refresh-outputs").addEventListener("click", loadOutputs);

  // ---------- Generate (async job + progress polling) ----------
  const POLL_INTERVAL_MS = 600;

  async function pollJob(jobId) {
    const bar = $("progress-bar");
    const statusEl = $("progress-status");
    const pctEl = $("progress-pct");

    while (true) {
      const res = await fetch(`/tts/jobs/${encodeURIComponent(jobId)}`);
      if (!res.ok) throw new Error(await readError(res));
      const data = await res.json();

      if (data.status === "queued") {
        bar.classList.add("indeterminate");
        statusEl.textContent = "Na fila…";
        pctEl.textContent = "";
      } else if (data.status === "running") {
        bar.classList.remove("indeterminate");
        bar.style.width = `${data.progress}%`;
        statusEl.textContent = "Gerando…";
        pctEl.textContent = `${data.progress}%`;
      } else if (data.status === "done") {
        bar.classList.remove("indeterminate");
        bar.style.width = "100%";
        statusEl.textContent = "Concluído";
        pctEl.textContent = "100%";
        return data;
      } else if (data.status === "error") {
        throw new Error(data.error || "Falha na geração.");
      }

      await sleep(POLL_INTERVAL_MS);
    }
  }

  $("generate-form").addEventListener("submit", async (e) => {
    e.preventDefault();

    const errorEl = $("generate-error");
    const btn = $("generate-btn");
    const progressWrap = $("progress-wrap");
    const bar = $("progress-bar");
    errorEl.hidden = true;

    if (!modelReady) {
      errorEl.textContent = "O modelo ainda está carregando. Aguarde o status ficar \"modelo pronto\".";
      errorEl.hidden = false;
      return;
    }

    const form = new FormData();
    form.append("text", $("text").value);
    form.append("language_id", $("language_id").value);
    form.append("exaggeration", $("exaggeration").value);
    form.append("cfg_weight", $("cfg_weight").value);
    form.append("temperature", $("temperature").value);
    form.append("repetition_penalty", $("repetition_penalty").value);
    form.append("min_p", $("min_p").value);
    form.append("top_p", $("top_p").value);

    const seed = $("seed").value;
    if (seed !== "") form.append("seed", seed);

    if (voiceSource.value === "saved" && $("voice_name").value) {
      form.append("voice_name", $("voice_name").value);
    } else if (voiceSource.value === "upload" && $("audio_prompt").files[0]) {
      form.append("audio_prompt", $("audio_prompt").files[0]);
    }

    btn.disabled = true;
    btn.querySelector(".btn-label").textContent = "Gerando…";
    progressWrap.hidden = false;
    bar.style.width = "0%";
    bar.classList.add("indeterminate");
    $("progress-status").textContent = "Na fila…";
    $("progress-pct").textContent = "";

    try {
      const startRes = await fetch("/tts/jobs", { method: "POST", body: form });
      if (!startRes.ok) {
        errorEl.textContent = await readError(startRes);
        errorEl.hidden = false;
        return;
      }

      const job = await startRes.json();
      const finished = await pollJob(job.job_id);
      const filename = finished.filename;
      const url = `/outputs/${encodeURIComponent(filename)}`;

      $("result-empty").hidden = true;
      $("result-player").hidden = false;
      const audio = $("result-audio");
      audio.src = url;
      audio.play().catch(() => {});

      const download = $("result-download");
      download.href = url;
      download.download = filename;
      $("result-meta").textContent = filename;

      loadOutputs();
    } catch (err) {
      errorEl.textContent = err.message || "Falha de rede ao chamar a API.";
      errorEl.hidden = false;
    } finally {
      btn.disabled = false;
      btn.querySelector(".btn-label").textContent = "Gerar áudio";
      progressWrap.hidden = true;
    }
  });

  // ---------- Init ----------
  loadLanguages();
  loadVoices();
  loadOutputs();
})();
