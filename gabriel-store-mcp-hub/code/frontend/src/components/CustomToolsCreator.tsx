import { useState, useEffect } from 'react';
import type { CustomToolDefinition, CustomToolMethod } from '../types/customTools';
import type { McpContainer } from '../types/mcp';
import { listMcps, validateCustomTool, deployCustomTool, updateCustomTool, runMcpAction } from '../services/api';
import MethodForm from './customTools/MethodForm';

export default function CustomToolsCreator() {
  const [customToolsMcps, setCustomToolsMcps] = useState<McpContainer[]>([]);
  const [selectedMcp, setSelectedMcp] = useState<McpContainer | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const [definition, setDefinition] = useState<CustomToolDefinition>({
    name: '',
    description: '',
    methods: [],
    port: 8000,
  });

  const [deploying, setDeploying] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [deploySuccess, setDeploySuccess] = useState<{
    containerId: string;
    containerName: string;
  } | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [validationSuccess, setValidationSuccess] = useState(false);
  const [deletingMcpId, setDeletingMcpId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Load custom tools MCPs on mount
  useEffect(() => {
    loadCustomToolsMcps();
  }, []);

  // Load selected MCP definition for editing
  useEffect(() => {
    if (selectedMcp && selectedMcp.meta?.customToolDefinition) {
      const def = selectedMcp.meta.customToolDefinition as unknown as CustomToolDefinition;
      setDefinition(def);
      setValidationErrors([]);
      setValidationSuccess(false);
      setDeployError(null);
      setDeploySuccess(null);
    }
  }, [selectedMcp]);

  const loadCustomToolsMcps = async () => {
    try {
      const mcps = await listMcps();
      const customTools = mcps.filter(
        (mcp) =>
          (mcp.meta?.isCustomToolsMcp === true ||
            (mcp.name?.toLowerCase().includes('custom') &&
              mcp.name?.toLowerCase().includes('tools')))
      );
      setCustomToolsMcps(customTools);
    } catch (error) {
      console.error('Failed to load custom tools MCPs:', error);
    }
  };

  const handleNameChange = (name: string) => {
    setDefinition({ ...definition, name });
  };

  const handleDescriptionChange = (description: string) => {
    setDefinition({ ...definition, description });
  };

  const handlePortChange = (port: number) => {
    setDefinition({ ...definition, port });
  };

  const handleAddMethod = () => {
    const newMethod: CustomToolMethod = {
      name: '',
      description: '',
      parameters: {},
      code: '',
    };
    setDefinition({
      ...definition,
      methods: [...definition.methods, newMethod],
    });
  };

  const handleUpdateMethod = (index: number, method: CustomToolMethod) => {
    const updated = [...definition.methods];
    updated[index] = method;
    setDefinition({ ...definition, methods: updated });
  };

  const handleRemoveMethod = (index: number) => {
    const updated = definition.methods.filter((_, i) => i !== index);
    setDefinition({ ...definition, methods: updated });
  };

  const handleValidate = async () => {
    setValidationErrors([]);
    setValidationSuccess(false);
    setDeployError(null);

    try {
      const response = await validateCustomTool(definition);
      if (response.valid) {
        setValidationSuccess(true);
        setValidationErrors([]);
        return true;
      } else {
        setValidationErrors(response.errors || []);
        return false;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setValidationErrors([message]);
      return false;
    }
  };

  const handleDeploy = async () => {
    const isValid = await handleValidate();
    if (!isValid) return;

    setDeploying(true);
    setDeployError(null);
    setDeploySuccess(null);

    try {
      const isEditing = selectedMcp !== null;
      const result = isEditing
        ? await updateCustomTool(selectedMcp!.id, definition)
        : await deployCustomTool(definition);

      setDeploySuccess({
        containerId: result.containerId,
        containerName: result.containerName,
      });
      setDefinition({
        name: '',
        description: '',
        methods: [],
      });
      setIsCreating(false);
      setSelectedMcp(null);

      // Reload MCPs
      await loadCustomToolsMcps();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setDeployError(message);
    } finally {
      setDeploying(false);
    }
  };

  const handleCreateNew = () => {
    setSelectedMcp(null);
    setIsCreating(true);
    setDefinition({
      name: '',
      description: '',
      methods: [],
      port: 8000,
    });
    setValidationErrors([]);
    setValidationSuccess(false);
    setDeployError(null);
    setDeploySuccess(null);
  };

  const handleDeleteMcp = async (mcpId: string) => {
    setIsDeleting(true);
    try {
      await runMcpAction(mcpId, 'remove');
      await loadCustomToolsMcps();
      setDeletingMcpId(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Failed to delete MCP:', message);
    } finally {
      setIsDeleting(false);
    }
  };

  const isFormValid =
    definition.name.trim().length > 0 && definition.methods.length > 0;

  // List View
  if (!isCreating && !selectedMcp) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-8 flex items-center justify-end">
          <button
            onClick={handleCreateNew}
            className="rounded-lg bg-green-600 px-6 py-2 font-medium text-white hover:bg-green-700"
          >
            + Create New
          </button>
        </div>

        {deploySuccess && (
          <div className="mb-6 rounded-lg border border-green-700 bg-green-900/30 p-4">
            <h3 className="font-semibold text-green-300">✅ Deployment Successful!</h3>
            <p className="mt-2 text-sm text-green-200">
              Custom MCP deployed: {deploySuccess.containerName}
            </p>
          </div>
        )}

        {customToolsMcps.length === 0 ? (
          <div className="rounded-lg border border-gray-800 bg-gray-900 p-12 text-center">
            <p className="text-lg text-gray-400">
              No custom tools MCPs created yet.
            </p>
            <p className="mt-2 text-sm text-gray-500">
              Click "Create New" to build your first custom MCP!
            </p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {customToolsMcps.map((mcp) => (
              <div
                key={mcp.id}
                className="rounded-lg border border-gray-800 bg-gray-900 p-4 hover:border-gray-700 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h3
                      className="font-semibold text-white cursor-pointer hover:text-blue-400 transition-colors"
                      onClick={() => setSelectedMcp(mcp)}
                    >
                      {mcp.name}
                    </h3>
                    <p className="mt-1 text-xs text-gray-400">{mcp.image}</p>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeletingMcpId(mcp.id);
                    }}
                    className="ml-2 rounded bg-red-600/20 px-2 py-1 text-xs font-medium text-red-400 hover:bg-red-600/40"
                    title="Delete this custom tool"
                  >
                    ✕
                  </button>
                </div>
                <div className="mt-3">
                  <span
                    className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
                      mcp.status === 'running'
                        ? 'bg-green-500/15 text-green-400'
                        : 'bg-red-500/15 text-red-400'
                    }`}
                  >
                    <span className={`mr-1 h-2 w-2 rounded-full ${mcp.status === 'running' ? 'bg-green-400' : 'bg-red-400'}`} />
                    {mcp.status}
                  </span>
                </div>
                <button
                  onClick={() => setSelectedMcp(mcp)}
                  className="mt-4 w-full rounded-lg bg-gray-800 px-3 py-2 text-sm font-medium text-gray-200 hover:bg-gray-700 transition-colors"
                >
                  Edit
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Delete Confirmation Modal */}
        {deletingMcpId && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="rounded-lg border border-red-700 bg-gray-900 p-6 max-w-sm">
              <h3 className="text-lg font-semibold text-red-300">Confirm Delete</h3>
              <p className="mt-3 text-sm text-gray-300">
                Are you sure you want to delete this custom tool? This action cannot be undone.
              </p>
              <div className="mt-6 flex gap-3">
                <button
                  onClick={() => setDeletingMcpId(null)}
                  disabled={isDeleting}
                  className="flex-1 rounded bg-gray-700 px-3 py-2 text-sm font-medium text-white hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-500"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    if (deletingMcpId) {
                      handleDeleteMcp(deletingMcpId);
                    }
                  }}
                  disabled={isDeleting}
                  className="flex-1 rounded bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:bg-gray-800 disabled:text-gray-500"
                >
                  {isDeleting ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Form View (Create or Edit)
  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <button
        onClick={() => {
          setIsCreating(false);
          setSelectedMcp(null);
          setValidationErrors([]);
          setValidationSuccess(false);
        }}
        className="mb-6 text-blue-400 hover:text-blue-300"
      >
        ← Back to Custom Tools
      </button>

      <h1 className="text-3xl font-bold text-white">
        {selectedMcp ? `Edit: ${selectedMcp.name}` : '🛠️ Create Custom Tools'}
      </h1>

      {/* Success Message */}
      {deploySuccess && (
        <div className="mt-6 rounded-lg border border-green-700 bg-green-900/30 p-4">
          <h3 className="font-semibold text-green-300">✅ Deployment Successful!</h3>
          <p className="mt-2 text-sm text-green-200">
            Custom MCP deployed successfully
          </p>
          <div className="mt-3 space-y-1 font-mono text-xs text-green-300">
            <div>Container ID: {deploySuccess.containerId}</div>
            <div>Container Name: {deploySuccess.containerName}</div>
          </div>
        </div>
      )}

      {/* Validation Feedback */}
      {validationSuccess && (
        <div className="mt-6 rounded-lg border border-green-700 bg-green-900/30 p-4">
          <p className="text-sm text-green-300">
            ✅ Custom tool definition is valid and ready to deploy!
          </p>
        </div>
      )}

      {/* Error Messages */}
      {(deployError || validationErrors.length > 0) && (
        <div className="mt-6 rounded-lg border border-red-700 bg-red-900/30 p-4">
          <h3 className="font-semibold text-red-300">
            {deployError ? '❌ Deployment Failed' : '❌ Validation Errors'}
          </h3>
          <ul className="mt-2 space-y-1 text-sm text-red-200">
            {deployError && <li>• {deployError}</li>}
            {validationErrors.map((error, idx) => (
              <li key={idx}>• {error}</li>
            ))}
          </ul>
        </div>
      )}

      {/* MCP Info Section */}
      <div className="mt-8 rounded-lg border border-gray-800 bg-gray-900 p-6">
        <h2 className="text-lg font-semibold text-white">MCP Information</h2>

        <div className="mt-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300">
              MCP Name *
            </label>
            <input
              type="text"
              value={definition.name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="e.g., Math Tools, Custom Python Tools"
              className="mt-2 w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
            />
            <p className="mt-1 text-xs text-gray-400">
              💡 Include "custom" or "tools" to auto-identify in Builder
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300">
              Description
            </label>
            <textarea
              value={definition.description}
              onChange={(e) => handleDescriptionChange(e.target.value)}
              placeholder="Describe what your custom MCP does..."
              rows={3}
              className="mt-2 w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300">
              Port
            </label>
            <input
              type="number"
              value={definition.port ?? 8000}
              onChange={(e) => handlePortChange(Number.parseInt(e.target.value, 10))}
              placeholder="8000"
              min="1024"
              max="65535"
              className="mt-2 w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
            />
            <p className="mt-1 text-xs text-gray-400">
              💡 Port the container will listen on (1024-65535, default: 8000)
            </p>
          </div>
        </div>
      </div>

      {/* Methods Section */}
      <div className="mt-8 rounded-lg border border-gray-800 bg-gray-900 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Methods</h2>
          <button
            onClick={handleAddMethod}
            className="rounded bg-blue-600 px-3 py-1 text-sm hover:bg-blue-700"
          >
            + Add Method
          </button>
        </div>

        {definition.methods.length === 0 ? (
          <div className="mt-6 text-center text-gray-400">
            No methods added yet. Click "Add Method" to get started.
          </div>
        ) : (
          <div className="mt-6 space-y-6">
            {definition.methods.map((method, index) => (
              <div
                key={index}
                className="rounded border border-gray-700 bg-gray-800 p-4"
              >
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-white">
                    Method {index + 1}
                    {method.name && ` - ${method.name}`}
                  </h3>
                  <button
                    onClick={() => handleRemoveMethod(index)}
                    className="text-xs text-red-400 hover:text-red-300"
                  >
                    Remove
                  </button>
                </div>

                <MethodForm
                  method={method}
                  onChange={(updated) => handleUpdateMethod(index, updated)}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="mt-8 flex gap-4">
        <button
          onClick={handleDeploy}
          disabled={!isFormValid || deploying}
          className="flex-1 rounded-lg bg-green-600 px-6 py-2 font-medium text-white hover:bg-green-700 disabled:bg-gray-800 disabled:text-gray-500 disabled:cursor-not-allowed"
        >
          {deploying ? '🚀 Deploying...' : '🚀 Generate & Deploy'}
        </button>
      </div>
    </div>
  );
}
