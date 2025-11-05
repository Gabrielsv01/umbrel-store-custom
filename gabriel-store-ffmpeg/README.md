# FFmpeg API Documentation

Uma API REST completa para processamento de vídeo e áudio usando FFmpeg em containers Docker.

## 📋 Visão Geral

Esta API fornece uma interface HTTP para executar comandos FFmpeg, gerenciar arquivos de entrada e saída, e monitorar o status do sistema. É ideal para automação de processamento de mídia em ambientes containerizados.

## 🚀 Início Rápido

### Pré-requisitos

- Docker e Docker Compose
- Node.js 18+ (para desenvolvimento)

### Instalação

1. Clone o repositório
2. Execute com Docker Compose:

```bash
docker-compose up -d
```

A API estará disponível em `http://localhost:5135`

## 📖 Endpoints da API

### 🔍 Status e Monitoramento

#### `GET /status`
Verifica o status dos diretórios compartilhados.

**Resposta:**
```json
{
  "status": "ok",
  "directories": "drwxr-xr-x 2 abc abc 4096 Jan 15 10:30 input\ndrwxr-xr-x 2 abc abc 4096 Jan 15 10:30 output"
}
```

#### `POST /init`
Cria os diretórios necessários se não existirem.

**Resposta:**
```json
{
  "success": true,
  "message": "Diretórios criados/verificados"
}
```

### 📁 Gerenciamento de Arquivos

#### `GET /files/:type`
Lista arquivos em um diretório específico.

**Parâmetros:**
- `type`: `input` ou `output`

**Exemplo:**
```bash
GET /files/input
```

**Resposta:**
```json
{
  "type": "input",
  "count": 2,
  "files": [
    {
      "name": "video.mp4",
      "size": 15728640,
      "sizeFormatted": "15.00 MB",
      "date": "Jan 15 10:30",
      "permissions": "-rw-r--r--",
      "isMedia": true,
      "downloadUrl": null,
      "directUrl": null
    }
  ]
}
```

#### `GET /info/:type/:filename`
Obtém informações detalhadas de um arquivo de mídia usando ffprobe.

**Parâmetros:**
- `type`: `input` ou `output`
- `filename`: nome do arquivo

**Exemplo:**
```bash
GET /info/input/video.mp4
```

**Resposta:**
```json
{
  "filename": "video.mp4",
  "type": "input",
  "format": {
    "formatName": "mov,mp4,m4a,3gp,3g2,mj2",
    "formatLongName": "QuickTime / MOV",
    "duration": 120.5,
    "durationFormatted": "2:00",
    "size": 15728640,
    "sizeFormatted": "15.00 MB",
    "bitRate": 1045000
  },
  "video": {
    "codec": "h264",
    "codecLongName": "H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10",
    "width": 1920,
    "height": 1080,
    "resolution": "1920x1080",
    "frameRate": 30,
    "bitRate": 1000000,
    "pixelFormat": "yuv420p"
  },
  "audio": {
    "codec": "aac",
    "codecLongName": "AAC (Advanced Audio Coding)",
    "sampleRate": 48000,
    "channels": 2,
    "bitRate": 128000
  },
  "downloadUrl": null,
  "directUrl": null
}
```

#### `DELETE /files/:type/:filename`
Deleta um arquivo específico.

**Parâmetros:**
- `type`: `input` ou `output`
- `filename`: nome do arquivo

**Exemplo:**
```bash
DELETE /files/input/video.mp4
```

**Resposta:**
```json
{
  "success": true,
  "message": "Arquivo video.mp4 deletado com sucesso",
  "filename": "video.mp4",
  "type": "input"
}
```

#### `DELETE /files/:type?confirm=true`
Deleta múltiplos arquivos ou limpa um diretório.

**Para múltiplos arquivos:**
```bash
DELETE /files/input
Content-Type: application/json

{
  "files": ["video1.mp4", "video2.mp4"]
}
```

**Para limpar diretório completamente:**
```bash
DELETE /clear/input?confirm=true
```

### 🎬 Processamento FFmpeg

#### `POST /ffmpeg`
Executa comandos FFmpeg no container.

**Body:**
```json
{
  "command": "ffmpeg -i /shared/input/video.mp4 -c:v libx264 -crf 23 /shared/output/compressed.mp4"
}
```

**Resposta:**
```json
{
  "success": true,
  "stdout": "ffmpeg version 4.4.2...",
  "stderr": "",
  "outputFile": "compressed.mp4",
  "downloadUrl": "/download/compressed.mp4",
  "directUrl": "/files/compressed.mp4"
}
```

### 📥 Download de Arquivos

#### `GET /download/:filename`
Baixa um arquivo específico do diretório de saída.

**Exemplo:**
```bash
GET /download/compressed.mp4
```

#### `GET /files/:filename`
Acesso direto a arquivos do diretório de saída (servidos estaticamente).

**Exemplo:**
```bash
GET /files/compressed.mp4
```

## 💡 Exemplos de Uso

### Converter vídeo para diferentes formatos

```bash
# MP4 para WebM
curl -X POST http://localhost:5135/ffmpeg \
  -H "Content-Type: application/json" \
  -d '{
    "command": "ffmpeg -i /shared/input/video.mp4 -c:v libvpx-vp9 -c:a libopus /shared/output/video.webm"
  }'

# Extrair áudio
curl -X POST http://localhost:5135/ffmpeg \
  -H "Content-Type: application/json" \
  -d '{
    "command": "ffmpeg -i /shared/input/video.mp4 -vn -c:a copy /shared/output/audio.aac"
  }'
```

### Redimensionar vídeo

```bash
curl -X POST http://localhost:5135/ffmpeg \
  -H "Content-Type: application/json" \
  -d '{
    "command": "ffmpeg -i /shared/input/video.mp4 -vf scale=1280:720 /shared/output/video_720p.mp4"
  }'
```

### Criar thumbnail

```bash
curl -X POST http://localhost:5135/ffmpeg \
  -H "Content-Type: application/json" \
  -d '{
    "command": "ffmpeg -i /shared/input/video.mp4 -ss 00:00:10 -frames:v 1 /shared/output/thumbnail.jpg"
  }'
```

### Combinar múltiplos vídeos

```bash
# Primeiro, criar um arquivo de lista
curl -X POST http://localhost:5135/ffmpeg \
  -H "Content-Type: application/json" \
  -d '{
    "command": "echo \"file '/shared/input/video1.mp4'\nfile '/shared/input/video2.mp4'\" > /shared/input/filelist.txt"
  }'

# Depois, concatenar
curl -X POST http://localhost:5135/ffmpeg \
  -H "Content-Type: application/json" \
  -d '{
    "command": "ffmpeg -f concat -safe 0 -i /shared/input/filelist.txt -c copy /shared/output/combined.mp4"
  }'
```

## 🔧 Estrutura do Projeto

```
gabriel-store-ffmpeg/
├── docker-compose.yml          # Configuração dos containers
├── code/                       # Código da API
│   ├── src/
│   │   ├── app.ts             # Aplicação principal
│   │   ├── types.ts           # Definições de tipos
│   │   ├── utils.ts           # Funções utilitárias
│   │   └── api/               # Endpoints da API
│   │       ├── status.ts
│   │       ├── filesType.ts
│   │       ├── command.ts
│   │       └── ...
│   ├── package.json
│   ├── tsconfig.json
│   └── Dockerfile
└── shared/                     # Diretórios compartilhados
    ├── input/                  # Arquivos de entrada
    └── output/                 # Arquivos processados
```

## 🐳 Containers

### `ffmpeg`
- **Imagem:** `linuxserver/ffmpeg:arm64v8-latest`
- **Função:** Container com FFmpeg instalado
- **Status:** Fica rodando um loop infinito para aceitar comandos `docker exec`

### `ffmpeg-api`
- **Imagem:** `gabrielsv01/ffmpeg-api:1.0.0`
- **Função:** API REST Node.js/TypeScript
- **Porta:** 5135:3001
- **Volumes:** Docker socket + diretórios compartilhados

## ⚠️ Notas Importantes

1. **Segurança:** A API executa comandos Docker diretamente. Use apenas em ambientes controlados.

2. **Caminhos:** Sempre use caminhos absolutos:
   - Input: `/shared/input/arquivo.mp4`
   - Output: `/shared/output/arquivo.mp4`

3. **Timeout:** Comandos FFmpeg têm timeout de 5 minutos (300 segundos).

4. **Sobrescrever:** O parâmetro `-y` é adicionado automaticamente aos comandos `ffmpeg`.

5. **Formatos suportados:** Todos os formatos suportados pelo FFmpeg (MP4, AVI, MOV, MKV, WebM, MP3, WAV, AAC, FLAC, etc.).

## 📝 Desenvolvimento

### Executar localmente

```bash
cd code
npm install
npm run dev
```

### Build da imagem Docker

```bash
cd code
docker build -t ffmpeg-api:latest .
```

## 🤝 Contribuindo

1. Fork o projeto
2. Crie uma branch para sua feature
3. Commit suas mudanças
4. Push para a branch
5. Abra um Pull Request
