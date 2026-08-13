import asyncio
import contextlib
import os
import shutil
import struct
import tempfile
import unittest
import unittest.mock

import bot_manager as bm
from media_store import MediaStore, RECEIVED, CACHING, READY, FORWARDED


def _mp4_box(fourcc, body=b''):
    return struct.pack('>I', 8 + len(body)) + fourcc + body


def fake_faststart_mp4_header():
    """MP4 minimalista, mas estruturalmente válido: ftyp seguido de moov
    logo no início — needs_remux() deve reconhecer como já reproduzível,
    sem precisar de remux."""
    return _mp4_box(b'ftyp', b'isom' + b'\x00' * 12) + _mp4_box(b'moov', b'\x00' * 64)


class FakeMessage:
    def __init__(self, media=True):
        self.media = media
        self.raw_text = None


class _FakeDownloadStream:
    """Simula o objeto retornado por client.iter_download: async iterável
    de fatias de `content` a partir de `offset`, com um .close() (a API
    real do Telethon documenta fechamento manual quando se para de
    iterar antes do fim)."""

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


class FakeMoovDownloadClient:
    """Simula o servidor do Telegram do ponto de vista de iter_download:
    tem o arquivo TOTAL (`true_content`), do qual só um prefixo já foi
    baixado localmente — usado pra testar a busca fora de ordem do moov
    (offset arbitrário, sem depender de download sequencial)."""

    def __init__(self, true_content):
        self.true_content = true_content
        self.offsets_requested = []

    def iter_download(self, media, offset=0, request_size=None, limit=None):
        self.offsets_requested.append(offset)
        step = request_size or 64 * 1024
        return _FakeDownloadStream(self.true_content, offset, step)


class FakeClient:
    def __init__(self, recoverable_chat_ids):
        self.recoverable_chat_ids = recoverable_chat_ids
        self.get_messages_calls = []
        self.download_media_calls = []

    async def get_messages(self, chat_id, ids):
        self.get_messages_calls.append((chat_id, ids))
        return FakeMessage(media=True) if chat_id in self.recoverable_chat_ids else None

    async def download_media(self, msg, file):
        self.download_media_calls.append(file)
        with open(file, 'wb') as f:
            f.write(b'\x00' * 5000)

    async def send_file(self, target, file, caption, progress_callback=None, **kwargs):
        if progress_callback:
            progress_callback(2500, 5000)
            progress_callback(5000, 5000)


class DownloadTimeoutTests(unittest.TestCase):
    def test_unknown_size_uses_default(self):
        self.assertEqual(bm._download_timeout_for(None), bm.DEFAULT_DOWNLOAD_TIMEOUT_SECONDS)

    def test_small_file_still_respects_minimum(self):
        self.assertEqual(bm._download_timeout_for(1024), bm.DEFAULT_DOWNLOAD_TIMEOUT_SECONDS)

    def test_large_file_scales_timeout_above_default(self):
        size = 20 * 1024 * 1024 * 1024
        expected = size / bm.MIN_THROUGHPUT_BYTES_PER_SEC + bm.DOWNLOAD_TIMEOUT_GRACE_SECONDS
        got = bm._download_timeout_for(size)
        self.assertEqual(got, expected)
        self.assertGreater(got, bm.DEFAULT_DOWNLOAD_TIMEOUT_SECONDS)


class ReconcileOrphanedDownloadsTests(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp()
        self.cache_dir = os.path.join(self.tmp_dir, 'cache')
        os.makedirs(self.cache_dir)
        self.store = MediaStore(os.path.join(self.tmp_dir, 'media_store.json'))

    def tearDown(self):
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    def _make_manager(self, recoverable_chat_ids):
        manager = bm.BotManager.__new__(bm.BotManager)
        manager.cfg = {'forward': {'from_bot_id': 1, 'to_group_id': 999}}
        manager.cache_dir = self.cache_dir
        manager.store = self.store
        manager.base_url = 'http://localhost:5000'
        manager.can_remux = False  # sem ffmpeg neste teste; não é o que está sob teste aqui
        manager.client = FakeClient(recoverable_chat_ids)
        return manager

    def test_orphan_with_recoverable_message_restarts_from_zero(self):
        self.store.create('100', {'ext': '.mp4', 'size': 5000, 'chat_id': 111, 'name': 'a.mp4'})
        self.store.set_state('100', CACHING)
        partial_path = os.path.join(self.cache_dir, '100.mp4')
        with open(partial_path, 'wb') as f:
            f.write(b'\x00' * 1234)  # download parcial de uma execução anterior

        manager = self._make_manager(recoverable_chat_ids={111})

        asyncio.run(self._run_and_settle(manager))

        self.assertIn((111, 100), manager.client.get_messages_calls)
        self.assertIn(partial_path, manager.client.download_media_calls)
        self.assertEqual(self.store.get('100')['state'], 'forwarded')

    def test_orphan_with_unrecoverable_message_becomes_error(self):
        self.store.create('200', {'ext': '.mp4', 'size': 5000, 'chat_id': 222, 'name': 'b.mp4'})
        self.store.set_state('200', RECEIVED)

        manager = self._make_manager(recoverable_chat_ids=set())
        asyncio.run(self._run_and_settle(manager))

        self.assertEqual(self.store.get('200')['state'], 'error')

    def test_items_not_mid_download_are_left_untouched(self):
        self.store.create('300', {'ext': '.mp4', 'size': 5000, 'chat_id': 333, 'name': 'c.mp4'})
        self.store.set_state('300', READY)

        manager = self._make_manager(recoverable_chat_ids={333})
        asyncio.run(self._run_and_settle(manager))

        self.assertNotIn((333, 300), manager.client.get_messages_calls)
        self.assertEqual(self.store.get('300')['state'], READY)

    @staticmethod
    async def _run_and_settle(manager):
        await manager._reconcile_orphaned_downloads()
        await asyncio.sleep(0.2)  # deixa as tasks criadas via create_task rodarem


class RemuxIfNeededTests(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp()
        self.store = MediaStore(os.path.join(self.tmp_dir, 'media_store.json'))

    def tearDown(self):
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    def _make_manager(self):
        manager = bm.BotManager.__new__(bm.BotManager)
        manager.store = self.store
        manager.can_remux = True
        manager._remux_locks = {}
        return manager

    def test_skips_when_ffmpeg_unavailable(self):
        manager = self._make_manager()
        manager.can_remux = False
        path = os.path.join(self.tmp_dir, '1.mp4')
        with open(path, 'wb') as f:
            f.write(b'\x1a\x45\xdf\xa3conteudo matroska')
        self.store.create('1', {'ext': '.mp4'})

        with unittest.mock.patch('remux.remux_to_mp4') as mock_remux:
            asyncio.run(manager._remux_if_needed('1', path))

        mock_remux.assert_not_called()
        self.assertIsNone(self.store.get('1').get('remuxed_ext'))

    def test_skips_when_file_is_already_faststart_mp4(self):
        manager = self._make_manager()
        path = os.path.join(self.tmp_dir, '1.mp4')
        with open(path, 'wb') as f:
            f.write(fake_faststart_mp4_header())
        self.store.create('1', {'ext': '.mp4'})

        with unittest.mock.patch('remux.remux_to_mp4') as mock_remux:
            asyncio.run(manager._remux_if_needed('1', path))

        mock_remux.assert_not_called()
        self.assertIsNone(self.store.get('1').get('remuxed_ext'))

    def test_records_remuxed_ext_on_success(self):
        manager = self._make_manager()
        path = os.path.join(self.tmp_dir, '1.mp4')
        with open(path, 'wb') as f:
            f.write(b'\x1a\x45\xdf\xa3conteudo matroska')
        self.store.create('1', {'ext': '.mp4'})

        with unittest.mock.patch('remux.remux_to_mp4') as mock_remux:
            asyncio.run(manager._remux_if_needed('1', path))

        mock_remux.assert_called_once_with(path, path + '.web.mp4')
        self.assertEqual(self.store.get('1')['remuxed_ext'], '.web.mp4')

    def test_ffmpeg_failure_does_not_raise_and_leaves_no_remuxed_ext(self):
        manager = self._make_manager()
        path = os.path.join(self.tmp_dir, '1.mp4')
        with open(path, 'wb') as f:
            f.write(b'\x1a\x45\xdf\xa3conteudo matroska')
        self.store.create('1', {'ext': '.mp4'})

        with unittest.mock.patch('remux.remux_to_mp4', side_effect=RuntimeError('ffmpeg explodiu')):
            asyncio.run(manager._remux_if_needed('1', path))  # não deve propagar

        self.assertIsNone(self.store.get('1').get('remuxed_ext'))


class PartialRemuxLoopTests(unittest.TestCase):
    """A prévia parcial (gerada enquanto o download ainda está em
    andamento) é o que permite assistir Matroska no navegador sem esperar
    o download terminar."""

    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp()
        self.store = MediaStore(os.path.join(self.tmp_dir, 'media_store.json'))
        self.path = os.path.join(self.tmp_dir, '1.mp4')
        self._orig_interval = bm.PARTIAL_REMUX_INTERVAL_SECONDS
        self._orig_min_bytes = bm.PARTIAL_REMUX_MIN_NEW_BYTES
        bm.PARTIAL_REMUX_INTERVAL_SECONDS = 0.02
        bm.PARTIAL_REMUX_MIN_NEW_BYTES = 10

    def tearDown(self):
        bm.PARTIAL_REMUX_INTERVAL_SECONDS = self._orig_interval
        bm.PARTIAL_REMUX_MIN_NEW_BYTES = self._orig_min_bytes
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    def _make_manager(self):
        manager = bm.BotManager.__new__(bm.BotManager)
        manager.store = self.store
        manager.can_remux = True
        manager._remux_locks = {}
        return manager

    def test_returns_immediately_when_ffmpeg_unavailable(self):
        manager = self._make_manager()
        manager.can_remux = False
        self.store.create('1', {'ext': '.mp4'})
        self.store.set_state('1', CACHING)

        asyncio.run(asyncio.wait_for(manager._partial_remux_loop(FakeMessage(), '1', self.path), timeout=1))

    def test_stops_when_state_is_no_longer_caching(self):
        manager = self._make_manager()
        self.store.create('1', {'ext': '.mp4'})
        self.store.set_state('1', READY)  # já não está mais caching
        with open(self.path, 'wb') as f:
            f.write(b'\x1a\x45\xdf\xa3' + b'x' * 100)

        asyncio.run(asyncio.wait_for(manager._partial_remux_loop(FakeMessage(), '1', self.path), timeout=1))

    def test_stops_when_file_already_has_moov_near_front(self):
        manager = self._make_manager()
        self.store.create('1', {'ext': '.mp4'})
        self.store.set_state('1', CACHING)
        with open(self.path, 'wb') as f:
            f.write(fake_faststart_mp4_header())

        asyncio.run(asyncio.wait_for(manager._partial_remux_loop(FakeMessage(), '1', self.path), timeout=1))

    def test_generates_partial_preview_once_enough_new_bytes_accumulate(self):
        manager = self._make_manager()
        self.store.create('1', {'ext': '.mp4'})
        self.store.set_state('1', CACHING)
        with open(self.path, 'wb') as f:
            f.write(b'\x1a\x45\xdf\xa3' + b'x' * 100)  # > PARTIAL_REMUX_MIN_NEW_BYTES (10)

        def fake_partial(src, dst, up_to_bytes):
            with open(dst, 'wb') as f:
                f.write(b'preview parcial fake')

        async def run_until_preview_or_timeout():
            task = asyncio.create_task(manager._partial_remux_loop(FakeMessage(), '1', self.path))
            try:
                for _ in range(100):
                    await asyncio.sleep(0.02)
                    if self.store.get('1').get('remuxed_ext'):
                        return
            finally:
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError):
                    await task

        with unittest.mock.patch('remux.remux_partial_to_mp4', side_effect=fake_partial) as mock_remux:
            asyncio.run(run_until_preview_or_timeout())

        mock_remux.assert_called()
        self.assertEqual(self.store.get('1')['remuxed_ext'], '.web.mp4')


class MoovTailFetchTests(unittest.TestCase):
    """MP4 sem faststart: o moov só existe perto do fim do arquivo
    completo, que a manager não tem localmente ainda (só um prefixo já
    baixado). _try_fetch_moov_tail busca esse moov fora de ordem, direto
    no servidor (simulado aqui por FakeMoovDownloadClient), sem esperar o
    download sequencial alcançá-lo."""

    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp()
        self.path = os.path.join(self.tmp_dir, '1.mp4')
        self.ftyp = _mp4_box(b'ftyp', b'isom' + b'\x00' * 12)
        self.mdat_body = b'M' * 5000
        self.mdat = _mp4_box(b'mdat', self.mdat_body)
        self.moov_body = b'\x00' * 300
        self.moov = _mp4_box(b'moov', self.moov_body)
        self.front_only = self.ftyp + self.mdat  # o que já foi baixado localmente
        with open(self.path, 'wb') as f:
            f.write(self.front_only)

    def tearDown(self):
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    def _make_manager(self, client=None):
        manager = bm.BotManager.__new__(bm.BotManager)
        manager.client = client
        return manager

    def test_fetches_and_caches_real_moov_at_expected_offset(self):
        true_content = self.front_only + self.moov
        manager = self._make_manager(FakeMoovDownloadClient(true_content))

        asyncio.run(manager._try_fetch_moov_tail(FakeMessage(), self.path))

        self.assertTrue(os.path.exists(self.path + '.moov_tail'))
        moov_offset, moov_bytes = manager._read_moov_tail(self.path)
        self.assertEqual(moov_offset, len(self.front_only))
        self.assertEqual(moov_bytes, self.moov)

    def test_no_op_when_layout_does_not_match_simple_pattern(self):
        # mdat com tamanho especial (0 = até o fim do arquivo) — layout
        # não é o simples "ftyp -> mdat -> moov" que sabemos calcular.
        with open(self.path, 'wb') as f:
            f.write(self.ftyp + b'\x00\x00\x00\x00mdat' + b'\x00' * 50)

        manager = self._make_manager(client=None)  # não deve nem ser tocado
        asyncio.run(manager._try_fetch_moov_tail(FakeMessage(), self.path))

        self.assertFalse(os.path.exists(self.path + '.moov_tail'))
        self.assertFalse(os.path.exists(self.path + '.moov_tail.absent'))

    def test_marks_absent_when_expected_offset_does_not_hold_a_real_moov(self):
        # mdat declara um tamanho que não corresponde à realidade — o que
        # está no offset calculado não é um box moov de verdade.
        true_content = self.front_only + b'\x00' * 20
        manager = self._make_manager(FakeMoovDownloadClient(true_content))

        asyncio.run(manager._try_fetch_moov_tail(FakeMessage(), self.path))

        self.assertFalse(os.path.exists(self.path + '.moov_tail'))
        self.assertTrue(os.path.exists(self.path + '.moov_tail.absent'))

    def test_second_call_does_not_refetch(self):
        true_content = self.front_only + self.moov
        client = FakeMoovDownloadClient(true_content)
        manager = self._make_manager(client)

        asyncio.run(manager._try_fetch_moov_tail(FakeMessage(), self.path))
        calls_after_first = len(client.offsets_requested)
        asyncio.run(manager._try_fetch_moov_tail(FakeMessage(), self.path))

        self.assertEqual(len(client.offsets_requested), calls_after_first)

    def test_does_not_refetch_after_being_marked_absent(self):
        true_content = self.front_only + b'\x00' * 20
        client = FakeMoovDownloadClient(true_content)
        manager = self._make_manager(client)

        asyncio.run(manager._try_fetch_moov_tail(FakeMessage(), self.path))
        calls_after_first = len(client.offsets_requested)
        asyncio.run(manager._try_fetch_moov_tail(FakeMessage(), self.path))

        self.assertEqual(len(client.offsets_requested), calls_after_first)


class PartialRemuxLoopMoovTailIntegrationTests(unittest.TestCase):
    """Um MP4 de verdade (não Matroska) sem faststart não pode ser
    remuxado parcialmente do jeito simples (remux_partial_to_mp4) — falha
    com "moov atom not found" a cada ciclo, exatamente como visto em
    produção. Uma vez que o moov é obtido fora de ordem, as prévias
    parciais passam a usar o caminho com moov (assemble + remux)."""

    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp()
        self.store = MediaStore(os.path.join(self.tmp_dir, 'media_store.json'))
        self.path = os.path.join(self.tmp_dir, '1.mp4')
        self._orig_interval = bm.PARTIAL_REMUX_INTERVAL_SECONDS
        self._orig_min_bytes = bm.PARTIAL_REMUX_MIN_NEW_BYTES
        bm.PARTIAL_REMUX_INTERVAL_SECONDS = 0.02
        bm.PARTIAL_REMUX_MIN_NEW_BYTES = 10

        self.ftyp = _mp4_box(b'ftyp', b'isom' + b'\x00' * 12)
        self.mdat = _mp4_box(b'mdat', b'M' * 5000)
        self.moov = _mp4_box(b'moov', b'\x00' * 300)
        self.front_only = self.ftyp + self.mdat
        with open(self.path, 'wb') as f:
            f.write(self.front_only)

    def tearDown(self):
        bm.PARTIAL_REMUX_INTERVAL_SECONDS = self._orig_interval
        bm.PARTIAL_REMUX_MIN_NEW_BYTES = self._orig_min_bytes
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    def _make_manager(self, client):
        manager = bm.BotManager.__new__(bm.BotManager)
        manager.store = self.store
        manager.can_remux = True
        manager._remux_locks = {}
        manager.client = client
        return manager

    async def _run_until(self, manager, msg, predicate, rounds=150):
        task = asyncio.create_task(manager._partial_remux_loop(msg, '1', self.path))
        try:
            for _ in range(rounds):
                await asyncio.sleep(0.02)
                if predicate():
                    return
        finally:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

    def test_uses_moov_tail_once_available_instead_of_failing_plain_remux(self):
        true_content = self.front_only + self.moov
        client = FakeMoovDownloadClient(true_content)
        self.store.create('1', {'ext': '.mp4', 'size': len(true_content)})
        self.store.set_state('1', CACHING)
        manager = self._make_manager(client)

        with_moov_calls = []

        def fake_with_moov(src, dst, up_to_bytes, moov_offset, moov_bytes):
            with_moov_calls.append((up_to_bytes, moov_offset, moov_bytes))
            with open(dst, 'wb') as f:
                f.write(b'preview parcial com moov adiantado')

        with unittest.mock.patch(
            'remux.remux_partial_with_moov_tail_to_mp4', side_effect=fake_with_moov,
        ) as mock_with_moov, unittest.mock.patch('remux.remux_partial_to_mp4') as mock_plain:
            asyncio.run(self._run_until(
                manager, FakeMessage(), lambda: bool(self.store.get('1').get('remuxed_ext')),
            ))

        mock_with_moov.assert_called()
        mock_plain.assert_not_called()
        self.assertEqual(with_moov_calls[0][1], len(self.front_only))
        self.assertEqual(with_moov_calls[0][2], self.moov)
        self.assertEqual(self.store.get('1')['remuxed_ext'], '.web.mp4')

    def test_skips_partial_preview_entirely_while_moov_tail_still_unavailable(self):
        # Layout não bate com o padrão simples (sem mdat real) — moov
        # nunca vai ser encontrado, então nunca deve nem chamar ffmpeg.
        with open(self.path, 'wb') as f:
            f.write(self.ftyp + b'\x00\x00\x00\x00mdat')  # tamanho especial (0)
        self.store.create('1', {'ext': '.mp4', 'size': 999999})
        self.store.set_state('1', CACHING)
        manager = self._make_manager(client=None)

        with unittest.mock.patch('remux.remux_partial_to_mp4') as mock_plain, \
                unittest.mock.patch('remux.remux_partial_with_moov_tail_to_mp4') as mock_with_moov:
            asyncio.run(self._run_until(manager, FakeMessage(), lambda: False, rounds=15))

        mock_plain.assert_not_called()
        mock_with_moov.assert_not_called()
        self.assertIsNone(self.store.get('1').get('remuxed_ext'))

    def test_skips_technique_entirely_for_files_above_size_threshold(self):
        true_content = self.front_only + self.moov
        client = FakeMoovDownloadClient(true_content)
        self.store.create('1', {'ext': '.mp4', 'size': bm.MOOV_TAIL_MAX_TOTAL_SIZE + 1})
        self.store.set_state('1', CACHING)
        manager = self._make_manager(client)

        with unittest.mock.patch('remux.remux_partial_to_mp4') as mock_plain, \
                unittest.mock.patch('remux.remux_partial_with_moov_tail_to_mp4') as mock_with_moov:
            asyncio.run(self._run_until(manager, FakeMessage(), lambda: False, rounds=15))

        mock_plain.assert_not_called()
        mock_with_moov.assert_not_called()
        self.assertEqual(client.offsets_requested, [])
        self.assertIsNone(self.store.get('1').get('remuxed_ext'))


class UploadProgressTests(unittest.TestCase):
    """Progresso do reenvio ao grupo, via progress_callback do Telethon —
    sem isso, a página web não tinha nenhuma visibilidade sobre o upload,
    só sobre o download/cache."""

    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp()
        self.store = MediaStore(os.path.join(self.tmp_dir, 'media_store.json'))
        self.cache_dir = os.path.join(self.tmp_dir, 'cache')
        os.makedirs(self.cache_dir)

    def tearDown(self):
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    def test_upload_progress_is_recorded_and_state_passes_through_uploading(self):
        seen_states_during_progress = []

        class TrackingClient(FakeClient):
            async def send_file(self, target, file, caption, progress_callback=None, **kwargs):
                if progress_callback:
                    seen_states_during_progress.append(store.get('1')['state'])
                    progress_callback(2500, 5000)
                    seen_states_during_progress.append(store.get('1')['state'])
                    progress_callback(5000, 5000)

        store = self.store
        store.create('1', {'ext': '.mp4', 'size': 5000, 'chat_id': 111, 'name': 'a.mp4'})

        manager = bm.BotManager.__new__(bm.BotManager)
        manager.cfg = {'forward': {'from_bot_id': 1, 'to_group_id': 999}}
        manager.cache_dir = self.cache_dir
        manager.store = store
        manager.base_url = 'http://localhost:5000'
        manager.can_remux = False
        manager._remux_locks = {}
        manager.client = TrackingClient(recoverable_chat_ids=set())

        msg = FakeMessage(media=True)
        meta = {'ext': '.mp4', 'size': 5000, 'chat_id': 111, 'name': 'a.mp4'}
        asyncio.run(manager._download_to_cache(msg, '1', meta, target_group=999))

        item = store.get('1')
        self.assertEqual(item['state'], 'forwarded')
        self.assertEqual(item['uploaded_bytes'], 5000)
        self.assertEqual(item['upload_total_bytes'], 5000)
        self.assertTrue(all(s == 'uploading' for s in seen_states_during_progress))


class PeriodicCleanupLoopTests(unittest.TestCase):
    """Sem essa varredura em segundo plano, um item já enviado só era
    limpo quando a PRÓXIMA mensagem do bot chegasse — se o bot ficasse
    quieto, o cache expirado nunca era removido."""

    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp()
        self.cache_dir = os.path.join(self.tmp_dir, 'cache')
        os.makedirs(self.cache_dir)
        self.store = MediaStore(os.path.join(self.tmp_dir, 'media_store.json'))
        self._orig_interval = bm.CLEANUP_INTERVAL_SECONDS
        bm.CLEANUP_INTERVAL_SECONDS = 0.02

    def tearDown(self):
        bm.CLEANUP_INTERVAL_SECONDS = self._orig_interval
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    def _make_manager(self, retention_seconds=60):
        manager = bm.BotManager.__new__(bm.BotManager)
        manager.cache_dir = self.cache_dir
        manager.store = self.store
        manager.retention_seconds = retention_seconds
        return manager

    def test_stale_item_is_purged_without_any_new_message_arriving(self):
        self.store.create('1', {'ext': '.mp4'})
        self.store.set_state('1', FORWARDED)
        self.store.update('1', forwarded_at=0)  # "há muito tempo", sem acesso via /stream
        path = os.path.join(self.cache_dir, '1.mp4')
        with open(path, 'wb') as f:
            f.write(b'conteudo qualquer')

        manager = self._make_manager(retention_seconds=1)

        async def run_briefly():
            task = asyncio.create_task(manager._periodic_cleanup_loop())
            for _ in range(50):
                await asyncio.sleep(0.02)
                if self.store.get('1') is None:
                    break
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

        asyncio.run(run_briefly())

        self.assertIsNone(self.store.get('1'))
        self.assertFalse(os.path.exists(path))

    def test_fresh_item_is_not_touched(self):
        self.store.create('1', {'ext': '.mp4'})
        self.store.set_state('1', FORWARDED)
        self.store.mark_streamed('1')  # acesso recente
        path = os.path.join(self.cache_dir, '1.mp4')
        with open(path, 'wb') as f:
            f.write(b'conteudo qualquer')

        manager = self._make_manager(retention_seconds=3600)

        async def run_briefly():
            task = asyncio.create_task(manager._periodic_cleanup_loop())
            await asyncio.sleep(0.1)
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

        asyncio.run(run_briefly())

        self.assertIsNotNone(self.store.get('1'))
        self.assertTrue(os.path.exists(path))


if __name__ == '__main__':
    unittest.main()
