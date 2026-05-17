#!/usr/bin/env node
/**
 * MCP STDIO Server - handles MCP protocol via stdin/stdout
 * Runs inside custom namespace containers and routes to real MCPs
 */

const readline = require('readline');
const http = require('node:http');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ENABLED_MCPS = process.env.ENABLED_MCPS || '';
const MCP_CONFIGS_STR = process.env.MCP_CONFIGS || '[]';
const DISABLED_TOOLS = process.env.DISABLED_TOOLS || '';
const NAMESPACE_ID = process.env.NAMESPACE_ID || 'unknown';
const BACKEND_HOST = process.env.BACKEND_HOST || 'localhost:51099';

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
  console.error('[MCP STDIO] Failed to parse MCP_CONFIGS:', err.message);
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

console.error(`[MCP STDIO] Started - Namespace: ${NAMESPACE_ID}`);
console.error(`[MCP STDIO] Enabled MCPs: ${enabledMcpsList.map((m) => `${m.name} (${m.transport})`).join(', ')}`);
console.error(`[MCP STDIO] Disabled tools: ${Array.from(disabledToolsSet).join(', ')}`);

const stdioMcpProcesses = new Map();
let messageIdCounter = 1;

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

async function fetchRealToolsFromBackend() {
  return new Promise((resolve) => {
    const url = `http://${BACKEND_HOST}/api/namespaces/${NAMESPACE_ID}/tools`;
    console.error(`[MCP STDIO] Fetching tools from ${url}`);

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
            console.error(`[MCP STDIO] Received ${tools.length} tools from backend`);
            resolve(tools);
          } catch (err) {
            console.error(`[MCP STDIO] Failed to parse backend response:`, err.message);
            resolve([]);
          }
        });
      }
    );

    req.on('error', (err) => {
      console.error(`[MCP STDIO] Backend request failed:`, err.message);
      resolve([]);
    });
    req.on('timeout', () => {
      console.error('[MCP STDIO] Backend request timed out');
      req.destroy();
      resolve([]);
    });
  });
}

async function getOrSpawnStdioMcp(mcp) {
  if (stdioMcpProcesses.has(mcp.id)) {
    return stdioMcpProcesses.get(mcp.id);
  }

  console.error(`[MCP STDIO] Spawning stdio MCP ${mcp.name}`);

  const spawnOpts = {
    stdio: ['pipe', 'pipe', 'pipe'],
  };

  if (mcp.workingDir) {
    spawnOpts.cwd = mcp.workingDir;
    try {
      fs.mkdirSync(mcp.workingDir, { recursive: true });
      console.error(`[MCP STDIO] Created working directory: ${mcp.workingDir}`);
    } catch (err) {
      console.error(`[MCP STDIO] Failed to create working directory ${mcp.workingDir}:`, err.message);
    }
  }

  const child = spawn(mcp.command || 'npx', mcp.args || ['-y', mcp.name], spawnOpts);
  const process = {
    child,
    queue: [],
    isReady: false,
    pending: new Map(),
  };

  let buffer = '';
  child.stdout.on('data', (data) => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const response = JSON.parse(line);
        if (response.id && process.pending.has(response.id)) {
          const callback = process.pending.get(response.id);
          process.pending.delete(response.id);
          callback(response);
        }
      } catch (err) {
        console.error(`[MCP STDIO] Failed to parse stdio response:`, err.message);
      }
    }
  });

  child.stderr.on('data', (data) => {
    console.error(`[MCP STDIO] stderr from ${mcp.name}:`, data.toString());
  });

  child.on('error', (err) => {
    console.error(`[MCP STDIO] stdio MCP ${mcp.name} error:`, err.message);
    stdioMcpProcesses.delete(mcp.id);
  });

  stdioMcpProcesses.set(mcp.id, process);

  const initId = messageIdCounter++;
  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      console.warn(`[MCP STDIO] Initialize timeout for ${mcp.name}`);
      resolve();
    }, 5000);

    process.pending.set(initId, (response) => {
      clearTimeout(timeout);
      if (response.result) {
        console.error(`[MCP STDIO] Initialized ${mcp.name} successfully`);
        process.isReady = true;
      } else {
        console.warn(`[MCP STDIO] Initialize response error:`, response.error);
        process.isReady = true;
      }
      resolve();
    });

    const initRequest = {
      jsonrpc: '2.0',
      id: initId,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
          name: 'MCP STDIO Namespace',
          version: '1.0.0',
        },
      },
    };

    process.child.stdin.write(JSON.stringify(initRequest) + '\n');
  });

  return process;
}

async function callStdioMcp(mcp, toolName, arguments_) {
  const process = await getOrSpawnStdioMcp(mcp);
  const id = messageIdCounter++;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      process.pending.delete(id);
      reject(new Error(`stdio MCP ${mcp.name} timed out`));
    }, 120000);

    process.pending.set(id, (response) => {
      clearTimeout(timeout);
      resolve(response);
    });

    const request = {
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: arguments_,
      },
    };

    process.child.stdin.write(JSON.stringify(request) + '\n');
  });
}

async function callHttpMcp(mcp, toolName, arguments_) {
  const host = mcp.containerName || 'localhost';
  const url = `http://${host}:${mcp.port}/mcp`;
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
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
          console.error(`[MCP STDIO] Got response from HTTP MCP ${mcp.name}`);
          resolve(response);
        } catch (err) {
          reject(new Error(`Failed to parse response from ${mcp.name}`));
        }
      });
    });

    req.on('error', (err) => {
      reject(new Error(`HTTP request to ${mcp.name} failed: ${err.message}`));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`HTTP request to ${mcp.name} timed out`));
    });

    req.write(body);
    req.end();
  });
}

async function forwardToolCallToMcp(toolName, arguments_) {
  console.error(`[MCP STDIO] Forwarding tool call: ${toolName}`);

  for (const mcp of enabledMcpsList) {
    console.error(`[MCP STDIO] Trying MCP: ${mcp.name} (${mcp.transport})`);

    try {
      let response;
      if (mcp.transport === 'stdio') {
        response = await callStdioMcp(mcp, toolName, arguments_);
      } else {
        response = await callHttpMcp(mcp, toolName, arguments_);
      }

      if (response.result?.content?.[0]?.text?.includes('not found')) {
        console.error(`[MCP STDIO] Tool not found in ${mcp.name}, trying next MCP`);
        continue;
      }

      if (response.error) {
        console.error(`[MCP STDIO] Error from ${mcp.name}: ${response.error.message}`);
        continue;
      }

      return response;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[MCP STDIO] MCP ${mcp.name} failed: ${errMsg}`);
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

      const mcpResponse = await forwardToolCallToMcp(toolName, params?.arguments || {});
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

