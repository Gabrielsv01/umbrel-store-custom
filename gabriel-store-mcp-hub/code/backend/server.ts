import Fastify from 'fastify'
import cors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import fastifyWebsocket from '@fastify/websocket'
import Docker from 'dockerode'
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { registerImageRoutes } from './routes/images.js'
import { registerStdioRoutes } from './routes/stdio.js'
import { registerVolumeRoutes } from './routes/volumes.js'
import { registerHttpHealthRoutes } from './routes/httpHealth.js'
import { registerMcpInspectRoutes } from './routes/mcpInspect.js'
import { registerMcpToolsRoutes } from './routes/mcpTools.js'
import { registerCatalogRoutes } from './routes/catalog.js'
import {
  buildContainerOptions,
  normalizeRuntimeConfig,
} from './services/runtimeConfig.js'
import type { ActionBody, DeployBody, McpRecord, UpdateBody } from './types/mcp.js'
import type { ResolvedStdioContainer } from './types/stdio.js'
import { createDockerMultiplexDecoder } from './utils/dockerMultiplex.js'
import { createLineDecoder } from './utils/lineDecoder.js'
import { detectNetworkIssues, selectNetworkProbeTool } from './utils/networkTools.js'

const fastify = Fastify({ logger: false })
const docker = new Docker({ socketPath: '/var/run/docker.sock' })

const MCP_LABEL = 'gabriel.mcp-hub'
const DATA_DIR = process.env.DATA_DIR ?? '/data'
const DATA_FILE = path.join(DATA_DIR, 'mcps.json')
const STATIC_DIR = process.env.STATIC_DIR ?? path.resolve(process.cwd(), 'public')
const HAS_STATIC = fs.existsSync(STATIC_DIR)
const INDEX_FILE = path.join(STATIC_DIR, 'index.html')

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }
}

function loadData(): McpRecord {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) as McpRecord
  } catch {
    return {}
  }
}

function saveData(data: McpRecord): void {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2))
}

function isImageMissingError(err: unknown): boolean {
  const maybeError = err as { statusCode?: number; message?: string }
  return (
    maybeError?.statusCode === 404 ||
    (typeof maybeError?.message === 'string' &&
      maybeError.message.toLowerCase().includes('no such image'))
  )
}

async function pullImage(image: string): Promise<void> {
  const stream = await docker.pull(image)
  await new Promise<void>((resolve, reject) => {
    docker.modem.followProgress(
      stream,
      (err) => {
        if (err) return reject(err)
        resolve()
      },
      () => undefined,
    )
  })
}

async function ensureImageAvailable(image: string): Promise<void> {
  try {
    await docker.getImage(image).inspect()
  } catch (err) {
    if (!isImageMissingError(err)) throw err
    await pullImage(image)
  }
}

async function resolveStdioContainer(idPrefix: string): Promise<ResolvedStdioContainer> {
  const all = await docker.listContainers({
    all: true,
    filters: JSON.stringify({ label: [`${MCP_LABEL}=true`] }),
  })
  const match = all.find((c) => c.Id.startsWith(idPrefix))
  if (!match) {
    throw new Error('container not found')
  }

  const shortId = match.Id.slice(0, 12)
  const meta = loadData()[shortId]
  if ((meta?.transport ?? 'http') !== 'stdio') {
    throw new Error('session only available for stdio')
  }

  const container = docker.getContainer(match.Id)
  const info = await container.inspect().catch(() => null)
  if (!info) {
    throw new Error('container not available')
  }

  if (!info.State.Running) {
    await container.start()
  }

  return { container, shortId }
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

ensureDataDir()
await fastify.register(cors, { origin: true })
await fastify.register(fastifyWebsocket)

if (HAS_STATIC) {
  await fastify.register(fastifyStatic, {
    root: STATIC_DIR,
    prefix: '/',
  })

  fastify.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) {
      return reply.code(404).send({ error: 'not found' })
    }
    if (!fs.existsSync(INDEX_FILE)) {
      return reply.code(404).send({ error: 'frontend not found' })
    }
    reply.type('text/html; charset=utf-8')
    return reply.send(fs.createReadStream(INDEX_FILE))
  })
}

// ─── GET /api/mcps ────────────────────────────────────────────────────────────

function redactSecrets(meta: import('./types/mcp.js').McpMeta): import('./types/mcp.js').McpMeta {
  const secretKeys = meta.secretKeys ?? []
  if (secretKeys.length === 0 || !meta.env) return meta
  const redactedEnv: Record<string, string> = {}
  for (const [k, v] of Object.entries(meta.env)) {
    redactedEnv[k] = secretKeys.includes(k) ? '' : v
  }
  return { ...meta, env: redactedEnv }
}

fastify.get('/api/mcps', async () => {
  const list = await docker.listContainers({
    all: true,
    filters: JSON.stringify({ label: [`${MCP_LABEL}=true`] }),
  })
  const stored = loadData()
  return list.map((c) => {
    const meta = stored[c.Id.slice(0, 12)] ?? {}
    return {
      id: c.Id.slice(0, 12),
      name: c.Names[0]?.replace('/', '') ?? c.Id.slice(0, 12),
      image: c.Image,
      status: c.State,
      ports: (Array.isArray(c.Ports) ? c.Ports : [])
        .filter((p) => p.PublicPort)
        .map((p) => p.PublicPort),
      meta: redactSecrets(meta),
    }
  })
})

registerImageRoutes(fastify, { docker, pullImage })
registerVolumeRoutes(fastify, { docker })
registerStdioRoutes(fastify, {
  resolveStdioContainer,
  createDockerMultiplexDecoder,
  createLineDecoder,
  detectNetworkIssues,
  selectNetworkProbeTool,
})
registerHttpHealthRoutes(fastify, { docker, loadData, mcpLabel: MCP_LABEL })
registerMcpInspectRoutes(fastify, {
  docker,
  loadData,
  mcpLabel: MCP_LABEL,
  resolveStdioContainer,
  createDockerMultiplexDecoder,
  createLineDecoder,
  detectNetworkIssues,
  selectNetworkProbeTool,
})
registerMcpToolsRoutes(fastify, { docker, loadData, saveData, mcpLabel: MCP_LABEL, createDockerMultiplexDecoder })
registerCatalogRoutes(fastify)

// ─── POST /api/deploy ─────────────────────────────────────────────────────────

fastify.post<{ Body: DeployBody }>('/api/deploy', async (req, reply) => {
  const { name, image, command, env = {}, secretKeys, port, transport = 'http', runtime } = req.body ?? {}

  if (!name?.trim() || !image?.trim()) {
    return reply.code(400).send({ error: 'name and image are required' })
  }

  await ensureImageAvailable(image.trim())

  const normalizedRuntime = normalizeRuntimeConfig(runtime)

  const container = await docker.createContainer(
    buildContainerOptions({
      name,
      image,
      command,
      env,
      port,
      transport,
      runtime: normalizedRuntime,
      mcpLabel: MCP_LABEL,
    }),
  )

  if (transport !== 'stdio') {
    await container.start()
  }

  const shortId = container.id.slice(0, 12)
  const data = loadData()
  data[shortId] = {
    name: name.trim(),
    image: image.trim(),
    command,
    env,
    secretKeys: secretKeys && secretKeys.length > 0 ? secretKeys : undefined,
    port,
    transport,
    runtime: normalizedRuntime,
  }
  saveData(data)

  return { id: shortId, status: transport === 'stdio' ? 'created' : 'running' }
})

// ─── PUT /api/mcps/:id (recreate container with updated config) ─────────────

fastify.put<{ Params: { id: string }; Body: UpdateBody }>(
  '/api/mcps/:id',
  async (req, reply) => {
    const { name, image, command, env = {}, secretKeys, port, transport = 'http', runtime } = req.body ?? {}

    if (!name?.trim() || !image?.trim()) {
      return reply.code(400).send({ error: 'name and image are required' })
    }

    await ensureImageAvailable(image.trim())

    const all = await docker.listContainers({
      all: true,
      filters: JSON.stringify({ label: [`${MCP_LABEL}=true`] }),
    })
    const match = all.find((c) => c.Id.startsWith(req.params.id))
    if (!match) return reply.code(404).send({ error: 'container not found' })

    const oldContainer = docker.getContainer(match.Id)
    const oldShortId = match.Id.slice(0, 12)

    const normalizedRuntime = normalizeRuntimeConfig(runtime)

    await oldContainer.stop().catch(() => undefined)
    await oldContainer.remove()

    const container = await docker.createContainer(
      buildContainerOptions({
        name,
        image,
        command,
        env,
        port,
        transport,
        runtime: normalizedRuntime,
        mcpLabel: MCP_LABEL,
      }),
    )

    if (transport !== 'stdio') {
      await container.start()
    }

    const newShortId = container.id.slice(0, 12)
    const data = loadData()
    const oldMeta = data[oldShortId]
    delete data[oldShortId]
    data[newShortId] = {
      name: name.trim(),
      image: image.trim(),
      command,
      env,
      secretKeys: secretKeys && secretKeys.length > 0 ? secretKeys : undefined,
      port,
      transport,
      runtime: normalizedRuntime,
      disabledTools: oldMeta?.disabledTools,
    }
    saveData(data)

    return { id: newShortId, status: transport === 'stdio' ? 'created' : 'running' }
  },
)

// ─── POST /api/action/:id ─────────────────────────────────────────────────────

fastify.post<{ Params: { id: string }; Body: ActionBody }>(
  '/api/action/:id',
  async (req, reply) => {
    const { action } = req.body ?? {}
    const all = await docker.listContainers({
      all: true,
      filters: JSON.stringify({ label: [`${MCP_LABEL}=true`] }),
    })
    const match = all.find((c) => c.Id.startsWith(req.params.id))
    if (!match) return reply.code(404).send({ error: 'container not found' })

    const container = docker.getContainer(match.Id)
    const shortId = match.Id.slice(0, 12)

    if (action === 'start') {
      await container.start()
    } else if (action === 'stop') {
      await container.stop().catch(() => undefined)
    } else if (action === 'remove') {
      // Force-remove also handles containers stuck in restart loops.
      await container.stop().catch(() => undefined)
      await container.remove({ force: true })
      const data = loadData()
      delete data[shortId]
      saveData(data)
    } else {
      return reply.code(400).send({ error: 'unknown action' })
    }

    return { ok: true }
  },
)

// ─── GET /api/logs/:id (SSE) ──────────────────────────────────────────────────

fastify.get<{ Params: { id: string } }>('/api/logs/:id', async (req, reply) => {
  const all = await docker.listContainers({
    all: true,
    filters: JSON.stringify({ label: [`${MCP_LABEL}=true`] }),
  })
  const match = all.find((c) => c.Id.startsWith(req.params.id))
  if (!match) return reply.code(404).send({ error: 'container not found' })

  reply.hijack()
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })

  const stream = await docker.getContainer(match.Id).logs({
    follow: true,
    stdout: true,
    stderr: true,
    tail: 200,
  })

  const decodeChunk = createDockerMultiplexDecoder((payload) => {
    reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`)
  })

  stream.on('data', (chunk: Buffer) => {
    decodeChunk(chunk)
  })

  stream.on('end', () => reply.raw.end())
  req.raw.on('close', () => (stream as Readable).destroy())
})

// ─── Start ────────────────────────────────────────────────────────────────────

await fastify.listen({ port: 3001, host: '0.0.0.0' })
console.log('MCP Hub backend listening on :3001')
