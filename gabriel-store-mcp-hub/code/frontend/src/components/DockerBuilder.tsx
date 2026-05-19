import { useState } from 'react';
import { useDockerBuilder } from '../hooks/useDockerBuilder';
import BuildLog from './dockerBuilder/BuildLog';

interface DockerBuilderProps {
  onClose: () => void;
}

type BuildArg = { key: string; value: string };

const DEFAULT_DOCKERFILE = `FROM python:3.11-slim
RUN pip install --no-cache-dir requests
COPY . /app
WORKDIR /app
CMD ["python", "-m", "http.server", "8080"]`;

export default function DockerBuilder({ onClose }: DockerBuilderProps) {
  const [imageName, setImageName] = useState('my-mcp');
  const [tag, setTag] = useState('latest');
  const [dockerfile, setDockerfile] = useState(DEFAULT_DOCKERFILE);
  const [platform, setPlatform] = useState('');
  const [buildArgs, setBuildArgs] = useState<BuildArg[]>([]);

  const {
    building,
    buildLog,
    buildError,
    lastBuiltImage,
    buildProgress,
    handleBuild,
    cancelBuild,
    resetBuild,
  } = useDockerBuilder();

  const addBuildArg = () => {
    setBuildArgs([...buildArgs, { key: '', value: '' }]);
  };

  const removeBuildArg = (idx: number) => {
    setBuildArgs(buildArgs.filter((_, i) => i !== idx));
  };

  const updateBuildArg = (
    idx: number,
    field: 'key' | 'value',
    value: string
  ) => {
    const updated = [...buildArgs];
    updated[idx] = { ...updated[idx], [field]: value };
    setBuildArgs(updated);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const buildArgsObj = buildArgs.reduce(
      (acc, arg) => {
        if (arg.key.trim()) {
          acc[arg.key.trim()] = arg.value;
        }
        return acc;
      },
      {} as Record<string, string>
    );

    await handleBuild(
      dockerfile,
      imageName,
      tag,
      buildArgsObj || undefined,
      platform || undefined
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-gray-800 bg-gray-950 p-6">
        {lastBuiltImage && !building ? (
          <div className="space-y-6">
            <div className="rounded-lg border border-green-700 bg-green-900/20 p-4">
              <h3 className="mb-2 text-sm font-semibold text-green-300">
                ✓ Build Completed
              </h3>
              <p className="mb-4 text-sm text-green-200">
                Image successfully built: {lastBuiltImage}
              </p>

              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setImageName('my-mcp');
                    setTag('latest');
                    setDockerfile(DEFAULT_DOCKERFILE);
                    setPlatform('');
                    setBuildArgs([]);
                    resetBuild();
                  }}
                  className="rounded bg-gray-700 px-3 py-1 text-xs hover:bg-gray-600"
                >
                  Build Another
                </button>
                <button
                  onClick={onClose}
                  className="rounded bg-blue-700 px-3 py-1 text-xs hover:bg-blue-600"
                >
                  Close
                </button>
              </div>
            </div>

            <BuildLog entries={buildLog} building={building} />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">
                🐳 Docker Builder
              </h2>
              <button
                type="button"
                onClick={onClose}
                className="text-gray-400 hover:text-gray-300"
              >
                ✕
              </button>
            </div>

            {/* Image Name and Tag */}
            <div className="mb-6 grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1.5 block text-xs text-gray-400">
                  Image Name
                </label>
                <input
                  type="text"
                  value={imageName}
                  onChange={(e) => setImageName(e.target.value)}
                  placeholder="my-mcp"
                  disabled={building}
                  className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 disabled:bg-gray-900 disabled:text-gray-600"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs text-gray-400">
                  Tag
                </label>
                <input
                  type="text"
                  value={tag}
                  onChange={(e) => setTag(e.target.value)}
                  placeholder="latest"
                  disabled={building}
                  className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 disabled:bg-gray-900 disabled:text-gray-600"
                />
              </div>
            </div>

            {/* Platform */}
            <div className="mb-6">
              <label className="mb-1.5 block text-xs text-gray-400">
                Platform (optional)
              </label>
              <input
                type="text"
                value={platform}
                onChange={(e) => setPlatform(e.target.value)}
                placeholder="linux/amd64"
                disabled={building}
                className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 disabled:bg-gray-900 disabled:text-gray-600"
              />
            </div>

            {/* Build Args */}
            <div className="mb-6">
              <div className="mb-2 flex items-center justify-between">
                <label className="text-xs text-gray-400">
                  Build Args (optional)
                </label>
                <button
                  type="button"
                  onClick={addBuildArg}
                  disabled={building}
                  className="text-xs text-blue-400 hover:text-blue-300 disabled:text-gray-600"
                >
                  + Add Argument
                </button>
              </div>

              {buildArgs.length > 0 && (
                <div className="space-y-2">
                  {buildArgs.map((arg, idx) => (
                    <div key={idx} className="flex gap-2">
                      <input
                        type="text"
                        value={arg.key}
                        onChange={(e) =>
                          updateBuildArg(idx, 'key', e.target.value)
                        }
                        placeholder="KEY"
                        disabled={building}
                        className="flex-1 rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-white placeholder-gray-600 disabled:bg-gray-900 disabled:text-gray-600"
                      />
                      <input
                        type="text"
                        value={arg.value}
                        onChange={(e) =>
                          updateBuildArg(idx, 'value', e.target.value)
                        }
                        placeholder="VALUE"
                        disabled={building}
                        className="flex-1 rounded border border-gray-700 bg-gray-800 px-2 py-1 text-xs text-white placeholder-gray-600 disabled:bg-gray-900 disabled:text-gray-600"
                      />
                      <button
                        type="button"
                        onClick={() => removeBuildArg(idx)}
                        disabled={building}
                        className="rounded bg-red-900/30 px-2 py-1 text-xs text-red-400 hover:bg-red-900/50 disabled:bg-gray-800 disabled:text-gray-600"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Dockerfile */}
            <div className="mb-6">
              <label className="mb-1.5 block text-xs text-gray-400">
                Dockerfile
              </label>
              <textarea
                value={dockerfile}
                onChange={(e) => setDockerfile(e.target.value)}
                disabled={building}
                rows={12}
                className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 font-mono text-xs text-white placeholder-gray-500 disabled:bg-gray-900 disabled:text-gray-600"
                placeholder="FROM ..."
              />
            </div>

            {/* Error Message */}
            {buildError && (
              <div className="mb-6 rounded bg-red-900/30 p-3 text-sm text-red-300">
                {buildError}
              </div>
            )}

            {/* Progress Bar */}
            {building && buildProgress > 0 && (
              <div className="mb-6">
                <div className="mb-2 flex items-center justify-between text-xs text-gray-400">
                  <span>Build Progress</span>
                  <span>{buildProgress}%</span>
                </div>
                <div className="h-2 rounded-full bg-gray-800">
                  <div
                    className="h-full rounded-full bg-blue-600 transition-all"
                    style={{ width: `${buildProgress}%` }}
                  />
                </div>
              </div>
            )}

            {/* Build Log */}
            <BuildLog entries={buildLog} building={building} />

            {/* Buttons */}
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={building}
                className="rounded bg-gray-800 px-4 py-2 text-sm hover:bg-gray-700 disabled:bg-gray-900 disabled:text-gray-600"
              >
                Close
              </button>
              {building ? (
                <button
                  type="button"
                  onClick={cancelBuild}
                  className="flex-1 rounded bg-red-700 px-4 py-2 text-sm font-medium hover:bg-red-600"
                >
                  Cancel Build
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!imageName.trim() || !dockerfile.trim()}
                  className="flex-1 rounded bg-blue-600 px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed"
                >
                  🔨 Build Image
                </button>
              )}
            </div>
        </form>
        )}
      </div>
    </div>
  );
}
