# FFmpeg API Documentation

Uma API REST completa para processamento de vídeo e áudio usando FFmpeg em containers Docker.

## 📋 Visão Geral

Esta API fornece uma interface HTTP para executar comandos FFmpeg, gerenciar arquivos de entrada e saída, e monitorar jobs de processamento. É ideal para automação de processamento de mídia em ambientes containerizados.

### 🌟 Características Principais

- **API REST Completa**: Endpoints para todas as operações FFmpeg
- **Sistema de Jobs**: Processamento assíncrono com heartbeat monitoring
- **Upload Flexível**: Suporte a base64 e multipart/form-data até 500MB
- **Gerenciamento de Arquivos**: Upload, download, listagem e informações de mídia
- **Validação de Segurança**: Path traversal protection e validação de arquivos
- **Documentação Automática**: README servido como HTML na rota raiz

## 🚀 Início Rápido

### Pré-requisitos

- Docker e Docker Compose
- Node.js 18+ (para desenvolvimento)

### Instalação

```bash
git clone <repository>
cd gabriel-store-ffmpeg
docker-compose up -d
```

A API estará disponível em `http://localhost:5135`

## 📖 Endpoints da API

### 🔍 Status e Monitoramento

#### `GET /status`
Verifica o status dos diretórios compartilhados e containers.

**Parâmetros:**
- Nenhum parâmetro necessário

**Exemplo:**
```bash
curl http://localhost:5135/status
```

**Resposta de Sucesso:**
```json
{
  "status": "ok",
  "directories": "total 8\ndrwxr-xr-x 2 abc abc 4096 Jan 15 10:30 input\ndrwxr-xr-x 2 abc abc 4096 Jan 15 10:30 output"
}
```

**Resposta de Erro (container FFmpeg não encontrado):**
```json
{
  "status": "error",
  "error": "Error: No such container: ffmpeg"
}
```

**Resposta de Erro (diretórios não acessíveis):**
```json
{
  "status": "error", 
  "error": "docker: Error response from daemon: container ffmpeg is not running"
}
```

#### `POST /init`
Cria os diretórios necessários se não existirem.

**Parâmetros:**
- Nenhum parâmetro necessário

**Exemplo:**
```bash
curl -X POST http://localhost:5135/init
```

**Resposta de Sucesso:**
```json
{
  "success": true,
  "message": "Diretórios criados/verificados"
}
```

**Resposta de Erro (container não acessível):**
```json
{
  "error": "Error: No such container: ffmpeg"
}
```

**Resposta de Erro (permissão negada):**
```json
{
  "error": "docker: Error response from daemon: container ffmpeg is not running"
}
```

### 📁 Gerenciamento de Arquivos

#### `GET /files/:type`
Lista arquivos em um diretório específico.

**Parâmetros:**
- `type`: `input` ou `output`

**Exemplo:**
```bash
curl http://localhost:5135/files/input
```

**Resposta de Sucesso:**
```json
{
  "type": "input",
  "count": 2,
  "files": [
    {
      "name": "1642254000000-video.mp4",
      "size": 15728640,
      "sizeFormatted": "15.00 MB",
      "date": "Jan 15 10:30",
      "permissions": "-rw-r--r--",
      "isMedia": true,
      "downloadUrl": null,
      "directUrl": null
    },
    {
      "name": "1642254000001-audio.mp3",
      "size": 5242880,
      "sizeFormatted": "5.00 MB",
      "date": "Jan 15 10:32",
      "permissions": "-rw-r--r--",
      "isMedia": true,
      "downloadUrl": null,
      "directUrl": null
    }
  ]
}
```

**Resposta (diretório vazio):**
```json
{
  "type": "input",
  "count": 0,
  "files": []
}
```

**Resposta de Erro:**
```json
{
  "error": "Tipo de diretório inválido. Use 'input' ou 'output'"
}
```

#### `GET /info/:type/:filename`
Obtém informações detalhadas de um arquivo de mídia usando ffprobe.

**Parâmetros:**
- `type`: `input` ou `output`
- `filename`: nome do arquivo

**Exemplo:**
```bash
curl http://localhost:5135/info/input/video.mp4
```

**Resposta de Sucesso:**
```json
{
  "filename": "1642254000000-video.mp4",
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

**Resposta de Erro (arquivo não encontrado):**
```json
{
  "error": "Arquivo não encontrado",
  "filename": "inexistente.mp4",
  "type": "input"
}
```

**Resposta de Erro (não é arquivo de mídia):**
```json
{
  "error": "Não foi possível obter informações do arquivo. Certifique-se de que é um arquivo de mídia válido",
  "filename": "documento.txt",
  "type": "input"
}
```

### 📤 Upload de Arquivos

#### `POST /upload`
Upload via multipart/form-data (recomendado para arquivos grandes).

**Parâmetros:**
- **Form Data**: `file` - arquivo a ser enviado (obrigatório)
- **Headers**: `Content-Type: multipart/form-data` (automático)

**Exemplo:**
```bash
curl -X POST http://localhost:5135/upload \
  -F "file=@video.mp4"
```

**Resposta de Sucesso:**
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

**Resposta de Erro (nenhum arquivo):**
```json
{
  "error": "Nenhum arquivo enviado"
}
```

**Resposta de Erro (erro do sistema):**
```json
{
  "error": "Erro ao fazer upload do arquivo",
  "details": "ENOSPC: no space left on device, write '/shared/input/temp'"
}
```

#### `POST /upload-json`
Upload via base64 (até 500MB).

**Parâmetros:**
- **Body JSON**: 
  - `data` (string, obrigatório): arquivo codificado em base64
  - `filename` (string, obrigatório): nome do arquivo com extensão

**Headers necessários:**
- `Content-Type: application/json`

**Exemplo:**
```bash
curl -X POST http://localhost:5135/upload-json \
  -H "Content-Type: application/json" \
  -d '{
    "data": "data:video/mp4;base64,AAAAHGZ0eXBpc29...",
    "filename": "video.mp4"
  }'
```

**Resposta de Sucesso:**
```json
{
  "success": true,
  "message": "Arquivo enviado com sucesso",
  "file": {
    "originalName": "video.mp4",
    "savedName": "1642254000000-video.mp4",
    "size": 15728640,
    "sizeFormatted": "15.00 MB",
    "path": "/shared/input/1642254000000-video.mp4"
  }
}
```

**Resposta de Erro (dados faltando):**
```json
{
  "error": "Dados ou nome do arquivo não fornecidos"
}
```

**Resposta de Erro (base64 inválido):**
```json
{
  "error": "Erro ao processar dados base64",
  "details": "Invalid character in base64 string"
}
```

**Resposta de Erro (arquivo muito grande):**
```json
{
  "error": "Payload too large",
  "details": "Arquivo excede o limite de 500MB para upload JSON"
}
```{
  {
    "originalName": "video.mp4",
    "savedName": "1642254000000-video.mp4",
    "size": 15728640,
    "sizeFormatted": "15.00 MB",
    "path": "/shared/input/1642254000000-video.mp4",
    "mimetype": "video/mp4"
  }
}
```

### 🎬 Processamento FFmpeg

#### `POST /ffmpeg`
Executa comandos FFmpeg síncronos (timeout: 5 minutos).

**Parâmetros:**
- **Body JSON**: 
  - `command` (string, obrigatório): comando FFmpeg completo

**Headers necessários:**
- `Content-Type: application/json`

**Observações:**
- Parâmetro `-y` é adicionado automaticamente
- Timeout de 5 minutos (300 segundos)
- Processamento síncrono (bloqueia até conclusão)

**Exemplo:**
```bash
curl -X POST http://localhost:5135/ffmpeg \
  -H "Content-Type: application/json" \
  -d '{
    "command": "ffmpeg -i /shared/input/video.mp4 -c:v libx264 -crf 23 /shared/output/compressed.mp4"
  }'
```

**Resposta de Sucesso:**
```json
{
  "success": true,
  "stdout": "ffmpeg version 4.4.2-0ubuntu0.20.04.4 Copyright (c) 2000-2021 the FFmpeg developers\nbuilt with gcc 9 (Ubuntu 9.4.0-1ubuntu1~20.04.1)\n...\nframe= 3600 fps= 45 q=23.0 size=   15360kB time=00:02:00.00 bitrate=1024.0kbits/s speed=1.5x\nvideo:14080kB audio:1280kB subtitle:0kB other streams:0kB global headers:0kB muxing overhead: 0.000000%",
  "stderr": "",
  "outputFile": "compressed.mp4",
  "downloadUrl": "/download/compressed.mp4",
  "directUrl": "/files/compressed.mp4"
}
```

**Resposta de Erro (comando vazio):**
```json
{
  "success": false,
  "error": "Comando não fornecido"
}
```

**Resposta de Erro (arquivo não encontrado):**
```json
{
  "success": false,
  "stdout": "",
  "stderr": "/shared/input/inexistente.mp4: No such file or directory",
  "error": "Erro na execução do FFmpeg"
}
```

**Resposta de Erro (timeout):**
```json
{
  "success": false,
  "error": "Comando cancelado por timeout (5 minutos)"
}
```

#### `POST /ffmpeg-async`
Executa comandos FFmpeg assíncronos com sistema de jobs avançado.

**Parâmetros:**
- **Body JSON**: 
  - `command` (string, obrigatório): comando FFmpeg completo

**Headers necessários:**
- `Content-Type: application/json`

**Observações:**
- Parâmetro `-y` é adicionado automaticamente
- Sem timeout (monitored via heartbeat)
- Processamento assíncrono (retorna job ID imediatamente)
- Job é monitorado via heartbeat system

**Exemplo:**
```bash
curl -X POST http://localhost:5135/ffmpeg-async \
  -H "Content-Type: application/json" \
  -d '{
    "command": "ffmpeg -i /shared/input/video.mp4 -c:v libx264 -crf 23 /shared/output/compressed.mp4"
  }'
```

**Resposta de Sucesso:**
```json
{
  "success": true,
  "jobId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "message": "Job iniciado",
  "statusUrl": "/job/f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "status": "pending"
}
```

**Resposta de Erro (comando vazio):**
```json
{
  "success": false,
  "error": "Comando não fornecido"
}
```

**Resposta de Erro (sistema ocupado):**
```json
{
  "success": false,
  "error": "Sistema temporariamente indisponível. Tente novamente em alguns segundos."
}
```

### 👷 Sistema Avançado de Jobs

#### `GET /jobs`
Lista todos os jobs com estatísticas detalhadas.

**Parâmetros:**
- Nenhum parâmetro necessário

**Exemplo:**
```bash
curl http://localhost:5135/jobs
```

**Resposta (com múltiplos jobs):**
```json
{
  "jobs": [
    {
      "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      "status": "running",
      "command": "ffmpeg -i /shared/input/1642254000000-video.mp4 -c:v libx264 -crf 23 /shared/output/compressed.mp4",
      "startTime": "2024-01-15T10:30:00.000Z",
      "endTime": null,
      "outputFile": null,
      "duration": null
    },
    {
      "id": "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
      "status": "completed",
      "command": "ffmpeg -i /shared/input/1642254000001-audio.mp3 -c:a aac /shared/output/converted.aac",
      "startTime": "2024-01-15T10:25:00.000Z",
      "endTime": "2024-01-15T10:26:30.000Z",
      "outputFile": "converted.aac",
      "duration": 90000
    },
    {
      "id": "6ba7b811-9dad-11d1-80b4-00c04fd430c8",
      "status": "failed",
      "command": "ffmpeg -i /shared/input/inexistente.mp4 -c:v copy /shared/output/fail.mp4",
      "startTime": "2024-01-15T10:20:00.000Z",
      "endTime": "2024-01-15T10:20:05.000Z",
      "outputFile": null,
      "duration": 5000
    }
  ],
  "total": 3,
  "running": 1,
  "completed": 1,
  "failed": 1
}
```

**Resposta (sem jobs):**
```json
{
  "jobs": [],
  "total": 0,
  "running": 0,
  "completed": 0,
  "failed": 0
}
```

#### `GET /job/:jobId`
Obtém status detalhado de um job específico com informações de heartbeat.

**Parâmetros:**
- `jobId` (path, obrigatório): ID único do job

**Exemplo:**
```bash
curl http://localhost:5135/job/f47ac10b-58cc-4372-a567-0e02b2c3d479
```

**Resposta (Job em execução):**
```json
{
  "success": true,
  "job": {
    "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "status": "running",
    "command": "ffmpeg -i /shared/input/1642254000000-video.mp4 -c:v libx264 -crf 23 /shared/output/compressed.mp4",
    "startTime": "2024-01-15T10:30:00.000Z",
    "lastHeartbeat": "2024-01-15T10:32:15.000Z",
    "progress": null,
    "stdout": "frame= 1800 fps= 30 q=23.0 size=   7680kB time=00:01:00.00 bitrate=1024.0kbits/s speed=1.0x",
    "stderr": "",
    "outputFile": null,
    "error": null
  }
}
```

**Resposta (Job concluído):**
```json
{
  "success": true,
  "job": {
    "id": "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
    "status": "completed",
    "command": "ffmpeg -i /shared/input/1642254000001-audio.mp3 -c:a aac /shared/output/converted.aac",
    "startTime": "2024-01-15T10:25:00.000Z",
    "endTime": "2024-01-15T10:26:30.000Z",
    "lastHeartbeat": "2024-01-15T10:26:30.000Z",
    "progress": null,
    "stdout": "frame=    0 fps=0.0 q=-1.0 size=    5120kB time=00:03:20.00 bitrate= 128.0kbits/s speed=15.2x",
    "stderr": "",
    "outputFile": "converted.aac",
    "error": null
  }
}
```

**Resposta (Job com falha):**
```json
{
  "success": true,
  "job": {
    "id": "6ba7b811-9dad-11d1-80b4-00c04fd430c8",
    "status": "failed",
    "command": "ffmpeg -i /shared/input/inexistente.mp4 -c:v copy /shared/output/fail.mp4",
    "startTime": "2024-01-15T10:20:00.000Z",
    "endTime": "2024-01-15T10:20:05.000Z",
    "lastHeartbeat": "2024-01-15T10:20:05.000Z",
    "progress": null,
    "stdout": "",
    "stderr": "/shared/input/inexistente.mp4: No such file or directory",
    "outputFile": null,
    "error": "FFmpeg process exited with code 1"
  }
}
```

**Resposta de Erro (Job não encontrado):**
```json
{
  "success": false,
  "error": "Job não encontrado"
}
```

#### `DELETE /job/:jobId`
Cancela/remove um job (marca como falhou se estiver rodando).

**Parâmetros:**
- `jobId` (path, obrigatório): ID único do job

**Exemplo:**
```bash
curl -X DELETE http://localhost:5135/job/abc123
```

**Resposta de Sucesso:**
```json
{
  "success": true,
  "message": "Job abc123 removido"
}
```

**Resposta de Erro:**
```json
{
  "success": false,
  "error": "Job não encontrado"
}
```

### 🗑️ Gerenciamento de Arquivos

#### `DELETE /files/:type/:filename`
Remove arquivo específico com validação de segurança.

**Parâmetros:**
- `type` (path, obrigatório): `input` ou `output`
- `filename` (path, obrigatório): nome do arquivo a ser removido

**Exemplo:**
```bash
curl -X DELETE http://localhost:5135/files/input/video.mp4
```

**Resposta de Sucesso:**
```json
{
  "success": true,
  "message": "Arquivo video.mp4 deletado com sucesso"
}
```

**Resposta de Erro:**
```json
{
  "success": false,
  "error": "Arquivo não encontrado"
}
```

#### `DELETE /files/:type`
Remove múltiplos arquivos com relatório detalhado.

**Parâmetros:**
- `type` (path, obrigatório): `input` ou `output`
- **Body JSON**:
  - `files` (array, obrigatório): lista de nomes de arquivos

**Headers necessários:**
- `Content-Type: application/json`

**Exemplo:**
```bash
curl -X DELETE http://localhost:5135/files/input \
  -H "Content-Type: application/json" \
  -d '{"files": ["video1.mp4", "video2.mp4"]}'
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
Limpa diretório completamente (requer confirmação).

**Parâmetros:**
- `type` (path, obrigatório): `input` ou `output`
- `confirm` (query, obrigatório): deve ser `true` para confirmar ação

**Exemplo:**
```bash
curl -X DELETE "http://localhost:5135/clear/input?confirm=true"
```

**Resposta de Sucesso:**
```json
{
  "success": true,
  "message": "Diretório input limpo com sucesso",
  "deletedFiles": 3
}
```

**Resposta de Erro (sem confirmação):**
```json
{
  "success": false,
  "error": "Confirmação necessária. Use ?confirm=true"
}
```

### 📥 Download

#### `GET /download/:filename`
Download direto de arquivos processados com headers apropriados para download.

**Parâmetros:**
- `filename` (path, obrigatório): nome do arquivo no diretório `/shared/output/`

**Observações:**
- Arquivo deve existir no diretório output
- Valida contra path traversal attacks
- Define Content-Disposition para forçar download

**Exemplo:**
```bash
curl -O http://localhost:5135/download/compressed.mp4
```

**Headers de Resposta:**
```
Content-Type: video/mp4
Content-Disposition: attachment; filename="compressed.mp4"
Content-Length: 15728640
```

**Resposta de Erro (404):**
```json
{
  "error": "Arquivo não encontrado",
  "filename": "inexistente.mp4"
}
```

#### `GET /files/:filename`
Acesso direto a arquivos para visualização/streaming (servidos estaticamente).

**Parâmetros:**
- `filename` (path, obrigatório): nome do arquivo no diretório `/shared/output/`

**Observações:**
- Servido via express.static
- Suporte a range requests (streaming)
- Sem Content-Disposition (navegador decide)

**Exemplo:**
```bash
curl http://localhost:5135/files/compressed.mp4
```

**Diferenças do /download:**
- **Sem Content-Disposition**: Navegador decide se baixa ou visualiza
- **Streaming Friendly**: Suporte a range requests para vídeo
- **Cache Headers**: Headers de cache otimizados

### 📚 Documentação

#### `GET /`
Serve esta documentação como HTML estilizado.

**Parâmetros:**
- Nenhum parâmetro necessário

**Exemplo:**
```bash
curl http://localhost:5135/
```

#### `GET /ui`
Interface web moderna para gerenciamento visual.

**Parâmetros:**
- Nenhum parâmetro necessário

**Exemplo:**
```bash
curl http://localhost:5135/ui
```

## 🎵 Casos de Uso Comuns

### 1. Juntar Áudio e Vídeo

```bash
# Substituir áudio completamente
curl -X POST http://localhost:5135/ffmpeg \
  -H "Content-Type: application/json" \
  -d '{
    "command": "ffmpeg -i /shared/input/video.mp4 -i /shared/input/audio.mp3 -c:v copy -c:a aac -map 0:v:0 -map 1:a:0 /shared/output/resultado.mp4"
  }'

# Misturar áudios (original + novo)
curl -X POST http://localhost:5135/ffmpeg-async \
  -H "Content-Type: application/json" \
  -d '{
    "command": "ffmpeg -i /shared/input/video.mp4 -i /shared/input/audio.mp3 -filter_complex \"[0:a][1:a]amix=inputs=2:duration=first\" -c:v copy -c:a aac /shared/output/mixado.mp4"
  }'
```

### 2. Conversão de Formatos

```bash
# MP4 para WebM
curl -X POST http://localhost:5135/ffmpeg-async \
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

### 3. Redimensionamento e Compressão

```bash
# Converter para 720p
curl -X POST http://localhost:5135/ffmpeg \
  -H "Content-Type: application/json" \
  -d '{
    "command": "ffmpeg -i /shared/input/video.mp4 -vf scale=1280:720 -c:v libx264 -crf 23 /shared/output/720p.mp4"
  }'

# Criar thumbnail
curl -X POST http://localhost:5135/ffmpeg \
  -H "Content-Type: application/json" \
  -d '{
    "command": "ffmpeg -i /shared/input/video.mp4 -ss 00:00:10 -frames:v 1 /shared/output/thumbnail.jpg"
  }'
```

## 🔧 Workflow Completo

```bash
# 1. Upload de arquivos
curl -X POST http://localhost:5135/upload -F "file=@video.mp4"
curl -X POST http://localhost:5135/upload -F "file=@audio.mp3"

# 2. Verificar arquivos
curl http://localhost:5135/files/input

# 3. Obter informações do vídeo
curl http://localhost:5135/info/input/1642254000000-video.mp4

# 4. Processar (assíncrono)
RESPONSE=$(curl -X POST http://localhost:5135/ffmpeg-async \
  -H "Content-Type: application/json" \
  -d '{
    "command": "ffmpeg -i /shared/input/1642254000000-video.mp4 -i /shared/input/1642254000001-audio.mp3 -c:v copy -c:a aac -map 0:v:0 -map 1:a:0 /shared/output/resultado.mp4"
  }')

# 5. Extrair jobId da resposta
JOB_ID=$(echo $RESPONSE | jq -r '.jobId')

# 6. Monitorar progresso
curl http://localhost:5135/job/$JOB_ID

# 7. Listar jobs
curl http://localhost:5135/jobs

# 8. Download do resultado
curl -O http://localhost:5135/download/resultado.mp4
```

## 🏗️ Arquitetura

### Estrutura de Containers

- **`ffmpeg`**: Container LinuxServer FFmpeg para processamento
- **`ffmpeg-api`**: API Node.js/TypeScript que controla o FFmpeg

### Sistema de Jobs com Heartbeat

O sistema de jobs assíncronos inclui:

- **Heartbeat Monitoring**: Verifica processos a cada 30s
- **Orphan Job Detection**: Detecta jobs órfãos e marca como falhou
- **Auto Cleanup**: Remove jobs antigos automaticamente (24h)
- **Process Validation**: Confirma que processos FFmpeg estão realmente rodando

```typescript
// Configurações do sistema
const HEARTBEAT_CONFIG = {
    interval: 30000,        // 30 segundos
    maxSilentTime: 120000   // 2 minutos
};

const JOB_CLEANUP_CONFIG = {
    maxAge: 24 * 60 * 60 * 1000,    // 24 horas
    maxJobs: 100,                    // Máximo de jobs
    cleanupInterval: 60 * 60 * 1000, // Limpeza a cada 1h
    syncInterval: 5 * 60 * 1000      // Sync a cada 5min
};
```

## 🔐 Segurança e Validação

### Validações Implementadas

1. **Path Traversal Protection**: Validação de nomes de arquivo
2. **Directory Type Validation**: Apenas 'input' e 'output' permitidos
3. **Command Timeout**: 5 minutos máximo para comandos síncronos
4. **File Size Limits**: 500MB para uploads JSON
5. **Process Isolation**: Execução em containers separados

## ⚙️ Configurações

### Variáveis de Ambiente

```bash
PORT=3001                    # Porta da API (padrão: 3001)
```

### Limites e Timeouts

- **Upload JSON**: 500MB máximo
- **Upload Multipart**: Sem limite específico
- **Command Timeout**: 5 minutos (300 segundos)
- **Job Heartbeat**: 30 segundos de intervalo
- **Job Max Silent**: 2 minutos sem atividade

### Health Check

```bash
# Verificar saúde da API
curl http://localhost:5135/status

# Verificar se containers estão rodando
docker ps | grep ffmpeg
```

## ⚠️ Notas Importantes

1. **Ambiente Controlado**: Use apenas em ambientes seguros
2. **Caminhos Absolutos**: Sempre use `/shared/input/` e `/shared/output/`
3. **Parâmetro -y**: Adicionado automaticamente aos comandos `ffmpeg`
4. **Formatos Suportados**: Todos os formatos do FFmpeg (MP4, AVI, MOV, MKV, WebM, MP3, WAV, AAC, FLAC, etc.)
5. **Docker Socket**: API precisa de acesso ao socket Docker
6. **Monitoring**: Jobs são monitorados via heartbeat para detectar falhas

## 🛠️ Desenvolvimento

### Setup Local

```bash
cd code
npm install
npm run dev
```

### Build

```bash
npm run build
```

### Scripts Disponíveis

```json
{
  "build": "tsc",
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

`ffmpeg` `api` `typescript` `docker` `video` `audio` `conversion` `multimedia` `rest-api` `node.js` `jobs` `heartbeat` `async` `media-processing` `file-management`

---

<div align="center">

**[📖 Documentação](http://localhost:5135)** • 
**[📊 Status](http://localhost:5135/status)** • 
**[📁 Arquivos Input](http://localhost:5135/files/input)** • 
**[📁 Arquivos Output](http://localhost:5135/files/output)** • 
**[👷 Jobs](http://localhost:5135/jobs)**

*Desenvolvido com ❤️ usando TypeScript, Express e Docker*

</div>