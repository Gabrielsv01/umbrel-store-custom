import asyncio
import contextlib
import os
import shutil
import tempfile
import unittest

import bot_manager as bm
from media_store import MediaStore, CACHING, READY, UPLOADING, FORWARDED, ERROR, PAUSED


class FakeSentMessage:
    def __init__(self, msg_id):
        self.id = msg_id


class FakeTelegramClient:
    """Simula só a parte do Telethon usada pela mensagem de status:
    send_message (retorna algo com .id), edit_message e delete_messages —
    a nova arquitetura usa (chat, message_id) armazenados no store, não o
    objeto Message em memória."""

    def __init__(self, send_message_exc=None, edit_exc=None):
        self._next_id = 100
        self.send_message_exc = send_message_exc
        self.edit_exc = edit_exc
        self.edits = []  # [(chat, message_id, text), ...]
        self.deleted = []  # [(chat, [message_ids]), ...]
        self.sent = []  # [(target, text), ...]

    async def send_message(self, target, text):
        if self.send_message_exc:
            raise self.send_message_exc
        self.sent.append((target, text))
        self._next_id += 1
        return FakeSentMessage(self._next_id)

    async def edit_message(self, chat, message_id, text):
        if self.edit_exc:
            raise self.edit_exc
        self.edits.append((chat, message_id, text))

    async def delete_messages(self, chat, message_ids):
        self.deleted.append((chat, message_ids))


class SendStatusMessageTests(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp()
        self.store = MediaStore(os.path.join(self.tmp_dir, 'media_store.json'))

    def tearDown(self):
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    def _make_manager(self, client):
        manager = bm.BotManager.__new__(bm.BotManager)
        manager.client = client
        manager.store = self.store
        return manager

    def test_saves_chat_and_message_id_on_success(self):
        client = FakeTelegramClient()
        manager = self._make_manager(client)
        self.store.create('1', {'name': 'filme.mp4'})

        asyncio.run(manager._send_status_message(999, '1', {'name': 'filme.mp4'}))

        item = self.store.get('1')
        self.assertEqual(item['status_chat_id'], 999)
        self.assertIsNotNone(item['status_message_id'])

    def test_uses_caption_instead_of_filename_when_available(self):
        # Sem isso, a mensagem de status só mostrava o nome técnico do
        # arquivo (ex.: "1460575605.mp4"), descartando a legenda que o
        # bot de fato escreveu sobre o vídeo (título, descrição etc.).
        client = FakeTelegramClient()
        manager = self._make_manager(client)
        meta = {'name': '1460575605.mp4', 'caption': 'Filme X (2024) - Legendado'}
        self.store.create('1', meta)

        asyncio.run(manager._send_status_message(999, '1', meta))

        self.assertEqual(len(client.sent), 1)
        text = client.sent[0][1]
        self.assertIn('Filme X (2024) - Legendado', text)
        self.assertNotIn('1460575605.mp4', text)

    def test_falls_back_to_filename_when_no_caption(self):
        client = FakeTelegramClient()
        manager = self._make_manager(client)
        meta = {'name': '1460575605.mp4'}
        self.store.create('1', meta)

        asyncio.run(manager._send_status_message(999, '1', meta))

        self.assertIn('1460575605.mp4', client.sent[0][1])

    def test_does_not_raise_and_saves_nothing_when_send_fails(self):
        client = FakeTelegramClient(send_message_exc=RuntimeError('grupo inacessível'))
        manager = self._make_manager(client)
        self.store.create('1', {'name': 'filme.mp4'})

        asyncio.run(manager._send_status_message(999, '1', {'name': 'filme.mp4'}))  # não deve levantar

        self.assertIsNone(self.store.get('1').get('status_message_id'))


class EditAndDeleteStatusMessageTests(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp()
        self.store = MediaStore(os.path.join(self.tmp_dir, 'media_store.json'))

    def tearDown(self):
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    def _make_manager(self, client):
        manager = bm.BotManager.__new__(bm.BotManager)
        manager.client = client
        manager.store = self.store
        return manager

    def test_edit_uses_stored_chat_and_message_id(self):
        client = FakeTelegramClient()
        manager = self._make_manager(client)
        self.store.create('1', {'name': 'a.mp4'})
        self.store.update('1', status_chat_id=999, status_message_id=42)

        asyncio.run(manager._edit_status_message('1', 'novo texto'))

        self.assertEqual(client.edits, [(999, 42, 'novo texto')])

    def test_edit_does_nothing_when_no_status_message_recorded(self):
        client = FakeTelegramClient()
        manager = self._make_manager(client)
        self.store.create('1', {'name': 'a.mp4'})

        asyncio.run(manager._edit_status_message('1', 'texto'))  # não deve levantar

        self.assertEqual(client.edits, [])

    def test_edit_failure_does_not_raise(self):
        client = FakeTelegramClient(edit_exc=RuntimeError('falhou'))
        manager = self._make_manager(client)
        self.store.create('1', {'name': 'a.mp4'})
        self.store.update('1', status_chat_id=999, status_message_id=42)

        asyncio.run(manager._edit_status_message('1', 'texto'))  # não deve levantar

    def test_delete_uses_stored_chat_and_message_id(self):
        client = FakeTelegramClient()
        manager = self._make_manager(client)
        self.store.create('1', {'name': 'a.mp4'})
        self.store.update('1', status_chat_id=999, status_message_id=42)

        asyncio.run(manager._delete_status_message('1'))

        self.assertEqual(client.deleted, [(999, [42])])


class StatusMessageLoopTests(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp()
        self.store = MediaStore(os.path.join(self.tmp_dir, 'media_store.json'))
        self.path = os.path.join(self.tmp_dir, '1.mp4')
        self._orig_interval = bm.STATUS_MESSAGE_INTERVAL_SECONDS
        bm.STATUS_MESSAGE_INTERVAL_SECONDS = 0.02

    def tearDown(self):
        bm.STATUS_MESSAGE_INTERVAL_SECONDS = self._orig_interval
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    def _make_manager(self, client=None):
        manager = bm.BotManager.__new__(bm.BotManager)
        manager.client = client or FakeTelegramClient()
        manager.store = self.store
        return manager

    def _seed_with_status(self, msg_id, **fields):
        self.store.create(msg_id, {'name': 'a.mp4', 'size': 1000, **fields})
        self.store.update(msg_id, status_chat_id=999, status_message_id=42)

    async def _run_for_a_bit(self, manager, seconds=0.15):
        task = asyncio.create_task(manager._status_message_loop('1', self.path))
        await asyncio.sleep(seconds)
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task

    def test_does_nothing_when_no_status_message_recorded(self):
        manager = self._make_manager()
        self.store.create('1', {'name': 'a.mp4', 'size': 1000})
        self.store.set_state('1', CACHING)
        asyncio.run(asyncio.wait_for(manager._status_message_loop('1', self.path), timeout=1))

    def test_edits_with_download_progress_while_caching(self):
        client = FakeTelegramClient()
        manager = self._make_manager(client)
        self._seed_with_status('1')
        self.store.set_state('1', CACHING)
        with open(self.path, 'wb') as f:
            f.write(b'x' * 250)  # 25%

        asyncio.run(self._run_for_a_bit(manager))

        self.assertTrue(any('Baixando' in e[2] and '25%' in e[2] for e in client.edits))

    def test_progress_edit_uses_caption_instead_of_filename_when_available(self):
        client = FakeTelegramClient()
        manager = self._make_manager(client)
        self._seed_with_status('1', caption='Filme X (2024) - Legendado')
        self.store.set_state('1', CACHING)
        with open(self.path, 'wb') as f:
            f.write(b'x' * 250)

        asyncio.run(self._run_for_a_bit(manager))

        self.assertTrue(any('Filme X (2024) - Legendado' in e[2] for e in client.edits))
        self.assertFalse(any('a.mp4' in e[2] for e in client.edits))

    def test_shows_processing_message_while_ready(self):
        client = FakeTelegramClient()
        manager = self._make_manager(client)
        self._seed_with_status('1')
        self.store.set_state('1', READY)

        asyncio.run(self._run_for_a_bit(manager))

        self.assertTrue(any('Processando' in e[2] for e in client.edits))

    def test_edits_with_upload_progress_while_uploading(self):
        client = FakeTelegramClient()
        manager = self._make_manager(client)
        self._seed_with_status('1')
        self.store.set_state('1', UPLOADING)
        self.store.update('1', uploaded_bytes=600, upload_total_bytes=1000)

        asyncio.run(self._run_for_a_bit(manager))

        self.assertTrue(any('Enviando ao grupo' in e[2] and '60%' in e[2] for e in client.edits))

    def test_stops_without_editing_on_terminal_state(self):
        client = FakeTelegramClient()
        manager = self._make_manager(client)
        self._seed_with_status('1')
        self.store.set_state('1', FORWARDED)

        asyncio.run(asyncio.wait_for(manager._status_message_loop('1', self.path), timeout=1))
        self.assertEqual(client.edits, [])

    def test_edit_failure_does_not_crash_the_loop(self):
        client = FakeTelegramClient(edit_exc=RuntimeError('falha simulada'))
        manager = self._make_manager(client)
        self._seed_with_status('1')
        self.store.set_state('1', CACHING)

        asyncio.run(self._run_for_a_bit(manager))  # não deve propagar exceção


class FinalizeStatusMessageTests(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp()
        self.store = MediaStore(os.path.join(self.tmp_dir, 'media_store.json'))

    def tearDown(self):
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    def _make_manager(self, client=None):
        manager = bm.BotManager.__new__(bm.BotManager)
        manager.client = client or FakeTelegramClient()
        manager.store = self.store
        return manager

    def _seed_with_status(self, msg_id, **fields):
        self.store.create(msg_id, {'name': 'a.mp4', **fields})
        self.store.update(msg_id, status_chat_id=999, status_message_id=42)

    def test_deletes_message_when_forwarded(self):
        client = FakeTelegramClient()
        manager = self._make_manager(client)
        self._seed_with_status('1')
        self.store.set_state('1', FORWARDED)

        asyncio.run(manager._finalize_status_message('1'))

        self.assertEqual(client.deleted, [(999, [42])])

    def test_edits_to_error_message_when_error(self):
        client = FakeTelegramClient()
        manager = self._make_manager(client)
        self._seed_with_status('1')
        self.store.set_state('1', ERROR, error='timeout no download')

        asyncio.run(manager._finalize_status_message('1'))

        self.assertEqual(client.deleted, [])
        self.assertTrue(any('timeout no download' in e[2] for e in client.edits))

    def test_edits_to_paused_message_when_paused(self):
        client = FakeTelegramClient()
        manager = self._make_manager(client)
        self._seed_with_status('1')
        self.store.set_state('1', PAUSED)

        asyncio.run(manager._finalize_status_message('1'))

        self.assertTrue(any('Pausado' in e[2] for e in client.edits))

    def test_does_nothing_when_no_status_message_recorded(self):
        manager = self._make_manager()
        self.store.create('1', {'name': 'a.mp4'})
        self.store.set_state('1', FORWARDED)
        asyncio.run(manager._finalize_status_message('1'))  # não deve levantar


class FakeMessage:
    def __init__(self):
        self.raw_text = None


class DownloadToCacheStatusIntegrationTests(unittest.TestCase):
    """Ponta a ponta: a mensagem de status precisa terminar apagada em
    caso de sucesso, ou editada mostrando o erro em caso de falha —
    exatamente o que _download_to_cache aciona no finally."""

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
        manager.client = client
        return manager

    def test_status_message_is_deleted_on_success(self):
        class Client(FakeTelegramClient):
            async def download_media(self, msg, file):
                with open(file, 'wb') as f:
                    f.write(b'\x00' * 1000)

            async def send_file(self, target, file, caption, **kwargs):
                pass

        manager = self._make_manager(Client())
        meta = {'ext': '.mp4', 'size': 1000, 'chat_id': 1, 'name': 'a.mp4'}
        self.store.create('1', meta)
        asyncio.run(manager._download_to_cache(FakeMessage(), '1', meta, target_group=999))

        self.assertEqual(self.store.get('1')['state'], 'forwarded')
        self.assertEqual(manager.client.deleted, [(999, [manager.client._next_id])])

    def test_status_message_shows_error_on_failure(self):
        class Client(FakeTelegramClient):
            async def download_media(self, msg, file):
                raise RuntimeError('conexão perdida')

            async def send_file(self, target, file, caption, **kwargs):
                pass

        manager = self._make_manager(Client())
        meta = {'ext': '.mp4', 'size': 1000, 'chat_id': 1, 'name': 'a.mp4'}
        self.store.create('1', meta)
        asyncio.run(manager._download_to_cache(FakeMessage(), '1', meta, target_group=999))

        self.assertEqual(self.store.get('1')['state'], 'error')
        self.assertEqual(manager.client.deleted, [])
        self.assertTrue(any('conexão perdida' in e[2] for e in manager.client.edits))


if __name__ == '__main__':
    unittest.main()
