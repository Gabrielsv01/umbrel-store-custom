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

### ✅ Caso 3: Edição de Namespace

1. Criar namespace
2. Clicar em ✏️ (editar)
3. Mudar nome/descrição
4. Verificar que mudou

**Resultado:** Edição funciona

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

### Problema: "Tool Manager" mostra apenas mock tools

**Esperado:** Na fase atual, as ferramentas são mockadas (3 por MCP: get_info, execute_command, list_resources)

**Próximo passo:** Integrar descoberta real de ferramentas via health check

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
- [ ] Ferramentas aparecem ao selecionar MCPs
- [ ] Deploy button está presente
- [ ] Deploy sem MCPs mostra erro
- [ ] Deploy com MCPs cria container
- [ ] Container Docker é criado com nome correto
- [ ] MCP aparece em "Custom MCPs" na tela inicial
- [ ] MCP customizado pode ser controlado (start/stop/remove)
- [ ] Namespace pode ser editado (nome/descrição)
- [ ] Namespace pode ser deletado
- [ ] localStorage persiste dados entre recargas

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
- Podem ser gerenciados como qualquer outro MCP
- Dados persistem em localStorage (frontend) e mcps.json (backend)
- Container wrapper usa image padrão (node:20-alpine)
- Wrapper real será implementado na Fase 2

## Próximos Passos

1. **Wrapper MCP Funcional**
   - Criar imagem que agrega ferramentas reais
   - Fazer proxy para MCPs habilitados
   - Respeitar disabledTools

2. **Tool Discovery Real**
   - Chamar health check de cada MCP
   - Obter ferramentas reais
   - Montar catálogo combinado

3. **Avançado**
   - Export/Import de namespaces
   - Versionamento
   - Métricas e logging
