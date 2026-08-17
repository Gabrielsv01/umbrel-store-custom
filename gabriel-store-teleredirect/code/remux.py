import json
import os
import shutil
import subprocess

# Assinatura EBML: identifica Matroska/WebM. Muitos bots redistribuem rips
# em Matroska com extensão/mime_type de .mp4 — o <video> do navegador não
# consegue decodificar Matroska de forma alguma, independente de quanto já
# foi baixado, então isso precisa ser detectado e remuxado (não recodificado
# — os codecs internos, tipicamente H.264/AAC, já são nativos do navegador).
MATROSKA_MAGIC = b'\x1a\x45\xdf\xa3'


def is_matroska(path):
    try:
        with open(path, 'rb') as f:
            return f.read(4) == MATROSKA_MAGIC
    except OSError:
        return False


def mp4_moov_near_front(path, probe_bytes=8 * 1024 * 1024):
    """Verifica se o box 'moov' de um MP4 aparece nos primeiros
    `probe_bytes` do arquivo (faststart). Quando não está — muito comum
    em arquivos não processados especificamente pra streaming, moov fica
    no FINAL —, o navegador não consegue nem começar a decodificar
    enquanto o download não estiver praticamente completo, e servido via
    Range com Content-Length limitado ao que já existe em disco, ele nem
    fica sabendo que há mais conteúdo pra buscar no final."""
    try:
        with open(path, 'rb') as f:
            data = f.read(probe_bytes)
    except OSError:
        return False

    pos = 0
    while pos + 8 <= len(data):
        size = int.from_bytes(data[pos:pos + 4], 'big')
        fourcc = data[pos + 4:pos + 8]
        if fourcc == b'moov':
            return True
        if fourcc == b'mdat':
            # mdat costuma ser o maior box e vem ANTES do moov quando
            # este está no final — achar mdat sem moov antes já indica
            # que moov não está por perto.
            return False
        if size in (0, 1):
            # Tamanho especial (até o fim do arquivo, ou 64 bits) — não
            # dá pra avançar com segurança a partir daqui.
            return False
        pos += size
    return False


def needs_remux(path):
    """Decide se vale a pena remuxar pra garantir reprodução no
    navegador, cobrindo os dois motivos possíveis:
    - Matroska rotulado como .mp4 (não decodifica em <video> de forma
      alguma, independente de posição de nenhum box).
    - MP4 de verdade, mas com moov longe do início (moov no final)."""
    if is_matroska(path):
        return True
    return not mp4_moov_near_front(path)


def _static_ffmpeg_paths():
    """Busca os binários de ffmpeg E ffprobe via static-ffmpeg (escopado ao
    venv do projeto, sem depender de instalação no sistema/apt-get). A
    primeira chamada baixa um zip da plataforma atual; static-ffmpeg
    mesmo faz o cache em disco (dentro do próprio pacote), então chamadas
    seguintes são instantâneas. Em produção (Docker), esse download roda
    no BUILD da imagem (ver Dockerfile), nunca em runtime — o container
    nunca depende de rede pra ter ffmpeg/ffprobe disponíveis."""
    try:
        import static_ffmpeg.run
        return static_ffmpeg.run.get_or_fetch_platform_executables_else_raise()
    except Exception:
        return None, None


def _ffmpeg_binary():
    """Cai pro PATH do sistema se static-ffmpeg não estiver disponível ou
    falhar (ex.: plataforma sem build pré-compilado)."""
    ffmpeg_path, _ = _static_ffmpeg_paths()
    return ffmpeg_path or shutil.which('ffmpeg')


def _ffprobe_binary():
    _, ffprobe_path = _static_ffmpeg_paths()
    return ffprobe_path or shutil.which('ffprobe')


def ffmpeg_available():
    return _ffmpeg_binary() is not None


def ffprobe_available():
    return _ffprobe_binary() is not None


def remux_to_mp4(src_path, dst_path, timeout=300):
    """Remuxa (sem recodificar) `src_path` para MP4 em `dst_path`.

    Espera um arquivo de origem completo e estático (chamar só depois do
    download terminar). Escreve num arquivo temporário e só substitui o
    destino final se o ffmpeg terminar com sucesso, para nunca deixar um
    arquivo parcial/corrompido no lugar do remux."""
    ffmpeg_bin = _ffmpeg_binary()
    if not ffmpeg_bin:
        raise RuntimeError('ffmpeg não disponível (nem via static-ffmpeg, nem no PATH do sistema)')

    tmp_dst = dst_path + '.tmp'
    try:
        result = subprocess.run(
            [
                ffmpeg_bin, '-y', '-nostdin',
                '-i', src_path,
                '-c', 'copy',
                '-movflags', '+faststart',
                '-f', 'mp4',
                tmp_dst,
            ],
            capture_output=True,
            timeout=timeout,
        )
        if result.returncode != 0:
            stderr = result.stderr.decode(errors='replace')[-800:]
            raise RuntimeError(f"ffmpeg falhou (código {result.returncode}): {stderr}")
        os.replace(tmp_dst, dst_path)
    finally:
        if os.path.exists(tmp_dst):
            os.remove(tmp_dst)


def _iter_top_level_boxes(data, base_offset=0):
    """Percorre os boxes MP4 de nível superior contidos em `data`. Cada
    item é (fourcc, offset_absoluto, size) — size é None quando o box
    declara tamanho especial (0 = até o fim do arquivo)."""
    pos = 0
    while pos + 8 <= len(data):
        size = int.from_bytes(data[pos:pos + 4], 'big')
        fourcc = data[pos + 4:pos + 8]
        header_size = 8
        if size == 1:
            if pos + 16 > len(data):
                return
            size = int.from_bytes(data[pos + 8:pos + 16], 'big')
            header_size = 16
        if size == 0:
            yield (fourcc, base_offset + pos, None)
            return
        if size < header_size:
            return
        yield (fourcc, base_offset + pos, size)
        pos += size


def find_moov_expected_offset(path, probe_bytes=4 * 1024 * 1024):
    """Calcula onde o box 'moov' DEVERIA começar, para o layout mais comum
    quando ele está no final: ftyp -> [boxes pequenos] -> mdat -> moov.

    Retorna None sempre que o layout real não bate com esse padrão simples
    (moov já por perto, mdat com tamanho especial, ou qualquer outro box
    aparecendo depois do mdat antes de decidirmos) — nesses casos não vale
    a pena arriscar buscar no offset errado."""
    try:
        with open(path, 'rb') as f:
            data = f.read(probe_bytes)
    except OSError:
        return None

    found_mdat = False
    last_end = 0
    for fourcc, offset, size in _iter_top_level_boxes(data):
        if fourcc == b'moov':
            return None
        if fourcc == b'mdat':
            if size is None:
                return None
            found_mdat = True
            last_end = offset + size
            continue
        if found_mdat:
            return None
        if size is None:
            return None
        last_end = offset + size

    if not found_mdat:
        return None
    return last_end


def assemble_sparse_preview_source(src_path, dst_path, up_to_bytes, moov_offset, moov_bytes):
    """Monta um arquivo de origem 'esparso' para gerar uma prévia parcial
    de um MP4 sem faststart: prefixo real (o que já foi baixado) + buraco
    esparso (região ainda não baixada, sem custo real de disco em
    filesystems POSIX) + o moov de verdade, buscado fora de ordem, na sua
    posição absoluta correta. O ffmpeg então processa isso como se fosse
    o arquivo completo (amostras que caem no buraco saem zeradas/quebradas
    — inerente a uma prévia de download parcial, não um bug)."""
    prefix_len = min(up_to_bytes, moov_offset)
    total_size = moov_offset + len(moov_bytes)
    tmp_path = dst_path + '.tmp'
    try:
        with open(src_path, 'rb') as fin, open(tmp_path, 'wb') as fout:
            remaining = prefix_len
            while remaining > 0:
                chunk = fin.read(min(1024 * 1024, remaining))
                if not chunk:
                    break
                fout.write(chunk)
                remaining -= len(chunk)
            fout.truncate(total_size)
            fout.seek(moov_offset)
            fout.write(moov_bytes)
        os.replace(tmp_path, dst_path)
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


def _probe_packets_and_streams(path, timeout=60):
    """Roda ffprobe sobre `path` e devolve (packets, streams) já
    desserializados do JSON — usado por find_safe_cut_point_seconds pra
    decidir um corte seguro sem precisar reimplementar leitura de
    stco/stsz/stsc na mão (ffprobe já sabe interpretar o moov real)."""
    ffprobe_bin = _ffprobe_binary()
    if not ffprobe_bin:
        raise RuntimeError('ffprobe não disponível (nem via static-ffmpeg, nem no PATH do sistema)')

    result = subprocess.run(
        [
            ffprobe_bin, '-v', 'error', '-print_format', 'json',
            '-show_entries', 'stream=index,codec_type:packet=pts_time,pos,size,flags,stream_index',
            path,
        ],
        capture_output=True, timeout=timeout,
    )
    if result.returncode != 0:
        stderr = result.stderr.decode(errors='replace')[-800:]
        raise RuntimeError(f"ffprobe falhou (código {result.returncode}): {stderr}")

    data = json.loads(result.stdout)
    return data.get('packets', []), data.get('streams', [])


def find_safe_cut_point_seconds(assembled_path, up_to_bytes):
    """Acha o maior timestamp (segundos) de um keyframe de vídeo tal que
    TODOS os pacotes (de qualquer trilha) com pts <= esse tempo já estão
    inteiramente contidos nos primeiros `up_to_bytes` bytes do arquivo
    original — ou seja, um ponto de corte GARANTIDAMENTE seguro, sem a
    corrupção por "buraco esparso" que assemble_sparse_preview_source
    aceita pra prévia (lá é tolerável; aqui NÃO é, porque o resultado é
    reenviado definitivamente ao grupo do Telegram).

    `assembled_path` deve ser um arquivo com o moov real já na posição
    certa (ver assemble_sparse_preview_source) — ffprobe lê a tabela de
    amostras do moov pra saber a posição/tamanho de cada pacote sem
    precisar decodificar nenhum byte de mídia, então funciona mesmo com o
    conteúdo além de `up_to_bytes` ainda inexistente (zerado/esparso).

    Retorna None se não houver nenhum keyframe seguro ainda (ex.: nem o
    primeiro GOP terminou de baixar), se não houver trilha de vídeo, ou se
    algum pacote vier sem pts_time válido (nesse caso não dá pra garantir
    a ordem temporal com segurança — mais vale esperar mais bytes do que
    arriscar um corte incorreto)."""
    packets, streams = _probe_packets_and_streams(assembled_path)

    video_stream_indices = {s['index'] for s in streams if s.get('codec_type') == 'video'}
    if not video_stream_indices:
        return None

    parsed = []
    for p in packets:
        pts_time = p.get('pts_time')
        if pts_time in (None, 'N/A'):
            return None  # sem ordenação temporal confiável pra esse pacote — não arrisca.
        parsed.append({
            'pts_time': float(pts_time),
            'pos': int(p['pos']),
            'size': int(p['size']),
            'stream_index': p['stream_index'],
            'is_keyframe': p.get('flags', '').startswith('K'),
        })
    parsed.sort(key=lambda p: p['pts_time'])

    safe_time = None
    running_max_end = 0
    # Agrupa por pts_time (não só ordena) antes de decidir: dois pacotes de
    # trilhas diferentes podem empatar no mesmo instante (ex.: vídeo e
    # áudio), e todos os bytes desse instante — de QUALQUER trilha —
    # precisam estar cobertos antes de aceitar um keyframe naquele tempo
    # como seguro. Um sort simples (estável) processaria o keyframe de
    # vídeo ANTES do pacote de áudio empatado, aceitando o corte cedo
    # demais — já pego por teste (test_audio_packet_beyond_video_keyframe).
    i = 0
    while i < len(parsed):
        j = i
        has_safe_video_keyframe_in_group = False
        while j < len(parsed) and parsed[j]['pts_time'] == parsed[i]['pts_time']:
            p = parsed[j]
            running_max_end = max(running_max_end, p['pos'] + p['size'])
            if p['stream_index'] in video_stream_indices and p['is_keyframe']:
                has_safe_video_keyframe_in_group = True
            j += 1
        if has_safe_video_keyframe_in_group and running_max_end <= up_to_bytes:
            safe_time = parsed[i]['pts_time']
        i = j

    return safe_time


def remux_partial_with_moov_tail_to_mp4(src_path, dst_path, up_to_bytes, moov_offset, moov_bytes, timeout=300):
    """Como `remux_partial_to_mp4`, mas para um MP4 sem faststart cujo moov
    já foi obtido fora de ordem (ver assemble_sparse_preview_source) —
    monta o arquivo esparso com o moov na posição certa antes de remuxar,
    em vez de simplesmente truncar (que falharia com "moov atom not
    found", já que o moov real ainda não foi alcançado pelo download
    sequencial nesse ponto)."""
    snapshot_path = dst_path + '.src-snapshot'
    try:
        assemble_sparse_preview_source(src_path, snapshot_path, up_to_bytes, moov_offset, moov_bytes)
        remux_to_mp4(snapshot_path, dst_path, timeout=timeout)
    finally:
        if os.path.exists(snapshot_path):
            os.remove(snapshot_path)


def split_segment_to_mp4(src_path, dst_path, start_seconds, duration_seconds=None, timeout=300):
    """Extrai um trecho de `src_path` (a partir de `start_seconds`, por
    `duration_seconds` segundos — ou até o fim do arquivo, se None) para
    `dst_path` em MP4, sem recodificar (stream copy). Usado para dividir um
    vídeo maior que o limite de tamanho por mensagem do Telegram em partes
    menores antes do reenvio (ver BotManager._send_file_in_parts).

    `-ss` ANTES de `-i` é a única opção compatível com stream copy: sem
    reencodar, o ffmpeg só consegue cortar no keyframe mais próximo ANTES
    do tempo pedido — o início real de cada parte pode ficar um pouco antes
    do calculado, nunca depois. Isso é aceitável aqui (a precisão do corte
    não importa, só o tamanho final de cada parte), e é por isso que quem
    chama esta função já aplica uma margem de segurança no tamanho-alvo
    (ver SPLIT_SAFETY_FACTOR em bot_manager.py) em vez de confiar num corte
    exato."""
    ffmpeg_bin = _ffmpeg_binary()
    if not ffmpeg_bin:
        raise RuntimeError('ffmpeg não disponível (nem via static-ffmpeg, nem no PATH do sistema)')

    tmp_dst = dst_path + '.tmp'
    cmd = [ffmpeg_bin, '-y', '-nostdin', '-ss', str(start_seconds), '-i', src_path]
    if duration_seconds is not None:
        cmd += ['-t', str(duration_seconds)]
    cmd += ['-c', 'copy', '-map', '0', '-movflags', '+faststart', '-f', 'mp4', tmp_dst]
    try:
        result = subprocess.run(cmd, capture_output=True, timeout=timeout)
        if result.returncode != 0:
            stderr = result.stderr.decode(errors='replace')[-800:]
            raise RuntimeError(f"ffmpeg falhou ao dividir vídeo (código {result.returncode}): {stderr}")
        os.replace(tmp_dst, dst_path)
    finally:
        if os.path.exists(tmp_dst):
            os.remove(tmp_dst)


def remux_partial_to_mp4(src_path, dst_path, up_to_bytes, timeout=300):
    """Como `remux_to_mp4`, mas opera sobre uma cópia congelada dos
    primeiros `up_to_bytes` de `src_path` — para gerar uma prévia web
    enquanto o download ainda está em andamento, sem remuxar um arquivo
    que está sendo escrito por outro processo ao mesmo tempo.

    ffmpeg lida bem com um Matroska cortado no meio: loga "File ended
    prematurely" mas termina com sucesso, produzindo um MP4 válido
    cobrindo exatamente o que foi decodificável (confirmado empiricamente
    com arquivos truncados em vários pontos)."""
    snapshot_path = dst_path + '.src-snapshot'
    try:
        with open(src_path, 'rb') as fin, open(snapshot_path, 'wb') as fout:
            remaining = up_to_bytes
            while remaining > 0:
                chunk = fin.read(min(1024 * 1024, remaining))
                if not chunk:
                    break
                fout.write(chunk)
                remaining -= len(chunk)
        remux_to_mp4(snapshot_path, dst_path, timeout=timeout)
    finally:
        if os.path.exists(snapshot_path):
            os.remove(snapshot_path)
