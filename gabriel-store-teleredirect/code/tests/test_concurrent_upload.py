import asyncio
import contextlib
import os
import shutil
import tempfile
import unittest

import bot_manager as bm
from media_store import MediaStore, CACHING, FORWARDED, ERROR, PAUSED


class FakeSentMessage:
    def __init__(self, msg_id):
        self.id = msg_id


class FakeMessage:
    def __init__(self):
        self.media = object()
        self.raw_text = None


class GrowingFileUploadStreamTests(unittest.TestCase):
    """_GrowingFileUploadStream é o que permite o upload ler um arquivo
    que ainda está sendo baixado por outra task, sem nunca devolver menos
    do que foi pedido antes do fim de verdade — é exatamente o que o
    client.upload_file do Telethon exige (leitura curta antes da última
    parte levanta ValueError do lado dele)."""

    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp()
        self.path = os.path.join(self.tmp_dir, 'sample.mp4')

    def tearDown(self):
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    def _make_stream(self, total_size, poll_interval=0.01):
        return bm._GrowingFileUploadStream(self.path, total_size, asyncio.Event(), {}, poll_interval=poll_interval)

    def test_waits_for_file_to_be_created_before_opening(self):
        stream = self._make_stream(total_size=10)

        async def create_file_later():
            await asyncio.sleep(0.05)
            with open(self.path, 'wb') as f:
                f.write(b'0123456789')

        async def scenario():
            asyncio.create_task(create_file_later())
            return await stream.read(10)

        data = asyncio.run(scenario())
        self.assertEqual(data, b'0123456789')
        stream.close()

    def test_blocks_until_enough_bytes_accumulate_then_returns_exact_size(self):
        with open(self.path, 'wb') as f:
            f.write(b'AAAA')  # só 4 dos 10 bytes que serão pedidos

        stream = self._make_stream(total_size=10)

        async def append_more_later():
            await asyncio.sleep(0.05)
            with open(self.path, 'ab') as f:
                f.write(b'BBBBBB')

        async def scenario():
            asyncio.create_task(append_more_later())
            return await stream.read(10)

        data = asyncio.run(scenario())
        self.assertEqual(data, b'AAAABBBBBB')
        stream.close()

    def test_final_read_shrinks_to_remaining_bytes_at_true_eof(self):
        with open(self.path, 'wb') as f:
            f.write(b'X' * 7)
        stream = self._make_stream(total_size=7)

        async def scenario():
            first = await stream.read(5)
            second = await stream.read(5)  # pede 5, só restam 2
            return first, second

        first, second = asyncio.run(scenario())
        self.assertEqual(first, b'X' * 5)
        self.assertEqual(second, b'X' * 2)
        stream.close()

    def test_raises_captured_download_error_when_not_enough_bytes(self):
        with open(self.path, 'wb') as f:
            f.write(b'AB')
        done = asyncio.Event()
        error = {}
        stream = bm._GrowingFileUploadStream(self.path, 10, done, error, poll_interval=0.01)

        async def fail_later():
            await asyncio.sleep(0.05)
            error['exc'] = RuntimeError('conexão perdida no meio do download')
            done.set()

        async def scenario():
            asyncio.create_task(fail_later())
            await stream.read(10)

        with self.assertRaises(RuntimeError) as ctx:
            asyncio.run(scenario())
        self.assertIn('conexão perdida', str(ctx.exception))
        stream.close()

    def test_raises_generic_error_when_download_ends_inconsistently_without_captured_exception(self):
        with open(self.path, 'wb') as f:
            f.write(b'AB')
        done = asyncio.Event()
        stream = bm._GrowingFileUploadStream(self.path, 10, done, {}, poll_interval=0.01)

        async def finish_early():
            await asyncio.sleep(0.05)
            done.set()  # termina "com sucesso" mas sem os 10 bytes esperados

        async def scenario():
            asyncio.create_task(finish_early())
            await stream.read(10)

        with self.assertRaises(RuntimeError):
            asyncio.run(scenario())
        stream.close()

    def test_close_is_safe_even_if_never_opened(self):
        stream = self._make_stream(total_size=10)
        stream.close()  # não deve levantar, mesmo sem nunca ter chamado read()


class ConcurrentClient:
    """Simula o padrão real de leitura do Telethon (ver
    client.upload_file): parte de tamanho fixo derivado de file_size,
    cada leitura que não seja a última precisa vir com EXATAMENTE esse
    tamanho — é o contrato que _GrowingFileUploadStream precisa
    satisfazer de verdade, não só "ter um método read"."""

    def __init__(self, download_chunks, chunk_delay=0.01, part_size=None):
        self.download_chunks = download_chunks
        self.chunk_delay = chunk_delay
        self.part_size = part_size
        self.uploaded_chunks = []
        self.progress_calls = []
        self.sent = []
        self._next_id = 100

    async def send_message(self, target, text):
        self._next_id += 1
        return FakeSentMessage(self._next_id)

    async def edit_message(self, chat, message_id, text):
        pass

    async def delete_messages(self, chat, message_ids):
        pass

    async def download_media(self, msg, file):
        with open(file, 'wb') as f:
            for chunk in self.download_chunks:
                await asyncio.sleep(self.chunk_delay)
                f.write(chunk)
                f.flush()

    async def send_file(self, target, file, caption, file_size=None, progress_callback=None, **kwargs):
        part_size = self.part_size or file_size
        part_count = (file_size + part_size - 1) // part_size
        pos = 0
        for part_index in range(part_count):
            part = await file.read(part_size)
            if len(part) != part_size and part_index < part_count - 1:
                raise ValueError(
                    f'leitura curta na parte {part_index}: esperava {part_size} bytes, veio {len(part)}'
                )
            self.uploaded_chunks.append(part)
            pos += len(part)
            if progress_callback:
                r = progress_callback(pos, file_size)
                if asyncio.iscoroutine(r):
                    await r
        self.sent.append((target, caption))
        return FakeSentMessage(self._next_id)


class ConcurrentDownloadUploadTests(unittest.TestCase):
    """Cobre a integração completa: _download_to_cache precisa detectar
    que o tamanho é conhecido, disparar download e upload em paralelo, e
    terminar em FORWARDED com os bytes corretos — não só "não travar"."""

    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp()
        self.cache_dir = os.path.join(self.tmp_dir, 'cache')
        os.makedirs(self.cache_dir)
        self.store = MediaStore(os.path.join(self.tmp_dir, 'media_store.json'))

    def tearDown(self):
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    def _make_manager(self, client):
        manager = bm.BotManager.__new__(bm.BotManager)
        manager.cfg = {'forward': {'from_bot_id': 1, 'to_group_id': 999}}
        manager.cache_dir = self.cache_dir
        manager.store = self.store
        manager.base_url = 'http://localhost:5000'
        manager.can_remux = False
        manager._remux_locks = {}
        manager._active_tasks = {}
        manager.client = client
        return manager

    def test_upload_progress_advances_while_state_is_still_caching(self):
        # A prova real de que é simultâneo, não sequencial: o upload
        # precisa avançar ANTES do download (e portanto o estado) sair
        # de CACHING — no fluxo antigo isso só era possível em UPLOADING.
        # chunk_delay maior que o poll_interval padrão do stream (0.2s) —
        # senão o polling nem chega a observar um estado intermediário
        # antes do download (rápido demais no teste) já ter terminado.
        chunks = [b'A' * 250] * 4  # 1000 bytes, escritos aos poucos
        client = ConcurrentClient(chunks, chunk_delay=0.3, part_size=250)
        manager = self._make_manager(client)
        meta = {'ext': '.mp4', 'size': 1000, 'chat_id': 1, 'name': 'a.mp4'}
        self.store.create('1', meta)

        states_when_progress_seen = []
        orig_update = self.store.update

        def tracking_update(msg_id, **fields):
            result = orig_update(msg_id, **fields)
            if 'uploaded_bytes' in fields:
                states_when_progress_seen.append(self.store.get(msg_id)['state'])
            return result

        self.store.update = tracking_update

        asyncio.run(manager._download_to_cache(FakeMessage(), '1', meta, target_group=999))

        item = self.store.get('1')
        self.assertEqual(item['state'], FORWARDED)
        self.assertEqual(item['uploaded_bytes'], 1000)
        self.assertIn('caching', states_when_progress_seen)

    def test_uploaded_content_matches_downloaded_content_exactly(self):
        chunks = [bytes([i % 256]) * 300 for i in range(4)]  # 1200 bytes, blocos distintos
        client = ConcurrentClient(chunks, chunk_delay=0.02, part_size=400)
        manager = self._make_manager(client)
        meta = {'ext': '.mp4', 'size': 1200, 'chat_id': 1, 'name': 'a.mp4'}
        self.store.create('1', meta)

        asyncio.run(manager._download_to_cache(FakeMessage(), '1', meta, target_group=999))

        self.assertEqual(self.store.get('1')['state'], FORWARDED)
        uploaded = b''.join(client.uploaded_chunks)
        self.assertEqual(uploaded, b''.join(chunks))

    def test_falls_back_to_sequential_when_size_is_unknown(self):
        # Sem tamanho conhecido de antemão, o protocolo de upload do
        # Telegram não tem como saber quantas partes esperar — precisa
        # cair no caminho de sempre (upload só começa após o download).
        sent_files = []

        class SequentialClient(ConcurrentClient):
            async def send_file(self, target, file, caption, **kwargs):
                sent_files.append(file)
                return FakeSentMessage(1)

        client = SequentialClient([b'X' * 500])
        manager = self._make_manager(client)
        meta = {'ext': '.mp4', 'chat_id': 1, 'name': 'a.mp4'}  # sem 'size'
        self.store.create('1', meta)

        asyncio.run(manager._download_to_cache(FakeMessage(), '1', meta, target_group=999))

        self.assertEqual(self.store.get('1')['state'], FORWARDED)
        self.assertEqual(len(sent_files), 1)
        self.assertIsInstance(sent_files[0], str)  # caminho no disco, não um stream

    def test_download_failure_marks_error_and_does_not_hang_the_upload(self):
        class FailingClient(ConcurrentClient):
            async def download_media(self, msg, file):
                with open(file, 'wb') as f:
                    f.write(b'A' * 100)
                raise RuntimeError('conexão perdida')

        client = FailingClient([], part_size=400)
        manager = self._make_manager(client)
        meta = {'ext': '.mp4', 'size': 1000, 'chat_id': 1, 'name': 'a.mp4'}
        self.store.create('1', meta)

        asyncio.run(asyncio.wait_for(
            manager._download_to_cache(FakeMessage(), '1', meta, target_group=999), timeout=5,
        ))

        item = self.store.get('1')
        self.assertEqual(item['state'], ERROR)
        self.assertIn('conexão perdida', item.get('error', ''))

    def test_pause_during_concurrent_phase_cancels_both_sides(self):
        class NeverEndingClient(ConcurrentClient):
            async def download_media(self, msg, file):
                with open(file, 'wb') as f:
                    f.write(b'A' * 200)
                await asyncio.sleep(999)

        client = NeverEndingClient([], part_size=1000)
        manager = self._make_manager(client)
        meta = {'ext': '.mp4', 'size': 1000, 'chat_id': 1, 'name': 'a.mp4'}
        self.store.create('1', meta)

        async def scenario():
            manager._spawn_download_task(FakeMessage(), '1', meta, target_group=999)
            path = os.path.join(self.cache_dir, '1.mp4')
            for _ in range(100):
                await asyncio.sleep(0.02)
                if os.path.exists(path) and os.path.getsize(path) > 0:
                    break
            return await manager.pause_download('1')

        ok = asyncio.run(scenario())

        self.assertTrue(ok)
        self.assertEqual(self.store.get('1')['state'], PAUSED)
        self.assertNotIn('1', manager._active_tasks)


class TimeoutHelperTests(unittest.TestCase):
    def test_upload_timeout_uses_a_lower_throughput_floor_than_download(self):
        # Precisa ser grande o bastante pra passar do piso de
        # DEFAULT_DOWNLOAD_TIMEOUT_SECONDS nos dois casos — senão os dois
        # só refletem o mesmo default e a diferença de piso de banda não
        # aparece na comparação.
        size = 2 * 1024 * 1024 * 1024
        self.assertGreater(bm._upload_timeout_for(size), bm._download_timeout_for(size))

    def test_concurrent_timeout_is_the_max_of_both(self):
        size = 2 * 1024 * 1024 * 1024
        expected = max(bm._download_timeout_for(size), bm._upload_timeout_for(size))
        self.assertEqual(bm._concurrent_timeout_for(size), expected)

    def test_unknown_size_falls_back_to_default_for_all(self):
        self.assertEqual(bm._upload_timeout_for(None), bm.DEFAULT_DOWNLOAD_TIMEOUT_SECONDS)
        self.assertEqual(bm._concurrent_timeout_for(None), bm.DEFAULT_DOWNLOAD_TIMEOUT_SECONDS)


if __name__ == '__main__':
    unittest.main()
