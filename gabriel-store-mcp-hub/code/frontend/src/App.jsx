import { useState, useEffect, useCallback } from 'react'
import MCPCard from './components/MCPCard'
import DeployForm from './components/DeployForm'
import LogConsole from './components/LogConsole'
import StdioConsole from './components/StdioConsole'
import ImagesModal from './components/ImagesModal'
import VolumesModal from './components/VolumesModal'

export default function App() {
  const [mcps, setMcps] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingMcp, setEditingMcp] = useState(null)
  const [showImages, setShowImages] = useState(false)
  const [images, setImages] = useState([])
  const [imagesLoading, setImagesLoading] = useState(false)
  const [imagesError, setImagesError] = useState(null)
  const [removingImageId, setRemovingImageId] = useState(null)
  const [pullingImage, setPullingImage] = useState(false)
  const [pullProgress, setPullProgress] = useState(null)
  const [showVolumes, setShowVolumes] = useState(false)
  const [volumes, setVolumes] = useState([])
  const [volumesLoading, setVolumesLoading] = useState(false)
  const [volumesError, setVolumesError] = useState(null)
  const [removingVolumeName, setRemovingVolumeName] = useState(null)
  const [logTarget, setLogTarget] = useState(null) // { id, name }
  const [stdioTarget, setStdioTarget] = useState(null) // { id, name }
  const [actionLoading, setActionLoading] = useState({})

  const fetchMCPs = useCallback(async () => {
    try {
      const res = await fetch('/api/mcps')
      const data = await res.json()
      setMcps(Array.isArray(data) ? data : [])
    } catch {
      // silently retry on next tick
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchMCPs()
    const interval = setInterval(fetchMCPs, 5000)
    return () => clearInterval(interval)
  }, [fetchMCPs])

  const handleDeploy = async (formData) => {
    const res = await fetch('/api/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData),
    })
    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.error || 'Deploy failed')
    }
    setShowForm(false)
    await fetchMCPs()
  }

  const handleAction = async (id, action) => {
    setActionLoading((prev) => ({ ...prev, [id]: action }))
    try {
      await fetch(`/api/action/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      await fetchMCPs()
    } finally {
      setActionLoading((prev) => ({ ...prev, [id]: null }))
    }
  }

  const handleUpdate = async (formData) => {
    if (!editingMcp) return

    const res = await fetch(`/api/mcps/${editingMcp.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData),
    })

    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.error || 'Update failed')
    }

    setEditingMcp(null)
    await fetchMCPs()
  }

  const fetchImages = useCallback(async () => {
    setImagesLoading(true)
    setImagesError(null)
    try {
      const res = await fetch('/api/images')
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to fetch images')
      }
      const data = await res.json()
      setImages(Array.isArray(data) ? data : [])
    } catch (err) {
      setImagesError(err.message || 'Failed to fetch images')
    } finally {
      setImagesLoading(false)
    }
  }, [])

  const openImages = async () => {
    setShowImages(true)
    await fetchImages()
  }

  const handleRemoveImage = async (image) => {
    if (image.inUse) return
    const label = image.tags?.[0] || image.shortId
    const confirmed = window.confirm(`Remove image ${label}?`)
    if (!confirmed) return

    setRemovingImageId(image.id)
    setImagesError(null)
    try {
      const res = await fetch(`/api/images/${image.shortId}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to remove image')
      }
      await fetchImages()
    } catch (err) {
      setImagesError(err.message || 'Failed to remove image')
    } finally {
      setRemovingImageId(null)
    }
  }

  const handlePullImage = async (imageRef, onSuccess) => {
    const ref = imageRef.trim()
    if (!ref) return

    setPullingImage(true)
    setImagesError(null)
    setPullProgress({ image: ref, status: 'Starting pull…', percent: null })

    try {
      await new Promise((resolve, reject) => {
        const source = new EventSource(
          `/api/images/pull/stream?image=${encodeURIComponent(ref)}`,
        )

        source.onmessage = (event) => {
          try {
            const payload = JSON.parse(event.data)

            if (payload.type === 'progress') {
              setPullProgress({
                image: ref,
                status: payload.status || 'Pulling…',
                id: payload.id || null,
                current: Number(payload.overallCurrent) || 0,
                total: Number(payload.overallTotal) || 0,
                percent:
                  typeof payload.overallPercent === 'number'
                    ? payload.overallPercent
                    : null,
              })
              return
            }

            if (payload.type === 'done') {
              source.close()
              resolve()
              return
            }

            if (payload.type === 'error') {
              source.close()
              reject(new Error(payload.error || 'Failed to pull image'))
            }
          } catch {
            source.close()
            reject(new Error('Failed to parse pull progress'))
          }
        }

        source.onerror = () => {
          source.close()
          reject(new Error('Pull connection failed'))
        }
      })

      if (typeof onSuccess === 'function') onSuccess()
      await fetchImages()
    } catch (err) {
      setImagesError(err.message || 'Failed to pull image')
    } finally {
      setPullingImage(false)
      setPullProgress(null)
    }
  }

  const fetchVolumes = useCallback(async () => {
    setVolumesLoading(true)
    setVolumesError(null)
    try {
      const res = await fetch('/api/volumes')
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to fetch volumes')
      }
      const data = await res.json()
      setVolumes(Array.isArray(data) ? data : [])
    } catch (err) {
      setVolumesError(err.message || 'Failed to fetch volumes')
    } finally {
      setVolumesLoading(false)
    }
  }, [])

  const openVolumes = async () => {
    setShowVolumes(true)
    await fetchVolumes()
  }

  const handleRemoveVolume = async (volume) => {
    if (volume.inUse) return
    const confirmed = window.confirm(`Remove volume ${volume.name}?`)
    if (!confirmed) return

    setRemovingVolumeName(volume.name)
    setVolumesError(null)
    try {
      const res = await fetch(`/api/volumes/${encodeURIComponent(volume.name)}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to remove volume')
      }
      await fetchVolumes()
    } catch (err) {
      setVolumesError(err.message || 'Failed to remove volume')
    } finally {
      setRemovingVolumeName(null)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white">⚙️ MCP Hub</h1>
            <p className="mt-0.5 text-xs text-gray-400">
              The Factory — MCP Container Manager
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={openVolumes}
              className="rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-gray-100 transition-colors hover:bg-gray-700"
            >
              Volumes
            </button>
            <button
              onClick={openImages}
              className="rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-gray-100 transition-colors hover:bg-gray-700"
            >
              Images
            </button>
            <button
              onClick={() => setShowForm(true)}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500"
            >
              <span className="text-base leading-none">+</span> Deploy MCP
            </button>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="mx-auto max-w-6xl px-6 py-8">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-gray-500">
            Loading containers…
          </div>
        ) : mcps.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 py-20 text-gray-500">
            <p className="text-lg">No MCP containers deployed yet.</p>
            <button
              onClick={() => setShowForm(true)}
              className="text-sm text-blue-400 underline hover:text-blue-300"
            >
              Deploy your first MCP →
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {mcps.map((mcp) => (
              <MCPCard
                key={mcp.id}
                mcp={mcp}
                actionLoading={actionLoading[mcp.id]}
                onAction={handleAction}
                onViewLogs={() => setLogTarget({ id: mcp.id, name: mcp.name })}
                onOpenSession={() => setStdioTarget({ id: mcp.id, name: mcp.name })}
                onEdit={() =>
                  setEditingMcp({
                    id: mcp.id,
                    name: mcp.meta?.name || mcp.name,
                    image: mcp.meta?.image || mcp.image,
                    transport: mcp.meta?.transport || 'http',
                    command: mcp.meta?.command || '',
                    port: mcp.meta?.port || mcp.ports?.[0] || '',
                    env: mcp.meta?.env || {},
                  })
                }
              />
            ))}
          </div>
        )}
      </main>

      {showForm && (
        <DeployForm onDeploy={handleDeploy} onClose={() => setShowForm(false)} />
      )}

      {editingMcp && (
        <DeployForm
          onDeploy={handleUpdate}
          onClose={() => setEditingMcp(null)}
          initialValues={editingMcp}
          title={`Edit MCP: ${editingMcp.name}`}
          submitLabel="Save Changes"
          submittingLabel="Saving…"
        />
      )}

      {logTarget && (
        <LogConsole
          id={logTarget.id}
          name={logTarget.name}
          onClose={() => setLogTarget(null)}
        />
      )}

      {stdioTarget && (
        <StdioConsole
          id={stdioTarget.id}
          name={stdioTarget.name}
          onClose={() => setStdioTarget(null)}
        />
      )}

      {showImages && (
        <ImagesModal
          images={images}
          loading={imagesLoading}
          error={imagesError}
          onClose={() => setShowImages(false)}
          onRefresh={fetchImages}
          onRemove={handleRemoveImage}
          removingId={removingImageId}
          onPull={handlePullImage}
          pulling={pullingImage}
          pullProgress={pullProgress}
        />
      )}

      {showVolumes && (
        <VolumesModal
          volumes={volumes}
          loading={volumesLoading}
          error={volumesError}
          onClose={() => setShowVolumes(false)}
          onRefresh={fetchVolumes}
          onRemove={handleRemoveVolume}
          removingName={removingVolumeName}
        />
      )}
    </div>
  )
}
