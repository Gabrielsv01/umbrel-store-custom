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
- Bloqueio de pull concorrente no deploy para evitar estado de progresso inconsistente
- Gestão de volumes Docker com proteção contra remoção em uso
- Catálogo de templates MCP (incluindo templates leves para testes)
- **MCP Builder**: Criar namespaces customizados combinando múltiplos MCPs
- **Inspector**: Explorar Tools, Resources, Prompts, Roots, e fazer Health Check dos MCPs
- Suporte a servidores MCP em `stdio`, `http/sse` e `streamable-http`
- Sessão interativa sob demanda para MCPs `stdio`
- Health check robusto com fallback de endpoint/host e diagnostics detalhado
- Redação de variáveis sensíveis (`secretKeys`) no retorno de metadados
- Sincronização automática de metadados para containers sem dados salvos

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

## Rodando no Proxmox (Debian 13)

Para instalar o MCP Hub no Proxmox usando um ambiente limpo, um fluxo simples e confiavel e:

1. Criar uma VM (ou LXC) a partir de um template Debian 13.
2. Atualizar o sistema.
3. Instalar Docker.
4. Subir o container do MCP Hub.

### 1) Atualizar o sistema

```bash
sudo apt update && sudo apt upgrade -y
```

### 2) Instalar Docker (via repositorio oficial)

```bash
sudo apt install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo \
	"deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian \
	$(. /etc/os-release && echo $VERSION_CODENAME) stable" | \
	sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
```

### 3) Subir o MCP Hub com Docker

```bash
mkdir -p ~/mcp-hub && cd ~/mcp-hub
mkdir -p mcp_data

docker run -d \
	--name mcp-hub \
	-e NODE_ENV=production \
	-e DATA_DIR=/data \
	-e STATIC_DIR=/app/public \
	-e TZ=America/Sao_Paulo \
	-v /var/run/docker.sock:/var/run/docker.sock \
	-v "$(pwd)/mcp_data:/data" \
	-p 5146:3001 \
	--restart unless-stopped \
	gabrielsv01/mcp-hub:1.0.3
```

Depois, acesse:

- `http://IP_DA_VM_OU_LXC:5146`

Observacoes importantes:

- O container precisa montar `/var/run/docker.sock` para gerenciar outros containers.
- Em LXC, habilite nesting e recursos necessarios para o Docker funcionar corretamente.

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

## MCP Builder

A aplicação inclui um **MCP Builder** para criar namespaces customizados que combinam múltiplos MCPs em um único servidor.

### Como usar:

1. **Vá para a aba Builder** no menu principal
2. **Crie um novo namespace** com:
   - Nome descritivo
   - Descrição (opcional)
   - Transport: `http`, `stdio` ou `streamable-http`
   - Porta (se HTTP/streamable-http)

3. **Habilite MCPs** - selecione quais MCPs você quer combinar
4. **Gerencie Tools** - veja todas as ferramentas disponíveis e desabilite as que não quer usar
5. **Deploy** - crie o namespace customizado como um novo servidor MCP

O namespace customizado fica disponível no Hub e pode ser usado como qualquer outro MCP.

### Variáveis de ambiente para habilitar features

Para que o Inspector mostre **Resources** e **Prompts**, o MCP precisa ter variáveis de ambiente:

```
MCP_HAS_RESOURCES=true   # Habilita a aba Resources no Inspector
MCP_HAS_PROMPTS=true     # Habilita a aba Prompts no Inspector
```

Se o MCP não tiver essas variáveis, o Inspector mostrará essas abas como vazias (comportamento esperado).

## Inspector

O **Inspector** permite explorar e testar MCPs em tempo real com:

- **Tools**: Lista e testa ferramentas disponíveis
- **Resources**: Visualiza recursos virtuais do MCP
- **Prompts**: Vê templates de prompts pré-configurados
- **Ping**: Verifica saúde e latência do servidor
- **Roots**: Lista as raízes de acesso do MCP

### Como usar:

1. Vá para a aba **Inspector** no menu
2. Selecione um MCP no dropdown
3. Navegue pelas abas para explorar as capacidades
4. Teste ferramentas preenchendo parâmetros e clicando "Run Tool"

## Demo MCP

Um MCP de demonstração está disponível em `gabriel-store-demo-mcp/` que implementa todas as funcionalidades do protocolo MCP para fins de teste e exploração.

**Para deployar o Demo MCP:**

```bash
cd gabriel-store-demo-mcp
docker build -f docker/Dockerfile -t demo-mcp:latest .
```

Depois use o **Deploy Form** com:
- Nome: `demo-mcp`
- Imagem: `demo-mcp:latest`
- Transport: `stdio`
- Env: `MCP_HAS_RESOURCES=true MCP_HAS_PROMPTS=true`

O Demo MCP inclui:
- 3 Tools: `hello_world`, `calculate`, `get_info`
- 3 Resources: hello, documentation, config
- 3 Prompts: greeting, code_review, brainstorm
- Roots: data, config, cache
- Health check via Ping

## API

Base URL: `http://localhost:5146/api`

Referencia completa dos endpoints:

- `docs/API_REFERENCE.md`

### MCPs

- `GET /mcps`
	- Lista contêineres com label `gabriel.mcp-hub=true`

- `POST /deploy`
	- Cria e inicia novo MCP
	- Faz pull automático da imagem se não existir localmente
	- Suporta `transport: "http" | "stdio" | "streamable-http"` (`http` por padrão)
	- Aceita `secretKeys` para marcar variáveis sensíveis em `env`
	- Suporta `runtime` avançado para `entrypoint`, `args`, mounts, rede, usuário e privilégios

- `PUT /mcps/:id`
	- Recria contêiner com nova configuração
	- Também garante pull automático da imagem
	- Suporta `transport: "http" | "stdio" | "streamable-http"`
	- Aceita `secretKeys` para manter redação de variáveis sensíveis
	- Suporta o mesmo bloco `runtime` do deploy

- `POST /action/:id`
	- Body: `{ "action": "start" | "stop" | "remove" }`
	- `remove` faz remoção forçada para suportar contêineres em restart loop

- `GET /logs/:id`
	- Stream SSE de logs do contêiner

### Namespaces Customizados

- `POST /api/namespaces/deploy`
	- Cria um namespace customizado combinando múltiplos MCPs
	- Body:
		```json
		{
			"namespace": {
				"id": "ns_1234567890",
				"name": "Meu Namespace",
				"description": "Descrição opcional",
				"transport": "stdio" | "http" | "streamable-http",
				"port": 8000,
				"enabledMcps": ["mcp1_id", "mcp2_id"],
				"disabledTools": ["tool_name1", "tool_name2"]
			},
			"enabledMcps": [
				{ "id": "mcp1_id", "name": "MCP 1", "image": "image1:latest" },
				{ "id": "mcp2_id", "name": "MCP 2", "image": "image2:latest" }
			]
		}
		```

### MCP Tools

- `GET /mcps/:id/tools`
	- Lista ferramentas disponíveis em um MCP
	- Retorna array de tools com descrição e inputSchema

- `PATCH /mcps/:id/tools`
	- Desabilita ferramentas específicas
	- Body: `{ "disabledTools": ["tool_name1", "tool_name2"] }`

### Catálogo

- `GET /catalog`
	- Lista templates prontos para deploy
	- Inclui templates streamable leves para testes rápidos

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

### Health check http/sse e streamable-http

- `GET /health/http/:id`
	- Health para MCPs `http` e `streamable-http`
	- Fallback previsível de endpoints (ex.: `/mcp`, `/sse`, `/`)
	- Fallback de host por nome/alias/IP do contêiner
	- Retry em timeout/rede para reduzir falso negativo
	- Parsing tolerante para respostas fora do padrão (JSON/SSE/fragmentos)
	- Retorna `diagnostics` com hosts e tentativas de endpoint (status/latência/erro)

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

Configuração recomendada:

- Name: `mcp-playwright-test`
- Image: `mcr.microsoft.com/playwright:v1.54.0-noble`
- Transport: `streamable-http`
- Command: `npx -y @playwright/mcp@latest --host 0.0.0.0 --port 8931`
- Port: `8931`

Payload de deploy via API:

```json
{
	"name": "mcp-playwright-test",
	"image": "mcr.microsoft.com/playwright:v1.54.0-noble",
	"transport": "streamable-http",
	"command": "npx -y @playwright/mcp@latest --host 0.0.0.0 --port 8931",
	"port": 8931
}
```

Observação:

- A imagem do Playwright é pesada. Para smoke tests de streamable-http, prefira o template de catálogo `Streamable Mock (Light)`.

## Exemplo prático: Streamable Mock (leve)

Template de catálogo para validação rápida de streamable-http sem baixar imagem grande.

- Name: `streamable-mock`
- Image: `node:20-alpine`
- Transport: `streamable-http`
- Port: `8931`

Esse template já vem com `runtime.entrypoint=node` e `runtime.args` para subir um servidor MCP mock mínimo em `/mcp`.

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

Na UI do MCP Hub, a seção `Health` funciona para todos os transports suportados.

- `stdio`: exibe handshake e probe de rede
- `http/streamable-http`: exibe diagnostics com hosts e endpoints tentados

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

### 4) Não consigo remover um MCP em restart loop

A ação `remove` usa remoção forçada para lidar com contêineres instáveis.

Se ainda assim falhar, valide:

- conexão com o Docker daemon
- permissões de acesso ao socket Docker
- status do daemon Docker no host

### 5) Porta já está em uso

Altere `APP_PORT` antes de subir:

```bash
APP_PORT=5252 docker compose up -d --build
```

### 6) Resources/Prompts não aparecem no Inspector

Se um MCP não mostra Resources ou Prompts no Inspector, é porque não tem as variáveis de ambiente habilitadas.

Adicione ao deploy:

```
MCP_HAS_RESOURCES=true
MCP_HAS_PROMPTS=true
```

Redeploy o MCP e tente novamente.

### 7) Metadados ausentes para containers antigos

Se containers antigos não têm metadados salvos (ex: criados antes desta atualização), a sincronização automática vai preenchê-los na próxima requisição a `GET /api/mcps`.

Isso ocorre uma única vez por container.

## Roadmap sugerido

- Histórico de pulls com duração e status final
- Retry automático configurável
- Autenticação na UI/API para ambientes expostos
- Filtros avançados de logs e métricas básicas por contêiner

## Licença

Consulte o arquivo `LICENSE` na raiz do repositório.
