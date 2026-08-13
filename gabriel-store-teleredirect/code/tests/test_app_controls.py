import asyncio
import threading
import unittest

import bot_manager as bm


class FakeBotManagerWithLoop:
    """Simula o BotManager real o suficiente pra testar a coordenação
    entre threads (Flask síncrono -> event loop dedicado do bot via
    run_coroutine_threadsafe) — não mocka pause_download/resume_download/
    delete_media em si (esses já têm testes próprios em
    test_media_controls.py), só a ponte entre as duas threads."""

    def __init__(self):
        self.loop = asyncio.new_event_loop()
        self._thread = threading.Thread(target=self.loop.run_forever, daemon=True)
        self._thread.start()
        self.calls = []

    def stop(self):
        self.loop.call_soon_threadsafe(self.loop.stop)
        self._thread.join(timeout=2)

    async def pause_download(self, msg_id):
        self.calls.append(('pause', msg_id))
        await asyncio.sleep(0)
        return msg_id == 'ok'

    async def resume_download(self, msg_id):
        self.calls.append(('resume', msg_id))
        await asyncio.sleep(0)
        return msg_id == 'ok'

    async def delete_media(self, msg_id):
        self.calls.append(('delete', msg_id))
        await asyncio.sleep(0)
        return True

    async def slow_action(self, msg_id):
        await asyncio.sleep(5)
        return True

    def list_media(self):
        return []


_real_bot_manager_cls = bm.BotManager
bm.BotManager = FakeBotManagerWithLoop
import app as app_module  # noqa: E402
bm.BotManager = _real_bot_manager_cls


class AppControlsRoutesTests(unittest.TestCase):
    def setUp(self):
        self.fake = FakeBotManagerWithLoop()
        app_module.bot_manager = self.fake
        self.client = app_module.app.test_client()

    def tearDown(self):
        self.fake.stop()

    def test_pause_route_runs_on_bot_loop_and_returns_ok_true(self):
        resp = self.client.post('/api/media/ok/pause')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.get_json(), {'ok': True})
        self.assertIn(('pause', 'ok'), self.fake.calls)

    def test_pause_route_returns_ok_false_when_manager_declines(self):
        resp = self.client.post('/api/media/nope/pause')
        self.assertEqual(resp.get_json(), {'ok': False})

    def test_resume_route(self):
        resp = self.client.post('/api/media/ok/resume')
        self.assertEqual(resp.get_json(), {'ok': True})
        self.assertIn(('resume', 'ok'), self.fake.calls)

    def test_delete_route_uses_http_delete_method(self):
        resp = self.client.delete('/api/media/ok')
        self.assertEqual(resp.get_json(), {'ok': True})
        self.assertIn(('delete', 'ok'), self.fake.calls)

    def test_run_on_bot_loop_times_out_gracefully_on_slow_coroutine(self):
        with self.assertRaises(Exception):
            app_module._run_on_bot_loop(self.fake.slow_action('x'), timeout=0.05)


if __name__ == '__main__':
    unittest.main()
