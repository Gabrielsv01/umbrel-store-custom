# Shared Volume Usage Guide

## Overview

The MCP Hub supports shared volumes across containers, allowing MCPs to exchange files. Each MCP can have its own isolated folder within the shared volume.

## Architecture

- **Host Path**: `${APP_DATA_DIR}/.appdata/shared-data/` (created automatically)
- **Container Path**: `/shared-data/` (mounted in all containers)
- **Isolation**: Each MCP gets its own subfolder (e.g., `/shared-data/echarts-server/`)

## How to Use

### 1. Configure an MCP with Shared Volume Access

When deploying an MCP, specify the `sharedVolumeFolder`:

```json
{
  "name": "echarts-server",
  "image": "your-echarts-server:latest",
  "transport": "http",
  "port": 3000,
  "sharedVolumeFolder": "echarts-server"
}
```

The container will have write access to `/shared-data/echarts-server/`

### 2. Create a Custom Tools MCP to Access Files

Use the Custom Tools Creator to build an MCP with tools to read shared files:

**Tool: Read Shared File**
```javascript
// Parameters: folder_name (string), file_name (string)
const fs = require('fs');
const path = require('path');

const basePath = '/shared-data';
const folderPath = path.join(basePath, folder_name);
const filePath = path.join(folderPath, file_name);

// Security: Ensure we don't escape the shared-data directory
if (!filePath.startsWith(basePath)) {
  return JSON.stringify({ error: 'Access denied: path traversal attempt' });
}

try {
  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.stringify({ success: true, content, fileName: file_name });
} catch (err) {
  return JSON.stringify({ error: err.message });
}
```

**Tool: List Shared Files**
```javascript
// Parameters: folder_name (string)
const fs = require('fs');
const path = require('path');

const basePath = '/shared-data';
const folderPath = path.join(basePath, folder_name);

// Security: Ensure we don't escape the shared-data directory
if (!folderPath.startsWith(basePath)) {
  return JSON.stringify({ error: 'Access denied: path traversal attempt' });
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
}
```

**Tool: Read Shared File as Base64**
```javascript
// Parameters: folder_name (string), file_name (string)
const fs = require('fs');
const path = require('path');

const basePath = '/shared-data';
const folderPath = path.join(basePath, folder_name);
const filePath = path.join(folderPath, file_name);

// Security check
if (!filePath.startsWith(basePath)) {
  return JSON.stringify({ error: 'Access denied' });
}

try {
  const content = fs.readFileSync(filePath);
  const base64 = content.toString('base64');
  return JSON.stringify({ 
    success: true, 
    content: base64, 
    fileName: file_name,
    mimeType: 'application/octet-stream'
  });
} catch (err) {
  return JSON.stringify({ error: err.message });
}
```

### 3. Example Workflow

1. Deploy `echarts-server` with `sharedVolumeFolder: "echarts-server"`
2. The server generates charts and saves them to `/shared-data/echarts-server/chart.html`
3. Create a custom MCP called `file-accessor` with the tools above
4. Call `file-accessor`'s `list_shared_files` with `folder_name: "echarts-server"`
5. Call `file-accessor`'s `read_shared_file` to get the chart content
6. Use the content in your application (display HTML, serve via API, etc.)

## Security Considerations

- ✅ **Isolation**: Each MCP can only access its own folder
- ✅ **Path Traversal Protection**: Use `path.join()` and verify paths don't escape `/shared-data/`
- ✅ **Permission Isolation**: MCPs run as root in containers but file paths are restricted

## Docker Volume Details

The shared volume is defined in `docker-compose.yml`:

```yaml
volumes:
  shared-data:
    driver: local

services:
  mcp-hub:
    volumes:
      - shared-data:/shared-data
```

Folders are created automatically when needed. Cleanup requires manual removal if desired.
