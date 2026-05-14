# Testing Custom MCP Builder - Guia Prático

## Pré-requisitos

- [ ] Docker rodando
- [ ] MCP Hub rodando (na porta 5146 ou configurada)
- [ ] Pelo menos 2 MCPs deployados no Hub

## Testando o Builder

### 1. Acessar a Página

```
1. Abra http://localhost:5146
2. Clique no menu ≡ (canto superior direito)
3. Clique em "MCP Builder"
```

**Esperado:** Você deve ver a página do Builder com:
- Seção "Namespaces" (vazia no primeiro uso)
- Botão "+ New" para criar namespace

### 2. Criar um Namespace

```
1. Clique "+ New"
2. Preencha:
   - Name: "Test Namespace"
   - Description: "Testing the builder"
3. Clique "Create"
```

**Esperado:** Namespace aparece na lista

### 3. Selecionar MCPs

```
1. Clique no namespace "Test Namespace"
2. Role para baixo até "MCP Servers"
3. Marque pelo menos 2 MCPs com checkboxes
```

**Esperado:** 
- Cards de estatísticas atualizam
- Seção "Tool Manager" mostra ferramentas dos MCPs selecionados

### 4. Gerenciar Ferramentas (Opcional)

```
1. Role para "Tool Manager"
2. Desabilite algumas ferramentas (uncheck)
3. Use o filtro para ver por MCP específico
```

**Esperado:**
- Contador de ferramentas atualiza
- Filtro funciona

### 5. Deploy

```
1. Role até o botão "🚀 Deploy as MCP"
2. Clique para fazer deploy
3. Aguarde o spinner
```

**Esperado:**
- Button muda para "🚀 Deploying..."
- Após alguns segundos, volta ao namespace list
- Não há mensagem de erro

### 6. Verificar no Hub

```
1. Clique "Back to Hub"
2. Volte para a tela inicial
```

**Esperado:**
- Nova seção "🔧 Custom MCPs" aparece no topo
- Seu namespace aparece como um card MCP customizado
- Pode parar, iniciar, remover o container

### 7. Verificar Container Docker

```bash
docker ps | grep mcp-custom
```

**Esperado:**
```
mcp-custom-ns_xxxxx    node:20-alpine    ...    Running
```

## Debugging

### Frontend - Console do Navegador

```javascript
// Ver namespaces salvos
localStorage.getItem('mcp_namespaces')

// Ver IDs de MCPs customizados
localStorage.getItem('custom_mcp_ids')

// Limpar tudo (para recomeçar)
localStorage.removeItem('mcp_namespaces')
localStorage.removeItem('custom_mcp_ids')
```

### Backend - Logs

```bash
# Ver logs do container customizado
docker logs mcp-custom-ns_xxxxx

# Ver metadata salva
cat .appdata/data/mcps.json | jq '.[] | select(.isCustomNamespace)'

# Ver todos os containers com label
docker ps --filter "label=gabriel.mcp-hub=true"
```

### Verificar API

```bash
# Lista todos os MCPs
curl http://localhost:5146/api/mcps | jq '.[]'

# Ver metadata de um MCP customizado
curl http://localhost:5146/api/mcps | jq '.[] | select(.meta.isCustomNamespace)'
```

## Casos de Teste

### ✅ Caso 1: Flow Completo

1. Criar namespace
2. Habilitar MCPs
3. Deploy
4. Verificar no Hub
5. Verificar container Docker

**Resultado:** Tudo deve funcionar sem erros

### ✅ Caso 2: Múltiplos Namespaces

1. Criar 3 namespaces com MCPs diferentes
2. Deploy todos
3. Verificar que todos aparecem em "Custom MCPs"

**Resultado:** Todos devem aparecer e serem gerenciáveis independentemente

### ✅ Caso 3: Ferramentas Reais são Descobertas

1. Criar namespace
2. Habilitar pelo menos 1 MCP
3. Verificar que a seção "Tool Manager" mostra ferramentas reais do MCP
4. Desabilitar algumas ferramentas
5. Deploy

**Resultado:** O MCP customizado lista apenas as ferramentas habilitadas quando consultado

### ✅ Caso 4: Deletar Namespace

1. Criar namespace
2. Clicar em 🗑️ (deletar)
3. Confirmar delete

**Resultado:** Namespace é removido da lista (container continua rodando)

### ❌ Caso 5: Deploy sem MCPs

1. Criar namespace
2. NÃO selecionar nenhum MCP
3. Clicar "Deploy as MCP"

**Esperado:** Mensagem de erro: "Select at least one MCP before deploying"

### ❌ Caso 6: Deploy com nome vazio

1. Criar namespace sem nome
2. Clicar "Create"

**Esperado:** Campo fica vermelho ou mensagem de erro

## Troubleshooting

### Problema: Namespace não aparece após criar

**Solução:**
```javascript
// Verificar localStorage
localStorage.getItem('mcp_namespaces')

// Deve retornar um array com o namespace
// Se está vazio, localStorage pode estar corrompido
localStorage.removeItem('mcp_namespaces')
// Recarregar página
```

### Problema: Deploy falha

**Verificar:**
1. Há espaço em disco? `df -h`
2. Docker rodando? `docker ps`
3. MCPs selecionados? Deve haver pelo menos 1
4. Logs do backend? `docker logs mcp-hub` (se rodando em container)

### Problema: MCP customizado não aparece em "Custom MCPs"

**Verificar:**
1. Container foi criado? `docker ps | grep mcp-custom`
2. localStorage tem o ID? `localStorage.getItem('custom_mcp_ids')`
3. Recarregue a página (Ctrl+F5)

### Problema: "Tool Manager" não mostra ferramentas

**Verificar:**
1. Há MCPs habilitados? Deve haver pelo menos 1 selecionado
2. Os MCPs estão rodando? `docker ps | grep -v mcp-custom` deve mostrar os MCPs
3. Os MCPs têm ferramentas? Acesse o Inspector para verificar

**Esperado:** Tool Manager mostra ferramentas reais de cada MCP habilitado. Se um MCP não tem ferramentas definidas, nada é mostrado.

## Testando com Curl

### Verificar Ferramentas via Backend API

```bash
# Após criar um namespace com ID: ns_xxxxx

# 1. Listar ferramentas do backend
curl -s http://localhost:5146/api/namespaces/ns_xxxxx/tools | jq '.tools[].name'

# Resultado esperado: Nomes reais de ferramentas dos MCPs habilitados, sem as desabilitadas
```

### Verificar Ferramentas via Wrapper HTTP

```bash
# Após criar um namespace HTTP com ID: ns_xxxxx e porta: 8000

# 1. Listar ferramentas via wrapper
curl -X POST http://localhost:8000/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list",
    "params": {}
  }' | jq '.result.tools[].name'

# Resultado esperado: Nomes reais de ferramentas dos MCPs habilitados
```

### Verificar que Ferramentas Desabilitadas não aparecem

```bash
# Se você desabilitou "tool_x" na criação:

curl -s http://localhost:5146/api/namespaces/ns_xxxxx/tools | jq '.tools[] | select(.name == "tool_x")'

# Resultado esperado: vazio (não retorna nada)
```

### Verificar Metadados do Container

```bash
# Ver metadados salvos do container customizado
docker inspect mcp-custom-ns_xxxxx | jq '.Config.Env' | grep DISABLED_TOOLS

# Ver logs do wrapper
docker logs mcp-custom-ns_xxxxx
```

## Limpeza Pós-Teste

```bash
# Remover containers customizados
docker ps -a | grep mcp-custom | awk '{print $1}' | xargs docker rm -f

# Remover dados do localStorage (no navegador)
localStorage.clear()

# Ou apenas limpar Builder
localStorage.removeItem('mcp_namespaces')
localStorage.removeItem('custom_mcp_ids')
```

## Checklist de Aceitação

- [ ] Namespace pode ser criado com nome/descrição
- [ ] Namespace aparece na lista
- [ ] Ao clicar namespace, abre editor
- [ ] Informações básicas, estatísticas são exibidas
- [ ] MCPs podem ser habilitados/desabilitados
- [ ] Ferramentas reais aparecem ao selecionar MCPs
- [ ] Ferramentas podem ser desabilitadas no Tool Manager
- [ ] Deploy button está presente
- [ ] Deploy sem MCPs mostra erro
- [ ] Deploy com MCPs cria container
- [ ] Container Docker é criado com nome correto
- [ ] MCP aparece em "Custom MCPs" na tela inicial
- [ ] MCP customizado retorna ferramentas reais (exceto desabilitadas)
- [ ] MCP customizado pode ser consultado via API e curl
- [ ] MCP customizado pode ser controlado (start/stop/remove)
- [ ] Namespace pode ser editado (nome/descrição)
- [ ] Namespace pode ser deletado
- [ ] localStorage persiste dados entre recargas
- [ ] Wrapper se conecta à rede do MCP Hub automaticamente

## Métricas

```
Componentes criados: 7
Linhas de código frontend: ~800
Linhas de código backend: ~100
Tipos TypeScript: 7
Rotas novas: 1
Build size: +2.5KB (gzipped)
```

## Notas

- MCPs customizados são containers reais do Docker
- Podem ser gerenciados como qualquer outro MCP (start/stop/remove)
- Dados persistem em localStorage (frontend) e mcps.json (backend)
- Container wrapper usa image padrão (node:20-alpine) com servidor HTTP/STDIO/streamable-HTTP
- Ferramentas são descobertas automaticamente dos MCPs habilitados
- Ferramentas desabilitadas são filtradas no backend e no wrapper
- O wrapper se conecta automaticamente à rede Docker do MCP Hub durante a criação

## Funcionalidades Implementadas ✅

- **Wrapper MCP Funcional**: Servidores wrapper para `http`, `stdio` e `streamable-http`
- **Tool Discovery Real**: Descoberta automática de ferramentas dos MCPs habilitados
- **Filtro de Ferramentas**: Desabilitar ferramentas específicas no namespace customizado
- **Rede Automática**: Containers wrapper se conectam automaticamente à rede do MCP Hub
- **Múltiplos Transports**: Suporte a stdio, HTTP e streamable-HTTP

## Próximas Etapas

1. **Export/Import de Namespaces**
   - Exportar configuração de namespace para arquivo
   - Importar namespace de arquivo

2. **Versionamento de Configuração**
   - Histórico de mudanças em namespaces
   - Rollback de configurações anteriores

3. **Avançado**
   - Métricas por ferramenta (quantas vezes foi chamada)
   - Logging centralizado de chamadas
   - Rate limiting entre MCPs
