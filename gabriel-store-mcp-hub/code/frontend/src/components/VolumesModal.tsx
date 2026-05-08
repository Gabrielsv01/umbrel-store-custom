import { useMemo, useState } from 'react'
import type { VolumesModalProps } from '../types/components'

function formatDate(value?: string): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

export default function VolumesModal({
  volumes,
  loading,
  error,
  onClose,
  onRefresh,
  onRemove,
  removingName,
}: VolumesModalProps) {
  const [query, setQuery] = useState('')

  const filteredVolumes = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return volumes
    return volumes.filter((volume) => {
      const haystack = `${volume.name} ${volume.driver} ${volume.mountpoint || ''}`.toLowerCase()
      return haystack.includes(term)
    })
  }, [volumes, query])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-gray-800 bg-gray-900">
        <div className="flex items-center justify-between border-b border-gray-800 px-6 py-4">
          <div>
            <h2 className="font-semibold text-white">Docker Volumes</h2>
            <p className="mt-0.5 text-xs text-gray-400">Review installed volumes and remove old ones not in use.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void onRefresh()}
              className="rounded-lg bg-gray-800 px-3 py-1.5 text-xs transition-colors hover:bg-gray-700"
            >
              Refresh
            </button>
            <button onClick={onClose} className="text-xl leading-none text-gray-400 hover:text-white">
              x
            </button>
          </div>
        </div>

        <div className="overflow-auto p-4">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by volume name"
              className="input max-w-xl"
            />
            <p className="text-xs text-gray-400">Showing {filteredVolumes.length} of {volumes.length}</p>
          </div>

          {loading ? (
            <div className="py-16 text-center text-sm text-gray-400">Loading volumes...</div>
          ) : error ? (
            <div className="rounded-lg bg-red-900/20 px-3 py-2 text-sm text-red-400">{error}</div>
          ) : filteredVolumes.length === 0 ? (
            <div className="py-16 text-center text-sm text-gray-400">No volumes found.</div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-800">
              <table className="min-w-[980px] divide-y divide-gray-800 text-sm">
                <thead className="bg-gray-900/80">
                  <tr className="text-left text-xs uppercase tracking-wide text-gray-400">
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Driver</th>
                    <th className="px-3 py-2">Mountpoint</th>
                    <th className="px-3 py-2">Created</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800 bg-gray-950/40">
                  {filteredVolumes.map((volume) => (
                    <tr key={volume.name}>
                      <td className="px-3 py-2 font-mono text-xs text-gray-200">{volume.name}</td>
                      <td className="px-3 py-2 text-xs text-gray-300">{volume.driver}</td>
                      <td className="px-3 py-2 font-mono text-xs text-gray-400">{volume.mountpoint || '-'}</td>
                      <td className="px-3 py-2 text-xs text-gray-300">{formatDate(volume.createdAt)}</td>
                      <td className="px-3 py-2 text-xs">
                        {volume.inUse ? (
                          <span className="rounded-full bg-yellow-500/15 px-2 py-0.5 text-yellow-300">
                            In use ({volume.containersUsing})
                          </span>
                        ) : (
                          <span className="rounded-full bg-green-500/15 px-2 py-0.5 text-green-300">Unused</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={() => void onRemove(volume)}
                          disabled={volume.inUse || removingName === volume.name}
                          className={`rounded-lg px-3 py-1.5 text-xs transition-colors disabled:cursor-not-allowed ${
                            volume.inUse
                              ? 'bg-yellow-500/15 text-yellow-300'
                              : 'bg-red-600/20 text-red-300 hover:bg-red-600/30'
                          }`}
                          title={volume.inUse ? 'Stop and remove related containers first' : 'Remove volume'}
                        >
                          {removingName === volume.name ? 'Removing...' : volume.inUse ? 'In use' : 'Delete'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
