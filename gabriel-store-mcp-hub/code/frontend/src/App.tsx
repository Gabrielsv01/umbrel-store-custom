import { useRef, useState } from 'react';
import MCPCard from './components/MCPCard';
import DeployForm from './components/DeployForm';
import LogConsole from './components/LogConsole';
import StdioConsole from './components/StdioConsole';
import ImagesModal from './components/ImagesModal';
import VolumesModal from './components/VolumesModal';
import CatalogModal from './components/CatalogModal';
import DocsModal from './components/DocsModal';
import MCPInspector from './components/MCPInspector';
import ToolsManager from './components/ToolsManager';
import MCPBuilder from './components/MCPBuilder';
import CustomToolsCreator from './components/CustomToolsCreator';
import { listImages } from './services/api';
import { useMcps } from './hooks/useMcps';
import { useImages } from './hooks/useImages';
import { useVolumes } from './hooks/useVolumes';
import type { CatalogEntry } from './types/catalog';
import type { DeployPayload, EditMcpValues, McpContainer } from './types/mcp';
import type { PullPayload, PullProgress } from './types/resources';
import { mapMcpToEditValues } from './utils/mcpForm';
import Menu from './components/Menu';

type LogTarget = { id: string; name: string };

export default function App() {
  const [view, setView] = useState<
    'hub' | 'inspector' | 'builder' | 'custom-tools'
  >('hub');
  const [showForm, setShowForm] = useState(false);
  const [showCatalog, setShowCatalog] = useState(false);
  const [showDocs, setShowDocs] = useState(false);
  const [editingMcp, setEditingMcp] = useState<EditMcpValues | null>(null);
  const [logTarget, setLogTarget] = useState<LogTarget | null>(null);
  const [stdioTarget, setStdioTarget] = useState<LogTarget | null>(null);
  const [toolsTarget, setToolsTarget] = useState<McpContainer | null>(null);
  const [deployPulling, setDeployPulling] = useState(false);
  const [deployPullProgress, setDeployPullProgress] =
    useState<PullProgress | null>(null);
  const deployPullLockRef = useRef(false);
  const deployPullImageRef = useRef<string | null>(null);

  const {
    mcps,
    loading,
    actionLoading,
    stdioHealth,
    stdioHealthLoading,
    httpHealth,
    httpHealthLoading,
    handleDeploy,
    handleUpdate,
    handleAction,
    handleCheckStdioHealth,
    handleCheckHttpHealth,
  } = useMcps();

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
  } = useImages();

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
  } = useVolumes();

  const ensureImageForDeploy = async (imageRef: string) => {
    const ref = imageRef.trim();
    if (!ref) return;

    if (deployPullLockRef.current) {
      const current = deployPullImageRef.current;
      throw new Error(
        current
          ? `Another image pull is in progress (${current}). Wait for it to finish.`
          : 'Another image pull is in progress. Wait for it to finish.'
      );
    }

    const localImages = await listImages().catch(() => []);
    const existsLocally = localImages.some((img) => img.tags.includes(ref));
    if (existsLocally) return;

    deployPullLockRef.current = true;
    deployPullImageRef.current = ref;
    setDeployPulling(true);
    setDeployPullProgress({
      image: ref,
      status: 'Starting pull...',
      percent: null,
    });

    try {
      await new Promise<void>((resolve, reject) => {
        const source = new EventSource(
          `/api/images/pull/stream?image=${encodeURIComponent(ref)}`
        );

        source.onmessage = (event) => {
          try {
            const payload = JSON.parse(event.data) as PullPayload;

            if (payload.type === 'progress') {
              setDeployPullProgress({
                image: ref,
                status: payload.status || 'Pulling...',
                id: payload.id || null,
                current: Number(payload.overallCurrent) || 0,
                total: Number(payload.overallTotal) || 0,
                percent:
                  typeof payload.overallPercent === 'number'
                    ? payload.overallPercent
                    : null,
              });
              return;
            }

            if (payload.type === 'done') {
              source.close();
              resolve();
              return;
            }

            if (payload.type === 'error') {
              source.close();
              reject(new Error(payload.error || 'Failed to pull image'));
            }
          } catch {
            source.close();
            reject(new Error('Failed to parse pull progress'));
          }
        };

        source.onerror = () => {
          source.close();
          reject(new Error('Pull connection failed'));
        };
      });
    } finally {
      setDeployPulling(false);
      setDeployPullProgress(null);
      deployPullLockRef.current = false;
      deployPullImageRef.current = null;
    }
  };

  const onDeploy = async (formData: DeployPayload) => {
    await ensureImageForDeploy(formData.image);
    await handleDeploy(formData);
    setShowForm(false);
  };

  const onUpdate = async (formData: DeployPayload) => {
    if (!editingMcp) return;
    await ensureImageForDeploy(formData.image);
    if (!editingMcp.id) {
      // Came from catalog — treat as new deploy
      await handleDeploy(formData);
      setEditingMcp(null);
      return;
    }
    await handleUpdate(editingMcp.id, formData);
    setEditingMcp(null);
  };

  const onCheckHealth = (id: string) => {
    const mcp = mcps.find((m) => m.id === id);
    const transport = mcp?.meta?.transport ?? 'http';
    if (transport === 'stdio') {
      handleCheckStdioHealth(id);
    } else {
      handleCheckHttpHealth(id);
    }
  };

  const onCatalogSelect = (entry: CatalogEntry) => {
    setShowCatalog(false);
    setEditingMcp({
      id: '',
      name: entry.name.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
      image: entry.image,
      transport: entry.transport,
      command: entry.command || '',
      port: entry.port,
      env: entry.env ?? {},
      secretKeys: entry.secretKeys,
      runtime: entry.runtime ?? {},
    });
  };

  if (toolsTarget) {
    return (
      <ToolsManager mcp={toolsTarget} onBack={() => setToolsTarget(null)} />
    );
  }

  const getHeaderTitle = () => {
    switch (view) {
      case 'inspector':
        return '🔍 MCP Inspector';
      case 'builder':
        return '🔧 MCP Builder';
      case 'custom-tools':
        return '🛠️ Custom Tools Creator';
      default:
        return '⚙️ MCP Hub';
    }
  };

  const getHeaderDescription = () => {
    switch (view) {
      case 'inspector':
        return 'Inspect and interact with MCP servers';
      case 'builder':
        return 'Combine MCP tools into custom namespaces';
      case 'custom-tools':
        return 'Create your own MCP with custom tools';
      default:
        return 'The Factory - MCP Container Manager';
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <header className="border-b border-gray-800 px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white">{getHeaderTitle()}</h1>
            <p className="mt-0.5 text-xs text-gray-400">
              {getHeaderDescription()}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Menu
              setShowCatalog={setShowCatalog}
              setShowDocs={setShowDocs}
              setShowForm={setShowForm}
              setView={setView}
              onOpenImages={openImages}
              onOpenVolumes={openVolumes}
            />
          </div>
        </div>
      </header>

      <main>
        {view === 'inspector' ? (
          <MCPInspector />
        ) : view === 'builder' ? (
          <MCPBuilder
            mcps={mcps}
            onMcpDeployed={() => {
              // Trigger refresh of MCPs
            }}
          />
        ) : view === 'custom-tools' ? (
          <CustomToolsCreator />
        ) : (
          <div className="mx-auto max-w-6xl px-6 py-8">
            {loading ? (
              <div className="flex items-center justify-center py-20 text-gray-500">
                Loading containers...
              </div>
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
              <div className="space-y-8">
                {(() => {
                  const customNamespaceIds = new Set(
                    JSON.parse(localStorage.getItem('custom_mcp_ids') || '[]')
                  );
                  const customMcps = mcps.filter((m) =>
                    customNamespaceIds.has(m.meta?.namespaceId)
                  );
                  const regularMcps = mcps.filter(
                    (m) => !customNamespaceIds.has(m.meta?.namespaceId)
                  );

                  return (
                    <>
                      {customMcps.length > 0 && (
                        <div>
                          <div className="mb-4 flex items-center gap-2">
                            <h2 className="text-lg font-semibold text-white">
                              🔧 Custom MCPs
                            </h2>
                            <span className="text-xs text-gray-400">
                              Created from Builder
                            </span>
                          </div>
                          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                            {customMcps.map((mcp) => (
                              <MCPCard
                                key={mcp.id}
                                mcp={mcp}
                                actionLoading={actionLoading[mcp.id]}
                                onAction={handleAction}
                                onViewLogs={() =>
                                  setLogTarget({ id: mcp.id, name: mcp.name })
                                }
                                onOpenSession={() =>
                                  setStdioTarget({ id: mcp.id, name: mcp.name })
                                }
                                onCheckHealth={onCheckHealth}
                                onOpenTools={() => setToolsTarget(mcp)}
                                health={stdioHealth[mcp.id]}
                                healthLoading={!!stdioHealthLoading[mcp.id]}
                                httpHealth={httpHealth[mcp.id]}
                                httpHealthLoading={!!httpHealthLoading[mcp.id]}
                                onEdit={() =>
                                  setEditingMcp(mapMcpToEditValues(mcp))
                                }
                              />
                            ))}
                          </div>
                        </div>
                      )}

                      {regularMcps.length > 0 && (
                        <div>
                          <div className="mb-4">
                            <h2 className="text-lg font-semibold text-white">
                              📦 MCP Servers
                            </h2>
                          </div>
                          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                            {regularMcps.map((mcp) => (
                              <MCPCard
                                key={mcp.id}
                                mcp={mcp}
                                actionLoading={actionLoading[mcp.id]}
                                onAction={handleAction}
                                onViewLogs={() =>
                                  setLogTarget({ id: mcp.id, name: mcp.name })
                                }
                                onOpenSession={() =>
                                  setStdioTarget({ id: mcp.id, name: mcp.name })
                                }
                                onCheckHealth={onCheckHealth}
                                onOpenTools={() => setToolsTarget(mcp)}
                                health={stdioHealth[mcp.id]}
                                healthLoading={!!stdioHealthLoading[mcp.id]}
                                httpHealth={httpHealth[mcp.id]}
                                httpHealthLoading={!!httpHealthLoading[mcp.id]}
                                onEdit={() =>
                                  setEditingMcp(mapMcpToEditValues(mcp))
                                }
                              />
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            )}
          </div>
        )}
      </main>

      {showForm && (
        <DeployForm
          onDeploy={onDeploy}
          onClose={() => setShowForm(false)}
          initialValues={undefined}
          pullingImage={deployPulling}
          pullProgress={deployPullProgress}
        />
      )}

      {editingMcp && (
        <DeployForm
          onDeploy={onUpdate}
          onClose={() => setEditingMcp(null)}
          initialValues={editingMcp}
          title={
            editingMcp.id
              ? `Edit MCP: ${editingMcp.name}`
              : `Deploy from Catalog: ${editingMcp.name}`
          }
          submitLabel={editingMcp.id ? 'Save Changes' : 'Deploy'}
          submittingLabel={editingMcp.id ? 'Saving...' : 'Deploying...'}
          pullingImage={deployPulling}
          pullProgress={deployPullProgress}
        />
      )}

      {showCatalog && (
        <CatalogModal
          onClose={() => setShowCatalog(false)}
          onSelect={onCatalogSelect}
        />
      )}

      {showDocs && <DocsModal onClose={() => setShowDocs(false)} />}

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
  );
}
