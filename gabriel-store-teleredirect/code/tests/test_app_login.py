import os
import shutil
import tempfile
import unittest
from unittest import mock

from telethon.errors import SessionPasswordNeededError

import bot_manager as bm

_real_bot_manager_cls = bm.BotManager


class FakeBotManager:
    """Usada só pra confirmar QUE app.py criou uma instância nova após o
    login — não testa o BotManager real (isso já tem cobertura própria)."""

    def __init__(self):
        self.can_remux = True

    def list_media(self):
        return []


bm.BotManager = FakeBotManager
import app as app_module  # noqa: E402
bm.BotManager = _real_bot_manager_cls


class FakeLoginTelegramClient:
    def __init__(self, send_code_exc=None, sign_in_exc=None):
        self.send_code_exc = send_code_exc
        self.sign_in_exc = sign_in_exc
        self.connected = False
        self.disconnected = False
        self.sign_in_calls = []

    async def connect(self):
        self.connected = True

    async def send_code_request(self, phone):
        if self.send_code_exc:
            raise self.send_code_exc

    async def sign_in(self, phone=None, code=None, password=None):
        self.sign_in_calls.append({'phone': phone, 'code': code, 'password': password})
        if self.sign_in_exc:
            raise self.sign_in_exc

    def disconnect(self):
        # Como o Telethon real: método síncrono (ver bug corrigido em
        # login_web.py/app.py — client.disconnect() não é uma coroutine
        # normal quando o loop não está rodando).
        self.disconnected = True

    @property
    def session(self):
        return self

    def save(self):
        return 'sessao-fake-serializada'


class AppLoginFlowTests(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp()
        app_module.SESSION_PATH = os.path.join(self.tmp_dir, 'string.session')
        app_module.bot_manager = None
        app_module._login_state['client'] = None
        app_module._login_state['phone'] = None
        app_module.BotManager = FakeBotManager
        self.client = app_module.app.test_client()

    def tearDown(self):
        shutil.rmtree(self.tmp_dir, ignore_errors=True)
        app_module.bot_manager = None
        app_module.BotManager = _real_bot_manager_cls  # não deixa vazar pra outros arquivos de teste
        app_module._login_state['client'] = None
        app_module._login_state['phone'] = None

    # ---------- Gate do before_request ----------
    def test_root_redirects_to_login_when_no_session(self):
        resp = self.client.get('/', follow_redirects=False)
        self.assertEqual(resp.status_code, 302)
        self.assertIn('/login', resp.headers['Location'])

    def test_api_media_also_redirects_when_no_session(self):
        resp = self.client.get('/api/media', follow_redirects=False)
        self.assertEqual(resp.status_code, 302)

    def test_api_logs_is_reachable_without_session(self):
        # /api/logs não depende do BotManager — precisa funcionar mesmo sem
        # sessão, já que é justamente pra diagnosticar problemas no login.
        resp = self.client.get('/api/logs', follow_redirects=False)
        self.assertEqual(resp.status_code, 200)

    def test_login_page_itself_is_reachable_without_session(self):
        resp = self.client.get('/login')
        self.assertEqual(resp.status_code, 200)
        self.assertIn(b'name="phone"', resp.data)

    def test_root_works_normally_once_bot_manager_exists(self):
        app_module.bot_manager = FakeBotManager()
        resp = self.client.get('/', follow_redirects=False)
        self.assertEqual(resp.status_code, 200)

    def test_login_page_redirects_to_root_once_already_logged_in(self):
        app_module.bot_manager = FakeBotManager()
        resp = self.client.get('/login', follow_redirects=False)
        self.assertEqual(resp.status_code, 302)
        self.assertIn('/', resp.headers['Location'])

    # ---------- Fluxo completo ----------
    def test_send_code_success_shows_code_form(self):
        fake = FakeLoginTelegramClient()
        with mock.patch('app._new_login_client', return_value=fake):
            resp = self.client.post('/login/send_code', data={'phone': '+5511999999999'})

        self.assertIn(b'name="code"', resp.data)
        self.assertTrue(fake.connected)
        self.assertIs(app_module._login_state['client'], fake)

    def test_send_code_missing_phone_shows_error(self):
        resp = self.client.post('/login/send_code', data={'phone': ''})
        self.assertIn(b'Informe o telefone', resp.data)

    def test_send_code_telegram_failure_keeps_phone_form(self):
        fake = FakeLoginTelegramClient(send_code_exc=RuntimeError('numero invalido'))
        with mock.patch('app._new_login_client', return_value=fake):
            resp = self.client.post('/login/send_code', data={'phone': '+5511999999999'})

        self.assertIn(b'Falha ao enviar o c\xc3\xb3digo', resp.data)
        self.assertIn(b'name="phone"', resp.data)

    def test_send_code_client_creation_failure_shows_error_instead_of_500(self):
        # Regressão: _new_login_client() (que lê config.yaml/env vars) rodava
        # fora do try/except — config ausente/inválido (ex.: telethon.api_id
        # não numérico) virava um 500 cru em vez da página de erro estilizada.
        with mock.patch('app._new_login_client', side_effect=TypeError("int() argument must be a string")):
            resp = self.client.post('/login/send_code', data={'phone': '+5511999999999'})

        self.assertEqual(resp.status_code, 200)
        self.assertIn(b'Falha ao enviar o c\xc3\xb3digo', resp.data)
        self.assertIn(b'name="phone"', resp.data)

    def test_sign_in_success_creates_bot_manager_and_redirects_to_index(self):
        fake = FakeLoginTelegramClient()
        app_module._login_state['client'] = fake
        app_module._login_state['phone'] = '+5511999999999'

        resp = self.client.post('/login/sign_in', data={'code': '12345'}, follow_redirects=False)

        self.assertEqual(resp.status_code, 302)
        self.assertIn('/', resp.headers['Location'])
        self.assertIsInstance(app_module.bot_manager, FakeBotManager)
        self.assertTrue(os.path.exists(app_module.SESSION_PATH))
        with open(app_module.SESSION_PATH) as f:
            self.assertEqual(f.read(), 'sessao-fake-serializada')
        self.assertTrue(fake.disconnected)

    def test_sign_in_with_2fa_shows_password_form_and_does_not_create_bot_manager_yet(self):
        fake = FakeLoginTelegramClient(sign_in_exc=SessionPasswordNeededError(request=None))
        app_module._login_state['client'] = fake
        app_module._login_state['phone'] = '+5511999999999'

        resp = self.client.post('/login/sign_in', data={'code': '12345'})

        self.assertIn(b'name="password"', resp.data)
        self.assertIsNone(app_module.bot_manager)

    def test_sign_in_invalid_code_keeps_code_form(self):
        fake = FakeLoginTelegramClient(sign_in_exc=RuntimeError('codigo invalido'))
        app_module._login_state['client'] = fake
        app_module._login_state['phone'] = '+5511999999999'

        resp = self.client.post('/login/sign_in', data={'code': 'errado'})

        self.assertIn(b'C\xc3\xb3digo inv\xc3\xa1lido', resp.data)
        self.assertIn(b'name="code"', resp.data)

    def test_password_success_creates_bot_manager(self):
        fake = FakeLoginTelegramClient()
        app_module._login_state['client'] = fake
        app_module._login_state['phone'] = '+5511999999999'

        resp = self.client.post('/login/password', data={'password': 'minha-senha-2fa'}, follow_redirects=False)

        self.assertEqual(resp.status_code, 302)
        self.assertEqual(fake.sign_in_calls[-1]['password'], 'minha-senha-2fa')
        self.assertIsInstance(app_module.bot_manager, FakeBotManager)

    def test_password_wrong_keeps_password_form(self):
        fake = FakeLoginTelegramClient(sign_in_exc=RuntimeError('senha errada'))
        app_module._login_state['client'] = fake
        app_module._login_state['phone'] = '+5511999999999'

        resp = self.client.post('/login/password', data={'password': 'errada'})

        self.assertIn(b'Senha incorreta', resp.data)
        self.assertIn(b'name="password"', resp.data)

    def test_sign_in_without_prior_send_code_redirects_to_login(self):
        resp = self.client.post('/login/sign_in', data={'code': '12345'}, follow_redirects=False)
        self.assertEqual(resp.status_code, 302)
        self.assertIn('/login', resp.headers['Location'])

    def test_password_without_prior_state_redirects_to_login(self):
        resp = self.client.post('/login/password', data={'password': 'x'}, follow_redirects=False)
        self.assertEqual(resp.status_code, 302)
        self.assertIn('/login', resp.headers['Location'])


if __name__ == '__main__':
    unittest.main()
