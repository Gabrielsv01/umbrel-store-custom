# 📊 Análise Completa do Repositório umbrel-store-custom

**Autor**: Gabriel S. Vieira  
**Licença**: MIT (2025)  
**Versão do Repositório**: gabriel-store  
**Total de Apps**: 23  

---

## 📁 Arquivos da Raiz

| Arquivo | Descrição |
|---------|-----------|
| `umbrel-app-store.yml` | Configuração da app store com ID: `gabriel-store` |
| `LICENSE` | MIT License (2025) |
| `README.md` | Documentação principal da loja |
| `.gitignore` | Configuração do Git |
| `.git/` | Repositório Git |

---

## 🏗️ Estrutura Geral

O repositório organiza-se em **24 diretórios de apps** (padrão `gabriel-store-*`), cada um contendo:
- `umbrel-app.yml` - Metadados e configuração Umbrel
- `docker-compose.yml` - Orquestração de containers
- `code/` (opcional) - Código-fonte da aplicação
- Arquivos de configuração específicos

---

## 📦 Catálogo Completo de Apps (24 Total)

### 🎵 **Categoria: Multimídia** (6 apps)

#### 1. **gabriel-store-ffmpeg** - FFmpeg API
- **Versão**: 1.0.9
- **Porta**: 5135
- **Tecnologia**: TypeScript/Node.js (Express)
- **Propósito**: API REST para processamento de vídeo/áudio
- **Estrutura**:
  - `code/src/` - Código TypeScript
  - `shared/input/` e `shared/output/` - Volumes para processamento
- **Docker**:
  - **ffmpeg**: `linuxserver/ffmpeg:arm64v8-latest` (worker)
  - **ffmpeg-api**: `gabrielsv01/ffmpeg-api:1.0.9` (API)
- **Variáveis Importantes**:
  - `PORT=5135`
  - `MAX_CONCURRENT_JOBS=3`
- **Dependências**: Usa docker.sock para orquestração
- **Arquitetura**: Job queue system com interface web
- **Funcionalidades**: Jobs, filas, upload/download, interface web

---

#### 2. **gabriel-store-webtop** - Personal Web Desktop
- **Versão**: 1.0.2
- **Porta**: 5134
- **Tecnologia**: Desktop GUI em navegador
- **Propósito**: Acesso a desktop completo via web
- **Imagem**: Não customizada (wrapper)
- **Funcionalidades**: Aplicações e arquivos via web

---

#### 3. **gabriel-store-ardour** - Digital Audio Workstation
- **Versão**: 1.0.1
- **Porta**: 5132
- **Tecnologia**: DAW Desktop
- **Propósito**: Gravação, edição e mixing de áudio
- **Website**: https://ardour.org
- **Funcionalidades**: Multi-track recording, MIDI, mixing

---

#### 4. **gabriel-store-kdenlive** - Video Editor
- **Versão**: 1.0.2
- **Porta**: 5129
- **Tecnologia**: Non-linear video editor
- **Propósito**: Edição profissional de vídeo
- **Website**: https://kdenlive.org
- **Funcionalidades**: Timeline editing, effects, transitions

---

#### 5. **gabriel-store-freecad** - 3D CAD Modeler
- **Versão**: 1.0.1
- **Porta**: 5133
- **Tecnologia**: Parametric 3D CAD
- **Propósito**: Modelagem 3D e CAD
- **Website**: https://freecad.org
- **Funcionalidades**: Parametric modeling, assembly design, rendering

---

#### 6. **gabriel-store-jupyter-notebook** - Jupyter Notebook
- **Versão**: 1.0.0
- **Porta**: 5127
- **Tecnologia**: Python/Jupyter com SciPy
- **Propósito**: Computação científica e análise de dados
- **Website**: https://jupyter.org
- **Funcionalidades**: IPython notebooks, data science tools

---

### 🛠️ **Categoria: Utilities/APIs Customizadas** (8 apps)

#### 7. **gabriel-store-webhook-gateway** - Universal Webhook Gateway
- **Versão**: 1.0.19 ⭐ (MAIS ATUALIZADO)
- **Porta**: 5124
- **Tecnologia**: TypeScript/Node.js (Express + Vite)
- **Propósito**: Receber, filtrar e repassar webhooks de múltiplos serviços
- **Autor**: Gabriel Vieira (desenvolvido internamente)
- **Docker**:
  - `gabrielsv01/webhook-gateway:1.0.17`
  - Porta: 5124
- **Variáveis Importantes**:
  - `PORT=5124`
  - `ENABLE_HELMET=true` (segurança)
  - `ENABLE_CSP=false`, `ENABLE_HSTS=true`
  - `LOGIN_PASSWORD_HASH=$2a$14$2ugEF5bxlp5NiAqfSGx3dOpsfcZD.lMZ/CqQzfYP.ecZXr.C5WDYe`
  - Default password: "admin"
- **Volumes**:
  - `${APP_DATA_DIR}/code/webhooks.yml` - Configuração de webhooks
- **Stack Técnico**:
  - Backend: Express 5.x, TypeScript
  - Frontend: Vite (build tool)
  - Autenticação: bcrypt (hash)
  - Rate limiting: express-rate-limit
  - Security: Helmet.js
- **Funcionalidades**: Gateway universal, configuração YAML, interface web, autenticação

---

#### 8. **gabriel-store-docker-control-api** - Docker Control API
- **Versão**: 1.0.5
- **Porta**: 5123
- **Tecnologia**: Python/Flask
- **Propósito**: Controlar containers Docker remotamente
- **Autor**: Gabriel Vieira
- **Docker**:
  - `gabrielsv01/docker-control-api:1.0.5`
  - Acesso ao docker.sock
- **Variáveis Importantes**:
  - `USERNAME=admin`
  - `PASSWORD=password123`
  - `AUTHORIZED_CONTAINERS=container_name1,container_name2`
- **Segurança**: Lista de containers autorizados
- **Funcionalidades**: Gerenciar containers, volumes, redes

---

#### 9. **gabriel-store-html-to-image-api** - HTML to Image Converter
- **Versão**: 1.0.4
- **Porta**: 5137
- **Tecnologia**: TypeScript/Node.js + Puppeteer + Playwright
- **Propósito**: Converter HTML em imagens PNG/JPEG
- **Docker**:
  - **html-to-image-api**: `gabrielsv01/html-to-image-api:1.0.3`
  - **playwright**: `gabrielsv01/playwright-with-fonts-fallback:1.0.0`
- **Variáveis Importantes**:
  - `PORT=3001` (interno), mapeado para `5137`
  - `TIMER_LOAD_MS=9000`
  - `BROWSER_WS_URL=ws://playwright:3000?ignoreHTTPSErrors=true`
  - `SCREEN_WIDTH=1920`, `SCREEN_HEIGHT=1024`
  - `MAX_CONCURRENT_CHROME_PROCESSES=10`
- **Stack Técnico**:
  - Express + Puppeteer (headless Chrome)
  - Playwright container com fontes fallback
  - tmpfs para performance
- **Funcionalidades**: Render HTML to PNG, website screenshots, custom dimensions

---

#### 10. **gabriel-store-telegram-webhook-api** - Telegram Webhook API
- **Versão**: 1.0.14
- **Porta**: 5125
- **Tecnologia**: TypeScript/Node.js (Express)
- **Propósito**: API para webhooks do Telegram
- **Autor**: Gabriel Vieira
- **Docker**: `gabrielsv01/telegram-webhook-api:1.0.14`
- **Variáveis Importantes**:
  - `PORT=5125`
  - `TELEGRAM_BOT_TOKEN=123` (config required)
  - `URI_BASE=/api/telegram`
  - `WEBHOOK_URL=https://ngrok-free.app` (expor ao exterior)
  - `FORWARD_ENDPOINT=http://umbrel.local` (para webhook interno)
  - `NGROK_WEB_URL=http://umbrel.local:4040/status` (status do ngrok)
- **Integração**: Funciona com **gabriel-store-ngrok**
- **Funcionalidades**: Receber updates do Telegram, fazer forward de mensagens

---

#### 11. **gabriel-store-whisper-asr-box** - Speech Recognition
- **Versão**: 1.0.0
- **Porta**: 5136
- **Tecnologia**: OpenAI Whisper (Python)
- **Propósito**: Transcrição de áudio via Speech Recognition
- **Desenvolvedora**: ahmetoner
- **Website**: https://ahmetoner.com/whisper-asr-webservice
- **Funcionalidades**: Transcrever áudio MP3/WAV em texto, suporte multilíngue
- **Path**: `/docs` para documentação

---

#### 12. **gabriel-store-docling-server** - Document Processing
- **Versão**: 1.0.0
- **Porta**: 5001
- **Tecnologia**: Python (FastAPI/Docling)
- **Propósito**: Processamento de documentos (PDF, DOCX, PPTX, XLSX, etc.)
- **Website**: https://docling-project.github.io/docling/
- **Funcionalidades**:
  - Parsing avançado de PDF (layout, tabelas, código)
  - Suporte OCR para PDFs scanned
  - Integração com LLMs, LangChain, LlamaIndex
  - Export: Markdown, HTML, DocTags, JSON
  - Suporte a áudio com ASR
  - Visual Language Models (SmolDocling)
- **Endpoints**:
  - `/docs` - Documentação interativa
  - `/scalar` - Scalar docs
  - `/ui` - Interface web

---

#### 14. **gabriel-store-ngrok** - Ngrok Tunnel
- **Versão**: 1.0.0
- **Porta**: 4040
- **Tecnologia**: Ngrok (tunnel service)
- **Propósito**: Expor serviços Umbrel para internet com segurança
- **Website**: https://ngrok.com
- **Integração**: Funciona com **gabriel-store-telegram-webhook-api**
- **Funcionalidades**: Túnel seguro, painel de controle em :4040

---

### 🎮 **Categoria: Games/Emuladores** (4 apps)

#### 15. **gabriel-store-pcsx2** - PlayStation 2 Emulator
- **Versão**: 1.0.4
- **Porta**: 5138
- **Tecnologia**: PCSX2 (emulador PS2)
- **Propósito**: Jogar jogos PS2 via navegador
- **Permissões**: `STORAGE_DOWNLOADS`
- **Requisitos**:
  - BIOS files em `config/bios/`
  - Game ISOs em `games/`
  - Controller USB/Bluetooth recomendado
- **Website**: https://pcsx2.net
- **Imagem**: LinuxServer.io

---

#### 16. **gabriel-store-retroarch** - Retro Game Emulator
- **Versão**: 1.0.0
- **Porta**: 5140
- **Tecnologia**: Retroarch (frontend de emuladores)
- **Propósito**: Jogar jogos retro (NES, SNES, Genesis, etc.)
- **Permissões**: `STORAGE_DOWNLOADS`
- **Requisitos**:
  - Game ISOs/ROMs em `games/`
  - Controller recomendado
- **Website**: https://retroarch.com
- **Imagem**: LinuxServer.io

---

#### 17. **gabriel-store-steamos** - Steam Big Picture
- **Versão**: 1.0.3
- **Porta**: 5139
- **Tecnologia**: SteamOS via Docker (Arch Linux)
- **Propósito**: Rodar Steam em Big Picture mode no navegador
- **Notas**: Requer debugs adicionais (DBus, Vulkan drivers)
- **Funcionalidades**: Streaming de jogos Steam, controle via web

---

#### 18. **gabriel-store-xemu** - Xbox Emulator
- **Versão**: 1.0.0
- **Porta**: 5141
- **Tecnologia**: Xemu (emulador Xbox original)
- **Propósito**: Jogar jogos Xbox original
- **Permissões**: `STORAGE_DOWNLOADS`
- **Requisitos**:
  - Game ISOs em `games/`
  - Controller recomendado
- **Website**: https://xemu.app
- **Imagem**: LinuxServer.io

---

### 🤖 **Categoria: AI/ML** (3 apps)

#### 19. **gabriel-store-kokoro** - Kokoro TTS
- **Versão**: 0.2.4
- **Porta**: 5142
- **Tecnologia**: Text-to-Speech com 82M parameters
- **Propósito**: Síntese de voz de alta qualidade com modelo compacto
- **Desenvolvedor**: Hexgrad
- **Website**: https://kokorotts.net/
- **Organização**: RemSky fork (https://github.com/remsky/Kokoro-FastAPI)
- **Tamanho**: ~4GB
- **Path**: `/web/` para interface web
- **API**: Documentação em `/docs`
- **Funcionalidades**:
  - Síntese natural de voz
  - Nuances emocionais
  - Suporte a múltiplas línguas
  - Apple Silicon MPS acceleration
  - Volume multiplier
  - Streaming e download
- **Gallery**: 3 imagens de demonstração
- **Navegadores**: Apenas Chromium-based (Chrome, Edge, Brave)

---

#### 20. **gabriel-store-open-claw** - Open Claw AI Gateway
- **Versão**: 1.0.2
- **Porta**: 5143
- **Tecnologia**: Python/FastAPI (Alpine Linux)
- **Propósito**: Gateway de IA para criar agentes personalizados
- **Desenvolvedor**: Open Claw Team
- **Website**: https://openclaw.io
- **Permissões**: `STORAGE_DOWNLOADS`
- **Funcionalidades**: Automação de tarefas, agentes conversacionais, integração com serviços

---

#### 21. **gabriel-store-pico-claw** - Pico Claw AI Gateway
- **Versão**: 1.0.0
- **Porta**: 5144
- **Tecnologia**: Python/FastAPI (Alpine Linux)
- **Propósito**: Gateway de IA compacto (versão "Pico")
- **Desenvolvedor**: Pico Claw Team
- **Website**: https://picoclaw.io
- **Permissões**: `STORAGE_DOWNLOADS`
- **Funcionalidades**: Gateway leve para agentes de IA

---

### 📡 **Categoria: Web Monitoring/Utilities** (1 app)

#### 22. **gabriel-store-changedetection** - Web Change Detection
- **Versão**: 1.0.1
- **Porta**: 5131
- **Tecnologia**: Python/Flask (changedetection.io)
- **Propósito**: Monitorar mudanças em páginas web
- **Website**: https://changedetection.io
- **Funcionalidades**: Alertas de mudanças, histórico de versões, comparação

---

## 📊 Resumo de Distribuição

### Por Categoria:
- **Multimídia**: 6 apps (Ardour, Changedetection, ffmpeg, FreeCAD, Kdenlive, Webtop)
- **Utilities/APIs**: 7 apps (Webhook-Gateway, Docker-Control, HTML2Image, Telegram-API, Whisper, Docling, Ngrok)
- **Games/Emuladores**: 4 apps (PCSX2, Retroarch, SteamOS, Xemu)
- **AI/ML**: 3 apps (Kokoro, Open Claw, Pico Claw)

### Por Tipo de Desenvolvimento:
- **Apps Portados** (não-customizados): 13 apps - usam imagens oficiais ou LinuxServer
  - Ardour, Changedetection, FreeCAD, Jupyter, Kdenlive, Webtop, PCSX2, Retroarch, SteamOS, Xemu, Kokoro, Docling, Ngrok

- **APIs/Wrappers Customizados (com código)**: 5 apps
  - FFmpeg API (TypeScript)
  - Webhook-Gateway (TypeScript/Vite)
  - Docker-Control-API (Python/Flask)
  - HTML-to-Image-API (TypeScript)
  - Telegram-Webhook-API (TypeScript)

- **Gateways IA**: 2 apps
  - Open Claw
  - Pico Claw

### Por Porta:
```
4040    - ngrok
5001    - docling-server
5123    - docker-control-api
5124    - webhook-gateway
5125    - telegram-webhook-api
5127    - jupyter-notebook
5129    - kdenlive
5131    - changedetection
5132    - ardour
5133    - freecad
5134    - webtop
5135    - ffmpeg
5136    - whisper-asr-box
5137    - html-to-image-api
5138    - pcsx2
5139    - steamos
5140    - retroarch
5141    - xemu
5142    - kokoro
5143    - open-claw
5144    - pico-claw
```

---

## 🔗 Integrações e Dependências

### Integrações Conhecidas:
1. **Telegram Ecosystem**:
   - `telegram-webhook-api` usa `ngrok` para expor ao exterior

2. **FFmpeg Pipeline**:
   - `ffmpeg-api` utiliza linuxserver/ffmpeg como worker
   - Usa docker.sock para orquestração

3. **Document Processing**:
   - `docling-server` + `whisper-asr-box` para processamento de áudio
   - Integração com LLMs (Open Claw, Pico Claw)

4. **Web Rendering**:
   - `html-to-image-api` usa Playwright como worker
   - Pode ser usado por `webhook-gateway`

5. **Games Infrastructure**:
   - PCSX2, Retroarch, Xemu, SteamOS - todos requerem storage shared para ROMs/ISOs

### Dependências Externas:
- **Docker Socket**: docker-control-api, ffmpeg-api
- **Ngrok Account**: ngrok (requer autenticação)
- **Chrome/Playwright**: html-to-image-api
- **Telegram Bot Token**: telegram-webhook-api
- **BIOS/Game Files**: Emuladores requerem arquivos do usuário

---

## 🛠️ Stack Tecnológico Dominante

### Backend:
- **TypeScript/Node.js**: 4 APIs (ffmpeg, webhook-gateway, telegram-webhook-api, html-to-image-api)
- **Python**: Docker-Control-API, Docling, Whisper, Kokoro, Open Claw, Pico Claw

### Frontend:
- **Web-based**: Todos os apps (navegador como interface)
- **Vite**: webhook-gateway (build tool moderno)

### Orquestração:
- **Docker Compose**: Todos os apps
- **Volumes Persistentes**: Configuração, dados de usuários, ROMs

---

## 📈 Padrões Arquiteturais

### 1. **API Gateway Pattern**:
   - webhook-gateway (roteador universal)
   - telegram-webhook-api (roteador Telegram)
   - Docling (API wrapper de processamento)

### 2. **Microserviços com Dependências**:
   - ffmpeg: API + Worker separados
   - html-to-image: API + Playwright separados

### 3. **Standalone Desktop Apps Dockerizados**:
   - Ardour, Kdenlive, FreeCAD, SteamOS
   - Renderizados no navegador (VNC, web UI)

### 4. **AI Agent Gateways**:
   - Open Claw, Pico Claw
   - Interfaces para LLMs e automação

---

## 🔒 Segurança

### Autenticação:
- **webhook-gateway**: bcrypt hash (LOGIN_PASSWORD_HASH)
- **docker-control-api**: USERNAME/PASSWORD básico
- **Telegram**: Token-based (TELEGRAM_BOT_TOKEN)

### Segurança HTTP:
- **webhook-gateway**:
  - Helmet.js habilitado
  - HSTS habilitado
  - No-Sniff habilitado
  - Frameguard habilitado
  - XSS Filter habilitado
  - CSP desabilitado (flexibilidade)

### Isolamento de Containers:
- docker-control-api filtra containers autorizados
- Volumes separados por aplicação
- tmpfs para dados temporários (html-to-image)

---

## 📋 Matriz de Recursos por App

| App | Versão | Porta | Tipo | Tech | Requer Config |
|-----|--------|-------|------|------|-----------------|
| ffmpeg | 1.0.9 | 5135 | API | TypeScript | docker.sock |
| webhook-gateway | 1.0.19 | 5124 | Gateway | TS/Vite | webhooks.yml |
| docker-control-api | 1.0.5 | 5123 | API | Python | PASSWORD |
| html-to-image-api | 1.0.4 | 5137 | API | TypeScript | Playwright |
| telegram-webhook-api | 1.0.14 | 5125 | API | TypeScript | BOT_TOKEN |
| whisper-asr-box | 1.0.0 | 5136 | Service | Python | - |
| docling-server | 1.0.0 | 5001 | Service | Python | - |
| ngrok | 1.0.0 | 4040 | Tunnel | Go | TOKEN |
| ardour | 1.0.1 | 5132 | DAW | C++ | - |
| kdenlive | 1.0.2 | 5129 | Editor | C++ | - |
| freecad | 1.0.1 | 5133 | CAD | C++ | - |
| jupyter | 1.0.0 | 5127 | Notebook | Python | - |
| webtop | 1.0.2 | 5134 | Desktop | Linux | - |
| changedetection | 1.0.1 | 5131 | Monitor | Python | - |
| kokoro | 0.2.4 | 5142 | TTS | Python | - |
| open-claw | 1.0.2 | 5143 | Gateway | Python | - |
| pico-claw | 1.0.0 | 5144 | Gateway | Python | - |
| pcsx2 | 1.0.4 | 5138 | Emulator | C++ | BIOS/ISOs |
| retroarch | 1.0.0 | 5140 | Emulator | C | ROMs |
| steamos | 1.0.3 | 5139 | OS | Linux | - |
| xemu | 1.0.0 | 5141 | Emulator | C | ISOs |

---

## 🚀 Apps Mais Ativos (por versão)

1. **webhook-gateway**: v1.0.19 ⭐ (19 updates)
2. **telegram-webhook-api**: v1.0.14 (14 updates)
3. **ffmpeg**: v1.0.9 (9 updates)
4. **docker-control-api**: v1.0.5 (5 updates)
5. **html-to-image-api**: v1.0.4 (4 updates)
6. **pcsx2**: v1.0.4 (4 updates)
7. **steamos**: v1.0.3 (3 updates)

---

## 💡 Recomendações de Uso

### Para Automação/Webhooks:
1. **webhook-gateway** (principal) + **ngrok** (exposição externa)
2. Integre com **telegram-webhook-api** para notificações

### Para Processamento Multimídia:
1. **ffmpeg** (vídeo/áudio básico)
2. **html-to-image-api** (screenshotting)
3. **whisper-asr-box** (transcrição)
4. **docling-server** (OCR/parsing)

### Para Criação de Conteúdo:
1. **ardour** (áudio)
2. **kdenlive** (vídeo)
3. **freecad** (3D)
4. **kokoro** (TTS)

### Para Desenvolvimento:
1. **docker-control-api** (gerenciar containers)
2. **jupyter** (análise de dados)
3. **webtop** (desktop remoto)

### Para Diversão/Gaming:
1. **pcsx2**, **retroarch**, **xemu**, **steamos** em sequência baseada no gênero

---

## 📚 Documentação e Recursos

- Maioria dos apps tem `.yml` bem documentado
- `webhook-gateway` tem `webhooks.yml` para configuração
- `docling-server` tem documentação em `/docs`
- `ffmpeg` tem README em `dist/doc/`
- Repositório principal: https://github.com/Gabrielsv01/umbrel-store-custom

---

**Última Atualização**: Março de 2026  
**Analisado em**: 19/03/2026
