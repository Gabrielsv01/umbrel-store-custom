import type { FastifyInstance } from 'fastify'
import type Docker from 'dockerode'
import type { McpRecord } from '../types/mcp.js'
import { fetchWithTimeout, getContainerHosts } from '../utils/httpUtils.js'

interface McpTool {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

interface ToolsListResponse {
  tools?: McpTool[]
}

interface GetToolsResponse {
  tools: McpTool[]
  disabledTools: string[]
}

interface UpdateToolsBody {
  disabledTools: string[]
}

export interface RegisterMcpToolsDeps {
  docker: Docker
  loadData: () => McpRecord
  saveData: (data: McpRecord) => void
  mcpLabel: string
}

export function registerMcpToolsRoutes(
  fastify: FastifyInstance,
  deps: RegisterMcpToolsDeps,
): void {
  const { docker, loadData, saveData, mcpLabel } = deps

  fastify.get<{
    Params: { id: string }
  }>('/api/mcps/:id/tools', async (req, reply) => {
    const { id } = req.params

    try {
      const all = await docker.listContainers({
        all: true,
        filters: JSON.stringify({ label: [`${mcpLabel}=true`] }),
      })
      const match = all.find((c) => c.Id.startsWith(id))
      if (!match) {
        return reply.code(404).send({ error: 'container not found' })
      }

      const shortId = match.Id.slice(0, 12)
      const data = loadData()
      const meta = data[shortId]
      if (!meta) {
        return reply.code(404).send({ error: 'metadata not found' })
      }

      const transport = meta.transport ?? 'http'
      const disabledTools = meta.disabledTools ?? []

      // Handle stdio transport
      if (transport === 'stdio') {
        return handleStdioTools(
          reply,
          id,
          docker,
          disabledTools,
        )
      }

      // Handle http and streamable-http transports
      if (transport === 'http' || transport === 'streamable-http') {
        return handleHttpTools(
          reply,
          docker,
          match,
          meta,
          disabledTools,
        )
      }

      return reply.code(400).send({ error: `unsupported transport: ${transport}` })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error'
      return reply.code(500).send({ error: message })
    }
  })

  fastify.patch<{
    Params: { id: string }
    Body: UpdateToolsBody
  }>('/api/mcps/:id/tools', async (req, reply) => {
    const { id } = req.params
    const { disabledTools } = req.body

    try {
      const all = await docker.listContainers({
        all: true,
        filters: JSON.stringify({ label: [`${mcpLabel}=true`] }),
      })
      const match = all.find((c) => c.Id.startsWith(id))
      if (!match) {
        return reply.code(404).send({ error: 'container not found' })
      }

      const shortId = match.Id.slice(0, 12)
      const data = loadData()
      if (!data[shortId]) {
        return reply.code(404).send({ error: 'metadata not found' })
      }

      data[shortId].disabledTools = disabledTools && disabledTools.length > 0 ? disabledTools : undefined

      saveData(data)
      return reply.send({ success: true })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error'
      return reply.code(500).send({ error: message })
    }
  })
}

async function handleStdioTools(
  reply: any,
  id: string,
  docker: Docker,
  disabledTools: string[],
) {
  try {
    // For stdio, we need to attach to the container and send tools/list
    const container = docker.getContainer(id)
    const info = await container.inspect().catch(() => null)

    if (!info) {
      return reply.code(404).send({ error: 'container not found' })
    }

    if (info.State.Status !== 'running') {
      return reply.code(503).send({ error: 'container is not running' })
    }

    const stream = await container.attach({
      stream: true,
      stdin: true,
      stdout: true,
      stderr: true,
      hijack: true,
      logs: true,
    })

    const tools = await new Promise<McpTool[]>((resolve, reject) => {
      let responseBuffer = ''
      let isFinished = false

      const timeout = setTimeout(() => {
        if (!isFinished) {
          isFinished = true
          cleanup()
          reject(new Error('tools/list timeout'))
        }
      }, 10000)

      const cleanup = () => {
        clearTimeout(timeout)
        try {
          ;(stream as unknown as any).destroy()
        } catch {
          // ignore
        }
      }

      const payload = {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {},
      }

      stream.write(`${JSON.stringify(payload)}\n`)

      stream.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf-8')
        responseBuffer += text

        const lines = responseBuffer.split('\n')
        responseBuffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('{')) continue

          try {
            const parsed = JSON.parse(trimmed) as Record<string, unknown>
            if (
              Object.prototype.hasOwnProperty.call(parsed, 'id') &&
              parsed.id === 1
            ) {
              isFinished = true
              cleanup()
              const response = parsed as any
              const toolsList = (response.result as ToolsListResponse)?.tools ?? []
              resolve(toolsList)
            }
          } catch {
            // ignore parse errors
          }
        }
      })

      stream.on('error', (err: Error) => {
        if (!isFinished) {
          isFinished = true
          cleanup()
          reject(err)
        }
      })
    })

    const response: GetToolsResponse = {
      tools,
      disabledTools,
    }
    return reply.send(response)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    return reply.code(500).send({ error: message })
  }
}

async function handleHttpTools(
  reply: any,
  docker: Docker,
  container: any,
  meta: any,
  disabledTools: string[],
) {
  try {
    const hosts = await getContainerHosts(container, meta.name)
    const port = meta.port || 3000
    const endpoint = meta.transport === 'streamable-http' ? '/mcp' : '/sse'

    let lastError: Error | null = null
    for (const host of hosts) {
      try {
        const url = `http://${host}:${port}${endpoint}`
        const payload = {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: {},
        }

        const response = await fetchWithTimeout(
          url,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          },
          5000,
        )

        const text = await response.text()
        const lines = text.split('\n').filter((l) => l.trim())

        let tools: McpTool[] = []
        for (const line of lines) {
          try {
            const trimmed = line.trim()
            if (trimmed.startsWith('data:')) {
              const data = trimmed.slice(5).trim()
              const parsed = JSON.parse(data)
              if (parsed.result?.tools) {
                tools = parsed.result.tools
                break
              }
            } else {
              const parsed = JSON.parse(trimmed)
              if (parsed.result?.tools) {
                tools = parsed.result.tools
                break
              }
            }
          } catch {
            // ignore
          }
        }

        const result: GetToolsResponse = {
          tools,
          disabledTools,
        }
        return reply.send(result)
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
      }
    }

    throw lastError || new Error('no hosts available')
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    return reply.code(500).send({ error: message })
  }
}
