import type { McpRuntimeConfig } from './runtime.js'

export type McpTransport = 'http' | 'stdio' | 'streamable-http'

export interface McpMeta {
  name: string
  image: string
  command?: string
  platform?: string
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
  containerName?: string
  customToolDefinition?: Record<string, unknown>
  httpHeaders?: Record<string, string>
}

export interface McpRecord {
  [shortId: string]: McpMeta
}

export interface DeployBody {
  name: string
  image: string
  command?: string
  platform?: string
  env?: Record<string, string>
  secretKeys?: string[]
  port?: number | string
  transport?: McpTransport
  runtime?: McpRuntimeConfig
  httpHeaders?: Record<string, string>
}

export interface UpdateBody {
  name: string
  image: string
  command?: string
  platform?: string
  env?: Record<string, string>
  secretKeys?: string[]
  port?: number | string
  transport?: McpTransport
  runtime?: McpRuntimeConfig
  httpHeaders?: Record<string, string>
}

export interface ActionBody {
  action: 'start' | 'stop' | 'remove'
}
