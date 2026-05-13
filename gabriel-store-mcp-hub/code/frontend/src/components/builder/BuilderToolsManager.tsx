import { useState, useMemo } from 'react';
import type { McpNamespace, ManagedTool } from '../../types/builder';
import type { McpContainer } from '../../types/mcp';

interface BuilderToolsManagerProps {
  namespace: McpNamespace;
  availableMcps: McpContainer[];
  onToggleTool: (toolId: string, disabled: boolean) => void;
}

export default function BuilderToolsManager({
  namespace,
  availableMcps,
  onToggleTool,
}: BuilderToolsManagerProps) {
  const [filterMcp, setFilterMcp] = useState<string>('');

  const managedTools = useMemo(() => {
    const tools: ManagedTool[] = [];

    namespace.enabledMcps.forEach((mcpId) => {
      const mcp = availableMcps.find((m) => m.id === mcpId);
      if (!mcp) return;

      // Mock tools for demo - in real app, these would come from MCP inspection
      const mockTools: ManagedTool[] = [
        {
          id: `${mcpId}_tool_1`,
          name: 'get_info',
          description: 'Get information from the server',
          source: {
            mcpId: mcp.id,
            mcpName: mcp.name,
          },
          disabled: namespace.disabledTools.includes(`${mcpId}_tool_1`),
        },
        {
          id: `${mcpId}_tool_2`,
          name: 'execute_command',
          description: 'Execute a command on the server',
          source: {
            mcpId: mcp.id,
            mcpName: mcp.name,
          },
          disabled: namespace.disabledTools.includes(`${mcpId}_tool_2`),
        },
        {
          id: `${mcpId}_tool_3`,
          name: 'list_resources',
          description: 'List available resources',
          source: {
            mcpId: mcp.id,
            mcpName: mcp.name,
          },
          disabled: namespace.disabledTools.includes(`${mcpId}_tool_3`),
        },
      ];

      tools.push(...mockTools);
    });

    return tools;
  }, [namespace.enabledMcps, namespace.disabledTools, availableMcps]);

  const enabledMcpNames = availableMcps
    .filter((m) => namespace.enabledMcps.includes(m.id))
    .map((m) => m.name);

  const filteredTools = filterMcp
    ? managedTools.filter((t) => t.source.mcpId === filterMcp)
    : managedTools;

  const toggleTool = (toolId: string) => {
    const tool = managedTools.find((t) => t.id === toolId);
    if (tool) {
      onToggleTool(toolId, !tool.disabled);
    }
  };

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-6">
      <h2 className="text-lg font-semibold text-white">Tool Manager</h2>
      <p className="mt-1 text-sm text-gray-400">
        Manage tools from enabled MCP servers
      </p>

      {managedTools.length === 0 ? (
        <div className="mt-6 text-center text-sm text-gray-500">
          No tools available. Enable at least one MCP server first.
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          <div className="flex gap-2">
            <div className="w-full">
              <label className="block text-xs font-medium text-gray-400 uppercase">
                Filter by MCP
              </label>
              <select
                value={filterMcp}
                onChange={(e) => setFilterMcp(e.target.value)}
                className="mt-2 w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
              >
                <option value="">All MCPs</option>
                {enabledMcpNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-end gap-2">
              <button
                onClick={() =>
                  managedTools.forEach((t) =>
                    toggleTool(t.id)
                  )
                }
                className="rounded bg-gray-700 px-3 py-2 text-sm hover:bg-gray-600"
              >
                Toggle All
              </button>
            </div>
          </div>

          <div className="space-y-2">
            {filteredTools.map((tool) => (
              <div
                key={tool.id}
                className={`flex items-center gap-3 rounded border p-3 transition-colors ${
                  tool.disabled
                    ? 'border-gray-700 bg-gray-800 opacity-60'
                    : 'border-gray-700 bg-gray-800 hover:border-gray-600'
                }`}
              >
                <input
                  type="checkbox"
                  id={`tool-${tool.id}`}
                  checked={!tool.disabled}
                  onChange={() => toggleTool(tool.id)}
                  className="h-4 w-4 cursor-pointer rounded border-gray-600 bg-gray-700 accent-blue-600"
                />
                <label
                  htmlFor={`tool-${tool.id}`}
                  className="flex-1 cursor-pointer"
                >
                  <div className="font-mono text-sm font-medium text-white">
                    {tool.name}
                  </div>
                  <div className="text-xs text-gray-500">
                    {tool.description}
                  </div>
                  <div className="mt-1 text-xs text-gray-600">
                    from <span className="font-medium">{tool.source.mcpName}</span>
                  </div>
                </label>
              </div>
            ))}
          </div>

          <div className="mt-4 border-t border-gray-700 pt-4">
            <div className="text-xs text-gray-400">
              <span className="font-medium">
                {managedTools.filter((t) => !t.disabled).length}
              </span>{' '}
              enabled of{' '}
              <span className="font-medium">{managedTools.length}</span> tools
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
