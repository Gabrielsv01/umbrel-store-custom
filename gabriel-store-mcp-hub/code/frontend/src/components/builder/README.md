# MCP Builder Components

Componentes para a página de construção e gerenciamento de namespaces MCP customizados.

## Estrutura

### MCPBuilder.tsx
Componente principal que gerencia o estado geral do builder:
- Carrega e salva namespaces em localStorage
- Gerencia a seleção de namespace
- Coordena a criação, atualização e exclusão de namespaces
- Calcula estatísticas

**State:**
- `namespaces`: Lista de todos os namespaces
- `selectedNamespace`: Namespace selecionado para edição
- `isCreating`: Controla se o formulário de criação está visível
- `statistics`: Estatísticas do namespace selecionado

**Métodos:**
- `loadNamespaces()`: Carrega do localStorage
- `saveNamespaces()`: Persiste em localStorage
- `handleCreateNamespace()`: Cria novo namespace
- `handleUpdateNamespace()`: Atualiza namespace existente
- `handleDeleteNamespace()`: Exclui namespace
- `handleToggleMcp()`: Habilita/desabilita MCP
- `handleToggleTool()`: Habilita/desabilita ferramenta

### NamespaceList.tsx
Componente que lista todos os namespaces:
- Exibe lista de namespaces com contador de MCPs
- Permite criar novo namespace
- Ações: editar e deletar
- Confirmação antes de deletar

### NamespaceForm.tsx
Formulário para criar/editar namespaces:
- Campo para nome (obrigatório)
- Campo para descrição (opcional)
- Botões de submit e cancel

### BuilderInfo.tsx
Exibe informações e estatísticas do namespace selecionado:
- Card com informações básicas (nome, descrição, datas, ID)
- Card com estatísticas de MCPs (habilitados/total)
- Card com estatísticas de ferramentas (habilitadas/desabilitadas)

### McpSelector.tsx
Interface para habilitar/desabilitar MCPs:
- Lista de MCPs disponíveis com checkboxes
- Exibe nome, imagem e status de cada MCP
- Permite habilitar múltiplos MCPs para o namespace

### BuilderToolsManager.tsx
Gerenciador de ferramentas combinadas:
- Combina ferramentas de todos os MCPs habilitados
- Permite filtrar por MCP específico
- Cada ferramenta mostra sua origem
- Pode habilitar/desabilitar ferramentas individuais
- Botão "Toggle All" para mudar estado de todas

### NamespaceEditor.tsx
Componente para editar detalhes do namespace:
- Exibe informações básicas
- Permite entrar em modo de edição
- Salva alterações

## Data Structure

### McpNamespace
```typescript
{
  id: string;              // ID único (ns_timestamp)
  name: string;            // Nome do namespace
  description?: string;    // Descrição opcional
  createdAt: string;       // ISO date
  updatedAt: string;       // ISO date
  enabledMcps: string[];   // IDs dos MCPs habilitados
  disabledTools: string[]; // IDs das ferramentas desabilitadas
  metadata?: {
    color?: string;
    tags?: string[];
  };
}
```

### ManagedTool
```typescript
{
  id: string;
  name: string;
  description: string;
  inputSchema?: JsonRecord;
  source: {
    mcpId: string;
    mcpName: string;
  };
  disabled: boolean;
}
```

## Persistência

Dados armazenados em `localStorage` chave `mcp_namespaces`:
- Carregados ao iniciar o builder
- Salvos a cada alteração
- Formato JSON

## Próximas etapas

1. **Integração com backend**: Atualmente usa localStorage. Implementar endpoints API para persistência no servidor
2. **Inspeção real de ferramentas**: Atualmente usa mock tools. Implementar integração com endpoints de health check para obter ferramentas reais
3. **Export/Import**: Permitir exportar e importar namespaces como JSON
4. **Validação**: Adicionar validações mais robustas
5. **Histórico de versões**: Rastrear mudanças no namespace
