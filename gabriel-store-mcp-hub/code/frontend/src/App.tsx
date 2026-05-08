import { useState } from 'react'
import MCPCard from './components/MCPCard'
import DeployForm from './components/DeployForm'
import LogConsole from './components/LogConsole'
import StdioConsole from './components/StdioConsole'
import ImagesModal from './components/ImagesModal'
import VolumesModal from './components/VolumesModal'
import { useMcps } from './hooks/useMcps'
import { useImages } from './hooks/useImages'
import { useVolumes } from './hooks/useVolumes'
import type { DeployPayload, EditMcpValues } from './types/mcp'
import { mapMcpToEditValues } from './utils/mcpForm'

type LogTarget = { id: string; name: string }

export default function App() {
  const [showForm, setShowForm] = useState(false)
  const [editingMcp, setEditingMcp] = useState<EditMcpValues | null>(null)
  const [logTarget, setLogTarget] = useState<LogTarget | null>(null)
  const [stdioTarget, setStdioTarget] = useState<LogTarget | null>(null)

  const {
    mcps,
    loading,
    actionLoading,
    stdioHealth,
    stdioHealthLoading,
    handleDeploy,
    handleUpdate,
    handleAction,
    handleCheckStdioHealth,
  } = useMcps()

  const {
    showImages,
    images,
    imagesLoading,
    imagesError,
    removingImageId,
    pullingImage,
    pullProgress,
    fetchImages,
    openImages,
    closeImages,
    handleRemoveImage,
    handlePullImage,
  } = useImages()

  const {
    showVolumes,
    volumes,
    volumesLoading,
    volumesError,
    removingVolumeName,
    fetchVolumes,
    openVolumes,
    closeVolumes,
    handleRemoveVolume,
  } = useVolumes()

  const onDeploy = async (formData: DeployPayload) => {
    await handleDeploy(formData)
    setShowForm(false)
  }

  const onUpdate = async (formData: DeployPayload) => {
    if (!editingMcp) return

    await handleUpdate(editingMcp.id, formData)
    setEditingMcp(null)
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <header className="border-b border-gray-800 px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white">⚙️ MCP Hub</h1>
            <p className="mt-0.5 text-xs text-gray-400">The Factory - MCP Container Manager</p>
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

      <main className="mx-auto max-w-6xl px-6 py-8">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-gray-500">Loading containers...</div>
        ) : mcps.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 py-20 text-gray-500">
            <p className="text-lg">No MCP containers deployed yet.</p>
            <button
              onClick={() => setShowForm(true)}
              className="text-sm text-blue-400 underline hover:text-blue-300"
            >
              Deploy your first MCP -&gt;
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
                onCheckHealth={handleCheckStdioHealth}
                health={stdioHealth[mcp.id]}
                healthLoading={!!stdioHealthLoading[mcp.id]}
                onEdit={() => setEditingMcp(mapMcpToEditValues(mcp))}
              />
            ))}
          </div>
        )}
      </main>

      {showForm && (
        <DeployForm
          onDeploy={onDeploy}
          onClose={() => setShowForm(false)}
          initialValues={undefined}
        />
      )}

      {editingMcp && (
        <DeployForm
          onDeploy={onUpdate}
          onClose={() => setEditingMcp(null)}
          initialValues={editingMcp}
          title={`Edit MCP: ${editingMcp.name}`}
          submitLabel="Save Changes"
          submittingLabel="Saving..."
        />
      )}

      {logTarget && <LogConsole id={logTarget.id} name={logTarget.name} onClose={() => setLogTarget(null)} />}

      {stdioTarget && (
        <StdioConsole id={stdioTarget.id} name={stdioTarget.name} onClose={() => setStdioTarget(null)} />
      )}

      {showImages && (
        <ImagesModal
          images={images}
          loading={imagesLoading}
          error={imagesError}
          onClose={closeImages}
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
          onClose={closeVolumes}
          onRefresh={fetchVolumes}
          onRemove={handleRemoveVolume}
          removingName={removingVolumeName}
        />
      )}
    </div>
  )
}
