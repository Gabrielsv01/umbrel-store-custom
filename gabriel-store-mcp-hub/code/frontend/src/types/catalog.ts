import type { McpTransport } from './mcp'

export interface CatalogEntry {
  id: string
  name: string
  description: string
  category: string
  image: string
  transport: McpTransport
  command?: string
  port?: number
  env?: Record<string, string>
  secretKeys?: string[]
}
