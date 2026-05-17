import type { FastifyInstance } from 'fastify'
import fs from 'node:fs'
import path from 'node:path'
import { getMimeType } from '../utils/mimeTypes.js'

interface SharedFilesRouteOptions {
  sharedDataDir: string
}

export function registerSharedFilesRoutes(
  fastify: FastifyInstance,
  options: SharedFilesRouteOptions,
): void {
  const { sharedDataDir } = options

  fastify.get<{ Params: { folder: string; filename: string } }>(
    '/api/shared-files/:folder/:filename',
    async (req, reply) => {
      const { folder, filename } = req.params

      if (!folder || !filename) {
        return reply.code(400).send({ error: 'folder and filename are required' })
      }

      const filePath = path.join(sharedDataDir, folder, filename)

      if (!filePath.startsWith(sharedDataDir)) {
        return reply.code(403).send({ error: 'Path traversal denied' })
      }

      try {
        if (!fs.existsSync(filePath)) {
          return reply.code(404).send({ error: 'File not found' })
        }

        const stat = fs.statSync(filePath)
        if (stat.isDirectory()) {
          return reply.code(400).send({ error: 'Path is a directory' })
        }

        const mimeType = getMimeType(filePath)
        reply.type(mimeType)

        const stream = fs.createReadStream(filePath)
        return reply.send(stream)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        return reply.code(500).send({ error: message })
      }
    },
  )
}
