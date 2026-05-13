#!/usr/bin/env node
/**
 * MCP STDIO Server - handles MCP protocol via stdin/stdout
 * Runs inside custom namespace containers for CLI/script integration
 */

const readline = require('readline');

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

console.error(`[MCP STDIO] Started - Namespace: ${NAMESPACE_ID}`);
console.error(`[MCP STDIO] Enabled MCPs: ${enabledMcpsList.map((m) => m.name).join(', ')}`);
console.error(`[MCP STDIO] Disabled tools: ${Array.from(disabledToolsSet).join(', ')}`);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

let requestId = 0;

rl.on('line', async (line) => {
  try {
    const payload = JSON.parse(line);
    const response = await handleMcpRequest(payload);
    process.stdout.write(JSON.stringify(response) + '\n');
  } catch (error) {
    console.error('[MCP STDIO] Error:', error.message);
    const response = {
      jsonrpc: '2.0',
      id: requestId,
      error: {
        code: -32603,
        message: error.message,
      },
    };
    process.stdout.write(JSON.stringify(response) + '\n');
  }
});

rl.on('close', () => {
  console.error('[MCP STDIO] Connection closed');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.error('[MCP STDIO] Received SIGTERM, shutting down');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.error('[MCP STDIO] Received SIGINT, shutting down');
  process.exit(0);
});

async function handleMcpRequest(payload) {
  const { jsonrpc = '2.0', id, method, params } = payload;
  requestId = id;

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
            name: `MCP STDIO Namespace [${NAMESPACE_ID}]`,
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
