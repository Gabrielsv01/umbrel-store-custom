export interface StdioContainer {
  attach: (options: {
    stream: boolean
    stdin: boolean
    stdout: boolean
    stderr: boolean
    logs: boolean
    hijack: boolean
  }) => Promise<NodeJS.ReadWriteStream>
  inspect: () => Promise<{ 
    State?: { 
      Running?: boolean;
      StartedAt?: string;
    };
    Config?: {
      Env?: string[];
    };
  } | null>
  stop: () => Promise<unknown>
}

export interface ResolvedStdioContainer {
  container: StdioContainer
  shortId: string
}

export interface StdioWsMessage {
  type?: 'input'
  data?: string
}

export interface StdioProxyMessageQuery {
  sessionId?: string
}

export interface StdioHealthQuery {
  probe?: 'network'
}

export interface StdioProxySession {
  sessionId: string
  container: StdioContainer
  stream: NodeJS.ReadWriteStream
  closed: boolean
}

export interface RegisterStdioRoutesDeps {
  resolveStdioContainer: (idPrefix: string) => Promise<ResolvedStdioContainer>
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
