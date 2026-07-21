import { useState, type FormEvent } from 'react';
import type { DeployFormProps, FieldProps } from '../types/components';

type EnvPair = {
  key: string;
  value: string;
  secret: boolean;
};

type HeaderPair = {
  key: string;
  value: string;
};

const IMAGE_SUGGESTIONS = [
  'alpine:3.20',
  'debian:bookworm-slim',
  'ubuntu:24.04',
  'node:22-bookworm-slim',
  'node:20-bookworm-slim',
  'python:3.13-slim',
  'python:3.12-slim',
  'ghcr.io/astral-sh/uv:python3.12-bookworm-slim',
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

const ENTRYPOINT_SUGGESTIONS = [
  'sh',
  'bash',
  'python',
  'python3',
  'uv',
  'uvx',
  'node',
  'ruby',
  'php',
  'java',
  'deno',
  '/bin/sh',
  '/bin/bash',
  '/usr/bin/python',
];

const STEPS = ['Basics', 'Environment', 'Advanced', 'Review'] as const;
const TOTAL_STEPS = STEPS.length;

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

function StepBar({
  step,
  maxStep,
  onGoTo,
}: {
  step: number;
  maxStep: number;
  onGoTo: (target: number) => void;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-gray-800 px-6 py-3">
      {STEPS.map((label, index) => {
        const stepNumber = index + 1;
        const isActive = stepNumber === step;
        const isDone = stepNumber < step;
        const isReachable = stepNumber <= maxStep;
        return (
          <div key={label} className="flex flex-1 items-center gap-2">
            <button
              type="button"
              disabled={!isReachable}
              onClick={() => isReachable && onGoTo(stepNumber)}
              className={`flex flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
                isReachable ? 'cursor-pointer hover:bg-gray-800/60' : 'cursor-default'
              }`}
            >
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                  isActive
                    ? 'bg-blue-600 text-white'
                    : isDone
                      ? 'bg-blue-600/20 text-blue-300'
                      : 'bg-gray-800 text-gray-500'
                }`}
              >
                {isDone ? '✓' : stepNumber}
              </span>
              <span
                className={`truncate text-xs ${
                  isActive ? 'font-medium text-white' : 'text-gray-400'
                }`}
              >
                {label}
              </span>
            </button>
            {stepNumber < TOTAL_STEPS && (
              <span className="hidden h-px w-4 bg-gray-800 sm:block" />
            )}
          </div>
        );
      })}
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

  const initialHeaderPairs: HeaderPair[] =
    initialValues?.httpHeaders &&
    Object.keys(initialValues.httpHeaders).length > 0
      ? Object.entries(initialValues.httpHeaders).map(([key, value]) => ({
          key,
          value: String(value ?? ''),
        }))
      : [{ key: '', value: '' }];

  const [name, setName] = useState(initialValues?.name ?? '');
  const [image, setImage] = useState(initialValues?.image ?? '');
  const [platform, setPlatform] = useState(initialValues?.platform ?? '');
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
  const [headerPairs, setHeaderPairs] =
    useState<HeaderPair[]>(initialHeaderPairs);
  const [deploying, setDeploying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Editing an existing MCP (or prefilling from the catalog) starts with every
  // field already populated, so unlock all steps up front — the user can jump
  // straight to the field they want to change and save from any step.
  const prefilled = Boolean(initialValues);
  const [step, setStep] = useState(1);
  const [maxStep, setMaxStep] = useState(prefilled ? TOTAL_STEPS : 1);
  const [copied, setCopied] = useState(false);

  const currentImage = image.trim();
  const isCurrentImagePulling =
    pullingImage && pullProgress?.image === currentImage;
  const hasPercent = Number.isFinite(pullProgress?.percent);

  const canLeaveBasics = name.trim() !== '' && image.trim() !== '';

  const goTo = (target: number) => {
    setError(null);
    setStep(Math.min(TOTAL_STEPS, Math.max(1, target)));
  };

  const goNext = () => {
    setError(null);
    if (step === 1 && !canLeaveBasics) {
      setError('Fill in Container Name and Docker Image to continue.');
      return;
    }
    setStep((current) => {
      const nextStep = Math.min(TOTAL_STEPS, current + 1);
      setMaxStep((max) => Math.max(max, nextStep));
      return nextStep;
    });
  };

  const goBack = () => {
    setError(null);
    setStep((current) => Math.max(1, current - 1));
  };

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

  const addHeader = () =>
    setHeaderPairs((pairs) => [...pairs, { key: '', value: '' }]);
  const removeHeader = (index: number) =>
    setHeaderPairs((pairs) =>
      pairs.filter((_, pairIndex) => pairIndex !== index)
    );
  const updateHeader = (
    index: number,
    field: keyof HeaderPair,
    value: string
  ) =>
    setHeaderPairs((pairs) =>
      pairs.map((pair, pairIndex) =>
        pairIndex === index ? { ...pair, [field]: value } : pair
      )
    );

  // Human-readable `docker run` equivalent so it's obvious how each field maps.
  // This is an approximation for review only — the real container is created by
  // the backend from the same values.
  const buildDockerRun = (): string => {
    const parts: string[] = ['docker run -d'];
    if (name.trim()) parts.push(`--name ${name.trim()}`);
    if (platform.trim()) parts.push(`--platform ${platform.trim()}`);
    if (port.trim()) parts.push(`-p ${port.trim()}:${port.trim()}`);
    if (entrypoint.trim()) parts.push(`--entrypoint ${entrypoint.trim()}`);
    if (workingDir.trim()) parts.push(`-w ${workingDir.trim()}`);
    if (user.trim()) parts.push(`-u ${user.trim()}`);
    if (networkMode.trim()) parts.push(`--network ${networkMode.trim()}`);
    if (shmSize.trim()) parts.push(`--shm-size ${shmSize.trim()}`);
    if (privileged) parts.push('--privileged');
    envPairs
      .filter((pair) => pair.key.trim())
      .forEach((pair) =>
        parts.push(
          `-e ${pair.key.trim()}=${pair.secret ? '********' : pair.value || ''}`
        )
      );
    linesToArray(volumes).forEach((entry) => parts.push(`-v ${entry}`));
    linesToArray(bindMounts).forEach((entry) => parts.push(`-v ${entry}`));
    linesToArray(extraHosts).forEach((entry) => parts.push(`--add-host ${entry}`));
    linesToArray(dns).forEach((entry) => parts.push(`--dns ${entry}`));
    linesToArray(devices).forEach((entry) => parts.push(`--device ${entry}`));
    parts.push(image.trim() || '<image>');

    const tail: string[] = [];
    if (command.trim()) tail.push(command.trim());
    linesToArray(args).forEach((entry) => tail.push(entry));
    if (tail.length) parts.push(tail.join(' '));

    return parts.join(' \\\n  ');
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(buildDockerRun());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard not available — ignore
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    // While creating, Enter/submit before the last step just advances the
    // wizard. When editing (prefilled), submitting saves from wherever you are.
    if (step < TOTAL_STEPS && !prefilled) {
      goNext();
      return;
    }

    setError(null);
    setDeploying(true);

    try {
      const env = Object.fromEntries(
        envPairs
          .filter((pair) => pair.key.trim())
          .filter((pair) => !pair.secret || pair.value.trim())
          .map((pair) => [pair.key.trim(), pair.value])
      );

      const secretKeys = envPairs
        .filter((pair) => pair.key.trim() && pair.secret && pair.value.trim())
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

      const httpHeaders = Object.fromEntries(
        headerPairs
          .filter((pair) => pair.key.trim())
          .map((pair) => [pair.key.trim(), pair.value])
      );

      await onDeploy({
        name: name.trim(),
        image: image.trim(),
        platform: platform.trim() || undefined,
        transport,
        command: command.trim() || undefined,
        port: port ? Number(port) : undefined,
        env,
        secretKeys: secretKeys.length > 0 ? secretKeys : undefined,
        runtime,
        httpHeaders:
          Object.keys(httpHeaders).length > 0 ? httpHeaders : undefined,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Deploy failed';
      setError(message);
    } finally {
      setDeploying(false);
    }
  };

  const portLabel =
    transport === 'stdio'
      ? 'Host Port (optional, for graph or additional services)'
      : transport === 'streamable-http'
        ? 'Host Port'
        : 'Host Port (host:container mapped to same number)';

  const activeEnv = envPairs.filter((pair) => pair.key.trim());
  const activeHeaders = headerPairs.filter((pair) => pair.key.trim());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-gray-800 bg-gray-900">
        <div className="flex items-center justify-between border-b border-gray-800 px-6 py-4">
          <div>
            <h2 className="font-semibold text-white">{title}</h2>
            <p className="text-xs text-gray-500">
              Step {step} of {TOTAL_STEPS} · {STEPS[step - 1]}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-xl leading-none text-gray-400 hover:text-white"
          >
            x
          </button>
        </div>

        <StepBar step={step} maxStep={maxStep} onGoTo={goTo} />

        <form
          onSubmit={handleSubmit}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="flex flex-col gap-4 overflow-y-auto p-6">
            {/* STEP 1 — Basics */}
            {step === 1 && (
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Container Name *">
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="my-mcp-server"
                    className="input"
                  />
                </Field>

                <Field label="Docker Image *">
                  <input
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

                <Field label="Platform (optional)">
                  <input
                    value={platform}
                    onChange={(event) => setPlatform(event.target.value)}
                    placeholder="linux/arm64"
                    className="input"
                  />
                </Field>

                <Field label="Transport">
                  <select
                    value={transport}
                    onChange={(event) =>
                      setTransport(
                        event.target.value as
                          | 'http'
                          | 'stdio'
                          | 'streamable-http'
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

                <Field label={portLabel}>
                  <input
                    type="number"
                    min={1}
                    max={65535}
                    value={port}
                    onChange={(event) => setPort(event.target.value)}
                    placeholder={
                      transport === 'streamable-http'
                        ? '8931'
                        : transport === 'stdio'
                          ? '8765'
                          : '3001'
                    }
                    className="input"
                  />
                </Field>
              </div>
            )}

            {/* STEP 2 — Environment & Headers */}
            {step === 2 && (
              <>
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
                          placeholder={
                            pair.secret && !pair.value
                              ? '[Secret stored - not displayed]'
                              : 'value'
                          }
                          type={pair.secret ? 'password' : 'text'}
                          className="input flex-1 font-mono text-xs"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            updateEnv(index, 'secret', !pair.secret)
                          }
                          title={
                            pair.secret ? 'Mark as public' : 'Mark as secret'
                          }
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

                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-xs text-gray-400">
                      HTTP Headers (optional)
                    </span>
                    <button
                      type="button"
                      onClick={addHeader}
                      className="text-xs text-blue-400 hover:text-blue-300"
                    >
                      + Add
                    </button>
                  </div>
                  <div className="flex flex-col gap-2">
                    {headerPairs.map((pair, index) => (
                      <div key={index} className="flex gap-2">
                        <input
                          value={pair.key}
                          onChange={(event) =>
                            updateHeader(index, 'key', event.target.value)
                          }
                          placeholder="Header-Name"
                          className="input flex-1 font-mono text-xs"
                        />
                        <input
                          value={pair.value}
                          onChange={(event) =>
                            updateHeader(index, 'value', event.target.value)
                          }
                          placeholder="header-value"
                          className="input flex-1 font-mono text-xs"
                        />
                        {headerPairs.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeHeader(index)}
                            className="px-2 text-red-400 hover:text-red-300"
                          >
                            x
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* STEP 3 — Advanced Runtime */}
            {step === 3 && (
              <section className="rounded-2xl border border-gray-800 bg-gray-950/40 p-4">
                <div className="mb-4">
                  <h3 className="text-sm font-semibold text-white">
                    Advanced Runtime{' '}
                    <span className="font-normal text-gray-500">
                      (optional)
                    </span>
                  </h3>
                  <p className="mt-1 text-xs text-gray-400">
                    Use raw Docker-style values when a MCP needs custom startup,
                    mounts, networking, or privileges. You can skip this step.
                  </p>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Entrypoint">
                    <input
                      value={entrypoint}
                      onChange={(event) => setEntrypoint(event.target.value)}
                      placeholder="/bin/sh"
                      list="entrypoint-suggestions"
                      className="input"
                    />
                    <datalist id="entrypoint-suggestions">
                      {ENTRYPOINT_SUGGESTIONS.map((suggestion) => (
                        <option key={suggestion} value={suggestion} />
                      ))}
                    </datalist>
                  </Field>

                  <Field label="Working Directory">
                    <input
                      value={workingDir}
                      onChange={(event) => setWorkingDir(event.target.value)}
                      placeholder="/shared-data/"
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
            )}

            {/* STEP 4 — Review */}
            {step === 4 && (
              <div className="flex flex-col gap-4">
                <div className="rounded-2xl border border-gray-800 bg-gray-950/40 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-white">
                      docker run (preview)
                    </h3>
                    <button
                      type="button"
                      onClick={handleCopy}
                      className="text-xs text-blue-400 hover:text-blue-300"
                    >
                      {copied ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                  <div className="overflow-x-auto rounded-lg bg-black/60 p-3">
                    <pre className="whitespace-pre font-mono text-[11px] leading-relaxed text-gray-300">
                      {buildDockerRun()}
                    </pre>
                  </div>
                  <p className="mt-2 text-[11px] text-gray-500">
                    Approximate mapping for review. The backend creates the
                    container from the same values.
                  </p>
                </div>

                <dl className="grid gap-x-6 gap-y-2 rounded-2xl border border-gray-800 bg-gray-950/40 p-4 text-sm sm:grid-cols-2">
                  <SummaryRow label="Name" value={name.trim() || '—'} />
                  <SummaryRow label="Image" value={image.trim() || '—'} />
                  <SummaryRow label="Transport" value={transport} />
                  <SummaryRow
                    label="Platform"
                    value={platform.trim() || 'default'}
                  />
                  <SummaryRow
                    label="Command"
                    value={command.trim() || '—'}
                  />
                  <SummaryRow label="Port" value={port.trim() || '—'} />
                  <SummaryRow
                    label="Env vars"
                    value={
                      activeEnv.length
                        ? activeEnv
                            .map(
                              (pair) =>
                                pair.key.trim() + (pair.secret ? ' 🔒' : '')
                            )
                            .join(', ')
                        : 'none'
                    }
                  />
                  <SummaryRow
                    label="HTTP headers"
                    value={
                      activeHeaders.length
                        ? activeHeaders.map((pair) => pair.key.trim()).join(', ')
                        : 'none'
                    }
                  />
                </dl>

                {activeHeaders.length > 0 && (
                  <p className="text-[11px] text-gray-500">
                    HTTP headers are applied by the MCP hub wrapper (not part of
                    the docker run command).
                  </p>
                )}

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
                    Another image is downloading: {pullProgress.image}. Wait for
                    it to finish.
                  </p>
                ) : null}
              </div>
            )}

            {error && (
              <p className="rounded-lg bg-red-900/20 px-3 py-2 text-sm text-red-400">
                {error}
              </p>
            )}
          </div>

          {/* Footer navigation */}
          <div className="flex gap-3 border-t border-gray-800 px-6 py-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-gray-800 px-4 py-2 text-sm transition-colors hover:bg-gray-700"
            >
              Cancel
            </button>
            <div className="flex flex-1 justify-end gap-3">
              {step > 1 && (
                <button
                  type="button"
                  onClick={goBack}
                  className="rounded-lg bg-gray-800 px-4 py-2 text-sm transition-colors hover:bg-gray-700"
                >
                  Back
                </button>
              )}
              {step < TOTAL_STEPS && (
                <button
                  type="button"
                  onClick={goNext}
                  disabled={step === 1 && !canLeaveBasics}
                  className={`rounded-lg px-6 py-2 text-sm transition-colors disabled:opacity-50 ${
                    prefilled
                      ? 'bg-gray-800 hover:bg-gray-700'
                      : 'bg-blue-600 hover:bg-blue-500'
                  }`}
                >
                  Next
                </button>
              )}
              {(prefilled || step === TOTAL_STEPS) && (
                <button
                  type="submit"
                  disabled={
                    deploying ||
                    !canLeaveBasics ||
                    (pullingImage && !isCurrentImagePulling)
                  }
                  className="rounded-lg bg-blue-600 px-6 py-2 text-sm transition-colors hover:bg-blue-500 disabled:opacity-50"
                >
                  {deploying ? submittingLabel : submitLabel}
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="break-words font-mono text-xs text-gray-200">{value}</dd>
    </div>
  );
}
