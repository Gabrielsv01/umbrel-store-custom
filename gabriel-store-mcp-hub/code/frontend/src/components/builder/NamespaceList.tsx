import { useState } from 'react';
import type { McpNamespace } from '../../types/builder';
import type { McpTransport } from '../../types/mcp';
import NamespaceForm from './NamespaceForm';

interface NamespaceListProps {
  namespaces: McpNamespace[];
  selectedId?: string;
  onSelect: (namespace: McpNamespace) => void;
  onDelete: (id: string) => void;
  onUpdate: (namespace: McpNamespace) => void;
  onCreateNew: () => void;
  isCreating: boolean;
  onCreateNamespace: (name: string, description?: string, transport?: McpTransport, port?: number) => void;
}

export default function NamespaceList({
  namespaces,
  selectedId,
  onSelect,
  onDelete,
  onUpdate,
  onCreateNew,
  isCreating,
  onCreateNamespace,
}: NamespaceListProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

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
    onUpdate(updated);
    setEditingId(null);
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Namespaces</h2>
        <button
          onClick={onCreateNew}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium hover:bg-blue-700"
        >
          + New Namespace
        </button>
      </div>

      {isCreating && (
        <div className="mb-8 rounded-lg border border-blue-800/30 bg-blue-900/10 p-6">
          <h3 className="mb-4 text-sm font-semibold text-white">Create New Namespace</h3>
          <NamespaceForm
            onSubmit={onCreateNamespace}
            onCancel={onCreateNew}
          />
        </div>
      )}

      {!isCreating && namespaces.length === 0 ? (
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-12 text-center">
          <p className="text-sm text-gray-400">
            No namespaces yet. Create one to get started.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {namespaces.map((ns) => (
            <div
              key={ns.id}
              className={`group rounded-lg border p-5 transition-all ${
                selectedId === ns.id
                  ? 'border-blue-500 bg-blue-900/20'
                  : 'border-gray-800 bg-gray-900 hover:border-gray-700'
              }`}
            >
              <div className="flex items-start justify-between">
                <button
                  onClick={() => onSelect(ns)}
                  className="flex-1 text-left"
                >
                  <div className="font-medium text-white">{ns.name}</div>
                  {ns.description && (
                    <div className="mt-1 text-sm text-gray-400">{ns.description}</div>
                  )}
                  <div className="mt-2 flex gap-3 text-xs text-gray-500">
                    <span>🌐 {ns.transport}</span>
                    <span>📍 {ns.port}</span>
                    <span>📦 {ns.enabledMcps.length} MCP{ns.enabledMcps.length !== 1 ? 's' : ''}</span>
                  </div>
                </button>

                <div className="ml-4 flex gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    onClick={() => handleEdit(ns)}
                    className="rounded px-3 py-1.5 text-xs text-gray-400 hover:bg-gray-800 hover:text-white"
                    title="Edit"
                  >
                    ✏️ Edit
                  </button>
                  <button
                    onClick={() => setDeletingId(ns.id)}
                    className="rounded px-3 py-1.5 text-xs text-red-400 hover:bg-red-900/30 hover:text-red-300"
                    title="Delete"
                  >
                    🗑️ Delete
                  </button>
                </div>
              </div>

              {deletingId === ns.id && (
                <div className="mt-4 flex items-center justify-between rounded border border-red-500 bg-red-900/20 p-3">
                  <span className="text-sm text-red-300">Delete namespace?</span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setDeletingId(null)}
                      className="rounded bg-gray-700 px-3 py-1 text-xs hover:bg-gray-600"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => handleDelete(ns.id)}
                      className="rounded bg-red-600 px-3 py-1 text-xs hover:bg-red-700"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {editingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg border border-gray-800 bg-gray-900 p-6">
            <h3 className="mb-4 text-lg font-semibold text-white">Edit Namespace</h3>
            <NamespaceForm
              onSubmit={handleEditSubmit}
              onCancel={() => setEditingId(null)}
              initialName={namespaces.find((n) => n.id === editingId)?.name}
              initialDescription={namespaces.find((n) => n.id === editingId)?.description}
              initialTransport={namespaces.find((n) => n.id === editingId)?.transport}
              initialPort={namespaces.find((n) => n.id === editingId)?.port}
            />
          </div>
        </div>
      )}
    </div>
  );
}
