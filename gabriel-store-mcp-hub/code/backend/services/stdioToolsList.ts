import { Readable } from 'node:stream'
import type { RunStdioToolsListInput } from '../types/stdio.js'

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

export async function runStdioToolsList(
  input: RunStdioToolsListInput,
): Promise<{ tools: unknown[] }> {
  const { container, createDockerMultiplexDecoder, createLineDecoder } = input

  const stream = await container.attach({
    stream: true,
    stdin: true,
    stdout: true,
    stderr: true,
    logs: false,
    hijack: true,
  })

  const jsonQueue: Array<Record<string, unknown>> = []

  const stdoutLineDecoder = createLineDecoder((line) => {
    const parsed = tryParseRecord(line) ?? tryParseRecordFragment(line)
    if (parsed) {
      jsonQueue.push(parsed)
    }
  })

  const decodeChunk = createDockerMultiplexDecoder((payload, streamType) => {
    if (streamType === 1) {
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

  try {
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
          clientInfo: { name: 'mcp-hub-tools', version: '1.0.0' },
        },
      })

      const initializeResponse = await waitForMessage((msg) => Number(msg.id) === requestId, 5000)
      const ok = !!initializeResponse?.result && !initializeResponse?.error
      if (ok) {
        selectedProtocol = protocolVersion
        break
      }
    }

    if (!selectedProtocol) {
      throw new Error('Failed to initialize MCP protocol')
    }

    writeRpc({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })

    let toolsResponse: Record<string, unknown> | null = null
    for (const requestId of [10, 11]) {
      writeRpc({ jsonrpc: '2.0', id: requestId, method: 'tools/list', params: {} })
      toolsResponse = await waitForMessage((msg) => Number(msg.id) === requestId, 5000)
      if (toolsResponse) break
    }

    if (!toolsResponse) {
      console.error('[stdioToolsList] No response from tools/list', { queue: jsonQueue })
      throw new Error('tools/list request timed out')
    }

    if (toolsResponse.error) {
      console.error('[stdioToolsList] tools/list returned error', toolsResponse.error)
      throw new Error(`tools/list error: ${JSON.stringify(toolsResponse.error)}`)
    }

    if (!toolsResponse.result) {
      console.error('[stdioToolsList] tools/list response missing result', toolsResponse)
      throw new Error('tools/list response missing result field')
    }

    const toolsResult = toolsResponse.result as {
      tools?: unknown[]
    }

    console.log('[stdioToolsList] toolsResponse:', JSON.stringify(toolsResponse, null, 2))
    console.log('[stdioToolsList] toolsResult:', JSON.stringify(toolsResult, null, 2))
    console.log('[stdioToolsList] tools array:', toolsResult.tools)

    return {
      tools: Array.isArray(toolsResult.tools) ? toolsResult.tools : [],
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
}
