import { useEffect, useState } from 'react';
import { fetchCatalog } from '../services/api';
import type { CatalogEntry } from '../types/catalog';
import type { CatalogModalProps } from '../types/components';

const CATEGORY_COLORS: Record<string, string> = {
  'Developer Tools': 'bg-blue-500/15 text-blue-400',
  'Browser Automation': 'bg-purple-500/15 text-purple-400',
  Testing: 'bg-indigo-500/15 text-indigo-400',
  Storage: 'bg-green-500/15 text-green-400',
  Web: 'bg-cyan-500/15 text-cyan-400',
  Database: 'bg-orange-500/15 text-orange-400',
  Reasoning: 'bg-yellow-500/15 text-yellow-400',
  Utilities: 'bg-gray-500/15 text-gray-400',
};

function CategoryBadge({ category }: { category: string }) {
  const color = CATEGORY_COLORS[category] ?? 'bg-gray-500/15 text-gray-400';
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] ${color}`}>
      {category}
    </span>
  );
}

export default function CatalogModal({ onClose, onSelect }: CatalogModalProps) {
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetchCatalog()
      .then(setCatalog)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Failed to load catalog')
      )
      .finally(() => setLoading(false));
  }, []);

  const filtered = search.trim()
    ? catalog.filter(
        (e) =>
          e.name.toLowerCase().includes(search.toLowerCase()) ||
          e.category.toLowerCase().includes(search.toLowerCase()) ||
          e.description.toLowerCase().includes(search.toLowerCase())
      )
    : catalog;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-gray-800 bg-gray-900">
        <div className="flex items-center justify-between border-b border-gray-800 px-6 py-4">
          <div>
            <h2 className="font-semibold text-white">MCP Catalog</h2>
            <p className="mt-0.5 text-xs text-gray-400">
              Select a template to pre-fill the deploy form
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-xl leading-none text-gray-400 hover:text-white"
          >
            x
          </button>
        </div>

        <div className="border-b border-gray-800 px-6 py-3">
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, category or description..."
            className="input w-full"
          />
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-gray-500">
              Loading catalog...
            </div>
          ) : error ? (
            <div className="flex items-center justify-center py-12 text-red-400">
              {error}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-gray-500">
              No results found.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {filtered.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => onSelect(entry)}
                  className="group flex flex-col gap-2 rounded-xl border border-gray-800 bg-gray-950/50 p-4 text-left transition-colors hover:border-blue-600 hover:bg-gray-800/60"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold text-white group-hover:text-blue-300">
                      {entry.name}
                    </span>
                    <CategoryBadge category={entry.category} />
                  </div>
                  <p className="text-xs text-gray-400">{entry.description}</p>
                  <div className="flex items-center gap-2 text-[11px] text-gray-500">
                    <span className="rounded bg-gray-800 px-1.5 py-0.5 font-mono">
                      {entry.transport}
                    </span>
                    {entry.secretKeys && entry.secretKeys.length > 0 && (
                      <span className="text-yellow-500">
                        🔒 requires API key
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
