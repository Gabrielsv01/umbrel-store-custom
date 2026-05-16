import type { McpNamespace } from '../../types/builder';
import type { McpContainer } from '../../types/mcp';

interface McpSelectorProps {
  namespace: McpNamespace;
  availableMcps: McpContainer[];
  onToggleMcp: (mcpId: string, enabled: boolean) => void;
}

function isCustomToolsMcp(mcp: McpContainer): boolean {
  const lowerName = mcp.name.toLowerCase();
  return lowerName.includes('custom') || lowerName.includes('tools');
}

function renderMcpItem(
  mcp: McpContainer,
  isEnabled: boolean,
  toggleMcp: (id: string) => void,
  isCustomTools: boolean
) {
  return (
    <div
      key={mcp.id}
      className={`flex items-center gap-3 rounded border p-4 transition-colors ${
        isCustomTools
          ? 'border-purple-700 bg-purple-900/20 hover:bg-purple-900/30'
          : 'border-gray-700 bg-gray-800 hover:bg-gray-750'
      }`}
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
        <div className="flex items-center gap-2">
          <span className="font-medium text-white">{mcp.name}</span>
          {isCustomTools && (
            <span className="inline-block rounded-full bg-purple-600 px-2 py-0.5 text-xs font-semibold text-white">
              🛠️ Tools
            </span>
          )}
        </div>
        <div className="text-xs text-gray-400">
          {mcp.image}
        </div>
        <div className="mt-1 text-xs text-gray-500">
          Status: <span className="capitalize">{mcp.status}</span>
        </div>
      </label>
    </div>
  );
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

  const regularMcps = availableMcps.filter((mcp) => !isCustomToolsMcp(mcp));
  const customToolsMcps = availableMcps.filter((mcp) => isCustomToolsMcp(mcp));

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-6">
      <h2 className="text-lg font-semibold text-white">Select MCPs</h2>
      <p className="mt-1 text-sm text-gray-400">
        Choose which MCP servers to include in this namespace. Custom Tools MCPs are MCPs you created with custom tools.
      </p>

      {availableMcps.length === 0 ? (
        <div className="mt-6 text-center text-sm text-gray-500">
          No MCP servers available. Deploy some MCPs first.
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          {/* Regular MCPs Section */}
          {regularMcps.length > 0 && (
            <div>
              <h3 className="mb-3 text-sm font-semibold text-gray-300">
                📦 MCP Servers
              </h3>
              <div className="space-y-2">
                {regularMcps.map((mcp) => {
                  const isEnabled = namespace.enabledMcps.includes(mcp.id);
                  return renderMcpItem(mcp, isEnabled, toggleMcp, false);
                })}
              </div>
            </div>
          )}

          {/* Custom Tools MCPs Section */}
          {customToolsMcps.length > 0 && (
            <div className="border-t border-gray-700 pt-6">
              <h3 className="mb-3 text-sm font-semibold text-purple-300">
                🛠️ Custom Tools MCPs
              </h3>
              <p className="mb-3 text-xs text-gray-400">
                These are MCPs you created with custom tools. Add them to expose those tools.
              </p>
              <div className="space-y-2">
                {customToolsMcps.map((mcp) => {
                  const isEnabled = namespace.enabledMcps.includes(mcp.id);
                  return renderMcpItem(mcp, isEnabled, toggleMcp, true);
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
