# MCP Hub API Reference

Guia de referencia dos endpoints do MCP Hub.

- Base URL local: `http://localhost:5146/api`
- Content-Type esperado para endpoints de escrita: `application/json`

## Sumario

- MCPs: listar, deploy, update, acoes e logs
- Catalogo: templates prontos
- Stdio: sessao interativa, proxy SSE e health check
- Health HTTP/streamable-http
- Imagens: listar, pull e remover
- Volumes: listar e remover

## 1) MCPs

### GET /mcps

Lista os containers gerenciados pelo MCP Hub.

Exemplo:

```bash
curl -sS http://localhost:5146/api/mcps
```

Resposta tipica:

```json
[
  {
    "id": "790950da65f6",
    "name": "Context7",
    "image": "node:22-bookworm-slim",
    "status": "running",
    "ports": [],
    "meta": {
      "name": "Context7",
      "image": "node:22-bookworm-slim",
      "transport": "stdio"
    }
  }
]
```

### POST /deploy

Cria um MCP novo.

Campos minimos:

- `name`
- `image`

Campos comuns:

- `transport`: `http`, `stdio` ou `streamable-http`
- `command`
- `port`
- `env`
- `secretKeys`
- `runtime`

Exemplo stdio:

```bash
curl -sS -X POST http://localhost:5146/api/deploy \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "context7",
    "image": "node:22-bookworm-slim",
    "transport": "stdio",
    "command": "npx -y @upstash/context7-mcp@latest"
  }'
```

Resposta tipica:

```json
{
  "id": "790950da65f6",
  "status": "created"
}
```

### PUT /mcps/:id

Recria e atualiza um MCP existente.

Exemplo:

```bash
curl -sS -X PUT http://localhost:5146/api/mcps/790950da65f6 \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "context7",
    "image": "node:22-bookworm-slim",
    "transport": "stdio",
    "command": "npx -y @upstash/context7-mcp@latest"
  }'
```

### POST /action/:id

Executa acao no container.

Body:

- `{ "action": "start" }`
- `{ "action": "stop" }`
- `{ "action": "remove" }`

Exemplo:

```bash
curl -sS -X POST http://localhost:5146/api/action/790950da65f6 \
  -H 'Content-Type: application/json' \
  -d '{"action":"start"}'
```

### GET /logs/:id

Stream SSE de logs do container.

Exemplo:

```bash
curl -N http://localhost:5146/api/logs/790950da65f6
```

## 2) Catalogo

### GET /catalog

Lista templates prontos para deploy.

```bash
curl -sS http://localhost:5146/api/catalog
```

## 3) Stdio

### GET /stdio/session/:id (WebSocket)

Sessao interativa para MCP stdio.

- Cliente envia: `{ "type": "input", "data": "texto\\n" }`
- Servidor envia: `ready`, `output` e `error`

Uso principal: UI do MCP Hub.

### GET /stdio/proxy/:id/sse

Abre proxy SSE para clientes externos (VS Code, Claude Desktop etc.).

```bash
curl -N http://localhost:5146/api/stdio/proxy/790950da65f6/sse
```

A resposta SSE inclui evento `endpoint` com URL para enviar mensagens JSON-RPC.

### POST /stdio/proxy/:id/message?sessionId=<uuid>

Envia request JSON-RPC para uma sessao aberta no proxy SSE.

Exemplo (tools/list):

```bash
curl -sS -X POST \
  'http://localhost:5146/api/stdio/proxy/790950da65f6/message?sessionId=SEU_SESSION_ID' \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":10,"method":"tools/list","params":{}}'
```

### GET /stdio/health/:id

Health check de MCP stdio (initialize + tools/list).

```bash
curl -sS http://localhost:5146/api/stdio/health/790950da65f6
```

Status possiveis:

- `healthy`
- `degraded`
- `unhealthy`

### GET /stdio/health/:id?probe=network

Executa tambem probe de rede quando houver ferramenta compativel.

```bash
curl -sS 'http://localhost:5146/api/stdio/health/790950da65f6?probe=network'
```

## 4) Health HTTP e streamable-http

### GET /health/http/:id

Health check para MCPs HTTP/SSE e streamable-http.

```bash
curl -sS http://localhost:5146/api/health/http/SEU_ID
```

## 5) Imagens Docker

### GET /images

Lista imagens locais com status de uso.

```bash
curl -sS http://localhost:5146/api/images
```

### POST /images/pull

Pull simples de imagem.

```bash
curl -sS -X POST http://localhost:5146/api/images/pull \
  -H 'Content-Type: application/json' \
  -d '{"image":"alpine:3.20"}'
```

### GET /images/pull/stream?image=<ref>

SSE de progresso do pull.

```bash
curl -N 'http://localhost:5146/api/images/pull/stream?image=node:22-bookworm-slim'
```

### DELETE /images/:id

Remove imagem por id/hash curto.

```bash
curl -sS -X DELETE http://localhost:5146/api/images/sha256:SEU_HASH
```

## 6) Volumes Docker

### GET /volumes

Lista volumes com status de uso.

```bash
curl -sS http://localhost:5146/api/volumes
```

### DELETE /volumes/:name

Remove volume por nome.

```bash
curl -sS -X DELETE http://localhost:5146/api/volumes/mcp-cache
```

## Erros comuns

- `400`: payload invalido ou campos obrigatorios ausentes
- `404`: recurso nao encontrado
- `409`: conflito (ex.: imagem/volume em uso)
- `500`: erro interno

## Seguranca

A API opera Docker via `/var/run/docker.sock`.

Recomendacoes:

- Expor apenas em rede confiavel
- Nao publicar sem protecao adicional (proxy reverso com auth, VPN, firewall)
