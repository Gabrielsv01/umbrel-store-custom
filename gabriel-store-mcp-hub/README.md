# MCP Hub

Painel web para deploy e gerenciamento de servidores MCP em contêineres Docker.

O MCP Hub foi pensado para rodar no Umbrel, mas também funciona localmente com Docker Compose.

## O que a aplicação faz

- Deploy de MCPs a partir de imagens Docker
- Start, stop, remove e edição de contêiner
- Visualização de logs em tempo real (SSE)
- Gestão de imagens Docker locais
- Pull manual de imagens com progresso em tempo real
- Pull automático de imagem quando faltar no deploy/update
- Gestão de volumes Docker com proteção contra remoção em uso
- Suporte a servidores MCP em `stdio` com sessão interativa sob demanda

## Arquitetura

- Frontend: React + Vite + Tailwind
- Backend: Fastify + TypeScript + Dockerode
- Runtime: imagem única (backend serve o frontend estático)
- Comunicação com Docker: socket `/var/run/docker.sock`

Fluxo em produção:

1. O backend inicia em `:3001`.
2. O frontend buildado é servido em `/app/public`.
3. A API fica sob `/api/*`.

## Estrutura do projeto

```text
gabriel-store-mcp-hub/
	docker-compose.yml
	umbrel-app.yml
	icon.svg
	README.md
	code/
		Dockerfile
		Makefile
		backend/
			server.ts
			package.json
			tsconfig.json
		frontend/
			src/
			package.json
```

## Requisitos

- Docker 24+
- Docker Compose v2
- Node.js 20+ (somente para desenvolvimento local sem container)
- pnpm ou npm

## Executando com Docker Compose

Na pasta `gabriel-store-mcp-hub`:

```bash
docker compose up -d --build
```

Aplicação disponível em:

- `http://localhost:5146` (porta padrão)

### Variáveis de ambiente (compose)

- `APP_PORT` (default: `5146`)
- `APP_DATA_DIR` (default: `./.appdata`)
- `TZ` (default: `UTC`)

Exemplo:

```bash
APP_PORT=5146 APP_DATA_DIR=./.appdata TZ=America/Sao_Paulo docker compose up -d --build
```

## Comandos úteis (Makefile)

Na pasta `gabriel-store-mcp-hub/code`:

```bash
make up
make stop
make start
make restart
make logs
make clean
```

Build e release amd64:

```bash
make build-amd64
make release-amd64 VERSION=1.0.1
```

## Desenvolvimento local (sem container)

### Backend

Na pasta `code/backend`:

```bash
pnpm install
pnpm run dev
```

### Frontend

Na pasta `code/frontend`:

```bash
pnpm install
pnpm run dev
```

## API

Base URL: `http://localhost:5146/api`

### MCPs

- `GET /mcps`
	- Lista contêineres com label `gabriel.mcp-hub=true`

- `POST /deploy`
	- Cria e inicia novo MCP
	- Faz pull automático da imagem se não existir localmente
	- Suporta `transport: "http" | "stdio"` (`http` por padrão)
	- Suporta `runtime` avançado para `entrypoint`, `args`, mounts, rede, usuário e privilégios

- `PUT /mcps/:id`
	- Recria contêiner com nova configuração
	- Também garante pull automático da imagem
	- Suporta `transport: "http" | "stdio"`
	- Suporta o mesmo bloco `runtime` do deploy

- `POST /action/:id`
	- Body: `{ "action": "start" | "stop" | "remove" }`

- `GET /logs/:id`
	- Stream SSE de logs do contêiner

### Runtime avançado por MCP

Os endpoints de deploy e update aceitam um objeto opcional `runtime` para casos em que o MCP precisa de configuração Docker mais ampla do que `image`, `command`, `env` e `port`.

Campos suportados:

- `entrypoint`: sobrescreve o entrypoint do contêiner
- `args`: array de argumentos para `Cmd`
- `workingDir`: diretório de trabalho
- `volumes`: named volumes em sintaxe Docker (`volume:/destino[:modo]`)
- `bindMounts`: bind mounts em sintaxe Docker (`/host:/destino[:modo]`)
- `extraHosts`: entradas `host:ip`
- `dns`: lista de servidores DNS
- `networkMode`: por exemplo `bridge`, `host`, `container:<id>`
- `user`: por exemplo `1000:1000`
- `privileged`: `true` para contêiner privilegiado
- `devices`: entradas como `/dev/kvm:/dev/kvm:rwm`
- `shmSize`: inteiro em bytes ou string com sufixo (`256m`, `1g`)

Observação:

- Quando `runtime.args` é informado, ele tem precedência sobre `command` para montar o `Cmd` do container.

Exemplo:

```json
{
	"name": "mcp-browser-heavy",
	"image": "mcp/playwright",
	"transport": "http",
	"port": 8931,
	"runtime": {
		"entrypoint": "npx",
		"args": [
			"@playwright/mcp@latest",
			"--host",
			"0.0.0.0",
			"--port",
			"8931",
			"--headless"
		],
		"workingDir": "/workspace",
		"volumes": ["mcp-cache:/data"],
		"bindMounts": ["/Users/me/project:/workspace"],
		"extraHosts": ["host.docker.internal:host-gateway"],
		"dns": ["1.1.1.1", "8.8.8.8"],
		"networkMode": "bridge",
		"user": "1000:1000",
		"privileged": false,
		"devices": ["/dev/kvm:/dev/kvm:rwm"],
		"shmSize": "1g"
	}
}
```

### Sessão stdio

- `GET /stdio/session/:id` (WebSocket)
	- Abre sessão interativa de MCP `stdio`
	- Ponte bidirecional cliente <-> stdin/stdout do contêiner
	- Mensagem enviada pelo cliente:
		- `{ "type": "input", "data": "texto\\n" }`
	- Mensagens recebidas do servidor:
		- `{ "type": "ready" }`
		- `{ "type": "output", "data": "..." }`
		- `{ "type": "error", "error": "..." }`

### Proxy stdio para clientes externos (VS Code/Claude)

- `GET /stdio/proxy/:id/sse` (SSE)
	- Abre uma sessão stdio interna e expõe interface MCP via SSE
	- Retorna evento `endpoint` com URL de envio de mensagens
	- Retorna evento `message` com respostas JSON-RPC do MCP

- `POST /stdio/proxy/:id/message?sessionId=<uuid>`
	- Envia request JSON-RPC para o MCP stdio associado à sessão SSE
	- Body: objeto JSON-RPC completo (ex.: `initialize`, `tools/list`, `tools/call`)

Observações:

- Esse proxy permite conectar um MCP `stdio` do Hub como se fosse um servidor MCP HTTP/SSE externo.
- A sessão é encerrada quando a conexão SSE é fechada.

### Health check stdio

- `GET /stdio/health/:id`
	- Executa handshake MCP (`initialize` + `tools/list`) em uma sessão temporária
	- Retorna status: `healthy`, `degraded` ou `unhealthy`
	- Inclui diagnóstico de erros comuns de rede/TLS detectados no output

- `GET /stdio/health/:id?probe=network`
	- Além do handshake, tenta um probe de rede com ferramenta compatível (quando disponível)
	- Útil para antecipar bloqueios antes de usar no VS Code

### Imagens

- `GET /images`
	- Lista imagens locais com status de uso

- `POST /images/pull`
	- Pull simples (sem stream)
	- Body: `{ "image": "alpine:3.20" }`

- `GET /images/pull/stream?image=<ref>`
	- SSE de progresso de pull
	- Eventos `start`, `progress`, `done`, `error`
	- Campos agregados para progresso contínuo:
		- `overallCurrent`
		- `overallTotal`
		- `overallPercent`

- `DELETE /images/:id`
	- Remove imagem por ID/hash curto
	- Bloqueia se estiver em uso

### Volumes

- `GET /volumes`
	- Lista volumes com status de uso

- `DELETE /volumes/:name`
	- Remove volume
	- Bloqueia se estiver em uso

## Exemplo prático: Playwright MCP

Para o Playwright MCP funcionar de forma contínua no MCP Hub, ele precisa iniciar em modo servidor HTTP/SSE com porta explícita.

Configuração que funcionou no teste:

- Name: `mcp-playwright-test`
- Image: `mcp/playwright`
- Command: `--host 0.0.0.0 --port 8931 --headless`
- Port: `8931`

Payload de deploy via API:

```json
{
	"name": "mcp-playwright-test",
	"image": "mcp/playwright",
	"command": "--host 0.0.0.0 --port 8931 --headless",
	"port": 8931
}
```

Observação:

- Se subir sem `--port`, esse container pode entrar em restart loop dependendo do modo padrão de inicialização.

## Exemplo prático: MCP em stdio

Para servidores MCP que trabalham via stdio, selecione `transport=stdio` no deploy.

Exemplo de payload:

```json
{
	"name": "mcp-stdio-test",
	"image": "mcp/wikipedia-mcp",
	"transport": "stdio"
}
```

Depois de deployado, abra a sessão interativa no card do MCP pelo botão `Session`.

Para cliente externo (ex.: VS Code), use o proxy SSE:

1. Descubra o ID do MCP:

```bash
curl -sS http://localhost:5146/api/mcps
```

2. Abra SSE no ID desejado:

```bash
curl -N http://localhost:5146/api/stdio/proxy/<id>/sse
```

3. Use a URL recebida no evento `endpoint` para enviar requests JSON-RPC via `POST`.

Na UI do MCP Hub, a seção `Health` aparece em todos os cards, mas a execução do check é disponível apenas para MCPs `stdio`.

## Como descobrir os parâmetros de uma imagem MCP

Fluxo recomendado para qualquer imagem MCP nova:

1. Verifique se a imagem existe e veja os argumentos suportados:

```bash
docker run --rm <imagem> --help
```

2. Se o contêiner ficar reiniciando no MCP Hub, cheque se a imagem exige modo servidor/porta.

3. Ajuste `command` e `port` no deploy e valide status:

```bash
curl -sS http://localhost:5146/api/mcps
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
```

4. Se necessário, veja logs para confirmar motivo de restart:

```bash
docker logs <container>
```

## Persistência

Os metadados de MCPs são salvos em:

- `/data/mcps.json` dentro do container
- mapeado para `${APP_DATA_DIR}/data` no host

## Segurança e limitações

- O serviço monta o Docker socket do host.
- Isso é poderoso, mas sensível: quem acessa a API pode operar Docker.
- Recomendado expor somente em rede confiável.

## Integração com Umbrel

Arquivo de manifesto:

- `umbrel-app.yml`

Porta publicada no Umbrel:

- `5146`

Categoria:

- `MCP`

## Troubleshooting

### 1) Pull mostra pouco progresso e termina rápido

Normal para imagens pequenas ou em cache. O daemon Docker pode enviar poucos eventos de bytes.

### 2) Erro ao criar/deploy contêiner por imagem ausente

O backend já tenta pull automático. Se falhar, valide:

- acesso de rede ao registry
- nome/tag da imagem
- permissões do Docker daemon

### 3) Não consigo remover imagem/volume

Se estiver em uso por contêiner, a API retorna `409` e bloqueia remoção.

### 4) Porta já está em uso

Altere `APP_PORT` antes de subir:

```bash
APP_PORT=5252 docker compose up -d --build
```

## Roadmap sugerido

- Histórico de pulls com duração e status final
- Retry automático configurável
- Autenticação na UI/API para ambientes expostos
- Filtros avançados de logs e métricas básicas por contêiner

## Licença

Consulte o arquivo `LICENSE` na raiz do repositório.
