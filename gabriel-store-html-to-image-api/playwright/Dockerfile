# Dockerfile.playwright

# Usa a imagem base do serviço Playwright
FROM dgtlmoon/sockpuppetbrowser:latest

# Instala pacotes de fontes comuns usando apk (Alpine Linux Package Manager)
# Noto-cjk é um bom fallback, e ttf-dejavu geralmente resolve o negrito.
USER root
RUN apk update && \
    apk add --no-cache \
    ttf-dejavu \
    font-noto \
    && rm -rf /var/cache/apk/*

# Nota: Não precisamos do 'ttf-wqy-zenhei' (chinês/japonês) a menos que seu HTML use estes caracteres.
# O ttf-dejavu e font-noto devem ser suficientes para o negrito em latim.