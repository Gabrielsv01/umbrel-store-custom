import { useCallback, useState } from 'react'
import { listVolumes, removeVolume } from '../services/api'
import type { VolumeRecord } from '../types/resources'
import { toErrorMessage } from '../utils/error'

export function useVolumes() {
  const [showVolumes, setShowVolumes] = useState(false)
  const [volumes, setVolumes] = useState<VolumeRecord[]>([])
  const [volumesLoading, setVolumesLoading] = useState(false)
  const [volumesError, setVolumesError] = useState<string | null>(null)
  const [removingVolumeName, setRemovingVolumeName] = useState<string | null>(null)

  const fetchVolumes = useCallback(async () => {
    setVolumesLoading(true)
    setVolumesError(null)
    try {
      const data = await listVolumes()
      setVolumes(data)
    } catch (err) {
      setVolumesError(toErrorMessage(err, 'Failed to fetch volumes'))
    } finally {
      setVolumesLoading(false)
    }
  }, [])

  const openVolumes = useCallback(async () => {
    setShowVolumes(true)
    await fetchVolumes()
  }, [fetchVolumes])

  const closeVolumes = useCallback(() => {
    setShowVolumes(false)
  }, [])

  const handleRemoveVolume = useCallback(
    async (volume: VolumeRecord) => {
      if (volume.inUse) return
      const confirmed = window.confirm(`Remove volume ${volume.name}?`)
      if (!confirmed) return

      setRemovingVolumeName(volume.name)
      setVolumesError(null)
      try {
        await removeVolume(volume.name)
        await fetchVolumes()
      } catch (err) {
        setVolumesError(toErrorMessage(err, 'Failed to remove volume'))
      } finally {
        setRemovingVolumeName(null)
      }
    },
    [fetchVolumes],
  )

  return {
    showVolumes,
    volumes,
    volumesLoading,
    volumesError,
    removingVolumeName,
    fetchVolumes,
    openVolumes,
    closeVolumes,
    handleRemoveVolume,
  }
}
