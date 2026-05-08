import { useState } from 'react'

const STATUS_DOT = {
  running: 'bg-green-500',
  exited: 'bg-red-500',
  created: 'bg-yellow-500',
  paused: 'bg-yellow-500',
}

const STATUS_BADGE = {
  running: 'bg-green-500/15 text-green-400',
  exited: 'bg-red-500/15 text-red-400',
  created: 'bg-yellow-500/15 text-yellow-400',
  paused: 'bg-yellow-500/15 text-yellow-400',
}

function buildClaudeConfig(mcp) {
  const port = mcp.ports?.[0]
  const host = window.location.hostname
  const url = port ? `http://${host}:${port}/sse` : `http://${host}:3000/sse`
  return JSON.stringify(
    { mcpServers: { [mcp.name]: { url } } },
    null,
    2,
  )
}

export default function MCPCard({
  mcp,
  onAction,
  actionLoading,
  onViewLogs,
  onEdit,
}) {
  const [copied, setCopied] = useState(false)
  const isRunning = mcp.status === 'running'

  const copyConfig = () => {
    navigator.clipboard.writeText(buildClaudeConfig(mcp))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const busy = !!actionLoading

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-gray-800 bg-gray-900 p-4">
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-white">
            {mcp.name}
          </h3>
          <p className="mt-0.5 truncate font-mono text-xs text-gray-400">
            {mcp.image}
          </p>
        </div>
        <span
          className={`flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs ${STATUS_BADGE[mcp.status] ?? 'bg-gray-700 text-gray-400'}`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[mcp.status] ?? 'bg-gray-500'}`}
          />
          {mcp.status}
        </span>
      </div>

      {/* Ports */}
      {mcp.ports?.length > 0 && (
        <p className="text-xs text-gray-400">
          Port:{' '}
          <span className="font-mono text-blue-400">
            {mcp.ports.join(', ')}
          </span>
        </p>
      )}

      {/* Actions */}
      <div className="mt-auto flex items-center gap-2 border-t border-gray-800 pt-3">
        {isRunning ? (
          <button
            onClick={() => onAction(mcp.id, 'stop')}
            disabled={busy}
            className="rounded-lg bg-gray-800 px-3 py-1.5 text-xs transition-colors hover:bg-gray-700 disabled:opacity-50"
          >
            {actionLoading === 'stop' ? '…' : 'Stop'}
          </button>
        ) : (
          <button
            onClick={() => onAction(mcp.id, 'start')}
            disabled={busy}
            className="rounded-lg bg-gray-800 px-3 py-1.5 text-xs transition-colors hover:bg-gray-700 disabled:opacity-50"
          >
            {actionLoading === 'start' ? '…' : 'Start'}
          </button>
        )}

        <button
          onClick={onViewLogs}
          className="rounded-lg bg-gray-800 px-3 py-1.5 text-xs transition-colors hover:bg-gray-700"
        >
          Logs
        </button>

        <button
          onClick={() => onEdit(mcp)}
          className="rounded-lg bg-gray-800 px-3 py-1.5 text-xs transition-colors hover:bg-gray-700"
        >
          Edit
        </button>

        <button
          onClick={copyConfig}
          className="ml-auto rounded-lg bg-blue-600/20 px-3 py-1.5 text-xs text-blue-400 transition-colors hover:bg-blue-600/30"
        >
          {copied ? '✓ Copied' : 'Copy Config'}
        </button>

        <button
          onClick={() => onAction(mcp.id, 'remove')}
          disabled={busy}
          className="rounded-lg bg-red-600/20 px-3 py-1.5 text-xs text-red-400 transition-colors hover:bg-red-600/30 disabled:opacity-50"
          title="Remove container"
        >
          {actionLoading === 'remove' ? '…' : '✕'}
        </button>
      </div>
    </div>
  )
}
