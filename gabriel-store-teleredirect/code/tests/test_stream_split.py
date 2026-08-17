import asyncio
import os
import shutil
import struct
import subprocess
import tempfile
import unittest
import unittest.mock

import bot_manager as bm
import remux
from media_store import MediaStore, FORWARDED, ERROR


def _mp4_box(fourcc, body=b''):
    return struct.pack('>I', 8 + len(body)) + fourcc + body


class FakeMessage:
    def __init__(self, media=True):
        self.media = media
        self.raw_text = None


class _FakeDownloadStream:
    """Simula client.iter_download: fatia `content` a partir de `offset` —
    usado tanto pela busca fora de ordem do moov quanto (indiretamente,
    via download_media) pelo download sequencial normal."""

    def __init__(self, content, offset, step):
        self._content = content
        self._pos = offset
        self._step = max(1, step)

    def __aiter__(self):
        return self

    async def __anext__(self):
        if self._pos >= len(self._content):
            raise StopAsyncIteration
        chunk = self._content[self._pos:self._pos + self._step]
        self._pos += self._step
        return chunk

    async def close(self):
        pass


class FakeStreamingClient:
    """Simula o servidor do Telegram do ponto de vista do BotManager: tem
    o arquivo TOTAL (`full_content`), servido de duas formas —
    download_media (sequencial, em pedacinhos, com atraso, pra simular um
    download real em andamento) e iter_download (acesso por offset
    arbitrário, usado pela busca adiantada do moov). send_file grava o
    conteúdo de cada envio pra inspeção depois."""

    def __init__(self, full_content, chunk_size=2000, chunk_delay=0.01):
        self.full_content = full_content
        self.chunk_size = chunk_size
        self.chunk_delay = chunk_delay
        self.sent = []

    async def download_media(self, msg, file):
        with open(file, 'wb') as f:
            for i in range(0, len(self.full_content), self.chunk_size):
                await asyncio.sleep(self.chunk_delay)
                f.write(self.full_content[i:i + self.chunk_size])
                f.flush()

    def iter_download(self, media, offset=0, request_size=None, limit=None):
        step = request_size or 64 * 1024
        return _FakeDownloadStream(self.full_content, offset, step)

    async def send_message(self, target, text):
        return unittest.mock.Mock(id=1)

    async def edit_message(self, chat, message_id, text):
        pass

    async def delete_messages(self, chat, message_ids):
        pass

    async def send_file(self, target, file, caption, attributes=None, progress_callback=None, **kwargs):
        with open(file, 'rb') as f:
            data = f.read()
        if progress_callback:
            r = progress_callback(len(data), len(data))
            if asyncio.iscoroutine(r):
                await r
        self.sent.append({'target': target, 'caption': caption, 'attributes': attributes, 'data': data})
        return unittest.mock.Mock(id=len(self.sent))


def _expected_moov_offset_from_prefix(full_content, prefix_len=256):
    """find_moov_expected_offset só faz sentido (e só retorna algo) sobre
    um PREFIXO que ainda não contém o moov real — chamado sobre o arquivo
    COMPLETO ele acha o moov dentro da própria janela de sondagem e
    desiste de propósito (ver find_moov_expected_offset). O offset do
    mdat/moov já é conhecido a partir de poucos bytes iniciais (o
    cabeçalho de tamanho do mdat vem logo depois do ftyp), então um
    prefixo pequeno já basta — não precisa esperar boa parte do download."""
    with tempfile.TemporaryDirectory() as tmp_dir:
        prefix_path = os.path.join(tmp_dir, 'prefix_probe.mp4')
        with open(prefix_path, 'wb') as f:
            f.write(full_content[:prefix_len])
        return remux.find_moov_expected_offset(prefix_path)


def _generate_video(path, duration=3, gop=10, fps=10):
    subprocess.run(
        [
            remux._ffmpeg_binary(), '-y',
            '-f', 'lavfi', '-i', f'testsrc=duration={duration}:size=64x64:rate={fps}',
            '-f', 'lavfi', '-i', f'sine=frequency=440:duration={duration}',
            '-c:v', 'libx264', '-g', str(gop), '-c:a', 'aac', '-f', 'mp4', path,
        ],
        check=True, capture_output=True,
    )


class StreamCutAndUploadLoopEarlyExitTests(unittest.TestCase):
    """Casos em que o streaming split não se aplica e desiste sem enviar
    nada (retorna 0) — quem chamou (_download_and_stream_split_upload)
    deve então cair pro split de sempre, já com o download completo."""

    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp()
        self.path = os.path.join(self.tmp_dir, '1.mp4')

    def tearDown(self):
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    def _make_manager(self):
        manager = bm.BotManager.__new__(bm.BotManager)
        manager._remux_locks = {}
        return manager

    def test_matroska_gives_up_immediately(self):
        with open(self.path, 'wb') as f:
            f.write(remux.MATROSKA_MAGIC + b'conteudo qualquer' * 10)
        manager = self._make_manager()
        download_done = asyncio.Event()
        download_done.set()

        result = asyncio.run(manager._stream_cut_and_upload_loop(
            FakeMessage(), '1', {'name': 'a.mkv', 'size': 1000}, 999, self.path, download_done, {},
        ))
        self.assertEqual(result, 0)

    def test_gives_up_when_moov_layout_does_not_match_expected_pattern(self):
        # mdat com tamanho especial (0 = até o fim do arquivo) — layout
        # não bate com o padrão simples que find_moov_expected_offset sabe
        # calcular; _try_fetch_moov_tail nunca teria como achar o moov.
        ftyp = _mp4_box(b'ftyp', b'isom' + b'\x00' * 12)
        with open(self.path, 'wb') as f:
            f.write(ftyp + b'\x00\x00\x00\x00mdat' + b'\x00' * 5000)

        manager = self._make_manager()
        manager.client = FakeStreamingClient(b'')  # nunca deveria ser chamado
        download_done = asyncio.Event()
        download_done.set()

        result = asyncio.run(manager._stream_cut_and_upload_loop(
            FakeMessage(), '1', {'name': 'a.mp4', 'size': 5000}, 999, self.path, download_done, {},
        ))
        self.assertEqual(result, 0)

    def test_gives_up_if_download_finishes_before_moov_is_obtained(self):
        # Layout bate (dá pra CALCULAR o offset esperado), mas o download
        # termina antes da busca adiantada ter chance de completar —
        # simulado aqui com download_done já setado e um client que nunca
        # responde (represents a busca ainda pendente).
        ftyp = _mp4_box(b'ftyp', b'isom' + b'\x00' * 12)
        mdat = _mp4_box(b'mdat', b'M' * 5000)
        with open(self.path, 'wb') as f:
            f.write(ftyp + mdat)  # moov real nem existe aqui — nunca baixado

        manager = self._make_manager()

        class NeverRespondingClient:
            def iter_download(self, media, offset=0, request_size=None, limit=None):
                return _FakeDownloadStream(b'', offset, 1)  # stream vazio -> header incompleto

        manager.client = NeverRespondingClient()
        download_done = asyncio.Event()
        download_done.set()

        result = asyncio.run(manager._stream_cut_and_upload_loop(
            FakeMessage(), '1', {'name': 'a.mp4', 'size': 5000}, 999, self.path, download_done, {},
        ))
        self.assertEqual(result, 0)


@unittest.skipUnless(remux.ffprobe_available(), 'ffprobe não está instalado nesta máquina')
class CutStreamPartRealFfmpegTests(unittest.TestCase):
    """_cut_next_stream_part (durante o download) e _cut_final_stream_part
    (depois que termina) com ffmpeg/ffprobe de verdade."""

    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp()
        self.file_path = os.path.join(self.tmp_dir, '1.mp4')
        _generate_video(self.file_path, duration=3, gop=10, fps=10)
        with open(self.file_path, 'rb') as f:
            self.full_content = f.read()
        self.moov_offset = _expected_moov_offset_from_prefix(self.full_content)
        if self.moov_offset is None:
            self.skipTest('layout do ffmpeg não bateu com o padrão simples esperado')
        moov_size = int.from_bytes(self.full_content[self.moov_offset:self.moov_offset + 4], 'big')
        self.moov_bytes = self.full_content[self.moov_offset:self.moov_offset + moov_size]

    def tearDown(self):
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    def _make_manager(self):
        manager = bm.BotManager.__new__(bm.BotManager)
        manager._remux_locks = {}
        return manager

    def test_cuts_a_part_from_only_the_downloaded_prefix(self):
        manager = self._make_manager()
        # Simula 60% do arquivo já baixado — bem antes do moov de verdade.
        partial_path = self.file_path + '.partial'
        current_size = len(self.full_content) * 6 // 10
        with open(partial_path, 'wb') as f:
            f.write(self.full_content[:current_size])
        shutil.copy(partial_path, self.file_path)  # _cut_next_stream_part lê de file_path

        part_path = os.path.join(self.tmp_dir, 'part1.mp4')
        cut_time = asyncio.run(manager._cut_next_stream_part(
            '1', self.file_path, part_path, self.moov_offset, self.moov_bytes,
            checkpoint_seconds=0.0, current_size=current_size,
        ))

        self.assertIsNotNone(cut_time)
        self.assertGreater(cut_time, 0.0)
        self.assertTrue(os.path.exists(part_path))
        self.assertGreater(os.path.getsize(part_path), 0)
        # Não deixa o arquivo de sondagem temporário pra trás.
        self.assertFalse(os.path.exists(self.file_path + '.cutprobe.mp4'))

    def test_returns_none_when_not_enough_bytes_for_any_safe_cut(self):
        manager = self._make_manager()
        with open(self.file_path, 'wb') as f:
            f.write(self.full_content[:200])  # bem pouco, nem o 1º keyframe fecha

        part_path = os.path.join(self.tmp_dir, 'part1.mp4')
        cut_time = asyncio.run(manager._cut_next_stream_part(
            '1', self.file_path, part_path, self.moov_offset, self.moov_bytes,
            checkpoint_seconds=0.0, current_size=200,
        ))

        self.assertIsNone(cut_time)
        self.assertFalse(os.path.exists(part_path))

    def test_final_part_uses_the_complete_file_directly(self):
        manager = self._make_manager()
        # Arquivo já 100% baixado (como estaria quando download_done dispara).
        with open(self.file_path, 'wb') as f:
            f.write(self.full_content)

        part_path = os.path.join(self.tmp_dir, 'final.mp4')
        asyncio.run(manager._cut_final_stream_part('1', self.file_path, part_path, checkpoint_seconds=1.5))

        self.assertTrue(os.path.exists(part_path))
        self.assertGreater(os.path.getsize(part_path), 0)


@unittest.skipUnless(remux.ffprobe_available(), 'ffprobe não está instalado nesta máquina')
class StreamSplitEndToEndTests(unittest.TestCase):
    """Ponta a ponta: download simulado em pedacinhos + envio em partes
    conforme o cache cresce, via _download_to_cache (nível mais alto,
    exercitando a decisão real de qual caminho usar)."""

    def setUp(self):
        # O download simulado nestes testes termina em frações de segundo
        # (chunk_delay pequeno) — sem isso, o poll padrão (5s) nunca teria
        # chance de reamostrar o arquivo num estado intermediário antes do
        # download inteiro já ter terminado.
        self._orig_poll_interval = bm.STREAM_SPLIT_POLL_INTERVAL_SECONDS
        bm.STREAM_SPLIT_POLL_INTERVAL_SECONDS = 0.02

        self.tmp_dir = tempfile.mkdtemp()
        self.cache_dir = os.path.join(self.tmp_dir, 'cache')
        os.makedirs(self.cache_dir)
        self.store = MediaStore(os.path.join(self.tmp_dir, 'media_store.json'))
        self.video_path = os.path.join(self.tmp_dir, 'source.mp4')
        _generate_video(self.video_path, duration=3, gop=10, fps=10)
        with open(self.video_path, 'rb') as f:
            self.full_content = f.read()
        if _expected_moov_offset_from_prefix(self.full_content) is None:
            self.skipTest('layout do ffmpeg não bateu com o padrão simples esperado')

    def tearDown(self):
        bm.STREAM_SPLIT_POLL_INTERVAL_SECONDS = self._orig_poll_interval
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    def _make_manager(self, client, max_part_size_bytes):
        manager = bm.BotManager.__new__(bm.BotManager)
        manager.cfg = {'forward': {'from_bot_id': 1, 'to_group_id': 999}}
        manager.cache_dir = self.cache_dir
        manager.store = self.store
        manager.base_url = 'http://localhost:5000'
        manager.can_remux = True
        manager.experimental_streaming_split = True
        manager.max_part_size_bytes = max_part_size_bytes
        manager._remux_locks = {}
        manager._active_tasks = {}
        manager.client = client
        return manager

    def test_sends_multiple_parts_while_download_is_still_in_progress(self):
        total_size = len(self.full_content)
        client = FakeStreamingClient(self.full_content, chunk_size=1500, chunk_delay=0.01)
        # Limite bem menor que o arquivo inteiro -> força várias partes.
        manager = self._make_manager(client, max_part_size_bytes=total_size // 3)
        meta = {
            'ext': '.mp4', 'size': total_size, 'chat_id': 1, 'name': 'video.mp4',
            'duration': 3.0, 'width': 64, 'height': 64,
        }
        self.store.create('1', meta)

        asyncio.run(asyncio.wait_for(
            manager._download_to_cache(FakeMessage(), '1', meta, target_group=999), timeout=30,
        ))

        item = self.store.get('1')
        self.assertEqual(item['state'], FORWARDED)
        self.assertGreaterEqual(len(client.sent), 2, 'deveria ter dividido em pelo menos 2 partes')

        # Cada parte tem legenda "Parte N" numerada e sequencial, SEM "/N"
        # total (o streaming não sabe quantas partes existirão no final).
        for i, sent in enumerate(client.sent):
            self.assertEqual(sent['target'], 999)
            self.assertIn(f"Parte {i + 1}", sent['caption'])
            self.assertNotIn('/', sent['caption'])
            self.assertGreater(len(sent['data']), 0)

        # O arquivo original em cache (usado pelo /stream) continua
        # intacto e completo — o streaming split nunca deveria mexer nele.
        cached_path = os.path.join(self.cache_dir, '1.mp4')
        self.assertTrue(os.path.exists(cached_path))
        self.assertEqual(os.path.getsize(cached_path), total_size)

        # Nenhum arquivo temporário de parte/sondagem deixado pra trás —
        # `.moov_tail` é o único artefato esperado (cache intencional da
        # busca adiantada, mesmo mecanismo já usado pela prévia web;
        # limpo só quando o item inteiro é removido, ver _remove_remux).
        leftovers = [f for f in os.listdir(self.cache_dir) if f not in ('1.mp4', '1.mp4.moov_tail')]
        self.assertEqual(leftovers, [])

    def test_falls_back_to_normal_split_when_source_is_matroska(self):
        matroska_content = remux.MATROSKA_MAGIC + b'conteudo matroska fake' * 200
        total_size = len(matroska_content)
        client = FakeStreamingClient(matroska_content, chunk_size=500, chunk_delay=0.005)
        manager = self._make_manager(client, max_part_size_bytes=total_size // 3)
        # Sem duration conhecida, o fallback (_needs_split) também desiste
        # de dividir — prova que caiu pro caminho de sempre (falha do
        # jeito já esperado hoje pra esse caso), não que travou.
        meta = {'ext': '.mp4', 'size': total_size, 'chat_id': 1, 'name': 'video.mp4'}
        self.store.create('1', meta)

        asyncio.run(asyncio.wait_for(
            manager._download_to_cache(FakeMessage(), '1', meta, target_group=999), timeout=30,
        ))

        item = self.store.get('1')
        self.assertEqual(item['state'], FORWARDED)
        self.assertEqual(len(client.sent), 1, 'Matroska sem duration cai pro envio único de sempre')


if __name__ == '__main__':
    unittest.main()
