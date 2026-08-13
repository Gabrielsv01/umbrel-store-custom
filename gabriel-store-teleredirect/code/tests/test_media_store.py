import os
import tempfile
import shutil
import unittest

from media_store import MediaStore, RECEIVED, CACHING, FORWARDED


class MediaStoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp()
        self.store = MediaStore(os.path.join(self.tmp_dir, 'media_store.json'))

    def tearDown(self):
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    def test_create_starts_as_received(self):
        item = self.store.create('1', {'name': 'a.mp4'})
        self.assertEqual(item['state'], RECEIVED)
        self.assertIsNone(item['last_streamed_at'])

    def test_set_state_transitions(self):
        self.store.create('1', {'name': 'a.mp4'})
        self.store.set_state('1', CACHING)
        self.assertEqual(self.store.get('1')['state'], CACHING)

    def test_set_state_with_error_message(self):
        self.store.create('1', {'name': 'a.mp4'})
        self.store.set_state('1', 'error', error='timeout')
        item = self.store.get('1')
        self.assertEqual(item['state'], 'error')
        self.assertEqual(item['error'], 'timeout')

    def test_update_unknown_id_returns_none(self):
        self.assertIsNone(self.store.update('missing', state=CACHING))

    def test_persists_across_instances(self):
        self.store.create('1', {'name': 'a.mp4'})
        reloaded = MediaStore(self.store.store_file)
        self.assertIsNotNone(reloaded.get('1'))

    def test_purge_removes_entry(self):
        self.store.create('1', {'name': 'a.mp4'})
        self.store.purge('1')
        self.assertIsNone(self.store.get('1'))

    def test_find_stale_forwarded_respects_retention(self):
        self.store.create('1', {'name': 'a.mp4'})
        self.store.set_state('1', FORWARDED)
        self.store.update('1', forwarded_at=0)  # "há muito tempo"

        self.store.create('2', {'name': 'b.mp4'})
        self.store.set_state('2', FORWARDED)
        self.store.mark_streamed('2')  # acesso recente

        stale = self.store.find_stale_forwarded(retention_seconds=60)
        self.assertIn('1', stale)
        self.assertNotIn('2', stale)

    def test_find_stale_forwarded_ignores_non_forwarded(self):
        self.store.create('1', {'name': 'a.mp4'})
        self.store.set_state('1', CACHING)
        self.assertEqual(self.store.find_stale_forwarded(retention_seconds=0), [])


if __name__ == '__main__':
    unittest.main()
