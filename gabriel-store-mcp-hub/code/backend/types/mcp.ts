import type { McpRuntimeConfig } from './runtime.js'

export type McpTransport = 'http' | 'stdio' | 'streamable-http'

export interface McpMeta {
  name: string
  image: string
  command?: string
  env?: Record<string, string>
  secretKeys?: string[]
  port?: number | string
  transport?: McpTransport
  runtime?: McpRuntimeConfig
  disabledTools?: string[]
  sharedVolumeFolder?: string
  isCustomNamespace?: boolean
  namespaceId?: string
  enabledMcps?: string[]
  isCustomToolsMcp?: boolean
  customToolDefinition?: Record<string, unknown>
}

export interface McpRecord {
  [shortId: string]: McpMeta
}

export interface DeployBody {
  name: string
  image: string
  command?: string
  env?: Record<string, string>
  secretKeys?: string[]
  port?: number | string
  transport?: McpTransport
  runtime?: McpRuntimeConfig
}

export interface UpdateBody {
  name: string
  image: string
  command?: string
  env?: Record<string, string>
  secretKeys?: string[]
  port?: number | string
  transport?: McpTransport
  runtime?: McpRuntimeConfig
}

export interface ActionBody {
  action: 'start' | 'stop' | 'remove'
}
