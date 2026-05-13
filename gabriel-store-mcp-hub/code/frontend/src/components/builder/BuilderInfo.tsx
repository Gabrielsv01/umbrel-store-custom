import type { McpNamespace, BuilderStatistics } from '../../types/builder';

interface BuilderInfoProps {
  namespace: McpNamespace;
  statistics: BuilderStatistics;
}

export default function BuilderInfo({
  namespace,
  statistics,
}: BuilderInfoProps) {
  const createdDate = new Date(namespace.createdAt).toLocaleDateString();
  const updatedDate = new Date(namespace.updatedAt).toLocaleDateString();

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {/* Basic Info Card */}
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-6">
        <h2 className="text-lg font-semibold text-white">{namespace.name}</h2>
        {namespace.description && (
          <p className="mt-2 text-sm text-gray-400">{namespace.description}</p>
        )}
        <div className="mt-4 space-y-2 text-sm text-gray-400">
          <div>
            <span className="text-gray-500">Transport:</span>{' '}
            <span className="font-medium text-blue-400">{namespace.transport}</span>
          </div>
          <div>
            <span className="text-gray-500">Port:</span>{' '}
            <span className="font-medium text-green-400">{namespace.port}</span>
          </div>
          <div>
            <span className="text-gray-500">Created:</span> {createdDate}
          </div>
          <div>
            <span className="text-gray-500">Updated:</span> {updatedDate}
          </div>
          <div>
            <span className="text-gray-500">ID:</span>{' '}
            <code className="text-xs text-gray-600">{namespace.id}</code>
          </div>
        </div>
      </div>

      {/* Statistics Cards */}
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-6">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">
          MCPs
        </h3>
        <div className="mt-4 flex items-baseline gap-2">
          <span className="text-3xl font-bold text-blue-400">
            {statistics.enabledMcpCount}
          </span>
          <span className="text-sm text-gray-500">
            of {statistics.totalMcpCount}
          </span>
        </div>
        <div className="mt-2 h-1 w-full rounded-full bg-gray-800">
          <div
            className="h-full rounded-full bg-blue-500 transition-all"
            style={{
              width: `${
                statistics.totalMcpCount > 0
                  ? (statistics.enabledMcpCount / statistics.totalMcpCount) * 100
                  : 0
              }%`,
            }}
          />
        </div>
      </div>

      <div className="rounded-lg border border-gray-800 bg-gray-900 p-6">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">
          Tools
        </h3>
        <div className="mt-4 space-y-2">
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-green-400">
                {statistics.enabledTools}
              </span>
              <span className="text-sm text-gray-500">enabled</span>
            </div>
          </div>
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-red-400">
                {statistics.disabledTools}
              </span>
              <span className="text-sm text-gray-500">disabled</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
