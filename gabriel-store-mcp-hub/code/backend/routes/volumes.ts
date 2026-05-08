import type { FastifyInstance } from 'fastify'
import type { DockerVolumeSummary, VolumeRoutesDeps } from '../types/resources.js'

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
}
