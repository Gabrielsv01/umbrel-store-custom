import os
import json
import time
import threading

# Ciclo de vida de uma mídia em cache. Substitui os sinais implícitos
# anteriores (arquivo existe? lock ".downloading" existe? tem chave no
# dict?) por um único campo `state` explícito e consultável.
RECEIVED = 'received'
CACHING = 'caching'
READY = 'ready'
UPLOADING = 'uploading'
FORWARDED = 'forwarded'
ERROR = 'error'
PAUSED = 'paused'


class MediaStore:
    """Persiste metadados + estado de cada mídia recebida do bot."""

    def __init__(self, store_file):
        self.store_file = store_file
        self._lock = threading.Lock()
        self._data = self._load()

    def _load(self):
        if os.path.exists(self.store_file):
            try:
                with open(self.store_file, 'r') as f:
                    return json.load(f)
            except (json.JSONDecodeError, OSError):
                return {}
        return {}

    def _save(self):
        with open(self.store_file, 'w') as f:
            json.dump(self._data, f, indent=2)

    def create(self, msg_id, meta):
        with self._lock:
            item = dict(meta)
            item['state'] = RECEIVED
            item['last_streamed_at'] = None
            self._data[str(msg_id)] = item
            self._save()
            return item

    def update(self, msg_id, **fields):
        with self._lock:
            key = str(msg_id)
            if key not in self._data:
                return None
            self._data[key].update(fields)
            self._save()
            return self._data[key]

    def set_state(self, msg_id, state, error=None):
        fields = {'state': state}
        if error is not None:
            fields['error'] = error
        return self.update(msg_id, **fields)

    def mark_streamed(self, msg_id):
        return self.update(msg_id, last_streamed_at=int(time.time()))

    def get(self, msg_id):
        return self._data.get(str(msg_id))

    def list(self):
        with self._lock:
            return dict(self._data)

    def purge(self, msg_id):
        with self._lock:
            key = str(msg_id)
            if key in self._data:
                del self._data[key]
                self._save()

    def find_stale_forwarded(self, retention_seconds):
        """IDs no estado FORWARDED sem visualização recente via /stream há
        mais tempo que `retention_seconds` — candidatos a limpeza de cache."""
        now = int(time.time())
        stale = []
        with self._lock:
            for msg_id, item in self._data.items():
                if item.get('state') != FORWARDED:
                    continue
                last_seen = item.get('last_streamed_at') or item.get('forwarded_at') or 0
                if now - last_seen > retention_seconds:
                    stale.append(msg_id)
        return stale
