from telegram.ext import Updater
import os
import requests
from telegram.ext import MessageHandler, filters

# URL do seu servidor onde o bot está rodando
WEBHOOK_URL = os.environ.get("WEBHOOK_URL")
FORWARD_ENDPOINT = os.environ.get("FORWARD_ENDPOINT")
TOKEN_API = os.environ.get("TELEGRAM_BOT_TOKEN")
PORT = os.environ.get("PORT", 5125)

def main():
    updater = Updater(TOKEN_API, use_context=True)
    dp = updater.dispatcher

    updater.bot.setWebhook(WEBHOOK_URL)
    
    updater.start_webhook(listen="0.0.0.0",
                          port=PORT,
                          url_path="telegram")
    

    def forward_message(update, context):
        if FORWARD_ENDPOINT:
            data = update.to_dict()
            try:
                requests.post(FORWARD_ENDPOINT, json=data, timeout=5)
            except Exception as e:
                print(f"Erro ao encaminhar mensagem: {e}")

    dp.add_handler(MessageHandler(filters.ALL, forward_message))

    updater.idle()

if __name__ == '__main__':
    main()