# Custom MCP Builder - Integration Guide

## Visão Geral

A página **MCP Builder** permite criar servidores MCP customizados que combinam ferramentas de múltiplos MCPs deployados. Esses MCPs customizados aparecem em uma seção separada ("🔧 Custom MCPs") na tela inicial do MCP Hub.

## Fluxo Completo

```
1. Acessar MCP Builder (Menu → MCP Builder)
   ↓
2. Criar/Selecionar Namespace
   ↓
3. Habilitar MCPs que quer combinar
   ↓
4. Desabilitar ferramentas específicas (opcional)
   ↓
5. Clicar "🚀 Deploy as MCP"
   ↓
6. Container Docker é criado e inicia
   ↓
7. MCP customizado aparece em "🔧 Custom MCPs" na tela inicial
```

## Arquitetura

### Frontend (React/Vite)

#### Componentes Novos
- **MCPBuilder** (`src/components/MCPBuilder.tsx`)
  - View principal do builder
  - Gerencia estado de namespaces
  - Coordena deploy para backend
  
- **NamespaceList** (`src/components/builder/NamespaceList.tsx`)
  - Lista de namespaces criados
  - CRUD de namespaces

- **BuilderInfo** (`src/components/builder/BuilderInfo.tsx`)
  - Exibe informações e estatísticas do namespace selecionado

- **McpSelector** (`src/components/builder/McpSelector.tsx`)
  - Checkboxes para habilitar/desabilitar MCPs

- **BuilderToolsManager** (`src/components/builder/BuilderToolsManager.tsx`)
  - Gerencia ferramentas combinadas
  - Permite desabilitar tools específicas

#### Modificações em Arquivos Existentes
- **App.tsx**
  - Adicionada view `'builder'` (era `'hub' | 'inspector'`)
  - Nova seção "🔧 Custom MCPs" separada de "📦 MCP Servers"
  - Tracking de MCPs customizados via localStorage
  
- **Menu.tsx**
  - Adicionado item "MCP Builder"
  - Atualizado tipo para aceitar `'builder'` view

- **services/api.ts**
  - Função `deployNamespaceAsMcp()` para fazer POST `/api/namespaces/deploy`

#### Persistência
- **localStorage**
  - Chave `mcp_namespaces`: Array de McpNamespace (configurações do builder)
  - Chave `custom_mcp_ids`: Array de IDs dos MCPs deployados (para UI)

### Backend (Fastify/Node.js)

#### Novo Route
- **routes/namespaces.ts**
  - Endpoint `POST /api/namespaces/deploy`
  - Recebe namespace + MCPs habilitados
  - Cria container Docker com configuração customizada
  - Retorna ID do novo MCP

#### Modificações
- **server.ts**
  - Importa `registerNamespaceRoutes`
  - Registra novo route com dependências

- **types/mcp.ts**
  - Adicionados campos a `McpMeta`:
    - `isCustomNamespace?: boolean`
    - `namespaceId?: string`
    - `enabledMcps?: string[]`

## Como Funciona o Deploy

1. **Preparação**
   - Frontend envia POST `/api/namespaces/deploy` com:
     ```json
     {
       "namespace": {
         "id": "ns_timestamp",
         "name": "Research Tools",
         "enabledMcps": ["id1", "id2"],
         "disabledTools": ["tool1", "tool2"]
       },
       "enabledMcps": [
         {"id": "id1", "name": "Wikipedia", "image": "..."},
         {"id": "id2", "name": "Web Browser", "image": "..."}
       ]
     }
     ```

2. **Container Creation**
   - Backend cria container com:
     - Image: `node:20-alpine` (padrão)
     - Name: `mcp-custom-{namespace-id}`
     - Port: 8000
     - Transport: HTTP
     - Env: Configuração do namespace

3. **Metadata Storage**
   - Salva em `mcps.json`:
     ```json
     {
       "container_short_id": {
         "name": "Research Tools (custom)",
         "isCustomNamespace": true,
         "namespaceId": "ns_timestamp",
         "enabledMcps": ["id1", "id2"],
         ...
       }
     }
     ```

4. **UI Registration**
   - Frontend adiciona ID do MCP a `localStorage['custom_mcp_ids']`
   - Na tela inicial, MCPs com ID em `custom_mcp_ids` aparecem em seção separada

## Como Funciona o Wrapper MCP

### Ferramentas Reais (Implementado ✅)

O custom MCP agora retorna **ferramentas reais** dos MCPs habilitados, não fictícias:

1. **Descoberta de Ferramentas**
   - Backend em `GET /api/namespaces/:namespaceId/tools` fetcha ferramentas de cada MCP habilitado
   - Para cada MCP, faz requisição direta ao container para listar tools

2. **Filtro de Ferramentas Desabilitadas**
   - Remove tools que estão na lista `disabledTools`
   - Exemplo: Se você desabilita "open_nodes", ela não aparece na resposta

3. **Wrapper HTTP**
   - Container roda servidor HTTP em Node.js
   - Endpoint `/mcp` implementa protocolo MCP via JSON-RPC
   - Fetcha ferramentas reais do backend em `mcp-hub:3001/api/namespaces/:namespaceId/tools`

### Protocolo MCP Suportado

O wrapper implementa os métodos MCP:

```json
{
  "method": "initialize",
  "method": "tools/list",
  "method": "tools/call",
  "method": "resources/list",
  "method": "prompts/list"
}
```

**Exemplo: Listar ferramentas**
```bash
curl -X POST http://localhost:8000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

### Arquitetura da Rede

```
┌─ Docker Network: gabriel-store-mcp-hub_default ─┐
│                                                   │
│  ┌─ Container: mcp-hub (port 3001) ──────────┐  │
│  │  Backend Fastify                           │  │
│  │  - POST /api/namespaces/deploy             │  │
│  │  - GET /api/namespaces/:id/tools           │  │
│  │  └─ Fetcha tools dos MCPs habilitados      │  │
│  └──────────────────────────────────────────────┘  │
│                        ↑                            │
│                     network                        │
│                   mcp-hub:3001                      │
│                        ↓                            │
│  ┌─ Container: mcp-custom-ns-* (port 8000) ──┐   │
│  │  Wrapper HTTP MCP                          │   │
│  │  - POST /mcp (implements MCP protocol)     │   │
│  │  - Fetcha tools reais do backend           │   │
│  │  └─ Retorna ferramentas filtradas          │   │
│  └──────────────────────────────────────────────┘   │
│                                                     │
└─────────────────────────────────────────────────────┘

Host (localhost):
- Backend exposed: localhost:5146
- Wrapper exposed: localhost:8000 (ou porta customizada)
```

## Status de Implementação

✅ **Completo:**
- Deploy de namespaces customizadas
- Wrapper HTTP funcional
- Descoberta real de ferramentas
- Filtro de ferramentas desabilitadas
- Suporte a múltiplos transports (HTTP, stdio, streamable-http)
- Conexão automática à rede mcp-hub
- Metadados persistidos

## Exemplo de Uso Completo

1. **Criar namespace pelo MCP Builder**
   - Selecionar MCPs (ex: memory)
   - Desabilitar ferramentas específicas (opcional)
   - Clicar "Deploy as MCP"

2. **Acessar ferramentas**
   ```bash
   # Listar ferramentas (apenas as habilitadas)
   curl -X POST http://localhost:8000/mcp \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
   
   # Resultado: Ferramentas REAIS do MCP, exceto as desabilitadas
   ```

3. **Integrar com Claude/Agents**
   - Use `http://localhost:8000` como servidor MCP
   - Agents conseguem ver e chamar ferramentas reais

## Desenvolvimento Local

### Testando o MCP Builder Completo

1. Ir para MCP Builder
2. Criar namespace com nome e descrição
3. Habilitar pelo menos 1 MCP
4. Ver ferramentas reais aparecendo no Tool Manager
5. Desabilitar algumas ferramentas (opcional)
6. Clicar "Deploy as MCP"
7. Voltar para Hub e verificar novo MCP em "🔧 Custom MCPs"
8. Pode parar/iniciar/remover como qualquer outro MCP
9. Testar com curl para verificar que ferramentas reais são retornadas

### Debug

**Frontend:**
```javascript
// Na tela inicial, verificar localStorage:
localStorage.getItem('custom_mcp_ids')
localStorage.getItem('mcp_namespaces')
```

**Backend:**
```bash
# Logs do container wrapper
docker logs mcp-custom-{namespace-id}

# Verificar metadados salvos
cat .appdata/data/mcps.json | jq '.[] | select(.isCustomNamespace)'

# Verificar que container está na rede certa
docker inspect mcp-custom-{namespace-id} | jq '.NetworkSettings.Networks'
```

**API:**
```bash
# Listar ferramentas do namespace via backend
curl http://localhost:5146/api/namespaces/{namespace-id}/tools | jq '.tools[].name'

# Listar ferramentas via wrapper (HTTP transport)
curl -X POST http://localhost:8000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

## Tipos TypeScript

### Frontend
```typescript
interface McpNamespace {
  id: string
  name: string
  description?: string
  createdAt: string
  updatedAt: string
  enabledMcps: string[]
  disabledTools: string[]
  metadata?: { color?: string; tags?: string[] }
}
```

### Backend
```typescript
interface DeployNamespacePayload {
  namespace: McpNamespace
  enabledMcps: Array<{ id: string; name: string; image: string }>
}
```

## Roadmap Futuro

- [ ] Export/Import de namespaces
- [ ] Versionamento e histórico de configurações
- [ ] Detecção e resolução de conflitos de nomes de tools entre MCPs
- [ ] Rate limiting configurável entre MCPs
- [ ] Logging centralizado de chamadas de tools
- [ ] Métricas de uso por ferramenta

## Segurança & Considerações

1. **Validação de Input**
   - Namespace name é obrigatório
   - Pelo menos 1 MCP deve estar habilitado
   - Nomes de container são sanitizados

2. **Isolamento**
   - Cada namespace é um container separado
   - Tem seu próprio contexto de execução
   - Pode ter limites de recurso aplicados via Docker

3. **Persistência**
   - Namespace config em localStorage (frontend)
   - Container metadata em mcps.json (backend)
   - Sincronização automática durante deploy

## Troubleshooting

**Q: Deploy falhou**
- Verificar logs do container: `docker logs mcp-custom-{id}`
- Verificar permissões do Docker socket
- Verificar espaço em disco

**Q: MCP não aparece após deploy**
- Renovar página (Ctrl+F5)
- Verificar localStorage: `custom_mcp_ids` tem o ID?
- Verificar se container está rodando: `docker ps | grep mcp-custom`

**Q: Container está rodando mas não responde**
- Wrapper padrão não tem lógica de MCP (vide Fase 2)
- Implementar wrapper funcional para requests reais

## Referências

- [MCP Specification](https://spec.modelcontextprotocol.io/)
- [MCP Hub API Reference](./docs/API_REFERENCE.md)
- [Docker API (Dockerode)](https://github.com/apocas/dockerode)
