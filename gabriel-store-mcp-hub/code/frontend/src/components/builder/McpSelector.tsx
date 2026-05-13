import type { McpNamespace } from '../../types/builder';
import type { McpContainer } from '../../types/mcp';

interface McpSelectorProps {
  namespace: McpNamespace;
  availableMcps: McpContainer[];
  onToggleMcp: (mcpId: string, enabled: boolean) => void;
}

export default function McpSelector({
  namespace,
  availableMcps,
  onToggleMcp,
}: McpSelectorProps) {
  const toggleMcp = (mcpId: string) => {
    const isEnabled = namespace.enabledMcps.includes(mcpId);
    onToggleMcp(mcpId, !isEnabled);
  };

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-6">
      <h2 className="text-lg font-semibold text-white">MCP Servers</h2>
      <p className="mt-1 text-sm text-gray-400">
        Select which MCP servers to include in this namespace
      </p>

      {availableMcps.length === 0 ? (
        <div className="mt-6 text-center text-sm text-gray-500">
          No MCP servers available. Deploy some MCPs first.
        </div>
      ) : (
        <div className="mt-6 space-y-2">
          {availableMcps.map((mcp) => {
            const isEnabled = namespace.enabledMcps.includes(mcp.id);
            return (
              <div
                key={mcp.id}
                className="flex items-center gap-3 rounded border border-gray-700 bg-gray-800 p-4 hover:bg-gray-750"
              >
                <input
                  type="checkbox"
                  id={`mcp-${mcp.id}`}
                  checked={isEnabled}
                  onChange={() => toggleMcp(mcp.id)}
                  className="h-4 w-4 cursor-pointer rounded border-gray-600 bg-gray-700 accent-blue-600"
                />
                <label
                  htmlFor={`mcp-${mcp.id}`}
                  className="flex-1 cursor-pointer"
                >
                  <div className="font-medium text-white">{mcp.name}</div>
                  <div className="text-xs text-gray-400">
                    {mcp.image}
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    Status: <span className="capitalize">{mcp.status}</span>
                  </div>
                </label>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
