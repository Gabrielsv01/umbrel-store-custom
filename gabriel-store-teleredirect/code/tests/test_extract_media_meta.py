import unittest

from telethon.tl.types import DocumentAttributeFilename, DocumentAttributeVideo

import bot_manager as bm


class FakeDocument:
    def __init__(self, size, mime_type, attributes):
        self.size = size
        self.mime_type = mime_type
        self.attributes = attributes


class FakeMediaDocument:
    def __init__(self, document):
        self.document = document


class FakePhoto:
    def __init__(self, photo_id):
        self.id = photo_id


class FakeMediaPhoto:
    def __init__(self, photo_id):
        self.photo = FakePhoto(photo_id)


class FakeMsg:
    def __init__(self, media, msg_id=123, chat_id=456, raw_text=None):
        self.media = media
        self.id = msg_id
        self.chat_id = chat_id
        self.raw_text = raw_text


class ExtractMediaMetaTests(unittest.TestCase):
    """Nem toda mensagem com vídeo traz DocumentAttributeFilename (algumas
    só trazem DocumentAttributeVideo) — sem isso, o nome/extensão caíam
    direto no genérico '.file', mesmo já sabendo o mime_type real."""

    def setUp(self):
        self.manager = bm.BotManager.__new__(bm.BotManager)

    def test_uses_real_filename_when_attribute_present(self):
        doc = FakeDocument(1000, 'video/mp4', [DocumentAttributeFilename(file_name='filme.mp4')])
        msg = FakeMsg(FakeMediaDocument(doc))

        meta = self.manager._extract_media_meta(msg)

        self.assertEqual(meta['name'], 'filme.mp4')
        self.assertEqual(meta['ext'], '.mp4')

    def test_derives_extension_from_mime_when_no_filename_attribute(self):
        video_attr = DocumentAttributeVideo(duration=2708, w=1280, h=720, supports_streaming=True)
        doc = FakeDocument(1000, 'video/mp4', [video_attr])
        msg = FakeMsg(FakeMediaDocument(doc), msg_id=3436)

        meta = self.manager._extract_media_meta(msg)

        self.assertEqual(meta['ext'], '.mp4')
        self.assertEqual(meta['name'], 'media_3436.mp4')
        self.assertEqual(meta['duration'], 2708)

    def test_derives_mkv_extension_for_matroska_mime(self):
        doc = FakeDocument(1000, 'video/x-matroska', [])
        msg = FakeMsg(FakeMediaDocument(doc), msg_id=1)

        meta = self.manager._extract_media_meta(msg)

        self.assertEqual(meta['ext'], '.mkv')
        self.assertEqual(meta['name'], 'media_1.mkv')

    def test_falls_back_to_dot_file_when_mime_is_generic_and_no_filename(self):
        doc = FakeDocument(1000, 'application/octet-stream', [])
        msg = FakeMsg(FakeMediaDocument(doc), msg_id=999)

        meta = self.manager._extract_media_meta(msg)

        self.assertEqual(meta['ext'], '.file')
        self.assertEqual(meta['name'], 'media_999.file')

    def test_falls_back_to_dot_file_when_mime_is_missing_entirely(self):
        doc = FakeDocument(1000, None, [])
        msg = FakeMsg(FakeMediaDocument(doc), msg_id=1000)

        meta = self.manager._extract_media_meta(msg)

        self.assertEqual(meta['ext'], '.file')

    def test_photo_media_is_unaffected(self):
        msg = FakeMsg(FakeMediaPhoto(777))

        meta = self.manager._extract_media_meta(msg)

        self.assertEqual(meta['name'], 'photo_777.jpg')
        self.assertEqual(meta['ext'], '.jpg')

    def test_captures_caption_when_message_has_one(self):
        doc = FakeDocument(1000, 'video/mp4', [DocumentAttributeFilename(file_name='filme.mp4')])
        msg = FakeMsg(FakeMediaDocument(doc), raw_text='Filme X - Descrição enviada pelo bot')

        meta = self.manager._extract_media_meta(msg)

        self.assertEqual(meta['caption'], 'Filme X - Descrição enviada pelo bot')

    def test_caption_is_none_when_message_has_no_text(self):
        doc = FakeDocument(1000, 'video/mp4', [DocumentAttributeFilename(file_name='filme.mp4')])
        msg = FakeMsg(FakeMediaDocument(doc), raw_text=None)

        meta = self.manager._extract_media_meta(msg)

        self.assertIsNone(meta['caption'])

    def test_caption_empty_string_is_normalized_to_none(self):
        doc = FakeDocument(1000, 'video/mp4', [DocumentAttributeFilename(file_name='filme.mp4')])
        msg = FakeMsg(FakeMediaDocument(doc), raw_text='')

        meta = self.manager._extract_media_meta(msg)

        self.assertIsNone(meta['caption'])


if __name__ == '__main__':
    unittest.main()
