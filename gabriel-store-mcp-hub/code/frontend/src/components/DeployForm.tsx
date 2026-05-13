import { useState, type FormEvent } from 'react';
import type { DeployFormProps, FieldProps } from '../types/components';

type EnvPair = {
  key: string;
  value: string;
  secret: boolean;
};

const IMAGE_SUGGESTIONS = [
  'alpine:3.20',
  'debian:bookworm-slim',
  'ubuntu:24.04',
  'node:22-bookworm-slim',
  'node:20-bookworm-slim',
  'python:3.13-slim',
  'python:3.12-slim',
  'golang:1.24-bookworm',
  'golang:1.23-bookworm',
  'rust:1-bookworm',
  'openjdk:21-jdk-slim',
  'eclipse-temurin:21-jre',
  'php:8.4-cli',
  'ruby:3.4-slim',
  'denoland/deno:2.3.4',
  'mcr.microsoft.com/playwright:latest',
];

function linesToArray(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function Field({ label, children }: FieldProps) {
  return (
    <div>
      <label className="mb-1.5 block text-xs text-gray-400">{label}</label>
      {children}
    </div>
  );
}

export default function DeployForm({
  onDeploy,
  onClose,
  initialValues,
  title = 'Deploy MCP',
  submitLabel = 'Deploy',
  submittingLabel = 'Deploying...',
  pullingImage = false,
  pullProgress = null,
}: DeployFormProps) {
  const initialEnvPairs: EnvPair[] =
    initialValues?.env && Object.keys(initialValues.env).length > 0
      ? Object.entries(initialValues.env).map(([key, value]) => ({
          key,
          value: String(value ?? ''),
          secret: initialValues.secretKeys?.includes(key) ?? false,
        }))
      : [{ key: '', value: '', secret: false }];

  const [name, setName] = useState(initialValues?.name ?? '');
  const [image, setImage] = useState(initialValues?.image ?? '');
  const [transport, setTransport] = useState<
    'http' | 'stdio' | 'streamable-http'
  >(initialValues?.transport ?? 'http');
  const [command, setCommand] = useState(initialValues?.command ?? '');
  const [port, setPort] = useState(
    initialValues?.port ? String(initialValues.port) : ''
  );
  const [entrypoint, setEntrypoint] = useState(
    initialValues?.runtime?.entrypoint ?? ''
  );
  const [args, setArgs] = useState(
    (initialValues?.runtime?.args ?? []).join('\n')
  );
  const [workingDir, setWorkingDir] = useState(
    initialValues?.runtime?.workingDir ?? ''
  );
  const [volumes, setVolumes] = useState(
    (initialValues?.runtime?.volumes ?? []).join('\n')
  );
  const [bindMounts, setBindMounts] = useState(
    (initialValues?.runtime?.bindMounts ?? []).join('\n')
  );
  const [extraHosts, setExtraHosts] = useState(
    (initialValues?.runtime?.extraHosts ?? []).join('\n')
  );
  const [dns, setDns] = useState(
    (initialValues?.runtime?.dns ?? []).join('\n')
  );
  const [networkMode, setNetworkMode] = useState(
    initialValues?.runtime?.networkMode ?? ''
  );
  const [user, setUser] = useState(initialValues?.runtime?.user ?? '');
  const [privileged, setPrivileged] = useState(
    Boolean(initialValues?.runtime?.privileged)
  );
  const [devices, setDevices] = useState(
    (initialValues?.runtime?.devices ?? []).join('\n')
  );
  const [shmSize, setShmSize] = useState(
    initialValues?.runtime?.shmSize ? String(initialValues.runtime.shmSize) : ''
  );
  const [envPairs, setEnvPairs] = useState<EnvPair[]>(initialEnvPairs);
  const [deploying, setDeploying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentImage = image.trim();
  const isCurrentImagePulling =
    pullingImage && pullProgress?.image === currentImage;
  const hasPercent = Number.isFinite(pullProgress?.percent);

  const addEnv = () =>
    setEnvPairs((pairs) => [...pairs, { key: '', value: '', secret: false }]);
  const removeEnv = (index: number) =>
    setEnvPairs((pairs) => pairs.filter((_, pairIndex) => pairIndex !== index));
  const updateEnv = (
    index: number,
    field: keyof EnvPair,
    value: string | boolean
  ) =>
    setEnvPairs((pairs) =>
      pairs.map((pair, pairIndex) =>
        pairIndex === index ? { ...pair, [field]: value } : pair
      )
    );

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setDeploying(true);

    try {
      const env = Object.fromEntries(
        envPairs
          .filter((pair) => pair.key.trim())
          .map((pair) => [pair.key.trim(), pair.value])
      );

      const secretKeys = envPairs
        .filter((pair) => pair.key.trim() && pair.secret)
        .map((pair) => pair.key.trim());

      const runtime = {
        entrypoint: entrypoint.trim() || undefined,
        args: linesToArray(args),
        workingDir: workingDir.trim() || undefined,
        volumes: linesToArray(volumes),
        bindMounts: linesToArray(bindMounts),
        extraHosts: linesToArray(extraHosts),
        dns: linesToArray(dns),
        networkMode: networkMode.trim() || undefined,
        user: user.trim() || undefined,
        privileged,
        devices: linesToArray(devices),
        shmSize: shmSize.trim() || undefined,
      };

      await onDeploy({
        name: name.trim(),
        image: image.trim(),
        transport,
        command: command.trim() || undefined,
        port: transport !== 'stdio' && port ? Number(port) : undefined,
        env,
        secretKeys: secretKeys.length > 0 ? secretKeys : undefined,
        runtime,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Deploy failed';
      setError(message);
    } finally {
      setDeploying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-gray-800 bg-gray-900">
        <div className="flex items-center justify-between border-b border-gray-800 px-6 py-4">
          <h2 className="font-semibold text-white">{title}</h2>
          <button
            onClick={onClose}
            className="text-xl leading-none text-gray-400 hover:text-white"
          >
            x
          </button>
        </div>

        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-4 overflow-y-auto p-6"
        >
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Container Name *">
              <input
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="my-mcp-server"
                className="input"
              />
            </Field>

            <Field label="Docker Image *">
              <input
                required
                value={image}
                onChange={(event) => setImage(event.target.value)}
                placeholder="node:22-bookworm-slim"
                list="docker-image-suggestions"
                className="input"
              />
              <datalist id="docker-image-suggestions">
                {IMAGE_SUGGESTIONS.map((suggestion) => (
                  <option key={suggestion} value={suggestion} />
                ))}
              </datalist>
            </Field>

            <Field label="Transport">
              <select
                value={transport}
                onChange={(event) =>
                  setTransport(
                    event.target.value as 'http' | 'stdio' | 'streamable-http'
                  )
                }
                className="input"
              >
                <option value="http">http/sse (long-running)</option>
                <option value="streamable-http">
                  streamable-http (MCP 2025-03-26)
                </option>
                <option value="stdio">stdio (session on demand)</option>
              </select>
            </Field>

            <Field label="Start Command">
              <input
                value={command}
                onChange={(event) => setCommand(event.target.value)}
                placeholder="npx @modelcontextprotocol/server-github"
                className="input"
              />
            </Field>

            {transport === 'http' && (
              <Field label="Host Port (host:container mapped to same number)">
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={port}
                  onChange={(event) => setPort(event.target.value)}
                  placeholder="3001"
                  className="input"
                />
              </Field>
            )}
            {transport === 'streamable-http' && (
              <Field label="Host Port">
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={port}
                  onChange={(event) => setPort(event.target.value)}
                  placeholder="8931"
                  className="input"
                />
              </Field>
            )}
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs text-gray-400">
                Environment Variables
              </span>
              <button
                type="button"
                onClick={addEnv}
                className="text-xs text-blue-400 hover:text-blue-300"
              >
                + Add
              </button>
            </div>
            <div className="flex flex-col gap-2">
              {envPairs.map((pair, index) => (
                <div key={index} className="flex gap-2">
                  <input
                    value={pair.key}
                    onChange={(event) =>
                      updateEnv(index, 'key', event.target.value)
                    }
                    placeholder="KEY"
                    className="input flex-1 font-mono text-xs"
                  />
                  <input
                    value={pair.value}
                    onChange={(event) =>
                      updateEnv(index, 'value', event.target.value)
                    }
                    placeholder="value"
                    type={pair.secret ? 'password' : 'text'}
                    className="input flex-1 font-mono text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => updateEnv(index, 'secret', !pair.secret)}
                    title={pair.secret ? 'Mark as public' : 'Mark as secret'}
                    className={`rounded px-2 text-xs transition-colors ${pair.secret ? 'bg-yellow-500/20 text-yellow-400' : 'text-gray-500 hover:text-gray-300'}`}
                  >
                    {pair.secret ? '🔒' : '🔓'}
                  </button>
                  {envPairs.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeEnv(index)}
                      className="px-2 text-red-400 hover:text-red-300"
                    >
                      x
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <section className="rounded-2xl border border-gray-800 bg-gray-950/40 p-4">
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-white">
                Advanced Runtime
              </h3>
              <p className="mt-1 text-xs text-gray-400">
                Use raw Docker-style values when a MCP needs custom startup,
                mounts, networking, or privileges.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Entrypoint">
                <input
                  value={entrypoint}
                  onChange={(event) => setEntrypoint(event.target.value)}
                  placeholder="python"
                  className="input"
                />
              </Field>

              <Field label="Working Directory">
                <input
                  value={workingDir}
                  onChange={(event) => setWorkingDir(event.target.value)}
                  placeholder="/workspace"
                  className="input"
                />
              </Field>

              <Field label="User">
                <input
                  value={user}
                  onChange={(event) => setUser(event.target.value)}
                  placeholder="1000:1000"
                  className="input"
                />
              </Field>

              <Field label="Network Mode">
                <input
                  value={networkMode}
                  onChange={(event) => setNetworkMode(event.target.value)}
                  placeholder="bridge"
                  className="input"
                />
              </Field>

              <Field label="SHM Size">
                <input
                  value={shmSize}
                  onChange={(event) => setShmSize(event.target.value)}
                  placeholder="1g or 268435456"
                  className="input"
                />
              </Field>

              <label className="flex items-center gap-3 rounded-xl border border-gray-800 bg-gray-900/70 px-3 py-2 text-sm text-gray-200">
                <input
                  type="checkbox"
                  checked={privileged}
                  onChange={(event) => setPrivileged(event.target.checked)}
                  className="h-4 w-4"
                />
                Run container as privileged
              </label>

              <Field label="Args (one per line)">
                <textarea
                  value={args}
                  onChange={(event) => setArgs(event.target.value)}
                  placeholder={'--host\n0.0.0.0\n--port\n3001'}
                  rows={5}
                  className="input min-h-[8rem] resize-y"
                />
              </Field>

              <Field label="DNS Servers (one per line)">
                <textarea
                  value={dns}
                  onChange={(event) => setDns(event.target.value)}
                  placeholder={'1.1.1.1\n8.8.8.8'}
                  rows={5}
                  className="input min-h-[8rem] resize-y"
                />
              </Field>

              <Field label="Named Volumes (one bind per line)">
                <textarea
                  value={volumes}
                  onChange={(event) => setVolumes(event.target.value)}
                  placeholder={'mcp-cache:/data\nshared-workspace:/workspace'}
                  rows={5}
                  className="input min-h-[8rem] resize-y"
                />
              </Field>

              <Field label="Bind Mounts (one bind per line)">
                <textarea
                  value={bindMounts}
                  onChange={(event) => setBindMounts(event.target.value)}
                  placeholder={
                    '/Users/me/project:/workspace\n/tmp/cache:/cache:ro'
                  }
                  rows={5}
                  className="input min-h-[8rem] resize-y"
                />
              </Field>

              <Field label="Extra Hosts (one per line)">
                <textarea
                  value={extraHosts}
                  onChange={(event) => setExtraHosts(event.target.value)}
                  placeholder={
                    'host.docker.internal:host-gateway\napi.local:10.0.0.5'
                  }
                  rows={5}
                  className="input min-h-[8rem] resize-y"
                />
              </Field>

              <Field label="Devices (one per line)">
                <textarea
                  value={devices}
                  onChange={(event) => setDevices(event.target.value)}
                  placeholder={'/dev/kvm:/dev/kvm:rwm\n/dev/fuse:/dev/fuse'}
                  rows={5}
                  className="input min-h-[8rem] resize-y"
                />
              </Field>
            </div>
          </section>

          {isCurrentImagePulling && pullProgress ? (
            <div className="rounded-lg border border-blue-900/50 bg-blue-950/30 p-3 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2 text-blue-200">
                <span className="font-medium">{pullProgress.image}</span>
                <span>
                  {pullProgress.status || 'Pulling...'}
                  {pullProgress.id ? ` (${pullProgress.id})` : ''}
                </span>
              </div>

              {hasPercent ? (
                <>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded bg-blue-950/80">
                    <div
                      className="h-full bg-blue-500 transition-all"
                      style={{ width: `${pullProgress.percent ?? 0}%` }}
                    />
                  </div>
                  <div className="mt-1 text-right text-[11px] text-blue-300">
                    {pullProgress.percent}%
                  </div>
                </>
              ) : null}
            </div>
          ) : null}

          {pullingImage && !isCurrentImagePulling && pullProgress?.image ? (
            <p className="rounded-lg bg-yellow-900/20 px-3 py-2 text-sm text-yellow-300">
              Another image is downloading: {pullProgress.image}. Wait for it to
              finish.
            </p>
          ) : null}

          {error && (
            <p className="rounded-lg bg-red-900/20 px-3 py-2 text-sm text-red-400">
              {error}
            </p>
          )}

          <div className="mt-2 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg bg-gray-800 py-2 text-sm transition-colors hover:bg-gray-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={deploying || (pullingImage && !isCurrentImagePulling)}
              className="flex-1 rounded-lg bg-blue-600 py-2 text-sm transition-colors hover:bg-blue-500 disabled:opacity-50"
            >
              {deploying ? submittingLabel : submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
