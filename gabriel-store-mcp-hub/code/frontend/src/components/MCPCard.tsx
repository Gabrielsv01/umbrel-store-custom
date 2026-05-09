import { useState } from 'react'
import type { MCPCardProps, McpAction } from '../types/components'
import type { McpContainer } from '../types/mcp'

const STATUS_DOT: Record<string, string> = {
  running: 'bg-green-500',
  exited: 'bg-red-500',
  created: 'bg-yellow-500',
  paused: 'bg-yellow-500',
}

const STATUS_BADGE: Record<string, string> = {
  running: 'bg-green-500/15 text-green-400',
  exited: 'bg-red-500/15 text-red-400',
  created: 'bg-yellow-500/15 text-yellow-400',
  paused: 'bg-yellow-500/15 text-yellow-400',
}

function buildClaudeConfig(mcp: McpContainer): string {
  if (mcp.meta?.transport === 'stdio') {
    return JSON.stringify(
      {
        mcpServers: {
          [mcp.name]: {
            command: 'docker',
            args: ['start', '-ai', mcp.name],
          },
        },
      },
      null,
      2,
    )
  }

  const port = mcp.ports?.[0]
  const host = window.location.hostname

  if (mcp.meta?.transport === 'streamable-http') {
    const url = port ? `http://${host}:${port}/mcp` : `http://${host}:3000/mcp`
    return JSON.stringify({ mcpServers: { [mcp.name]: { url } } }, null, 2)
  }

  const url = port ? `http://${host}:${port}/sse` : `http://${host}:3000/sse`
  return JSON.stringify({ mcpServers: { [mcp.name]: { url } } }, null, 2)
}

export default function MCPCard({
  mcp,
  onAction,
  actionLoading,
  onViewLogs,
  onEdit,
  onOpenSession,
  onCheckHealth,
  health,
  healthLoading,
  httpHealth,
  httpHealthLoading,
}: MCPCardProps) {
  const [copied, setCopied] = useState(false)
  const [copiedId, setCopiedId] = useState(false)
  const [showHealthTip, setShowHealthTip] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const isRunning = mcp.status === 'running'

  const copyConfig = () => {
    navigator.clipboard.writeText(buildClaudeConfig(mcp))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
    setShowMenu(false)
  }

  const busy = !!actionLoading
  const isStdio = (mcp.meta?.transport ?? 'http') === 'stdio'
  const isHttpTransport = !isStdio

  const stdioHealthTone =
    !isStdio
      ? 'bg-gray-700 text-gray-400'
      : health?.status === 'healthy'
        ? 'bg-green-500/15 text-green-400'
        : health?.status === 'degraded'
          ? 'bg-yellow-500/15 text-yellow-400'
          : health?.status === 'unhealthy'
            ? 'bg-red-500/15 text-red-400'
            : 'bg-gray-700 text-gray-400'

  const httpHealthTone =
    !isHttpTransport
      ? 'bg-gray-700 text-gray-400'
      : httpHealth?.status === 'healthy'
        ? 'bg-green-500/15 text-green-400'
        : httpHealth?.status === 'unreachable'
          ? 'bg-red-500/15 text-red-400'
          : httpHealth?.status === 'error'
            ? 'bg-yellow-500/15 text-yellow-400'
            : 'bg-gray-700 text-gray-400'

  // Keep backward compat: healthTone used in existing badge
  const healthTone = isStdio ? stdioHealthTone : httpHealthTone

  const copyId = () => {
    navigator.clipboard.writeText(mcp.id)
    setCopiedId(true)
    setTimeout(() => setCopiedId(false), 1500)
  }

  const runAction = (action: McpAction) => {
    setShowMenu(false)
    onAction(mcp.id, action)
  }

  const openSession = () => {
    setShowMenu(false)
    onOpenSession(mcp)
  }

  const openLogs = () => {
    setShowMenu(false)
    onViewLogs()
  }

  const openEdit = () => {
    setShowMenu(false)
    onEdit(mcp)
  }

  const runHealth = () => {
    setShowMenu(false)
    onCheckHealth(mcp.id)
  }

  const healthSummary = isStdio
    ? health
      ? [
          `status: ${health.status || 'unknown'}`,
          `initialize: ${health.handshake?.initializeOk ? 'ok' : 'failed'}`,
          `tools/list: ${health.handshake?.toolsListOk ? 'ok' : 'failed'}`,
          typeof health.handshake?.toolCount === 'number' ? `tools: ${health.handshake.toolCount}` : null,
          health.networkProbe?.attempted
            ? `network probe: ${health.networkProbe.ok ? 'ok' : 'failed'}${health.networkProbe.toolName ? ` (${health.networkProbe.toolName})` : ''}`
            : health.networkProbe?.reason
              ? `network probe: ${health.networkProbe.reason}`
              : null,
          health.networkProbe?.error ? `error: ${health.networkProbe.error}` : null,
          ...(Array.isArray(health.diagnostics?.issues)
            ? health.diagnostics.issues.slice(0, 2).map((issue) => `issue: ${issue}`)
            : []),
        ]
          .filter(Boolean)
          .join('\n')
      : 'Run the health check to see details.'
    : httpHealth
      ? [
          `status: ${httpHealth.status}`,
          typeof httpHealth.latencyMs === 'number' ? `latency: ${httpHealth.latencyMs}ms` : null,
          httpHealth.error ? `error: ${httpHealth.error}` : null,
          httpHealth.diagnostics?.triedHosts?.length
            ? `hosts tried: ${httpHealth.diagnostics.triedHosts.join(', ')}`
            : null,
          ...(Array.isArray(httpHealth.diagnostics?.attemptedEndpoints)
            ? httpHealth.diagnostics.attemptedEndpoints.slice(0, 8).map((attempt, index) => {
                const status =
                  typeof attempt.statusCode === 'number'
                    ? `HTTP ${attempt.statusCode}`
                    : attempt.ok
                      ? 'ok'
                      : 'no-response'
                const errPart = attempt.error ? ` | err: ${attempt.error}` : ''
                return `${index + 1}. ${attempt.method} ${attempt.url} | ${status} | ${attempt.latencyMs}ms${errPart}`
              })
            : []),
        ]
          .filter(Boolean)
          .join('\n')
      : 'Run the health check to see details.'

  return (
    <div className="relative flex flex-col gap-3 rounded-xl border border-gray-800 bg-gray-900 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-white">{mcp.name}</h3>
          <p className="mt-0.5 truncate font-mono text-xs text-gray-400">{mcp.image}</p>
        </div>
        <div className="relative flex shrink-0 items-center gap-2">
          <span
            className={`flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs ${STATUS_BADGE[mcp.status] ?? 'bg-gray-700 text-gray-400'}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[mcp.status] ?? 'bg-gray-500'}`} />
            {mcp.status}
          </span>
          <button
            type="button"
            onClick={() => setShowMenu((prev) => !prev)}
            className="rounded-lg bg-gray-800 px-2 py-1 text-sm text-gray-300 transition-colors hover:bg-gray-700"
            title="Open actions menu"
          >
            ≡
          </button>

          {showMenu && (
            <div className="absolute right-0 top-10 z-10 flex min-w-40 flex-col overflow-hidden rounded-xl border border-gray-700 bg-gray-950 shadow-2xl">
              {isRunning ? (
                <button
                  type="button"
                  onClick={() => runAction('stop')}
                  disabled={busy}
                  className="px-3 py-2 text-left text-xs text-gray-200 transition-colors hover:bg-gray-900 disabled:opacity-50"
                >
                  {actionLoading === 'stop' ? 'Stopping...' : 'Stop'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => runAction('start')}
                  disabled={busy}
                  className="px-3 py-2 text-left text-xs text-gray-200 transition-colors hover:bg-gray-900 disabled:opacity-50"
                >
                  {actionLoading === 'start' ? 'Starting...' : 'Start'}
                </button>
              )}

              <button
                type="button"
                onClick={openLogs}
                className="px-3 py-2 text-left text-xs text-gray-200 transition-colors hover:bg-gray-900"
              >
                Logs
              </button>

              {isStdio ? (
                <button
                  type="button"
                  onClick={openSession}
                  className="px-3 py-2 text-left text-xs text-gray-200 transition-colors hover:bg-gray-900"
                >
                  Session
                </button>
              ) : null}

              <button
                type="button"
                onClick={runHealth}
                disabled={healthLoading || httpHealthLoading}
                title="Run health check"
                className="px-3 py-2 text-left text-xs text-gray-200 transition-colors hover:bg-gray-900 disabled:opacity-50"
              >
                {(isStdio ? healthLoading : httpHealthLoading) ? 'Checking health...' : 'Health'}
              </button>

              <button
                type="button"
                onClick={openEdit}
                className="px-3 py-2 text-left text-xs text-gray-200 transition-colors hover:bg-gray-900"
              >
                Edit
              </button>

              <button
                type="button"
                onClick={copyConfig}
                className="px-3 py-2 text-left text-xs text-blue-400 transition-colors hover:bg-gray-900"
              >
                {copied ? 'Config copied' : 'Copy Config'}
              </button>

              <button
                type="button"
                onClick={() => runAction('remove')}
                disabled={busy}
                className="px-3 py-2 text-left text-xs text-red-400 transition-colors hover:bg-gray-900 disabled:opacity-50"
              >
                {actionLoading === 'remove' ? 'Removing...' : 'Remove'}
              </button>
            </div>
          )}
        </div>
      </div>

      {mcp.ports?.length ? (
        <p className="text-xs text-gray-400">
          Port: <span className="font-mono text-blue-400">{mcp.ports.join(', ')}</span>
        </p>
      ) : null}

      <div className="flex items-center gap-2 text-xs text-gray-400">
        <span className="shrink-0">ID:</span>
        <span className="min-w-0 truncate rounded bg-gray-800 px-2 py-0.5 font-mono text-gray-300">{mcp.id}</span>
        <button
          onClick={copyId}
          className="rounded bg-gray-800 px-2 py-0.5 text-[11px] text-gray-300 transition-colors hover:bg-gray-700"
          title="Copy MCP ID"
        >
          {copiedId ? 'Copied' : 'Copy ID'}
        </button>
      </div>

      <div className="relative flex flex-wrap items-center gap-2 text-xs text-gray-400">
        <span className="shrink-0">Health:</span>
        <button
          type="button"
          onClick={() => setShowHealthTip((prev) => !prev)}
          className={`rounded px-2 py-0.5 text-left ${healthTone}`}
          title="Show health details"
        >
          {isStdio
            ? healthLoading ? 'checking...' : health?.status || 'not checked'
            : httpHealthLoading ? 'checking...' : httpHealth?.status || 'not checked'}
        </button>
        {isHttpTransport && httpHealth?.status === 'healthy' && typeof httpHealth.latencyMs === 'number' && (
          <span className="text-gray-500">{httpHealth.latencyMs}ms</span>
        )}

        {showHealthTip && (
          <div className="w-full rounded-lg border border-gray-700 bg-gray-950 p-3 text-[11px] leading-relaxed text-gray-300 shadow-lg">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="font-medium text-white">Health details</span>
              <button
                type="button"
                onClick={() => setShowHealthTip(false)}
                className="text-gray-500 transition-colors hover:text-white"
              >
                x
              </button>
            </div>
            <pre className="whitespace-pre-wrap break-words font-mono text-[11px] text-gray-300">{healthSummary}</pre>
          </div>
        )}
      </div>
    </div>
  )
}
