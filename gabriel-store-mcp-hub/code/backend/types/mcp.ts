import type { McpRuntimeConfig } from './runtime.js'

export interface McpMeta {
  name: string
  image: string
  command?: string
  env?: Record<string, string>
  port?: number | string
  transport?: 'http' | 'stdio'
  runtime?: McpRuntimeConfig
}

export interface McpRecord {
  [shortId: string]: McpMeta
}

export interface DeployBody {
  name: string
  image: string
  command?: string
  env?: Record<string, string>
  port?: number | string
  transport?: 'http' | 'stdio'
  runtime?: McpRuntimeConfig
}

export interface UpdateBody {
  name: string
  image: string
  command?: string
  env?: Record<string, string>
  port?: number | string
  transport?: 'http' | 'stdio'
  runtime?: McpRuntimeConfig
}

export interface ActionBody {
  action: 'start' | 'stop' | 'remove'
}
