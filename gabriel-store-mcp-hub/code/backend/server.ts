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
import { registerNamespaceRoutes } from './routes/namespaces.js'
import { registerCustomToolsRoutes } from './routes/customTools.js'
import { registerMcpDebugRoutes } from './routes/mcpDebug.js'
import { registerSharedFilesRoutes } from './routes/sharedFiles.js'
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
const IMAGE_PLATFORMS_FILE = path.join(DATA_DIR, 'image-platforms.json')
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

function loadImagePlatforms(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(IMAGE_PLATFORMS_FILE, 'utf8')) as Record<string, string>
  } catch {
    return {}
  }
}

function saveImagePlatforms(data: Record<string, string>): void {
  fs.writeFileSync(IMAGE_PLATFORMS_FILE, JSON.stringify(data, null, 2))
}

function recordImagePlatform(imageRef: string, platform?: string): void {
  if (!platform?.trim()) return
  try {
    const platforms = loadImagePlatforms()
    const key = imageRef.toLowerCase()
    platforms[key] = platform.trim()
    saveImagePlatforms(platforms)
    console.error(`[recordImagePlatform] Recorded: ${key} = ${platform}`)
  } catch (err) {
    console.error('[recordImagePlatform] Error:', err instanceof Error ? err.message : err)
  }
}

function isImageMissingError(err: unknown): boolean {
  const maybeError = err as { statusCode?: number; message?: string }
  return (
    maybeError?.statusCode === 404 ||
    (typeof maybeError?.message === 'string' &&
      maybeError.message.toLowerCase().includes('no such image'))
  )
}

async function pullImage(image: string, platform?: string): Promise<void> {
  console.error(`[pullImage] Starting pull: image=${image}, platform=${platform}`)
  const options = platform ? { platform } : {}
  const stream = await docker.pull(image, options)
  await new Promise<void>((resolve, reject) => {
    docker.modem.followProgress(
      stream,
      (err) => {
        console.error(`[pullImage] Finished: image=${image}, platform=${platform}, error=${err ? 'yes' : 'no'}`)
        if (err) return reject(err)
        recordImagePlatform(image, platform)
        resolve()
      },
      () => undefined,
    )
  })
}

async function ensureImageAvailable(image: string, platform?: string): Promise<void> {
  try {
    await docker.getImage(image).inspect()
  } catch (err) {
    if (!isImageMissingError(err)) throw err
    await pullImage(image, platform)
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
  let dataChanged = false

  // Sync: add missing metadata for containers that don't have it
  for (const c of list) {
    const shortId = c.Id.slice(0, 12)
    if (!stored[shortId]) {
      stored[shortId] = {
        name: c.Names[0]?.replace('/', '') ?? shortId,
        image: c.Image,
      }
      dataChanged = true
    }
  }

  // Migration: mark containers with enabledMcps as custom namespaces
  for (const [shortId, meta] of Object.entries(stored)) {
    if (Array.isArray(meta.enabledMcps) && meta.enabledMcps.length > 0 && !meta.isCustomNamespace) {
      meta.isCustomNamespace = true
      dataChanged = true
    }
  }

  if (dataChanged) {
    saveData(stored)
  }

  return list.map((c) => {
    const meta = stored[c.Id.slice(0, 12)] ?? {}
    return {
      id: c.Id.slice(0, 12),
      name: meta.name ?? c.Names[0]?.replace('/', '') ?? c.Id.slice(0, 12),
      image: c.Image,
      status: c.State,
      ports: (Array.isArray(c.Ports) ? c.Ports : [])
        .filter((p) => p.PublicPort)
        .map((p) => p.PublicPort),
      meta: redactSecrets(meta),
    }
  })
})

registerImageRoutes(fastify, { docker, pullImage, loadImagePlatforms, recordImagePlatform })
registerVolumeRoutes(fastify, { docker })
registerStdioRoutes(fastify, {
  resolveStdioContainer,
  createDockerMultiplexDecoder,
  createLineDecoder,
  detectNetworkIssues,
  selectNetworkProbeTool,
  loadData,
  docker,
  mcpLabel: MCP_LABEL,
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
registerNamespaceRoutes(fastify, {
  docker,
  loadData,
  saveData,
  mcpLabel: MCP_LABEL,
  buildContainerOptions,
})
registerCustomToolsRoutes(fastify, {
  docker,
  loadData,
  saveData,
  mcpLabel: MCP_LABEL,
})
registerMcpDebugRoutes(fastify, {
  docker,
  loadData,
  mcpLabel: MCP_LABEL,
})
registerSharedFilesRoutes(fastify, {
  sharedDataDir: '/shared-data',
})

// ─── POST /api/deploy ─────────────────────────────────────────────────────────

fastify.post<{ Body: DeployBody }>('/api/deploy', async (req, reply) => {
  const { name, image, command, platform, env = {}, secretKeys, port, transport = 'http', runtime, httpHeaders } = req.body ?? {}

  if (!name?.trim() || !image?.trim()) {
    return reply.code(400).send({ error: 'name and image are required' })
  }

  console.error(`[deploy] creating container: name=${name}, image=${image}, platform=${platform}, command=${command}, transport=${transport}`)
  await ensureImageAvailable(image.trim(), platform?.trim())

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
      volumes: { '/shared-data': 'shared-data' },
    }),
  )

  console.error(`[deploy] starting container ${container.id.slice(0, 12)}`)
  await container.start()
  console.error(`[deploy] container started: ${container.id.slice(0, 12)}`)

  try {
    const mcpHubNetwork = docker.getNetwork('mcp-hub-network')
    await mcpHubNetwork.connect({ Container: container.id })
    console.error(`[deploy] connected container to mcp-hub-network`)
  } catch (err) {
    console.error(`[deploy] failed to connect to network:`, err instanceof Error ? err.message : String(err))
  }

  const shortId = container.id.slice(0, 12)
  const data = loadData()
  data[shortId] = {
    name: name.trim(),
    image: image.trim(),
    command,
    platform: platform?.trim(),
    env,
    secretKeys: secretKeys && secretKeys.length > 0 ? secretKeys : undefined,
    port,
    transport,
    runtime: normalizedRuntime,
    containerName: name.trim(),
    httpHeaders: httpHeaders && Object.keys(httpHeaders).length > 0 ? httpHeaders : undefined,
  }
  saveData(data)

  return { id: shortId, status: 'running' }
})

// ─── PUT /api/mcps/:id (recreate container with updated config) ─────────────

fastify.put<{ Params: { id: string }; Body: UpdateBody }>(
  '/api/mcps/:id',
  async (req, reply) => {
    const { name, image, command, platform, env = {}, secretKeys, port, transport = 'http', runtime, httpHeaders } = req.body ?? {}

    if (!name?.trim() || !image?.trim()) {
      return reply.code(400).send({ error: 'name and image are required' })
    }

    await ensureImageAvailable(image.trim(), platform?.trim())

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
        volumes: { '/shared-data': 'shared-data' },
      }),
    )

    console.error(`[update] starting container ${container.id.slice(0, 12)}`)
    await container.start()
    console.error(`[update] container started: ${container.id.slice(0, 12)}`)

    try {
      const mcpHubNetwork = docker.getNetwork('mcp-hub-network')
      await mcpHubNetwork.connect({ Container: container.id })
      console.error(`[update] connected container to mcp-hub-network`)
    } catch (err) {
      console.error(`[update] failed to connect to network:`, err instanceof Error ? err.message : String(err))
    }

    const newShortId = container.id.slice(0, 12)
    const data = loadData()
    const oldMeta = data[oldShortId]
    delete data[oldShortId]
    data[newShortId] = {
      name: name.trim(),
      image: image.trim(),
      command,
      platform: platform?.trim(),
      env,
      secretKeys: secretKeys && secretKeys.length > 0 ? secretKeys : undefined,
      port,
      transport,
      runtime: normalizedRuntime,
      disabledTools: oldMeta?.disabledTools,
      containerName: name.trim(),
      httpHeaders: httpHeaders && Object.keys(httpHeaders).length > 0 ? httpHeaders : undefined,
    }
    saveData(data)

    return { id: newShortId, status: 'running' }
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
