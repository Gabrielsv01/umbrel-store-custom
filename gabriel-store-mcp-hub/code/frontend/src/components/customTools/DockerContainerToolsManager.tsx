import { useState, useEffect } from 'react';
import type { DockerContainerToolsAccess, DockerContainerCliCommand } from '../../types/customTools';

interface DockerContainerToolsManagerProps {
  containerTools: DockerContainerToolsAccess | undefined;
  onChange: (tools: DockerContainerToolsAccess | undefined) => void;
}

export default function DockerContainerToolsManager({
  containerTools,
  onChange,
}: Readonly<DockerContainerToolsManagerProps>) {
  const [containers, setContainers] = useState<string[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [newCommand, setNewCommand] = useState<Partial<DockerContainerCliCommand>>({
    toolName: '',
    command: '',
    description: '',
  });
  const [loadingContainers, setLoadingContainers] = useState(false);

  useEffect(() => {
    loadActiveContainers();
  }, []);

  const loadActiveContainers = async () => {
    setLoadingContainers(true);
    try {
      const response = await fetch('/api/containers');
      const data = await response.json();
      const containerNames = data.containers?.map((c: any) => c.name) || [];
      setContainers(containerNames);
    } catch (error) {
      console.error('Failed to load containers:', error);
      setContainers([]);
    } finally {
      setLoadingContainers(false);
    }
  };

  const handleSelectContainer = (containerName: string) => {
    onChange({
      containerName,
      commands: containerTools?.commands || [],
    });
    setShowForm(false);
    setNewCommand({ toolName: '', command: '', description: '' });
  };

  const handleAddCommand = () => {
    if (!newCommand.toolName?.trim() || !newCommand.command?.trim()) {
      alert('Tool name and command are required');
      return;
    }

    if (!containerTools) {
      alert('Select a container first');
      return;
    }

    const exists = containerTools.commands.some(
      (c) => c.toolName === newCommand.toolName
    );
    if (exists) {
      alert('Tool with this name already exists');
      return;
    }

    const command: DockerContainerCliCommand = {
      toolName: newCommand.toolName,
      command: newCommand.command,
      description: newCommand.description || '',
    };

    onChange({
      ...containerTools,
      commands: [...containerTools.commands, command],
    });

    setNewCommand({ toolName: '', command: '', description: '' });
    setShowForm(false);
  };

  const handleRemoveCommand = (toolName: string) => {
    if (!containerTools) return;

    onChange({
      ...containerTools,
      commands: containerTools.commands.filter((c) => c.toolName !== toolName),
    });
  };

  const handleClearContainer = () => {
    onChange(undefined);
    setNewCommand({ toolName: '', command: '', description: '' });
    setShowForm(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">
          Docker Container CLI Tools
        </h3>
        {!containerTools && (
          <button
            onClick={() => setShowForm(!showForm)}
            className="rounded bg-blue-600 px-3 py-1 text-xs hover:bg-blue-700"
          >
            + Select Container
          </button>
        )}
      </div>

      {showForm && !containerTools && (
        <div className="rounded border border-gray-700 bg-gray-800 p-4">
          <p className="mb-3 text-xs text-gray-400">
            {loadingContainers ? 'Loading containers...' : 'Select a container to expose as CLI tools:'}
          </p>
          <div className="grid max-h-48 gap-2 overflow-y-auto">
            {containers.length === 0 ? (
              <p className="text-xs text-gray-500">No containers found</p>
            ) : (
              containers.map((container) => (
                <button
                  key={container}
                  onClick={() => handleSelectContainer(container)}
                  className="rounded border border-gray-600 bg-gray-700 px-3 py-2 text-left text-sm text-gray-200 hover:border-blue-500 hover:bg-gray-600"
                >
                  🐳 {container}
                </button>
              ))
            )}
          </div>
          <button
            onClick={() => setShowForm(false)}
            className="mt-3 w-full rounded bg-gray-600 px-3 py-1 text-xs hover:bg-gray-500"
          >
            Cancel
          </button>
        </div>
      )}

      {containerTools ? (
        <div className="rounded border border-gray-700 bg-gray-800 p-4">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-white">
                🐳 {containerTools.containerName}
              </p>
              <p className="text-xs text-gray-400">
                {containerTools.commands.length} command(s) configured
              </p>
            </div>
            <button
              onClick={handleClearContainer}
              className="text-xs text-red-400 hover:text-red-300"
            >
              Change Container
            </button>
          </div>

          {!showForm && (
            <button
              onClick={() => setShowForm(true)}
              className="mb-4 w-full rounded bg-blue-600 px-3 py-1 text-xs hover:bg-blue-700"
            >
              + Add Command
            </button>
          )}

          {showForm && (
            <div className="mb-4 rounded border border-gray-600 bg-gray-700 p-3">
              <div className="space-y-2">
                <div>
                  <label className="text-xs text-gray-400">Tool Name *</label>
                  <input
                    type="text"
                    value={newCommand.toolName || ''}
                    onChange={(e) =>
                      setNewCommand({ ...newCommand, toolName: e.target.value })
                    }
                    placeholder="e.g., mempalace_search"
                    className="mt-1 w-full rounded border border-gray-600 bg-gray-700 px-2 py-1 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400">Command *</label>
                  <input
                    type="text"
                    value={newCommand.command || ''}
                    onChange={(e) =>
                      setNewCommand({ ...newCommand, command: e.target.value })
                    }
                    placeholder="e.g., mempalace search"
                    className="mt-1 w-full rounded border border-gray-600 bg-gray-700 px-2 py-1 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400">Description</label>
                  <input
                    type="text"
                    value={newCommand.description || ''}
                    onChange={(e) =>
                      setNewCommand({ ...newCommand, description: e.target.value })
                    }
                    placeholder="What this command does"
                    className="mt-1 w-full rounded border border-gray-600 bg-gray-700 px-2 py-1 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
                  />
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={handleAddCommand}
                  className="flex-1 rounded bg-green-600 px-3 py-1 text-xs hover:bg-green-700"
                >
                  Add
                </button>
                <button
                  onClick={() => setShowForm(false)}
                  className="flex-1 rounded bg-gray-600 px-3 py-1 text-xs hover:bg-gray-500"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {containerTools.commands.length === 0 ? (
            <div className="rounded border border-gray-700 bg-gray-900 p-3 text-center text-xs text-gray-500">
              No commands added yet
            </div>
          ) : (
            <div className="space-y-2">
              {containerTools.commands.map((cmd) => (
                <div
                  key={cmd.toolName}
                  className="rounded border border-gray-700 bg-gray-900 p-2"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <p className="font-mono text-xs font-semibold text-blue-300">
                        {cmd.toolName}
                      </p>
                      <p className="font-mono text-xs text-gray-400">
                        docker exec {containerTools.containerName} {cmd.command}
                      </p>
                      {cmd.description && (
                        <p className="mt-1 text-xs text-gray-500">{cmd.description}</p>
                      )}
                    </div>
                    <button
                      onClick={() => handleRemoveCommand(cmd.toolName)}
                      className="ml-2 text-xs text-red-400 hover:text-red-300"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="rounded border border-gray-800 bg-gray-900 p-4 text-center text-sm text-gray-500">
          No container selected. Click "Select Container" to get started.
        </div>
      )}
    </div>
  );
}
