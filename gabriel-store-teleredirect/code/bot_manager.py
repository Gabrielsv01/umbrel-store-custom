import os
import threading
import asyncio
import contextlib
import mimetypes
import struct
import time
import logging
from telethon import TelegramClient, events
from telethon.sessions import StringSession
from telethon.tl.types import DocumentAttributeVideo, DocumentAttributeFilename

import config
import remux
from media_store import MediaStore, RECEIVED, CACHING, READY, UPLOADING, FORWARDED, ERROR, PAUSED

logging.basicConfig(filename=os.path.join(config.DATA_PATH, 'bot_activity.log'), level=logging.INFO, format='%(asctime)s - %(message)s')
logger = logging.getLogger('teleredirect')

# Piso conservador de throughput pra estimar um timeout de download
# proporcional ao tamanho do arquivo (LAN/DC do Telegram costuma ser bem
# mais rápido que isso; é só uma rede de segurança contra downloads
# travados por queda de conexão).
MIN_THROUGHPUT_BYTES_PER_SEC = 150 * 1024
DOWNLOAD_TIMEOUT_GRACE_SECONDS = 60
DEFAULT_DOWNLOAD_TIMEOUT_SECONDS = 1800

# Enquanto o download de um Matroska ainda está em andamento, gera uma
# prévia web parcial (remux do que já existe em disco) a cada N segundos,
# desde que pelo menos esse tanto de bytes novos tenha chegado — evita
# rodar ffmpeg sem parar num arquivo que ainda está crescendo pouco a pouco.
PARTIAL_REMUX_INTERVAL_SECONDS = 20
PARTIAL_REMUX_MIN_NEW_BYTES = 8 * 1024 * 1024

# Para MP4 sem faststart (moov no final — ver remux.needs_remux), tenta
# buscar o moov fora de ordem por offset (ver find_moov_expected_offset)
# pra viabilizar prévia parcial DURANTE o download, não só depois que ele
# termina. MOOV_TAIL_MAX_BYTES limita o tamanho aceito do box moov em si
# (sanidade — moov real raramente passa de poucos MB). MOOV_TAIL_MAX_TOTAL_SIZE
# desliga a técnica pra arquivos muito grandes: o remux final produzido a
# partir do arquivo esparso montado não tem garantia de preservar o buraco
# esparso no disco, então o pior caso de uso de disco temporário escala com
# o tamanho total do arquivo.
MOOV_TAIL_MAX_BYTES = 4 * 1024 * 1024
MOOV_TAIL_MAX_TOTAL_SIZE = 3 * 1024 * 1024 * 1024

# Intervalo de atualização da mensagem de status enviada ao grupo
# (baixando/processando/enviando), editada no lugar em vez de spammar
# mensagens novas.
STATUS_MESSAGE_INTERVAL_SECONDS = 20

# Varredura periódica de cache expirado, independente de tráfego — sem
# isso, um item já enviado ao grupo só era limpo quando a PRÓXIMA mensagem
# do bot chegasse (podia nunca acontecer, se o bot ficasse quieto).
CLEANUP_INTERVAL_SECONDS = 300


def _download_timeout_for(size):
    if not size:
        return DEFAULT_DOWNLOAD_TIMEOUT_SECONDS
    return max(DEFAULT_DOWNLOAD_TIMEOUT_SECONDS, size / MIN_THROUGHPUT_BYTES_PER_SEC + DOWNLOAD_TIMEOUT_GRACE_SECONDS)


# Piso conservador de upload — banda de subida residencial costuma ser
# bem mais fraca que a de download, então esse piso é mais baixo que
# MIN_THROUGHPUT_BYTES_PER_SEC de propósito (senão o upload simultâneo
# de um arquivo grande numa conexão residencial real cairia em timeout
# por falso positivo).
MIN_UPLOAD_THROUGHPUT_BYTES_PER_SEC = 80 * 1024


def _upload_timeout_for(size):
    if not size:
        return DEFAULT_DOWNLOAD_TIMEOUT_SECONDS
    return max(DEFAULT_DOWNLOAD_TIMEOUT_SECONDS, size / MIN_UPLOAD_THROUGHPUT_BYTES_PER_SEC + DOWNLOAD_TIMEOUT_GRACE_SECONDS)


def _concurrent_timeout_for(size):
    """Download e upload simultâneos terminam em ~max(tempo de download,
    tempo de upload), não na soma — o timeout precisa cobrir o lado mais
    lento dos dois, não só o download como no caminho sequencial."""
    return max(_download_timeout_for(size), _upload_timeout_for(size))


class _GrowingFileUploadStream:
    """Permite fazer upload pro Telegram de um arquivo que AINDA está
    sendo baixado por outra task, em vez de esperar o download terminar
    100% pra só então começar a reenviar — corta o tempo total de
    ~download+upload para ~max(download, upload).

    Bloqueia (via polling) quando alcança o que já foi escrito até agora,
    até que mais bytes cheguem ou o download termine/falhe. O Telethon
    exige leituras EXATAS do tamanho pedido em cada parte, exceto a
    última (ver client.upload_file: um `len(part) != part_size` antes do
    fim levanta ValueError) — por isso `read()` acumula em loop até ter
    o suficiente, em vez de devolver o que tiver na hora.

    O `.name` evita que o Telethon tente inferir tipo/metadados lendo o
    arquivo (hachoir) — com extensão já no nome, ele resolve isso só pela
    string, sem precisar tocar no conteúdo."""

    def __init__(self, file_path, total_size, download_done, download_error, poll_interval=0.2):
        self.name = os.path.basename(file_path)
        self._file_path = file_path
        self._total_size = total_size
        self._download_done = download_done
        self._download_error = download_error
        self._poll_interval = poll_interval
        self._f = None
        self._pos = 0

    async def _wait_until(self, condition):
        """Espera até `condition()` ser verdadeiro, verificando erro/fim
        do download a cada ciclo — usado tanto pra esperar o arquivo ser
        criado (download ainda nem começou a escrever) quanto pra esperar
        mais bytes chegarem."""
        while not condition():
            if self._download_error.get('exc') is not None:
                raise self._download_error['exc']
            if self._download_done.is_set():
                return False
            await asyncio.sleep(self._poll_interval)
        return True

    async def _ensure_open(self):
        if self._f is not None:
            return
        # O download é agendado como task, mas pode não ter tido chance
        # de rodar (e criar o arquivo) ainda no instante em que o upload
        # começa a tentar ler — espera o arquivo existir antes de abrir.
        ok = await self._wait_until(lambda: os.path.exists(self._file_path))
        if not ok:
            raise RuntimeError(f'Download terminou sem nunca criar o arquivo {self._file_path}')
        self._f = open(self._file_path, 'rb')

    async def read(self, n=-1):
        await self._ensure_open()
        remaining = self._total_size - self._pos
        if remaining <= 0:
            return b''
        want = remaining if n is None or n < 0 else min(n, remaining)

        buf = bytearray()
        while len(buf) < want:
            self._f.seek(self._pos + len(buf))
            chunk = self._f.read(want - len(buf))
            if chunk:
                buf.extend(chunk)
                continue
            if self._download_error.get('exc') is not None:
                raise self._download_error['exc']
            if self._download_done.is_set():
                raise RuntimeError(
                    'Download terminou sem produzir os bytes esperados para o upload '
                    f'simultâneo (faltavam {want - len(buf)} bytes em {self._file_path})'
                )
            await asyncio.sleep(self._poll_interval)

        self._pos += len(buf)
        return bytes(buf)

    def close(self):
        if self._f is not None:
            self._f.close()


class BotManager:
    def __init__(self):
        self.data_path = config.DATA_PATH
        self.session_file = os.path.join(self.data_path, 'string.session')
        self.cache_dir = os.path.join(self.data_path, 'cache')
        os.makedirs(self.cache_dir, exist_ok=True)

        self.cfg = config.load_config()
        self.api_id, self.api_hash = config.get_telethon_credentials(self.cfg)
        self.base_url = config.get_base_url(self.cfg)
        self.retention_seconds = config.get_cache_retention_seconds(self.cfg)

        self.store = MediaStore(os.path.join(self.data_path, 'media_store.json'))
        # Um asyncio.Lock por item em remux, pra garantir que a prévia
        # parcial (durante o download) e o remux final (após concluir)
        # nunca rodem o ffmpeg ao mesmo tempo pro mesmo arquivo.
        self._remux_locks = {}
        # A task de _download_to_cache em andamento pra cada item — usado
        # por pause_download/delete_media pra poder cancelar de fora.
        self._active_tasks = {}

        if remux.ffmpeg_available():
            self.can_remux = True
        else:
            self.can_remux = False
            logger.warning(
                "ffmpeg não encontrado no PATH: arquivos Matroska/MKV rotulados como "
                ".mp4 não serão remuxados e não vão reproduzir no player web "
                "(continuam disponíveis via VLC/mpv apontando pro /stream/...)."
            )

        self.loop = asyncio.new_event_loop()
        self.client = TelegramClient(StringSession(self._load_session()), self.api_id, self.api_hash, loop=self.loop)

        self._start_background()

    # ---------- Sessão ----------
    def _load_session(self):
        if os.path.exists(self.session_file):
            with open(self.session_file, 'r') as f:
                return f.read().strip()
        return ''

    # ---------- Background thread ----------
    def _start_background(self):
        thread = threading.Thread(target=self._run_client_thread, daemon=True)
        thread.start()

    def _run_client_thread(self):
        asyncio.set_event_loop(self.loop)

        async def main():
            try:
                await self.client.connect()
                if await self.client.is_user_authorized():
                    logger.info("Conectado e autorizado.")
                    await self._reconcile_orphaned_downloads()
                    await self._start_listening()
                else:
                    logger.warning("Não autorizado. Rode login_generate.py para gerar string.session.")
            except Exception:
                logger.exception("Erro de conexão com o Telegram")

        self.loop.run_until_complete(main())
        self.loop.run_forever()

    # ---------- Listener de mensagens ----------
    async def _start_listening(self):
        bot_id, target_group = config.get_forward_ids(self.cfg)
        asyncio.create_task(self._periodic_cleanup_loop())

        @self.client.on(events.NewMessage(from_users=bot_id))
        async def handler(event):
            msg = event.message
            logger.info("Recebida mensagem do bot (id=%s)", msg.id)

            if msg.media:
                meta = self._extract_media_meta(msg)
                self.store.create(msg.id, meta)
                self._spawn_download_task(msg, msg.id, meta, target_group)
            else:
                try:
                    await self.client.send_message(target_group, msg.message)
                except Exception:
                    logger.exception("Falha ao reencaminhar texto da mensagem %s", msg.id)

    def _spawn_download_task(self, msg, msg_id, meta, target_group, resume_from_bytes=0):
        """Cria a task de _download_to_cache e a registra em
        _active_tasks, pra pause_download/delete_media poderem cancelá-la
        de fora. Remove o registro sozinha quando a task termina."""
        key = str(msg_id)
        task = asyncio.create_task(
            self._download_to_cache(msg, msg_id, meta, target_group, resume_from_bytes=resume_from_bytes)
        )
        self._active_tasks[key] = task

        def _cleanup(finished_task):
            if self._active_tasks.get(key) is finished_task:
                del self._active_tasks[key]

        task.add_done_callback(_cleanup)
        return task

    @staticmethod
    def _build_send_attributes(meta):
        """Reconstrói os atributos de vídeo (duração, dimensões,
        supports_streaming) da mensagem original na hora de reenviar.
        Sem isso, o Telethon não tem como saber que é um vídeo e o
        Telegram trata o reenvio como um arquivo genérico — sem player
        embutido nem streaming — mesmo que o original tivesse essas
        informações e permitisse tocar durante o próprio download."""
        attributes = [DocumentAttributeFilename(file_name=meta.get('name') or 'arquivo')]
        if meta.get('duration'):
            attributes.append(DocumentAttributeVideo(
                duration=int(meta['duration']),
                w=meta.get('width') or 0,
                h=meta.get('height') or 0,
                supports_streaming=True,
            ))
        return attributes

    @staticmethod
    def _fmt_mb(num_bytes):
        if not num_bytes:
            return '0MB'
        return f"{num_bytes / 1048576:.1f}MB"

    @staticmethod
    def _display_name(meta_or_item):
        """Prioriza a legenda original da mensagem (o que o bot de fato
        escreveu sobre o vídeo — título, descrição etc.) sobre o nome do
        arquivo, que costuma ser só um nome técnico/genérico sem contexto
        nenhum pra quem está acompanhando o status no grupo."""
        return meta_or_item.get('caption') or meta_or_item.get('name') or 'mídia'

    # ---------- Mensagem de status no grupo ----------
    # Usa o (chat, message_id) salvo no store em vez de manter o objeto
    # Message vivo em memória — assim pause_download/delete_media também
    # conseguem editar/apagar essa mensagem, de fora do fluxo principal de
    # _download_to_cache.
    async def _send_status_message(self, target_group, msg_id, meta):
        """Manda uma mensagem inicial de status, editada no lugar durante
        o download/upload em vez de gerar spam de mensagens novas. Nunca
        deve impedir o pipeline de cache/envio — se falhar, só seguimos
        sem status (log e não salva nenhum id)."""
        name = self._display_name(meta)
        try:
            sent = await self.client.send_message(target_group, f"📥 Baixando: {name}\n0%")
            self.store.update(msg_id, status_chat_id=target_group, status_message_id=sent.id)
        except Exception:
            logger.exception("Falha ao enviar mensagem de status inicial")

    async def _edit_status_message(self, msg_id, text):
        item = self.store.get(msg_id)
        if not item or not item.get('status_message_id'):
            return
        try:
            await self.client.edit_message(item['status_chat_id'], item['status_message_id'], text)
        except Exception:
            logger.exception("Falha ao atualizar mensagem de status de %s", msg_id)

    async def _delete_status_message(self, msg_id):
        item = self.store.get(msg_id)
        if not item or not item.get('status_message_id'):
            return
        try:
            await self.client.delete_messages(item['status_chat_id'], [item['status_message_id']])
        except Exception:
            logger.exception("Falha ao apagar mensagem de status de %s", msg_id)

    async def _status_message_loop(self, msg_id, file_path):
        while True:
            await asyncio.sleep(STATUS_MESSAGE_INTERVAL_SECONDS)

            item = self.store.get(msg_id)
            if not item or not item.get('status_message_id'):
                return
            state = item.get('state')
            name = self._display_name(item)

            if state == CACHING:
                cached = os.path.getsize(file_path) if os.path.exists(file_path) else 0
                total = item.get('size') or cached
                pct = (cached / total * 100) if total else 0
                uploaded = item.get('uploaded_bytes')
                if uploaded:
                    # Upload simultâneo em andamento (ver
                    # _download_and_upload_concurrently) — mostra os dois
                    # progressos, já que não são mais fases sequenciais.
                    upload_total = item.get('upload_total_bytes') or total
                    upload_pct = (uploaded / upload_total * 100) if upload_total else 0
                    text = (
                        f"📥⬆️ Baixando e enviando: {name}\n"
                        f"Baixado: {pct:.0f}% ({self._fmt_mb(cached)} / {self._fmt_mb(total)})\n"
                        f"Enviado: {upload_pct:.0f}% ({self._fmt_mb(uploaded)} / {self._fmt_mb(upload_total)})"
                    )
                else:
                    text = f"📥 Baixando: {name}\n{pct:.0f}% ({self._fmt_mb(cached)} / {self._fmt_mb(total)})"
            elif state == READY:
                text = f"⚙️ Processando: {name}..."
            elif state == UPLOADING:
                uploaded = item.get('uploaded_bytes') or 0
                total = item.get('upload_total_bytes') or item.get('size') or uploaded
                pct = (uploaded / total * 100) if total else 0
                text = f"📤 Enviando ao grupo: {name}\n{pct:.0f}% ({self._fmt_mb(uploaded)} / {self._fmt_mb(total)})"
            else:
                # Estado terminal (FORWARDED/ERROR/PAUSED): quem cuida da
                # mensagem final é _finalize_status_message, chamado no
                # finally de _download_to_cache.
                return

            await self._edit_status_message(msg_id, text)

    async def _finalize_status_message(self, msg_id):
        item = self.store.get(msg_id)
        if not item or not item.get('status_message_id'):
            return
        state = item.get('state')
        name = self._display_name(item)
        if state == FORWARDED:
            await self._delete_status_message(msg_id)
        elif state == ERROR:
            error = item.get('error') or 'erro desconhecido'
            await self._edit_status_message(msg_id, f"❌ Falha ao processar: {name}\n{error}")
        elif state == PAUSED:
            await self._edit_status_message(msg_id, f"⏸️ Pausado: {name}")

    # ---------- Cache: download + reenvio ----------
    async def _download_media_resumable(self, msg, file_path, resume_from_bytes):
        """Como client.download_media, mas retoma de um byte específico
        (via client.iter_download, que o próprio Telethon documenta como
        apto a "pausing, resuming, etc.") quando há um cache parcial
        compatível — em vez de rebaixar tudo do zero."""
        if (
            resume_from_bytes
            and os.path.exists(file_path)
            and os.path.getsize(file_path) == resume_from_bytes
        ):
            logger.info("Retomando download de %s a partir do byte %d", file_path, resume_from_bytes)
            with open(file_path, 'ab') as f:
                async for chunk in self.client.iter_download(msg.media, offset=resume_from_bytes):
                    f.write(chunk)
        else:
            await self.client.download_media(msg, file=file_path)

    async def _download_then_upload_sequential(
            self, msg, msg_id, meta, target_group, file_path, resume_from_bytes, partial_remux_task,
    ):
        """Caminho de sempre: espera o download terminar 100% antes de
        começar o upload. Usado quando o tamanho final não é conhecido de
        antemão (protocolo de upload do Telegram precisa saber quantas
        partes esperar — ver _download_and_upload_concurrently)."""
        try:
            await asyncio.wait_for(
                self._download_media_resumable(msg, file_path, resume_from_bytes),
                timeout=_download_timeout_for(meta.get('size')),
            )
        finally:
            # Para de gerar novas prévias parciais antes de seguir — o
            # lock (não esse cancel) é quem garante que um ffmpeg em
            # andamento não colida com o remux final abaixo.
            partial_remux_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await partial_remux_task

        logger.info("Cache concluído: %s", file_path)

        self.store.set_state(msg_id, READY)
        await self._remux_if_needed(msg_id, file_path)

        self.store.set_state(msg_id, UPLOADING)
        description = self._display_name(meta)

        def on_upload_progress(current, total):
            self.store.update(msg_id, uploaded_bytes=current, upload_total_bytes=total)

        await self.client.send_file(
            target_group,
            file=file_path,
            caption=f"🎬 {description}",
            attributes=self._build_send_attributes(meta),
            progress_callback=on_upload_progress,
        )

    async def _download_and_upload_concurrently(
            self, msg, msg_id, meta, target_group, file_path, resume_from_bytes, partial_remux_task,
    ):
        """Baixa e reenvia ao grupo AO MESMO TEMPO, em vez de esperar o
        cache terminar 100% pra só então começar o upload — o tempo total
        passa a ser ~max(download, upload) em vez de ~download + upload,
        o que importa bastante quando o upload (limitado pela banda de
        SUBIDA da própria conexão residencial, tipicamente mais fraca que
        a de download) é o lado mais lento dos dois.

        O upload lê de _GrowingFileUploadStream, que vai bloqueando
        (fazendo polling) conforme alcança o que o download ainda não
        escreveu — funciona tanto pra um download do zero quanto pra uma
        retomada por offset (resume_from_bytes), já que o stream só se
        importa com a posição absoluta no arquivo, não com como ela foi
        preenchida.

        Se pausado no meio (cancelamento externo via pause_download), o
        próprio asyncio.gather propaga o cancelamento pras duas tasks
        (download e upload) simultaneamente — upload não tem como retomar
        de onde parou (limitação do próprio Telegram), então uma pausa
        aqui sempre significa reenviar do zero quando retomar depois."""
        total_size = meta['size']

        download_done = asyncio.Event()
        download_error = {}

        async def _run_download():
            try:
                await self._download_media_resumable(msg, file_path, resume_from_bytes)
            finally:
                download_done.set()

        download_task = asyncio.create_task(_run_download())

        def _capture_download_error(t):
            if not t.cancelled() and t.exception():
                download_error['exc'] = t.exception()

        download_task.add_done_callback(_capture_download_error)

        async def _finish_download_side():
            await download_task  # propaga erro/cancelamento, se houver
            partial_remux_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await partial_remux_task
            logger.info("Cache concluído (upload simultâneo em andamento): %s", file_path)
            self.store.set_state(msg_id, READY)
            await self._remux_if_needed(msg_id, file_path)
            self.store.set_state(msg_id, UPLOADING)

        finish_task = asyncio.create_task(_finish_download_side())

        stream = _GrowingFileUploadStream(file_path, total_size, download_done, download_error)
        description = self._display_name(meta)

        def on_upload_progress(current, total):
            self.store.update(msg_id, uploaded_bytes=current, upload_total_bytes=total)

        upload_task = asyncio.create_task(self.client.send_file(
            target_group,
            file=stream,
            file_size=total_size,
            caption=f"🎬 {description}",
            attributes=self._build_send_attributes(meta),
            progress_callback=on_upload_progress,
        ))

        try:
            await asyncio.gather(download_task, finish_task, upload_task)
        finally:
            for t in (download_task, finish_task, upload_task):
                if not t.done():
                    t.cancel()
            stream.close()

    async def _download_to_cache(self, msg, msg_id, meta, target_group, resume_from_bytes=0):
        ext = meta.get('ext', '.file')
        file_path = os.path.join(self.cache_dir, f"{msg_id}{ext}")
        link = f"{self.base_url}/stream/{msg_id}{ext}"
        total_size = meta.get('size')

        self.store.set_state(msg_id, CACHING)
        self.store.update(msg_id, pause_requested=False)  # limpa flag de uma pausa anterior, se houver
        partial_remux_task = asyncio.create_task(self._partial_remux_loop(msg, msg_id, file_path))
        await self._send_status_message(target_group, msg_id, meta)
        status_task = asyncio.create_task(self._status_message_loop(msg_id, file_path))

        try:
            try:
                # Só dá pra sobrepor download+upload quando o tamanho final
                # já é conhecido de antemão (o próprio Telegram informa isso
                # nos metadados) — o protocolo de upload do Telegram precisa
                # saber quantas partes esperar. Sem isso (raro — acontece
                # com alguns tipos de mídia sem essa informação), cai pro
                # caminho sequencial de sempre.
                if total_size:
                    logger.info("Baixando e enviando %s simultaneamente...", msg_id)
                    await asyncio.wait_for(
                        self._download_and_upload_concurrently(
                            msg, msg_id, meta, target_group, file_path, resume_from_bytes, partial_remux_task,
                        ),
                        timeout=_concurrent_timeout_for(total_size),
                    )
                else:
                    logger.info("Baixando %s para cache...", msg_id)
                    await self._download_then_upload_sequential(
                        msg, msg_id, meta, target_group, file_path, resume_from_bytes, partial_remux_task,
                    )

                # Não removemos o arquivo imediatamente: quem estiver assistindo
                # via /stream neste instante seria cortado no meio do vídeo.
                # A limpeza real acontece em _cleanup_stale_cache, baseada em
                # `retention_seconds` sem acesso recente via /stream.
                self.store.set_state(msg_id, FORWARDED)
                self.store.update(msg_id, forwarded_at=int(time.time()))
                logger.info("Arquivo enviado após cache: %s", link)
            except asyncio.TimeoutError:
                logger.error("Timeout baixando/enviando %s (sem concluir a tempo)", msg_id)
                self.store.set_state(msg_id, ERROR, error='timeout no download/envio')
                if os.path.exists(file_path):
                    os.remove(file_path)
            except Exception as e:
                logger.exception("Erro no cache/envio de %s", msg_id)
                self.store.set_state(msg_id, ERROR, error=str(e))
                if os.path.exists(file_path):
                    os.remove(file_path)
        finally:
            status_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await status_task

            # asyncio.CancelledError (BaseException, não Exception) passa
            # direto pelos excepts acima sem ser tratado — chega até aqui
            # quando alguém chamou pause_download/delete_media. Quem pediu
            # a pausa já marcou pause_requested ANTES de cancelar; quem
            # pediu delete cuida da limpeza ele mesmo, depois desse finally.
            item = self.store.get(msg_id)
            if item and item.get('pause_requested'):
                self.store.set_state(msg_id, PAUSED)
                self.store.update(msg_id, pause_requested=False)
                await self._edit_status_message(msg_id, f"⏸️ Pausado: {self._display_name(item)}")
            else:
                await self._finalize_status_message(msg_id)

    # ---------- Controles do usuário via web (pausar/retomar/excluir) ----------
    async def pause_download(self, msg_id):
        """Pausa um download ou upload em andamento. O cache parcial
        (download) é preservado — resume_download continua de onde parou
        pelo byte exato. Upload pausado não tem como retomar de onde
        parou (o protocolo do Telegram não permite); resume_download
        reenvia do zero, mas sem precisar rebaixar (o arquivo já está
        completo em cache nesse ponto)."""
        msg_id = str(msg_id)
        task = self._active_tasks.get(msg_id)
        item = self.store.get(msg_id)
        if not task or not item or item.get('state') not in (CACHING, UPLOADING):
            return False

        self.store.update(msg_id, pause_requested=True)
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
        return True

    async def resume_download(self, msg_id):
        """Retoma um item pausado — refaz o fetch da mensagem original no
        Telegram (mesmo padrão de _reconcile_orphaned_downloads) e
        reinicia _download_to_cache, aproveitando o cache parcial se
        ainda existir (retomada real do download, ver
        _download_media_resumable)."""
        msg_id = str(msg_id)
        item = self.store.get(msg_id)
        if not item or item.get('state') != PAUSED:
            return False

        chat_id = item.get('chat_id')
        fetched = None
        if chat_id:
            try:
                fetched = await self.client.get_messages(chat_id, ids=int(msg_id))
            except Exception:
                logger.exception("Falha ao reobter mensagem %s pra retomar", msg_id)

        if not fetched or not fetched.media:
            self.store.set_state(
                msg_id, ERROR, error='mensagem original não pôde ser recuperada pra retomar',
            )
            return False

        _, target_group = config.get_forward_ids(self.cfg)
        ext = item.get('ext', '')
        file_path = os.path.join(self.cache_dir, f"{msg_id}{ext}")
        resume_from = os.path.getsize(file_path) if os.path.exists(file_path) else 0

        logger.info("Retomando %s (a partir de %d bytes)", msg_id, resume_from)
        self._spawn_download_task(fetched, int(msg_id), item, target_group, resume_from_bytes=resume_from)
        return True

    async def delete_media(self, msg_id):
        """Cancela qualquer download/upload em andamento, apaga o cache
        local (original + remux) e a mensagem de status, e remove o item
        do store — some da página web e não é mais processado."""
        msg_id = str(msg_id)
        task = self._active_tasks.get(msg_id)
        if task:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

        item = self.store.get(msg_id)
        if item:
            ext = item.get('ext', '')
            path = os.path.join(self.cache_dir, f"{msg_id}{ext}")
            if os.path.exists(path):
                os.remove(path)
            self._remove_remux(msg_id, item)
            await self._delete_status_message(msg_id)

        self.store.purge(msg_id)
        logger.info("Mídia %s excluída a pedido do usuário", msg_id)
        return True

    def _get_remux_lock(self, msg_id):
        lock = self._remux_locks.get(msg_id)
        if lock is None:
            lock = asyncio.Lock()
            self._remux_locks[msg_id] = lock
        return lock

    async def _remux_if_needed(self, msg_id, file_path):
        """Remuxa (sem recodificar) pra garantir reprodução no navegador,
        em dois cenários possíveis:
        - Matroska rotulado como .mp4 (comum em bots de rip) — <video> não
          decodifica de forma alguma.
        - MP4 de verdade, mas com moov longe do início (moov no final,
          comum em arquivos sem faststart) — servido via Range com
          Content-Length limitado ao que existe em disco, o navegador
          nunca fica sabendo que há mais conteúdo pra buscar no final e
          desiste achando que não há vídeo decodificável.
        Falha aqui NUNCA deve impedir o reenvio do arquivo original: só
        afeta a prévia no player web."""
        if not self.can_remux:
            return
        try:
            if not remux.needs_remux(file_path):
                return
            web_path = file_path + '.web.mp4'
            logger.info("Remuxando %s (garantindo moov no início) para o player web...", msg_id)
            async with self._get_remux_lock(msg_id):
                await asyncio.get_running_loop().run_in_executor(None, remux.remux_to_mp4, file_path, web_path)
            self.store.update(
                msg_id, remuxed_ext='.web.mp4', remuxed_up_to_bytes=os.path.getsize(file_path),
            )
            logger.info("Remux concluído: %s", web_path)
        except Exception:
            logger.exception("Falha ao remuxar %s para o player web; original será enviado normalmente", msg_id)
        finally:
            self._remux_locks.pop(msg_id, None)

    async def _partial_remux_loop(self, msg, msg_id, file_path):
        """Enquanto o download ainda está em andamento, gera
        periodicamente uma prévia web parcial — remux de uma cópia
        congelada do que já existe em disco — pra dar pra assistir no
        navegador sem esperar o download terminar. Cada rodada substitui
        a prévia anterior pela mesma (mais completa); o remux final, em
        _remux_if_needed, sobrescreve por cima quando o download acaba.

        Pra um MP4 de verdade com moov no final (ver needs_remux), o
        truque acima não basta — ffmpeg não consegue demux sem o moov, que
        só chegaria pelo download sequencial perto do fim. Nesse caso,
        _try_fetch_moov_tail busca o moov fora de ordem por offset (uma
        vez só, cacheado em disco) e, quando dá certo, as prévias parciais
        passam a usar remux.assemble_sparse_preview_source + remux com o
        moov real — cobrindo o prefixo já baixado normalmente. Quando o
        layout do arquivo não bate com o padrão simples esperado, ou a
        busca falha, essa técnica simplesmente não se aplica: sem prévia
        parcial nesse caso, mas o remux final ainda garante que fique
        reproduzível assim que o download terminar."""
        if not self.can_remux:
            return

        web_path = file_path + '.web.mp4'
        last_remuxed_size = 0
        while True:
            await asyncio.sleep(PARTIAL_REMUX_INTERVAL_SECONDS)

            item = self.store.get(msg_id)
            if not item or item.get('state') != CACHING:
                return
            if not os.path.exists(file_path) or not remux.needs_remux(file_path):
                return

            current_size = os.path.getsize(file_path)
            if current_size - last_remuxed_size < PARTIAL_REMUX_MIN_NEW_BYTES:
                continue

            moov_tail = None
            if not remux.is_matroska(file_path):
                total_size = item.get('size')
                if total_size and total_size <= MOOV_TAIL_MAX_TOTAL_SIZE:
                    await self._try_fetch_moov_tail(msg, file_path)
                moov_tail = self._read_moov_tail(file_path)
                if moov_tail is None:
                    # Nem o moov real chegou (ainda buscando/indisponível)
                    # nem faz sentido tentar o truque simples de
                    # remux_partial_to_mp4 — sem moov em lugar nenhum
                    # acessível, ffmpeg só falharia com "moov atom not
                    # found" de novo, como já visto nos logs.
                    continue

            try:
                async with self._get_remux_lock(msg_id):
                    if moov_tail is not None:
                        moov_offset, moov_bytes = moov_tail
                        await asyncio.get_running_loop().run_in_executor(
                            None, remux.remux_partial_with_moov_tail_to_mp4,
                            file_path, web_path, current_size, moov_offset, moov_bytes,
                        )
                    else:
                        await asyncio.get_running_loop().run_in_executor(
                            None, remux.remux_partial_to_mp4, file_path, web_path, current_size,
                        )
                last_remuxed_size = current_size
                self.store.update(msg_id, remuxed_ext='.web.mp4', remuxed_up_to_bytes=current_size)
                logger.info("Prévia web parcial atualizada: %s (%d bytes remuxados)", msg_id, current_size)
            except Exception:
                logger.exception("Falha ao gerar prévia parcial remuxada de %s", msg_id)

    async def _try_fetch_moov_tail(self, msg, file_path):
        """Busca o box 'moov' fora de ordem (por offset), pra viabilizar
        prévia parcial de um MP4 sem faststart antes do download alcançar
        onde ele realmente está (tipicamente perto do fim). Só tenta uma
        vez por download: o resultado (encontrado ou não) é cacheado num
        arquivo lateral, pra não repetir esse round-trip com o Telegram a
        cada ciclo de _partial_remux_loop. Qualquer falha, ou layout que
        não bata com o padrão simples esperado (ver
        remux.find_moov_expected_offset), faz esse método desistir
        silenciosamente — sem prévia parcial nesse caso, sem afetar o
        download normal nem o remux final."""
        tail_path = file_path + '.moov_tail'
        absent_path = file_path + '.moov_tail.absent'
        if os.path.exists(tail_path) or os.path.exists(absent_path):
            return

        moov_offset = remux.find_moov_expected_offset(file_path)
        if moov_offset is None:
            return

        try:
            header = b''
            stream = self.client.iter_download(msg.media, offset=moov_offset, request_size=16)
            async for chunk in stream:
                header += bytes(chunk)
                if len(header) >= 16:
                    break
            await stream.close()
        except Exception:
            logger.exception("Falha ao buscar cabeçalho do moov adiantado de %s", os.path.basename(file_path))
            return

        if len(header) < 8:
            return
        size = int.from_bytes(header[0:4], 'big')
        fourcc = header[4:8]
        if fourcc != b'moov' or size <= 8 or size > MOOV_TAIL_MAX_BYTES:
            # Offset calculado não bateu com um moov de verdade (ou veio
            # maior do que o razoável) — não insiste a cada ciclo.
            open(absent_path, 'wb').close()
            return

        try:
            moov_bytes = bytearray()
            stream = self.client.iter_download(msg.media, offset=moov_offset, request_size=min(size, 1024 * 1024))
            async for chunk in stream:
                moov_bytes.extend(chunk)
                if len(moov_bytes) >= size:
                    break
            await stream.close()
        except Exception:
            logger.exception("Falha ao buscar moov adiantado de %s", os.path.basename(file_path))
            return

        if len(moov_bytes) < size:
            return

        tmp_path = tail_path + '.tmp'
        with open(tmp_path, 'wb') as f:
            f.write(struct.pack('>Q', moov_offset))
            f.write(bytes(moov_bytes[:size]))
        os.replace(tmp_path, tail_path)
        logger.info(
            "Moov adiantado obtido para %s (offset %d, %d bytes) — prévia parcial liberada",
            os.path.basename(file_path), moov_offset, size,
        )

    @staticmethod
    def _read_moov_tail(file_path):
        try:
            with open(file_path + '.moov_tail', 'rb') as f:
                data = f.read()
        except OSError:
            return None
        if len(data) < 9:
            return None
        moov_offset = struct.unpack('>Q', data[:8])[0]
        return moov_offset, data[8:]

    async def _reconcile_orphaned_downloads(self):
        """Roda uma vez na inicialização: qualquer item ainda em
        RECEIVED/CACHING é sobra de um processo anterior que caiu no meio
        do download. Descarta o parcial e reinicia do zero (refazendo o
        fetch da mensagem original no Telegram), em vez de tentar retomar
        por offset."""
        _, target_group = config.get_forward_ids(self.cfg)

        for msg_id, item in self.store.list().items():
            if item.get('state') not in (RECEIVED, CACHING):
                continue

            path = os.path.join(self.cache_dir, f"{msg_id}{item.get('ext', '')}")
            if os.path.exists(path):
                os.remove(path)
            self._remove_remux(msg_id, item)
            logger.warning("Cache parcial órfão descartado: %s", msg_id)

            chat_id = item.get('chat_id')
            fetched = None
            if chat_id:
                try:
                    fetched = await self.client.get_messages(chat_id, ids=int(msg_id))
                except Exception:
                    logger.exception("Falha ao reobter mensagem órfã %s", msg_id)

            if fetched and fetched.media:
                logger.info("Reiniciando download órfão do zero: %s", msg_id)
                asyncio.create_task(self._download_to_cache(fetched, int(msg_id), item, target_group))
            else:
                logger.warning("Mensagem órfã %s não pôde ser recuperada no Telegram; descartando.", msg_id)
                self.store.set_state(
                    msg_id, ERROR,
                    error='download interrompido por reinício; mensagem original não pôde ser recuperada',
                )

    async def _periodic_cleanup_loop(self):
        """Roda em segundo plano, independente de mensagens chegarem do
        bot — sem isso, um item já enviado só era limpo quando a PRÓXIMA
        mensagem aparecesse (podia nunca acontecer)."""
        while True:
            await asyncio.sleep(CLEANUP_INTERVAL_SECONDS)
            try:
                self._cleanup_stale_cache()
            except Exception:
                logger.exception("Erro na varredura periódica de cache expirado")

    def _cleanup_stale_cache(self):
        for msg_id in self.store.find_stale_forwarded(self.retention_seconds):
            item = self.store.get(msg_id)
            if not item:
                continue
            path = os.path.join(self.cache_dir, f"{msg_id}{item.get('ext', '')}")
            if os.path.exists(path):
                os.remove(path)
            self._remove_remux(msg_id, item)
            self.store.purge(msg_id)
            logger.info("Cache expirado removido: %s", msg_id)

    def _remove_remux(self, msg_id, item):
        ext = item.get('ext', '')
        file_path = os.path.join(self.cache_dir, f"{msg_id}{ext}")
        for side_suffix in ('.moov_tail', '.moov_tail.absent'):
            side_path = file_path + side_suffix
            if os.path.exists(side_path):
                os.remove(side_path)

        remuxed_ext = item.get('remuxed_ext')
        if not remuxed_ext:
            return
        web_path = f"{file_path}{remuxed_ext}"
        if os.path.exists(web_path):
            os.remove(web_path)

    # ---------- Extração de metadados ----------
    def _extract_media_meta(self, msg):
        """Extrai metadados de uma mensagem com mídia:
            - name, ext  (nome do arquivo / extensão)
            - size       (bytes, se conhecido)
            - mime       (tipo MIME)
            - duration   (segundos, apenas para vídeos, se disponível)
            - caption    (legenda/descrição da mensagem original, se houver)
            - ts         (timestamp de captura)
            - chat_id    (chat onde a mensagem foi recebida)
        """
        media = msg.media
        name = None
        size = None
        mime = None
        duration = None
        supports_streaming = None
        width = None
        height = None

        if hasattr(media, 'document'):
            doc = media.document
            size = doc.size
            mime = doc.mime_type
            for attr in doc.attributes:
                if hasattr(attr, 'file_name') and attr.file_name:
                    name = attr.file_name
                if isinstance(attr, DocumentAttributeVideo):
                    duration = attr.duration
                    supports_streaming = attr.supports_streaming
                    width = attr.w
                    height = attr.h
        elif hasattr(media, 'photo'):
            mime = 'image/jpeg'
            name = f"photo_{media.photo.id}.jpg"

        name = name or f"media_{msg.id}"
        ext = os.path.splitext(name)[1]
        if not ext:
            # Sem DocumentAttributeFilename (acontece — alguns uploads só
            # trazem DocumentAttributeVideo), tenta derivar uma extensão
            # real a partir do mime_type já conhecido, em vez de cair
            # direto no genérico ".file".
            guessed = mimetypes.guess_extension(mime) if mime and mime != 'application/octet-stream' else None
            ext = guessed or '.file'
            name = f"{name}{ext}"

        return {
            'name': name,
            'ext': ext,
            'size': size,
            'mime': mime or 'application/octet-stream',
            'duration': duration,
            # Sinal do próprio Telegram: indica se o arquivo já está
            # estruturado (moov atom) para permitir seek antes do download
            # completo. Usado pelo player como dica, nunca como garantia —
            # a decisão final de permitir seek é do que o navegador reporta.
            'supports_streaming': supports_streaming,
            'width': width,
            'height': height,
            'caption': msg.raw_text or None,
            'ts': int(time.time()),
            'chat_id': msg.chat_id,
        }

    # ---------- Helpers para o proxy ----------
    def get_media_info(self, message_id):
        """Retorna os metadados + estado salvos para um msg_id ou None."""
        return self.store.get(message_id)

    def mark_streamed(self, message_id):
        self.store.mark_streamed(message_id)

    def list_media(self):
        """Lista metadados para a página web (mais recentes primeiro)."""
        items = []
        for msg_id, info in sorted(self.store.list().items(), key=lambda x: x[1].get('ts', 0), reverse=True):
            items.append({
                'id': msg_id,
                'ext': info.get('ext', ''),
                'name': info.get('name'),
                'caption': info.get('caption'),
                'size': info.get('size'),
                'mime': info.get('mime'),
                'ts': info.get('ts'),
                'state': info.get('state'),
                'duration': info.get('duration'),
                'supports_streaming': info.get('supports_streaming'),
                'error': info.get('error'),
            })
        return items
