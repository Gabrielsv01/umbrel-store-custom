#!/usr/bin/env node
/**
 * Simple MCP Server that aggregates tools from multiple MCP servers
 * This runs inside custom namespace containers
 */

const http = require('http');

const PORT = process.env.PORT || 8000;
const ENABLED_MCPS = process.env.ENABLED_MCPS || '';
const DISABLED_TOOLS = process.env.DISABLED_TOOLS || '';
const NAMESPACE_ID = process.env.NAMESPACE_ID || 'unknown';

// Parse configuration
const enabledMcpsList = ENABLED_MCPS
  .split(';')
  .filter(Boolean)
  .map((entry) => {
    const [id, name, image] = entry.split(':');
    return { id, name, image };
  });

const disabledToolsSet = new Set(
  DISABLED_TOOLS.split(',').filter(Boolean)
);

console.log(`[MCP Wrapper] Starting server on port ${PORT}`);
console.log(`[MCP Wrapper] Namespace ID: ${NAMESPACE_ID}`);
console.log(`[MCP Wrapper] Enabled MCPs: ${enabledMcpsList.map((m) => m.name).join(', ')}`);
console.log(`[MCP Wrapper] Disabled tools: ${Array.from(disabledToolsSet).join(', ')}`);

const server = http.createServer(async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(405);
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  const path = req.url.split('?')[0];

  // Handle MCP protocol endpoints
  if (path === '/mcp' || path === '/') {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        const response = await handleMcpRequest(payload);
        res.writeHead(200);
        res.end(JSON.stringify(response));
      } catch (error) {
        console.error('[MCP Wrapper] Error:', error.message);
        res.writeHead(500);
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: {
              code: -32603,
              message: error.message,
            },
          })
        );
      }
    });
  } else {
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

async function handleMcpRequest(payload) {
  const { jsonrpc = '2.0', id, method, params } = payload;

  // Handle different MCP methods
  switch (method) {
    case 'initialize':
      return {
        jsonrpc,
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: `MCP Namespace Wrapper [${NAMESPACE_ID}]`,
            version: '1.0.0',
          },
        },
      };

    case 'tools/list':
      return {
        jsonrpc,
        id,
        result: {
          tools: getMockTools(),
        },
      };

    case 'tools/call':
      const toolName = params?.name;
      if (disabledToolsSet.has(toolName)) {
        return {
          jsonrpc,
          id,
          error: {
            code: -32603,
            message: `Tool "${toolName}" is disabled`,
          },
        };
      }

      return {
        jsonrpc,
        id,
        result: {
          content: [
            {
              type: 'text',
              text: `Mock response from tool: ${toolName}`,
            },
          ],
        },
      };

    case 'resources/list':
      return {
        jsonrpc,
        id,
        result: {
          resources: [],
        },
      };

    case 'prompts/list':
      return {
        jsonrpc,
        id,
        result: {
          prompts: [],
        },
      };

    default:
      return {
        jsonrpc,
        id,
        error: {
          code: -32601,
          message: `Method not implemented: ${method}`,
        },
      };
  }
}

function getMockTools() {
  const tools = [];

  for (const mcp of enabledMcpsList) {
    // Create 3 mock tools per MCP
    for (let i = 1; i <= 3; i++) {
      const toolId = `${mcp.id}_tool_${i}`;

      if (!disabledToolsSet.has(toolId)) {
        tools.push({
          name: toolId,
          description: `Tool ${i} from ${mcp.name}`,
          inputSchema: {
            type: 'object',
            properties: {
              input: {
                type: 'string',
                description: 'Input parameter',
              },
            },
            required: ['input'],
          },
        });
      }
    }
  }

  return tools;
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[MCP Wrapper] Server listening on port ${PORT}`);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('[MCP Wrapper] Received SIGTERM, shutting down gracefully');
  server.close(() => {
    console.log('[MCP Wrapper] Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('[MCP Wrapper] Received SIGINT, shutting down gracefully');
  server.close(() => {
    console.log('[MCP Wrapper] Server closed');
    process.exit(0);
  });
});
