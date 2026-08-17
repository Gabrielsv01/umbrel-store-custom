import glob
import json
import os
import shutil
import struct
import subprocess
import tempfile
import unittest
from unittest import mock

import remux


def _mp4_box(fourcc, body=b''):
    return struct.pack('>I', 8 + len(body)) + fourcc + body


def _leftover_siblings(dst_path):
    """Lista arquivos irmãos de `dst_path` (tmp/snapshot intermediários) —
    os nomes agora incluem um sufixo aleatório (ver
    remux._unique_sibling_path), então não dá mais pra checar um nome
    fixo como antes; qualquer arquivo cujo nome comece com `dst_path + '.'`
    e não seja o próprio destino é lixo que devia ter sido limpo."""
    return [p for p in glob.glob(dst_path + '.*') if p != dst_path]


class IsMatroskaTests(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    def _write(self, content):
        path = os.path.join(self.tmp_dir, 'sample')
        with open(path, 'wb') as f:
            f.write(content)
        return path

    def test_detects_matroska_magic_bytes(self):
        path = self._write(b'\x1a\x45\xdf\xa3' + b'resto do arquivo qualquer')
        self.assertTrue(remux.is_matroska(path))

    def test_real_mp4_is_not_matroska(self):
        # box ftyp típico de início de MP4
        path = self._write(b'\x00\x00\x00\x18ftypmp42' + b'\x00' * 16)
        self.assertFalse(remux.is_matroska(path))

    def test_missing_file_is_not_matroska(self):
        self.assertFalse(remux.is_matroska(os.path.join(self.tmp_dir, 'nao-existe')))

    def test_empty_file_is_not_matroska(self):
        path = self._write(b'')
        self.assertFalse(remux.is_matroska(path))


class Mp4MoovNearFrontTests(unittest.TestCase):
    """MP4 sem faststart (moov no final) faz o navegador desistir de
    decodificar — o mesmo tanto quanto Matroska rotulado como .mp4, só que
    detectável de outro jeito (posição de box, não assinatura mágica)."""

    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    def _write(self, content):
        path = os.path.join(self.tmp_dir, 'sample.mp4')
        with open(path, 'wb') as f:
            f.write(content)
        return path

    def test_moov_right_after_ftyp_is_near_front(self):
        content = _mp4_box(b'ftyp', b'isom' + b'\x00' * 12) + _mp4_box(b'moov', b'\x00' * 64)
        path = self._write(content)
        self.assertTrue(remux.mp4_moov_near_front(path))

    def test_moov_after_small_free_box_is_still_near_front(self):
        content = (
            _mp4_box(b'ftyp', b'isom' + b'\x00' * 12)
            + _mp4_box(b'free', b'\x00' * 20)
            + _mp4_box(b'moov', b'\x00' * 64)
        )
        path = self._write(content)
        self.assertTrue(remux.mp4_moov_near_front(path))

    def test_large_mdat_before_moov_is_not_near_front(self):
        # Nem precisa o mdat ter o conteúdo de verdade (seria enorme) —
        # só o cabeçalho já é suficiente pra reconhecer "moov não está
        # por perto" sem precisar avançar pelo tamanho declarado.
        content = _mp4_box(b'ftyp', b'isom' + b'\x00' * 12) + _mp4_box(b'mdat', b'')
        path = self._write(content)
        self.assertFalse(remux.mp4_moov_near_front(path))

    def test_moov_beyond_probe_window_is_not_considered_near_front(self):
        content = (
            _mp4_box(b'ftyp', b'isom' + b'\x00' * 12)
            + _mp4_box(b'free', b'\x00' * 200)
            + _mp4_box(b'moov', b'\x00' * 10)
        )
        path = self._write(content)
        self.assertFalse(remux.mp4_moov_near_front(path, probe_bytes=50))
        self.assertTrue(remux.mp4_moov_near_front(path, probe_bytes=1000))

    def test_truncated_box_header_returns_false(self):
        path = self._write(_mp4_box(b'ftyp', b'isom') + b'\x00\x00')  # menos de 8 bytes sobrando
        self.assertFalse(remux.mp4_moov_near_front(path))

    def test_missing_file_returns_false(self):
        self.assertFalse(remux.mp4_moov_near_front(os.path.join(self.tmp_dir, 'nao-existe')))


class NeedsRemuxTests(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    def _write(self, content):
        path = os.path.join(self.tmp_dir, 'sample.mp4')
        with open(path, 'wb') as f:
            f.write(content)
        return path

    def test_matroska_needs_remux(self):
        path = self._write(b'\x1a\x45\xdf\xa3conteudo qualquer')
        self.assertTrue(remux.needs_remux(path))

    def test_faststart_mp4_does_not_need_remux(self):
        content = _mp4_box(b'ftyp', b'isom' + b'\x00' * 12) + _mp4_box(b'moov', b'\x00' * 20)
        path = self._write(content)
        self.assertFalse(remux.needs_remux(path))

    def test_mp4_with_moov_at_end_needs_remux(self):
        content = _mp4_box(b'ftyp', b'isom' + b'\x00' * 12) + _mp4_box(b'mdat', b'\x00' * 8)
        path = self._write(content)
        self.assertTrue(remux.needs_remux(path))


class FindMoovExpectedOffsetTests(unittest.TestCase):
    """Calcula onde o moov DEVERIA estar, pro layout comum quando ele fica
    no final: ftyp -> mdat -> moov. Usado pra buscar o moov fora de ordem
    (por offset) antes do download sequencial alcançá-lo."""

    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    def _write(self, content):
        path = os.path.join(self.tmp_dir, 'sample.mp4')
        with open(path, 'wb') as f:
            f.write(content)
        return path

    def test_simple_ftyp_mdat_layout_returns_offset_right_after_mdat(self):
        ftyp = _mp4_box(b'ftyp', b'isom' + b'\x00' * 12)
        mdat = _mp4_box(b'mdat', b'M' * 5000)
        path = self._write(ftyp + mdat)  # moov real ainda nem foi baixado

        self.assertEqual(remux.find_moov_expected_offset(path), len(ftyp) + len(mdat))

    def test_small_box_between_ftyp_and_mdat_is_accounted_for(self):
        ftyp = _mp4_box(b'ftyp', b'isom' + b'\x00' * 12)
        free = _mp4_box(b'free', b'\x00' * 20)
        mdat = _mp4_box(b'mdat', b'M' * 5000)
        path = self._write(ftyp + free + mdat)

        self.assertEqual(remux.find_moov_expected_offset(path), len(ftyp) + len(free) + len(mdat))

    def test_returns_none_when_moov_already_near_front(self):
        content = _mp4_box(b'ftyp', b'isom' + b'\x00' * 12) + _mp4_box(b'moov', b'\x00' * 64)
        path = self._write(content)
        self.assertIsNone(remux.find_moov_expected_offset(path))

    def test_returns_none_when_mdat_has_special_size(self):
        content = _mp4_box(b'ftyp', b'isom' + b'\x00' * 12) + b'\x00\x00\x00\x00mdat' + b'\x00' * 50
        path = self._write(content)
        self.assertIsNone(remux.find_moov_expected_offset(path))

    def test_returns_none_when_another_box_appears_after_mdat(self):
        ftyp = _mp4_box(b'ftyp', b'isom' + b'\x00' * 12)
        mdat = _mp4_box(b'mdat', b'M' * 100)
        free = _mp4_box(b'free', b'\x00' * 20)
        path = self._write(ftyp + mdat + free)
        self.assertIsNone(remux.find_moov_expected_offset(path))

    def test_returns_none_without_any_mdat(self):
        path = self._write(_mp4_box(b'ftyp', b'isom' + b'\x00' * 12))
        self.assertIsNone(remux.find_moov_expected_offset(path))

    def test_missing_file_returns_none(self):
        self.assertIsNone(remux.find_moov_expected_offset(os.path.join(self.tmp_dir, 'nao-existe')))


class AssembleSparsePreviewSourceTests(unittest.TestCase):
    """Monta o arquivo 'esparso' (prefixo real + buraco + moov real na
    posição correta) usado como entrada pro remux quando o moov foi
    obtido fora de ordem, adiantado."""

    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp()
        self.src = os.path.join(self.tmp_dir, 'src.mp4')
        self.dst = os.path.join(self.tmp_dir, 'dst.mp4')

    def tearDown(self):
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    def test_prefix_gap_and_moov_end_up_at_correct_positions(self):
        prefix = b'P' * 1000
        with open(self.src, 'wb') as f:
            f.write(prefix)

        moov_offset = 1500  # além do que já foi baixado (prefix tem só 1000)
        moov_bytes = _mp4_box(b'moov', b'\x00' * 64)

        remux.assemble_sparse_preview_source(self.src, self.dst, len(prefix), moov_offset, moov_bytes)

        with open(self.dst, 'rb') as f:
            assembled = f.read()

        self.assertEqual(len(assembled), moov_offset + len(moov_bytes))
        self.assertEqual(assembled[:len(prefix)], prefix)
        self.assertEqual(assembled[len(prefix):moov_offset], b'\x00' * (moov_offset - len(prefix)))
        self.assertEqual(assembled[moov_offset:], moov_bytes)

    def test_prefix_longer_than_moov_offset_is_truncated_to_moov_offset(self):
        # Caso defensivo: não deveria acontecer na prática (moov_offset é
        # sempre depois do que já foi baixado quando esse método é
        # chamado), mas não deve escrever por cima do próprio moov.
        prefix = b'P' * 2000
        with open(self.src, 'wb') as f:
            f.write(prefix)

        moov_offset = 1000
        moov_bytes = _mp4_box(b'moov', b'\x00' * 32)

        remux.assemble_sparse_preview_source(self.src, self.dst, len(prefix), moov_offset, moov_bytes)

        with open(self.dst, 'rb') as f:
            assembled = f.read()

        self.assertEqual(len(assembled), moov_offset + len(moov_bytes))
        self.assertEqual(assembled[:moov_offset], prefix[:moov_offset])
        self.assertEqual(assembled[moov_offset:], moov_bytes)

    def test_leaves_no_tmp_file_behind_on_success(self):
        with open(self.src, 'wb') as f:
            f.write(b'P' * 100)
        remux.assemble_sparse_preview_source(self.src, self.dst, 100, 200, _mp4_box(b'moov', b'\x00' * 8))
        self.assertEqual(_leftover_siblings(self.dst), [])


class RemuxPartialWithMoovTailTests(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp()
        self.src = os.path.join(self.tmp_dir, 'src.mp4')
        self.dst = os.path.join(self.tmp_dir, 'dst.mp4')
        with open(self.src, 'wb') as f:
            f.write(_mp4_box(b'ftyp', b'isom' + b'\x00' * 12) + _mp4_box(b'mdat', b'M' * 500))

    def tearDown(self):
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    @mock.patch('remux.subprocess.run')
    def test_assembles_sparse_source_and_remuxes_it_not_the_raw_partial_file(self, mock_run):
        seen_inputs = []

        def fake_run(cmd, **kwargs):
            seen_inputs.append(cmd[cmd.index('-i') + 1])
            with open(cmd[cmd.index('-f') + 2], 'wb') as f:
                f.write(b'mp4 remuxado fake')
            return subprocess.CompletedProcess(cmd, 0, stdout=b'', stderr=b'')

        mock_run.side_effect = fake_run
        moov_offset = os.path.getsize(self.src) + 2000  # ainda não baixado
        moov_bytes = _mp4_box(b'moov', b'\x00' * 64)

        remux.remux_partial_with_moov_tail_to_mp4(
            self.src, self.dst, os.path.getsize(self.src), moov_offset, moov_bytes,
        )

        self.assertTrue(os.path.exists(self.dst))
        self.assertNotEqual(seen_inputs[0], self.src)  # remuxou o arquivo montado, não o cru
        self.assertEqual(_leftover_siblings(self.dst), [])

    @mock.patch('remux.subprocess.run')
    def test_failure_cleans_up_snapshot(self, mock_run):
        mock_run.return_value = subprocess.CompletedProcess([], 1, stdout=b'', stderr=b'falha simulada')
        moov_bytes = _mp4_box(b'moov', b'\x00' * 64)

        with self.assertRaises(RuntimeError):
            remux.remux_partial_with_moov_tail_to_mp4(
                self.src, self.dst, os.path.getsize(self.src),
                os.path.getsize(self.src) + 2000, moov_bytes,
            )

        self.assertEqual(_leftover_siblings(self.dst), [])


class RemuxToMp4Tests(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp()
        self.src = os.path.join(self.tmp_dir, 'src.mkv')
        self.dst = os.path.join(self.tmp_dir, 'dst.mp4')
        with open(self.src, 'wb') as f:
            f.write(b'\x1a\x45\xdf\xa3conteudo-fake')

    def tearDown(self):
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    @mock.patch('remux.subprocess.run')
    def test_success_replaces_destination_and_cleans_tmp(self, mock_run):
        def fake_run(cmd, **kwargs):
            tmp_dst = cmd[cmd.index('-f') + 2]
            with open(tmp_dst, 'wb') as f:
                f.write(b'mp4 remuxado fake')
            return subprocess.CompletedProcess(cmd, 0, stdout=b'', stderr=b'')

        mock_run.side_effect = fake_run

        remux.remux_to_mp4(self.src, self.dst)

        self.assertTrue(os.path.exists(self.dst))
        self.assertEqual(_leftover_siblings(self.dst), [])
        with open(self.dst, 'rb') as f:
            self.assertEqual(f.read(), b'mp4 remuxado fake')

    @mock.patch('remux.subprocess.run')
    def test_two_calls_to_same_destination_use_different_tmp_files(self, mock_run):
        # Regressão: a prévia parcial e o remux final podem legitimamente
        # mirar o mesmo dst_path ao mesmo tempo (prévia em andamento quando
        # o download termina). Com um nome de tmp fixo, um dos dois apagar
        # seu próprio tmp no `finally` derruba o outro no meio do segundo
        # passe do ffmpeg ("Unable to re-open ... for shifting data",
        # visto em produção) — daí cada chamada precisar do seu próprio tmp.
        seen_tmp_dsts = []

        def fake_run(cmd, **kwargs):
            tmp_dst = cmd[cmd.index('-f') + 2]
            seen_tmp_dsts.append(tmp_dst)
            with open(tmp_dst, 'wb') as f:
                f.write(b'x')
            return subprocess.CompletedProcess(cmd, 0, stdout=b'', stderr=b'')

        mock_run.side_effect = fake_run

        remux.remux_to_mp4(self.src, self.dst)
        remux.remux_to_mp4(self.src, self.dst)

        self.assertEqual(len(seen_tmp_dsts), 2)
        self.assertNotEqual(seen_tmp_dsts[0], seen_tmp_dsts[1])

    @mock.patch('remux.subprocess.run')
    def test_command_uses_stream_copy_no_reencode(self, mock_run):
        def fake_run(cmd, **kwargs):
            with open(cmd[cmd.index('-f') + 2], 'wb') as f:
                f.write(b'x')
            return subprocess.CompletedProcess(cmd, 0, stdout=b'', stderr=b'')

        mock_run.side_effect = fake_run
        remux.remux_to_mp4(self.src, self.dst)

        cmd = mock_run.call_args[0][0]
        self.assertIn('-c', cmd)
        self.assertIn('copy', cmd)
        self.assertNotIn('-vf', cmd)  # nenhum filtro/recodificação

    @mock.patch('remux.subprocess.run')
    def test_failure_raises_and_leaves_no_partial_output(self, mock_run):
        def fake_run(cmd, **kwargs):
            with open(cmd[cmd.index('-f') + 2], 'wb') as f:
                f.write(b'saida parcial de uma falha')
            return subprocess.CompletedProcess(cmd, 1, stdout=b'', stderr=b'erro fatal simulado')

        mock_run.side_effect = fake_run

        with self.assertRaises(RuntimeError):
            remux.remux_to_mp4(self.src, self.dst)

        self.assertFalse(os.path.exists(self.dst))
        self.assertEqual(_leftover_siblings(self.dst), [])

    @mock.patch('remux.subprocess.run', side_effect=subprocess.TimeoutExpired(cmd='ffmpeg', timeout=1))
    def test_timeout_propagates_without_partial_output(self, mock_run):
        with self.assertRaises(subprocess.TimeoutExpired):
            remux.remux_to_mp4(self.src, self.dst, timeout=1)
        self.assertFalse(os.path.exists(self.dst))


class SplitSegmentToMp4Tests(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp()
        self.src = os.path.join(self.tmp_dir, 'src.mp4')
        self.dst = os.path.join(self.tmp_dir, 'part1.mp4')
        with open(self.src, 'wb') as f:
            f.write(b'conteudo-fake-de-video')

    def tearDown(self):
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    @mock.patch('remux.subprocess.run')
    def test_success_replaces_destination_and_cleans_tmp(self, mock_run):
        def fake_run(cmd, **kwargs):
            with open(cmd[cmd.index('-f') + 2], 'wb') as f:
                f.write(b'trecho remuxado fake')
            return subprocess.CompletedProcess(cmd, 0, stdout=b'', stderr=b'')

        mock_run.side_effect = fake_run
        remux.split_segment_to_mp4(self.src, self.dst, start_seconds=10, duration_seconds=5)

        self.assertTrue(os.path.exists(self.dst))
        self.assertEqual(_leftover_siblings(self.dst), [])

    @mock.patch('remux.subprocess.run')
    def test_uses_stream_copy_and_seeks_before_input(self, mock_run):
        def fake_run(cmd, **kwargs):
            with open(cmd[cmd.index('-f') + 2], 'wb') as f:
                f.write(b'x')
            return subprocess.CompletedProcess(cmd, 0, stdout=b'', stderr=b'')

        mock_run.side_effect = fake_run
        remux.split_segment_to_mp4(self.src, self.dst, start_seconds=10, duration_seconds=5)

        cmd = mock_run.call_args[0][0]
        self.assertIn('-c', cmd)
        self.assertIn('copy', cmd)
        # -ss ANTES de -i (seek rápido, único compatível com -c copy)
        self.assertLess(cmd.index('-ss'), cmd.index('-i'))
        self.assertIn('-t', cmd)
        self.assertEqual(cmd[cmd.index('-t') + 1], '5')

    @mock.patch('remux.subprocess.run')
    def test_no_duration_omits_dash_t_to_go_until_the_end(self, mock_run):
        def fake_run(cmd, **kwargs):
            with open(cmd[cmd.index('-f') + 2], 'wb') as f:
                f.write(b'x')
            return subprocess.CompletedProcess(cmd, 0, stdout=b'', stderr=b'')

        mock_run.side_effect = fake_run
        remux.split_segment_to_mp4(self.src, self.dst, start_seconds=10, duration_seconds=None)

        cmd = mock_run.call_args[0][0]
        self.assertNotIn('-t', cmd)

    @mock.patch('remux.subprocess.run')
    def test_failure_raises_and_leaves_no_partial_output(self, mock_run):
        def fake_run(cmd, **kwargs):
            with open(cmd[cmd.index('-f') + 2], 'wb') as f:
                f.write(b'saida parcial de uma falha')
            return subprocess.CompletedProcess(cmd, 1, stdout=b'', stderr=b'erro fatal simulado')

        mock_run.side_effect = fake_run

        with self.assertRaises(RuntimeError):
            remux.split_segment_to_mp4(self.src, self.dst, start_seconds=0, duration_seconds=5)

        self.assertFalse(os.path.exists(self.dst))
        self.assertEqual(_leftover_siblings(self.dst), [])


@unittest.skipUnless(remux.ffmpeg_available(), 'ffmpeg não está instalado nesta máquina')
class SplitSegmentToMp4RealFfmpegTests(unittest.TestCase):
    """Ponta a ponta com ffmpeg de verdade: gera um MP4 de 2s e confirma que
    dividir em dois trechos de ~1s produz duas partes menores que o
    original, cobrindo (com a folga de arredondamento no keyframe mais
    próximo esperada de -c copy) o vídeo inteiro."""

    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp()
        self.src = os.path.join(self.tmp_dir, 'full.mp4')
        subprocess.run(
            [
                remux._ffmpeg_binary(), '-y', '-f', 'lavfi', '-i', 'testsrc=duration=2:size=64x64:rate=10',
                '-c:v', 'libx264', '-g', '5', '-f', 'mp4', self.src,
            ],
            check=True, capture_output=True,
        )

    def tearDown(self):
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    def test_two_parts_are_each_smaller_than_the_original(self):
        full_size = os.path.getsize(self.src)
        part1 = os.path.join(self.tmp_dir, 'part1.mp4')
        part2 = os.path.join(self.tmp_dir, 'part2.mp4')

        remux.split_segment_to_mp4(self.src, part1, start_seconds=0, duration_seconds=1)
        remux.split_segment_to_mp4(self.src, part2, start_seconds=1, duration_seconds=None)

        for part in (part1, part2):
            self.assertTrue(os.path.exists(part))
            size = os.path.getsize(part)
            self.assertGreater(size, 0)
            self.assertLess(size, full_size)


@unittest.skipUnless(remux.ffmpeg_available(), 'ffmpeg não está instalado nesta máquina')
class RemuxToMp4RealFfmpegTests(unittest.TestCase):
    """Só roda se ffmpeg estiver de fato disponível (empacotado via
    imageio-ffmpeg ou no PATH) — valida o comando real, não só a
    orquestração. Gera seus próprios arquivos de amostra (não depende de
    nenhuma mídia baixada do Telegram)."""

    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp()
        self.src = os.path.join(self.tmp_dir, 'sample.mkv')
        self.dst = os.path.join(self.tmp_dir, 'sample.mp4')
        subprocess.run(
            [
                remux._ffmpeg_binary(), '-y', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=64x64:rate=5',
                '-c:v', 'libx264', '-f', 'matroska', self.src,
            ],
            check=True, capture_output=True,
        )

    def tearDown(self):
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    def test_real_remux_produces_playable_mp4(self):
        self.assertTrue(remux.is_matroska(self.src))
        remux.remux_to_mp4(self.src, self.dst)
        self.assertTrue(os.path.exists(self.dst))
        self.assertGreater(os.path.getsize(self.dst), 0)
        self.assertFalse(remux.is_matroska(self.dst))


@unittest.skipUnless(remux.ffmpeg_available(), 'ffmpeg não está instalado nesta máquina')
class MoovTailRealFfmpegTests(unittest.TestCase):
    """Ponta a ponta com ffmpeg de verdade: gera um MP4 sem faststart
    (moov no final, como os que chegam via bot), simula ter baixado só um
    PREFIXO dele, busca o moov real fora de ordem (por offset, como
    _try_fetch_moov_tail faria) e confirma que o remux parcial resultante
    já é reproduzível — sem esperar o download terminar."""

    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp()
        self.full_path = os.path.join(self.tmp_dir, 'full.mp4')
        subprocess.run(
            [
                remux._ffmpeg_binary(), '-y', '-f', 'lavfi', '-i', 'testsrc=duration=2:size=64x64:rate=10',
                '-c:v', 'libx264', '-f', 'mp4', self.full_path,
            ],
            check=True, capture_output=True,
        )

    def tearDown(self):
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    def test_partial_preview_with_advance_fetched_moov_is_playable(self):
        self.assertTrue(remux.needs_remux(self.full_path), 'pré-condição: ffmpeg sem +faststart deveria deixar moov no final')

        with open(self.full_path, 'rb') as f:
            full_content = f.read()

        # Simula que só uma parte do arquivo foi baixada até agora — bem
        # menos que o total, pra provar que a prévia não depende de já
        # ter alcançado o moov real pelo download sequencial. O cálculo
        # do offset esperado (find_moov_expected_offset) só pode operar
        # sobre esse PREFIXO parcial, nunca sobre o arquivo completo (que
        # já teria o moov real dentro da janela de sondagem, mascarando
        # exatamente o cenário que essa técnica existe pra contornar).
        downloaded_so_far = len(full_content) * 6 // 10
        partial_path = os.path.join(self.tmp_dir, 'partial.mp4')
        with open(partial_path, 'wb') as f:
            f.write(full_content[:downloaded_so_far])

        moov_offset = remux.find_moov_expected_offset(partial_path)
        self.assertIsNotNone(moov_offset, 'layout do ffmpeg não bateu com o padrão simples esperado')
        self.assertGreater(moov_offset, downloaded_so_far, 'pré-condição: moov real ainda não deveria ter sido baixado')

        moov_size = int.from_bytes(full_content[moov_offset:moov_offset + 4], 'big')
        self.assertEqual(full_content[moov_offset + 4:moov_offset + 8], b'moov')
        moov_bytes = full_content[moov_offset:moov_offset + moov_size]

        preview_path = os.path.join(self.tmp_dir, 'preview.web.mp4')
        remux.remux_partial_with_moov_tail_to_mp4(
            partial_path, preview_path, downloaded_so_far, moov_offset, moov_bytes,
        )

        self.assertTrue(os.path.exists(preview_path))
        self.assertGreater(os.path.getsize(preview_path), 0)
        self.assertFalse(remux.needs_remux(preview_path), 'preview deveria sair com moov já no início (faststart)')


def _fake_probe_result(packets, streams):
    return subprocess.CompletedProcess(
        [], 0, stdout=json.dumps({'packets': packets, 'streams': streams}).encode(), stderr=b'',
    )


class FindSafeCutPointSecondsMockedTests(unittest.TestCase):
    """Casos de borda do cálculo, sem depender de ffprobe de verdade —
    controla exatamente o JSON que ele devolveria."""

    VIDEO_STREAM = {'index': 0, 'codec_type': 'video'}
    AUDIO_STREAM = {'index': 1, 'codec_type': 'audio'}

    @mock.patch('remux.subprocess.run')
    def test_returns_none_when_not_even_the_first_keyframe_is_covered(self, mock_run):
        packets = [
            {'stream_index': 0, 'pts_time': '0.000000', 'pos': '0', 'size': '5000', 'flags': 'K__'},
        ]
        mock_run.return_value = _fake_probe_result(packets, [self.VIDEO_STREAM])
        self.assertIsNone(remux.find_safe_cut_point_seconds('qualquer.mp4', up_to_bytes=1000))

    @mock.patch('remux.subprocess.run')
    def test_returns_largest_keyframe_time_fully_covered(self, mock_run):
        packets = [
            {'stream_index': 0, 'pts_time': '0.0', 'pos': '0', 'size': '1000', 'flags': 'K__'},
            {'stream_index': 0, 'pts_time': '1.0', 'pos': '1000', 'size': '1000', 'flags': 'K__'},
            {'stream_index': 0, 'pts_time': '2.0', 'pos': '2000', 'size': '1000', 'flags': 'K__'},
        ]
        mock_run.return_value = _fake_probe_result(packets, [self.VIDEO_STREAM])
        # Cobre até o segundo keyframe (pos+size=2000) mas não o terceiro (3000).
        self.assertEqual(remux.find_safe_cut_point_seconds('qualquer.mp4', up_to_bytes=2500), 1.0)

    @mock.patch('remux.subprocess.run')
    def test_non_keyframe_packets_beyond_cutoff_do_not_block_an_earlier_safe_keyframe(self, mock_run):
        packets = [
            {'stream_index': 0, 'pts_time': '0.0', 'pos': '0', 'size': '1000', 'flags': 'K__'},
            {'stream_index': 0, 'pts_time': '0.5', 'pos': '1000', 'size': '9000', 'flags': '___'},
            {'stream_index': 0, 'pts_time': '1.0', 'pos': '10000', 'size': '1000', 'flags': 'K__'},
        ]
        mock_run.return_value = _fake_probe_result(packets, [self.VIDEO_STREAM])
        # O keyframe em 0.0 é seguro (pos+size=1000) mesmo que um pacote NÃO
        # keyframe logo depois (0.5) já estoure o limite — o corte em 0.0
        # não depende de nada além do que veio antes/nele.
        self.assertEqual(remux.find_safe_cut_point_seconds('qualquer.mp4', up_to_bytes=1000), 0.0)

    @mock.patch('remux.subprocess.run')
    def test_audio_packet_beyond_video_keyframe_blocks_that_keyframe(self, mock_run):
        packets = [
            {'stream_index': 0, 'pts_time': '0.0', 'pos': '0', 'size': '500', 'flags': 'K__'},
            # Pacote de ÁUDIO no mesmo instante do keyframe de vídeo, mas
            # fisicamente mais adiante no arquivo — precisa contar também,
            # senão o corte cortaria áudio pela metade.
            {'stream_index': 1, 'pts_time': '0.0', 'pos': '5000', 'size': '2000', 'flags': 'K__'},
        ]
        mock_run.return_value = _fake_probe_result(packets, [self.VIDEO_STREAM, self.AUDIO_STREAM])
        self.assertIsNone(remux.find_safe_cut_point_seconds('qualquer.mp4', up_to_bytes=1000))
        self.assertEqual(remux.find_safe_cut_point_seconds('qualquer.mp4', up_to_bytes=7000), 0.0)

    @mock.patch('remux.subprocess.run')
    def test_returns_none_without_any_video_stream(self, mock_run):
        packets = [{'stream_index': 1, 'pts_time': '0.0', 'pos': '0', 'size': '500', 'flags': 'K__'}]
        mock_run.return_value = _fake_probe_result(packets, [self.AUDIO_STREAM])
        self.assertIsNone(remux.find_safe_cut_point_seconds('qualquer.mp4', up_to_bytes=100000))

    @mock.patch('remux.subprocess.run')
    def test_returns_none_when_any_packet_lacks_pts_time(self, mock_run):
        packets = [
            {'stream_index': 0, 'pts_time': '0.0', 'pos': '0', 'size': '500', 'flags': 'K__'},
            {'stream_index': 0, 'pts_time': 'N/A', 'pos': '500', 'size': '500', 'flags': '___'},
        ]
        mock_run.return_value = _fake_probe_result(packets, [self.VIDEO_STREAM])
        # Sem pts_time confiável nesse pacote, não dá pra garantir a ordem
        # temporal — mais vale desistir do que arriscar um corte incorreto.
        self.assertIsNone(remux.find_safe_cut_point_seconds('qualquer.mp4', up_to_bytes=100000))

    @mock.patch('remux.subprocess.run')
    def test_ffprobe_failure_raises(self, mock_run):
        mock_run.return_value = subprocess.CompletedProcess([], 1, stdout=b'', stderr=b'erro fatal simulado')
        with self.assertRaises(RuntimeError):
            remux.find_safe_cut_point_seconds('qualquer.mp4', up_to_bytes=100000)


@unittest.skipUnless(remux.ffprobe_available(), 'ffprobe não está instalado nesta máquina')
class FindSafeCutPointSecondsRealFfprobeTests(unittest.TestCase):
    """Ponta a ponta com ffprobe de verdade: gera um MP4 com vídeo+áudio e
    keyframes a cada 1s, e confirma que o ponto de corte cresce em degraus
    exatamente nos keyframes conforme mais bytes "chegam" — a mesma
    validação feita manualmente antes de escrever a implementação."""

    def setUp(self):
        self.tmp_dir = tempfile.mkdtemp()
        self.path = os.path.join(self.tmp_dir, 'sample.mp4')
        subprocess.run(
            [
                remux._ffmpeg_binary(), '-y',
                '-f', 'lavfi', '-i', 'testsrc=duration=3:size=64x64:rate=10',
                '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
                '-c:v', 'libx264', '-g', '10', '-c:a', 'aac', '-f', 'mp4', self.path,
            ],
            check=True, capture_output=True,
        )
        self.full_size = os.path.getsize(self.path)

    def tearDown(self):
        shutil.rmtree(self.tmp_dir, ignore_errors=True)

    def test_safe_cut_point_advances_in_keyframe_steps_as_bytes_grow(self):
        # ffprobe lê a tabela de amostras do moov real — não importa que o
        # arquivo aqui esteja "completo" (sem buraco esparso): a função só
        # usa `up_to_bytes` pra decidir até onde é seguro confiar, exatamente
        # como faria sobre um arquivo ainda parcialmente baixado.
        very_early = remux.find_safe_cut_point_seconds(self.path, up_to_bytes=200)
        self.assertIsNone(very_early, 'não deveria achar nem o primeiro keyframe com tão poucos bytes')

        full = remux.find_safe_cut_point_seconds(self.path, up_to_bytes=self.full_size)
        self.assertIsNotNone(full)
        self.assertLessEqual(full, 3.0)

        partial = remux.find_safe_cut_point_seconds(self.path, up_to_bytes=self.full_size // 2)
        self.assertIsNotNone(partial)
        # Com metade dos bytes, o corte seguro não pode alcançar o mesmo
        # ponto que com o arquivo inteiro.
        self.assertLess(partial, full)

    def test_cut_point_is_actually_extractable_from_only_the_downloaded_prefix(self):
        # Reproduz o uso real: o moov de verdade só existe fora de ordem
        # (buscado adiantado, ver _try_fetch_moov_tail), o resto do arquivo
        # além do prefixo baixado é um buraco esparso — exatamente o que
        # assemble_sparse_preview_source monta. Prova que dá pra extrair de
        # verdade, via ffmpeg, até o ponto de corte retornado, usando só
        # esse arquivo montado (nunca o arquivo completo).
        with open(self.path, 'rb') as f:
            full_content = f.read()
        moov_offset = remux.find_moov_expected_offset(self.path)
        if moov_offset is None:
            self.skipTest('layout do ffmpeg não bateu com o padrão simples esperado')
        moov_size = int.from_bytes(full_content[moov_offset:moov_offset + 4], 'big')
        moov_bytes = full_content[moov_offset:moov_offset + moov_size]

        tested_at_least_one_cut = False
        for fraction in (0.3, 0.5, 0.7, 0.9):
            up_to_bytes = int(moov_offset * fraction)  # sempre ANTES do moov real — download ainda em andamento
            assembled_path = os.path.join(self.tmp_dir, f'assembled_{fraction}.mp4')
            remux.assemble_sparse_preview_source(self.path, assembled_path, up_to_bytes, moov_offset, moov_bytes)

            cut = remux.find_safe_cut_point_seconds(assembled_path, up_to_bytes)
            if cut is None:
                continue
            tested_at_least_one_cut = True

            output_path = os.path.join(self.tmp_dir, f'cut_{fraction}.mp4')
            remux.split_segment_to_mp4(assembled_path, output_path, start_seconds=0, duration_seconds=cut)
            self.assertTrue(os.path.exists(output_path))
            self.assertGreater(os.path.getsize(output_path), 0)

        self.assertTrue(tested_at_least_one_cut, 'nenhuma fração testada teve bytes suficientes pra um corte seguro')


if __name__ == '__main__':
    unittest.main()
