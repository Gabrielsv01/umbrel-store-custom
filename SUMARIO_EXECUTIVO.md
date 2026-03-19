# 📋 Sumário Executivo - umbrel-store-custom

## Quick Facts
- **Total de Apps**: 23
- **API/Wrappers Custom**: 5 (TypeScript/Python)
- **Apps Portados**: 13
- **Gateways IA**: 2
- **Emuladores**: 4
- **Stack**: Predominantly TypeScript (Node.js) e Python
- **Latest Major Updates**: webhook-gateway (v1.0.19)

---

## 🎯 Categorias & Apps

### 🟢 UTILIDADES ESSENCIAIS (APIs Customizadas)
| App | Versão | Porta | Tech | Propósito |
|-----|--------|-------|------|-----------|
| **webhook-gateway** | 1.0.19 | 5124 | TS/Node | Gateway universal de webhooks |
| **docker-control-api** | 1.0.5 | 5123 | Python | Controlar Docker remotamente |
| **html-to-image-api** | 1.0.4 | 5137 | TS/Node | HTML → PNG/JPEG converter |
| **telegram-webhook-api** | 1.0.14 | 5125 | TS/Node | Webhooks do Telegram |
| **ngrok** | 1.0.0 | 4040 | Go | Expor serviços para internet |
| **ffmpeg** | 1.0.9 | 5135 | TS/Node | Processamento vídeo/áudio |

### 🎬 MULTIMÍDIA PROFISSIONAL
| App | Versão | Porta | Tech | Propósito |
|-----|--------|-------|------|-----------|
| **ardour** | 1.0.1 | 5132 | C++ | Digital Audio Workstation |
| **kdenlive** | 1.0.2 | 5129 | C++ | Video editor não-linear |
| **freecad** | 1.0.1 | 5133 | C++ | 3D CAD modeling |
| **jupyter** | 1.0.0 | 5127 | Python | Scientific computing |
| **webtop** | 1.0.2 | 5134 | Linux | Desktop web |

### 🎮 GAMING & EMULAÇÃO
| App | Versão | Porta | Sistema |
|-----|--------|-------|---------|
| **pcsx2** | 1.0.4 | 5138 | PlayStation 2 |
| **retroarch** | 1.0.0 | 5140 | Retro (NES/SNES/etc) |
| **xemu** | 1.0.0 | 5141 | Xbox Original |
| **steamos** | 1.0.3 | 5139 | Steam BigPicture |

### 🤖 AI/ML GATEWAYS
| App | Versão | Porta | Propósito |
|-----|--------|-------|-----------|
| **kokoro** | 0.2.4 | 5142 | TTS (82M params) |
| **open-claw** | 1.0.2 | 5143 | AI Agent Gateway |
| **pico-claw** | 1.0.0 | 5144 | Lightweight AI Gateway |

### 🔍 OUTROS
| App | Versão | Porta | Propósito |
|-----|--------|-------|-----------|
| **docling-server** | 1.0.0 | 5001 | Document processing |
| **whisper-asr-box** | 1.0.0 | 5136 | Speech recognition |
| **changedetection** | 1.0.1 | 5131 | Web change monitoring |

---

## 🔗 Integrações Principais

```
┌─────────────────────────────────────┐
│    TELEGRAM ECOSYSTEM               │
├─────────────────────────────────────┤
│ telegram-webhook-api ←→ ngrok      │
│ ↑                                   │
│ └─→ webhook-gateway (central hub)   │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│    MEDIA PROCESSING PIPELINE        │
├─────────────────────────────────────┤
│ ffmpeg (video/audio)                │
│ html-to-image-api (screenshots)     │
│ whisper-asr-box (transcription)     │
│ docling-server (document parsing)   │
│ ↓                                   │
│ webhook-gateway (output routing)    │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│    AI INFRASTRUCTURE                │
├─────────────────────────────────────┤
│ kokoro (TTS synthesis)              │
│ open-claw / pico-claw (agents)      │
│ ↓                                   │
│ docling, whisper (preprocessing)    │
└─────────────────────────────────────┘
```

---

## 💻 Stack Técnico

### Backend
- **TypeScript/Node.js**: webhook-gateway, ffmpeg-api, telegram-webhook-api, html-to-image-api
- **Python/FastAPI**: docling-server, whisper-asr-box, kokoro, open-claw, pico-claw, docker-control-api
- **C++/C**: Ardour, Kdenlive, FreeCAD, Retroarch, Xemu, PCSX2

### Infra & Orquestração
- **Docker Compose**: Todos
- **Volumes**: Persistência de dados, configuração, ROMs/ISOs

### Security
- **Helmet.js**: webhook-gateway (HSTS, Frameguard, No-Sniff, XSS Filter)
- **bcrypt**: Hashing de senhas
- **Rate Limiting**: express-rate-limit em webhook-gateway
- **Container Filtering**: docker-control-api (authorized containers)

---

## 🚀 Getting Started

### Obter Status
```bash
cd /Users/gabriel.vieira/Documents/github/umbrel-store-custom
ls -la gabriel-store-*/
```

### Iniciar um app
```bash
cd gabriel-store-webhook-gateway
docker-compose up -d
# Acesso: http://localhost:5124
```

### Ver logs
```bash
cd gabriel-store-<app>/
docker-compose logs -f
```

---

## 📦 Estrutura Default por App

```
gabriel-store-{nome}/
├── umbrel-app.yml          # Metadados Umbrel
├── docker-compose.yml      # Orquestração
├── code/                   # (opcional) código-fonte
│   ├── src/
│   ├── package.json
│   ├── Dockerfile
│   └── tsconfig.json
├── icon.svg                # Ícone da loja
├── README.md               # (alguns apps)
└── config/ ou shared/      # Volumes persistentes
```

---

## 🎯 Casos de Uso Recomendados

### 1️⃣ Automação Completa
```
Evento → telegram-webhook-api → webhook-gateway → docker-control-api
              ↓                 ↓                    ↓
         Bot Telegram    Routing YAML         Executa ação
```

### 2️⃣ Processamento Multimídia
```
Upload → ffmpeg (encoding) → html-to-image-api (preview) → webhook-gateway
```

### 3️⃣ Análise e IA
```
Documento/Áudio → docling + whisper → LLM (open-claw) → kokoro (TTS)
```

### 4️⃣ Content Creation Studio
```
Ardour (áudio) + Kdenlive (vídeo) + FreeCAD (3D) → ffmpeg (export)
```

---

## 🔐 Segurança & Configuração

| App | Autenticação | Volume Importante | Notas |
|-----|--------------|-------------------|-------|
| webhook-gateway | bcrypt hash | webhooks.yml | Customizar senha |
| docker-control-api | user/pass | docker.sock | Usar AUTHORIZED_CONTAINERS |
| telegram-webhook-api | Token | TELEGRAM_BOT_TOKEN | Requer ngrok |
| ffmpeg | - | docker.sock | MAX_CONCURRENT_JOBS |
| kokoro | - | - | 4GB, Chromium only |
| pcsx2/retroarch | - | BIOS/ROMs | USER BIOS/ISOs |

---

## 📊 Versões Mais Atualizadas

1. **webhook-gateway**: v1.0.19 (19 iterações) ⭐⭐⭐
2. **telegram-webhook-api**: v1.0.14 (14 iterações) ⭐⭐
3. **ffmpeg**: v1.0.9 (9 iterações) ⭐
4. **kokoro**: v0.2.4 (upstream) ⭐

---

## 🔗 Links Importantes

- **Repositório**: https://github.com/Gabrielsv01/umbrel-store-custom
- **Desenvolvedor**: Gabriel Vieira (@gabrielvieira)
- **Issues/Support**: https://github.com/Gabrielsv01/umbrel-store-custom/issues
- **Licença**: MIT (2025)

---

**Relatório Gerado**: 19/03/2026  
**Análise Realizada**: Estrutura Completa || 24 Apps || 6 APIs Custom || 2 AI Gateways
