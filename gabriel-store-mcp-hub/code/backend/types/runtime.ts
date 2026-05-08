export interface McpRuntimeConfig {
  entrypoint?: string
  args?: string[]
  workingDir?: string
  volumes?: string[]
  bindMounts?: string[]
  extraHosts?: string[]
  dns?: string[]
  networkMode?: string
  user?: string
  privileged?: boolean
  devices?: string[]
  shmSize?: number | string
}

export interface BuildContainerOptionsInput {
  name: string
  image: string
  command?: string
  env?: Record<string, string>
  port?: number | string
  transport?: 'http' | 'stdio' | 'streamable-http'
  runtime?: McpRuntimeConfig
  mcpLabel: string
}
