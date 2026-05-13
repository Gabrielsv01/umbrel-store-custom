import type { FastifyInstance } from 'fastify'
import type Docker from 'dockerode'
import type { McpRecord } from '../types/mcp.js'
import {
  fetchWithTimeout,
  getContainerHosts,
  tryParseJson,
  tryParseJsonFragment,
  tryParseSseData,
} from '../utils/httpUtils.js'

export interface HttpHealthResult {
  id: string
  transport: 'http' | 'streamable-http'
  status: 'healthy' | 'unreachable' | 'error'
  latencyMs?: number
  serverInfo?: unknown
  error?: string
  diagnostics?: {
    triedHosts?: string[]
    attemptedEndpoints?: Array<{
      url: string
      method: string
      statusCode?: number
      latencyMs: number
      ok: boolean
      error?: string
    }>
  }
  checkedAt: string
}

export interface RegisterHttpHealthDeps {
  docker: Docker
  loadData: () => McpRecord
  mcpLabel: string
}

type ProbeOutcome = {
  ok: boolean
  reachable: boolean
  statusCode?: number
  latencyMs: number
  error?: string
  serverInfo?: unknown
}

type ProbeAttempt = {
  url: string
  method: string
  statusCode?: number
  latencyMs: number
  ok: boolean
  error?: string
}

type ProbeTarget = {
  path: string
  method: 'GET' | 'POST'
  body?: string
  headers?: Record<string, string>
}

function asErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return 'unknown error'
}

function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError'
}

async function readSnippet(response: Response, maxBytes: number, timeoutMs: number): Promise<string> {
  if (!response.body) return ''

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0

  const timeout = setTimeout(() => {
    void reader.cancel()
  }, timeoutMs)

  try {
    while (size < maxBytes) {
      const { done, value } = await reader.read()
      if (done || !value) break
      chunks.push(value)
      size += value.length
    }
  } catch {
    // ignore partial stream read errors, best-effort snippet is enough.
  } finally {
    clearTimeout(timeout)
    try {
      await reader.cancel()
    } catch {
      // no-op
    }
  }

  const merged = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8')
  return merged.slice(0, maxBytes)
}

function extractServerInfoFromText(text: string): unknown {
  const direct = tryParseJson(text)
  if (direct) {
    const result = (direct.result as Record<string, unknown> | undefined) ?? undefined
    return result?.serverInfo
  }

  const sse = tryParseSseData(text)
  if (sse) {
    const result = (sse.result as Record<string, unknown> | undefined) ?? undefined
    return result?.serverInfo
  }

  const fragment = tryParseJsonFragment(text)
  if (fragment) {
    const result = (fragment.result as Record<string, unknown> | undefined) ?? undefined
    return result?.serverInfo
  }

  return undefined
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

async function probeEndpoint(
  url: string,
  target: ProbeTarget,
  timeoutMs: number,
): Promise<ProbeOutcome> {
  const start = Date.now()
  const requestUrl = `${url}${target.path}`

  try {
    const response = await fetchWithTimeout(
      requestUrl,
      {
        method: target.method,
        headers: target.headers,
        body: target.body,
      },
      timeoutMs,
    )

    const latencyMs = Date.now() - start
    const snippet = await readSnippet(response, 32768, 1200)
    const serverInfo = extractServerInfoFromText(snippet)

    // Be tolerant with servers that are reachable but return non-standard status/content.
    const reachable = true
    const ok = response.ok || response.status === 405 || response.status === 406

    return {
      ok,
      reachable,
      statusCode: response.status,
      latencyMs,
      serverInfo,
      error: ok ? undefined : `HTTP ${response.status}`,
    }
  } catch (err) {
    const latencyMs = Date.now() - start
    return {
      ok: false,
      reachable: false,
      latencyMs,
      error: isTimeoutError(err) ? `timed out after ${timeoutMs}ms` : asErrorMessage(err),
    }
  }
}

async function probeWithRetry(
  baseUrl: string,
  target: ProbeTarget,
  attempts: number,
  timeoutMs: number,
): Promise<ProbeOutcome> {
  let last: ProbeOutcome = {
    ok: false,
    reachable: false,
    latencyMs: 0,
    error: 'unknown error',
  }

  for (let i = 0; i < attempts; i += 1) {
    const result = await probeEndpoint(baseUrl, target, timeoutMs)
    last = result

    if (result.ok || result.reachable) {
      return result
    }
  }

  return last
}

function streamableTargets(): ProbeTarget[] {
  const initializeBody = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'mcp-hub-health', version: '1.0.0' },
    },
  })

  return [
    {
      path: '/mcp',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: initializeBody,
    },
    {
      path: '/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: initializeBody,
    },
    { path: '/mcp', method: 'GET', headers: { Accept: 'text/event-stream, application/json' } },
    { path: '/sse', method: 'GET', headers: { Accept: 'text/event-stream, application/json' } },
    { path: '/', method: 'GET', headers: { Accept: '*/*' } },
  ]
}

function httpTargets(): ProbeTarget[] {
  return [
    { path: '/sse', method: 'GET', headers: { Accept: 'text/event-stream, application/json' } },
    { path: '/mcp', method: 'GET', headers: { Accept: 'application/json, text/event-stream' } },
    { path: '/', method: 'GET', headers: { Accept: '*/*' } },
  ]
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
    const fallbackName = match.Names?.[0]?.replace('/', '')
    const hosts = await getContainerHosts(container, fallbackName)

    if (hosts.length === 0) {
      return reply.code(200).send({
        id: shortId,
        transport,
        status: 'unreachable',
        error: 'could not resolve container host or IP',
        checkedAt: new Date().toISOString(),
      } satisfies HttpHealthResult)
    }

    const targets = transport === 'streamable-http' ? streamableTargets() : httpTargets()
    const attempts: ProbeAttempt[] = []

    let bestError: ProbeAttempt | null = null
    let sawReachableAttempt = false

    for (const host of hosts) {
      const baseUrl = `http://${host}:${port}`

      for (const target of targets) {
        const result = await probeWithRetry(baseUrl, target, 2, 5000)
        const attempt: ProbeAttempt = {
          url: `${baseUrl}${target.path}`,
          method: target.method,
          statusCode: result.statusCode,
          latencyMs: result.latencyMs,
          ok: result.ok,
          error: result.error,
        }

        attempts.push(attempt)

        if (result.reachable) {
          sawReachableAttempt = true
        }

        if (result.ok) {
          return reply.send({
            id: shortId,
            transport: transport as 'http' | 'streamable-http',
            status: 'healthy',
            latencyMs: result.latencyMs,
            serverInfo: result.serverInfo,
            diagnostics: {
              triedHosts: hosts,
              attemptedEndpoints: attempts,
            },
            checkedAt: new Date().toISOString(),
          } satisfies HttpHealthResult)
        }

        bestError = attempt
      }
    }

    return reply.send({
      id: shortId,
      transport: transport as 'http' | 'streamable-http',
      status: sawReachableAttempt ? 'error' : 'unreachable',
      latencyMs: bestError?.latencyMs,
      error:
        bestError?.error ??
        (sawReachableAttempt
          ? 'endpoint responded but not as expected'
          : 'failed to reach any endpoint/host combination'),
      diagnostics: {
        triedHosts: hosts,
        attemptedEndpoints: attempts,
      },
      checkedAt: new Date().toISOString(),
    } satisfies HttpHealthResult)
  })
}
