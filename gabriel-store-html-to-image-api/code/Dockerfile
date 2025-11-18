# --- STAGE 1: BUILD ---
# Usa a imagem Node.js padrão (baseada em Debian)
FROM node:18 AS builder

# Instala as dependências de sistema para o Chromium (mínimo necessário no Debian)
WORKDIR /app
RUN apt-get update && apt-get install -y \
    ca-certificates \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libcurl4 \
    libgconf-2-4 \
    libnss3 \
    libgbm-dev \
    libxrandr2 \
    xdg-utils \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Copiar e instalar dependências Node
COPY package*.json ./
COPY tsconfig.json ./
RUN npm ci

# 🚨 CORREÇÃO CRÍTICA DO CACHE: Define o caminho antes de instalar
ENV PUPPETEER_CACHE_DIR=/app/.cache/puppeteer

# Garante que o diretório de cache exista
RUN mkdir -p ${PUPPETEER_CACHE_DIR}

# 1. Instala o Puppeteer globalmente para acesso fácil ao binário
# 2. Roda o comando de instalação no diretório de cache garantido
RUN npm install -g puppeteer && \
    /usr/local/bin/puppeteer install

# Copiar e compilar o código
COPY src/ ./src/
RUN npm run build

# --- STAGE 2: PRODUCTION/RUNTIME ---
FROM node:18-slim AS production

# Reinstala as libs de sistema essenciais na imagem slim
WORKDIR /app
RUN apt-get update && apt-get install -y \
    ca-certificates \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libcurl4 \
    libgconf-2-4 \
    libnss3 \
    libgbm1 \
    libxrandr2 \
    xdg-utils \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/* \
    && rm -rf /tmp/*

# Instalação das dependências Node de produção
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copiar código compilado e o binário do Chromium baixado
COPY --from=builder /app/dist ./dist

# Garante que o Puppeteer encontre o Chromium que ele mesmo baixou
ENV PUPPETEER_CACHE_DIR=/app/.cache/puppeteer
COPY --from=builder /app/.cache/puppeteer ${PUPPETEER_CACHE_DIR}

EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').request({hostname: 'localhost', port: 3001, path: '/html-body-to-image', method: 'POST', headers: {'Content-Type': 'text/html'}}, res => process.exit(res.statusCode === 200 ? 0 : 1)).end('<html>Test</html>')"

# 🎯 CORREÇÃO FINAL: Usa o nome do arquivo compilado corretamente
CMD ["node", "dist/app.js"]