import type { FastifyInstance } from 'fastify'
import type { DockerVolumeSummary, VolumeRoutesDeps } from '../types/resources.js'
import path from 'node:path'
import { getMimeType } from '../utils/mimeTypes.js'

interface FileInfo {
  name: string
  isDirectory: boolean
  size?: number
  modified?: string
}

async function execInContainer(docker: any, containerId: string, cmd: string[]): Promise<string> {
  const exec = await docker.getContainer(containerId).exec({
    Cmd: cmd,
    AttachStdout: true,
    AttachStderr: true,
  })

  const stream = await exec.start({ Detach: false })
  const chunks: Buffer[] = []

  return new Promise((resolve, reject) => {
    stream.on('data', (chunk: Buffer) => chunks.push(chunk))
    stream.on('end', () => resolve(Buffer.concat(chunks).toString().trim()))
    stream.on('error', reject)
  })
}

export function registerVolumeRoutes(fastify: FastifyInstance, deps: VolumeRoutesDeps): void {
  const { docker } = deps

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

  fastify.get<{ Params: { volumeName: string }; Querystring: { dirPath?: string } }>(
    '/api/volumes/:volumeName/browse',
    async (req, reply) => {
      const { volumeName } = req.params
      const dirPath = req.query.dirPath || '/'

      try {
        const volumes = await docker.listVolumes()
        const volume = volumes.Volumes?.find(v => v.Name === volumeName)

        if (!volume) {
          return reply.code(404).send({ error: 'Volume not found' })
        }

        const containers = await docker.listContainers({ all: true })
        const containerWithVolume = containers.find(c =>
          (c.Mounts ?? []).some(m => m.Type === 'volume' && m.Name === volumeName),
        )

        if (!containerWithVolume) {
          return reply.code(404).send({ error: 'No running container has this volume mounted' })
        }

        const containerMountPath = (containerWithVolume.Mounts ?? []).find(
          m => m.Type === 'volume' && m.Name === volumeName,
        )?.Destination

        if (!containerMountPath) {
          return reply.code(500).send({ error: 'Could not determine mount path' })
        }

        const targetPath = dirPath === '/' ? containerMountPath : `${containerMountPath}${dirPath}`
        const safePath = targetPath.replaceAll('..', '')

        const lsOutput = await execInContainer(docker, containerWithVolume.Id, [
          'ls',
          '-lA',
          safePath,
        ])

        const fileList: FileInfo[] = lsOutput
          .split('\n')
          .filter(line => line.trim() && !line.trim().startsWith('total'))
          .map(line => {
            const trimmedLine = line.trim()
            if (!trimmedLine) return null
            const parts = trimmedLine.split(/\s+/)
            if (parts.length < 9) return null
            const isDir = trimmedLine.startsWith('d')
            const name = parts.slice(8).join(' ')
            if (!name) return null
            const size = isDir ? undefined : Number.parseInt(parts[4])
            return { name, isDirectory: isDir, size } as FileInfo | null
          })
          .filter((f): f is FileInfo => f !== null)
          .sort((a, b) => {
            if (a.isDirectory !== b.isDirectory) {
              return a.isDirectory ? -1 : 1
            }
            return a.name.localeCompare(b.name)
          })

        return reply.send({
          volumeName,
          currentPath: dirPath,
          files: fileList,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        return reply.code(500).send({ error: message })
      }
    },
  )

  fastify.get<{ Params: { volumeName: string }; Querystring: { filePath?: string } }>(
    '/api/volumes/:volumeName/download',
    async (req, reply) => {
      const { volumeName } = req.params
      const { filePath: requestPath } = req.query

      if (!requestPath) {
        return reply.code(400).send({ error: 'filePath is required' })
      }

      try {
        const volumes = await docker.listVolumes()
        const volume = volumes.Volumes?.find(v => v.Name === volumeName)

        if (!volume) {
          return reply.code(404).send({ error: 'Volume not found' })
        }

        const containers = await docker.listContainers({ all: true })
        const containerWithVolume = containers.find(c =>
          (c.Mounts ?? []).some(m => m.Type === 'volume' && m.Name === volumeName),
        )

        if (!containerWithVolume) {
          return reply.code(404).send({ error: 'No running container has this volume mounted' })
        }

        const containerMountPath = (containerWithVolume.Mounts ?? []).find(
          m => m.Type === 'volume' && m.Name === volumeName,
        )?.Destination

        if (!containerMountPath) {
          return reply.code(500).send({ error: 'Could not determine mount path' })
        }

        const targetPath = requestPath === '/' ? containerMountPath : `${containerMountPath}${requestPath}`
        const safePath = targetPath.replaceAll('..', '')

        const fileContent = await execInContainer(docker, containerWithVolume.Id, [
          'cat',
          safePath,
        ])

        const mimeType = getMimeType(safePath)
        const fileName = path.basename(safePath)

        reply.type(mimeType)
        reply.header('Content-Disposition', `attachment; filename="${fileName}"`)
        return reply.send(fileContent)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        return reply.code(500).send({ error: message })
      }
    },
  )

  fastify.delete<{ Params: { volumeName: string }; Querystring: { filePath?: string } }>(
    '/api/volumes/:volumeName/file',
    async (req, reply) => {
      const { volumeName } = req.params
      const { filePath: requestPath } = req.query

      if (!requestPath) {
        return reply.code(400).send({ error: 'filePath is required' })
      }

      try {
        const volumes = await docker.listVolumes()
        const volume = volumes.Volumes?.find(v => v.Name === volumeName)

        if (!volume) {
          return reply.code(404).send({ error: 'Volume not found' })
        }

        const containers = await docker.listContainers({ all: true })
        const containerWithVolume = containers.find(c =>
          (c.Mounts ?? []).some(m => m.Type === 'volume' && m.Name === volumeName),
        )

        if (!containerWithVolume) {
          return reply.code(404).send({ error: 'No running container has this volume mounted' })
        }

        const containerMountPath = (containerWithVolume.Mounts ?? []).find(
          m => m.Type === 'volume' && m.Name === volumeName,
        )?.Destination

        if (!containerMountPath) {
          return reply.code(500).send({ error: 'Could not determine mount path' })
        }

        const targetPath = requestPath === '/' ? containerMountPath : `${containerMountPath}${requestPath}`
        const safePath = targetPath.replaceAll('..', '')

        await execInContainer(docker, containerWithVolume.Id, ['rm', '-rf', safePath])

        return reply.send({ success: true, message: 'Deleted successfully' })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        return reply.code(500).send({ error: message })
      }
    },
  )
}
