import os
import shutil
import struct
import tempfile
import time
import unittest

import bot_manager as bm


def _mp4_box(fourcc, body=b''):
    return struct.pack('>I', 8 + len(body)) + fourcc + body


def fake_faststart_mp4_header():
    """MP4 minimalista, mas estruturalmente válido: ftyp seguido de moov
    logo no início — remux.needs_remux() deve reconhecer como já
    reproduzível, sem precisar de remux."""
    return _mp4_box(b'ftyp', b'isom' + b'\x00' * 12) + _mp4_box(b'moov', b'\x00' * 64)


class FakeBotManager:
    """Substitui o BotManager real (que conectaria ao Telegram de verdade)
    para testar só as rotas Flask de streaming/progresso, isoladamente."""

    def __init__(self):
        self._items = {}

    def seed(self, msg_id, **fields):
        self._items[str(msg_id)] = fields

    def get_media_info(self, msg_id):
        return self._items.get(str(msg_id))

    def mark_streamed(self, msg_id):
        pass

    def list_media(self):
        return list(self._items.values())


# app.py instancia BotManager() no momento do import — trocamos a classe só
# durante esse import pontual e devolvemos a original em seguida, pra não
# vazar esse patch para outros arquivos de teste que importam bot_manager
# (módulos são compartilhados/cacheados entre todos os testes do processo).
_real_bot_manager_cls = bm.BotManager
bm.BotManager = FakeBotManager
import app as app_module  # noqa: E402
bm.BotManager = _real_bot_manager_cls

# _wait_for_bytes usa esses valores como default de argumento, resolvido na
# definição da função — reatribuir o módulo não é suficiente por si só.
app_module.WAIT_FOR_BYTE_TIMEOUT = 0.4
app_module._wait_for_bytes.__defaults__ = (0.4,)


class StreamProxyTests(unittest.TestCase):
    MSG_ID = '999'
    EXT = '.mp4'
    TOTAL_SIZE = 1000
    CACHED_SIZE = 300

    def setUp(self):
        self.tmp_cache = tempfile.mkdtemp()
        app_module.CACHE_DIR = self.tmp_cache

        self.fake = FakeBotManager()
        app_module.bot_manager = self.fake

        self.cache_path = os.path.join(self.tmp_cache, f"{self.MSG_ID}{self.EXT}")
        with open(self.cache_path, 'wb') as f:
            f.write((bytes(range(256)) * (self.CACHED_SIZE // 256 + 1))[: self.CACHED_SIZE])

        self.fake.seed(
            self.MSG_ID, ext=self.EXT, size=self.TOTAL_SIZE, mime='video/mp4',
            duration=120, state='caching',
        )
        self.client = app_module.app.test_client()

    def tearDown(self):
        shutil.rmtree(self.tmp_cache, ignore_errors=True)

    def test_range_within_cache_returns_partial_content(self):
        resp = self.client.get(f"/stream/{self.MSG_ID}{self.EXT}", headers={"Range": "bytes=0-99"})
        self.assertEqual(resp.status_code, 206)
        self.assertEqual(resp.headers.get('Content-Length'), '100')
        self.assertEqual(resp.headers['Content-Type'], 'video/mp4')
        self.assertEqual(len(resp.data), 100)

    def test_content_range_total_reflects_current_disk_size_not_eventual_full_size(self):
        # Bug real: declarar o tamanho FINAL esperado (ex.: 1000, vindo dos
        # metadados) enquanto só CACHED_SIZE existe faz o navegador achar
        # que pode buscar (via prefetch interno, fora do nosso controle)
        # qualquer trecho dentro desse total — e um request assim batendo
        # além do cache real virava um 503 que o <video> tratava como erro
        # fatal de rede ("o player fica quebrado").
        resp = self.client.get(f"/stream/{self.MSG_ID}{self.EXT}", headers={"Range": "bytes=0-99"})
        self.assertEqual(resp.headers['Content-Range'], f'bytes 0-99/{self.CACHED_SIZE}')
        self.assertNotIn(str(self.TOTAL_SIZE), resp.headers['Content-Range'])

    def test_content_range_total_grows_as_more_is_cached(self):
        with open(self.cache_path, 'ab') as f:
            f.write(b'x' * 200)  # mais 200 bytes chegaram desde o setUp

        resp = self.client.get(f"/stream/{self.MSG_ID}{self.EXT}", headers={"Range": "bytes=0-99"})
        self.assertEqual(resp.headers['Content-Range'], f'bytes 0-99/{self.CACHED_SIZE + 200}')

    def test_stream_never_lets_the_browser_cache_a_stale_snapshot(self):
        # Sem isso, video.load() pode reaproveitar uma resposta antiga do
        # cache HTTP e nunca perceber que o servidor já tem mais conteúdo
        # (bug real: player travava pra sempre mesmo com o remux avançando).
        resp = self.client.get(f"/stream/{self.MSG_ID}{self.EXT}", headers={"Range": "bytes=0-99"})
        self.assertEqual(resp.headers.get('Cache-Control'), 'no-store')

    def test_open_range_never_exceeds_what_is_on_disk(self):
        resp = self.client.get(f"/stream/{self.MSG_ID}{self.EXT}", headers={"Range": "bytes=0-"})
        self.assertEqual(resp.status_code, 206)
        self.assertEqual(resp.headers.get('Content-Length'), str(self.CACHED_SIZE))
        self.assertEqual(len(resp.data), self.CACHED_SIZE)

    def test_seek_far_beyond_cache_returns_503_instead_of_hanging(self):
        start = time.time()
        resp = self.client.get(f"/stream/{self.MSG_ID}{self.EXT}", headers={"Range": "bytes=900-950"})
        elapsed = time.time() - start
        self.assertEqual(resp.status_code, 503)
        self.assertIn('Retry-After', resp.headers)
        self.assertLess(elapsed, 2.0)

    def test_progress_endpoint_reflects_real_disk_state(self):
        resp = self.client.get(f"/api/media/{self.MSG_ID}/progress")
        data = resp.get_json()
        self.assertEqual(data['cached_bytes'], self.CACHED_SIZE)
        self.assertEqual(data['total_bytes'], self.TOTAL_SIZE)
        self.assertEqual(data['duration'], 120)
        self.assertEqual(data['state'], 'caching')

    def test_unknown_media_id_returns_404_on_both_routes(self):
        self.assertEqual(self.client.get('/stream/8888.mp4').status_code, 404)
        self.assertEqual(self.client.get('/api/media/8888/progress').status_code, 404)

    def test_progress_reports_web_playable_true_for_regular_faststart_mp4(self):
        # setUp escreve bytes genéricos (só importa pra testes de range,
        # não pra estrutura de MP4) — aqui a estrutura real importa, então
        # substitui pelo cabeçalho faststart válido antes de checar.
        with open(self.cache_path, 'wb') as f:
            f.write(fake_faststart_mp4_header())

        data = self.client.get(f"/api/media/{self.MSG_ID}/progress").get_json()
        self.assertTrue(data['web_playable'])
        self.assertIsNone(data['container'])

    def test_progress_reports_web_playable_false_for_mp4_with_moov_at_end(self):
        # O mesmo conteúdo genérico do setUp não tem NENHUM box —
        # representa bem um MP4 real cujo moov ainda não foi alcançado
        # (só existe perto do fim, que ainda não foi baixado).
        data = self.client.get(f"/api/media/{self.MSG_ID}/progress").get_json()
        self.assertFalse(data['web_playable'])
        self.assertIsNone(data['container'])  # não é Matroska — é o outro motivo


class MatroskaRemuxPreferenceTests(unittest.TestCase):
    """Um arquivo rotulado .mp4 mas com conteúdo Matroska (comum em bots de
    rip) não deve ser servido crú pro navegador — o /stream precisa
    preferir o .web.mp4 remuxado quando ele existir (ver bot_manager.py)."""

    MSG_ID = '3359'
    EXT = '.mp4'

    def setUp(self):
        self.tmp_cache = tempfile.mkdtemp()
        app_module.CACHE_DIR = self.tmp_cache

        self.fake = FakeBotManager()
        app_module.bot_manager = self.fake

        self.raw_path = os.path.join(self.tmp_cache, f"{self.MSG_ID}{self.EXT}")
        with open(self.raw_path, 'wb') as f:
            f.write(b'\x1a\x45\xdf\xa3' + b'conteudo matroska fake' * 10)

        self.client = app_module.app.test_client()

    def tearDown(self):
        shutil.rmtree(self.tmp_cache, ignore_errors=True)

    def test_web_playable_false_while_matroska_not_yet_remuxed(self):
        self.fake.seed(self.MSG_ID, ext=self.EXT, size=1000, mime='video/mp4', state='caching')
        data = self.client.get(f"/api/media/{self.MSG_ID}/progress").get_json()
        self.assertFalse(data['web_playable'])
        self.assertEqual(data['container'], 'matroska')

    def test_web_playable_true_once_remuxed_ext_recorded(self):
        self.fake.seed(
            self.MSG_ID, ext=self.EXT, size=1000, mime='video/mp4', state='forwarded',
            remuxed_ext='.web.mp4',
        )
        data = self.client.get(f"/api/media/{self.MSG_ID}/progress").get_json()
        self.assertTrue(data['web_playable'])

    def test_stream_serves_remuxed_sibling_instead_of_raw_matroska(self):
        remuxed_content = b'MP4-REMUXADO' * 50
        with open(self.raw_path + '.web.mp4', 'wb') as f:
            f.write(remuxed_content)

        self.fake.seed(
            self.MSG_ID, ext=self.EXT, size=len(remuxed_content) * 5, mime='video/mp4',
            state='forwarded', remuxed_ext='.web.mp4',
        )

        resp = self.client.get(f"/stream/{self.MSG_ID}{self.EXT}")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.headers['Content-Type'], 'video/mp4')
        self.assertEqual(resp.data, remuxed_content)
        # o total_size reportado é o do remux completo, não o `size`
        # (do arquivo original) salvo nos metadados
        self.assertEqual(resp.headers.get('Content-Length'), str(len(remuxed_content)))

    def test_stream_falls_back_to_raw_file_if_remux_missing(self):
        # remuxed_ext setado no metadado mas o arquivo .web.mp4 não existe
        # (ex.: removido manualmente) -> não deve travar, serve o original
        self.fake.seed(
            self.MSG_ID, ext=self.EXT, size=os.path.getsize(self.raw_path), mime='video/mp4',
            state='forwarded', remuxed_ext='.web.mp4',
        )
        resp = self.client.get(f"/stream/{self.MSG_ID}{self.EXT}")
        self.assertEqual(resp.status_code, 200)
        with open(self.raw_path, 'rb') as f:
            self.assertEqual(resp.data, f.read())


class RemuxSafeCapTests(unittest.TestCase):
    """Prévia via moov buscado fora de ordem (MP4 sem faststart — ver
    bot_manager._try_fetch_moov_tail): o .web.mp4 produzido tem tamanho em
    disco próximo do arquivo TOTAL (o trecho ainda não baixado sai
    preenchido com zeros no remux), mesmo quando só uma fração é conteúdo
    real. `remuxed_up_to_bytes` é o teto que impede o /stream de declarar
    (ou servir) mais do que isso — sem ele, reabriria o mesmo bug de
    prefetch do navegador batendo em conteúdo inexistente que motivou o
    Content-Range refletir sempre o tamanho em disco no primeiro lugar."""

    MSG_ID = '3443'
    EXT = '.mp4'

    def setUp(self):
        self.tmp_cache = tempfile.mkdtemp()
        app_module.CACHE_DIR = self.tmp_cache

        self.fake = FakeBotManager()
        app_module.bot_manager = self.fake

        self.raw_path = os.path.join(self.tmp_cache, f"{self.MSG_ID}{self.EXT}")
        with open(self.raw_path, 'wb') as f:
            f.write(b'conteudo cru parcial')

        # Simula o .web.mp4 "inflado": moov buscado adiantado + zeros no
        # meio já materializados pelo ffmpeg — tamanho em disco bem maior
        # do que os bytes reais (remuxed_up_to_bytes).
        self.real_bytes = 400
        self.padded_disk_size = 5000
        with open(self.raw_path + '.web.mp4', 'wb') as f:
            f.write((bytes(range(256)) * (self.padded_disk_size // 256 + 1))[: self.padded_disk_size])

        self.fake.seed(
            self.MSG_ID, ext=self.EXT, size=100000, mime='video/mp4', state='caching',
            remuxed_ext='.web.mp4', remuxed_up_to_bytes=self.real_bytes,
        )
        self.client = app_module.app.test_client()

    def tearDown(self):
        shutil.rmtree(self.tmp_cache, ignore_errors=True)

    def test_content_range_total_is_capped_by_remuxed_up_to_bytes_not_disk_size(self):
        resp = self.client.get(f"/stream/{self.MSG_ID}{self.EXT}", headers={"Range": "bytes=0-99"})
        self.assertEqual(resp.status_code, 206)
        self.assertEqual(resp.headers['Content-Range'], f'bytes 0-99/{self.real_bytes}')
        self.assertNotIn(str(self.padded_disk_size), resp.headers['Content-Range'])

    def test_open_range_never_exceeds_the_safe_cap_even_though_disk_has_more(self):
        resp = self.client.get(f"/stream/{self.MSG_ID}{self.EXT}", headers={"Range": "bytes=0-"})
        self.assertEqual(resp.status_code, 206)
        self.assertEqual(resp.headers.get('Content-Length'), str(self.real_bytes))
        self.assertEqual(len(resp.data), self.real_bytes)

    def test_seek_beyond_safe_cap_returns_503_even_though_bytes_physically_exist_on_disk(self):
        start = time.time()
        resp = self.client.get(
            f"/stream/{self.MSG_ID}{self.EXT}", headers={"Range": f"bytes={self.real_bytes + 100}-"},
        )
        elapsed = time.time() - start
        self.assertEqual(resp.status_code, 503)
        self.assertIn('Retry-After', resp.headers)
        self.assertLess(elapsed, 1.0)  # nem deveria cair no loop de espera — checagem é imediata

    def test_seek_right_at_the_safe_cap_boundary_still_returns_503(self):
        resp = self.client.get(
            f"/stream/{self.MSG_ID}{self.EXT}", headers={"Range": f"bytes={self.real_bytes}-"},
        )
        self.assertEqual(resp.status_code, 503)


if __name__ == '__main__':
    unittest.main()
