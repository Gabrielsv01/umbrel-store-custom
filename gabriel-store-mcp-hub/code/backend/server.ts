import Fastify from 'fastify'
import cors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import Docker from 'dockerode'
import fs from 'node:fs'
import path from 'node:path'
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
}

interface UpdateBody {
  name: string
  image: string
  command?: string
  env?: Record<string, string>
  port?: number | string
}

interface ActionBody {
  action: 'start' | 'stop' | 'remove'
}

interface PullImageBody {
  image: string
}

interface PullImageQuery {
  image?: string
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

// ─── Bootstrap ────────────────────────────────────────────────────────────────

ensureDataDir()
await fastify.register(cors, { origin: true })

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
    ports: c.Ports.filter((p) => p.PublicPort).map((p) => p.PublicPort),
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
  const { name, image, command, env = {}, port } = req.body ?? {}

  if (!name?.trim() || !image?.trim()) {
    return reply.code(400).send({ error: 'name and image are required' })
  }

  await ensureImageAvailable(image.trim())

  const envArr = Object.entries(env)
    .filter(([k]) => k.trim())
    .map(([k, v]) => `${k.trim()}=${v}`)

  const cmd = command?.trim() ? command.trim().split(/\s+/) : undefined

  const portStr = port ? String(port) : undefined
  const exposedPorts: Record<string, Record<string, never>> = portStr
    ? { [`${portStr}/tcp`]: {} }
    : {}
  const portBindings: Docker.PortMap = portStr
    ? { [`${portStr}/tcp`]: [{ HostPort: portStr }] }
    : {}

  const container = await docker.createContainer({
    name: name.trim(),
    Image: image.trim(),
    Cmd: cmd,
    Env: envArr,
    Labels: { [MCP_LABEL]: 'true' },
    ExposedPorts: exposedPorts,
    HostConfig: {
      PortBindings: portBindings,
      RestartPolicy: { Name: 'unless-stopped' },
    },
  })

  await container.start()

  const shortId = container.id.slice(0, 12)
  const data = loadData()
  data[shortId] = { name: name.trim(), image: image.trim(), command, env, port }
  saveData(data)

  return { id: shortId, status: 'running' }
})

// ─── PUT /api/mcps/:id (recreate container with updated config) ─────────────

fastify.put<{ Params: { id: string }; Body: UpdateBody }>(
  '/api/mcps/:id',
  async (req, reply) => {
    const { name, image, command, env = {}, port } = req.body ?? {}

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

    const envArr = Object.entries(env)
      .filter(([k]) => k.trim())
      .map(([k, v]) => `${k.trim()}=${v}`)

    const cmd = command?.trim() ? command.trim().split(/\s+/) : undefined
    const portStr = port ? String(port) : undefined
    const exposedPorts: Record<string, Record<string, never>> = portStr
      ? { [`${portStr}/tcp`]: {} }
      : {}
    const portBindings: Docker.PortMap = portStr
      ? { [`${portStr}/tcp`]: [{ HostPort: portStr }] }
      : {}

    await oldContainer.stop().catch(() => undefined)
    await oldContainer.remove()

    const container = await docker.createContainer({
      name: name.trim(),
      Image: image.trim(),
      Cmd: cmd,
      Env: envArr,
      Labels: { [MCP_LABEL]: 'true' },
      ExposedPorts: exposedPorts,
      HostConfig: {
        PortBindings: portBindings,
        RestartPolicy: { Name: 'unless-stopped' },
      },
    })

    await container.start()

    const newShortId = container.id.slice(0, 12)
    const data = loadData()
    delete data[oldShortId]
    data[newShortId] = {
      name: name.trim(),
      image: image.trim(),
      command,
      env,
      port,
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

  stream.on('data', (chunk: Buffer) => {
    // Docker multiplexed stream has an 8-byte header per frame
    let offset = 0
    while (offset < chunk.length) {
      if (chunk.length < offset + 8) break
      const size = chunk.readUInt32BE(offset + 4)
      const payload = chunk.slice(offset + 8, offset + 8 + size).toString('utf8')
      reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`)
      offset += 8 + size
    }
  })

  stream.on('end', () => reply.raw.end())
  req.raw.on('close', () => (stream as Readable).destroy())
})

// ─── Start ────────────────────────────────────────────────────────────────────

await fastify.listen({ port: 3001, host: '0.0.0.0' })
console.log('MCP Hub backend listening on :3001')
