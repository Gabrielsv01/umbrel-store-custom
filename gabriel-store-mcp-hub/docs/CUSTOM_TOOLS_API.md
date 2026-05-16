# Custom Tools API Reference

Endpoints para criar, validar e deployar Custom Tools MCPs via API.

## Overview

O Custom Tools Creator permite criar MCPs customizados diretamente via API. O fluxo é:

1. **Validate** - Valida a definição
2. **Generate** - Gera o código JavaScript (opcional, para preview)
3. **Deploy** - Gera, faz build da imagem Docker e deploya o container

## Endpoints

### POST /api/custom-tools/validate

Valida uma definição de Custom Tool sem fazer nada mais.

**Request:**
```json
{
  "name": "Math Tools",
  "description": "Ferramentas matemáticas customizadas",
  "methods": [
    {
      "name": "add",
      "description": "Soma dois números",
      "parameters": {
        "a": {
          "type": "number",
          "description": "Primeiro número",
          "required": true
        },
        "b": {
          "type": "number",
          "description": "Segundo número",
          "required": true
        }
      },
      "code": "return JSON.stringify({ result: a + b });"
    }
  ]
}
```

**Response (200):**
```json
{
  "valid": true,
  "errors": [],
  "message": "Custom tool definition is valid"
}
```

**Response (400):**
```json
{
  "valid": false,
  "errors": [
    "MCP name is required and must be a non-empty string",
    "Method 0: code is required"
  ]
}
```

---

### POST /api/custom-tools/generate

Gera o código JavaScript e Dockerfile sem fazer build ou deploy.

Útil para preview do código gerado ou para salvar manualmente.

**Request:**
```json
{
  "name": "Math Tools",
  "description": "Ferramentas matemáticas",
  "methods": [
    {
      "name": "multiply",
      "description": "Multiplica dois números",
      "parameters": {
        "a": { "type": "number", "required": true },
        "b": { "type": "number", "required": true }
      },
      "code": "return JSON.stringify({ result: a * b });"
    }
  ]
}
```

**Response (200):**
```json
{
  "success": true,
  "jsCode": "#!/usr/bin/env node\n...",
  "dockerfile": "FROM node:20-alpine\n...",
  "definition": { /* sua definição */ }
}
```

---

### POST /api/custom-tools/deploy

Valida, gera código, faz build da imagem Docker e deploya como um novo MCP.

**Request:**
```json
{
  "name": "Custom Python Tools",
  "description": "Ferramentas Python customizadas",
  "methods": [
    {
      "name": "process_text",
      "description": "Processa um texto",
      "parameters": {
        "text": {
          "type": "string",
          "description": "Texto a processar",
          "required": true
        },
        "operation": {
          "type": "string",
          "description": "Operação a fazer",
          "enum": ["uppercase", "lowercase", "reverse"],
          "required": false
        }
      },
      "code": "const ops = {\n  uppercase: (t) => t.toUpperCase(),\n  lowercase: (t) => t.toLowerCase(),\n  reverse: (t) => t.split('').reverse().join('')\n};\nconst op = operation || 'uppercase';\nreturn JSON.stringify({ result: ops[op](text) });"
    },
    {
      "name": "count_words",
      "description": "Conta palavras em um texto",
      "parameters": {
        "text": {
          "type": "string",
          "description": "Texto",
          "required": true
        }
      },
      "code": "const count = text.trim().split(/\\s+/).length;\nreturn JSON.stringify({ text, word_count: count });"
    }
  ]
}
```

**Response (201 - Success):**
```json
{
  "success": true,
  "containerId": "a1b2c3d4e5f6",
  "containerName": "custom-mcp-custom-python-tools-1234567890",
  "message": "Custom MCP \"Custom Python Tools\" deployed successfully"
}
```

**Response (400 - Validation Error):**
```json
{
  "success": false,
  "message": "Invalid definition",
  "error": "Method 0: code is required; Method 1: parameters must be an object"
}
```

**Response (500 - Deploy Error):**
```json
{
  "success": false,
  "message": "Failed to deploy custom MCP",
  "error": "Docker build failed: ..."
}
```

---

## Data Types

### CustomToolDefinition

```typescript
interface CustomToolDefinition {
  name: string;                    // Nome do MCP (obrigatório)
  description?: string;            // Descrição (opcional)
  methods: CustomToolMethod[];     // Array de métodos (mín. 1)
}
```

### CustomToolMethod

```typescript
interface CustomToolMethod {
  name: string;                              // Nome único da ferramenta
  description: string;                       // Descrição da ferramenta
  parameters: Record<string, CustomToolParameter>;  // Parâmetros
  code: string;                              // Código JavaScript da ferramenta
}
```

### CustomToolParameter

```typescript
interface CustomToolParameter {
  type: 'string' | 'number' | 'boolean' | 'object';
  description: string;
  required?: boolean;                        // Padrão: false
  enum?: string[];                           // Valores permitidos
  default?: any;                             // Valor padrão
}
```

---

## Exemplos Práticos

### Exemplo 1: Ferramentas de Conversão

```bash
curl -X POST http://localhost:5146/api/custom-tools/deploy \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Conversion Tools",
    "description": "Ferramentas de conversão",
    "methods": [
      {
        "name": "celsius_to_fahrenheit",
        "description": "Converte Celsius para Fahrenheit",
        "parameters": {
          "celsius": {
            "type": "number",
            "description": "Temperatura em Celsius",
            "required": true
          }
        },
        "code": "const fahrenheit = (celsius * 9/5) + 32; return JSON.stringify({ celsius, fahrenheit: fahrenheit.toFixed(2) });"
      },
      {
        "name": "kg_to_lbs",
        "description": "Converte quilogramas para libras",
        "parameters": {
          "kg": {
            "type": "number",
            "description": "Peso em kg",
            "required": true
          }
        },
        "code": "const lbs = kg * 2.20462; return JSON.stringify({ kg, lbs: lbs.toFixed(2) });"
      }
    ]
  }'
```

### Exemplo 2: Ferramentas de String

```bash
curl -X POST http://localhost:5146/api/custom-tools/deploy \
  -H "Content-Type: application/json" \
  -d '{
    "name": "String Tools",
    "methods": [
      {
        "name": "reverse_string",
        "description": "Inverte uma string",
        "parameters": {
          "text": {
            "type": "string",
            "required": true
          }
        },
        "code": "return JSON.stringify({ original: text, reversed: text.split(\"\").reverse().join(\"\") });"
      },
      {
        "name": "char_count",
        "description": "Conta caracteres",
        "parameters": {
          "text": {
            "type": "string",
            "required": true
          }
        },
        "code": "return JSON.stringify({ text, length: text.length });"
      }
    ]
  }'
```

---

## Boas Práticas

### 1. Validar Primeiro

Sempre valide antes de deployar:

```bash
# Validar
curl -X POST http://localhost:5146/api/custom-tools/validate \
  -H "Content-Type: application/json" \
  -d '{ "name": "...", "methods": [...] }'

# Se válido, fazer deploy
curl -X POST http://localhost:5146/api/custom-tools/deploy ...
```

### 2. Código Simples e Seguro

O código da ferramenta é JavaScript simples. Boas práticas:

```javascript
// ✅ BOM
"code": "const result = a + b; return JSON.stringify({ result });"

// ✅ BOM - Com validação
"code": "if (divisor === 0) return JSON.stringify({ error: 'Division by zero' }); return JSON.stringify({ result: dividend / divisor });"

// ❌ EVITAR - Muito complexo
"code": "async function fetch() { ... }"

// ❌ EVITAR - Código perigoso
"code": "eval(userInput);"
```

### 3. Parâmetros Claros

Sempre descreva bem os parâmetros:

```json
{
  "name": "calculate_tax",
  "description": "Calcula imposto sobre valor",
  "parameters": {
    "amount": {
      "type": "number",
      "description": "Valor em reais (ex: 100.50)",
      "required": true
    },
    "tax_rate": {
      "type": "number",
      "description": "Taxa de imposto em percentual (ex: 15 para 15%)",
      "required": true
    }
  },
  "code": "const tax = amount * (tax_rate / 100); return JSON.stringify({ amount, tax_rate, tax: tax.toFixed(2) });"
}
```

### 4. Nomes Descritivos

Use nomes que descrevam claramente:

```javascript
// ✅ BOM
"name": "calculate_compound_interest"
"name": "format_phone_number"
"name": "validate_email"

// ❌ EVITAR
"name": "calc"
"name": "format"
"name": "validate"
```

---

## Erro Comum: Nome do MCP

O nome do MCP é importante para identificação:

```json
// ✅ BOM - será identificado como Custom Tools MCP no Builder
{ "name": "Custom Python Tools" }
{ "name": "[Tools] API Integration" }
{ "name": "Math Utilities" }

// ⚠️ Será listado como MCP Server regular (sem badge especial)
{ "name": "Wikipedia" }
{ "name": "Playwright" }
```

---

## Verificando Deployment

Após deployar, o MCP está pronto para usar:

1. **Via API:**
   ```bash
   curl http://localhost:5146/api/mcps
   ```
   Procure pelo `containerName` retornado

2. **No MCP Hub (UI):**
   - Vá para aba "📦 Hub"
   - Procure o MCP na lista
   - Se contém "custom" ou "tools" no nome, será marcado como 🛠️ Custom Tools MCP

3. **No Inspector:**
   - Vá para "🔍 Inspector"
   - Selecione seu MCP
   - Teste as ferramentas

4. **No Builder:**
   - Vá para "🔧 Builder"
   - Crie um namespace
   - Seu Custom Tools MCP aparecerá na seção 🛠️ Custom Tools MCPs

---

## Troubleshooting

**P: "Docker build failed"**
R: Verifique o código JavaScript - pode ter sintaxe inválida. Use /api/custom-tools/generate para ver o código gerado.

**P: "Failed to deploy custom MCP"**
R: Verifique:
1. Espaço em disco para Docker images
2. Docker daemon está rodando
3. Permissões de /var/run/docker.sock

**P: MCP aparece mas ferramentas retornam vazio**
R: Possível problema no código da ferramenta. Teste via Inspector.

**P: Posso usar dependências npm?**
R: Atualmente não. O MCP é baseado em Node.js puro. Para dependências, use o template manual e customize o Dockerfile.
