import asyncio
import contextlib
import os
import shutil
import tempfile
import unittest

import bot_manager as bm
from media_store import MediaStore, CACHING, READY, PAUSED, FORWARDED


class FakeSentMessage:
    def __init__(self, msg_id):
        self.id = msg_id


class FakeTelegramClient:
    def __init__(self):
        self._next_id = 100
        self.edits = []
        self.deleted = []

    async def send_message(self, target, text):
        self._next_id += 1
        return FakeSentMessage(self._next_id)

    async def edit_message(self, chat, message_id, text):
        self.edits.append((chat, message_id, text))

    async def delete_messages(self, chat, message_ids):
        self.deleted.append((chat, message_ids))


class FakeMessage:
    """Mensagem sem media alguma (não usada nesses testes pra download real)."""
    def __init__(self):
        self.raw_text = None


class SlowDownloadClient(FakeTelegramClient):
    """Escreve alguns bytes já de cara (simula progresso real) e depois
    fica bloqueado indefinidamente — só sai dali por cancelamento
    (pause/delete), nunca por conta própria."""

    async def download_media(self, msg, file):
        with open(file, 'wb') as f:
            f.write(b'\x00' * 400)
        await asyncio.sleep(999)

    async def send_file(self, target, file, caption, **kwargs):
        pass


class FakeMessageWithMedia:
    def __init__(self):
        self.media = object()
        self.raw_text = None


class ResumableClient(FakeTelegramClient):
    """Simula o Telethon retomando um download parcial via iter_download
    (offset exato do que já existe em disco) e concluindo o upload."""

    def __init__(self):
        super().__init__()
        self.iter_calls = []

    async def get_messages(self, chat_id, ids):
        return FakeMessageWithMedia()

    async def iter_download(self, media, offset=0):
        self.iter_calls.append(offset)
        for chunk in (b'A' * 300, b'B' * 300):
            yield chunk

    async def send_file(self, target, file, caption, **kwargs):
        pass


class MediaControlsTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp()
        self.cache_dir = os.path.join(self.tmp_dir, 'cache')
        os.makedirs(self.cache_dir)
        self.store = MediaStore(os.path.join(self.tmp_dir, 'media_store.json'))

    def tearDown(self):
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    def _make_manager(self, client):
        manager = bm.BotManager.__new__(bm.BotManager)
        manager.cache_dir = self.cache_dir
        manager.store = self.store
        manager.base_url = 'http://localhost:5000'
        manager.can_remux = False
        manager._remux_locks = {}
        manager._active_tasks = {}
        manager.cfg = {'forward': {'from_bot_id': 1, 'to_group_id': 999}}
        manager.client = client
        return manager

    def _cache_path(self, msg_id, ext='.mp4'):
        return os.path.join(self.cache_dir, f"{msg_id}{ext}")


class PauseDownloadTests(MediaControlsTestCase):
    def test_pause_cancels_active_download_and_marks_paused(self):
        manager = self._make_manager(SlowDownloadClient())
        meta = {'ext': '.mp4', 'size': 1000, 'chat_id': 1, 'name': 'a.mp4'}
        self.store.create('1', meta)

        async def scenario():
            manager._spawn_download_task(FakeMessage(), '1', meta, target_group=999)
            for _ in range(100):
                await asyncio.sleep(0.02)
                if os.path.exists(self._cache_path('1')):
                    break
            return await manager.pause_download('1')

        ok = asyncio.run(scenario())

        self.assertTrue(ok)
        item = self.store.get('1')
        self.assertEqual(item['state'], PAUSED)
        self.assertFalse(item.get('pause_requested'))
        self.assertNotIn('1', manager._active_tasks)
        self.assertTrue(os.path.exists(self._cache_path('1')))  # cache parcial preservado

    def test_pause_returns_false_when_no_active_task(self):
        manager = self._make_manager(FakeTelegramClient())
        self.store.create('1', {'ext': '.mp4', 'name': 'a.mp4'})
        self.store.set_state('1', CACHING)

        ok = asyncio.run(manager.pause_download('1'))
        self.assertFalse(ok)

    def test_pause_returns_false_when_state_not_pausable(self):
        manager = self._make_manager(FakeTelegramClient())
        self.store.create('1', {'ext': '.mp4', 'name': 'a.mp4'})
        self.store.set_state('1', READY)  # nem CACHING nem UPLOADING

        class DummyTask:
            def cancel(self):
                pass

        manager._active_tasks['1'] = DummyTask()

        ok = asyncio.run(manager.pause_download('1'))
        self.assertFalse(ok)


class ResumeDownloadTests(MediaControlsTestCase):
    def test_resume_appends_from_partial_offset_via_iter_download(self):
        client = ResumableClient()
        manager = self._make_manager(client)

        self.store.create('1', {'ext': '.mp4', 'size': 1000, 'chat_id': 111, 'name': 'a.mp4'})
        self.store.set_state('1', PAUSED)
        partial_path = self._cache_path('1')
        with open(partial_path, 'wb') as f:
            f.write(b'\x00' * 400)

        async def scenario():
            ok = await manager.resume_download('1')
            for _ in range(200):
                await asyncio.sleep(0.02)
                item = self.store.get('1')
                if item and item.get('state') == FORWARDED:
                    break
            return ok

        ok = asyncio.run(scenario())

        self.assertTrue(ok)
        self.assertEqual(client.iter_calls, [400])  # retomou exatamente do byte onde parou
        with open(partial_path, 'rb') as f:
            content = f.read()
        self.assertEqual(len(content), 400 + 300 + 300)  # não sobrescreveu o que já existia
        self.assertEqual(self.store.get('1')['state'], FORWARDED)

    def test_resume_returns_false_when_not_paused(self):
        manager = self._make_manager(ResumableClient())
        self.store.create('1', {'ext': '.mp4', 'name': 'a.mp4'})
        self.store.set_state('1', CACHING)

        ok = asyncio.run(manager.resume_download('1'))
        self.assertFalse(ok)

    def test_resume_marks_error_when_message_cannot_be_refetched(self):
        class UnrecoverableClient(FakeTelegramClient):
            async def get_messages(self, chat_id, ids):
                return None

        manager = self._make_manager(UnrecoverableClient())
        self.store.create('1', {'ext': '.mp4', 'chat_id': 111, 'name': 'a.mp4'})
        self.store.set_state('1', PAUSED)

        ok = asyncio.run(manager.resume_download('1'))

        self.assertFalse(ok)
        self.assertEqual(self.store.get('1')['state'], 'error')


class DeleteMediaTests(MediaControlsTestCase):
    def test_delete_cancels_active_task_and_removes_everything(self):
        manager = self._make_manager(SlowDownloadClient())
        meta = {'ext': '.mp4', 'size': 1000, 'chat_id': 1, 'name': 'a.mp4'}
        self.store.create('1', meta)

        async def scenario():
            manager._spawn_download_task(FakeMessage(), '1', meta, target_group=999)
            for _ in range(100):
                await asyncio.sleep(0.02)
                if os.path.exists(self._cache_path('1')):
                    break
            return await manager.delete_media('1')

        ok = asyncio.run(scenario())

        self.assertTrue(ok)
        self.assertIsNone(self.store.get('1'))
        self.assertFalse(os.path.exists(self._cache_path('1')))
        self.assertNotIn('1', manager._active_tasks)

    def test_delete_removes_already_forwarded_item_with_no_active_task(self):
        manager = self._make_manager(FakeTelegramClient())
        self.store.create('1', {'ext': '.mp4', 'name': 'a.mp4'})
        self.store.set_state('1', FORWARDED)
        path = self._cache_path('1')
        with open(path, 'wb') as f:
            f.write(b'x')

        ok = asyncio.run(manager.delete_media('1'))

        self.assertTrue(ok)
        self.assertIsNone(self.store.get('1'))
        self.assertFalse(os.path.exists(path))

    def test_delete_also_removes_remux_sibling(self):
        manager = self._make_manager(FakeTelegramClient())
        self.store.create('1', {'ext': '.mp4', 'name': 'a.mp4', 'remuxed_ext': '.web.mp4'})
        self.store.set_state('1', PAUSED)
        path = self._cache_path('1')
        web_path = path + '.web.mp4'
        with open(path, 'wb') as f:
            f.write(b'x')
        with open(web_path, 'wb') as f:
            f.write(b'y')

        ok = asyncio.run(manager.delete_media('1'))

        self.assertTrue(ok)
        self.assertFalse(os.path.exists(path))
        self.assertFalse(os.path.exists(web_path))

    def test_delete_nonexistent_item_is_a_harmless_noop(self):
        manager = self._make_manager(FakeTelegramClient())
        ok = asyncio.run(manager.delete_media('does-not-exist'))
        self.assertTrue(ok)


if __name__ == '__main__':
    unittest.main()
