# 🛒 Umbrel Store Custom - Gabriel Vieira

Uma **loja customizada de aplicativos para Umbrel** com **24 apps** em categorias como multimídia, IA/ML, games, automação e DevOps. Repositório criado por [Gabriel Vieira](https://github.com/Gabrielsv01) para disponibilizar apps não presentes na loja oficial, adaptações e integrações originais.

---

## 🚀 Visão Geral

| Aspecto | Detalhes |
|---------|----------|
| **Apps** | 23 aplicativos containerizados |
| **Stack Principal** | TypeScript (5 apps), Python (9 apps), C++/C (8 apps) |
| **Pilar Técnico** | Docker Compose, Express.js, FastAPI, Node.js |
| **Hub Central** | Gateway de Webhooks (integrações universais) |
| **Integração Chave** | Telegram ↔ Ngrok ↔ Webhook Gateway |

---

## 📂 Catálogo de Apps

### 🎵 **Multimídia & Edição** (6 apps)

| App | Descrição | Stack | Porta |
|-----|-----------|-------|-------|
| **Ardour** | DAW profissional (gravação, editing, mixagem) | C++ | 6080 |
| **Kdenlive** | Editor de vídeo não-linear (NLE) | C++ | 6080 |
| **FreeCAD** | CAD 3D e design paramétrico | C++ | 5800 |
| **FFmpeg API** | API REST para processamento vídeo/áudio com fila | TypeScript | 3020 |
| **HTML-to-Image API** | Converter HTML em PNG (Puppeteer/Playwright) | TypeScript | 3030 |
| **Whisper ASR Box** | Transcrição automática de áudio (OpenAI Whisper) | Python | 8000 |

### 🎮 **Games & Emulação** (4 apps)

| App | Descrição | Stack | Porta |
|-----|-----------|-------|-------|
| **PCSX2** | Emulador PS2 (PlayStation 2) | C++ | 5800 |
| **Retroarch** | Emulador multisistema (NES, SNES, Genesis, etc.) | C | 5800 |
| **Xemu** | Emulador Xbox original | C++ | 5800 |
| **SteamOS** | Sistema operacional baseado Debian para gaming | Linux | 5800 |

### 🤖 **IA/ML & NLP** (3 apps)

| App | Descrição | Stack | Porta |
|-----|-----------|-------|-------|
| **Kokoro** | Motor TTS (Text-to-Speech) avançado | Python | 8000 |
| **Open Claw** | LLM inference com suporte a múltiplos modelos | Python/C | 8000 |
| **Pico Claw** | LLM ligero com workspace específico | Go | 8000 |

### 🔐 **APIs & Integrações** (5 apps)

| App | Descrição | Stack | Porta |
|-----|-----------|-------|-------|
| **Webhook Gateway** ⭐ | Hub universal: receber, filtrar, repassar webhooks (Telegram, N8N) | TypeScript | 4000 |
| **Telegram Webhook API** | API REST para gerenciar webhooks Telegram | Python | 8000 |
| **Docker Control API** | Gerenciar containers Docker remotamente (API Flask) | Python | 5000 |
| **Ngrok** | Tunnel para expor localhost na internet (integração importante) | Go | 4040 |
| **Webhook Test API** | Testar webhooks em desenvolvimento | TypeScript | 5005 |

### 🛠️ **Utilities & Monitoramento** (5 apps)

| App | Descrição | Stack | Porta |
|-----|-----------|-------|-------|
| **ChangeDetection.io** | Monitorar mudanças em websites | Python | 5000 |
| **Docling Server** | Processamento e análise de documentos | Python | 8000 |
| **Jupyter Notebook** | Ambiente interativo Python/Data Science | Python | 8888 |
| **Webtop** | Desktop virtual no navegador (XFCE/KDE) | Linux | 3000 |
| **Kokoro (Settings)** | Gerenciador de configurações de TTS | Python | 8000 |

---

## 🔗 Arquitetura de Integrações

```
Telegram Bot
    ↓
Ngrok Tunnel (expõe localhost)
    ↓
Webhook Gateway (filtro + roteamento)
    ├→ Telegram Webhook API
    ├→ N8N (via Docker Control API)
    └→ Outras APIs REST
```

**Fluxo Principal:**
1. Telegram Bot envia update via Ngrok
2. Webhook Gateway recebe em `/api/telegram`
3. Filter valida `authorizedChatIds` e `authorizedUsernames` (suporta `message`, `my_chat_member`, `chat_member`)
4. Repassa filtrado para destino configurado em `webhooks.yml`

---

## 📋 Detalhes Técnicos por App

### **Webhook Gateway** (v1.0.19) ⭐

**Responsabilidades:**
- Receber webhooks de múltiplos serviços
- Aplicar filtros customizados (Telegram filter, Alexa skill filter, no filter)
- Repassar para destinos configuráveis
- Log e dashboard de requisições

**Arquivo de Config:** `webhooks.yml`
```yaml
telegram:
  destination: ${TELEGRAM_WEBHOOK_URL}
  authorizedChatIds: ${TELEGRAM_AUTHORIZED_CHAT_IDS}
  authorizedUsernames: ${TELEGRAM_AUTHORIZED_USERNAMES}
  filter: telegramFilter

webhook:
  destination: ${N8N_WEBHOOK_URL}
  filter: telegramFilter

alexa:
  destination: ${ALEXA_WEBHOOK_URL}
  applicationId: ${ALEXA_APPLICATION_ID}
  filter: alexaskillFilter
```

**Suporte a Eventos Telegram:**
- ✅ Mensagens normais (`message`)
- ✅ Mudanças de membership (`my_chat_member`, `chat_member`)
- ✅ Filtragem por chat ID e username
- ✅ Suporte a grupos (group) e canais

### **FFmpeg API**

**Endpoints:**
- `POST /upload` - Upload de arquivo (vídeo/áudio)
- `POST /process` - Submeter job de processamento
- `GET /status/:jobId` - Status do job
- `GET /output/:jobId` - Download resultado

### **Docker Control API**

**Endpoints:**
- `GET /containers` - Listar containers
- `POST /containers/:id/start` - Iniciar container
- `POST /containers/:id/stop` - Parar container
- `GET /containers/:id/logs` - Logs do container

---

## 🎯 Casos de Uso

### **Automação com Telegram**
```
Telegram Bot → Webhook Gateway → N8N Automation → Executar ações (raspagem, processamento, etc.)
```

### **Processamento Multimídia em Lote**
```
Upload arquivo → FFmpeg API → Fila de jobs → Processamento em background → Download resultado
```

### **Desktop Remoto no Navegador**
```
Webtop + ChangeDetection.io + Jupyter = Estação de trabalho virtual
```

### **IA Local**
```
Kokoro (TTS) + Pico Claw (LLM) + Whisper (ASR) = Pipeline de IA completo
```

---

## 🚀 Início Rápido

### **Prerequisitos**
- Docker & Docker Compose
- Git
- Domínio/IP para webhooks (Ngrok recomendado para testes)

### **Instalação de um App**

```bash
# Clone o repositório
git clone https://github.com/Gabrielsv01/umbrel-store-custom.git
cd umbrel-store-custom

# Entre no app desejado
cd gabriel-store-webhook-gateway/code

# Configure variáveis de ambiente
cp .env.sample .env
nano .env

# Suba o container
docker-compose up -d

# Verifique logs
docker-compose logs -f
```

### **Integração Webhook Gateway + Telegram**

1. Crie bot Telegram via `@BotFather`
2. Configure Ngrok: `ngrok http 4000`
3. Configure webhook do bot Telegram para: `https://<ngrok-url>/api/telegram`
4. Edite `webhooks.yml` com IDs de chat autorizados
5. Restart container

---

## 🏗️ Estrutura do Repositório

```
umbrel-store-custom/
├── gabriel-store-*/              # 24 apps (cada um tem seu docker-compose.yml)
│   ├── umbrel-app.yml           # Descrição para Umbrel Store
│   ├── docker-compose.yml       # Configuração Docker
│   ├── code/                    # Source code
│   │   ├── src/
│   │   ├── Dockerfile
│   │   ├── package.json ou requirements.txt
│   │   └── README.md (opcional)
│   └── config/ ou workspace/    # Dados persistentes
├── picoclaw/                     # Submodule Go (LLM)
├── umbrel-app-store.yml         # Manifesto da loja
├── README.md                    # Este arquivo
└── LICENSE                      # MIT License
```

---

## 📚 Stack Técnico

### **Backend**
- **Node.js/TypeScript:** Express, ts-node, axios
- **Python:** FastAPI, Flask, Uvicorn
- **Go:** Gin, Cobra CLI
- **C/C++:** FFmpeg, emuladores

### **Frontend**
- **Vite/React** (alguns apps)
- **HTML/CSS/JS vanilla** (interfaces simples)
- **Webtop:** XFCE/KDE desktop

### **DevOps**
- **Docker Compose** (orquestração local)
- **Environment variables** (configuração dinâmica)
- **Volume mounts** (persistência de dados)
- **Rate limiting** (helmets, express-rate-limit)

### **Segurança**
- **Helmet.js** (headers HTTP)
- **CORS customizado** (por serviço)
- **Autenticação simples** (alguns apps)
- **Validação de webhooks** (chat IDs, usernames)

---

## 🔧 Configuração Comum

Todos os apps suportam variáveis de ambiente via `.env`:

```bash
# Exemplo padrão
PORT=8000
DEBUG=false
NODE_ENV=production
ENABLE_HELMET=true
ENABLE_CSP=true
ENABLE_HSTS=true
```

Para Docker Compose, configure no arquivo `docker-compose.yml`:
```yaml
environment:
  - PORT=8000
  - DEBUG=false
  - TELEGRAM_WEBHOOK_URL=${TELEGRAM_WEBHOOK_URL}
```

---

## 🤝 Contribuindo

Quer adicionar um novo app ou melhorar o projeto?

1. **Fork** o repositório
2. **Crie uma branch:**
   ```bash
   git checkout -b feature/novo-app
   ```
3. **Siga o padrão:**
   - Crie pasta `gabriel-store-novoapp/`
   - Adicione `umbrel-app.yml`, `docker-compose.yml`
   - Documente em `code/README.md`
4. **Commit e Push:**
   ```bash
   git add .
   git commit -m "feat: adiciona novo app XYZ"
   git push origin feature/novo-app
   ```
5. **Abra Pull Request** com descrição detalhada

### **Checklist para Novo App**
- [ ] `docker-compose.yml` funcional
- [ ] `umbrel-app.yml` com metadados
- [ ] `README.md` com instruções
- [ ] `.env.sample` (se aplicável)
- [ ] Testes básicos (logs sem erro)
- [ ] Documentação de endpoints/API (se relevante)

---

## 🐛 Troubleshooting

### **Webhook não chega**
- Verifique URL no `webhooks.yml`
- Confirme chat ID está em `authorizedChatIds` (ou deixe vazio para permitir todos)
- Ative `DEBUG=true` em telegram-related apps
- Veja logs: `docker-compose logs -f `

### **Porta já em uso**
```bash
# Encontre o processo na porta (ex: 4000)
lsof -i :4000
kill -9 <PID>
```

### **Build falha**
```bash
# Limpe cache Docker
docker-compose down
docker system prune -a
docker-compose up --build
```

---

## 📊 Estatísticas do Projeto

- **24 apps** containerizados
- **5 linguagens** principais (TypeScript, Python, C++, Go, C)
- **Centenas de commits** e iterações
- **Integrações múltiplas:** Telegram, N8N, Docker, Ngrok
- **Pronto para produção** em Umbrel OS

---

## 📝 Licença

MIT License - veja [LICENSE](LICENSE) para detalhes.

---

## 📧 Contato & Suporte

**Desenvolvido com ❤️ por [Gabriel Vieira](https://github.com/Gabrielsv01)**

Para dúvidas, sugestões, bugs ou contribuições:
- Abra uma **Issue** no GitHub
- Envie um **Pull Request**
- Entre em contato direto

---

## 🏷️ Tags

`umbrel` `docker` `api` `linux` `automation` `telegram` `webhooks` `multimídia` `emuladores` `ia-ml` `typescript` `python` `devops` `self-hosted`
