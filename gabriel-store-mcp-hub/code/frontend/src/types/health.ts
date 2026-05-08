export interface StdioNetworkProbe {
  attempted?: boolean
  ok?: boolean
  toolName?: string
  reason?: string
  error?: string
}

export interface StdioHandshake {
  initializeOk?: boolean
  toolsListOk?: boolean
  toolCount?: number
}

export interface StdioDiagnostics {
  issues?: string[]
}

export interface StdioHealthState {
  status: string
  networkProbe?: StdioNetworkProbe
  handshake?: StdioHandshake
  diagnostics?: StdioDiagnostics
}
