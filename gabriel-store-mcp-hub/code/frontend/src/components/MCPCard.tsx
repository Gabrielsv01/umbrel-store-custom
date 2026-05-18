import { useState, useEffect, useRef } from 'react';
import type { MCPCardProps, McpAction } from '../types/components';
import type { McpContainer } from '../types/mcp';

const STATUS_DOT: Record<string, string> = {
  running: 'bg-green-500',
  exited: 'bg-red-500',
  created: 'bg-yellow-500',
  paused: 'bg-yellow-500',
};

const STATUS_BADGE: Record<string, string> = {
  running: 'bg-green-500/15 text-green-400',
  exited: 'bg-red-500/15 text-red-400',
  created: 'bg-yellow-500/15 text-yellow-400',
  paused: 'bg-yellow-500/15 text-yellow-400',
};

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
      2
    );
  }

  const port = mcp.ports?.[0];
  const host = window.location.hostname;

  if (mcp.meta?.transport === 'streamable-http') {
    const url = port ? `http://${host}:${port}/mcp` : `http://${host}:3000/mcp`;
    return JSON.stringify({ mcpServers: { [mcp.name]: { url } } }, null, 2);
  }

  const url = port ? `http://${host}:${port}/sse` : `http://${host}:3000/sse`;
  return JSON.stringify({ mcpServers: { [mcp.name]: { url } } }, null, 2);
}

export default function MCPCard({
  mcp,
  onAction,
  actionLoading,
  onViewLogs,
  onEdit,
  onOpenSession,
  onCheckHealth,
  onOpenTools,
  health,
  healthLoading,
  httpHealth,
  httpHealthLoading,
}: MCPCardProps) {
  const [showHealthTip, setShowHealthTip] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const [isMenuPositioned, setIsMenuPositioned] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const isRunning = mcp.status === 'running';

  useEffect(() => {
    if (!showMenu) {
      setIsMenuPositioned(false);
      return;
    }

    if (!buttonRef.current) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    };

    setTimeout(() => {
      if (!buttonRef.current || !menuRef.current) return;

      const buttonRect = buttonRef.current.getBoundingClientRect();
      const menuRect = menuRef.current.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;

      let top = buttonRect.bottom + 8;
      let left = buttonRect.right - 160;

      // Adjust if menu goes below viewport
      if (top + menuRect.height > viewportHeight) {
        top = buttonRect.top - menuRect.height - 8;
      }

      // Adjust if menu goes beyond right edge
      if (left + menuRect.width > viewportWidth) {
        left = viewportWidth - menuRect.width - 8;
      }

      // Ensure minimum left position
      if (left < 8) {
        left = 8;
      }

      setMenuPosition({ top, left });
      setIsMenuPositioned(true);
    }, 0);

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMenu]);

  const busy = !!actionLoading;
  const isStdio = (mcp.meta?.transport ?? 'http') === 'stdio';
  const isHttpTransport = !isStdio;

  const getStdioHealthTone = () => {
    if (!isStdio) return 'bg-gray-700 text-gray-400';
    if (health?.status === 'healthy') return 'bg-green-500/15 text-green-400';
    if (health?.status === 'degraded')
      return 'bg-yellow-500/15 text-yellow-400';
    if (health?.status === 'unhealthy') return 'bg-red-500/15 text-red-400';
    return 'bg-gray-700 text-gray-400';
  };

  const getHttpHealthTone = () => {
    if (!isHttpTransport) return 'bg-gray-700 text-gray-400';
    if (httpHealth?.status === 'healthy')
      return 'bg-green-500/15 text-green-400';
    if (httpHealth?.status === 'unreachable')
      return 'bg-red-500/15 text-red-400';
    if (httpHealth?.status === 'error')
      return 'bg-yellow-500/15 text-yellow-400';
    return 'bg-gray-700 text-gray-400';
  };

  const stdioHealthTone = getStdioHealthTone();
  const httpHealthTone = getHttpHealthTone();

  // Keep backward compat: healthTone used in existing badge
  const healthTone = isStdio ? stdioHealthTone : httpHealthTone;

  const runAction = (action: McpAction) => {
    setShowMenu(false);
    onAction(mcp.id, action);
  };

  const openSession = () => {
    setShowMenu(false);
    onOpenSession(mcp);
  };

  const openLogs = () => {
    setShowMenu(false);
    onViewLogs();
  };

  const openEdit = () => {
    setShowMenu(false);
    onEdit(mcp);
  };

  const openTools = () => {
    setShowMenu(false);
    onOpenTools(mcp);
  };

  const runHealth = () => {
    setShowMenu(false);
    onCheckHealth(mcp.id);
  };

  const getInitializeStatus = () =>
    health?.handshake?.initializeOk ? 'ok' : 'failed';

  const getToolsListStatus = () =>
    health?.handshake?.toolsListOk ? 'ok' : 'failed';

  const getToolsCountLine = () => {
    if (typeof health?.handshake?.toolCount === 'number') {
      return `tools: ${health.handshake.toolCount}`;
    }
    return null;
  };

  const getNetworkProbeLine = () => {
    if (health?.networkProbe?.attempted) {
      const probeStatus = health.networkProbe.ok ? 'ok' : 'failed';
      const toolName = health.networkProbe.toolName
        ? ` (${health.networkProbe.toolName})`
        : '';
      return `network probe: ${probeStatus}${toolName}`;
    }
    if (health?.networkProbe?.reason) {
      return `network probe: ${health.networkProbe.reason}`;
    }
    return null;
  };

  const getNetworkProbeErrorLine = () => {
    if (health?.networkProbe?.error) {
      return `error: ${health.networkProbe.error}`;
    }
    return null;
  };

  const getDiagnosticsIssuesLines = () => {
    if (Array.isArray(health?.diagnostics?.issues)) {
      return health.diagnostics.issues
        .slice(0, 2)
        .map((issue) => `issue: ${issue}`);
    }
    return [];
  };

  const getHttpLatencyLine = () => {
    if (typeof httpHealth?.latencyMs === 'number') {
      return `latency: ${httpHealth.latencyMs}ms`;
    }
    return null;
  };

  const getHttpErrorLine = () => {
    if (httpHealth?.error) {
      return `error: ${httpHealth.error}`;
    }
    return null;
  };

  const getHttpTriedHostsLine = () => {
    if (httpHealth?.diagnostics?.triedHosts?.length) {
      return `hosts tried: ${httpHealth.diagnostics.triedHosts.join(', ')}`;
    }
    return null;
  };

  const formatAttemptLine = (attempt: any, index: number) => {
    const fallbackStatus = attempt.ok ? 'ok' : 'no-response';
    const statusCode =
      typeof attempt.statusCode === 'number'
        ? `HTTP ${attempt.statusCode}`
        : fallbackStatus;
    const errorPart = attempt.error ? ` | err: ${attempt.error}` : '';
    return `${index + 1}. ${attempt.method} ${attempt.url} | ${statusCode} | ${attempt.latencyMs}ms${errorPart}`;
  };

  const getHttpAttemptedEndpointsLines = () => {
    if (Array.isArray(httpHealth?.diagnostics?.attemptedEndpoints)) {
      return httpHealth.diagnostics.attemptedEndpoints
        .slice(0, 8)
        .map((attempt, index) => formatAttemptLine(attempt, index));
    }
    return [];
  };

  const getStdioHealthSummaryLines = () => {
    if (!health) {
      return 'Run the health check to see details.';
    }
    const lines = [
      `status: ${health.status || 'unknown'}`,
      `initialize: ${getInitializeStatus()}`,
      `tools/list: ${getToolsListStatus()}`,
      getToolsCountLine(),
      getNetworkProbeLine(),
      getNetworkProbeErrorLine(),
      ...getDiagnosticsIssuesLines(),
    ];
    return lines.filter(Boolean).join('\n');
  };

  const getHttpHealthSummaryLines = () => {
    if (!httpHealth) {
      return 'Run the health check to see details.';
    }
    const lines = [
      `status: ${httpHealth.status}`,
      getHttpLatencyLine(),
      getHttpErrorLine(),
      getHttpTriedHostsLine(),
      ...getHttpAttemptedEndpointsLines(),
    ];
    return lines.filter(Boolean).join('\n');
  };

  const healthSummary = isStdio
    ? getStdioHealthSummaryLines()
    : getHttpHealthSummaryLines();

  return (
    <div className="relative flex flex-col gap-3 rounded-xl border border-gray-800 bg-gray-900 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-white">
            {mcp.name}
          </h3>
          <p className="mt-0.5 truncate font-mono text-xs text-gray-400">
            {mcp.image}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={`flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs ${STATUS_BADGE[mcp.status] ?? 'bg-gray-700 text-gray-400'}`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[mcp.status] ?? 'bg-gray-500'}`}
            />
            {mcp.status}
          </span>
          {mcp.meta?.platform && (
            <span className="rounded-full bg-purple-500/15 px-2 py-0.5 text-xs text-purple-300">
              🔷 {mcp.meta.platform}
            </span>
          )}
          <button
            ref={buttonRef}
            type="button"
            onClick={() => setShowMenu((prev) => !prev)}
            className="rounded-lg bg-gray-800 px-2 py-1 text-sm text-gray-300 transition-colors hover:bg-gray-700"
            title="Open actions menu"
          >
            ≡
          </button>

          {showMenu && (
            <div
              ref={menuRef}
              style={{
                top: `${menuPosition.top}px`,
                left: `${menuPosition.left}px`,
                opacity: isMenuPositioned ? 1 : 0,
                pointerEvents: isMenuPositioned ? 'auto' : 'none',
              }}
              className="fixed z-50 flex min-w-40 flex-col overflow-y-auto rounded-xl border border-gray-700 bg-gray-950 shadow-2xl max-h-96 transition-opacity"
            >
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

              {(() => {
                const isHealthChecking = isStdio
                  ? healthLoading
                  : httpHealthLoading;
                return (
                  <button
                    type="button"
                    onClick={runHealth}
                    disabled={healthLoading || httpHealthLoading}
                    title="Run health check"
                    className="px-3 py-2 text-left text-xs text-gray-200 transition-colors hover:bg-gray-900 disabled:opacity-50"
                  >
                    {isHealthChecking ? 'Checking health...' : 'Health'}
                  </button>
                );
              })()}

              <button
                type="button"
                onClick={openTools}
                className="px-3 py-2 text-left text-xs text-gray-200 transition-colors hover:bg-gray-900"
              >
                Tools
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
          Port:{' '}
          <span className="font-mono text-blue-400">
            {mcp.ports.join(', ')}
          </span>
        </p>
      ) : null}

      <div className="flex items-center gap-2 text-xs text-gray-400">
        <span className="shrink-0">ID:</span>
        <span className="min-w-0 truncate rounded bg-gray-800 px-2 py-0.5 font-mono text-gray-300">
          {mcp.id}
        </span>
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
            ? healthLoading
              ? 'checking...'
              : health?.status || 'not checked'
            : httpHealthLoading
              ? 'checking...'
              : httpHealth?.status || 'not checked'}
        </button>
        {isHttpTransport &&
          httpHealth?.status === 'healthy' &&
          typeof httpHealth.latencyMs === 'number' && (
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
            <pre className="whitespace-pre-wrap break-words font-mono text-[11px] text-gray-300">
              {healthSummary}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
