import { useState } from 'react';
import type { McpNamespace } from '../../types/builder';
import type { McpTransport } from '../../types/mcp';
import NamespaceForm from './NamespaceForm';

interface NamespaceListProps {
  namespaces: McpNamespace[];
  selectedId?: string;
  onSelect: (namespace: McpNamespace) => void;
  onDelete: (id: string) => void;
  onCreateNew: () => void;
  isCreating: boolean;
  onCreateNamespace: (name: string, description?: string, transport?: McpTransport, port?: number) => void;
}

export default function NamespaceList({
  namespaces,
  selectedId,
  onSelect,
  onDelete,
  onCreateNew,
  isCreating,
  onCreateNamespace,
}: NamespaceListProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleCreateClick = () => {
    onCreateNew();
  };

  const handleDelete = (id: string) => {
    setDeletingId(null);
    onDelete(id);
  };

  const handleEdit = (ns: McpNamespace) => {
    setEditingId(ns.id);
  };

  const handleEditSubmit = (name: string, description?: string, transport?: McpTransport, port?: number) => {
    if (!editingId) return;
    const ns = namespaces.find((n) => n.id === editingId);
    if (!ns) return;

    const updated = {
      ...ns,
      name,
      description,
      transport: transport || 'http',
      port: port || 8000,
    };
    onSelect(updated);
    setEditingId(null);
  };

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-6">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Namespaces</h2>
        <button
          onClick={handleCreateClick}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium hover:bg-blue-700"
        >
          + New
        </button>
      </div>

      {isCreating && (
        <div className="mb-6 rounded bg-gray-800 p-4">
          <h3 className="mb-4 text-sm font-semibold text-white">Create New Namespace</h3>
          <NamespaceForm
            onSubmit={onCreateNamespace}
            onCancel={() => handleCreateClick()}
          />
        </div>
      )}

      {editingId && (
        <div className="mb-6 rounded bg-gray-800 p-4">
          <h3 className="mb-4 text-sm font-semibold text-white">Edit Namespace</h3>
          <NamespaceForm
            onSubmit={handleEditSubmit}
            onCancel={() => setEditingId(null)}
            initialName={namespaces.find((n) => n.id === editingId)?.name}
            initialDescription={namespaces.find((n) => n.id === editingId)?.description}
            initialTransport={namespaces.find((n) => n.id === editingId)?.transport}
            initialPort={namespaces.find((n) => n.id === editingId)?.port}
          />
        </div>
      )}

      <div className="space-y-2">
        {namespaces.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">
            No namespaces yet. Create one to get started.
          </p>
        ) : (
          namespaces.map((ns) => (
            <div
              key={ns.id}
              className={`group relative flex items-center justify-between rounded border p-3 transition-colors ${
                selectedId === ns.id
                  ? 'border-blue-500 bg-gray-800'
                  : 'border-gray-700 bg-gray-900 hover:bg-gray-800'
              }`}
            >
              <button
                onClick={() => onSelect(ns)}
                className="flex-1 text-left"
              >
                <div className="font-medium text-white">{ns.name}</div>
                {ns.description && (
                  <div className="mt-1 text-xs text-gray-400">{ns.description}</div>
                )}
                <div className="mt-1 text-xs text-gray-500">
                  {ns.enabledMcps.length} MCP{ns.enabledMcps.length !== 1 ? 's' : ''} enabled
                </div>
              </button>

              <div className="ml-4 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  onClick={() => handleEdit(ns)}
                  className="rounded px-2 py-1 text-xs text-gray-400 hover:bg-gray-700 hover:text-white"
                  title="Edit"
                >
                  ✏️
                </button>
                <button
                  onClick={() => setDeletingId(ns.id)}
                  className="rounded px-2 py-1 text-xs text-red-400 hover:bg-red-900/30 hover:text-red-300"
                  title="Delete"
                >
                  🗑️
                </button>
              </div>

              {deletingId === ns.id && (
                <div className="absolute inset-0 flex items-center justify-between rounded border border-red-500 bg-red-900/20 px-3">
                  <span className="text-sm text-red-300">Delete namespace?</span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setDeletingId(null)}
                      className="rounded bg-gray-700 px-2 py-1 text-xs hover:bg-gray-600"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => handleDelete(ns.id)}
                      className="rounded bg-red-600 px-2 py-1 text-xs hover:bg-red-700"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
