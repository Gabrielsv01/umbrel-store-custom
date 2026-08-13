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


def _ffmpeg_binary():
    """Prioriza o binário empacotado via imageio-ffmpeg (escopado ao venv
    do projeto, sem depender de instalação no sistema); cai para o PATH
    do sistema se o pacote não estiver disponível ou falhar."""
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return shutil.which('ffmpeg')


def ffmpeg_available():
    return _ffmpeg_binary() is not None


def remux_to_mp4(src_path, dst_path, timeout=300):
    """Remuxa (sem recodificar) `src_path` para MP4 em `dst_path`.

    Espera um arquivo de origem completo e estático (chamar só depois do
    download terminar). Escreve num arquivo temporário e só substitui o
    destino final se o ffmpeg terminar com sucesso, para nunca deixar um
    arquivo parcial/corrompido no lugar do remux."""
    ffmpeg_bin = _ffmpeg_binary()
    if not ffmpeg_bin:
        raise RuntimeError('ffmpeg não disponível (nem via imageio-ffmpeg, nem no PATH do sistema)')

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


def remux_partial_with_moov_tail_to_mp4(src_path, dst_path, up_to_bytes, moov_offset, moov_bytes, timeout=120):
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


def remux_partial_to_mp4(src_path, dst_path, up_to_bytes, timeout=120):
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
