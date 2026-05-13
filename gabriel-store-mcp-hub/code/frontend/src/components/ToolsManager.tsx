import { useEffect, useState } from 'react';
import type { McpContainer } from '../types/mcp';
import type { McpTool } from '../types/inspector';
import { getMcpTools, updateDisabledTools } from '../services/api';

interface ToolsManagerProps {
  mcp: McpContainer;
  onBack: () => void;
}

const TRANSPORT_BADGE: Record<string, string> = {
  stdio: 'bg-blue-500/15 text-blue-400',
  http: 'bg-purple-500/15 text-purple-400',
  'streamable-http': 'bg-indigo-500/15 text-indigo-400',
};

const STATUS_DOT: Record<string, string> = {
  running: 'bg-green-500',
  exited: 'bg-red-500',
  created: 'bg-yellow-500',
  paused: 'bg-yellow-500',
};

export default function ToolsManager({
  mcp,
  onBack,
}: Readonly<ToolsManagerProps>) {
  const [tools, setTools] = useState<McpTool[]>([]);
  const [disabledTools, setDisabledTools] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);

  const transport = mcp.meta?.transport ?? 'http';

  useEffect(() => {
    fetchTools();
  }, [mcp.id]);

  const fetchTools = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await getMcpTools(mcp.id);
      setTools(response.tools || []);
      setDisabledTools(new Set(response.disabledTools || []));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tools');
    } finally {
      setLoading(false);
    }
  };

  const toggleTool = async (toolName: string) => {
    const newDisabledSet = new Set(disabledTools);

    if (newDisabledSet.has(toolName)) {
      newDisabledSet.delete(toolName);
    } else {
      newDisabledSet.add(toolName);
    }

    setDisabledTools(newDisabledSet);
    setUpdating(true);

    try {
      await updateDisabledTools(mcp.id, Array.from(newDisabledSet));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update tools');
      setDisabledTools(new Set(disabledTools));
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={onBack}
              className="rounded px-2 py-1 text-gray-400 hover:bg-gray-800 hover:text-gray-300"
            >
              ← Back
            </button>
            <h1 className="text-xl font-bold">🛠️ Tools Manager</h1>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {/* Server Info */}
        <div className="mb-6 rounded-lg border border-gray-800 bg-gray-900 p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-lg font-semibold text-white">
                {mcp.name}
              </h2>
              <p className="mt-1 truncate font-mono text-sm text-gray-400">
                {mcp.image}
              </p>
              {mcp.ports?.length ? (
                <p className="mt-1 text-sm text-gray-400">
                  Port: <span className="text-blue-400">{mcp.ports.join(', ')}</span>
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-col gap-2">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${TRANSPORT_BADGE[transport] || 'bg-gray-700 text-gray-400'}`}
              >
                {transport}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-800 px-3 py-1 text-xs font-medium text-gray-300">
                <span
                  className={`h-2 w-2 rounded-full ${STATUS_DOT[mcp.status] ?? 'bg-gray-500'}`}
                />
                {mcp.status}
              </span>
            </div>
          </div>
        </div>

        {/* Refresh button */}
        <div className="mb-6 flex gap-2">
          <button
            onClick={fetchTools}
            disabled={loading || updating}
            className="rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-700 disabled:opacity-50"
          >
            {loading ? 'Loading...' : 'Refresh Tools'}
          </button>
        </div>

        {/* Error message */}
        {error && (
          <div className="mb-6 rounded-lg border border-red-800/50 bg-red-950/50 p-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* Tools list */}
        <div className="space-y-2 rounded-lg border border-gray-800 bg-gray-900">
          {loading && (
            <div className="p-6 text-center text-gray-400">Loading tools...</div>
          )}

          {!loading && tools.length === 0 && !error && (
            <div className="p-6 text-center text-gray-400">
              No tools available for this server
            </div>
          )}

          {!loading &&
            tools.map((tool) => {
              const isDisabled = disabledTools.has(tool.name);
              return (
                <div
                  key={tool.name}
                  className={`flex items-start justify-between gap-3 border-b border-gray-800 p-4 last:border-b-0 transition-opacity ${isDisabled ? 'opacity-60' : ''}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate font-mono text-sm font-semibold text-white">
                        {tool.name}
                      </h3>
                      {isDisabled && (
                        <span className="inline-flex items-center rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-400">
                          disabled
                        </span>
                      )}
                    </div>
                    {tool.description && (
                      <p className="mt-1 text-xs text-gray-400 line-clamp-2">
                        {tool.description}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => toggleTool(tool.name)}
                    disabled={updating}
                    className={`mt-1 shrink-0 rounded-lg px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
                      isDisabled
                        ? 'bg-red-500/15 text-red-400 hover:bg-red-500/25'
                        : 'bg-green-500/15 text-green-400 hover:bg-green-500/25'
                    }`}
                  >
                    {isDisabled ? 'Enable' : 'Disable'}
                  </button>
                </div>
              );
            })}
        </div>

        {!loading && tools.length > 0 && (
          <div className="mt-6 rounded-lg bg-gray-900/50 p-3 text-xs text-gray-400">
            {disabledTools.size > 0
              ? `${disabledTools.size} tool(s) disabled`
              : 'All tools enabled'}
          </div>
        )}
      </main>
    </div>
  );
}
