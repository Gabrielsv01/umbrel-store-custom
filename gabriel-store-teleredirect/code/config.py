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
