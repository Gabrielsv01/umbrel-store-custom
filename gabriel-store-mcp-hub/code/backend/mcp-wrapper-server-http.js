#!/usr/bin/env node
/**
 * MCP HTTP Server - handles MCP protocol via HTTP
 * Runs inside custom namespace containers and routes to real HTTP MCPs
 */

const http = require('node:http');

const PORT = process.env.PORT || 8000;
const ENABLED_MCPS = process.env.ENABLED_MCPS || '';
const MCP_CONFIGS_STR = process.env.MCP_CONFIGS || '[]';
const DISABLED_TOOLS = process.env.DISABLED_TOOLS || '';
const NAMESPACE_ID = process.env.NAMESPACE_ID || 'unknown';
const BACKEND_HOST = process.env.BACKEND_HOST || 'localhost:3001';

// Parse MCP configurations from environment
let enabledMcpsList = [];
try {
  const mcpConfigsFromEnv = JSON.parse(MCP_CONFIGS_STR);
  enabledMcpsList = mcpConfigsFromEnv.map((config) => {
    if (config.transport === 'stdio') {
      if (typeof config.command === 'string' && config.command) {
        const parts = config.command.split(' ');
        config.command = parts[0];
        config.args = parts.slice(1);
      } else if (!config.command) {
        config.command = 'npx';
        config.args = ['-y', config.name];
      }
    }
    return config;
  });
} catch (err) {
  console.error('[MCP HTTP] Failed to parse MCP_CONFIGS:', err.message);
  enabledMcpsList = ENABLED_MCPS
    .split(';')
    .filter(Boolean)
    .map((entry) => {
      const [id, name, image] = entry.split(':');
      return { id, name, image, transport: 'http', port: 8000, containerName: name };
    });
}

const disabledToolsSet = new Set(
  DISABLED_TOOLS.split(',').filter(Boolean)
);

console.log(`[MCP HTTP] Starting server on port ${PORT}`);
console.log(`[MCP HTTP] Namespace ID: ${NAMESPACE_ID}`);
console.log(`[MCP HTTP] Enabled MCPs: ${enabledMcpsList.map((m) => `${m.name} (${m.transport})`).join(', ')}`);
console.log(`[MCP HTTP] Disabled tools: ${Array.from(disabledToolsSet).join(', ')}`);

async function fetchRealToolsFromBackend() {
  return new Promise((resolve) => {
    const url = `http://${BACKEND_HOST}/api/namespaces/${NAMESPACE_ID}/tools`;
    console.log(`[MCP HTTP] Fetching tools from ${url}`);

    const req = http.get(
      url,
      { timeout: 5000 },
      (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            const tools = parsed.tools || [];
            console.log(`[MCP HTTP] Received ${tools.length} tools from backend`);
            resolve(tools);
          } catch (err) {
            console.log(`[MCP HTTP] Failed to parse backend response:`, err.message);
            resolve([]);
          }
        });
      }
    );

    req.on('error', (err) => {
      console.log(`[MCP HTTP] Backend request failed:`, err.message);
      resolve([]);
    });
    req.on('timeout', () => {
      console.log('[MCP HTTP] Backend request timed out');
      req.destroy();
      resolve([]);
    });
  });
}

async function callHttpMcp(mcp, toolName, arguments_, id, requestHeaders = {}) {
  const host = mcp.containerName || 'localhost';
  const url = `http://${host}:${mcp.port}/mcp`;
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: {
      name: toolName,
      arguments: arguments_,
    },
  });

  console.log(`[MCP HTTP] Calling HTTP MCP "${mcp.name}" at ${host}:${mcp.port} (containerName: ${mcp.containerName}, id: ${mcp.id})`);

  return new Promise((resolve, reject) => {
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    };

    // 1. Add metadata headers (default values)
    if (mcp.httpHeaders && typeof mcp.httpHeaders === 'object') {
      Object.assign(headers, mcp.httpHeaders);
    }

    // 2. Merge headers from the original request (but exclude technical headers)
    const technicalHeaders = new Set([
      'host',
      'connection',
      'transfer-encoding',
      'user-agent',
      'accept-encoding',
      'accept',
    ]);

    for (const [key, value] of Object.entries(requestHeaders)) {
      if (!technicalHeaders.has(key.toLowerCase())) {
        headers[key] = value;
      }
    }

    const req = http.request(url, {
      method: 'POST',
      headers,
      timeout: 30000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          console.log(`[MCP HTTP] Got response from HTTP MCP ${mcp.name} via ${host}:${mcp.port}`);
          resolve(response);
        } catch (err) {
          reject(new Error(`Failed to parse response from ${mcp.name}`));
        }
      });
    });

    req.on('error', (err) => {
      const errMsg = `${err.code || 'UNKNOWN'}: ${err.message}`;
      console.log(`[MCP HTTP] HTTP error for ${mcp.name}: ${errMsg}`);
      reject(new Error(`HTTP request to ${mcp.name} via ${host}:${mcp.port} failed: ${errMsg}`));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`HTTP request to ${mcp.name} via ${host}:${mcp.port} timed out after 30s`));
    });

    req.write(body);
    req.end();
  });
}

async function callBackendStdioMcp(mcp, toolName, arguments_, id) {
  const url = `http://${BACKEND_HOST}/api/mcp/inspect/${mcp.id}`;
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: {
      name: toolName,
      arguments: arguments_,
    },
  });

  return new Promise((resolve, reject) => {
    const req = http.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 30000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          console.log(`[MCP HTTP] Got response from stdio MCP ${mcp.name} via backend`);
          resolve(response);
        } catch (err) {
          reject(new Error(`Failed to parse response from ${mcp.name}`));
        }
      });
    });

    req.on('error', (err) => {
      reject(new Error(`Backend request to ${mcp.name} failed: ${err.message}`));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Backend request to ${mcp.name} timed out`));
    });

    req.write(body);
    req.end();
  });
}

async function forwardToolCallToMcp(toolName, arguments_, id, requestHeaders = {}) {
  console.log(`[MCP HTTP] Forwarding tool call: ${toolName}`);

  for (const mcp of enabledMcpsList) {
    console.log(`[MCP HTTP] Trying MCP: ${mcp.name} (${mcp.transport})`);

    try {
      let response;
      if (mcp.transport === 'stdio') {
        response = await callBackendStdioMcp(mcp, toolName, arguments_, id);
      } else {
        response = await callHttpMcp(mcp, toolName, arguments_, id, requestHeaders);
      }

      if (response.result?.content?.[0]?.text?.includes('not found')) {
        console.log(`[MCP HTTP] Tool not found in ${mcp.name}, trying next MCP`);
        continue;
      }

      if (response.error) {
        console.log(`[MCP HTTP] Error from ${mcp.name}: ${response.error.message}`);
        continue;
      }

      return response;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.log(`[MCP HTTP] MCP ${mcp.name} failed: ${errMsg}`);
    }
  }

  return {
    jsonrpc: '2.0',
    error: {
      code: -32603,
      message: `Tool "${toolName}" not found in any enabled MCP`,
    },
  };
}

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
        const response = await handleMcpRequest(payload, req.headers);
        // Notifications return null — respond with 204 No Content (no body)
        if (response === null) {
          res.writeHead(204);
          res.end();
        } else {
          res.writeHead(200);
          res.end(JSON.stringify(response));
        }
      } catch (error) {
        console.error('[MCP HTTP] Error:', error.message);
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

async function handleMcpRequest(payload, requestHeaders = {}) {
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
            name: `MCP HTTP Namespace [${NAMESPACE_ID}]`,
            version: '1.0.0',
          },
        },
      };

    case 'tools/list': {
      const tools = await fetchRealToolsFromBackend();
      return {
        jsonrpc,
        id,
        result: {
          tools,
        },
      };
    }

    case 'tools/call': {
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

      const mcpResponse = await forwardToolCallToMcp(toolName, params?.arguments || {}, id, requestHeaders);
      return {
        jsonrpc,
        id,
        ...mcpResponse,
      };
    }

    case 'resources/list':
      return {
        jsonrpc,
        id,
        result: {
          resources: [],
        },
      };

    case 'ping':
      console.log('[MCP HTTP] ping received — responding ok');
      return {
        jsonrpc,
        id,
        result: {},
      };

    case 'prompts/list':
      return {
        jsonrpc,
        id,
        result: {
          prompts: [],
        },
      };

    case 'prompts/get':
      console.log(`[MCP HTTP] prompts/get called (name: ${params?.name}) — no prompts implemented`);
      return {
        jsonrpc,
        id,
        error: { code: -32602, message: 'Prompt not found' },
      };

    case 'resources/read':
      console.log(`[MCP HTTP] resources/read called (uri: ${params?.uri}) — no resources implemented`);
      return {
        jsonrpc,
        id,
        error: { code: -32602, message: 'Resource not found' },
      };

    case 'logging/setLevel':
      console.log(`[MCP HTTP] logging/setLevel called (level: ${params?.level}) — not implemented, ignoring`);
      return {
        jsonrpc,
        id,
        result: {},
      };

    case 'completion/complete':
      console.log('[MCP HTTP] completion/complete called — not implemented, returning empty');
      return {
        jsonrpc,
        id,
        result: { completion: { values: [], hasMore: false } },
      };

    // Notifications: no id, must not send a response
    case 'notifications/initialized':
      console.log('[MCP HTTP] notifications/initialized received — client ready');
      return null;

    case 'notifications/cancelled':
      console.log(`[MCP HTTP] notifications/cancelled received (id: ${params?.requestId}, reason: ${params?.reason})`);
      return null;

    default:
      if (id === undefined || id === null) {
        console.log(`[MCP HTTP] Unknown notification received: ${method} — ignoring`);
        return null;
      }
      console.log(`[MCP HTTP] Unknown method called: ${method}`);
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

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[MCP HTTP] Server listening on port ${PORT}`);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('[MCP HTTP] Received SIGTERM, shutting down gracefully');
  server.close(() => {
    console.log('[MCP HTTP] Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('[MCP HTTP] Received SIGINT, shutting down gracefully');
  server.close(() => {
    console.log('[MCP HTTP] Server closed');
    process.exit(0);
  });
});
