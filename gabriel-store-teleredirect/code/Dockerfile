# Build context é esta própria pasta (code/) — mesma convenção usada nos
# outros apps do repo: `docker build -t tag .` de dentro de code/, ou
# `docker-compose.yml`/`make release` na raiz apontando context: ./code.
#
# Ainda assim, dentro da imagem o código fica em /app/code (não em /app
# direto): code/config.py calcula BASE_PATH um nível acima de si mesmo
# (onde ficam config/ e data/ fora do container), então precisamos manter
# essa mesma relação de pastas — daqui o COPY . ./code/ abaixo, em vez de
# copiar tudo direto pra /app/.
FROM python:3.12-slim

WORKDIR /app

# Camada separada só com requirements.txt pra cache do pip sobreviver a
# mudanças no código que não tocam em dependências.
COPY requirements.txt ./code/requirements.txt
RUN pip install --no-cache-dir -r code/requirements.txt gunicorn gevent

COPY . ./code/

WORKDIR /app/code

# ffmpeg vem embutido via imageio-ffmpeg (requirements.txt) — sem apt-get.
ENV PORT=5153 \
    PYTHONUNBUFFERED=1

EXPOSE 5153

# Servidor de produção (gunicorn + gevent), igual ao `make serve` nativo —
# não trava com os streams de mídia de longa duração.
CMD ["sh", "-c", "gunicorn -w 1 -k gevent -b 0.0.0.0:${PORT} app:app"]
