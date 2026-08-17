import os
import yaml

# BASE_PATH é a raiz do projeto (um nível acima de code/), onde ficam as
# pastas config/ e data/.
BASE_PATH = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_PATH = os.path.join(BASE_PATH, 'config', 'config.yaml')

# DATA_PATH agrupa todo dado de runtime (sessão, estado, cache, log) — nada
# ali é código nem config, só estado gerado/consumido pelo próprio app.
# Criado aqui (não só no BotManager) pra existir mesmo em scripts standalone
# como login_generate.py, num clone novo sem a pasta ainda.
DATA_PATH = os.path.join(BASE_PATH, 'data')
os.makedirs(DATA_PATH, exist_ok=True)


def load_config(path=CONFIG_PATH):
    with open(path, 'r') as f:
        return yaml.safe_load(f)


def get_telethon_credentials(cfg):
    api_id = int(os.getenv('TELETHON_API_ID', cfg.get('telethon', {}).get('api_id')))
    api_hash = os.getenv('TELETHON_API_HASH', cfg.get('telethon', {}).get('api_hash'))
    return api_id, api_hash


def get_base_url(cfg):
    return os.getenv('TELE_REDIRECT_BASE_URL', cfg.get('proxy', {}).get('base_url', 'http://localhost:5153'))


def get_forward_ids(cfg):
    bot_id = int(os.getenv('TELE_REDIRECT_FROM_BOT_ID', cfg.get('forward', {}).get('from_bot_id')))
    target_group = int(os.getenv('TELE_REDIRECT_TO_GROUP_ID', cfg.get('forward', {}).get('to_group_id')))
    return bot_id, target_group


def get_cache_retention_seconds(cfg, default=3600):
    return int(cfg.get('cache', {}).get('retention_seconds', default))


def get_cleanup_interval_seconds(cfg, default=300):
    return int(cfg.get('cache', {}).get('cleanup_interval_seconds', default))


def get_status_message_interval_seconds(cfg, default=20):
    return int(cfg.get('forward', {}).get('status_message_interval_seconds', default))


def get_download_throughput_floor_bytes_per_sec(cfg, default_kbps=150):
    return int(cfg.get('download', {}).get('min_throughput_kbps', default_kbps)) * 1024


def get_upload_throughput_floor_bytes_per_sec(cfg, default_kbps=80):
    return int(cfg.get('upload', {}).get('min_throughput_kbps', default_kbps)) * 1024


def get_upload_max_part_size_bytes(cfg, default_mb=1900):
    return int(cfg.get('upload', {}).get('max_part_size_mb', default_mb)) * 1024 * 1024


def get_upload_experimental_streaming_split(cfg, default=False):
    return bool(cfg.get('upload', {}).get('experimental', {}).get('streaming_split', default))


def get_download_timeout_defaults(cfg, default_timeout=1800, default_grace=60):
    d = cfg.get('download', {})
    return int(d.get('default_timeout_seconds', default_timeout)), int(d.get('timeout_grace_seconds', default_grace))


def get_partial_remux_tuning(cfg, default_interval=20, default_min_new_bytes_mb=8):
    r = cfg.get('remux', {})
    interval_seconds = int(r.get('partial_interval_seconds', default_interval))
    min_new_bytes = int(r.get('partial_min_new_bytes_mb', default_min_new_bytes_mb)) * 1024 * 1024
    return interval_seconds, min_new_bytes
