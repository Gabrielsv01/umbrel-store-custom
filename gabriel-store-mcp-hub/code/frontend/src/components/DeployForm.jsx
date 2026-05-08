import { useState } from 'react'

function linesToArray(value) {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

function Field({ label, children }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs text-gray-400">{label}</label>
      {children}
    </div>
  )
}

export default function DeployForm({
  onDeploy,
  onClose,
  initialValues,
  title = 'Deploy MCP',
  submitLabel = 'Deploy',
  submittingLabel = 'Deploying…',
}) {
  const initialEnvPairs =
    initialValues?.env && Object.keys(initialValues.env).length > 0
      ? Object.entries(initialValues.env).map(([key, value]) => ({ key, value }))
      : [{ key: '', value: '' }]

  const [name, setName] = useState(initialValues?.name ?? '')
  const [image, setImage] = useState(initialValues?.image ?? '')
  const [transport, setTransport] = useState(initialValues?.transport ?? 'http')
  const [command, setCommand] = useState(initialValues?.command ?? '')
  const [port, setPort] = useState(initialValues?.port ? String(initialValues.port) : '')
  const [entrypoint, setEntrypoint] = useState(initialValues?.runtime?.entrypoint ?? '')
  const [args, setArgs] = useState((initialValues?.runtime?.args ?? []).join('\n'))
  const [workingDir, setWorkingDir] = useState(initialValues?.runtime?.workingDir ?? '')
  const [volumes, setVolumes] = useState((initialValues?.runtime?.volumes ?? []).join('\n'))
  const [bindMounts, setBindMounts] = useState((initialValues?.runtime?.bindMounts ?? []).join('\n'))
  const [extraHosts, setExtraHosts] = useState((initialValues?.runtime?.extraHosts ?? []).join('\n'))
  const [dns, setDns] = useState((initialValues?.runtime?.dns ?? []).join('\n'))
  const [networkMode, setNetworkMode] = useState(initialValues?.runtime?.networkMode ?? '')
  const [user, setUser] = useState(initialValues?.runtime?.user ?? '')
  const [privileged, setPrivileged] = useState(Boolean(initialValues?.runtime?.privileged))
  const [devices, setDevices] = useState((initialValues?.runtime?.devices ?? []).join('\n'))
  const [shmSize, setShmSize] = useState(
    initialValues?.runtime?.shmSize ? String(initialValues.runtime.shmSize) : '',
  )
  const [envPairs, setEnvPairs] = useState(initialEnvPairs)
  const [deploying, setDeploying] = useState(false)
  const [error, setError] = useState(null)

  const addEnv = () => setEnvPairs((p) => [...p, { key: '', value: '' }])
  const removeEnv = (i) => setEnvPairs((p) => p.filter((_, idx) => idx !== i))
  const updateEnv = (i, field, val) =>
    setEnvPairs((p) =>
      p.map((pair, idx) => (idx === i ? { ...pair, [field]: val } : pair)),
    )

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setDeploying(true)
    try {
      const env = Object.fromEntries(
        envPairs
          .filter((p) => p.key.trim())
          .map((p) => [p.key.trim(), p.value]),
      )

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
      }

      await onDeploy({
        name: name.trim(),
        image: image.trim(),
        transport,
        command: command.trim() || undefined,
        port: transport === 'http' && port ? Number(port) : undefined,
        env,
        runtime,
      })
    } catch (err) {
      setError(err.message)
    } finally {
      setDeploying(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-gray-800 bg-gray-900">
        {/* Modal header */}
        <div className="flex items-center justify-between border-b border-gray-800 px-6 py-4">
          <h2 className="font-semibold text-white">{title}</h2>
          <button
            onClick={onClose}
            className="text-xl leading-none text-gray-400 hover:text-white"
          >
            ×
          </button>
        </div>

        {/* Form body */}
        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-4 overflow-y-auto p-6"
        >
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Container Name *">
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="my-mcp-server"
                className="input"
              />
            </Field>

            <Field label="Docker Image *">
              <input
                required
                value={image}
                onChange={(e) => setImage(e.target.value)}
                placeholder="mcr.microsoft.com/playwright:latest"
                className="input"
              />
            </Field>

            <Field label="Transport">
              <select
                value={transport}
                onChange={(e) => setTransport(e.target.value)}
                className="input"
              >
                <option value="http">http/sse (long-running)</option>
                <option value="stdio">stdio (session on demand)</option>
              </select>
            </Field>

            <Field label="Start Command">
              <input
                value={command}
                onChange={(e) => setCommand(e.target.value)}
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
                  onChange={(e) => setPort(e.target.value)}
                  placeholder="3001"
                  className="input"
                />
              </Field>
            )}
          </div>

          {/* Dynamic env vars */}
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
              {envPairs.map((pair, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    value={pair.key}
                    onChange={(e) => updateEnv(i, 'key', e.target.value)}
                    placeholder="KEY"
                    className="input flex-1 font-mono text-xs"
                  />
                  <input
                    value={pair.value}
                    onChange={(e) => updateEnv(i, 'value', e.target.value)}
                    placeholder="value"
                    className="input flex-1 font-mono text-xs"
                  />
                  {envPairs.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeEnv(i)}
                      className="px-2 text-red-400 hover:text-red-300"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <section className="rounded-2xl border border-gray-800 bg-gray-950/40 p-4">
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-white">Advanced Runtime</h3>
              <p className="mt-1 text-xs text-gray-400">
                Use raw Docker-style values when a MCP needs custom startup, mounts, networking, or privileges.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Entrypoint">
                <input
                  value={entrypoint}
                  onChange={(e) => setEntrypoint(e.target.value)}
                  placeholder="python"
                  className="input"
                />
              </Field>

              <Field label="Working Directory">
                <input
                  value={workingDir}
                  onChange={(e) => setWorkingDir(e.target.value)}
                  placeholder="/workspace"
                  className="input"
                />
              </Field>

              <Field label="User">
                <input
                  value={user}
                  onChange={(e) => setUser(e.target.value)}
                  placeholder="1000:1000"
                  className="input"
                />
              </Field>

              <Field label="Network Mode">
                <input
                  value={networkMode}
                  onChange={(e) => setNetworkMode(e.target.value)}
                  placeholder="bridge"
                  className="input"
                />
              </Field>

              <Field label="SHM Size">
                <input
                  value={shmSize}
                  onChange={(e) => setShmSize(e.target.value)}
                  placeholder="1g or 268435456"
                  className="input"
                />
              </Field>

              <label className="flex items-center gap-3 rounded-xl border border-gray-800 bg-gray-900/70 px-3 py-2 text-sm text-gray-200">
                <input
                  type="checkbox"
                  checked={privileged}
                  onChange={(e) => setPrivileged(e.target.checked)}
                  className="h-4 w-4"
                />
                Run container as privileged
              </label>

              <Field label="Args (one per line)">
                <textarea
                  value={args}
                  onChange={(e) => setArgs(e.target.value)}
                  placeholder={'--host\n0.0.0.0\n--port\n3001'}
                  rows={5}
                  className="input min-h-[8rem] resize-y"
                />
              </Field>

              <Field label="DNS Servers (one per line)">
                <textarea
                  value={dns}
                  onChange={(e) => setDns(e.target.value)}
                  placeholder={'1.1.1.1\n8.8.8.8'}
                  rows={5}
                  className="input min-h-[8rem] resize-y"
                />
              </Field>

              <Field label="Named Volumes (one bind per line)">
                <textarea
                  value={volumes}
                  onChange={(e) => setVolumes(e.target.value)}
                  placeholder={'mcp-cache:/data\nshared-workspace:/workspace'}
                  rows={5}
                  className="input min-h-[8rem] resize-y"
                />
              </Field>

              <Field label="Bind Mounts (one bind per line)">
                <textarea
                  value={bindMounts}
                  onChange={(e) => setBindMounts(e.target.value)}
                  placeholder={'/Users/me/project:/workspace\n/tmp/cache:/cache:ro'}
                  rows={5}
                  className="input min-h-[8rem] resize-y"
                />
              </Field>

              <Field label="Extra Hosts (one per line)">
                <textarea
                  value={extraHosts}
                  onChange={(e) => setExtraHosts(e.target.value)}
                  placeholder={'host.docker.internal:host-gateway\napi.local:10.0.0.5'}
                  rows={5}
                  className="input min-h-[8rem] resize-y"
                />
              </Field>

              <Field label="Devices (one per line)">
                <textarea
                  value={devices}
                  onChange={(e) => setDevices(e.target.value)}
                  placeholder={'/dev/kvm:/dev/kvm:rwm\n/dev/fuse:/dev/fuse'}
                  rows={5}
                  className="input min-h-[8rem] resize-y"
                />
              </Field>
            </div>
          </section>

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
              disabled={deploying}
              className="flex-1 rounded-lg bg-blue-600 py-2 text-sm transition-colors hover:bg-blue-500 disabled:opacity-50"
            >
              {deploying ? submittingLabel : submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
