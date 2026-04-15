# Webhook Gateway

API em Node.js/Express para receber webhooks de diferentes serviços, aplicar filtros de segurança e encaminhar o payload para outro destino (por exemplo, n8n).

## O que esta aplicação faz

- Recebe webhooks em endpoints dinâmicos por serviço.
- Valida/filtra eventos por regras configuradas (`telegramFilter`, `alexaskillFilter`, `noFilter`).
- Repassa o payload para o destino definido em `webhooks.yml`.
- Mantém logs em memória para consulta no dashboard.
- Protege o dashboard com login por senha (hash bcrypt) e cookie de sessão.
- Aplica rate limit em login e em chamadas de webhook.

## Arquitetura rápida

1. O webhook chega em `POST /api/:serviceName` (ou variações compatíveis).
2. A aplicação carrega a configuração do serviço em `code/webhooks.yml`.
3. Se houver filtro e o evento não passar, retorna `200` com mensagem de filtrado.
4. Se passar, encaminha via `POST` para o `destination` configurado.
5. Registra log em memória (máximo de 500 itens).

## Endpoints

### Webhooks (entrada)

- `POST /api/:serviceName`
- `POST /api/:serviceName/webhook/:id/webhook`
- `POST /api/:serviceName/webhook-test/:id/webhook`

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
- `LOGIN_PASSWORD_HASH`: hash bcrypt da senha de login.
- `DEBUG`: `true` para logs detalhados.
- Sessão/cookie:
  - `COOKIE_SECURE` (recomendado `true` em produção)
  - `COOKIE_SAME_SITE` (`lax`, `strict` ou `none`)
- Configuração de arquivo:
  - `WEBHOOK_CONFIG_PATH` (opcional, caminho absoluto para `webhooks.yml`)
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

Edite `code/webhooks.yml` para mapear cada serviço:

```yml
telegram:
  destination: ${TELEGRAM_WEBHOOK_URL}
  authorizedChatIds: ${TELEGRAM_AUTHORIZED_CHAT_IDS}
  authorizedUsernames: ${TELEGRAM_AUTHORIZED_USERNAMES}
  filter: telegramFilter

alexa:
  destination: ${ALEXA_WEBHOOK_URL}
  applicationId: ${ALEXA_APPLICATION_ID}
  filter: alexaskillFilter

webhook:
  destination: ${N8N_WEBHOOK_URL}
  signatureSecret: ${WEBHOOK_SIGNATURE_SECRET}
  signatureHeader: x-webhook-signature
  signaturePrefix: sha256=
  hmacAlgorithm: sha256
```

Assinatura HMAC (opcional por serviço):

- Se `signatureSecret` for definido, a requisição precisa conter a assinatura no header configurado.
- A assinatura esperada é `HMAC(rawBody)` usando o algoritmo configurado (`sha256` por padrão).
- Se `signaturePrefix` estiver definido (ex: `sha256=`), ele é removido antes da validação.

Filtros disponíveis:

- `telegramFilter`: aceita evento se `chat.id` OU `from.username` estiver autorizado.
- `alexaskillFilter`: aceita somente quando `applicationId` confere.
- `noFilter`: aceita tudo.

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

- `${APP_DATA_DIR}/code/webhooks.yml:/app/webhooks.yml`

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
- Webhooks limitados a 100 requisições por 15 minutos.
- Sessão expira em 2 minutos (`SESSION_EXPIRE_MS`).
- Sessão é renovada por atividade (sliding expiration).
- Logs são mantidos apenas em memória e não persistem após reinício.

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
