#!/usr/bin/env node
/**
 * MCP Streamable HTTP Server - handles MCP protocol via HTTP with streaming support
 * Runs inside custom namespace containers
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

console.log(`[MCP Streamable HTTP] Starting server on port ${PORT}`);
console.log(`[MCP Streamable HTTP] Namespace ID: ${NAMESPACE_ID}`);
console.log(`[MCP Streamable HTTP] Enabled MCPs: ${enabledMcpsList.map((m) => m.name).join(', ')}`);
console.log(`[MCP Streamable HTTP] Disabled tools: ${Array.from(disabledToolsSet).join(', ')}`);

const server = http.createServer(async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Transfer-Encoding');
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

        // Check if client wants streaming response
        const wantsStream = req.headers['accept-encoding']?.includes('stream');

        if (wantsStream && payload.method === 'tools/call') {
          // For streaming responses, use chunked transfer encoding
          res.setHeader('Transfer-Encoding', 'chunked');
          res.writeHead(200);

          // Simulate streaming response - in real implementation would stream tool output
          const response = await handleMcpRequest(payload);
          res.write(JSON.stringify(response) + '\n');
          res.end();
        } else {
          // Regular non-streaming response
          const response = await handleMcpRequest(payload);
          res.writeHead(200);
          res.end(JSON.stringify(response));
        }
      } catch (error) {
        console.error('[MCP Streamable HTTP] Error:', error.message);
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
            name: `MCP Streamable HTTP Namespace [${NAMESPACE_ID}]`,
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
  console.log(`[MCP Streamable HTTP] Server listening on port ${PORT}`);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('[MCP Streamable HTTP] Received SIGTERM, shutting down gracefully');
  server.close(() => {
    console.log('[MCP Streamable HTTP] Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('[MCP Streamable HTTP] Received SIGINT, shutting down gracefully');
  server.close(() => {
    console.log('[MCP Streamable HTTP] Server closed');
    process.exit(0);
  });
});
