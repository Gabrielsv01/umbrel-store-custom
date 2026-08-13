# login_generate.py
# Este script gera a string de sessão (string.session) necessária para o TeleRedirect.
# Execute-o uma vez no terminal. Ele pedirá o número de telefone e o código que o Telegram enviar.
# Copie a string impressa e ela será salva automaticamente em "string.session".

import os
from telethon.sync import TelegramClient
from telethon.sessions import StringSession

import config

SESSION_PATH = os.path.join(config.DATA_PATH, 'string.session')

cfg = config.load_config()
api_id, api_hash = config.get_telethon_credentials(cfg)

# Cria cliente sem sessão pré‑carregada (StringSession())
client = TelegramClient(StringSession(), api_id, api_hash)
print('Iniciando login do Telegram...')
client.start()  # solicita telefone + código no terminal

# Salva a string da sessão
session_str = client.session.save()
with open(SESSION_PATH, 'w') as f:
    f.write(session_str)

print('\n=== STRING SESSION SALVA EM string.session ===')
print(session_str)
print('\nAgora você pode iniciar a aplicação TeleRedirect com "uv run app.py".')
