import { useMemo, useState } from 'react';
import type { ImagesModalProps } from '../types/components';

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatDate(unixSeconds?: number): string {
  if (!unixSeconds) return '-';
  return new Date(unixSeconds * 1000).toLocaleString();
}

export default function ImagesModal({
  images,
  loading,
  error,
  onClose,
  onRefresh,
  onRemove,
  removingId,
  onPull,
  pulling,
  pullProgress,
}: ImagesModalProps) {
  const [query, setQuery] = useState('');
  const [pullRef, setPullRef] = useState('');
  const [platform, setPlatform] = useState('');

  const filteredImages = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return images;

    return images.filter((image) => {
      const tagsText = image.tags.join(' ').toLowerCase();
      const idText = `${image.shortId} ${image.id}`.toLowerCase();
      return tagsText.includes(term) || idText.includes(term);
    });
  }, [images, query]);

  const hasPercent = Number.isFinite(pullProgress?.percent);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-gray-800 bg-gray-900">
        <div className="flex items-center justify-between border-b border-gray-800 px-6 py-4">
          <div>
            <h2 className="font-semibold text-white">Docker Images</h2>
            <p className="mt-0.5 text-xs text-gray-400">
              Review installed images and remove old ones not in use.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void onRefresh()}
              className="rounded-lg bg-gray-800 px-3 py-1.5 text-xs transition-colors hover:bg-gray-700"
            >
              Refresh
            </button>
            <button
              onClick={onClose}
              className="text-xl leading-none text-gray-400 hover:text-white"
            >
              x
            </button>
          </div>
        </div>

        <div className="overflow-auto p-4">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              value={pullRef}
              onChange={(event) => setPullRef(event.target.value)}
              placeholder="mcp/wikipedia-mcp:latest"
              className="input max-w-xl"
            />
            <input
              value={platform}
              onChange={(event) => setPlatform(event.target.value)}
              placeholder="linux/arm64 (optional)"
              className="input max-w-xs text-xs"
            />
            <button
              onClick={() => void onPull(pullRef, platform, () => {
                setPullRef('');
                setPlatform('');
              })}
              disabled={pulling || !pullRef.trim()}
              className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
            >
              {pulling
                ? hasPercent
                  ? `Pulling ${pullProgress?.percent}%`
                  : 'Pulling...'
                : 'Pull Image'}
            </button>
          </div>

          {pulling && pullProgress ? (
            <div className="mb-3 rounded-lg border border-blue-900/50 bg-blue-950/30 p-3 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2 text-blue-200">
                <span className="font-medium">{pullProgress.image}</span>
                <span>
                  {pullProgress.status || 'Pulling...'}
                  {pullProgress.id ? ` (${pullProgress.id})` : ''}
                </span>
              </div>

              {(pullProgress.total || 0) > 0 ? (
                <>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded bg-blue-950/80">
                    <div
                      className="h-full bg-blue-500 transition-all"
                      style={{ width: `${pullProgress.percent ?? 0}%` }}
                    />
                  </div>
                  <div className="mt-1 text-right text-[11px] text-blue-300">
                    {formatBytes(pullProgress.current || 0)} /{' '}
                    {formatBytes(pullProgress.total || 0)}
                    {hasPercent ? ` (${pullProgress.percent}%)` : ''}
                  </div>
                </>
              ) : null}
            </div>
          ) : null}

          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by image name/tag or id"
              className="input max-w-xl"
            />
            <p className="text-xs text-gray-400">
              Showing {filteredImages.length} of {images.length}
            </p>
          </div>

          {loading ? (
            <div className="py-16 text-center text-sm text-gray-400">
              Loading images...
            </div>
          ) : error ? (
            <div className="rounded-lg bg-red-900/20 px-3 py-2 text-sm text-red-400">
              {error}
            </div>
          ) : filteredImages.length === 0 ? (
            <div className="py-16 text-center text-sm text-gray-400">
              No images found.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-800">
              <table className="min-w-[920px] divide-y divide-gray-800 text-sm">
                <thead className="bg-gray-900/80">
                  <tr className="text-left text-xs uppercase tracking-wide text-gray-400">
                    <th className="px-3 py-2">Image</th>
                    <th className="px-3 py-2">ID</th>
                    <th className="px-3 py-2">Size</th>
                    <th className="px-3 py-2">Created</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800 bg-gray-950/40">
                  {filteredImages.map((image) => (
                    <tr key={image.id}>
                      <td className="px-3 py-2 text-xs text-gray-200">
                        <div className="flex flex-col gap-1">
                          <div>
                            {image.tags.length > 0
                              ? image.tags.join(', ')
                              : '<none>'}
                          </div>
                          {image.platform && (
                            <span className="inline-flex w-fit rounded-full bg-purple-500/20 px-2 py-0.5 text-xs text-purple-300">
                              🔷 {image.platform}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-gray-400">
                        {image.shortId}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-300">
                        {formatBytes(image.size)}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-300">
                        {formatDate(image.created)}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {image.inUse ? (
                          <span className="rounded-full bg-yellow-500/15 px-2 py-0.5 text-yellow-300">
                            In use ({image.containersUsing})
                          </span>
                        ) : image.isDangling ? (
                          <span className="rounded-full bg-gray-700 px-2 py-0.5 text-gray-300">
                            Dangling
                          </span>
                        ) : (
                          <span className="rounded-full bg-green-500/15 px-2 py-0.5 text-green-300">
                            Unused
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={() => void onRemove(image)}
                          disabled={image.inUse || removingId === image.id}
                          className={`rounded-lg px-3 py-1.5 text-xs transition-colors disabled:cursor-not-allowed ${
                            image.inUse
                              ? 'bg-yellow-500/15 text-yellow-300'
                              : 'bg-red-600/20 text-red-300 hover:bg-red-600/30'
                          }`}
                          title={
                            image.inUse
                              ? 'Stop and remove related containers first'
                              : 'Remove image'
                          }
                        >
                          {removingId === image.id
                            ? 'Removing...'
                            : image.inUse
                              ? 'In use'
                              : 'Delete'}
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
  );
}
