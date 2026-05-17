import { useState, useEffect } from 'react';
import type { McpNamespace, BuilderStatistics } from '../types/builder';
import type { McpContainer, McpTransport } from '../types/mcp';
import NamespaceList from './builder/NamespaceList';
import BuilderInfo from './builder/BuilderInfo';
import McpSelector from './builder/McpSelector';
import BuilderToolsManager from './builder/BuilderToolsManager';
import {
  deployNamespaceAsMcp,
  updateNamespaceAsMcp,
  deleteNamespaceAsMcp,
} from '../services/api';

interface MCPBuilderProps {
  readonly mcps: McpContainer[];
  readonly onMcpDeployed?: () => void;
}

export default function MCPBuilder({
  mcps,
  onMcpDeployed,
}: Readonly<MCPBuilderProps>) {
  const [namespaces, setNamespaces] = useState<McpNamespace[]>([]);
  const [selectedNamespace, setSelectedNamespace] =
    useState<McpNamespace | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [deploying, setDeploying] = useState<string | null>(null);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [statistics, setStatistics] = useState<BuilderStatistics>({
    totalTools: 0,
    enabledTools: 0,
    disabledTools: 0,
    enabledMcpCount: 0,
    totalMcpCount: mcps.length,
  });

  useEffect(() => {
    // Load from localStorage first (for instant UI), then fetch from backend
    loadNamespaces();
    loadNamespacesFromBackend();

    // Refetch namespaces from backend every 5 seconds to stay in sync
    const interval = setInterval(() => {
      loadNamespacesFromBackend();
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (selectedNamespace) {
      updateStatistics(selectedNamespace);
    }
  }, [selectedNamespace, mcps]);

  const loadNamespaces = () => {
    const stored = localStorage.getItem('mcp_namespaces');
    if (stored) {
      const data = JSON.parse(stored) as McpNamespace[];
      setNamespaces(data);
    }
  };

  const loadNamespacesFromBackend = async () => {
    try {
      const response = await fetch('/api/namespaces');
      if (response.ok) {
        const backendNamespaces = (await response.json()) as Array<any>;
        // Convert backend format to frontend format
        const converted: McpNamespace[] = backendNamespaces.map((ns: any) => ({
          id: ns.id || ns.containerId,
          name: ns.name,
          description: ns.description,
          transport: ns.transport,
          port: ns.port,
          enabledMcps: ns.enabledMcps,
          disabledTools: ns.disabledTools,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }));
        setNamespaces(converted);
        // Also update localStorage to keep them in sync
        localStorage.setItem('mcp_namespaces', JSON.stringify(converted));
      }
    } catch (error) {
      console.error('Failed to load namespaces from backend:', error);
    }
  };

  const updateStatistics = (namespace: McpNamespace) => {
    const enabledMcpCount = namespace.enabledMcps.length;
    const totalMcpCount = mcps.length;

    setStatistics({
      totalTools: 0,
      enabledTools: 0,
      disabledTools: namespace.disabledTools.length,
      enabledMcpCount,
      totalMcpCount,
    });
  };

  const saveNamespaces = (updated: McpNamespace[]) => {
    localStorage.setItem('mcp_namespaces', JSON.stringify(updated));
    setNamespaces(updated);
  };

  const handleCreateNamespace = (
    name: string,
    description?: string,
    transport: McpTransport = 'http',
    port: number = 8000
  ) => {
    const newNamespace: McpNamespace = {
      id: `ns_${Date.now()}`,
      name,
      description,
      transport,
      port,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      enabledMcps: [],
      disabledTools: [],
    };

    const updated = [...namespaces, newNamespace];
    saveNamespaces(updated);
    setSelectedNamespace(newNamespace);
    setIsCreating(false);
  };

  const handleUpdateNamespace = (namespace: McpNamespace) => {
    const updated = namespaces.map((ns) =>
      ns.id === namespace.id
        ? { ...namespace, updatedAt: new Date().toISOString() }
        : ns
    );
    saveNamespaces(updated);
    setSelectedNamespace(namespace);
    updateStatistics(namespace);
  };

  const handleDeleteNamespace = async (id: string) => {
    const customMcpIds = new Set(
      JSON.parse(localStorage.getItem('custom_mcp_ids') || '[]')
    );

    if (customMcpIds.has(id)) {
      try {
        await deleteNamespaceAsMcp(id);
        customMcpIds.delete(id);
        localStorage.setItem(
          'custom_mcp_ids',
          JSON.stringify(Array.from(customMcpIds))
        );
      } catch (error) {
        setDeployError(
          error instanceof Error
            ? error.message
            : 'Failed to delete namespace container'
        );
        return;
      }
    }

    const updated = namespaces.filter((ns) => ns.id !== id);
    saveNamespaces(updated);
    if (selectedNamespace?.id === id) {
      setSelectedNamespace(null);
    }
  };

  const handleToggleMcp = (mcpId: string, enabled: boolean) => {
    if (!selectedNamespace) return;

    const updated = {
      ...selectedNamespace,
      enabledMcps: enabled
        ? [...selectedNamespace.enabledMcps, mcpId]
        : selectedNamespace.enabledMcps.filter((id) => id !== mcpId),
    };

    handleUpdateNamespace(updated);
  };

  const handleToggleTool = (toolId: string, disabled: boolean) => {
    if (!selectedNamespace) return;

    const updated = {
      ...selectedNamespace,
      disabledTools: disabled
        ? [...selectedNamespace.disabledTools, toolId]
        : selectedNamespace.disabledTools.filter((id) => id !== toolId),
    };

    handleUpdateNamespace(updated);
  };

  const handleDeployNamespace = async () => {
    if (!selectedNamespace || selectedNamespace.enabledMcps.length === 0) {
      setDeployError('Select at least one MCP before deploying');
      return;
    }

    setDeploying(selectedNamespace.id);
    setDeployError(null);

    try {
      const enabledMcpDetails = mcps.filter((m) =>
        selectedNamespace.enabledMcps.includes(m.id)
      );

      // Check if this is an update (namespace already deployed)
      const customMcpIds = new Set(
        JSON.parse(localStorage.getItem('custom_mcp_ids') || '[]')
      );
      const isUpdate = customMcpIds.has(selectedNamespace.id);

      isUpdate
        ? await updateNamespaceAsMcp(selectedNamespace.id, {
            namespace: selectedNamespace,
            enabledMcps: enabledMcpDetails,
          })
        : await deployNamespaceAsMcp({
            namespace: selectedNamespace,
            enabledMcps: enabledMcpDetails,
          });

      // Track custom MCP IDs in localStorage
      customMcpIds.add(selectedNamespace.id);
      localStorage.setItem(
        'custom_mcp_ids',
        JSON.stringify(Array.from(customMcpIds))
      );

      setDeploying(null);
      onMcpDeployed?.();
      setSelectedNamespace(null);
    } catch (error) {
      setDeploying(null);
      setDeployError(
        error instanceof Error ? error.message : 'Failed to deploy namespace'
      );
    }
  };

  const isNamespaceUpdate =
    selectedNamespace &&
    JSON.parse(localStorage.getItem('custom_mcp_ids') || '[]').includes(
      selectedNamespace.id
    );

  const deployButtonText = (() => {
    if (deploying === selectedNamespace?.id) {
      return isNamespaceUpdate ? '🔄 Updating...' : '🚀 Deploying...';
    }
    return isNamespaceUpdate ? '🔄 Update MCP' : '🚀 Deploy as MCP';
  })();

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      {selectedNamespace ? (
        <div className="space-y-8">
          <BuilderInfo namespace={selectedNamespace} statistics={statistics} />

          <McpSelector
            namespace={selectedNamespace}
            availableMcps={mcps}
            onToggleMcp={handleToggleMcp}
          />

          <BuilderToolsManager
            namespace={selectedNamespace}
            availableMcps={mcps}
            onToggleTool={handleToggleTool}
          />

          {deployError && (
            <div className="rounded bg-red-900/30 p-4 text-sm text-red-300">
              {deployError}
            </div>
          )}

          <div className="flex gap-4">
            <button
              onClick={() => setSelectedNamespace(null)}
              className="rounded bg-gray-800 px-4 py-2 hover:bg-gray-700"
            >
              Back to Namespaces
            </button>

            <button
              onClick={handleDeployNamespace}
              disabled={
                deploying !== null ||
                !selectedNamespace ||
                selectedNamespace.enabledMcps.length === 0
              }
              className="rounded bg-green-600 px-4 py-2 font-medium hover:bg-green-700 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed"
            >
              {deployButtonText}
            </button>
          </div>
        </div>
      ) : (
        <NamespaceList
          namespaces={namespaces}
          selectedId={selectedNamespace ? selectedNamespace['id'] : undefined}
          onSelect={setSelectedNamespace}
          onDelete={handleDeleteNamespace}
          onUpdate={handleUpdateNamespace}
          onCreateNew={() => setIsCreating(true)}
          isCreating={isCreating}
          onCreateNamespace={handleCreateNamespace}
        />
      )}
    </div>
  );
}
