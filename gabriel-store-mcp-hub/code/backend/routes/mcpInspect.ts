import type { FastifyInstance } from 'fastify'
import type { Readable } from 'node:stream'
import type { RegisterStdioRoutesDeps } from '../types/stdio.js'
import type Docker from 'dockerode'
import type { McpRecord } from '../types/mcp.js'
import {
  fetchWithTimeout,
  getContainerHosts,
  tryParseJson,
  tryParseSseData,
  tryParseJsonFragment,
} from '../utils/httpUtils.js'

export interface RegisterMcpInspectDeps extends RegisterStdioRoutesDeps {
  docker: Docker
  loadData: () => McpRecord
  mcpLabel: string
}

interface JsonRpcPayload {
  jsonrpc: '2.0'
  id?: string | number
  method: string
  params?: unknown
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id?: string | number
  result?: unknown
  error?: { code: number; message: string }
}

export function registerMcpInspectRoutes(
  fastify: FastifyInstance,
  deps: RegisterMcpInspectDeps,
): void {
  const {
    docker,
    loadData,
    mcpLabel,
    resolveStdioContainer,
    createDockerMultiplexDecoder,
  } = deps

  fastify.post<{
    Params: { id: string }
    Body: JsonRpcPayload
  }>('/api/mcp/inspect/:id', async (req, reply) => {
    const { id } = req.params
    const payload = req.body

    try {
      // Resolve container and get metadata
      const all = await docker.listContainers({
        all: true,
        filters: JSON.stringify({ label: [`${mcpLabel}=true`] }),
      })
      const match = all.find((c) => c.Id.startsWith(id))
      if (!match) {
        return reply.code(404).send({ error: 'container not found' })
      }

      const shortId = match.Id.slice(0, 12)
      const meta = loadData()[shortId]
      const transport = meta?.transport ?? 'http'

      // Check if trying to call a disabled tool
      if (payload.method === 'tools/call') {
        const toolName = (payload.params as any)?.name
        const disabledTools = meta?.disabledTools ?? []
        if (toolName && disabledTools.includes(toolName)) {
          return reply.code(403).send({
            jsonrpc: '2.0',
            id: payload.id,
            error: {
              code: -32603,
              message: `Tool "${toolName}" is disabled`,
            },
          })
        }
      }

      // Handle stdio transport
      if (transport === 'stdio') {
        return handleStdioInspect(reply, payload, id, resolveStdioContainer, createDockerMultiplexDecoder, meta)
      }

      // Handle http and streamable-http transports
      if (transport === 'http' || transport === 'streamable-http') {
        return handleHttpInspect(reply, payload, docker, match, meta, shortId)
      }

      return reply.code(400).send({ error: `unsupported transport: ${transport}` })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error'
      return reply.code(500).send({ error: message })
    }
  })
}

async function handleStdioInspect(
  reply: any,
  payload: JsonRpcPayload,
  id: string,
  resolveStdioContainer: (id: string) => Promise<any>,
  createDockerMultiplexDecoder: any,
  meta?: any,
) {
  try {
    const { container } = await resolveStdioContainer(id).catch((err) => {
      throw new Error(err.message)
    })

    const info = (await container.inspect()) as any
    const envs: string[] = info?.Config?.Env || []
    const hasEnv = (name: string) => envs.some((e: string) => e === `${name}=true`)

    // Capability interception
    const capabilityMap: Record<string, string> = {
      'resources/list': 'MCP_HAS_RESOURCES',
      'prompts/list': 'MCP_HAS_PROMPTS',
      'logging/setLevel': 'MCP_HAS_LOGGING',
    }

    const method = payload.method
    const requiredEnv = capabilityMap[method]

    if (requiredEnv && !hasEnv(requiredEnv)) {
      const isListMethod = method.endsWith('/list')
      const result = isListMethod ? { [method.split('/')[0]]: [] } : {}

      return reply.send({
        jsonrpc: '2.0',
        id: payload.id,
        result,
      } satisfies JsonRpcResponse)
    }

    // Handle notifications (no id)
    const hasId = Object.prototype.hasOwnProperty.call(payload, 'id')
    if (!hasId) {
      const stream = await container.attach({
        stream: true,
        stdin: true,
        stdout: true,
        stderr: true,
        hijack: true,
        logs: true,
      })
      stream.write(`${JSON.stringify(payload)}\n`)
      setTimeout(() => {
        try {
          ;(stream as unknown as Readable).destroy()
        } catch {
          // ignore
        }
      }, 500)
      return reply.code(204).send()
    }

    // Handle requests with id
    const stream = await container.attach({
      stream: true,
      stdin: true,
      stdout: true,
      stderr: true,
      hijack: true,
      logs: true,
    })

    const getMcpResponse = () =>
      new Promise<JsonRpcResponse>((resolve, reject) => {
        let responseBuffer = ''
        let isFinished = false

        const timeout = setTimeout(() => {
          if (!isFinished) {
            isFinished = true
            cleanup()
            reject(new Error('TIMEOUT_MCP'))
          }
        }, 30000)

        const cleanup = () => {
          clearTimeout(timeout)
          try {
            ;(stream as unknown as Readable).destroy()
          } catch {
            // ignore
          }
        }

        const decode = createDockerMultiplexDecoder((payloadText: string, streamType: number) => {
          if (streamType === 2) {
            // stderr
            return
          }
          if (isFinished || streamType !== 1) return

          responseBuffer += payloadText
          const lines = responseBuffer.split('\n')
          responseBuffer = lines.pop() || ''

          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed.startsWith('{')) continue

            try {
              const parsed = JSON.parse(trimmed) as Record<string, unknown>
              if (Object.prototype.hasOwnProperty.call(parsed, 'id')) {
                if (String(parsed.id) === String(payload.id)) {
                  isFinished = true
                  cleanup()
                  resolve(parsed as unknown as JsonRpcResponse)
                  return
                }
              }
            } catch {
              // ignore parse errors
            }
          }
        })

        stream.on('data', decode)
        stream.on('error', (err: Error) => {
          if (!isFinished) {
            isFinished = true
            cleanup()
            reject(err)
          }
        })

        // Uptime check for startup delay
        const state = info?.State
        const uptime = Date.now() - new Date(state?.StartedAt || 0).getTime()
        const waitTime = uptime < 3000 ? 2200 : 100

        setTimeout(() => {
          if (!isFinished) {
            stream.write(`${JSON.stringify(payload)}\n`)
          }
        }, waitTime)
      })

    try {
      const response = await getMcpResponse()

      // Unwrap result if already wrapped
      let finalResult =
        response && typeof response === 'object' && 'result' in response
          ? (response as unknown as Record<string, unknown>).result
          : response

      // Filter disabled tools from tools/list response
      if (payload.method === 'tools/list' && finalResult && typeof finalResult === 'object') {
        const resultObj = finalResult as any
        if (Array.isArray(resultObj.tools)) {
          const disabledTools = meta?.disabledTools ?? []
          resultObj.tools = resultObj.tools.filter((t: any) => !disabledTools.includes(t.name))
        }
      }

      return reply.type('application/json').send({
        jsonrpc: '2.0',
        id: payload.id,
        result: finalResult,
      } satisfies JsonRpcResponse)
    } catch (err: any) {
      if (err.message === 'TIMEOUT_MCP') {
        return reply.code(504).send({
          jsonrpc: '2.0',
          id: payload.id,
          error: { code: -32000, message: 'Gateway Timeout' },
        } satisfies JsonRpcResponse)
      }
      return reply.code(500).send({
        jsonrpc: '2.0',
        id: payload.id,
        error: { code: -32603, message: err.message },
      } satisfies JsonRpcResponse)
    }
  } catch (err: any) {
    const message = err instanceof Error ? err.message : 'unknown error'
    return reply.code(500).send({
      jsonrpc: '2.0',
      id: payload.id,
      error: { code: -32603, message },
    } satisfies JsonRpcResponse)
  }
}

async function handleHttpInspect(
  reply: any,
  payload: JsonRpcPayload,
  docker: Docker,
  match: any,
  meta: any,
  shortId: string,
) {
  if (match.State !== 'running') {
    return reply.code(503).send({
      error: 'container is not running',
    })
  }

  const port = meta?.port ? String(meta.port) : null
  if (!port) {
    return reply.code(400).send({
      error: 'no port configured for container',
    })
  }

  const container = docker.getContainer(match.Id)
  const fallbackName = match.Names?.[0]?.replace('/', '')

  try {
    const hosts = await getContainerHosts(container, fallbackName)

    if (hosts.length === 0) {
      return reply.code(503).send({
        error: 'could not resolve container host or IP',
      })
    }

    const paths = ['/mcp', '/']

    for (const host of hosts) {
      for (const path of paths) {
        const url = `http://${host}:${port}${path}`

        try {
          const response = await fetchWithTimeout(
            url,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json, text/event-stream',
              },
              body: JSON.stringify(payload),
            },
            10000,
          )

          if (!response.ok) {
            continue
          }

          const text = await response.text()

          // Try parsing as JSON, SSE, or JSON fragment
          let parsed = tryParseJson(text) ?? tryParseSseData(text) ?? tryParseJsonFragment(text)

          if (parsed) {
            // Filter disabled tools from tools/list response
            if (payload.method === 'tools/list' && typeof parsed === 'object' && parsed !== null) {
              const parsedObj = parsed as any
              if (parsedObj.result && Array.isArray(parsedObj.result.tools)) {
                const disabledTools = meta?.disabledTools ?? []
                parsedObj.result.tools = parsedObj.result.tools.filter((t: any) => !disabledTools.includes(t.name))
              }
            }
            return reply.send(parsed as unknown)
          }

          // If no valid response format found, try next host/path
          continue
        } catch {
          // Connection failed, try next host/path
          continue
        }
      }
    }

    return reply.code(502).send({
      jsonrpc: '2.0',
      id: payload.id,
      error: { code: -32000, message: 'all hosts unreachable' },
    } satisfies JsonRpcResponse)
  } catch (err: any) {
    const message = err instanceof Error ? err.message : 'unknown error'
    return reply.code(500).send({
      jsonrpc: '2.0',
      id: payload.id,
      error: { code: -32603, message },
    } satisfies JsonRpcResponse)
  }
}
