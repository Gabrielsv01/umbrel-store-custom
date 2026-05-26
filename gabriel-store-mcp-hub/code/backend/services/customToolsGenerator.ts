/**
 * Service para gerar MCPs customizados dinamicamente
 * Cria um arquivo .js pronto para ser executado em um container
 */

export interface CustomToolParameter {
  type: 'string' | 'number' | 'boolean' | 'object';
  description: string;
  required?: boolean;
  enum?: string[];
  default?: any;
}

export interface CustomToolMethod {
  name: string;
  description: string;
  parameters: Record<string, CustomToolParameter>;
  code: string; // JavaScript code for the tool implementation
}

export interface SharedVolumeAccess {
  folder: string;
  canRead: boolean;
  canWrite: boolean;
  canDelete: boolean;
}

export interface DockerContainerCliCommand {
  toolName: string;
  command: string;
  description: string;
}

export interface DockerContainerToolsAccess {
  containerName: string;
  commands: DockerContainerCliCommand[];
}

export interface CustomToolDefinition {
  name: string;
  description?: string;
  methods: CustomToolMethod[];
  port?: number;
  sharedVolumeAccess?: SharedVolumeAccess[];
  dockerContainerTools?: DockerContainerToolsAccess;
}

/**
 * Validates a custom tool definition
 */
export function validateCustomToolDefinition(def: CustomToolDefinition): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!def.name || typeof def.name !== 'string' || def.name.trim().length === 0) {
    errors.push('MCP name is required and must be a non-empty string');
  }

  const hasCustomMethods = Array.isArray(def.methods) && def.methods.length > 0;
  const hasSharedVolumeMethods = Array.isArray(def.sharedVolumeAccess) && def.sharedVolumeAccess.length > 0;
  const hasDockerContainerTools = def.dockerContainerTools && def.dockerContainerTools.commands.length > 0;

  if (!hasCustomMethods && !hasSharedVolumeMethods && !hasDockerContainerTools) {
    errors.push('At least one custom method, shared volume access, or docker container tool is required');
  }

  def.methods?.forEach((method, idx) => {
    if (!method.name || typeof method.name !== 'string') {
      errors.push(`Method ${idx}: name is required and must be a string`);
    }

    if (!method.description || typeof method.description !== 'string') {
      errors.push(`Method ${idx} (${method.name}): description is required`);
    }

    if (!method.code || typeof method.code !== 'string') {
      errors.push(`Method ${idx} (${method.name}): code is required`);
    }

    if (!method.parameters || typeof method.parameters !== 'object') {
      errors.push(`Method ${idx} (${method.name}): parameters must be an object`);
    }
  });

  if (def.port !== undefined) {
    if (typeof def.port !== 'number' || !Number.isInteger(def.port)) {
      errors.push('Port must be an integer');
    } else if (def.port < 1024 || def.port > 65535) {
      errors.push('Port must be between 1024 and 65535');
    }
  }

  // Validate shared volume access
  if (def.sharedVolumeAccess !== undefined) {
    if (!Array.isArray(def.sharedVolumeAccess)) {
      errors.push('Shared volume access must be an array');
    } else {
      def.sharedVolumeAccess.forEach((access, idx) => {
        if (!access.folder || typeof access.folder !== 'string') {
          errors.push(`Shared volume access ${idx}: folder is required and must be a string`);
        }
        if (typeof access.canRead !== 'boolean') {
          errors.push(`Shared volume access ${idx}: canRead must be a boolean`);
        }
        if (typeof access.canWrite !== 'boolean') {
          errors.push(`Shared volume access ${idx}: canWrite must be a boolean`);
        }
        if (typeof access.canDelete !== 'boolean') {
          errors.push(`Shared volume access ${idx}: canDelete must be a boolean`);
        }
      });
    }
  }

  // Validate docker container tools
  if (def.dockerContainerTools !== undefined) {
    if (typeof def.dockerContainerTools !== 'object') {
      errors.push('Docker container tools must be an object');
    } else {
      if (!def.dockerContainerTools.containerName || typeof def.dockerContainerTools.containerName !== 'string') {
        errors.push('Docker container tools: containerName is required and must be a string');
      }
      if (!Array.isArray(def.dockerContainerTools.commands)) {
        errors.push('Docker container tools: commands must be an array');
      } else {
        def.dockerContainerTools.commands.forEach((cmd, idx) => {
          if (!cmd.toolName || typeof cmd.toolName !== 'string') {
            errors.push(`Docker container tool ${idx}: toolName is required and must be a string`);
          }
          if (!cmd.command || typeof cmd.command !== 'string') {
            errors.push(`Docker container tool ${idx}: command is required and must be a string`);
          }
          if (typeof cmd.description !== 'string') {
            errors.push(`Docker container tool ${idx}: description must be a string`);
          }
        });
      }
    }
  }

  // Validate JavaScript code syntax
  def.methods?.forEach((method, idx) => {
    if (method.code) {
      try {
        // Try to create a function with the code to validate syntax
        // Get parameter names to pass to the function
        const paramNames = Object.keys(method.parameters || {});
        // eslint-disable-next-line no-new-func
        new Function(...paramNames, method.code);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        errors.push(`Method ${idx} (${method.name}): Invalid JavaScript code - ${errorMsg}`);
      }
    }
  });

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Generate shared volume access methods based on permissions
 */
function generateSharedVolumeTools(sharedVolumeAccess?: SharedVolumeAccess[]): CustomToolMethod[] {
  if (!sharedVolumeAccess || sharedVolumeAccess.length === 0) {
    return [];
  }

  const methods: CustomToolMethod[] = [];

  // Import directory from tar stream
  const tarWritableAccess = sharedVolumeAccess.filter(a => a.canWrite);
  if (tarWritableAccess.length > 0) {
    methods.push({
      name: 'import_directory_tar',
      description: 'Import a directory from a tar stream (uncompressed). Send as base64-encoded tar data.',
      parameters: {
        destination_folder: {
          type: 'string',
          description: 'Destination folder in shared volume',
          required: true,
          enum: tarWritableAccess.map(a => a.folder),
        },
        tar_data_base64: {
          type: 'string',
          description: 'Base64-encoded tar stream data',
          required: true,
        },
      },
      code: `const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const writableFolders = ${JSON.stringify(tarWritableAccess.map(a => a.folder))};
if (!writableFolders.includes(destination_folder)) {
  return JSON.stringify({ error: 'Write access denied' });
}
const basePath = '/shared-data';
const destPath = path.join(basePath, destination_folder);
if (!destPath.startsWith(basePath)) {
  return JSON.stringify({ error: 'Path traversal denied' });
}
try {
  fs.mkdirSync(destPath, { recursive: true });
  const tarBuffer = Buffer.from(tar_data_base64, 'base64');
  const tarFile = path.join('/tmp', \`import-\${Date.now()}.tar\`);
  fs.writeFileSync(tarFile, tarBuffer);
  execSync(\`cd \${destPath} && tar -xf \${tarFile}\`);
  fs.unlinkSync(tarFile);
  return JSON.stringify({ success: true, message: 'Directory imported successfully', folder: destination_folder });
} catch (err) {
  return JSON.stringify({ error: err.message });
}`,
    });
  }

  // Export directory to tar stream
  const tarReadableAccess = sharedVolumeAccess.filter(a => a.canRead);
  if (tarReadableAccess.length > 0) {
    methods.push({
      name: 'export_directory_tar',
      description: 'Export a directory as a tar stream (uncompressed). Returns base64-encoded tar data.',
      parameters: {
        source_folder: {
          type: 'string',
          description: 'Source folder in shared volume',
          required: true,
          enum: tarReadableAccess.map(a => a.folder),
        },
      },
      code: `const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const readableFolders = ${JSON.stringify(tarReadableAccess.map(a => a.folder))};
if (!readableFolders.includes(source_folder)) {
  return JSON.stringify({ error: 'Read access denied' });
}
const basePath = '/shared-data';
const srcPath = path.join(basePath, source_folder);
if (!srcPath.startsWith(basePath)) {
  return JSON.stringify({ error: 'Path traversal denied' });
}
try {
  const tarFile = path.join('/tmp', \`export-\${Date.now()}.tar\`);
  execSync(\`cd \${basePath} && tar -cf \${tarFile} \${source_folder}\`);
  const tarBuffer = fs.readFileSync(tarFile);
  const tarData = tarBuffer.toString('base64');
  fs.unlinkSync(tarFile);
  return JSON.stringify({ success: true, tar_data: tarData, folder: source_folder, size: tarBuffer.length });
} catch (err) {
  return JSON.stringify({ error: err.message });
}`,
    });
  }

  // List files method
  methods.push({
    name: 'list_shared_files',
    description: 'List files in allowed shared folders',
    parameters: {
      folder_name: {
        type: 'string',
        description: 'Folder name to list files from',
        required: true,
        enum: sharedVolumeAccess.map(a => a.folder),
      },
    },
    code: `const fs = require('fs');
const path = require('path');
const allowedFolders = ${JSON.stringify(sharedVolumeAccess.map(a => a.folder))};
if (!allowedFolders.includes(folder_name)) {
  return JSON.stringify({ error: 'Access denied to folder: ' + folder_name });
}
const basePath = '/shared-data';
const folderPath = path.join(basePath, folder_name);
try {
  const files = fs.readdirSync(folderPath);
  const fileStats = files.map(file => {
    const filePath = path.join(folderPath, file);
    const stat = fs.statSync(filePath);
    return { name: file, size: stat.size, isDirectory: stat.isDirectory(), modified: stat.mtime };
  });
  return JSON.stringify({ success: true, files: fileStats, folder: folder_name });
} catch (err) {
  return JSON.stringify({ error: err.message });
}`,
  });

  // Read file method
  const readableAccess = sharedVolumeAccess.filter(a => a.canRead);
  if (readableAccess.length > 0) {
    methods.push({
      name: 'read_shared_file',
      description: 'Read a file from allowed shared folders',
      parameters: {
        folder_name: {
          type: 'string',
          description: 'Folder name',
          required: true,
          enum: readableAccess.map(a => a.folder),
        },
        file_name: {
          type: 'string',
          description: 'File name to read',
          required: true,
        },
      },
      code: `const fs = require('fs');
const path = require('path');
const readableFolders = ${JSON.stringify(readableAccess.map(a => a.folder))};
if (!readableFolders.includes(folder_name)) {
  return JSON.stringify({ error: 'Read access denied' });
}
const basePath = '/shared-data';
const filePath = path.join(basePath, folder_name, file_name);
if (!filePath.startsWith(basePath)) {
  return JSON.stringify({ error: 'Path traversal denied' });
}
try {
  const content = fs.readFileSync(filePath, 'utf-8');
  const fileUrl = \`/api/shared-files/\${folder_name}/\${file_name}\`;
  return JSON.stringify({ success: true, content, fileUrl, fileName: file_name, folder: folder_name });
} catch (err) {
  return JSON.stringify({ error: err.message });
}`,
    });

    methods.push({
      name: 'read_shared_file_base64',
      description: 'Read a file as base64 from allowed shared folders',
      parameters: {
        folder_name: {
          type: 'string',
          description: 'Folder name',
          required: true,
          enum: readableAccess.map(a => a.folder),
        },
        file_name: {
          type: 'string',
          description: 'File name to read',
          required: true,
        },
      },
      code: `const fs = require('fs');
const path = require('path');
const readableFolders = ${JSON.stringify(readableAccess.map(a => a.folder))};
if (!readableFolders.includes(folder_name)) {
  return JSON.stringify({ error: 'Read access denied' });
}
const basePath = '/shared-data';
const filePath = path.join(basePath, folder_name, file_name);
if (!filePath.startsWith(basePath)) {
  return JSON.stringify({ error: 'Path traversal denied' });
}
try {
  const content = fs.readFileSync(filePath);
  const base64 = content.toString('base64');
  const fileUrl = \`/api/shared-files/\${folder_name}/\${file_name}\`;
  return JSON.stringify({ success: true, content: base64, fileUrl, fileName: file_name, folder: folder_name });
} catch (err) {
  return JSON.stringify({ error: err.message });
}`,
    });
  }

  // Write file method
  const writableAccess = sharedVolumeAccess.filter(a => a.canWrite);
  if (writableAccess.length > 0) {
    methods.push({
      name: 'write_shared_file',
      description: 'Write a file to allowed shared folders',
      parameters: {
        folder_name: {
          type: 'string',
          description: 'Folder name',
          required: true,
          enum: writableAccess.map(a => a.folder),
        },
        file_name: {
          type: 'string',
          description: 'File name to write',
          required: true,
        },
        content: {
          type: 'string',
          description: 'File content',
          required: true,
        },
      },
      code: `const fs = require('fs');
const path = require('path');
const writableFolders = ${JSON.stringify(writableAccess.map(a => a.folder))};
if (!writableFolders.includes(folder_name)) {
  return JSON.stringify({ error: 'Write access denied' });
}
const basePath = '/shared-data';
const folderPath = path.join(basePath, folder_name);
const filePath = path.join(folderPath, file_name);
if (!filePath.startsWith(basePath)) {
  return JSON.stringify({ error: 'Path traversal denied' });
}
try {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
  return JSON.stringify({ success: true, message: 'File written', fileName: file_name, folder: folder_name });
} catch (err) {
  return JSON.stringify({ error: err.message });
}`,
    });
  }

  // Delete file method
  const deletableAccess = sharedVolumeAccess.filter(a => a.canDelete);
  if (deletableAccess.length > 0) {
    methods.push({
      name: 'delete_shared_file',
      description: 'Delete a file from allowed shared folders',
      parameters: {
        folder_name: {
          type: 'string',
          description: 'Folder name',
          required: true,
          enum: deletableAccess.map(a => a.folder),
        },
        file_name: {
          type: 'string',
          description: 'File name to delete',
          required: true,
        },
      },
      code: `const fs = require('fs');
const path = require('path');
const deletableFolders = ${JSON.stringify(deletableAccess.map(a => a.folder))};
if (!deletableFolders.includes(folder_name)) {
  return JSON.stringify({ error: 'Delete access denied' });
}
const basePath = '/shared-data';
const filePath = path.join(basePath, folder_name, file_name);
if (!filePath.startsWith(basePath)) {
  return JSON.stringify({ error: 'Path traversal denied' });
}
try {
  fs.unlinkSync(filePath);
  return JSON.stringify({ success: true, message: 'File deleted', fileName: file_name, folder: folder_name });
} catch (err) {
  return JSON.stringify({ error: err.message });
}`,
    });
  }


  return methods;
}

/**
 * Generate docker container CLI tools based on configuration
 */
function generateDockerContainerTools(dockerContainerTools?: DockerContainerToolsAccess): CustomToolMethod[] {
  if (!dockerContainerTools || dockerContainerTools.commands.length === 0) {
    return [];
  }

  const methods: CustomToolMethod[] = [];

  dockerContainerTools.commands.forEach((cmd) => {
    methods.push({
      name: cmd.toolName,
      description: cmd.description || `Execute ${cmd.command} in container ${dockerContainerTools.containerName}`,
      parameters: {},
      code: `const { execSync } = require('child_process');
const containerName = '${dockerContainerTools.containerName}';
const baseCommand = '${cmd.command}';
try {
  const output = execSync(\`docker exec \${containerName} sh -c "\${baseCommand}"\`, { encoding: 'utf-8' });
  return JSON.stringify({
    success: true,
    output: output.trim(),
    command: baseCommand,
    container: containerName
  });
} catch (err) {
  return JSON.stringify({
    error: err.message,
    command: baseCommand,
    container: containerName
  });
}`,
    });
  });

  return methods;
}

/**
 * Generates the JavaScript code for the custom MCP
 */
export function generateCustomMcpCode(definition: CustomToolDefinition): string {
  const { name, description = 'Custom MCP', methods: userMethods } = definition;
  const sharedVolumeMethods = generateSharedVolumeTools(definition.sharedVolumeAccess);
  const dockerContainerMethods = generateDockerContainerTools(definition.dockerContainerTools);
  const methods = [...sharedVolumeMethods, ...dockerContainerMethods, ...userMethods];;

  // Build CUSTOM_TOOLS array
  const toolsArray = methods
    .map((method) => {
      const params = Object.entries(method.parameters)
        .map(([paramName, param]) => {
          return `      ${paramName}: {
        type: '${param.type}',
        description: '${escapeString(param.description)}',${param.required ? "\n        required: true," : ""}${param.enum ? `\n        enum: [${param.enum.map((e) => `'${e}'`).join(', ')}],` : ""}${param.default !== undefined ? `\n        default: ${JSON.stringify(param.default)},` : ""}
      }`;
        })
        .join(',\n');

      const requiredParams = Object.entries(method.parameters)
        .filter(([_, p]) => p.required)
        .map(([name]) => `'${name}'`);

      return `  {
    name: '${method.name}',
    description: '${escapeString(method.description)}',
    inputSchema: {
      type: 'object',
      properties: {
${params}
      },
      required: [${requiredParams.join(', ')}],
    },
  }`;
    })
    .join(',\n');

  // Build switch cases for tool execution
  const cases = methods
    .map((method) => {
      const paramDestructure = Object.keys(method.parameters)
        .map((p) => `${p}`)
        .join(', ');

      return `      case '${method.name}': {
        const { ${paramDestructure} } = args;
        ${method.code}
      }`;
    })
    .join('\n\n');

  const code = `#!/usr/bin/env node
/**
 * Custom MCP: ${escapeString(name)}
 *
 * Auto-generated by MCP Hub Custom Tools Creator
 *
 * Methods:
${methods.map((m) => `   * - ${m.name}: ${m.description}`).join('\n')}
 */

const http = require('node:http');

const PORT = process.env.PORT || 8000;

const CUSTOM_TOOLS = [
${toolsArray}
];

console.log(\`[Custom MCP] Starting on port \${PORT}\`);
console.log(\`[Custom MCP] Available tools: \${CUSTOM_TOOLS.map((t) => t.name).join(', ')}\`);

const server = http.createServer(async (req, res) => {
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
        console.error('[Custom MCP] Error:', error.message);
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
            name: '${escapeString(name)}',
            version: '1.0.0',
          },
        },
      };

    case 'tools/list':
      return {
        jsonrpc,
        id,
        result: {
          tools: CUSTOM_TOOLS,
        },
      };

    case 'tools/call': {
      const toolName = params?.name;
      const toolArgs = params?.arguments || {};

      const result = await executeCustomTool(toolName, toolArgs);

      return {
        jsonrpc,
        id,
        result: {
          content: [
            {
              type: 'text',
              text: result,
            },
          ],
        },
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
          message: \`Method not implemented: \${method}\`,
        },
      };
  }
}

async function executeCustomTool(toolName, args) {
  try {
    switch (toolName) {
${cases}

      default:
        return JSON.stringify({
          error: \`Tool "\${toolName}" not found\`,
        });
    }
  } catch (error) {
    return JSON.stringify({
      error: \`Error executing tool: \${error.message}\`,
    });
  }
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(\`[Custom MCP] Server listening on http://0.0.0.0:\${PORT}/mcp\`);
});

process.on('SIGTERM', () => {
  console.log('[Custom MCP] Received SIGTERM, shutting down');
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  console.log('[Custom MCP] Received SIGINT, shutting down');
  server.close(() => process.exit(0));
});
`;

  return code;
}

/**
 * Escapes special characters in strings for JavaScript
 */
function escapeString(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

/**
 * Generates a Dockerfile for the custom MCP
 */
export function generateDockerfile(port: number = 8000): string {
  return `FROM node:20-alpine

WORKDIR /app

COPY server.js .

ENV PORT=${port}
EXPOSE ${port}

RUN apk add --no-cache docker-cli

CMD ["node", "server.js"]
`;
}

/**
 * Full example of generated code
 */
export function generateExampleCustomTool(): CustomToolDefinition {
  return {
    name: 'Example Custom Tools',
    description: 'Example custom tools MCP',
    methods: [
      {
        name: 'greet',
        description: 'Greets a user by name',
        parameters: {
          name: {
            type: 'string',
            description: 'User name',
            required: true,
          },
          style: {
            type: 'string',
            description: 'Greeting style',
            enum: ['formal', 'casual', 'enthusiastic'],
          },
        },
        code: `const greetings = {
          formal: \`Dear \${name}, it's a pleasure to meet you.\`,
          casual: \`Hey \${name}! What's up?\`,
          enthusiastic: \`OMG \${name.toUpperCase()}!!! 🎉\`,
        };
        return greetings[style] || greetings.casual;`,
      },
      {
        name: 'calculate_discount',
        description: 'Calculates discount on a price',
        parameters: {
          original_price: {
            type: 'number',
            description: 'Original price',
            required: true,
          },
          discount_percent: {
            type: 'number',
            description: 'Discount percentage',
            required: true,
          },
        },
        code: `const discount_amount = original_price * (discount_percent / 100);
        const final_price = original_price - discount_amount;
        return JSON.stringify({
          original_price,
          discount_percent,
          discount_amount: discount_amount.toFixed(2),
          final_price: final_price.toFixed(2),
        });`,
      },
    ],
  };
}

/**
 * Example for accessing shared volumes
 */
export function generateSharedVolumeAccessorExample(): CustomToolDefinition {
  return {
    name: 'Shared Volume Accessor',
    description: 'Access files from shared volumes across MCPs',
    methods: [
      {
        name: 'list_shared_files',
        description: 'List files in a shared folder',
        parameters: {
          folder_name: {
            type: 'string',
            description: 'Name of the folder (e.g., "echarts-server")',
            required: true,
          },
        },
        code: `const fs = require('fs');
const path = require('path');
const basePath = '/shared-data';
const folderPath = path.join(basePath, folder_name);
if (!folderPath.startsWith(basePath)) {
  return JSON.stringify({ error: 'Access denied' });
}
try {
  const files = fs.readdirSync(folderPath);
  const fileStats = files.map(file => {
    const filePath = path.join(folderPath, file);
    const stat = fs.statSync(filePath);
    return {
      name: file,
      size: stat.size,
      isDirectory: stat.isDirectory(),
      modified: stat.mtime
    };
  });
  return JSON.stringify({ success: true, files: fileStats, folder: folder_name });
} catch (err) {
  return JSON.stringify({ error: err.message });
}`,
      },
      {
        name: 'read_shared_file',
        description: 'Read a file from shared volume',
        parameters: {
          folder_name: {
            type: 'string',
            description: 'Folder name (e.g., "echarts-server")',
            required: true,
          },
          file_name: {
            type: 'string',
            description: 'Name of the file to read',
            required: true,
          },
        },
        code: `const fs = require('fs');
const path = require('path');
const basePath = '/shared-data';
const folderPath = path.join(basePath, folder_name);
const filePath = path.join(folderPath, file_name);
if (!filePath.startsWith(basePath)) {
  return JSON.stringify({ error: 'Access denied' });
}
try {
  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.stringify({ success: true, content, fileName: file_name });
} catch (err) {
  return JSON.stringify({ error: err.message });
}`,
      },
      {
        name: 'read_shared_file_base64',
        description: 'Read a file from shared volume as base64 (for binary files)',
        parameters: {
          folder_name: {
            type: 'string',
            description: 'Folder name',
            required: true,
          },
          file_name: {
            type: 'string',
            description: 'Name of the file',
            required: true,
          },
        },
        code: `const fs = require('fs');
const path = require('path');
const basePath = '/shared-data';
const folderPath = path.join(basePath, folder_name);
const filePath = path.join(folderPath, file_name);
if (!filePath.startsWith(basePath)) {
  return JSON.stringify({ error: 'Access denied' });
}
try {
  const content = fs.readFileSync(filePath);
  const base64 = content.toString('base64');
  return JSON.stringify({ success: true, content: base64, fileName: file_name });
} catch (err) {
  return JSON.stringify({ error: err.message });
}`,
      },
    ],
  };
}
