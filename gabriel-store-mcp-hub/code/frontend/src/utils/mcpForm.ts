import type { EditMcpValues, McpContainer } from '../types/mcp'

export function mapMcpToEditValues(mcp: McpContainer): EditMcpValues {
  return {
    id: mcp.id,
    name: mcp.meta?.name || mcp.name,
    image: mcp.meta?.image || mcp.image,
    transport: mcp.meta?.transport || 'http',
    command: mcp.meta?.command || '',
    port:
      typeof mcp.meta?.port === 'number'
        ? mcp.meta.port
        : typeof mcp.ports?.[0] === 'number'
          ? mcp.ports[0]
          : undefined,
    env: mcp.meta?.env || {},
    secretKeys: mcp.meta?.secretKeys,
    runtime: mcp.meta?.runtime || {},
  }
}
