import { useMcps } from '../hooks/useMcps'
import { useMcpInspector } from '../hooks/useMcpInspector'
import type { McpInspectorTab, McpTool } from '../types/inspector'

interface MCPInspectorProps {
  onBack: () => void
}

const TABS: Array<{ id: McpInspectorTab; label: string }> = [
  { id: 'tools', label: 'Tools' },
  { id: 'resources', label: 'Resources' },
  { id: 'prompts', label: 'Prompts' },
  { id: 'ping', label: 'Ping' },
  { id: 'roots', label: 'Roots' },
  { id: 'sampling', label: 'Sampling' },
]

export default function MCPInspector({ onBack }: Readonly<MCPInspectorProps>) {
  const { mcps, loading: mcpsLoading } = useMcps()
  const {
    state,
    setSelectedId,
    setActiveTab,
    setSelectedTool,
    setToolParam,
    fetchTools,
    callTool,
    callPing,
    callRoots,
  } = useMcpInspector()

  const selectedMcp = state.selectedId
    ? mcps.find((m) => m.id === state.selectedId)
    : null

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-4">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={onBack}
              className="rounded px-2 py-1 text-gray-400 hover:bg-gray-800 hover:text-gray-300"
            >
              ← Back
            </button>
            <h1 className="text-xl font-bold">🔍 MCP Inspector</h1>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        {/* Server selection and status */}
        <div className="mb-6 rounded-lg border border-gray-800 bg-gray-900 p-4">
          <label className="mb-2 block text-sm font-medium text-gray-400">
            Select Server
          </label>
          <div className="flex items-center gap-3">
            <select
              value={state.selectedId || ''}
              onChange={(e) => setSelectedId(e.target.value || null)}
              disabled={mcpsLoading}
              className="input flex-1"
            >
              <option value="">-- Choose a server --</option>
              {mcps.map((mcp) => (
                <option key={mcp.id} value={mcp.id}>
                  {mcp.name} ({mcp.id})
                </option>
              ))}
            </select>
            {selectedMcp && (
              <div className="flex items-center gap-2">
                <div
                  className={`h-2 w-2 rounded-full ${
                    selectedMcp.status === 'running'
                      ? 'bg-green-500'
                      : 'bg-red-500'
                  }`}
                />
                <span className="text-sm text-gray-400">
                  {selectedMcp.status}
                </span>
              </div>
            )}
          </div>
        </div>

        {!state.selectedId ? (
          <div className="flex items-center justify-center py-20 text-gray-500">
            Select a server to start inspecting
          </div>
        ) : (
          <>
            {/* Tab navigation */}
            <div className="mb-6 border-b border-gray-800">
              <div className="flex gap-0.5">
                {TABS.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                      state.activeTab === tab.id
                        ? 'border-blue-500 text-blue-400'
                        : 'border-transparent text-gray-400 hover:text-gray-300'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Tab content */}
            <div>
              {state.activeTab === 'tools' && (
                <ToolsPanel state={state} setSelectedTool={setSelectedTool} setToolParam={setToolParam} callTool={callTool} />
              )}
              {state.activeTab === 'resources' && (
                <ResourcesPanel resources={state.resources} loading={state.loading} />
              )}
              {state.activeTab === 'prompts' && (
                <PromptsPanel prompts={state.prompts} loading={state.loading} />
              )}
              {state.activeTab === 'ping' && (
                <PingPanel callPing={callPing} loading={state.callLoading} result={state.callResult} />
              )}
              {state.activeTab === 'roots' && (
                <RootsPanel callRoots={callRoots} loading={state.callLoading} result={state.callResult} />
              )}
              {state.activeTab === 'sampling' && (
                <SamplingPanel />
              )}
            </div>

            {/* Error display */}
            {state.error && (
              <div className="mt-4 rounded-lg border border-red-900 bg-red-950 p-4 text-red-200">
                {state.error}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}

interface ToolsPanelProps {
  state: any
  setSelectedTool: (tool: McpTool | null) => void
  setToolParam: (key: string, value: string) => void
  callTool: () => void
}

function ToolsPanel({
  state,
  setSelectedTool,
  setToolParam,
  callTool,
}: Readonly<ToolsPanelProps>) {
  if (state.loading) {
    return <div className="py-8 text-center text-gray-500">Loading tools...</div>
  }

  if (!state.tools || state.tools.length === 0) {
    return <div className="py-8 text-center text-gray-500">No tools available</div>
  }

  return (
    <div className="grid grid-cols-2 gap-6">
      {/* Left: Tools list */}
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
        <h3 className="mb-4 font-semibold text-gray-200">Available Tools</h3>
        <div className="space-y-2 max-h-[500px] overflow-y-auto">
          {state.tools.map((tool: McpTool) => (
            <button
              key={tool.name}
              onClick={() => setSelectedTool(tool)}
              className={`w-full rounded px-3 py-2 text-left text-sm transition-colors ${
                state.selectedTool?.name === tool.name
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
              }`}
            >
              <div className="font-medium">{tool.name}</div>
              {tool.description && (
                <div className="text-xs text-gray-400 line-clamp-2">
                  {tool.description}
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Right: Tool tester */}
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
        {!state.selectedTool ? (
          <div className="flex items-center justify-center h-full text-gray-500">
            Select a tool to test
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <h3 className="mb-2 font-semibold text-gray-200">
                {state.selectedTool.name}
              </h3>
              {state.selectedTool.description && (
                <p className="text-sm text-gray-400">
                  {state.selectedTool.description}
                </p>
              )}
            </div>

            {/* Parameters form */}
            {state.selectedTool.inputSchema && (
              <div className="space-y-3">
                <div className="text-sm font-medium text-gray-300">
                  Parameters
                </div>
                {Object.entries(
                  (state.selectedTool.inputSchema as Record<string, any>)
                    .properties || {}
                ).map(([key, schema]: [string, any]) => (
                  <div key={key}>
                    <label className="mb-1 block text-sm text-gray-400">
                      {key}
                      {schema.required && <span className="text-red-400">*</span>}
                    </label>
                    <input
                      type="text"
                      value={state.toolParams[key] || ''}
                      onChange={(e) => setToolParam(key, e.target.value)}
                      placeholder={schema.description || key}
                      className="input"
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Run button */}
            <button
              onClick={() => void callTool()}
              disabled={state.callLoading}
              className="w-full rounded-lg bg-blue-600 px-4 py-2 font-medium text-white transition-colors hover:bg-blue-500 disabled:bg-gray-700"
            >
              {state.callLoading ? 'Running...' : 'Run Tool'}
            </button>

            {/* Result */}
            {state.callResult && (
              <div className="mt-4 rounded-lg bg-gray-800 p-3">
                <div className="text-sm font-medium text-gray-300 mb-2">
                  Response
                </div>
                <pre className="overflow-x-auto text-xs text-gray-400 whitespace-pre-wrap break-words">
                  {JSON.stringify(state.callResult, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

interface ResourcesPanelProps {
  resources: any[]
  loading: boolean
}

function ResourcesPanel({
  resources,
  loading,
}: Readonly<ResourcesPanelProps>) {
  if (loading) {
    return <div className="py-8 text-center text-gray-500">Loading resources...</div>
  }

  if (!resources || resources.length === 0) {
    return <div className="py-8 text-center text-gray-500">No resources available</div>
  }

  return (
    <div className="space-y-3">
      {resources.map((resource: any) => (
        <div
          key={resource.uri}
          className="rounded-lg border border-gray-800 bg-gray-900 p-4"
        >
          <div className="font-mono text-sm text-blue-400">{resource.uri}</div>
          {resource.name && (
            <div className="mt-1 text-sm text-gray-400">{resource.name}</div>
          )}
          {resource.description && (
            <div className="mt-1 text-sm text-gray-500">{resource.description}</div>
          )}
          {resource.mimeType && (
            <div className="mt-2 inline-block rounded bg-gray-800 px-2 py-1 text-xs text-gray-400">
              {resource.mimeType}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

interface PromptsPanelProps {
  prompts: any[]
  loading: boolean
}

function PromptsPanel({
  prompts,
  loading,
}: Readonly<PromptsPanelProps>) {
  if (loading) {
    return <div className="py-8 text-center text-gray-500">Loading prompts...</div>
  }

  if (!prompts || prompts.length === 0) {
    return <div className="py-8 text-center text-gray-500">No prompts available</div>
  }

  return (
    <div className="space-y-3">
      {prompts.map((prompt: any) => (
        <div
          key={prompt.name}
          className="rounded-lg border border-gray-800 bg-gray-900 p-4"
        >
          <div className="font-medium text-gray-200">{prompt.name}</div>
          {prompt.description && (
            <div className="mt-1 text-sm text-gray-400">{prompt.description}</div>
          )}
          {prompt.arguments && prompt.arguments.length > 0 && (
            <div className="mt-2">
              <div className="text-sm font-medium text-gray-400">Arguments:</div>
              <ul className="mt-1 space-y-1">
                {prompt.arguments.map((arg: any) => (
                  <li key={arg.name} className="text-sm text-gray-500">
                    • {arg.name}
                    {arg.required && <span className="text-red-400"> *</span>}
                    {arg.description && ` - ${arg.description}`}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

interface PingPanelProps {
  callPing: () => void
  loading: boolean
  result: any
}

function PingPanel({
  callPing,
  loading,
  result,
}: Readonly<PingPanelProps>) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-6">
      <div className="mb-4">
        <button
          onClick={() => void callPing()}
          disabled={loading}
          className="rounded-lg bg-blue-600 px-6 py-2 font-medium text-white transition-colors hover:bg-blue-500 disabled:bg-gray-700"
        >
          {loading ? 'Pinging...' : 'Send Ping'}
        </button>
      </div>

      {result && (
        <div className="rounded-lg bg-gray-800 p-4">
          <div className="font-medium text-gray-200 mb-2">Response</div>
          <pre className="overflow-x-auto text-sm text-gray-400 whitespace-pre-wrap break-words">
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}

interface RootsPanelProps {
  callRoots: () => void
  loading: boolean
  result: any
}

function RootsPanel({
  callRoots,
  loading,
  result,
}: Readonly<RootsPanelProps>) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-6">
      <div className="mb-4">
        <button
          onClick={() => void callRoots()}
          disabled={loading}
          className="rounded-lg bg-blue-600 px-6 py-2 font-medium text-white transition-colors hover:bg-blue-500 disabled:bg-gray-700"
        >
          {loading ? 'Loading...' : 'List Roots'}
        </button>
      </div>

      {result && (
        <div className="rounded-lg bg-gray-800 p-4">
          <div className="font-medium text-gray-200 mb-2">Response</div>
          <pre className="overflow-x-auto text-sm text-gray-400 whitespace-pre-wrap break-words">
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}

function SamplingPanel() {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-6">
      <p className="text-gray-400">Sampling panel coming soon...</p>
    </div>
  )
}
