import { useState } from 'react';
import type { McpNamespace } from '../../types/builder';
import NamespaceForm from './NamespaceForm';

interface NamespaceEditorProps {
  namespace: McpNamespace;
  onSave: (namespace: McpNamespace) => void;
  onCancel: () => void;
}

export default function NamespaceEditor({
  namespace,
  onSave,
  onCancel,
}: NamespaceEditorProps) {
  const [isEditing, setIsEditing] = useState(false);

  const handleSubmit = (name: string, description?: string) => {
    const updated = {
      ...namespace,
      name,
      description,
    };
    onSave(updated);
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-6">
        <h2 className="mb-4 text-lg font-semibold text-white">Edit Namespace</h2>
        <NamespaceForm
          initialName={namespace.name}
          initialDescription={namespace.description}
          onSubmit={handleSubmit}
          onCancel={() => setIsEditing(false)}
        />
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">{namespace.name}</h2>
          {namespace.description && (
            <p className="mt-2 text-sm text-gray-400">{namespace.description}</p>
          )}
        </div>
        <button
          onClick={() => setIsEditing(true)}
          className="rounded bg-gray-700 px-3 py-1.5 text-sm hover:bg-gray-600"
        >
          Edit
        </button>
      </div>
    </div>
  );
}
