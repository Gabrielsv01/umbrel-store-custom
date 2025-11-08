FROM node:18-alpine AS builder

WORKDIR /app

# Copiar arquivos de configuração
COPY package*.json ./
COPY tsconfig.json ./

# Instalar dependências (incluindo devDependencies para build)
RUN npm ci

# Copiar código fonte
COPY src/ ./src/

# Compilar TypeScript
RUN npm run build

# Copiar arquivos estáticos da UI
COPY src/api/ui/ ./dist/api/ui/

# Estágio de produção
FROM node:18-alpine AS production

# Instala Docker CLI para poder executar comandos docker exec
RUN apk add --no-cache docker-cli

WORKDIR /app

# Copiar apenas package.json e package-lock.json
COPY package*.json ./

# Instalar apenas dependências de produção
RUN npm ci --only=production && npm cache clean --force

# Copiar código compilado do estágio builder
COPY --from=builder /app/dist ./dist

# Criar diretórios compartilhados
RUN mkdir -p /shared/input /shared/output

# Expor porta
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/status', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

# Comando para iniciar a aplicação
CMD ["node", "dist/app.js"]