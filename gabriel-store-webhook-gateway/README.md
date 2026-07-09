# Webhook Gateway

API em Node.js/Express para receber webhooks de diferentes serviços, aplicar filtros de segurança e encaminhar o payload para outro destino (por exemplo, n8n).

## O que esta aplicação faz

- Recebe webhooks em endpoints dinâmicos por serviço.
- Valida/filtra eventos por regras configuradas (filtros `telegram`, `alexa`, `queryParams`).
- Repassa o payload para o destino definido em `webhooks.yml`.
- Mantém logs em memória para consulta no dashboard.
- Protege o dashboard com login por senha (hash bcrypt) e cookie de sessão.
- Aplica rate limit em login e em chamadas de webhook.

## Arquitetura rápida

1. O webhook chega em `/api/:serviceName` (ou variações compatíveis) no método permitido (`POST`, `GET`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`).
2. A aplicação carrega a configuração do serviço em `config/webhooks.yml`.
3. Se houver filtro e o evento não passar, retorna `200` com mensagem de filtrado.
4. Se passar, encaminha para o `destination` configurado usando o mesmo método recebido.
5. Registra log em memória (máximo de 500 itens).

## Endpoints

### Webhooks (entrada)

- `POST /api/:serviceName`
- `POST /api/:serviceName/*subPath` (somente se `subdomain` permitir o caminho)
- `POST /api/:serviceName/webhook/:id/webhook`
- `POST /api/:serviceName/webhook-test/:id/webhook`
- `GET /api/:serviceName` (somente se `methods` incluir `GET`)
- `GET /api/:serviceName/*subPath` (somente se `methods` incluir `GET` e `subdomain` permitir)
- `GET /api/:serviceName/webhook/:id/webhook` (somente se `methods` incluir `GET`)
- `GET /api/:serviceName/webhook-test/:id/webhook` (somente se `methods` incluir `GET`)
- `PUT/PATCH/DELETE/HEAD/OPTIONS` seguem a mesma regra: precisam estar em `methods`.

### Dashboard e autenticação

- `POST /` -> login (form password)
- `GET /dashboard` -> dashboard (requer autenticação)
- `GET /api/webhooks` -> lista de serviços configurados (requer autenticação)
- `GET /api/logs/:serviceName?limit=10` -> logs por serviço (requer autenticação)

## Configuração

### 1) Variáveis de ambiente

No diretório `code`, copie o arquivo de exemplo:

```bash
cp .env.exemple .env
```

Principais variáveis:

- `PORT`: porta da API (padrão `5124`).
- `JSON_BODY_LIMIT`: limite do body JSON (padrão `1mb`).
- `URLENCODED_BODY_LIMIT`: limite para form-urlencoded (padrão `100kb`).
- `WEBHOOK_RATE_LIMIT_MAX`: default de requisições por IP na janela (padrão `100`).
- `WEBHOOK_RATE_LIMIT_WINDOW_MS`: default da janela do rate limit em ms (padrão `900000` = 15 min).
- `TRUST_PROXY`: nº de proxies confiáveis para derivar o IP do cliente (padrão `1`, atrás do app-proxy do Umbrel). Exposição direta, sem proxy: use `false`. Aceita número, `true`/`false` ou lista de subnets/preset. Afeta a chave do rate limit — valor errado permite forjar `X-Forwarded-For`.
- `LOG_PAYLOADS`: `false` guarda apenas metadados nos logs, sem o payload (padrão `true`, com redação de segredos).
- `LOGIN_PASSWORD_HASH`: hash bcrypt da senha de login.
- `DEBUG`: `true` para logs detalhados.
- Sessão/cookie:
  - `COOKIE_SECURE` (recomendado `true` em produção)
  - `COOKIE_SAME_SITE` (`lax`, `strict` ou `none`)
- Configuração de arquivo:
  - `WEBHOOK_CONFIG_PATH` (opcional, caminho absoluto para `webhooks.yml`; padrão: `config/webhooks.yml`)
- Hardening (`helmet`):
  - `ENABLE_HELMET`
  - `ENABLE_CSP`
  - `ENABLE_HSTS`
  - `ENABLE_NO_SNIFF`
  - `ENABLE_FRAMEGUARD`
  - `ENABLE_XSS_FILTER`
- Destinos/autorização dos filtros:
  - `N8N_WEBHOOK_URL`
  - `TELEGRAM_WEBHOOK_URL`
  - `TELEGRAM_AUTHORIZED_CHAT_IDS`
  - `TELEGRAM_AUTHORIZED_USERNAMES`
  - `ALEXA_APPLICATION_ID`
  - `ALEXA_WEBHOOK_URL` (necessário se usar o serviço `alexa` em `webhooks.yml`)

### 2) Configuração dos serviços de webhook

Edite `config/webhooks.yml` para mapear cada serviço:

```yml
telegram:
  destination: ${TELEGRAM_WEBHOOK_URL}
  filter:
    telegram:
      chatIds: ${TELEGRAM_AUTHORIZED_CHAT_IDS}
      usernames: ${TELEGRAM_AUTHORIZED_USERNAMES}

alexa:
  destination: ${ALEXA_WEBHOOK_URL}
  filter:
    alexa:
      applicationId: ${ALEXA_APPLICATION_ID}

webhook:
  destination: ${N8N_WEBHOOK_URL}
  methods:
    - POST
  filter:
    queryParams:
      u:
        - 1234
  response:
    default:
      forward:
        - STATUS
        - BODY
        - HEADERS
      allowedHeaders:
        - content-type
    methods:
      GET:
        forward:
          STATUS: "*"
          BODY: false
          HEADERS:
            - content-type
  subdomain:
    - path: rest/ping.view
      # sem `filter` => sem filtragem nesta rota
    - path: rest/*
      filter:
        telegram:
          chatIds: ${TELEGRAM_AUTHORIZED_CHAT_IDS}
  signatureSecret: ${WEBHOOK_SIGNATURE_SECRET}
  signatureHeader: x-webhook-signature
  signaturePrefix: sha256=
  hmacAlgorithm: sha256
```

Assinatura HMAC (opcional por serviço):

- Se `signatureSecret` for definido, a requisição precisa conter a assinatura no header configurado.
- A assinatura esperada é `HMAC(rawBody)` usando o algoritmo configurado (`sha256` por padrão).
- Se `signaturePrefix` estiver definido (ex: `sha256=`), ele é removido antes da validação.
- A validação HMAC vale para métodos com corpo (POST/PUT/PATCH/DELETE); requisições `GET` não têm corpo para assinar.

Token de acesso para GET (opcional por serviço):

- Como o `GET` não tem corpo para assinar via HMAC, use `getTokenSecret` para exigir um token em header nas requisições GET.
- Se `getTokenSecret` **não** for definido, o `GET` segue sem exigência (comportamento padrão).
- Se definido, todo `GET` precisa enviar o header (default `x-webhook-token`, customizável via `getTokenHeader`) com o valor exato; caso contrário retorna `401`. A comparação é feita em tempo constante.
- Prefira injetar o segredo por env (ex: `getTokenSecret: ${SUBSTREAM_GET_TOKEN}`) para não versioná-lo.

Filtros (`filter` é um **objeto** cujas chaves são os tipos de filtro):

- Se houver **mais de um** tipo no bloco `filter`, **todos** precisam passar (AND).
- **Omitir** o bloco `filter` = sem filtragem (aceita tudo).
- Tipos disponíveis:
  - `telegram`: aceita se `chat.id` OU `from.username` estiver em uma allowlist. Config: `chatIds` e/ou `usernames` (lista ou CSV). Sem nenhuma allowlist definida, **nega** (fail-closed).
    ```yml
    filter:
      telegram:
        chatIds: [123456789]
        usernames: [joaosilva]
    ```
  - `alexa`: aceita somente quando `applicationId` confere. Config: `applicationId`.
    ```yml
    filter:
      alexa:
        applicationId: ${ALEXA_APPLICATION_ID}
    ```
  - `queryParams`: aceita conforme a query string. Cada chave é um parâmetro (nome livre) com a lista de valores permitidos. Precisa bater em **todos** os parâmetros; em cada um, **qualquer** valor da lista serve. Sem parâmetros definidos, **nega** (fail-closed).
    ```yml
    filter:
      queryParams:
        u:
          - 1234
          - 5678
    ```

Opção por serviço:

- `methods`: lista de métodos permitidos no serviço (ex.: `POST`, `GET`, `PATCH`, `DELETE`).
  - Padrão, quando não informado: apenas `POST`.
  - Exemplo: `methods: [POST, GET]`.
  - O gateway encaminha para o destino usando o mesmo método recebido.
- `subdomain`: lista opcional de subcaminhos aceitos para o mesmo serviço (`*` como curinga).
  - Formato simples: `- rest/ping.view`
  - Formato com filtro por subcaminho: `- path: rest/ping.view` + um bloco `filter:` (ex.: `filter: { queryParams: { u: [1234] } }`)
  - Exemplo: `rest/ping.view` aceita somente esse caminho.
  - Exemplo: `rest/*` aceita qualquer rota abaixo de `rest/`.
  - Quando um subcaminho é aceito, ele é anexado ao `destination` no encaminhamento.
  - Se um subcaminho tiver filtro próprio, ele sobrescreve o `filter` global do serviço para aquela rota.
- `response`: define como a resposta do destino deve ser repassada.
  - Formato legado (ainda suportado):
    - `passStatus` (padrão `true`), `passBody` (padrão `true`), `passHeaders` (padrão `true`)
    - `allowedHeaders`, `defaultStatus`, `defaultBody`
  - Formato recomendado:
    - `forward` pode ser lista ou objeto:
      - Lista: `forward: [STATUS, HEADERS]`
      - Objeto: `forward: { STATUS: "*", BODY: false, HEADERS: [content-type] }`
      - `"*"` funciona como atalho para `true`
      - `HEADERS: "*"` repassa todos os headers do destino (exceto hop-by-hop bloqueados)
    - Campos ausentes na lista ficam bloqueados
    - `defaultStatus` e `defaultBody` seguem válidos quando `STATUS`/`BODY` não estiverem em `forward`
  - Formato recomendado (dinâmico por método):
    - `default`: política base para todos os métodos
    - `methods.GET`, `methods.POST`, etc: sobrescrevem a política base por método
  - Exemplo: permitir body no `POST` e ocultar body no `GET` usando `default` + `methods.GET`.
- `upstream`: define como o gateway encaminha a requisição para o destino.
  - `timeoutMs`: timeout padrão (em ms) para todos os métodos.
  - `timeoutMsByMethod`: timeout por método (ex.: `GET: 0`, `POST: 5000`).
  - `forwardRequest.HEADERS`: lista de headers de entrada que devem ser repassados ao destino.
    - Exemplo para streaming: `range`, `accept`, `user-agent`, `if-none-match`, `if-modified-since`.
  - `forwardRequest.BODY` (opcional): reservado para controle explícito de encaminhamento de body por serviço.
  - `forwardRequestHeaders`: alias legado ainda aceito para compatibilidade, mas recomenda-se migrar para `forwardRequest.HEADERS`.

Exemplo de `upstream` para streaming:

```yml
upstream:
  timeoutMsByMethod:
    GET: 0
    POST: 5000
  forwardRequest:
    HEADERS:
      - range
      - accept
      - user-agent
      - if-none-match
      - if-modified-since
```

Notas de comportamento em `GET`:

- O gateway encaminha `GET` com suporte a streaming da resposta do destino.
- Com `response.methods.GET.forward.HEADERS: "*"`, os headers de resposta do destino são repassados (exceto hop-by-hop bloqueados).

## Como rodar

## Desenvolvimento local

Requisitos:

- Node.js 20+
- npm

Comandos (dentro de `code`):

```bash
npm install
npm run dev-backend
```

Para build de produção:

```bash
npm run build
npm run build-frontend
npm start
```

A aplicação sobe em `http://localhost:5124` (ou porta definida em `PORT`).

## Docker local

No diretório `gabriel-store-webhook-gateway`:

```bash
docker compose up -d
```

O container expõe a porta `5124` e monta:

- `${APP_DATA_DIR}/config/webhooks.yml:/app/config/webhooks.yml`

## Como usar na prática

### 1) Login no dashboard

Abra:

- `http://localhost:5124/`

Envie a senha correspondente ao hash em `LOGIN_PASSWORD_HASH`.

### 2) Enviar um webhook de teste

Exemplo para o serviço `telegram`:

```bash
curl -X POST http://localhost:5124/api/telegram \
  -H "Content-Type: application/json" \
  -d '{
    "message": {
      "chat": { "id": 1234 },
      "from": { "username": "Batista" },
      "text": "Teste"
    }
  }'
```

### 3) Consultar logs

Após autenticar no dashboard:

- `GET /api/logs/telegram?limit=10`

## Segurança e limites

- Login limitado a 5 tentativas por 10 minutos.
- Webhooks limitados por IP (default `100` requisições por `15` minutos). O limite é
  configurável por serviço no `config/webhooks.yml` via bloco `rateLimit`
  (`windowMinutes`/`windowMs` e `max`; use `rateLimit: false` ou `disabled: true`
  para desligar) e o default global pode ser ajustado pelas envs
  `WEBHOOK_RATE_LIMIT_MAX` e `WEBHOOK_RATE_LIMIT_WINDOW_MS`.
- Sessão expira em 2 minutos (`SESSION_EXPIRE_MS`).
- Sessão é renovada por atividade (sliding expiration).
- Erro de autenticação no login usa mensagem genérica (`Credenciais inválidas`) para evitar vazamento de informação.
- Logs são mantidos apenas em memória e não persistem após reinício. Os payloads passam por redação de chaves sensíveis (senha, token, secret, authorization etc.) antes de serem armazenados; use `LOG_PAYLOADS=false` para não guardar payload algum.
- O IP usado no rate limit depende de `TRUST_PROXY`; ajuste conforme sua topologia de proxy para evitar bypass via `X-Forwarded-For`.

## Limitações conhecidas

- Não há persistência de logs/sessão em banco de dados.
- A sessão em memória não é compartilhada entre múltiplas instâncias.
- Se `webhooks.yml` estiver ausente ou inválido, os serviços podem não carregar corretamente.

## Estrutura relevante

- `code/src/index.ts`: bootstrap do servidor e rotas.
- `code/src/api/processWebhook.ts`: processamento/encaminhamento de webhook.
- `code/src/webhook-config.ts`: leitura de `webhooks.yml` e substituição de variáveis.
- `code/src/filters/`: filtros de validação.
- `code/public/`: páginas de login e dashboard.
