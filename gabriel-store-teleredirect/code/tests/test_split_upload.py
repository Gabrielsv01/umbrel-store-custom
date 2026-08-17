import asyncio
import math
import os
import shutil
import tempfile
import unittest
import unittest.mock

from telethon.tl.types import DocumentAttributeVideo

import bot_manager as bm
import config
from media_store import MediaStore


class GetUploadMaxPartSizeBytesTests(unittest.TestCase):
    def test_default_is_1900mb_in_bytes(self):
        self.assertEqual(config.get_upload_max_part_size_bytes({}), 1900 * 1024 * 1024)

    def test_reads_from_upload_max_part_size_mb(self):
        cfg = {'upload': {'max_part_size_mb': 500}}
        self.assertEqual(config.get_upload_max_part_size_bytes(cfg), 500 * 1024 * 1024)


class NeedsSplitTests(unittest.TestCase):
    """_needs_split decide, ANTES de tentar reenviar, se o arquivo em cache
    precisa ser dividido em partes — só quando dá pra calcular os cortes
    (duração conhecida) e executá-los (ffmpeg disponível)."""

    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp()
        self.path = os.path.join(self.tmp_dir, 'video.mp4')

    def tearDown(self):
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    def _write(self, size):
        with open(self.path, 'wb') as f:
            f.write(b'x' * size)

    def _make_manager(self, can_remux, max_part_size_bytes):
        manager = bm.BotManager.__new__(bm.BotManager)
        manager.can_remux = can_remux
        manager.max_part_size_bytes = max_part_size_bytes
        return manager

    def test_false_when_ffmpeg_unavailable_even_if_oversized(self):
        self._write(2000)
        manager = self._make_manager(can_remux=False, max_part_size_bytes=1000)
        self.assertFalse(manager._needs_split(self.path, {'duration': 60}))

    def test_false_when_duration_unknown_even_if_oversized(self):
        self._write(2000)
        manager = self._make_manager(can_remux=True, max_part_size_bytes=1000)
        self.assertFalse(manager._needs_split(self.path, {'duration': None}))

    def test_false_when_file_is_under_the_limit(self):
        self._write(500)
        manager = self._make_manager(can_remux=True, max_part_size_bytes=1000)
        self.assertFalse(manager._needs_split(self.path, {'duration': 60}))

    def test_true_when_oversized_with_duration_and_ffmpeg_available(self):
        self._write(1500)
        manager = self._make_manager(can_remux=True, max_part_size_bytes=1000)
        self.assertTrue(manager._needs_split(self.path, {'duration': 60}))

    def test_uses_class_default_when_instance_never_set_it(self):
        # BotManager.__new__ pula __init__ (mesmo padrão dos outros testes
        # deste arquivo) — sem setar max_part_size_bytes explicitamente,
        # precisa cair no default de classe (DEFAULT_MAX_PART_SIZE_BYTES),
        # não estourar AttributeError.
        self._write(1000)
        manager = bm.BotManager.__new__(bm.BotManager)
        manager.can_remux = True
        self.assertFalse(manager._needs_split(self.path, {'duration': 60}))


class RecordingClient:
    def __init__(self):
        self.sent = []

    async def send_file(self, target, file, caption, attributes=None, progress_callback=None, **kwargs):
        if progress_callback:
            result = progress_callback(100, 100)
            if asyncio.iscoroutine(result):
                await result
        self.sent.append({'target': target, 'file': file, 'caption': caption, 'attributes': attributes})
        return unittest.mock.Mock(id=len(self.sent))


class SendFileInPartsTests(unittest.TestCase):
    """_send_file_in_parts é chamado só depois que _needs_split confirmou
    que era necessário — cobre o corte (mockado, já testado à parte em
    test_remux.py) e o reenvio de cada parte com legenda/atributos
    corretos, sem deixar arquivo temporário pra trás."""

    TOTAL_BYTES = 2500
    MAX_PART_SIZE_BYTES = 1000  # effective_capacity = 900 -> ceil(2500/900) = 3 partes

    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp()
        self.file_path = os.path.join(self.tmp_dir, '1.mp4')
        with open(self.file_path, 'wb') as f:
            f.write(b'x' * self.TOTAL_BYTES)
        self.store = MediaStore(os.path.join(self.tmp_dir, 'media_store.json'))
        self.store.create('1', {'name': 'filme.mp4'})
        self.created_part_paths = []

    def tearDown(self):
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    def _fake_split(self, src, dst, start, duration):
        with open(dst, 'wb') as f:
            f.write(b'p')
        self.created_part_paths.append(dst)

    def _make_manager(self, client):
        manager = bm.BotManager.__new__(bm.BotManager)
        manager.max_part_size_bytes = self.MAX_PART_SIZE_BYTES
        manager.store = self.store
        manager.client = client
        return manager

    def _expected_num_parts(self):
        effective_capacity = int(self.MAX_PART_SIZE_BYTES * bm.SPLIT_SAFETY_FACTOR)
        return max(2, math.ceil(self.TOTAL_BYTES / effective_capacity))

    def test_sends_one_message_per_part_with_numbered_captions(self):
        client = RecordingClient()
        manager = self._make_manager(client)
        meta = {'name': 'filme.mp4', 'duration': 300, 'width': 1280, 'height': 720}

        with unittest.mock.patch('remux.split_segment_to_mp4', side_effect=self._fake_split):
            asyncio.run(manager._send_file_in_parts('1', meta, target_group=999, file_path=self.file_path))

        expected = self._expected_num_parts()
        self.assertEqual(len(client.sent), expected)
        for i, sent in enumerate(client.sent):
            self.assertEqual(sent['target'], 999)
            self.assertIn(f"Parte {i + 1}/{expected}", sent['caption'])

    def test_each_part_gets_its_own_proportional_duration_not_the_full_video(self):
        client = RecordingClient()
        manager = self._make_manager(client)
        meta = {'name': 'filme.mp4', 'duration': 300, 'width': 1280, 'height': 720}

        with unittest.mock.patch('remux.split_segment_to_mp4', side_effect=self._fake_split):
            asyncio.run(manager._send_file_in_parts('1', meta, target_group=999, file_path=self.file_path))

        num_parts = self._expected_num_parts()
        segment_seconds = 300 / num_parts
        first_video_attr = next(
            a for a in client.sent[0]['attributes'] if isinstance(a, DocumentAttributeVideo)
        )
        # A parte individual dura só a fração proporcional, nunca os 300s
        # do vídeo original inteiro — regressão óbvia seria esquecer o
        # duration_override e reusar meta['duration'] pra cada parte.
        self.assertEqual(first_video_attr.duration, int(segment_seconds))
        self.assertNotEqual(first_video_attr.duration, 300)

    def test_part_filenames_are_distinct_and_reference_the_part_number(self):
        client = RecordingClient()
        manager = self._make_manager(client)
        meta = {'name': 'filme.mp4', 'duration': 300, 'width': 1280, 'height': 720}

        with unittest.mock.patch('remux.split_segment_to_mp4', side_effect=self._fake_split):
            asyncio.run(manager._send_file_in_parts('1', meta, target_group=999, file_path=self.file_path))

        from telethon.tl.types import DocumentAttributeFilename

        names = []
        for sent in client.sent:
            filename_attr = next(a for a in sent['attributes'] if isinstance(a, DocumentAttributeFilename))
            names.append(filename_attr.file_name)

        self.assertEqual(len(names), len(set(names)))  # sem nomes repetidos
        for i, name in enumerate(names):
            self.assertIn(f"Parte {i + 1}", name)

    def test_temporary_part_files_are_removed_after_successful_upload(self):
        client = RecordingClient()
        manager = self._make_manager(client)
        meta = {'name': 'filme.mp4', 'duration': 300, 'width': 1280, 'height': 720}

        with unittest.mock.patch('remux.split_segment_to_mp4', side_effect=self._fake_split):
            asyncio.run(manager._send_file_in_parts('1', meta, target_group=999, file_path=self.file_path))

        self.assertTrue(self.created_part_paths)  # a fixture realmente criou arquivos
        for path in self.created_part_paths:
            self.assertFalse(os.path.exists(path))
        # O original (usado pelo player web) nunca é tocado por este método.
        self.assertTrue(os.path.exists(self.file_path))

    def test_temporary_part_files_are_removed_even_if_a_send_fails_midway(self):
        class FailingClient(RecordingClient):
            async def send_file(self, *args, **kwargs):
                raise RuntimeError('grupo inacessível')

        manager = self._make_manager(FailingClient())
        meta = {'name': 'filme.mp4', 'duration': 300, 'width': 1280, 'height': 720}

        with unittest.mock.patch('remux.split_segment_to_mp4', side_effect=self._fake_split):
            with self.assertRaises(RuntimeError):
                asyncio.run(manager._send_file_in_parts('1', meta, target_group=999, file_path=self.file_path))

        for path in self.created_part_paths:
            self.assertFalse(os.path.exists(path))

    def test_store_tracks_which_part_is_uploading_for_the_status_message(self):
        client = RecordingClient()
        manager = self._make_manager(client)
        meta = {'name': 'filme.mp4', 'duration': 300, 'width': 1280, 'height': 720}

        with unittest.mock.patch('remux.split_segment_to_mp4', side_effect=self._fake_split):
            asyncio.run(manager._send_file_in_parts('1', meta, target_group=999, file_path=self.file_path))

        item = self.store.get('1')
        num_parts = self._expected_num_parts()
        self.assertEqual(item['upload_part_count'], num_parts)
        self.assertEqual(item['upload_part'], num_parts)  # última atualização registrada = última parte


if __name__ == '__main__':
    unittest.main()
