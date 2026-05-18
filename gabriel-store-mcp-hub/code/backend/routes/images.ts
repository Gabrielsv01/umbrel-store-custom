import type { FastifyInstance } from 'fastify'
import { Readable } from 'node:stream'
import type {
  DockerImageSummary,
  ImageRoutesDeps,
  PullImageBody,
  PullImageQuery,
} from '../types/resources.js'

export function registerImageRoutes(fastify: FastifyInstance, deps: ImageRoutesDeps): void {
  const { docker, pullImage, loadImagePlatforms, recordImagePlatform } = deps

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

    const imagePlatforms = loadImagePlatforms()

    const result: DockerImageSummary[] = images
      .map((image) => {
        const tags = (image.RepoTags ?? []).filter((tag) => tag !== '<none>:<none>')
        const containersUsing = usageCountByImageId.get(image.Id) ?? 0
        const shortId = image.Id.replace(/^sha256:/, '').slice(0, 12)
        const platform = tags.length > 0 ? imagePlatforms[tags[0]!.toLowerCase()] : undefined
        return {
          id: image.Id,
          shortId,
          tags,
          created: image.Created,
          size: image.Size,
          isDangling: tags.length === 0,
          inUse: containersUsing > 0,
          containersUsing,
          platform,
        }
      })
      .sort((a, b) => b.created - a.created)

    return result
  })

  fastify.post<{ Body: PullImageBody }>('/api/images/pull', async (req, reply) => {
    const image = req.body?.image?.trim()
    const platform = req.body?.platform?.trim()
    if (!image) {
      return reply.code(400).send({ error: 'image is required' })
    }

    await pullImage(image, platform)
    return { ok: true, image, platform }
  })

  fastify.get<{ Querystring: PullImageQuery }>(
    '/api/images/pull/stream',
    async (req, reply) => {
      const image = req.query?.image?.trim()
      const platform = req.query?.platform?.trim()
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
        const options = platform ? { platform } : {}
        stream = await docker.pull(image, options)
        send({ type: 'start', image })

        await new Promise<void>((resolve, reject) => {
          docker.modem.followProgress(
            stream as NodeJS.ReadableStream,
            (err) => {
              if (err) return reject(err)
              recordImagePlatform(image, platform)
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
}
