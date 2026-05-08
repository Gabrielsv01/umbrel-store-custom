import type { StdioContainer } from './stdio.js'

export interface NetworkProbeState {
  attempted: boolean
  ok: boolean | null
  toolName?: string
  reason?: string
  error?: string
}

export interface StdioHealthResult {
  id: string
  ok: boolean
  status: 'healthy' | 'degraded' | 'unhealthy'
  handshake: {
    initializeOk: boolean
    toolsListOk: boolean
    toolCount: number
  }
  networkProbe: NetworkProbeState
  diagnostics: {
    issues: string[]
    stderrTail: string[]
    nonJsonTail: string[]
  }
  checkedAt: string
}

export interface RunStdioHealthCheckInput {
  id: string
  probe?: 'network'
  container: StdioContainer
  createDockerMultiplexDecoder: (
    onPayload: (payload: string, streamType: number) => void,
  ) => (chunk: Buffer) => void
  createLineDecoder: (onLine: (line: string) => void) => (chunk: string) => void
  detectNetworkIssues: (lines: string[]) => string[]
  selectNetworkProbeTool: (tools: unknown[]) => {
    name: string
    arguments: Record<string, unknown>
  } | null
}
