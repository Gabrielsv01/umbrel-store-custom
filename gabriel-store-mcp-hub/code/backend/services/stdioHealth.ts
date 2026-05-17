import { Readable } from 'node:stream'
import type {
  NetworkProbeState,
  RunStdioHealthCheckInput,
  StdioHealthResult,
} from '../types/stdioHealth.js'

function tryParseRecord(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text) as unknown
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
}

function tryParseRecordFragment(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{')
  if (start === -1) return null

  for (let end = text.length; end > start + 1; end -= 1) {
    const candidate = text.slice(start, end)
    const parsed = tryParseRecord(candidate)
    if (parsed) return parsed
  }

  return null
}

export async function runStdioHealthCheck(
  input: RunStdioHealthCheckInput,
): Promise<StdioHealthResult> {
  const {
    id,
    probe,
    container,
    createDockerMultiplexDecoder,
    createLineDecoder,
    detectNetworkIssues,
    selectNetworkProbeTool,
  } = input

  const stream = await container.attach({
    stream: true,
    stdin: true,
    stdout: true,
    stderr: true,
    logs: false,
    hijack: true,
  })

  const jsonQueue: Array<Record<string, unknown>> = []
  const stderrLines: string[] = []
  const nonJsonStdoutLines: string[] = []

  const stdoutLineDecoder = createLineDecoder((line) => {
    const parsed = tryParseRecord(line) ?? tryParseRecordFragment(line)
    if (parsed) {
      jsonQueue.push(parsed)
      return
    }
    nonJsonStdoutLines.push(line)
  })
  const stderrLineDecoder = createLineDecoder((line) => {
    stderrLines.push(line)
  })

  const decodeChunk = createDockerMultiplexDecoder((payload, streamType) => {
    if (streamType === 2) {
      stderrLineDecoder(payload)
    } else {
      stdoutLineDecoder(payload)
    }
  })

  stream.on('data', (chunk: Buffer) => {
    decodeChunk(chunk)
  })

  const writeRpc = (payload: Record<string, unknown>) => {
    stream.write(`${JSON.stringify(payload)}\n`)
  }

  const waitForMessage = async (
    predicate: (msg: Record<string, unknown>) => boolean,
    timeoutMs: number,
  ): Promise<Record<string, unknown> | null> => {
    const deadline = Date.now() + timeoutMs

    while (Date.now() < deadline) {
      const idx = jsonQueue.findIndex(predicate)
      if (idx >= 0) {
        const [match] = jsonQueue.splice(idx, 1)
        return match ?? null
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }

    return null
  }

  let initializeOk = false
  let toolsListOk = false
  let toolCount = 0

  const networkProbe: NetworkProbeState = {
    attempted: false,
    ok: null,
  }

  try {
    const info = await container.inspect().catch(() => null)
    const state = info?.State
    const uptime = Date.now() - new Date(state?.StartedAt || 0).getTime()
    console.error(`[stdioHealth] container uptime: ${uptime}ms, running: ${state?.Running}`)

    const protocolCandidates = ['2025-03-26', '2024-11-05']
    let selectedProtocol: string | null = null

    for (let i = 0; i < protocolCandidates.length; i += 1) {
      const protocolVersion = protocolCandidates[i]
      const requestId = 1 + i

      writeRpc({
        jsonrpc: '2.0',
        id: requestId,
        method: 'initialize',
        params: {
          protocolVersion,
          capabilities: {},
          clientInfo: { name: 'mcp-hub-health', version: '1.0.0' },
        },
      })

      const initializeResponse = await waitForMessage((msg) => Number(msg.id) === requestId, 5000)
      const ok = !!initializeResponse?.result && !initializeResponse?.error
      if (ok) {
        initializeOk = true
        selectedProtocol = protocolVersion
        break
      }
    }

    if (selectedProtocol) {
      nonJsonStdoutLines.push(`[health] initialize protocol selected: ${selectedProtocol}`)
    } else {
      nonJsonStdoutLines.push('[health] initialize failed for all protocol candidates')
    }

    writeRpc({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })

    let toolsResponse: Record<string, unknown> | null = null
    for (const requestId of [10, 11]) {
      writeRpc({ jsonrpc: '2.0', id: requestId, method: 'tools/list', params: {} })
      toolsResponse = await waitForMessage((msg) => Number(msg.id) === requestId, 5000)
      if (toolsResponse) break
    }

    const toolsResult = (toolsResponse?.result ?? {}) as {
      tools?: unknown[]
    }
    const tools = Array.isArray(toolsResult.tools) ? toolsResult.tools : []
    toolsListOk = !!toolsResponse?.result && !toolsResponse?.error
    toolCount = tools.length

    if (probe === 'network' && toolsListOk) {
      const probeTarget = selectNetworkProbeTool(tools)
      if (probeTarget === null) {
        networkProbe.attempted = false
        networkProbe.ok = null
        networkProbe.reason = 'no suitable network tool found'
      } else {
        networkProbe.attempted = true
        networkProbe.toolName = probeTarget.name

        writeRpc({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: {
            name: probeTarget.name,
            arguments: probeTarget.arguments,
          },
        })

        const probeResponse = await waitForMessage((msg) => Number(msg.id) === 3, 7000)
        const responseText = JSON.stringify(probeResponse ?? {})
        const probeResult = (probeResponse?.result ?? {}) as {
          isError?: boolean
          structuredContent?: {
            status?: string
            error?: string
            error_type?: string
          }
          content?: Array<{
            type?: string
            text?: string
          }>
        }

        let probeFailureText = ''
        if (probeResult.isError === true) {
          probeFailureText = 'tool returned isError=true'
        } else if (probeResult.structuredContent?.status === 'failed') {
          probeFailureText = probeResult.structuredContent.error ?? 'tool returned status=failed'
        } else if (Array.isArray(probeResult.content)) {
          for (const item of probeResult.content) {
            if (item.type !== 'text' || typeof item.text !== 'string') continue
            try {
              const parsed = JSON.parse(item.text) as {
                status?: string
                error?: string
                error_type?: string
              }
              if (parsed.status === 'failed' || parsed.error) {
                probeFailureText = parsed.error ?? 'tool text payload reported failure'
                break
              }
            } catch {
              // ignore plain text payloads
            }
          }
        }

        const responseIssues = detectNetworkIssues([responseText, probeFailureText].filter(Boolean))

        if (!probeResponse) {
          networkProbe.ok = false
          networkProbe.error = 'network probe timed out'
        } else if (probeFailureText || responseIssues.length > 0) {
          networkProbe.ok = false
          networkProbe.error = responseIssues[0] ?? probeFailureText
        } else {
          networkProbe.ok = true
        }
      }
    }
  } finally {
    try {
      ;(stream as unknown as Readable).destroy()
    } catch {
      // ignore stream close errors
    }

    const latest = await container.inspect().catch(() => null)
    if (latest?.State?.Running) {
      await container.stop().catch(() => undefined)
    }
  }

  const combinedIssues = detectNetworkIssues([...stderrLines, ...nonJsonStdoutLines])

  let status: StdioHealthResult['status'] = 'healthy'
  if (toolsListOk === false) {
    status = 'unhealthy'
  } else if (initializeOk === false || combinedIssues.length > 0 || networkProbe.ok === false) {
    status = 'degraded'
  }

  return {
    id,
    ok: status !== 'unhealthy',
    status,
    handshake: {
      initializeOk,
      toolsListOk,
      toolCount,
    },
    networkProbe,
    diagnostics: {
      issues: combinedIssues.slice(-10),
      stderrTail: stderrLines.slice(-10),
      nonJsonTail: nonJsonStdoutLines.slice(-10),
    },
    checkedAt: new Date().toISOString(),
  }
}
