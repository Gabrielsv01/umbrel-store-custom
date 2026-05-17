import { useState } from 'react';
import type { SharedVolumeAccess } from '../../types/customTools';

interface SharedVolumeAccessManagerProps {
  accesses: SharedVolumeAccess[];
  onChange: (accesses: SharedVolumeAccess[]) => void;
}

export default function SharedVolumeAccessManager({
  accesses,
  onChange,
}: Readonly<SharedVolumeAccessManagerProps>) {
  const [newFolder, setNewFolder] = useState('');
  const [showForm, setShowForm] = useState(false);

  const handleAddFolder = () => {
    if (!newFolder.trim()) return;

    const exists = accesses.some(a => a.folder === newFolder);
    if (exists) {
      alert('Folder already added');
      return;
    }

    const newAccess: SharedVolumeAccess = {
      folder: newFolder,
      canRead: true,
      canWrite: false,
      canDelete: false,
    };

    onChange([...accesses, newAccess]);
    setNewFolder('');
    setShowForm(false);
  };

  const handleRemoveFolder = (folder: string) => {
    onChange(accesses.filter(a => a.folder !== folder));
  };

  const handleTogglePermission = (
    folder: string,
    permission: 'canRead' | 'canWrite' | 'canDelete'
  ) => {
    onChange(
      accesses.map(a =>
        a.folder === folder ? { ...a, [permission]: !a[permission] } : a
      )
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">
          Shared Volume Access
        </h3>
        <button
          onClick={() => setShowForm(!showForm)}
          className="rounded bg-blue-600 px-3 py-1 text-xs hover:bg-blue-700"
        >
          + Add Folder
        </button>
      </div>

      {showForm && (
        <div className="rounded border border-gray-700 bg-gray-800 p-3">
          <div className="flex gap-2">
            <input
              type="text"
              value={newFolder}
              onChange={(e) => setNewFolder(e.target.value)}
              placeholder="e.g., echarts-server"
              className="flex-1 rounded border border-gray-600 bg-gray-700 px-2 py-1 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
            />
            <button
              onClick={handleAddFolder}
              className="rounded bg-green-600 px-3 py-1 text-xs hover:bg-green-700"
            >
              Add
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="rounded bg-gray-600 px-3 py-1 text-xs hover:bg-gray-500"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {accesses.length === 0 ? (
        <div className="rounded border border-gray-800 bg-gray-900 p-4 text-center text-sm text-gray-500">
          No shared volume access configured
        </div>
      ) : (
        <div className="space-y-2">
          {accesses.map((access) => (
            <div
              key={access.folder}
              className="rounded border border-gray-700 bg-gray-800 p-3"
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="font-mono text-sm text-gray-300">
                  /shared-data/{access.folder}
                </span>
                <button
                  onClick={() => handleRemoveFolder(access.folder)}
                  className="text-xs text-red-400 hover:text-red-300"
                >
                  ✕
                </button>
              </div>

              <div className="flex gap-3">
                <label className="flex items-center gap-2 text-xs text-gray-400">
                  <input
                    type="checkbox"
                    checked={access.canRead}
                    onChange={() => handleTogglePermission(access.folder, 'canRead')}
                    className="h-3 w-3 cursor-pointer rounded border-gray-600 bg-gray-700"
                  />
                  Read
                </label>
                <label className="flex items-center gap-2 text-xs text-gray-400">
                  <input
                    type="checkbox"
                    checked={access.canWrite}
                    onChange={() => handleTogglePermission(access.folder, 'canWrite')}
                    className="h-3 w-3 cursor-pointer rounded border-gray-600 bg-gray-700"
                  />
                  Write
                </label>
                <label className="flex items-center gap-2 text-xs text-gray-400">
                  <input
                    type="checkbox"
                    checked={access.canDelete}
                    onChange={() => handleTogglePermission(access.folder, 'canDelete')}
                    className="h-3 w-3 cursor-pointer rounded border-gray-600 bg-gray-700"
                  />
                  Delete
                </label>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
