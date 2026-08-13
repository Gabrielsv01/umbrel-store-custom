import unittest

from telethon.tl.types import DocumentAttributeFilename, DocumentAttributeVideo

import bot_manager as bm


class BuildSendAttributesTests(unittest.TestCase):
    """Sem atributos de vídeo explícitos no reenvio, o Telegram trata o
    arquivo como documento genérico (sem player embutido/streaming),
    mesmo que o original enviado pelo bot fosse um vídeo de verdade."""

    def test_video_meta_produces_filename_and_video_attributes(self):
        meta = {'name': 'filme.mp4', 'duration': 1321.0, 'width': 1280, 'height': 720}
        attrs = bm.BotManager._build_send_attributes(meta)

        filenames = [a for a in attrs if isinstance(a, DocumentAttributeFilename)]
        videos = [a for a in attrs if isinstance(a, DocumentAttributeVideo)]

        self.assertEqual(len(filenames), 1)
        self.assertEqual(filenames[0].file_name, 'filme.mp4')

        self.assertEqual(len(videos), 1)
        self.assertEqual(videos[0].duration, 1321)
        self.assertEqual(videos[0].w, 1280)
        self.assertEqual(videos[0].h, 720)
        self.assertTrue(videos[0].supports_streaming)

    def test_non_video_meta_has_no_video_attribute(self):
        meta = {'name': 'foto.jpg', 'duration': None}
        attrs = bm.BotManager._build_send_attributes(meta)

        self.assertFalse(any(isinstance(a, DocumentAttributeVideo) for a in attrs))
        self.assertTrue(any(isinstance(a, DocumentAttributeFilename) for a in attrs))

    def test_missing_width_height_defaults_to_zero_not_none(self):
        meta = {'name': 'video.mp4', 'duration': 60}
        attrs = bm.BotManager._build_send_attributes(meta)
        video = next(a for a in attrs if isinstance(a, DocumentAttributeVideo))

        self.assertEqual(video.w, 0)
        self.assertEqual(video.h, 0)

    def test_missing_name_falls_back_to_generic_filename(self):
        meta = {'duration': 60}
        attrs = bm.BotManager._build_send_attributes(meta)
        filename = next(a for a in attrs if isinstance(a, DocumentAttributeFilename))

        self.assertTrue(filename.file_name)  # não vazio/None


if __name__ == '__main__':
    unittest.main()
