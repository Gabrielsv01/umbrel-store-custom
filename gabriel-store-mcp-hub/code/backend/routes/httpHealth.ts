import type { FastifyInstance } from 'fastify'
import type Docker from 'dockerode'
import type { McpRecord } from '../types/mcp.js'

export interface HttpHealthResult {
  id: string
  transport: 'http' | 'streamable-http'
  status: 'healthy' | 'unreachable' | 'error'
  latencyMs?: number
  serverInfo?: unknown
  error?: string
  checkedAt: string
}

export interface RegisterHttpHealthDeps {
  docker: Docker
  loadData: () => McpRecord
  mcpLabel: string
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function getContainerIp(container: Docker.Container): Promise<string | null> {
  const info = await container.inspect().catch(() => null)
  if (!info) return null

  const networks = info.NetworkSettings?.Networks ?? {}
  for (const net of Object.values(networks)) {
    const ip = (net as { IPAddress?: string }).IPAddress
    if (ip) return ip
  }
  return null
}

export function registerHttpHealthRoutes(
  fastify: FastifyInstance,
  deps: RegisterHttpHealthDeps,
): void {
  const { docker, loadData, mcpLabel } = deps

  fastify.get<{ Params: { id: string } }>('/api/health/http/:id', async (req, reply) => {
    const all = await docker.listContainers({
      all: true,
      filters: JSON.stringify({ label: [`${mcpLabel}=true`] }),
    })
    const match = all.find((c) => c.Id.startsWith(req.params.id))
    if (!match) return reply.code(404).send({ error: 'container not found' })

    const shortId = match.Id.slice(0, 12)
    const meta = loadData()[shortId]
    const transport = meta?.transport ?? 'http'

    if (transport === 'stdio') {
      return reply.code(400).send({ error: 'use /api/stdio/health/:id for stdio MCPs' })
    }

    if (match.State !== 'running') {
      return reply.code(200).send({
        id: shortId,
        transport,
        status: 'unreachable',
        error: 'container is not running',
        checkedAt: new Date().toISOString(),
      } satisfies HttpHealthResult)
    }

    const port = meta?.port ? String(meta.port) : null
    if (!port) {
      return reply.code(200).send({
        id: shortId,
        transport,
        status: 'error',
        error: 'no port configured',
        checkedAt: new Date().toISOString(),
      } satisfies HttpHealthResult)
    }

    const container = docker.getContainer(match.Id)
    const ip = await getContainerIp(container)

    if (!ip) {
      return reply.code(200).send({
        id: shortId,
        transport,
        status: 'unreachable',
        error: 'could not resolve container IP',
        checkedAt: new Date().toISOString(),
      } satisfies HttpHealthResult)
    }

    const baseUrl = `http://${ip}:${port}`
    const start = Date.now()

    try {
      if (transport === 'streamable-http') {
        // MCP 2025-03-26 streamable-http: POST /mcp with initialize JSON-RPC
        const url = `${baseUrl}/mcp`
        const body = JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'mcp-hub-health', version: '1.0.0' },
          },
        })
        const res = await fetchWithTimeout(
          url,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
            body,
          },
          5000,
        )
        const latencyMs = Date.now() - start
        if (!res.ok) {
          return reply.send({
            id: shortId,
            transport,
            status: 'error',
            latencyMs,
            error: `HTTP ${res.status}`,
            checkedAt: new Date().toISOString(),
          } satisfies HttpHealthResult)
        }
        let serverInfo: unknown
        try {
          const text = await res.text()
          // Response may be JSON or SSE — try to parse first JSON object
          const jsonMatch = text.match(/\{[\s\S]*\}/)
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]) as { result?: { serverInfo?: unknown } }
            serverInfo = parsed?.result?.serverInfo
          }
        } catch {
          // ignore parse errors
        }
        return reply.send({
          id: shortId,
          transport,
          status: 'healthy',
          latencyMs,
          serverInfo,
          checkedAt: new Date().toISOString(),
        } satisfies HttpHealthResult)
      } else {
        // http/sse transport: try GET / as connectivity check
        const res = await fetchWithTimeout(baseUrl + '/', { method: 'GET' }, 5000)
        const latencyMs = Date.now() - start
        return reply.send({
          id: shortId,
          transport: transport as 'http',
          status: res.status < 500 ? 'healthy' : 'error',
          latencyMs,
          error: res.status >= 500 ? `HTTP ${res.status}` : undefined,
          checkedAt: new Date().toISOString(),
        } satisfies HttpHealthResult)
      }
    } catch (err) {
      const latencyMs = Date.now() - start
      const isTimeout = err instanceof Error && err.name === 'AbortError'
      return reply.send({
        id: shortId,
        transport: transport as 'http' | 'streamable-http',
        status: 'unreachable',
        latencyMs,
        error: isTimeout ? 'timed out after 5s' : err instanceof Error ? err.message : 'unknown error',
        checkedAt: new Date().toISOString(),
      } satisfies HttpHealthResult)
    }
  })
}
