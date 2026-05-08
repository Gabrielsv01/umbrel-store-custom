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

- `PUT /mcps/:id`
	- Recria contêiner com nova configuração
	- Também garante pull automático da imagem

- `POST /action/:id`
	- Body: `{ "action": "start" | "stop" | "remove" }`

- `GET /logs/:id`
	- Stream SSE de logs do contêiner

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
