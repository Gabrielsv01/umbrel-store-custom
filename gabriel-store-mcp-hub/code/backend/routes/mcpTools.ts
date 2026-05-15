import type { FastifyInstance } from 'fastify'
import type Docker from 'dockerode'
import type { McpRecord } from '../types/mcp.js'
import { createLineDecoder } from '../utils/lineDecoder.js'
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
  createDockerMultiplexDecoder: (callback: (text: string, streamType: number) => void) => (chunk: Buffer) => void
}

function tryParseRecord(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' ? parsed : null
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

async function fetchMcpTools(
  container: any,
  meta: any,
  createDockerMultiplexDecoder: (callback: (text: string, streamType: number) => void) => (chunk: Buffer) => void,
): Promise<McpTool[]> {
  const info = await container.inspect().catch(() => null)
  if (!info || info.State.Status !== 'running') {
    return []
  }

  const transport = meta.transport ?? 'http'
  const port = meta.port || 3000

  if (transport === 'stdio') {
    return fetchStdioMcpTools(container, createDockerMultiplexDecoder)
  } else if (transport === 'http' || transport === 'streamable-http') {
    return fetchHttpMcpTools(container, port)
  }

  return []
}

async function fetchStdioMcpTools(
  container: any,
  createDockerMultiplexDecoder: (callback: (text: string, streamType: number) => void) => (chunk: Buffer) => void,
): Promise<McpTool[]> {
  try {
    const stream = await container.attach({
      stream: true,
      stdin: true,
      stdout: true,
      stderr: true,
      hijack: true,
      logs: false,
    })

    const jsonQueue: Array<Record<string, unknown>> = []

    const stdoutLineDecoder = createLineDecoder((line) => {
      const parsed = tryParseRecord(line) ?? tryParseRecordFragment(line)
      if (parsed) {
        jsonQueue.push(parsed)
      }
    })

    const decode = createDockerMultiplexDecoder((payload, streamType) => {
      if (streamType === 1) {
        stdoutLineDecoder(payload)
      }
    })

    stream.on('data', (chunk: Buffer) => {
      decode(chunk)
    })

    const payload = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    }

    return await new Promise<McpTool[]>((resolve) => {
      let attemptCount = 0
      const maxAttempts = 3

      const tryFetch = () => {
        attemptCount++
        const timeout = setTimeout(() => {
          if (attemptCount < maxAttempts) {
            tryFetch()
          } else {
            try { (stream as any).destroy() } catch {}
            resolve([])
          }
        }, 20000)

        setTimeout(() => {
          stream.write(`${JSON.stringify(payload)}\n`)
        }, 500)

        const pollForResponse = async () => {
          const deadline = Date.now() + 20000
          while (Date.now() < deadline) {
            const idx = jsonQueue.findIndex((msg) => (msg.id as number) === 1)
            if (idx >= 0) {
              const [response] = jsonQueue.splice(idx, 1)
              clearTimeout(timeout)
              try { (stream as any).destroy() } catch {}
              const tools = (response.result as ToolsListResponse)?.tools ?? []
              resolve(tools)
              return
            }
            await new Promise((res) => setTimeout(res, 50))
          }
          if (attemptCount < maxAttempts) {
            clearTimeout(timeout)
            tryFetch()
          } else {
            clearTimeout(timeout)
            try { (stream as any).destroy() } catch {}
            resolve([])
          }
        }

        pollForResponse()
      }

      tryFetch()
    })
  } catch {
    return []
  }
}

async function fetchHttpMcpTools(container: any, port: number): Promise<McpTool[]> {
  try {
    const hosts = await getContainerHosts(container, container.modem.socketPath ? undefined : 'localhost')
    const validHosts = hosts.filter(h => !h.includes(' '))

    for (const host of validHosts) {
      try {
        const url = `http://${host}:${port}/mcp`
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

        for (const line of lines) {
          try {
            const trimmed = line.trim()
            if (trimmed.startsWith('data:')) {
              const data = trimmed.slice(5).trim()
              const parsed = JSON.parse(data)
              if (parsed.result?.tools) {
                return parsed.result.tools
              }
            } else {
              const parsed = JSON.parse(trimmed)
              if (parsed.result?.tools) {
                return parsed.result.tools
              }
            }
          } catch {}
        }
      } catch {}
    }
  } catch {}

  return []
}

export function registerMcpToolsRoutes(
  fastify: FastifyInstance,
  deps: RegisterMcpToolsDeps,
): void {
  const { docker, loadData, saveData, mcpLabel, createDockerMultiplexDecoder } = deps

  // New endpoint that looks up by NAMESPACE_ID instead of CONTAINER_ID
  fastify.get<{
    Params: { namespaceId: string }
  }>('/api/namespaces/:namespaceId/tools', async (req, reply) => {
    const { namespaceId } = req.params
    console.error(`[GET /api/namespaces/:namespaceId/tools] namespaceId=${namespaceId}`)

    try {
      const data = loadData()
      let match = null
      let shortId = null

      // Find the container by matching namespaceId in metadata
      for (const [id, meta] of Object.entries(data)) {
        if ((meta as any).namespaceId === namespaceId) {
          shortId = id
          break
        }
      }

      if (!shortId) {
        return reply.code(404).send({ error: 'namespace not found' })
      }

      const meta = data[shortId]
      if (!meta) {
        return reply.code(404).send({ error: 'metadata not found' })
      }

      const transport = meta.transport ?? 'http'
      const disabledTools = meta.disabledTools ?? []

      // For custom namespaces, directly fetch from enabled MCPs instead of calling wrapper
      // This avoids circular dependency where wrapper calls this endpoint
      if ((meta as any).isCustomNamespace && (meta as any).enabledMcps) {
        console.error(`[GET /api/namespaces/:namespaceId/tools] custom namespace detected, fetching from enabled MCPs`)
        const enabledMcpIds = (meta as any).enabledMcps as string[]
        const allTools: McpTool[] = []

        for (const mcpId of enabledMcpIds) {
          const mcpMeta = data[mcpId]
          if (!mcpMeta) continue

          try {
            // Fetch tools from this enabled MCP directly
            const allContainers = await docker.listContainers({
              all: true,
              filters: JSON.stringify({ label: [`${mcpLabel}=true`] }),
            })
            const mcpContainer = allContainers.find((c) => c.Id.startsWith(mcpId))
            if (!mcpContainer) continue

            const mcpTools = await fetchMcpTools(
              docker.getContainer(mcpContainer.Id),
              mcpMeta as any,
              createDockerMultiplexDecoder,
            )
            allTools.push(...mcpTools)
          } catch (err) {
            console.error(`[GET /api/namespaces/:namespaceId/tools] Failed to fetch from MCP ${mcpId}:`, err)
          }
        }

        // Filter out disabled tools
        const filteredTools = allTools.filter(t => !disabledTools.includes(t.name))
        const response: GetToolsResponse = {
          tools: filteredTools,
          disabledTools,
        }
        return reply.send(response)
      }

      // Handle stdio transport
      if (transport === 'stdio') {
        // For stdio, we need to find the actual container
        const all = await docker.listContainers({
          all: true,
          filters: JSON.stringify({ label: [`${mcpLabel}=true`] }),
        })
        const matchContainer = all.find((c) => c.Id.startsWith(shortId))
        if (!matchContainer) {
          return reply.code(404).send({ error: 'container not found' })
        }

        return handleStdioTools(
          reply,
          matchContainer.Id,
          docker,
          disabledTools,
          createDockerMultiplexDecoder,
          mcpLabel,
          { meta, data, loadData },
        )
      }

      // Handle http and streamable-http transports
      if (transport === 'http' || transport === 'streamable-http') {
        const all = await docker.listContainers({
          all: true,
          filters: JSON.stringify({ label: [`${mcpLabel}=true`] }),
        })
        const matchContainer = all.find((c) => c.Id.startsWith(shortId))
        if (!matchContainer) {
          return reply.code(404).send({ error: 'container not found' })
        }

        return handleHttpTools(
          reply,
          docker,
          docker.getContainer(matchContainer.Id),
          meta,
          disabledTools,
        )
      }

      return reply.code(400).send({ error: `unsupported transport: ${transport}` })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error'
      console.error('[GET /api/namespaces/:namespaceId/tools] Catch Error:', message, err)
      return reply.code(500).send({ error: message })
    }
  })

  fastify.get<{
    Params: { id: string }
  }>('/api/mcps/:id/tools', async (req, reply) => {
    const { id } = req.params
    console.error(`[GET /api/mcps/:id/tools] id=${id}`)

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
      console.error(`[GET] Found container: shortId=${shortId}, transport will be determined from meta`)
      const data = loadData()
      let meta = data[shortId]
      console.error(`[GET] meta=${JSON.stringify(meta)}`)

      // If metadata doesn't exist, create default metadata from container inspection
      if (!meta) {
        console.error(`[GET] No meta found, calling docker.getContainer().inspect()`)
        const containerInfo = await docker.getContainer(match.Id).inspect().catch(() => null)
        if (!containerInfo) {
          return reply.code(404).send({ error: 'unable to inspect container' })
        }

        // Default to HTTP transport with port 3000
        meta = {
          name: containerInfo.Name?.replace(/^\//, '') || 'unknown',
          image: containerInfo.Config?.Image || 'unknown',
          transport: 'http',
          port: 3000,
        }
      }

      const transport = meta.transport ?? 'http'
      const disabledTools = meta.disabledTools ?? []

      // Handle stdio transport
      if (transport === 'stdio') {
        return handleStdioTools(
          reply,
          match.Id,
          docker,
          disabledTools,
          createDockerMultiplexDecoder,
          mcpLabel,
          { meta, data, loadData },
        )
      }

      // Handle http and streamable-http transports
      if (transport === 'http' || transport === 'streamable-http') {
        return handleHttpTools(
          reply,
          docker,
          docker.getContainer(match.Id),
          meta,
          disabledTools,
        )
      }

      return reply.code(400).send({ error: `unsupported transport: ${transport}` })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error'
      console.error('[GET /api/mcps/:id/tools] Catch Error:', message, err)
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
  createDockerMultiplexDecoder: (callback: (text: string, streamType: number) => void) => (chunk: Buffer) => void,
  mcpLabel: string,
  ctx?: { meta?: any; data?: any; loadData?: () => any },
) {
  try {
    console.error(`[handleStdioTools] id=${id}, typeof docker=${typeof docker}, docker.getContainer=${typeof docker.getContainer}`)
    const container = docker.getContainer(id)
    console.error(`[handleStdioTools] container type=${typeof container}, container.inspect=${typeof container.inspect}`)
    const info = await container.inspect().catch(() => null)

    if (!info) {
      return reply.code(404).send({ error: 'container not found' })
    }

    if (info.State.Status !== 'running') {
      return reply.code(503).send({ error: 'container is not running' })
    }

    let tools: McpTool[] = []

    // For custom namespaces with enabled MCPs, fetch real tools from those MCPs
    if (ctx?.meta?.isCustomNamespace && ctx?.meta?.enabledMcps && ctx?.loadData) {
      const allData = ctx.loadData()
      const allContainers = await docker.listContainers({
        all: true,
        filters: JSON.stringify({ label: [`${mcpLabel}=true`] }),
      })

      for (const mcpId of ctx.meta.enabledMcps) {
        const mcpMeta = allData[mcpId]
        if (!mcpMeta) continue

        try {
          const mcpContainer = allContainers.find((c) => c.Id.startsWith(mcpId))
          if (!mcpContainer) continue

          const container = docker.getContainer(mcpContainer.Id)
          const mcpInfo = await container.inspect().catch(() => null)

          if (mcpInfo?.State?.Status !== 'running') continue

          const mcpStream = await container.attach({
            stream: true,
            stdin: true,
            stdout: true,
            stderr: true,
            hijack: true,
            logs: true,
          })

          const jsonQueue: Array<Record<string, unknown>> = []
          const stdoutLineDecoder = createLineDecoder((line) => {
            const parsed = tryParseRecord(line) ?? tryParseRecordFragment(line)
            if (parsed) jsonQueue.push(parsed)
          })

          const decode = createDockerMultiplexDecoder((payload, streamType) => {
            if (streamType === 1) stdoutLineDecoder(payload)
          })

          mcpStream.on('data', (chunk: Buffer) => decode(chunk))

          const writeRpc = (payload: Record<string, unknown>) => {
            mcpStream.write(`${JSON.stringify(payload)}\n`)
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

          const mcpTools = await (async () => {
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
                if (!!initializeResponse?.result && !initializeResponse?.error) {
                  selectedProtocol = protocolVersion
                  break
                }
              }

              if (!selectedProtocol) {
                try { (mcpStream as any).destroy() } catch {}
                return []
              }

              writeRpc({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })

              let toolsResponse: Record<string, unknown> | null = null
              for (const requestId of [10, 11]) {
                writeRpc({ jsonrpc: '2.0', id: requestId, method: 'tools/list', params: {} })
                toolsResponse = await waitForMessage((msg) => Number(msg.id) === requestId, 5000)
                if (toolsResponse) break
              }

              try { (mcpStream as any).destroy() } catch {}

              if (!toolsResponse?.result) return []

              const toolsResult = toolsResponse.result as ToolsListResponse
              return Array.isArray(toolsResult.tools) ? toolsResult.tools : []
            } catch {
              try { (mcpStream as any).destroy() } catch {}
              return []
            }
          })()

          tools.push(...mcpTools)
        } catch {
          // Continue if one MCP fails
        }
      }
    } else {
      // For regular MCPs, query the container directly
      const stream = await container.attach({
        stream: true,
        stdin: true,
        stdout: true,
        stderr: true,
        hijack: true,
        logs: true,
      })

      const jsonQueue: Array<Record<string, unknown>> = []

      const stdoutLineDecoder = createLineDecoder((line) => {
        const parsed = tryParseRecord(line) ?? tryParseRecordFragment(line)
        if (parsed) {
          jsonQueue.push(parsed)
        }
      })

      const decode = createDockerMultiplexDecoder((payload, streamType) => {
        if (streamType === 1) {
          stdoutLineDecoder(payload)
        }
      })

      stream.on('data', (chunk: Buffer) => {
        decode(chunk)
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

      tools = await (async () => {
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
            try { (stream as any).destroy() } catch {}
            return []
          }

          writeRpc({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })

          let toolsResponse: Record<string, unknown> | null = null
          for (const requestId of [10, 11]) {
            writeRpc({ jsonrpc: '2.0', id: requestId, method: 'tools/list', params: {} })
            toolsResponse = await waitForMessage((msg) => Number(msg.id) === requestId, 5000)
            if (toolsResponse) break
          }

          try { (stream as any).destroy() } catch {}

          if (!toolsResponse?.result) {
            return []
          }

          const toolsResult = toolsResponse.result as ToolsListResponse
          return Array.isArray(toolsResult.tools) ? toolsResult.tools : []
        } catch {
          try { (stream as any).destroy() } catch {}
          return []
        }
      })()
    }

    // Filter out disabled tools
    const filteredTools = tools.filter(t => !disabledTools.includes(t.name))

    const response: GetToolsResponse = {
      tools: filteredTools,
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
    console.error(`[handleHttpTools] container type=${typeof container}, container.inspect=${typeof container.inspect}`)
    console.error(`[handleHttpTools] meta.isCustomNamespace=${meta?.isCustomNamespace}`)
    const hosts = await getContainerHosts(container, meta.name)
    console.error(`[handleHttpTools] hosts=${JSON.stringify(hosts)}`)
    const port = meta.port || 3000
    const endpoint = meta.transport === 'streamable-http' ? '/mcp' : '/mcp'

    // Filter out invalid hosts (e.g., container names with spaces)
    const validHosts = hosts.filter(h => !h.includes(' '))
    console.error(`[handleHttpTools] validHosts=${JSON.stringify(validHosts)}`)

    // For custom namespaces, prepend host.docker.internal to try first
    // This ensures backend can reach wrapper containers on different Docker networks
    if (meta.isCustomNamespace) {
      validHosts.unshift('host.docker.internal')
      console.error(`[handleHttpTools] Added host.docker.internal for custom namespace`)
    }

    let lastError: Error | null = null
    for (const host of validHosts) {
      try {
        const url = `http://${host}:${port}${endpoint}`
        console.error(`[handleHttpTools] trying ${url}`)
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
        console.error(`[handleHttpTools] response status=${response.status}, text length=${text.length}`)
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

        console.error(`[handleHttpTools] found ${tools.length} tools`)
        const result: GetToolsResponse = {
          tools,
          disabledTools,
        }
        return reply.send(result)
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        console.error(`[handleHttpTools] host ${host} failed: ${errMsg}`)
        lastError = err instanceof Error ? err : new Error(String(err))
      }
    }

    console.error(`[handleHttpTools] all hosts failed, lastError=${lastError?.message}`)
    throw lastError || new Error('no hosts available')
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error'
    return reply.code(500).send({ error: message })
  }
}
