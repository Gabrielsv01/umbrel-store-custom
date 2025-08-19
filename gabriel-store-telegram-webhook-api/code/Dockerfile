FROM python:3.9-slim

WORKDIR /app

COPY . /app

RUN pip install python-telegram-bot requests

EXPOSE 5125

CMD ["python", "app.py"]