(function () {
  'use strict';

  const POLL_INTERVAL_MS = 2000;
  const SAFETY_MARGIN_SECONDS = 3;
  // 'ready' e 'uploading' NÃO entram aqui: são estados transitórios em que
  // ainda queremos continuar consultando o progresso (do upload, nesse
  // caso) — só 'forwarded'/'error' são terminais de verdade.
  const DONE_STATES = ['forwarded', 'error'];
  const POSITION_SAVE_INTERVAL_MS = 5000;
  const POSITION_STORAGE_PREFIX = 'teleredirect:pos:';

  // Um F5 de verdade destrói toda a instância do controller (diferente do
  // video.load() interno usado pra pegar prévias mais completas, que
  // preserva posição em memória) — sem isso, a página sempre voltaria pro
  // 0:00 depois de atualizar.
  function loadSavedPosition(mediaId) {
    try {
      const raw = localStorage.getItem(POSITION_STORAGE_PREFIX + mediaId);
      return raw ? parseFloat(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function saveSavedPosition(mediaId, time) {
    try {
      localStorage.setItem(POSITION_STORAGE_PREFIX + mediaId, String(time));
    } catch (e) {
      // localStorage indisponível (modo privado, quota etc.) — ignora
    }
  }

  function clearSavedPosition(mediaId) {
    try {
      localStorage.removeItem(POSITION_STORAGE_PREFIX + mediaId);
    } catch (e) {
      // idem
    }
  }

  function fmtTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) return '--:--';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const parts = h > 0 ? [h, m, s] : [m, s];
    return parts.map((p, i) => (i === 0 ? String(p) : String(p).padStart(2, '0'))).join(':');
  }

  function fmtMB(bytes) {
    if (!bytes) return '?';
    return `${(bytes / 1048576).toFixed(0)}MB`;
  }

  // Controla um <video> que aponta para /stream/<id> enquanto o cache local
  // ainda está sendo preenchido em segundo plano.
  //
  // Ponto chave: uma vez que o navegador carrega e interpreta os metadados
  // de um arquivo, ele NÃO percebe sozinho que esse mesmo arquivo foi
  // substituído por uma versão maior no servidor (prévia parcial do
  // Matroska sendo regenerada a cada N segundos) — <video> não re-consulta
  // metadados por conta própria. Por isso, quem decide "posso tocar mais?"
  // é sempre o próprio navegador (video.seekable/duration/ended, já
  // carregados), e quando ele fica "travado" numa versão antiga, este
  // controller força um video.load() preservando posição/estado de play
  // assim que uma versão mais completa aparecer via polling.
  class CachedMediaController {
    constructor(root) {
      this.root = root;
      this.mediaId = root.dataset.mediaId;
      this.video = root.querySelector('video');
      if (!this.video) return;

      this.cacheFill = root.querySelector('.cache-bar__fill');
      this.cacheLabel = root.querySelector('.cache-label');
      this.waitBadge = root.querySelector('.wait-badge');
      this.streamWarning = root.querySelector('.stream-warning');
      this.errorBadge = root.querySelector('.error-badge');
      this.pauseBtn = root.querySelector('.btn-pause');
      this.resumeBtn = root.querySelector('.btn-resume');

      if (this.pauseBtn) {
        this.pauseBtn.addEventListener('click', () => this._triggerControlAction(this.pauseBtn, 'pause'));
      }
      if (this.resumeBtn) {
        this.resumeBtn.addEventListener('click', () => this._triggerControlAction(this.resumeBtn, 'resume'));
      }

      this.totalBytes = null;
      this.cachedBytes = 0;
      this.duration = null;
      this.state = null;

      this.pendingSeek = null;
      this.awaitingCatchUp = false;
      this.webPlayable = true;
      this.loadedRemuxBytes = null; // quanto da fonte crua a versão atualmente carregada no <video> cobre
      this.usesRemux = false; // ver _effectiveSeekableEnd() — muda qual sinal é confiável

      this.savedPosition = loadSavedPosition(this.mediaId);
      this.lastPositionSaveAt = 0;
      this._restoredSavedPosition = false;

      this.video.addEventListener('seeking', () => this._onSeeking());
      this.video.addEventListener('timeupdate', () => this._onTimeUpdate());
      this.video.addEventListener('timeupdate', () => this._maybeSavePosition());
      this.video.addEventListener('ended', () => this._onEnded());
      this.video.addEventListener('loadedmetadata', () => this._maybeRestoreSavedPosition());

      this._poll();
    }

    get isDone() {
      // Cache 100% NÃO basta pra considerar "terminado": ainda falta o
      // upload de volta pro grupo (estado 'uploading'), que também
      // precisa de polling contínuo pra mostrar progresso.
      return DONE_STATES.includes(this.state);
    }

    // Estimativa de "até que segundo já temos em cache", só para o rótulo
    // cosmético da barra de cache — NUNCA usada para decidir pausa/seek
    // (isso é sempre feito com sinais reais do navegador, ver _onSeeking /
    // _onTimeUpdate / _maybeReloadForNewRemux).
    get estimatedCachedSeconds() {
      if (!this.duration || !this.totalBytes) return null;
      if (this.isDone) return this.duration;
      return this.duration * (this.cachedBytes / this.totalBytes);
    }

    async _poll() {
      try {
        const res = await fetch(`/api/media/${this.mediaId}/progress`);
        if (res.ok) {
          const data = await res.json();
          this.totalBytes = data.total_bytes;
          this.cachedBytes = data.cached_bytes;
          this.duration = data.duration;
          this.state = data.state;
          this.uploadedBytes = data.uploaded_bytes;
          this.uploadTotalBytes = data.upload_total_bytes;
          this.usesRemux = data.container === 'matroska';

          this._updatePlayabilityWarning(data);
          this._maybeReloadForNewRemux(data);
          this._maybeResumeNativeProgress();
          this._updateControlsVisibility();

          if (this.state === 'error' && this.errorBadge) {
            this.errorBadge.textContent = `❌ Erro no download${data.error ? ': ' + data.error : ''}`;
            this.errorBadge.hidden = false;
          }

          this._render();
        }
      } catch (e) {
        // Rede instável: ignora, tenta de novo no próximo ciclo.
      }

      if (!this.isDone) {
        setTimeout(() => this._poll(), POLL_INTERVAL_MS);
      }
    }

    _render() {
      if (this.state === 'uploading') {
        this._renderUploadProgress();
        return;
      }

      if (this.cacheFill) {
        const pct = this.totalBytes ? Math.min(100, (this.cachedBytes / this.totalBytes) * 100) : 0;
        this.cacheFill.style.width = `${pct.toFixed(1)}%`;
      }
      if (this.cacheLabel) {
        const estimate = this.estimatedCachedSeconds;
        const cachedTxt = estimate != null ? fmtTime(estimate) : fmtMB(this.cachedBytes);
        const totalTxt = this.duration ? fmtTime(this.duration) : fmtMB(this.totalBytes);
        const suffix = this.isDone ? (this.state === 'error' ? ' · parou (erro)' : ' · completo') : ' · baixando...';
        this.cacheLabel.textContent = `Cache: ${cachedTxt} / ${totalTxt}${suffix}`;
      }
    }

    // Reaproveita a mesma barra/rótulo do cache pra mostrar o progresso do
    // reenvio ao grupo do Telegram — são fases sequenciais (nunca ao mesmo
    // tempo), então não faz sentido ter duas barras separadas na tela.
    _renderUploadProgress() {
      const uploaded = this.uploadedBytes || 0;
      const total = this.uploadTotalBytes || this.totalBytes;
      if (this.cacheFill) {
        const pct = total ? Math.min(100, (uploaded / total) * 100) : 0;
        this.cacheFill.style.width = `${pct.toFixed(1)}%`;
      }
      if (this.cacheLabel) {
        this.cacheLabel.textContent = `Enviando ao grupo: ${fmtMB(uploaded)} / ${fmtMB(total)}...`;
      }
    }

    _showWaiting(show) {
      if (this.waitBadge) this.waitBadge.hidden = !show;
    }

    // Pausar só faz sentido enquanto há algo ativamente em andamento
    // (baixando ou enviando); retomar só quando pausado. O botão de
    // excluir NÃO entra aqui — fica sempre visível (mesmo já reenviado),
    // pra dar pra limpar o cache manualmente antes da retenção expirar.
    _updateControlsVisibility() {
      if (this.pauseBtn) this.pauseBtn.hidden = !(this.state === 'caching' || this.state === 'uploading');
      if (this.resumeBtn) this.resumeBtn.hidden = this.state !== 'paused';
    }

    async _triggerControlAction(button, action) {
      button.disabled = true;
      try {
        await fetch(`/api/media/${this.mediaId}/${action}`, { method: 'POST' });
      } catch (e) {
        // Rede instável: ignora — o próximo poll reflete o estado real.
      }
      button.disabled = false;
    }

    // web_playable=false cobre dois motivos: o arquivo é Matroska (.mkv)
    // rotulado como .mp4, ou é um MP4 de verdade com o moov no final (não
    // dá pra saber sem checar os bytes) — em ambos os casos o <video> não
    // decodifica nada até existir uma prévia remuxada. Assim que uma
    // prévia (parcial ou final) fica disponível, recarregamos a fonte pra
    // o navegador tentar decodificar.
    _updatePlayabilityWarning(data) {
      if (!this.streamWarning) return;

      if (data.web_playable === false) {
        this.webPlayable = false;
        const motivo = data.container === 'matroska'
          ? 'está em formato Matroska (MKV)'
          : 'precisa ser processado antes de poder ser reproduzido aqui';
        this.streamWarning.textContent =
          `⚠️ Este arquivo ${motivo} e ainda não tem nenhuma prévia disponível. ` +
          'Enquanto isso, abra o link acima direto no VLC/mpv.';
        this.streamWarning.hidden = false;
        return;
      }

      if (data.supports_streaming === false) {
        this.streamWarning.textContent =
          '⚠️ Este arquivo pode não permitir avançar livremente até o download terminar.';
        this.streamWarning.hidden = false;
      } else {
        this.streamWarning.hidden = true;
      }

      if (!this.webPlayable) {
        // Acabou de virar reproduzível (primeira prévia concluída):
        // recarrega a fonte pra o navegador tentar decodificar de novo.
        this.webPlayable = true;
        this.loadedRemuxBytes = data.remuxed_up_to_bytes;
        this.video.load();
      }
    }

    // O servidor pode ter substituído o .web.mp4 por uma versão maior
    // (mais do Matroska já remuxado) sem que o navegador saiba — ele só
    // percebe se a gente forçar um load() novo. Só faz isso quando a
    // reprodução já está parada esperando (senão interromperia um
    // playback tranquilo por nada).
    _maybeReloadForNewRemux(data) {
      const newBytes = data.remuxed_up_to_bytes;
      if (newBytes == null) return;

      if (this.loadedRemuxBytes == null) {
        // Primeira medição: assume que o carregamento nativo inicial do
        // navegador (a partir do src estático no HTML) já refletia isso.
        this.loadedRemuxBytes = newBytes;
        return;
      }

      if (newBytes <= this.loadedRemuxBytes) return; // nada novo desde o último load

      const stuck = this.awaitingCatchUp || this.pendingSeek !== null;
      if (!stuck) return; // ainda tocando tranquilo a versão antiga; recarrega quando travar

      this._reloadPreservingPosition(newBytes);
    }

    _reloadPreservingPosition(newBytes) {
      const resumeTarget = this.pendingSeek !== null ? this.pendingSeek : this.video.currentTime;
      const shouldPlay = this.pendingSeek !== null || this.awaitingCatchUp || !this.video.paused;

      const onLoaded = () => {
        this.video.removeEventListener('loadedmetadata', onLoaded);
        if (this._canSeekNow()) {
          const seekableEnd = this.video.seekable.end(this.video.seekable.length - 1);
          this.video.currentTime = Math.min(resumeTarget, seekableEnd);
        }
        if (shouldPlay) {
          this.video.play().catch(() => {});
        }
      };
      this.video.addEventListener('loadedmetadata', onLoaded);

      this.loadedRemuxBytes = newBytes;
      this.pendingSeek = null;
      this.awaitingCatchUp = false;
      this._showWaiting(false);

      // Cache-busting extra: além do Cache-Control: no-store no servidor,
      // troca a query string pra garantir que o navegador não reaproveite
      // uma resposta antiga já guardada em cache pra essa mesma URL.
      const base = this.video.src.split('?')[0];
      this.video.src = `${base}?v=${newBytes}`;
      this.video.load();
    }

    // Caso MP4 nativo (sem remux): não precisa de video.load() nenhum —
    // o moov já é válido pro arquivo inteiro desde o início, só falta
    // mais bytes existirem em disco. Uma vez que a estimativa por bytes
    // (atualizada a cada poll) mostra margem suficiente, só retenta o
    // seek pendente ou retoma o play; o navegador busca via HTTP range
    // normalmente.
    _maybeResumeNativeProgress() {
      if (this.usesRemux) return; // esse caso é tratado por _maybeReloadForNewRemux
      if (this.pendingSeek === null && !this.awaitingCatchUp) return;

      const safeEnd = this._effectiveSeekableEnd();
      if (safeEnd == null) return;

      if (this.pendingSeek !== null) {
        if (safeEnd < this.pendingSeek && !this.isDone) return; // ainda não chegou lá
        const target = this.pendingSeek;
        this.pendingSeek = null;
        this._showWaiting(false);
        if (this._canSeekNow()) {
          this.video.currentTime = Math.min(target, safeEnd);
        }
        this.video.play().catch(() => {});
        return;
      }

      if (this.awaitingCatchUp) {
        const margin = safeEnd - this.video.currentTime;
        if (margin < SAFETY_MARGIN_SECONDS && !this.isDone) return; // ainda sem margem suficiente
        this.awaitingCatchUp = false;
        this._showWaiting(false);
        this.video.play().catch(() => {});
      }
    }

    _canSeekNow() {
      return this.video.seekable && this.video.seekable.length > 0;
    }

    // Até que segundo é seguro deixar o navegador buscar agora. Depende
    // de qual arquivo está sendo servido:
    //  - Matroska remuxado (.web.mp4): o moov é gerado por NÓS a cada
    //    remux, então video.seekable já reflete exatamente o que existe
    //    — confiar nele é correto e mais preciso que estimar por bytes.
    //  - MP4 nativo servido direto do arquivo baixando: o moov é do
    //    upload ORIGINAL e descreve o arquivo COMPLETO desde o início —
    //    video.seekable diz "o arquivo todo é buscável" mesmo que só uma
    //    fração exista em disco agora. Confiar nele aqui deixaria o
    //    navegador tentar buscar um trecho que o servidor não tem,
    //    caindo num 503 sem nenhuma proteção. Usa a estimativa por bytes
    //    como limite de segurança nesse caso.
    _effectiveSeekableEnd() {
      const nativeEnd = this._canSeekNow()
        ? this.video.seekable.end(this.video.seekable.length - 1)
        : null;

      if (this.usesRemux) return nativeEnd;

      const estimate = this.estimatedCachedSeconds;
      if (nativeEnd == null) return estimate;
      if (estimate == null) return nativeEnd;
      return Math.min(nativeEnd, estimate);
    }

    _maybeSavePosition() {
      const now = Date.now();
      if (now - this.lastPositionSaveAt < POSITION_SAVE_INTERVAL_MS) return;
      this.lastPositionSaveAt = now;
      saveSavedPosition(this.mediaId, this.video.currentTime);
    }

    // Só restaura na primeira vez que os metadados carregam (a página
    // acabou de abrir) — recargas subsequentes feitas pelo próprio player
    // (_reloadPreservingPosition) já cuidam da posição delas mesmas.
    _maybeRestoreSavedPosition() {
      if (this._restoredSavedPosition) return;
      this._restoredSavedPosition = true;
      if (this.savedPosition == null || this.savedPosition < 2) return;
      // Reaproveita o mesmo tratamento de "além do que já dá pra tocar"
      // do seek normal do usuário — currentTime dispara 'seeking'.
      this.video.currentTime = this.savedPosition;
    }

    _onSeeking() {
      if (this.isDone) return; // tudo em disco, nada a proteger

      const target = this.video.currentTime;
      const safeEnd = this._effectiveSeekableEnd();
      if (safeEnd != null) {
        if (target <= safeEnd) return; // dentro do que já é seguro tocar
        this.pendingSeek = target;
        if (this._canSeekNow()) {
          this.video.currentTime = Math.max(0, safeEnd - 0.5);
        }
      } else {
        this.pendingSeek = target;
      }
      this.video.pause();
      this._showWaiting(true);
    }

    _onTimeUpdate() {
      if (this.isDone || this.pendingSeek !== null || this.video.paused) return;

      const safeEnd = this._effectiveSeekableEnd();
      if (safeEnd == null) return;

      const margin = safeEnd - this.video.currentTime;
      if (margin < SAFETY_MARGIN_SECONDS) {
        // Reprodução alcançou a borda do que é seguro tocar agora: pausa
        // de forma controlada em vez de deixar o navegador travar/errar
        // tentando buscar um trecho que o servidor ainda não tem.
        this.video.pause();
        this.awaitingCatchUp = true;
        this._showWaiting(true);
      }
    }

    _onEnded() {
      if (this.isDone) {
        // Fim de verdade: não faz sentido guardar posição pra "retomar"
        // um vídeo que já foi assistido até o final.
        clearSavedPosition(this.mediaId);
        return;
      }
      // Chegou ao fim da versão atualmente carregada antes do download
      // terminar: trata como "aguardando cache", não como vídeo acabado.
      this.awaitingCatchUp = true;
      this._showWaiting(true);
    }
  }

  // Funciona em qualquer card (com ou sem vídeo — fotos também têm botão
  // de excluir), por isso fica fora da CachedMediaController.
  function wireDeleteButton(root) {
    const btn = root.querySelector('.btn-delete');
    if (!btn) return;
    const mediaId = root.dataset.mediaId;

    btn.addEventListener('click', async () => {
      if (!confirm('Excluir esta mídia e limpar o cache? Essa ação não pode ser desfeita.')) return;
      btn.disabled = true;
      try {
        const res = await fetch(`/api/media/${mediaId}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.ok) {
          root.remove();
        } else {
          alert('Não foi possível excluir agora. Tente de novo em alguns segundos.');
          btn.disabled = false;
        }
      } catch (e) {
        alert('Erro de rede ao tentar excluir.');
        btn.disabled = false;
      }
    });
  }

  document.querySelectorAll('.media-card[data-media-id]').forEach((root) => {
    new CachedMediaController(root);
    wireDeleteButton(root);
  });
})();
