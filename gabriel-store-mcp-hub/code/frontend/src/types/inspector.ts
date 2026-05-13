export type McpInspectorTab = 'tools' | 'resources' | 'prompts' | 'ping' | 'roots' | 'sampling'

export interface McpTool {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

export interface McpResource {
  uri: string
  name?: string
  description?: string
  mimeType?: string
}

export interface McpPrompt {
  name: string
  description?: string
  arguments?: McpPromptArg[]
}

export interface McpPromptArg {
  name: string
  description?: string
  required?: boolean
}

export interface JsonRpcPayload {
  jsonrpc: '2.0'
  id?: string | number
  method: string
  params?: unknown
}

export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id?: string | number
  result?: unknown
  error?: { code: number; message: string }
}

export interface ToolsListResponse {
  tools: McpTool[]
}

export interface ResourcesListResponse {
  resources: McpResource[]
}

export interface PromptsListResponse {
  prompts: McpPrompt[]
}
