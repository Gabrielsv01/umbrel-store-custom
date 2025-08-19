import os
import requests
from telegram.ext import Application, MessageHandler, ContextTypes, filters

WEBHOOK_URL = os.environ.get("WEBHOOK_URL")
FORWARD_ENDPOINT = os.environ.get("FORWARD_ENDPOINT")
TOKEN_API = os.environ.get("TELEGRAM_BOT_TOKEN")
PORT = int(os.environ.get("PORT", 5125))

async def forward_message(update, context: ContextTypes.DEFAULT_TYPE):
    if FORWARD_ENDPOINT:
        data = update.to_dict()
        try:
            requests.post(FORWARD_ENDPOINT, json=data, timeout=5)
        except Exception as e:
            print(f"Erro ao encaminhar mensagem: {e}")

async def main():
    app = Application.builder().token(TOKEN_API).build()
    app.add_handler(MessageHandler(filters.ALL, forward_message))
    await app.bot.set_webhook(WEBHOOK_URL)
    await app.run_webhook(
        listen="0.0.0.0",
        port=PORT,
        url_path="/api/telegram"
    )

if __name__ == '__main__':
    import asyncio

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop and loop.is_running():
        loop.create_task(main())
    else:
        asyncio.run(main())