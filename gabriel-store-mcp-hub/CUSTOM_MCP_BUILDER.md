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

## Próximas Etapas

### Fase 2: MCP Wrapper Funcional
**Problema Atual:** O container usa apenas a imagem padrão `node:20-alpine` sem lógica real.

**Solução Necessária:**
1. Criar imagem Docker `mcp-hub-wrapper` com servidor Node.js que:
   - Lê variáveis de ambiente com MCPs habilitados
   - Faz proxy/agregação de ferramentas
   - Respeita desabilitações de tools
   - Expõe via HTTP/SSE como MCP

2. Opções:
   - **A:** Criar imagem custom que roda servidor MCP que proxy para os outros
   - **B:** Usar volume com script injetado
   - **C:** Usar init container que gera config dinâmica

### Fase 3: Real Tool Discovery
Substituir mock tools por descoberta real:
- Usar health check endpoints
- Chamar `/tools` em cada MCP habilitado
- Agregar resultados
- Respeitar `disabledTools`

### Fase 4: Advanced Features
- [ ] Export/Import namespaces
- [ ] Versionamento de configuração
- [ ] Conflito de tool names entre MCPs
- [ ] Rate limiting entre MCPs
- [ ] Logging centralizado
- [ ] Métricas por tool

## Desenvolvimento Local

### Test Deploy Funcional

Para testar que o deploy funciona (sem wrapper funcional):

1. Ir para MCP Builder
2. Criar namespace "Test"
3. Habilitar pelo menos 1 MCP
4. Clicar "Deploy as MCP"
5. Voltar para Hub
6. Verificar se novo MCP aparece em "🔧 Custom MCPs"
7. Pode parar/iniciar/remover como qualquer outro MCP

### Debug

**Frontend:**
```bash
# Na tela initial, verificar localStorage:
localStorage.getItem('custom_mcp_ids')
localStorage.getItem('mcp_namespaces')
```

**Backend:**
```bash
# Logs do container
docker logs mcp-custom-{namespace-id}

# Verificar metadata salva
cat /data/mcps.json | grep isCustomNamespace
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

## Segurança & Considerações

1. **Validação de Input**
   - Namespace name é obrigatório
   - Pelo menos 1 MCP deve estar habilitado
   - Nomes de container são sanitizados

2. **Isolamento**
   - Cada namespace é um container separado
   - Tem seu próprio contexto de execução
   - Pode ter limites de recurso aplicados

3. **Persistência**
   - Namespace config em localStorage (frontend)
   - Container metadata em mcps.json (backend)
   - Sincronização é manual (refreshar Hub após deploy)

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
