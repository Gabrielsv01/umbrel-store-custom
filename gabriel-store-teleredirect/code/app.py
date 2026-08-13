import os
import time
import asyncio
import logging
import mimetypes
from flask import Flask, Response, request, render_template, jsonify, stream_with_context, redirect, url_for
import config

# Configurado aqui (o entrypoint de verdade, seja `python app.py`, `uv run`
# ou gunicorn `app:app`) e não em bot_manager.py — assim cobre também os
# próprios logs do Flask/Werkzeug (ex.: traceback de um 500), não só o
# BotManager. Um único arquivo + stdout: dá pra consultar via /api/logs ou
# via `docker logs`, sem precisar acessar o disco do host.
LOG_PATH = os.path.join(config.DATA_PATH, 'bot_activity.log')
_log_formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(name)s - %(message)s')
_file_handler = logging.FileHandler(LOG_PATH)
_file_handler.setFormatter(_log_formatter)
_stream_handler = logging.StreamHandler()
_stream_handler.setFormatter(_log_formatter)
logging.basicConfig(level=logging.INFO, handlers=[_file_handler, _stream_handler])

from telethon import TelegramClient
from telethon.sessions import StringSession
from telethon.errors import SessionPasswordNeededError
from bot_manager import BotManager
import remux

app = Flask(__name__)

CACHE_DIR = os.path.join(config.DATA_PATH, 'cache')
SESSION_PATH = os.path.join(config.DATA_PATH, 'string.session')

# Máximo de bytes lidos do FINAL do arquivo de log — evita carregar um log
# gigante inteiro na memória; suficiente pra várias milhares de linhas.
MAX_LOG_TAIL_BYTES = 2 * 1024 * 1024


def _has_saved_session():
    return os.path.exists(SESSION_PATH) and os.path.getsize(SESSION_PATH) > 0


# Sem sessão salva, não faz sentido tentar conectar o BotManager ainda —
# a própria página raiz mostra o fluxo de login (ver rotas /login/*) até
# uma sessão existir; só então o BotManager de verdade é criado.
bot_manager = BotManager() if _has_saved_session() else None

# ---------------------------------------------------------------
# Login web (telefone -> código -> senha 2FA se houver), embutido na
# mesma aplicação — evita precisar rodar um servidor separado só pra
# gerar a sessão antes de usar o resto do app.
# ---------------------------------------------------------------
LOGIN_PATHS = {'/login', '/login/send_code', '/login/sign_in', '/login/password'}

_login_state = {'client': None, 'phone': None}
_login_loop = asyncio.new_event_loop()


@app.before_request
def _require_session():
    if bot_manager is not None:
        return None
    # /api/logs não depende do BotManager (só lê um arquivo) — liberado sem
    # sessão de propósito, pra poder diagnosticar problemas no próprio
    # login/setup (ex.: o 500 de config inválida que esse endpoint existe
    # justamente pra investigar).
    if request.path in LOGIN_PATHS or request.path == '/api/logs' or request.path.startswith('/static'):
        return None
    return redirect(url_for('login_index'))


def _login_run(coro):
    return _login_loop.run_until_complete(coro)


def _new_login_client():
    cfg = config.load_config()
    api_id, api_hash = config.get_telethon_credentials(cfg)
    return TelegramClient(StringSession(), api_id, api_hash, loop=_login_loop)


@app.route('/login', methods=['GET'])
def login_index():
    if bot_manager is not None:
        return redirect(url_for('index'))
    return render_template('login.html', step='phone')


@app.route('/login/send_code', methods=['POST'])
def login_send_code():
    phone = request.form.get('phone', '').strip()
    if not phone:
        return render_template('login.html', step='phone', error='Informe o telefone.')

    try:
        client = _new_login_client()
        _login_run(client.connect())
        _login_run(client.send_code_request(phone))
    except Exception as e:
        app.logger.exception('Falha ao enviar código de login')
        return render_template('login.html', step='phone', error=f'Falha ao enviar o código: {e}')

    _login_state['client'] = client
    _login_state['phone'] = phone
    return render_template('login.html', step='code')


@app.route('/login/sign_in', methods=['POST'])
def login_sign_in():
    client = _login_state.get('client')
    if not client:
        return redirect(url_for('login_index'))

    code = request.form.get('code', '').strip()
    try:
        _login_run(client.sign_in(phone=_login_state['phone'], code=code))
    except SessionPasswordNeededError:
        return render_template('login.html', step='password')
    except Exception as e:
        app.logger.exception('Falha ao validar código de login')
        return render_template('login.html', step='code', error=f'Código inválido ou expirado: {e}')

    return _finish_login(client)


@app.route('/login/password', methods=['POST'])
def login_password():
    client = _login_state.get('client')
    if not client:
        return redirect(url_for('login_index'))

    pwd = request.form.get('password', '')
    try:
        _login_run(client.sign_in(password=pwd))
    except Exception as e:
        app.logger.exception('Falha ao validar senha 2FA de login')
        return render_template('login.html', step='password', error=f'Senha incorreta: {e}')

    return _finish_login(client)


def _finish_login(client):
    global bot_manager
    session_str = client.session.save()
    with open(SESSION_PATH, 'w') as f:
        f.write(session_str)
    # client.disconnect() não é uma coroutine normal: se o loop não
    # estiver rodando (nosso caso aqui), ela mesma chama run_until_complete
    # internamente e retorna None — por isso NÃO se envolve com
    # _login_run(...) (isso já causou um bug real: "coroutine or an
    # awaitable is required").
    client.disconnect()
    _login_state['client'] = None
    _login_state['phone'] = None

    bot_manager = BotManager()  # a sessão já existe em disco agora
    return redirect(url_for('index'))

# Quanto tempo (s), no máximo, esperamos por um byte que ainda não existe em
# disco antes de responder 503. O player intercepta seeks do usuário do
# lado do cliente (nunca deveriam chegar aqui pedindo além do cache), mas
# o PRÓPRIO NAVEGADOR pode fazer prefetch/buffering interno adiantado sem
# disparar nenhum evento visível pro nosso JS — um 503 nessa hora costuma
# ser tratado como erro fatal de rede pelo <video> (fica "quebrado").
# Como o download está ativamente em andamento, vale mais esperar bastante
# antes de desistir do que falhar rápido.
WAIT_FOR_BYTE_TIMEOUT = 30
WAIT_POLL_INTERVAL = 0.2


# ---------------------------------------------------------------
# Página inicial: lista as mídias salvas (só metadados)
# ---------------------------------------------------------------
@app.route('/')
def index():
    items = bot_manager.list_media()
    return render_template('index.html', items=items)


@app.route('/api/media')
def api_media():
    return jsonify(bot_manager.list_media())


# ---------------------------------------------------------------
# Controles do usuário: pausar/retomar/excluir. bot_manager roda essas
# corrotinas no event loop dedicado dele (thread própria do Telethon) via
# run_coroutine_threadsafe, já que a rota Flask em si não é async.
# ---------------------------------------------------------------
def _run_on_bot_loop(coro, timeout=30):
    future = asyncio.run_coroutine_threadsafe(coro, bot_manager.loop)
    return future.result(timeout=timeout)


@app.route('/api/media/<msg_id>/pause', methods=['POST'])
def api_pause_media(msg_id):
    try:
        ok = _run_on_bot_loop(bot_manager.pause_download(msg_id))
    except Exception:
        app.logger.exception('Falha ao pausar %s', msg_id)
        return jsonify({'ok': False, 'error': 'falha ao pausar (timeout ou erro interno)'}), 500
    return jsonify({'ok': ok})


@app.route('/api/media/<msg_id>/resume', methods=['POST'])
def api_resume_media(msg_id):
    try:
        ok = _run_on_bot_loop(bot_manager.resume_download(msg_id))
    except Exception:
        app.logger.exception('Falha ao retomar %s', msg_id)
        return jsonify({'ok': False, 'error': 'falha ao retomar (timeout ou erro interno)'}), 500
    return jsonify({'ok': ok})


@app.route('/api/media/<msg_id>', methods=['DELETE'])
def api_delete_media(msg_id):
    try:
        ok = _run_on_bot_loop(bot_manager.delete_media(msg_id))
    except Exception:
        app.logger.exception('Falha ao excluir %s', msg_id)
        return jsonify({'ok': False, 'error': 'falha ao excluir (timeout ou erro interno)'}), 500
    return jsonify({'ok': ok})


# ---------------------------------------------------------------
# Diagnóstico somente-leitura: confirma se o remux (ffmpeg) está
# disponível neste host, sem precisar de acesso SSH/logs pra verificar.
# ---------------------------------------------------------------
@app.route('/api/diagnostics')
def api_diagnostics():
    return jsonify({
        'can_remux': bot_manager.can_remux,
        'ffmpeg_path': remux._ffmpeg_binary(),
    })


# ---------------------------------------------------------------
# Cauda do log (BotManager + Flask/Werkzeug, ver configuração de logging
# no topo do arquivo), pra diagnosticar sem precisar de `docker logs`/SSH.
# ?lines=N controla quantas linhas (padrão 200, máx. 5000).
# ---------------------------------------------------------------
@app.route('/api/logs')
def api_logs():
    try:
        wanted_lines = int(request.args.get('lines', 200))
    except (TypeError, ValueError):
        wanted_lines = 200
    wanted_lines = max(1, min(wanted_lines, 5000))

    if not os.path.exists(LOG_PATH):
        return Response('', mimetype='text/plain')

    with open(LOG_PATH, 'rb') as f:
        f.seek(0, os.SEEK_END)
        size = f.tell()
        f.seek(max(0, size - MAX_LOG_TAIL_BYTES))
        data = f.read()

    text_lines = data.decode('utf-8', errors='replace').splitlines()
    tail = text_lines[-wanted_lines:]
    return Response('\n'.join(tail) + '\n', mimetype='text/plain')


# ---------------------------------------------------------------
# Progresso de cache de uma mídia: usado pelo player para saber até onde
# pode buscar/seekar com segurança.
# ---------------------------------------------------------------
@app.route('/api/media/<msg_id>/progress')
def api_media_progress(msg_id):
    info = bot_manager.get_media_info(msg_id)
    if not info:
        return jsonify({'error': 'not_found'}), 404

    cache_path = os.path.join(CACHE_DIR, f"{msg_id}{info.get('ext', '')}")
    cached_bytes = os.path.getsize(cache_path) if os.path.exists(cache_path) else 0

    # web_playable considera os dois motivos de precisar de remux (ver
    # remux.needs_remux): Matroska rotulado como .mp4, ou MP4 de verdade
    # com moov no final. `container` só reporta especificamente
    # 'matroska' quando é esse o caso — usado pelo player só pra decidir
    # se confia no video.seekable nativo ou numa estimativa por bytes.
    file_exists = os.path.exists(cache_path)
    needs_remux = file_exists and remux.needs_remux(cache_path)
    web_playable = (not needs_remux) or bool(info.get('remuxed_ext'))
    is_matroska = file_exists and remux.is_matroska(cache_path)

    return jsonify({
        'state': info.get('state'),
        'total_bytes': info.get('size'),
        'cached_bytes': cached_bytes,
        'duration': info.get('duration'),
        'supports_streaming': info.get('supports_streaming'),
        'web_playable': web_playable,
        'container': 'matroska' if is_matroska else None,
        # Quantos bytes da fonte crua o remux atualmente servido (.web.mp4)
        # de fato cobre — usado pelo player pra saber quando uma versão
        # mais completa já existe e vale a pena recarregar a fonte.
        'remuxed_up_to_bytes': info.get('remuxed_up_to_bytes'),
        # Progresso do reenvio ao grupo do Telegram (depois que o cache já
        # terminou) — via progress_callback do Telethon.
        'uploaded_bytes': info.get('uploaded_bytes'),
        'upload_total_bytes': info.get('upload_total_bytes'),
        'error': info.get('error'),
    })


def _wait_for_bytes(cache_path, needed_size, timeout=WAIT_FOR_BYTE_TIMEOUT):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if os.path.exists(cache_path) and os.path.getsize(cache_path) >= needed_size:
            return True
        time.sleep(WAIT_POLL_INTERVAL)
    return os.path.exists(cache_path) and os.path.getsize(cache_path) >= needed_size


# ---------------------------------------------------------------
# Proxy de stream: não baixa o arquivo inteiro de novo, serve direto do
# cache local com suporte a Range requests (seek/play/pause no player).
#
# Cada resposta promete, no Content-Length, exatamente os bytes que já
# existem em disco NESTE instante — nunca mais. Se o player quiser mais,
# ele faz naturalmente um novo Range request, como em qualquer streaming
# HTTP progressivo. Isso evita a resposta anterior, que ficava fazendo
# polling dentro do próprio generator e podia enviar mais bytes do que o
# Content-Length declarado.
# ---------------------------------------------------------------
@app.route('/stream/<path:filename>', methods=['GET', 'HEAD'])
def stream(filename):
    msg_id = os.path.splitext(filename)[0]
    info = bot_manager.get_media_info(msg_id)
    if not info:
        return 'Mídia não encontrada', 404

    raw_path = os.path.join(CACHE_DIR, filename)

    # Se o arquivo original for Matroska remuxado (ver bot_manager.py), o
    # navegador precisa do MP4 resultante — o original ainda existe em
    # disco (foi reenviado ao grupo como está), mas não é usado aqui.
    remuxed_ext = info.get('remuxed_ext')
    safe_cap = None
    if remuxed_ext and os.path.exists(raw_path + remuxed_ext):
        cache_path = raw_path + remuxed_ext
        mime_type = 'video/mp4'
        # Teto de segurança: quantos bytes da fonte crua essa versão
        # remuxada de fato cobre. Pra MP4 sem faststart cujo moov foi
        # buscado fora de ordem (ver bot_manager._try_fetch_moov_tail), o
        # .web.mp4 resultante tem tamanho em disco próximo do arquivo
        # TOTAL — o trecho ainda não baixado sai preenchido com zeros no
        # remux (ver remux.assemble_sparse_preview_source) — mesmo que só
        # uma fração seja conteúdo real. Sem esse teto, o tamanho em disco
        # por si só mentiria sobre o que é de fato seguro servir.
        safe_cap = info.get('remuxed_up_to_bytes')
    else:
        cache_path = raw_path
        mime_type = info.get('mime') or mimetypes.guess_type(cache_path)[0] or 'application/octet-stream'

    range_header = request.headers.get('Range')
    start = 0
    if range_header:
        parts = range_header.replace('bytes=', '').split('-')
        start = int(parts[0]) if parts[0] else 0

    if safe_cap is not None and start >= safe_cap:
        bot_manager.mark_streamed(msg_id)
        resp = Response('Ainda baixando esse trecho, tente novamente em breve.', status=503)
        resp.headers['Retry-After'] = '2'
        return resp

    needed = start + 1
    if not _wait_for_bytes(cache_path, needed):
        bot_manager.mark_streamed(msg_id)
        resp = Response('Ainda baixando esse trecho, tente novamente em breve.', status=503)
        resp.headers['Retry-After'] = '2'
        return resp

    bot_manager.mark_streamed(msg_id)

    current_disk_size = os.path.getsize(cache_path)
    # O "tamanho total" que declaramos ao navegador (Content-Range) é
    # SEMPRE o que já existe em disco agora — nunca o tamanho final
    # esperado do arquivo original. A duração exibida no player vem do
    # moov do próprio arquivo, não daqui, então isso não afeta a barra de
    # progresso nativa. O que isso evita: se declarássemos o tamanho final
    # (ex.: 1.75GB) enquanto só uma fração existe, o navegador acredita
    # que pode buscar (via prefetch/buffering interno, fora do nosso
    # controle — não é algo que dá pra interceptar do lado do cliente)
    # qualquer trecho dentro desse tamanho "final", e um request assim
    # batendo além do cache real vira um 503 que o <video> trata como erro
    # fatal de rede. Quando mais cache existir, a PRÓXIMA resposta já
    # declara um total maior — o navegador lida bem com isso, é o mesmo
    # padrão de qualquer recurso HTTP que cresce (ex.: uma gravação ao
    # vivo ainda em andamento). `safe_cap` (quando presente) aplica o
    # mesmo princípio a um nível mais fino: mesmo com o arquivo servido já
    # tendo mais bytes em disco, nunca declaramos além do que de fato é
    # conteúdo real (ver acima).
    total_size = current_disk_size if safe_cap is None else min(current_disk_size, safe_cap)

    end = total_size - 1
    if range_header:
        parts = range_header.replace('bytes=', '').split('-')
        if len(parts) > 1 and parts[1]:
            end = int(parts[1])

    actual_end = min(end, total_size - 1)
    chunk_size = actual_end - start + 1

    def generate():
        with open(cache_path, 'rb') as f:
            f.seek(start)
            remaining = chunk_size
            while remaining > 0:
                chunk = f.read(min(65536, remaining))
                if not chunk:
                    break
                remaining -= len(chunk)
                yield chunk

    headers = {
        'Content-Type': mime_type,
        'Accept-Ranges': 'bytes',
        'Content-Length': str(chunk_size),
        # Este recurso muda com o tempo (cache local crescendo, ou o
        # remux sendo substituído por uma versão maior) — o navegador
        # nunca deve reaproveitar uma resposta antiga pra essa URL.
        'Cache-Control': 'no-store',
    }

    if range_header:
        headers['Content-Range'] = f'bytes {start}-{actual_end}/{total_size}'
        return Response(stream_with_context(generate()), status=206, headers=headers)

    return Response(stream_with_context(generate()), headers=headers)


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.getenv('PORT', 5153)), debug=False, use_reloader=False, threaded=True)
