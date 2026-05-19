import { FastifyInstance } from 'fastify'
import Docker from 'dockerode'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'

interface BuildImageRoutesOptions {
  docker: Docker
}

interface BuildImageRequest {
  dockerfile: string
  imageName: string
  tag?: string
  buildArgs?: Record<string, string>
  platform?: string
}

interface BuildProgress {
  type: 'start' | 'progress' | 'done' | 'error'
  status?: string
  percent?: number
  image?: string
  error?: string
  digest?: string
}

export function registerBuildImageRoutes(
  fastify: FastifyInstance,
  options: BuildImageRoutesOptions
): void {
  const { docker } = options

  // POST /api/docker/build - Start building a Docker image
  fastify.post<{ Body: BuildImageRequest }>('/api/docker/build', async (req, reply) => {
    const { dockerfile, imageName, tag = 'latest', buildArgs, platform } = req.body ?? {}

    if (!dockerfile?.trim()) {
      return reply.code(400).send({ error: 'dockerfile is required' })
    }

    if (!imageName?.trim()) {
      return reply.code(400).send({ error: 'imageName is required' })
    }

    const imageTag = `${imageName.trim()}:${tag.trim()}`
    console.error(`[buildImage] Starting build: ${imageTag}`)

    return { success: true, imageTag }
  })

  // GET /api/docker/build/stream - Stream build progress via SSE
  fastify.get<{ Querystring: { dockerfile: string; imageName: string; tag?: string; buildArgs?: string; platform?: string } }>(
    '/api/docker/build/stream',
    async (req, reply) => {
      const { dockerfile, imageName, tag = 'latest', buildArgs: buildArgsStr, platform } = req.query
      const tmpDir = join(tmpdir(), `docker-build-${Date.now()}`)
      let isClosed = false

      if (!dockerfile?.trim()) {
        reply.code(400)
        return reply.send({ error: 'dockerfile query parameter is required' })
      }

      if (!imageName?.trim()) {
        reply.code(400)
        return reply.send({ error: 'imageName query parameter is required' })
      }

      // Decode dockerfile from base64
      const dockerfileContent = Buffer.from(dockerfile, 'base64').toString('utf-8')
      const imageTag = `${imageName.trim()}:${tag.trim()}`
      const buildArgs = buildArgsStr ? JSON.parse(buildArgsStr) : {}

      console.error(`[buildImage] Build started: ${imageTag}`)

      // Create temp directory and write Dockerfile
      mkdirSync(tmpDir, { recursive: true })
      writeFileSync(join(tmpDir, 'Dockerfile'), dockerfileContent)

      // Setup SSE
      reply.hijack()
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })

      const send = (payload: BuildProgress) => {
        if (isClosed) return
        reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`)
      }

      // Monitor for client disconnect
      req.raw.on('close', () => {
        isClosed = true
      })

      try {
        send({ type: 'start', status: `Building ${imageTag}...` })

        // Build Docker image
        const buildOptions: Record<string, unknown> = {
          t: imageTag,
          dockerfile: 'Dockerfile',
        }

        if (platform) {
          buildOptions.platform = platform
        }

        if (buildArgs && Object.keys(buildArgs).length > 0) {
          buildOptions.buildargs = buildArgs
        }

        const buildStream = await docker.buildImage(
          {
            context: tmpDir,
            src: ['Dockerfile'],
          },
          buildOptions
        )

        let lastProgressPercent = 0
        const layerProgress = new Map<string, { current: number; total: number }>()

        await new Promise<void>((resolve, reject) => {
          docker.modem.followProgress(
            buildStream,
            (err: Error | null) => {
              if (err) {
                console.error(`[buildImage] Build failed: ${err.message}`)
                send({ type: 'error', error: err.message })
                reject(err)
                return
              }

              console.error(`[buildImage] Build completed: ${imageTag}`)
              send({ type: 'done', status: 'Build completed', image: imageTag, percent: 100 })
              resolve()
            },
            (event: Record<string, unknown>) => {
              // Parse Docker build output
              if (event.error) {
                send({ type: 'error', error: String(event.error) })
                return
              }

              // Track progress by layer
              if (event.id && event.progressDetail) {
                const progressDetail = event.progressDetail as { current?: number; total?: number }
                const { current, total } = progressDetail
                if (current && total) {
                  layerProgress.set(String(event.id), { current, total })

                  // Calculate overall progress
                  let totalBytes = 0
                  let completedBytes = 0
                  for (const [, progress] of layerProgress) {
                    totalBytes += progress.total
                    completedBytes += progress.current
                  }

                  if (totalBytes > 0) {
                    lastProgressPercent = Math.round((completedBytes / totalBytes) * 100)
                  }
                }
              }

              // Send status update
              const status = String(event.stream || event.status || '').trim()
              if (status) {
                send({
                  type: 'progress',
                  status,
                  percent: Math.min(lastProgressPercent, 99),
                  digest: String(event.id || ''),
                })
              }
            }
          )
        })
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        console.error(`[buildImage] Error: ${errorMessage}`)
        send({ type: 'error', error: errorMessage })
      } finally {
        // Cleanup temp directory
        try {
          rmSync(tmpDir, { recursive: true, force: true })
          console.error(`[buildImage] Cleaned up temp directory: ${tmpDir}`)
        } catch (err) {
          console.error(`[buildImage] Cleanup error:`, err instanceof Error ? err.message : String(err))
        }
      }
    }
  )
}
