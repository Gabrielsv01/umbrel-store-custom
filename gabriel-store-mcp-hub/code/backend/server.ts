import Fastify from 'fastify'
import cors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import fastifyWebsocket from '@fastify/websocket'
import Docker from 'dockerode'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'

const fastify = Fastify({ logger: false })
const docker = new Docker({ socketPath: '/var/run/docker.sock' })

const MCP_LABEL = 'gabriel.mcp-hub'
const DATA_DIR = process.env.DATA_DIR ?? '/data'
const DATA_FILE = path.join(DATA_DIR, 'mcps.json')
const STATIC_DIR = process.env.STATIC_DIR ?? path.resolve(process.cwd(), 'public')
const HAS_STATIC = fs.existsSync(STATIC_DIR)
const INDEX_FILE = path.join(STATIC_DIR, 'index.html')

// ─── Types ────────────────────────────────────────────────────────────────────

interface McpMeta {
  name: string
  image: string
  command?: string
  env?: Record<string, string>
  port?: number | string
  transport?: 'http' | 'stdio'
  runtime?: McpRuntimeConfig
}

interface McpRuntimeConfig {
  entrypoint?: string
  args?: string[]
  workingDir?: string
  volumes?: string[]
  bindMounts?: string[]
  extraHosts?: string[]
  dns?: string[]
  networkMode?: string
  user?: string
  privileged?: boolean
  devices?: string[]
  shmSize?: number | string
}

interface McpRecord {
  [shortId: string]: McpMeta
}

interface DeployBody {
  name: string
  image: string
  command?: string
  env?: Record<string, string>
  port?: number | string
  transport?: 'http' | 'stdio'
  runtime?: McpRuntimeConfig
}

interface UpdateBody {
  name: string
  image: string
  command?: string
  env?: Record<string, string>
  port?: number | string
  transport?: 'http' | 'stdio'
  runtime?: McpRuntimeConfig
}

interface ActionBody {
  action: 'start' | 'stop' | 'remove'
}

interface StdioWsMessage {
  type?: 'input'
  data?: string
}

interface PullImageBody {
  image: string
}

interface PullImageQuery {
  image?: string
}

interface StdioProxyMessageQuery {
  sessionId?: string
}

interface StdioHealthQuery {
  probe?: 'network'
}

interface StdioProxySession {
  sessionId: string
  container: Docker.Container
  stream: NodeJS.ReadWriteStream
  closed: boolean
}

interface DockerImageSummary {
  id: string
  shortId: string
  tags: string[]
  created: number
  size: number
  isDangling: boolean
  inUse: boolean
  containersUsing: number
}

interface DockerVolumeSummary {
  name: string
  driver: string
  mountpoint: string
  createdAt: string
  scope: string
  inUse: boolean
  containersUsing: number
}

const stdioProxySessions = new Map<string, StdioProxySession>()

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

function createDockerMultiplexDecoder(
  onPayload: (payload: string, streamType: number) => void,
): (chunk: Buffer) => void {
  let pending = Buffer.alloc(0)

  return (chunk: Buffer) => {
    const data = pending.length > 0 ? Buffer.concat([pending, chunk]) : chunk
    let offset = 0

    while (data.length - offset >= 8) {
      // Docker multiplexed stream header: [stream, 0, 0, 0, size(4 bytes)]
      const b1 = data[offset + 1]
      const b2 = data[offset + 2]
      const b3 = data[offset + 3]
      if (b1 !== 0 || b2 !== 0 || b3 !== 0) {
        onPayload(data.subarray(offset).toString('utf8'), 1)
        pending = Buffer.alloc(0)
        return
      }

      const streamType = data[offset]
      const size = data.readUInt32BE(offset + 4)
      if (data.length - offset < 8 + size) {
        break
      }

      const payload = data.subarray(offset + 8, offset + 8 + size).toString('utf8')
      onPayload(payload, streamType)
      offset += 8 + size
    }

    pending = offset < data.length ? Buffer.from(data.subarray(offset)) : Buffer.alloc(0)
  }
}

function createLineDecoder(onLine: (line: string) => void): (chunk: string) => void {
  let pending = ''

  return (chunk: string) => {
    pending += chunk

    while (true) {
      const idx = pending.indexOf('\n')
      if (idx === -1) break

      const line = pending.slice(0, idx).replace(/\r$/, '')
      pending = pending.slice(idx + 1)
      if (line.trim().length === 0) continue
      onLine(line)
    }
  }
}

function detectNetworkIssues(lines: string[]): string[] {
  const issuePatterns = [
    /certificate verify failed/i,
    /ssl/i,
    /tls/i,
    /unable to get local issuer certificate/i,
    /max retries exceeded/i,
    /connection error/i,
    /econn/i,
    /timed out|timeout/i,
  ]

  const issues = new Set<string>()
  for (const line of lines) {
    for (const pattern of issuePatterns) {
      if (pattern.test(line)) {
        issues.add(line)
        break
      }
    }
  }

  return Array.from(issues)
}

function splitCommand(value?: string): string[] | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed.split(/\s+/) : undefined
}

function cleanStringArray(values?: string[]): string[] | undefined {
  const cleaned = (values ?? []).map((value) => value.trim()).filter(Boolean)
  return cleaned.length > 0 ? cleaned : undefined
}

function parseShmSize(value?: number | string): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value)
  }

  if (typeof value !== 'string') return undefined

  const trimmed = value.trim().toLowerCase()
  if (!trimmed) return undefined
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed)
  }

  const match = trimmed.match(/^(\d+(?:\.\d+)?)([kmgt])b?$/i)
  if (!match) return undefined

  const amount = Number(match[1])
  const units: Record<string, number> = {
    k: 1024,
    m: 1024 ** 2,
    g: 1024 ** 3,
    t: 1024 ** 4,
  }

  return Math.floor(amount * units[match[2].toLowerCase()])
}

function parseDevices(devices?: string[]): Docker.DeviceMapping[] | undefined {
  const cleaned = cleanStringArray(devices)
  if (!cleaned) return undefined

  return cleaned.map((entry) => {
    const [pathOnHost = '', pathInContainer = '', permissions = 'rwm'] = entry.split(':')
    return {
      PathOnHost: pathOnHost.trim(),
      PathInContainer: (pathInContainer.trim() || pathOnHost.trim()),
      CgroupPermissions: permissions.trim() || 'rwm',
    }
  })
}

function normalizeRuntimeConfig(runtime?: McpRuntimeConfig): McpRuntimeConfig | undefined {
  if (!runtime) return undefined

  const normalized: McpRuntimeConfig = {}

  if (runtime.entrypoint?.trim()) normalized.entrypoint = runtime.entrypoint.trim()
  if (runtime.workingDir?.trim()) normalized.workingDir = runtime.workingDir.trim()
  if (runtime.networkMode?.trim()) normalized.networkMode = runtime.networkMode.trim()
  if (runtime.user?.trim()) normalized.user = runtime.user.trim()
  if (runtime.privileged === true) normalized.privileged = true

  const args = cleanStringArray(runtime.args)
  if (args) normalized.args = args

  const volumes = cleanStringArray(runtime.volumes)
  if (volumes) normalized.volumes = volumes

  const bindMounts = cleanStringArray(runtime.bindMounts)
  if (bindMounts) normalized.bindMounts = bindMounts

  const extraHosts = cleanStringArray(runtime.extraHosts)
  if (extraHosts) normalized.extraHosts = extraHosts

  const dns = cleanStringArray(runtime.dns)
  if (dns) normalized.dns = dns

  const devices = cleanStringArray(runtime.devices)
  if (devices) normalized.devices = devices

  const shmSize = parseShmSize(runtime.shmSize)
  if (shmSize) normalized.shmSize = shmSize

  return Object.keys(normalized).length > 0 ? normalized : undefined
}

function buildContainerOptions(input: {
  name: string
  image: string
  command?: string
  env?: Record<string, string>
  port?: number | string
  transport?: 'http' | 'stdio'
  runtime?: McpRuntimeConfig
}): Docker.ContainerCreateOptions {
  const envArr = Object.entries(input.env ?? {})
    .filter(([key]) => key.trim())
    .map(([key, value]) => `${key.trim()}=${value}`)

  const runtime = normalizeRuntimeConfig(input.runtime)
  const cmd = runtime?.args && runtime.args.length > 0 ? runtime.args : splitCommand(input.command)
  const entrypoint = splitCommand(runtime?.entrypoint)
  const portStr = input.port ? String(input.port) : undefined
  const exposePort = input.transport !== 'stdio' && !!portStr
  const exposedPorts: Record<string, Record<string, never>> = exposePort
    ? { [`${portStr}/tcp`]: {} }
    : {}
  const portBindings: Docker.PortMap = exposePort
    ? { [`${portStr}/tcp`]: [{ HostPort: portStr }] }
    : {}
  const binds = [...(runtime?.volumes ?? []), ...(runtime?.bindMounts ?? [])]

  return {
    name: input.name.trim(),
    Image: input.image.trim(),
    Cmd: cmd,
    Entrypoint: entrypoint,
    Env: envArr,
    WorkingDir: runtime?.workingDir,
    User: runtime?.user,
    OpenStdin: input.transport === 'stdio',
    AttachStdin: input.transport === 'stdio',
    AttachStdout: input.transport === 'stdio',
    AttachStderr: input.transport === 'stdio',
    Tty: false,
    Labels: { [MCP_LABEL]: 'true' },
    ExposedPorts: exposedPorts,
    HostConfig: {
      PortBindings: portBindings,
      RestartPolicy: { Name: input.transport === 'stdio' ? 'no' : 'unless-stopped' },
      Binds: binds.length > 0 ? binds : undefined,
      ExtraHosts: runtime?.extraHosts,
      Dns: runtime?.dns,
      NetworkMode: runtime?.networkMode,
      Privileged: runtime?.privileged,
      Devices: parseDevices(runtime?.devices),
      ShmSize: parseShmSize(runtime?.shmSize),
    },
  }
}

function selectNetworkProbeTool(tools: unknown[]): {
  name: string
  arguments: Record<string, unknown>
} | null {
  const toolList = Array.isArray(tools) ? tools : []

  for (const rawTool of toolList) {
    const tool = rawTool as {
      name?: string
      inputSchema?: {
        required?: string[]
        properties?: Record<string, unknown>
      }
    }
    const name = tool.name ?? ''
    if (!/(wikipedia|fetch|http|web|search)/i.test(name)) {
      continue
    }

    const required = Array.isArray(tool.inputSchema?.required)
      ? tool.inputSchema.required
      : []

    if (required.length === 0) {
      return { name, arguments: {} }
    }

    if (required.includes('url')) {
      return { name, arguments: { url: 'https://example.com' } }
    }
    if (required.includes('query')) {
      return { name, arguments: { query: 'OpenAI' } }
    }
    if (required.includes('q')) {
      return { name, arguments: { q: 'OpenAI' } }
    }
  }

  return null
}

async function resolveStdioContainer(idPrefix: string): Promise<{
  container: Docker.Container
  shortId: string
}> {
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

async function closeStdioProxySession(sessionId: string): Promise<void> {
  const session = stdioProxySessions.get(sessionId)
  if (!session || session.closed) return

  session.closed = true
  stdioProxySessions.delete(sessionId)

  try {
    ;(session.stream as unknown as Readable).destroy()
  } catch {
    // ignore stream close errors
  }

  const latest = await session.container.inspect().catch(() => null)
  if (latest?.State?.Running) {
    await session.container.stop().catch(() => undefined)
  }
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

fastify.get('/api/mcps', async () => {
  const list = await docker.listContainers({
    all: true,
    filters: JSON.stringify({ label: [`${MCP_LABEL}=true`] }),
  })
  const stored = loadData()
  return list.map((c) => ({
    id: c.Id.slice(0, 12),
    name: c.Names[0]?.replace('/', '') ?? c.Id.slice(0, 12),
    image: c.Image,
    status: c.State,
    ports: (Array.isArray(c.Ports) ? c.Ports : [])
      .filter((p) => p.PublicPort)
      .map((p) => p.PublicPort),
    meta: stored[c.Id.slice(0, 12)] ?? {},
  }))
})

// ─── GET /api/images ─────────────────────────────────────────────────────────

fastify.get('/api/images', async () => {
  const [images, containers] = await Promise.all([
    docker.listImages({ all: true }),
    docker.listContainers({ all: true }),
  ])

  const usageCountByImageId = new Map<string, number>()
  for (const container of containers) {
    const imageId = container.ImageID
    usageCountByImageId.set(imageId, (usageCountByImageId.get(imageId) ?? 0) + 1)
  }

  const result: DockerImageSummary[] = images
    .map((image) => {
      const tags = (image.RepoTags ?? []).filter((tag) => tag !== '<none>:<none>')
      const containersUsing = usageCountByImageId.get(image.Id) ?? 0
      const shortId = image.Id.replace(/^sha256:/, '').slice(0, 12)
      return {
        id: image.Id,
        shortId,
        tags,
        created: image.Created,
        size: image.Size,
        isDangling: tags.length === 0,
        inUse: containersUsing > 0,
        containersUsing,
      }
    })
    .sort((a, b) => b.created - a.created)

  return result
})

// ─── POST /api/images/pull ───────────────────────────────────────────────────

fastify.post<{ Body: PullImageBody }>('/api/images/pull', async (req, reply) => {
  const image = req.body?.image?.trim()
  if (!image) {
    return reply.code(400).send({ error: 'image is required' })
  }

  await pullImage(image)
  return { ok: true, image }
})

// ─── GET /api/images/pull/stream (SSE progress) ─────────────────────────────

fastify.get<{ Querystring: PullImageQuery }>(
  '/api/images/pull/stream',
  async (req, reply) => {
    const image = req.query?.image?.trim()
    if (!image) {
      return reply.code(400).send({ error: 'image is required' })
    }

    reply.hijack()
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })

    let stream: NodeJS.ReadableStream | undefined
    let closed = false
    const layerProgress = new Map<string, { current: number; total: number }>()

    const send = (payload: unknown) => {
      if (closed) return
      reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`)
    }

    req.raw.on('close', () => {
      closed = true
      ;(stream as Readable | undefined)?.destroy()
    })

    try {
      stream = await docker.pull(image)
      send({ type: 'start', image })

      await new Promise<void>((resolve, reject) => {
        docker.modem.followProgress(
          stream as NodeJS.ReadableStream,
          (err) => {
            if (err) return reject(err)
            resolve()
          },
          (event) => {
            const layerId = event.id ?? '_unknown'
            const previous = layerProgress.get(layerId) ?? { current: 0, total: 0 }
            let nextCurrent = Math.max(
              previous.current,
              Number(event.progressDetail?.current ?? 0),
            )
            const nextTotal = Math.max(
              previous.total,
              Number(event.progressDetail?.total ?? 0),
            )

            const statusText = (event.status ?? '').toLowerCase()
            const isLayerCompleted =
              statusText.includes('download complete') ||
              statusText.includes('pull complete') ||
              statusText.includes('already exists')

            if (isLayerCompleted && nextTotal > 0) {
              nextCurrent = nextTotal
            }

            layerProgress.set(layerId, { current: nextCurrent, total: nextTotal })

            let overallCurrent = 0
            let overallTotal = 0
            for (const value of layerProgress.values()) {
              overallCurrent += value.current
              overallTotal += value.total
            }

            const percent =
              overallTotal > 0
                ? Math.min(100, Math.floor((overallCurrent / overallTotal) * 100))
                : null

            send({
              type: 'progress',
              image,
              id: event.id,
              status: event.status,
              current: nextCurrent,
              total: nextTotal,
              overallCurrent,
              overallTotal,
              overallPercent: percent,
            })
          },
        )
      })

      send({ type: 'done', image })
      reply.raw.end()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'failed to pull image'
      send({ type: 'error', error: message })
      reply.raw.end()
    }
  },
)

// ─── DELETE /api/images/:id ──────────────────────────────────────────────────

fastify.delete<{ Params: { id: string } }>('/api/images/:id', async (req, reply) => {
  const idParam = req.params.id.trim()
  if (!idParam) {
    return reply.code(400).send({ error: 'image id is required' })
  }

  const [images, containers] = await Promise.all([
    docker.listImages({ all: true }),
    docker.listContainers({ all: true }),
  ])

  const match = images.find((image) => {
    const full = image.Id
    const noPrefix = full.replace(/^sha256:/, '')
    return full === idParam || noPrefix === idParam || noPrefix.startsWith(idParam)
  })

  if (!match) {
    return reply.code(404).send({ error: 'image not found' })
  }

  const containersUsing = containers.filter((container) => container.ImageID === match.Id)
  if (containersUsing.length > 0) {
    return reply.code(409).send({
      error: 'image is in use by containers',
      containersUsing: containersUsing.length,
    })
  }

  await docker.getImage(match.Id).remove()
  return { ok: true }
})

// ─── GET /api/volumes ────────────────────────────────────────────────────────

fastify.get('/api/volumes', async () => {
  const [volumeData, containers] = await Promise.all([
    docker.listVolumes(),
    docker.listContainers({ all: true }),
  ])

  const usageCountByVolumeName = new Map<string, number>()
  for (const container of containers) {
    for (const mount of container.Mounts ?? []) {
      if (mount.Type === 'volume' && mount.Name) {
        usageCountByVolumeName.set(
          mount.Name,
          (usageCountByVolumeName.get(mount.Name) ?? 0) + 1,
        )
      }
    }
  }

  const volumes = (volumeData.Volumes ?? [])
    .map((volume) => {
      const containersUsing = usageCountByVolumeName.get(volume.Name) ?? 0
      return {
        name: volume.Name,
        driver: volume.Driver,
        mountpoint: volume.Mountpoint,
        createdAt: (volume as { CreatedAt?: string }).CreatedAt ?? '',
        scope: volume.Scope,
        inUse: containersUsing > 0,
        containersUsing,
      } as DockerVolumeSummary
    })
    .sort((a, b) => a.name.localeCompare(b.name))

  return volumes
})

// ─── DELETE /api/volumes/:name ───────────────────────────────────────────────

fastify.delete<{ Params: { name: string } }>(
  '/api/volumes/:name',
  async (req, reply) => {
    const name = req.params.name.trim()
    if (!name) {
      return reply.code(400).send({ error: 'volume name is required' })
    }

    const [volumeData, containers] = await Promise.all([
      docker.listVolumes(),
      docker.listContainers({ all: true }),
    ])

    const exists = (volumeData.Volumes ?? []).some((volume) => volume.Name === name)
    if (!exists) {
      return reply.code(404).send({ error: 'volume not found' })
    }

    const containersUsing = containers.filter((container) =>
      (container.Mounts ?? []).some(
        (mount) => mount.Type === 'volume' && mount.Name === name,
      ),
    )

    if (containersUsing.length > 0) {
      return reply.code(409).send({
        error: 'volume is in use by containers',
        containersUsing: containersUsing.length,
      })
    }

    await docker.getVolume(name).remove()
    return { ok: true }
  },
)

// ─── POST /api/deploy ─────────────────────────────────────────────────────────

fastify.post<{ Body: DeployBody }>('/api/deploy', async (req, reply) => {
  const { name, image, command, env = {}, port, transport = 'http', runtime } = req.body ?? {}

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
    const { name, image, command, env = {}, port, transport = 'http', runtime } = req.body ?? {}

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
      }),
    )

    if (transport !== 'stdio') {
      await container.start()
    }

    const newShortId = container.id.slice(0, 12)
    const data = loadData()
    delete data[oldShortId]
    data[newShortId] = {
      name: name.trim(),
      image: image.trim(),
      command,
      env,
      port,
      transport,
      runtime: normalizedRuntime,
    }
    saveData(data)

    return { id: newShortId, status: transport === 'stdio' ? 'created' : 'running' }
  },
)

// ─── WS /api/stdio/session/:id (interactive stdio bridge) ──────────────────

fastify.get<{ Params: { id: string } }>(
  '/api/stdio/session/:id',
  { websocket: true },
  async (socket, req) => {
    let container: Docker.Container

    try {
      const resolved = await resolveStdioContainer(req.params.id)
      container = resolved.container
    } catch (err) {
      socket.send(
        JSON.stringify({
          type: 'error',
          error: err instanceof Error ? err.message : 'failed to open session',
        }),
      )
      socket.close()
      return
    }

    const stream = await container.attach({
      stream: true,
      stdin: true,
      stdout: true,
      stderr: true,
      logs: false,
      hijack: true,
    })

    socket.send(JSON.stringify({ type: 'ready' }))

    const decodeChunk = createDockerMultiplexDecoder((payload) => {
      socket.send(JSON.stringify({ type: 'output', data: payload }))
    })

    stream.on('data', (chunk: Buffer) => {
      decodeChunk(chunk)
    })

    const closeSession = async () => {
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

    socket.on('message', (raw: unknown) => {
      try {
        const message = JSON.parse(String(raw)) as StdioWsMessage
        if (message.type !== 'input') return
        stream.write(message.data ?? '')
      } catch {
        // ignore malformed client frames
      }
    })

    socket.on('close', () => {
      void closeSession()
    })
  },
)

// ─── GET /api/stdio/proxy/:id/sse (external MCP SSE adapter) ───────────────

fastify.get<{ Params: { id: string } }>('/api/stdio/proxy/:id/sse', async (req, reply) => {
  let container: Docker.Container

  try {
    const resolved = await resolveStdioContainer(req.params.id)
    container = resolved.container
  } catch (err) {
    return reply
      .code(404)
      .send({ error: err instanceof Error ? err.message : 'container not found' })
  }

  const stream = await container.attach({
    stream: true,
    stdin: true,
    stdout: true,
    stderr: true,
    logs: false,
    hijack: true,
  })

  const sessionId = randomUUID()
  stdioProxySessions.set(sessionId, {
    sessionId,
    container,
    stream,
    closed: false,
  })

  reply.hijack()
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })

  const sendEvent = (event: string, data: string) => {
    reply.raw.write(`event: ${event}\n`)
    reply.raw.write(`data: ${data}\n\n`)
  }

  const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? req.protocol
  const host = req.headers.host
  const endpointUrl = `${proto}://${host}/api/stdio/proxy/${req.params.id}/message?sessionId=${sessionId}`
  sendEvent('endpoint', endpointUrl)

  const onStdoutLine = createLineDecoder((line) => {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>
      sendEvent('message', JSON.stringify(parsed))
    } catch {
      // ignore non-JSON lines from stdout
    }
  })

  const decodeChunk = createDockerMultiplexDecoder((payload, streamType) => {
    if (streamType === 1) {
      onStdoutLine(payload)
    }
  })

  stream.on('data', (chunk: Buffer) => {
    decodeChunk(chunk)
  })

  stream.on('end', () => {
    sendEvent('close', JSON.stringify({ reason: 'stream ended' }))
    reply.raw.end()
    void closeStdioProxySession(sessionId)
  })

  stream.on('error', (err: Error) => {
    sendEvent('error', JSON.stringify({ error: err.message }))
    reply.raw.end()
    void closeStdioProxySession(sessionId)
  })

  req.raw.on('close', () => {
    reply.raw.end()
    void closeStdioProxySession(sessionId)
  })
})

// ─── GET /api/stdio/health/:id?probe=network ────────────────────────────────

fastify.get<{ Params: { id: string }; Querystring: StdioHealthQuery }>(
  '/api/stdio/health/:id',
  async (req, reply) => {
    let container: Docker.Container

    try {
      const resolved = await resolveStdioContainer(req.params.id)
      container = resolved.container
    } catch (err) {
      return reply
        .code(404)
        .send({ error: err instanceof Error ? err.message : 'container not found' })
    }

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
      try {
        jsonQueue.push(JSON.parse(line) as Record<string, unknown>)
      } catch {
        nonJsonStdoutLines.push(line)
      }
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

    const networkProbe: {
      attempted: boolean
      ok: boolean | null
      toolName?: string
      reason?: string
      error?: string
    } = {
      attempted: false,
      ok: null,
    }

    try {
      writeRpc({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'mcp-hub-health', version: '1.0.0' },
        },
      })

      const initializeResponse = await waitForMessage((msg) => Number(msg.id) === 1, 5000)
      initializeOk = !!initializeResponse?.result && !initializeResponse?.error

      writeRpc({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })
      writeRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })

      const toolsResponse = await waitForMessage((msg) => Number(msg.id) === 2, 5000)
      const toolsResult = (toolsResponse?.result ?? {}) as {
        tools?: unknown[]
      }
      const tools = Array.isArray(toolsResult.tools) ? toolsResult.tools : []
      toolsListOk = !!toolsResponse?.result && !toolsResponse?.error
      toolCount = tools.length

      if (req.query?.probe === 'network' && toolsListOk) {
        const probe = selectNetworkProbeTool(tools)
        if (!probe) {
          networkProbe.attempted = false
          networkProbe.ok = null
          networkProbe.reason = 'no suitable network tool found'
        } else {
          networkProbe.attempted = true
          networkProbe.toolName = probe.name

          writeRpc({
            jsonrpc: '2.0',
            id: 3,
            method: 'tools/call',
            params: {
              name: probe.name,
              arguments: probe.arguments,
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

          const responseIssues = detectNetworkIssues(
            [responseText, probeFailureText].filter(Boolean),
          )

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

    const status =
      !initializeOk || !toolsListOk
        ? 'unhealthy'
        : combinedIssues.length > 0 || networkProbe.ok === false
          ? 'degraded'
          : 'healthy'

    return {
      id: req.params.id,
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
  },
)

// ─── POST /api/stdio/proxy/:id/message?sessionId=... ────────────────────────

fastify.post<{
  Params: { id: string }
  Querystring: StdioProxyMessageQuery
  Body: Record<string, unknown>
}>('/api/stdio/proxy/:id/message', async (req, reply) => {
  const sessionId = req.query.sessionId?.trim()
  if (!sessionId) {
    return reply.code(400).send({ error: 'sessionId is required' })
  }

  const session = stdioProxySessions.get(sessionId)
  if (!session || session.closed) {
    return reply.code(404).send({ error: 'session not found' })
  }

  const payload = req.body
  if (!payload || typeof payload !== 'object') {
    return reply.code(400).send({ error: 'json body is required' })
  }

  const wire = `${JSON.stringify(payload)}\n`
  session.stream.write(wire)

  return reply.code(202).send({ ok: true })
})

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

    if (action === 'start') {
      await container.start()
    } else if (action === 'stop') {
      await container.stop().catch(() => undefined)
    } else if (action === 'remove') {
      if (match.State === 'running') await container.stop().catch(() => undefined)
      await container.remove()
      const data = loadData()
      delete data[req.params.id]
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
