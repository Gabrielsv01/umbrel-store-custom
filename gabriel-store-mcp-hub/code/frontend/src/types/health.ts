export interface StdioNetworkProbe {
  attempted?: boolean;
  ok?: boolean;
  toolName?: string;
  reason?: string;
  error?: string;
}

export interface StdioHandshake {
  initializeOk?: boolean;
  toolsListOk?: boolean;
  toolCount?: number;
}

export interface StdioDiagnostics {
  issues?: string[];
}

export interface StdioHealthState {
  status: string;
  networkProbe?: StdioNetworkProbe;
  handshake?: StdioHandshake;
  diagnostics?: StdioDiagnostics;
}

export interface HttpHealthResult {
  id: string;
  transport: 'http' | 'streamable-http';
  status: 'healthy' | 'unreachable' | 'error';
  latencyMs?: number;
  serverInfo?: unknown;
  error?: string;
  diagnostics?: {
    triedHosts?: string[];
    attemptedEndpoints?: Array<{
      url: string;
      method: string;
      statusCode?: number;
      latencyMs: number;
      ok: boolean;
      error?: string;
    }>;
  };
  checkedAt: string;
}
