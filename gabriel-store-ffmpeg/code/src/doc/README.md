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

### 📤 Upload de Arquivos

#### `POST /upload-json`
Faz upload de arquivos usando base64.

**Body:**
```json
{
  "data": "base64_encoded_file_data",
  "filename": "video.mp4"
}
```

**Resposta:**
```json
{
  "success": true,
  "message": "Arquivo enviado com sucesso",
  "file": {
    "savedName": "1642254000000-video.mp4",
    "size": 15728640,
    "path": "/shared/input/1642254000000-video.mp4"
  }
}
```

#### `POST /upload`
Faz upload de arquivos usando multipart/form-data.

**Form Data:**
- `file`: arquivo a ser enviado

**Exemplo usando curl:**
```bash
curl -X POST http://localhost:5135/upload \
  -F "file=@video.mp4"
```

**Resposta:**
```json
{
  "success": true,
  "message": "Arquivo enviado com sucesso",
  "file": {
    "originalName": "video.mp4",
    "savedName": "1642254000000-video.mp4",
    "size": 15728640,
    "sizeFormatted": "15.00 MB",
    "path": "/shared/input/1642254000000-video.mp4",
    "mimetype": "video/mp4"
  }
}
```

### 🗑️ Deletar Arquivos

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

#### `DELETE /files/:type`
Deleta múltiplos arquivos.

**Body:**
```json
{
  "files": ["video1.mp4", "video2.mp4"]
}
```

**Resposta:**
```json
{
  "success": true,
  "message": "2 arquivo(s) deletado(s), 0 falha(s)",
  "type": "input",
  "results": [
    {
      "filename": "video1.mp4",
      "success": true,
      "message": "Deletado com sucesso"
    },
    {
      "filename": "video2.mp4",
      "success": true,
      "message": "Deletado com sucesso"
    }
  ],
  "summary": {
    "total": 2,
    "deleted": 2,
    "failed": 0
  }
}
```

#### `DELETE /clear/:type?confirm=true`
Limpa todos os arquivos de um diretório.

**Parâmetros:**
- `type`: `input` ou `output`
- Query parameter: `confirm=true` (obrigatório)

**Exemplo:**
```bash
DELETE /clear/input?confirm=true
```

**Resposta:**
```json
{
  "success": true,
  "message": "Todos os arquivos do diretório input foram removidos",
  "type": "input"
}
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

### Upload de arquivo via base64

```bash
# Converter arquivo para base64 e fazer upload
base64_data=$(base64 -i video.mp4)
curl -X POST http://localhost:5135/upload-json \
  -H "Content-Type: application/json" \
  -d "{
    \"data\": \"$base64_data\",
    \"filename\": \"video.mp4\"
  }"
```

### Upload de arquivo via multipart

```bash
# Upload usando form-data (recomendado para arquivos grandes)
curl -X POST http://localhost:5135/upload \
  -F "file=@video.mp4"

curl -X POST http://localhost:5135/upload \
  -F "file=@audio.mp3"
```

### 🎵 Juntar Áudio e Vídeo

#### 1. Substituir o áudio do vídeo completamente

```bash
curl -X POST http://localhost:5135/ffmpeg \
  -H "Content-Type: application/json" \
  -d '{
    "command": "ffmpeg -i /shared/input/video.mp4 -i /shared/input/audio.mp3 -c:v copy -c:a aac -map 0:v:0 -map 1:a:0 /shared/output/video_com_audio.mp4"
  }'
```

#### 2. Misturar áudio existente com novo áudio

```bash
curl -X POST http://localhost:5135/ffmpeg \
  -H "Content-Type: application/json" \
  -d '{
    "command": "ffmpeg -i /shared/input/video.mp4 -i /shared/input/audio.mp3 -filter_complex \"[0:a][1:a]amix=inputs=2:duration=first:dropout_transition=3\" -c:v copy -c:a aac /shared/output/video_audio_mixado.mp4"
  }'
```

#### 3. Adicionar áudio a vídeo sem áudio

```bash
curl -X POST http://localhost:5135/ffmpeg \
  -H "Content-Type: application/json" \
  -d '{
    "command": "ffmpeg -i /shared/input/video.mp4 -i /shared/input/audio.mp3 -c:v copy -c:a aac -shortest /shared/output/video_com_audio.mp4"
  }'
```

#### 4. Controlar volumes durante a mistura

```bash
curl -X POST http://localhost:5135/ffmpeg \
  -H "Content-Type: application/json" \
  -d '{
    "command": "ffmpeg -i /shared/input/video.mp4 -i /shared/input/audio.mp3 -filter_complex \"[0:a]volume=0.5[a0];[1:a]volume=0.8[a1];[a0][a1]amix=inputs=2:duration=first\" -c:v copy -c:a aac /shared/output/video_volumes_ajustados.mp4"
  }'
```

#### 5. Sincronizar áudio com delay

```bash
curl -X POST http://localhost:5135/ffmpeg \
  -H "Content-Type: application/json" \
  -d '{
    "command": "ffmpeg -i /shared/input/video.mp4 -i /shared/input/audio.mp3 -filter_complex \"[1:a]adelay=2000|2000[delayed];[0:a][delayed]amix=inputs=2:duration=first\" -c:v copy -c:a aac /shared/output/video_audio_delayed.mp4"
  }'
```

#### Parâmetros importantes para áudio/vídeo:

- **`-c:v copy`**: Copia o vídeo sem recodificar (mais rápido)
- **`-c:a aac`**: Codifica o áudio em AAC
- **`-map 0:v:0 -map 1:a:0`**: Mapeia vídeo do primeiro arquivo e áudio do segundo
- **`-shortest`**: Termina quando o arquivo mais curto acabar
- **`amix`**: Filtro para misturar múltiplos áudios
- **`volume=0.5`**: Ajusta volume (0.5 = 50%)
- **`adelay=2000`**: Adiciona delay de 2 segundos (em milissegundos)

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

### Workflow completo: Upload → Processar → Download

```bash
# 1. Fazer upload de vídeo e áudio
curl -X POST http://localhost:5135/upload -F "file=@video.mp4"
curl -X POST http://localhost:5135/upload -F "file=@audio.mp3"

# 2. Verificar arquivos
curl http://localhost:5135/files/input

# 3. Juntar áudio e vídeo
curl -X POST http://localhost:5135/ffmpeg \
  -H "Content-Type: application/json" \
  -d '{
    "command": "ffmpeg -i /shared/input/1642254000000-video.mp4 -i /shared/input/1642254000001-audio.mp3 -c:v copy -c:a aac -map 0:v:0 -map 1:a:0 /shared/output/resultado.mp4"
  }'

# 4. Verificar resultado
curl http://localhost:5135/files/output

# 5. Baixar arquivo final
curl -O http://localhost:5135/download/resultado.mp4
```

### Obter informações de um arquivo

```bash
# Listar arquivos de entrada
curl http://localhost:5135/files/input

# Obter informações detalhadas de um arquivo
curl http://localhost:5135/info/input/video.mp4

# Deletar arquivo específico
curl -X DELETE http://localhost:5135/files/input/video.mp4

# Deletar múltiplos arquivos
curl -X DELETE http://localhost:5135/files/input \
  -H "Content-Type: application/json" \
  -d '{
    "files": ["video1.mp4", "video2.mp4"]
  }'

# Limpar diretório completamente
curl -X DELETE "http://localhost:5135/clear/input?confirm=true"
```

## 🐳 Containers

### `ffmpeg`
- **Imagem:** `linuxserver/ffmpeg:arm64v8-latest`
- **Função:** Container com FFmpeg instalado
- **Status:** Fica rodando um loop infinito para aceitar comandos `docker exec`
- **Volumes:** Configuração e diretórios compartilhados

### `ffmpeg-api`
- **Build:** `./code` (TypeScript/Node.js)
- **Função:** API REST que controla o container FFmpeg
- **Porta:** 5135:3001
- **Volumes:** Docker socket + diretórios compartilhados
- **Dependências:** Container `ffmpeg`

## ⚠️ Notas Importantes

1. **Segurança:** A API executa comandos Docker diretamente. Use apenas em ambientes controlados.

2. **Caminhos:** Sempre use caminhos absolutos:
   - Input: `/shared/input/arquivo.mp4`
   - Output: `/shared/output/arquivo.mp4`

3. **Timeout:** Comandos FFmpeg têm timeout de 5 minutos (300 segundos).

4. **Sobrescrever:** O parâmetro `-y` é adicionado automaticamente aos comandos `ffmpeg`.

5. **Formatos suportados:** Todos os formatos suportados pelo FFmpeg (MP4, AVI, MOV, MKV, WebM, MP3, WAV, AAC, FLAC, etc.).

6. **Upload:** Arquivos podem ser enviados via base64 usando `/upload-json` ou via multipart usando `/upload`.

7. **Validação:** Nomes de arquivos são validados para prevenir path traversal attacks.

8. **Limites:** Upload JSON suporta até 500MB. Para arquivos maiores, use o endpoint `/upload`.

## 🛠️ Utilitários Disponíveis

A API inclui várias funções utilitárias implementadas em [`utils.ts`](code/src/utils.ts):

- **`formatFileSize(bytes)`**: Formata tamanho de arquivo em formato legível
- **`formatDuration(seconds)`**: Formata duração em formato MM:SS ou HH:MM:SS
- **`isValidDirectoryType(type)`**: Valida se o tipo é 'input' ou 'output'

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

### Estrutura de scripts

```json
{
  "build": "tsc && npm run copy-static",
  "copy-static": "mkdir -p dist/doc && cp src/doc/README.md dist/doc/",
  "start": "node dist/app.js",
  "dev": "nodemon src/app.ts",
  "clean": "rm -rf dist"
}
```

## 🤝 Contribuindo

1. Fork o projeto
2. Crie uma branch para sua feature
3. Commit suas mudanças
4. Push para a branch
5. Abra um Pull Request

## 🏷️ Tags

`ffmpeg` `api` `typescript` `docker` `video` `audio` `conversion` `multimedia` `rest-api` `node.js` `audio-video-merge`